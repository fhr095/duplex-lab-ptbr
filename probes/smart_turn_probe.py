#!/usr/bin/env python
"""Probe do Smart Turn v3.2 no pack de continuação PT-BR do EXP-0025-R.

Pergunta: um detector de turno aprendido (áudio) separa pausas-que-continuam
de finais verdadeiros melhor que a heurística regex atual, no cenário PT-BR
que o próprio lab construiu?

Cada WAV é cortado no boundary crítico (2400 ms) — o instante da pausa — e o
modelo responde: turno completo (p>0.5) ou incompleto. Classe esperada:
ends → completo; continues → incompleto.
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime
import soundfile as sf
from scipy.signal import resample_poly
from transformers import WhisperFeatureExtractor

PROJECT = Path(__file__).resolve().parent.parent
MODEL = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/"
    "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models/"
    "smart-turn-v3.2-cpu.onnx"
)
AUDIO_DIR = Path(
    "/home/Felipe/work/duplex-lab-ptbr/eval/generated/exp-0025-r/"
    "development-audio-v0.1"
)
PLAN = PROJECT / "eval/generated/exp-0025-r/development-plan-v0.1.json"
BOUNDARY_MS = 2400
SAMPLE_RATE = 16000

extractor = WhisperFeatureExtractor(chunk_length=8)
session = onnxruntime.InferenceSession(
    str(MODEL), providers=["CPUExecutionProvider"]
)


def load_16k(path: Path) -> np.ndarray:
    audio, rate = sf.read(path, dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != SAMPLE_RATE:
        audio = resample_poly(audio, SAMPLE_RATE, rate).astype("float32")
    return audio


def predict(audio: np.ndarray) -> tuple[float, float]:
    clip = audio[-8 * SAMPLE_RATE:]
    features = extractor(
        clip,
        sampling_rate=SAMPLE_RATE,
        max_length=8 * SAMPLE_RATE,
        padding="max_length",
        truncation=True,
        do_normalize=True,
        return_tensors="np",
    )["input_features"].astype("float32")
    started = time.perf_counter()
    outputs = session.run(None, {"input_features": features})
    elapsed_ms = (time.perf_counter() - started) * 1000
    return float(np.asarray(outputs[0]).reshape(-1)[0]), elapsed_ms


def text_up_to_boundary(utterance: dict) -> str:
    parts = [
        turn["deltaText"]
        for turn in utterance.get("microturns", [])
        if turn.get("atMs", 0) <= BOUNDARY_MS and turn.get("deltaText")
    ]
    return " ".join(parts).strip()


plan = json.loads(PLAN.read_text())
rows = []
for utterance in plan["utterances"]:
    wav = AUDIO_DIR / f"{utterance['id']}.wav"
    if not wav.exists():
        print(f"AUSENTE: {wav.name}")
        continue
    audio = load_16k(wav)
    cut = audio[: int(BOUNDARY_MS / 1000 * SAMPLE_RATE)]
    probability, elapsed_ms = predict(cut)
    rows.append({
        "id": utterance["id"],
        "family": utterance.get("family"),
        "outcome": utterance["outcome"],
        "textAtBoundary": text_up_to_boundary(utterance),
        "probability": round(probability, 4),
        "inferenceMs": round(elapsed_ms, 1),
        "correct": (probability > 0.5) == (utterance["outcome"] == "ENDS"),
    })

ends = [r for r in rows if r["outcome"] == "ENDS"]
continues = [r for r in rows if r["outcome"] == "CONTINUES"]
accuracy = sum(r["correct"] for r in rows) / len(rows)
ends_ok = sum(r["correct"] for r in ends)
cont_ok = sum(r["correct"] for r in continues)

# AUC por ranking simples
scores = sorted(rows, key=lambda r: r["probability"])
rank = {r["id"]: i + 1 for i, r in enumerate(scores)}
pos = [rank[r["id"]] for r in ends]
auc = (sum(pos) - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(continues))

print(f"modelo: {MODEL.name}")
print(f"n={len(rows)}  acc@0.5={accuracy:.1%}  "
      f"ends {ends_ok}/{len(ends)}  continues {cont_ok}/{len(continues)}  "
      f"AUC={auc:.3f}")
print(f"inferência mediana: "
      f"{sorted(r['inferenceMs'] for r in rows)[len(rows)//2]:.0f}ms")
print()
for row in sorted(rows, key=lambda r: (r["outcome"], r["probability"])):
    flag = "ok " if row["correct"] else "ERR"
    print(f"{flag} {row['outcome']:9s} p={row['probability']:.3f} "
          f"{row['family'][:24]:24s} «{row['textAtBoundary'][:44]}»")

out = Path(sys.argv[2]) if len(sys.argv) > 2 else None
if out:
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    print(f"\nrelatório: {out}")
