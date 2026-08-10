#!/usr/bin/env python
"""B1b/B1c — análise do reply.wav do Moshi contra a linha do tempo do
estímulo: onsets de resposta, tomada prematura na pausa de hesitação,
sobreposição (fala durante a fala do usuário) e transcrição EN."""

import json
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

BASE = Path(__file__).resolve().parent.parent / "notes/evidencia/moshi"
MODELS = Path(
    "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/"
    "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models"
)
timeline = json.loads(
    (MODELS / "moshi-convo-timeline.json").read_text()
)

with wave.open(str(BASE / "gpu-reply.wav"), "rb") as handle:
    rate = handle.getframerate()
    pcm = np.frombuffer(
        handle.readframes(handle.getnframes()), dtype=np.int16
    ).astype(np.float32) / 32768

FRAME = int(rate * 0.02)
frames = pcm[: len(pcm) // FRAME * FRAME].reshape(-1, FRAME)
rms = np.sqrt((frames ** 2).mean(axis=1))
active = rms > 0.015

def active_in(start_ms, end_ms):
    lo = int(start_ms / 20)
    hi = min(len(active), int(end_ms / 20))
    return active[lo:hi].mean() if hi > lo else 0.0

def first_onset_after(ms, window_ms=3000):
    lo = int(ms / 20)
    hi = min(len(active), int((ms + window_ms) / 20))
    run = 0
    for index in range(lo, hi):
        run = run + 1 if active[index] else 0
        if run >= 5:  # 100ms contínuos
            return (index - 4) * 20 - ms
    return None

print("== dinâmica de turno (janelas de 20ms, limiar 0.015) ==")
for turn in timeline:
    onset = first_onset_after(turn["endMs"])
    overlap = active_in(turn["startMs"], turn["endMs"])
    print(f"{turn['name']:10s} fim@{turn['endMs']:>6}ms → "
          f"onset {'%+dms' % onset if onset is not None else 'nenhum'} · "
          f"fala sobreposta durante o turno: {overlap * 100:.0f}%")

pause = next(t for t in timeline if t["name"] == "hesita-a")
gap_activity = active_in(pause["endMs"], pause["endMs"] + 900)
print(f"\npausa de hesitação (900ms): atividade do modelo "
      f"{gap_activity * 100:.0f}% → "
      f"{'TOMADA PREMATURA' if gap_activity > 0.15 else 'esperou'}")

print("\n== transcrição da resposta (EN) ==")
asr = WhisperModel("base", device="cpu", compute_type="int8")
segments, _ = asr.transcribe(str(BASE / "gpu-reply.wav"))
for segment in segments:
    print(f"[{segment.start:6.2f}–{segment.end:6.2f}] "
          f"{segment.text.strip()}")
