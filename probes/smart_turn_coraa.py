#!/usr/bin/env python
"""Smart Turn v3.2 sobre fala espontânea PT-BR real (CORAA).

Pontos de decisão:
  - cada pausa interna (silêncio energia < limiar por >= pause_ms) com fala
    depois → rótulo INCOMPLETO (o falante continuou);
  - o fim verdadeiro do clipe → rótulo COMPLETO.
Compara também com a heurística regex do runtime (looksIncompletePtBr não é
portada aqui; o texto por ponto de decisão exigiria ASR — fica para o probe
integrado). Aqui a pergunta é puramente acústica: a prosódia real separa?
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

MODEL = Path(
    "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/"
    "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models/"
    "smart-turn-v3.2-cpu.onnx"
)
MANIFEST = Path(
    "/home/Felipe/work/duplex-lab-ptbr/eval/generated/coraa/manifest.json"
)
ROOT = Path("/home/Felipe/work/duplex-lab-ptbr")
SAMPLE_RATE = 16000
FRAME_MS = 20
PAUSE_MS = 320
RMS_FLOOR = 0.010

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


def predict(clip: np.ndarray) -> float:
    features = extractor(
        clip[-8 * SAMPLE_RATE:],
        sampling_rate=SAMPLE_RATE,
        max_length=8 * SAMPLE_RATE,
        padding="max_length",
        truncation=True,
        do_normalize=True,
        return_tensors="np",
    )["input_features"].astype("float32")
    outputs = session.run(None, {"input_features": features})
    return float(np.asarray(outputs[0]).reshape(-1)[0])


def frame_rms(audio: np.ndarray) -> np.ndarray:
    hop = int(SAMPLE_RATE * FRAME_MS / 1000)
    n = len(audio) // hop
    frames = audio[: n * hop].reshape(n, hop)
    return np.sqrt((frames ** 2).mean(axis=1))


def decision_points(audio: np.ndarray):
    """Retorna [(ms_do_ponto, rotulo)] com pausas internas e o fim."""
    rms = frame_rms(audio)
    active = rms > RMS_FLOOR
    points = []
    pause_frames = PAUSE_MS // FRAME_MS
    run = 0
    last_speech_end = None
    for index, is_active in enumerate(active):
        if is_active:
            if run >= pause_frames and last_speech_end is not None:
                points.append((last_speech_end * FRAME_MS + PAUSE_MS,
                               "INCOMPLETO"))
            run = 0
            last_speech_end = index + 1
        else:
            run += 1
    if last_speech_end is not None:
        points.append((last_speech_end * FRAME_MS + PAUSE_MS, "COMPLETO"))
    return points


manifest = json.loads(MANIFEST.read_text())
items = manifest if isinstance(manifest, list) else manifest.get(
    "cases", manifest.get("items", [])
)
rows = []
for item in items:
    wav = ROOT / item["audio"]
    if not wav.exists():
        continue
    audio = load_16k(wav)
    for at_ms, label in decision_points(audio):
        cut = audio[: int(at_ms / 1000 * SAMPLE_RATE)]
        if len(cut) < SAMPLE_RATE // 2:
            continue
        probability = predict(cut)
        rows.append({
            "clip": item["id"].split("/")[-1],
            "category": item.get("category"),
            "atMs": at_ms,
            "label": label,
            "probability": round(probability, 4),
            "correct": (probability > 0.5) == (label == "COMPLETO"),
        })

complete = [r for r in rows if r["label"] == "COMPLETO"]
incomplete = [r for r in rows if r["label"] == "INCOMPLETO"]
if rows:
    accuracy = sum(r["correct"] for r in rows) / len(rows)
    scores = sorted(rows, key=lambda r: r["probability"])
    rank = {id(r): i + 1 for i, r in enumerate(scores)}
    pos = [rank[id(r)] for r in complete]
    auc = ((sum(pos) - len(pos) * (len(pos) + 1) / 2) /
           max(1, len(pos) * len(incomplete)))
    print(f"n={len(rows)}  completos={len(complete)}  "
          f"incompletos={len(incomplete)}")
    print(f"acc@0.5={accuracy:.1%}  "
          f"completos ok {sum(r['correct'] for r in complete)}/{len(complete)}  "
          f"incompletos ok {sum(r['correct'] for r in incomplete)}"
          f"/{len(incomplete)}  AUC={auc:.3f}")
    print()
    for row in rows:
        flag = "ok " if row["correct"] else "ERR"
        print(f"{flag} {row['label']:10s} p={row['probability']:.3f} "
              f"@{row['atMs']:>6.0f}ms {row['category'][:18]:18s} "
              f"{row['clip'][:34]}")
