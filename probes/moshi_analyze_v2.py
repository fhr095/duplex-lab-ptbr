#!/usr/bin/env python
"""Análise v2 do Moshi: EN controle, barge-in e backchannel, contra as
linhas do tempo versionadas. Sobreposição step-síncrona: parar de falar
após o interrupt = dinâmica correta; continuar após o aham = correta."""

import json
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

BASE = Path(__file__).resolve().parent.parent
EV = BASE / "notes/evidencia/moshi"
STIM = BASE / "probes/data/stimuli"

asr = WhisperModel("base", device="cpu", compute_type="int8")

def activity(path):
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        pcm = np.frombuffer(
            handle.readframes(handle.getnframes()), dtype=np.int16
        ).astype(np.float32) / 32768
    frame = int(rate * 0.02)
    frames = pcm[: len(pcm) // frame * frame].reshape(-1, frame)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    return rms > 0.015

def share(active, start_ms, end_ms):
    lo, hi = int(start_ms / 20), min(len(active), int(end_ms / 20))
    return float(active[lo:hi].mean()) if hi > lo else 0.0

def onset_after(active, ms, window=3000):
    lo, hi = int(ms / 20), min(len(active), int((ms + window) / 20))
    run = 0
    for index in range(lo, hi):
        run = run + 1 if active[index] else 0
        if run >= 5:
            return (index - 4) * 20 - ms
    return None

for name in ["en", "bargein", "backchannel"]:
    active = activity(EV / f"gpu-reply-{name}.wav")
    timeline = json.loads(
        (STIM / f"moshi-{name}-timeline.json").read_text()
    )
    print(f"== {name} ==")
    for turn in timeline:
        print(f"  {turn['name']:12s} fim@{turn['endMs']:>5}ms → onset "
              f"{onset_after(active, turn['endMs'])}ms · sobreposto "
              f"{share(active, turn['startMs'], turn['endMs']) * 100:.0f}%")
    if name == "bargein":
        interrupt = next(t for t in timeline if t["name"] == "interrupt")
        before = share(active, interrupt["startMs"] - 1500,
                       interrupt["startMs"])
        during = share(active, interrupt["startMs"], interrupt["endMs"])
        after = share(active, interrupt["endMs"], interrupt["endMs"] + 1200)
        print(f"  fala do modelo: antes {before * 100:.0f}% · durante "
              f"interrupt {during * 100:.0f}% · 1,2s depois "
              f"{after * 100:.0f}% → "
              f"{'PAROU' if during < before * 0.5 or after < 0.25 else 'NÃO PAROU'}")
    if name == "backchannel":
        aham = next(t for t in timeline if t["name"] == "aham")
        before = share(active, aham["startMs"] - 1500, aham["startMs"])
        after = share(active, aham["endMs"], aham["endMs"] + 1500)
        print(f"  fala do modelo: antes {before * 100:.0f}% · depois do "
              f"aham {after * 100:.0f}% → "
              f"{'CONTINUOU' if after > 0.3 else 'PAROU'}")
    segments, _ = asr.transcribe(str(EV / f"gpu-reply-{name}.wav"))
    text = " ".join(s.text.strip() for s in segments)
    print(f"  transcrição: {text[:180]}")
