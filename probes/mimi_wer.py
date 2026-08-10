#!/usr/bin/env python
"""Fase WER do probe Mimi (roda no .venv que tem faster-whisper)."""

import json
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

ROOT = Path("/home/Felipe/work/duplex-lab-ptbr")
OUT = Path(__file__).resolve().parent.parent / "notes/evidencia/mimi"

manifest = json.loads(
    (ROOT / "eval/generated/coraa/manifest.json").read_text()
)
cases = [
    (item["id"].split("/")[-1], item["expected"])
    for item in manifest["cases"][:6]
]
cases += [
    ("piper-correcao",
     "O valor é de trezentos reais, na verdade quatrocentos reais."),
    ("piper-explica",
     "Me explica com calma como funciona o rendimento da poupança."),
]

asr = WhisperModel("base", device="cpu", compute_type="int8")

def transcribe(path):
    segments, _ = asr.transcribe(str(path), language="pt")
    return " ".join(segment.text.strip() for segment in segments)

def wer(reference, hypothesis):
    r = reference.lower().split()
    h = hypothesis.lower().split()
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=np.int32)
    d[:, 0] = np.arange(len(r) + 1)
    d[0, :] = np.arange(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(
                d[i - 1, j] + 1,
                d[i, j - 1] + 1,
                d[i - 1, j - 1] + (r[i - 1] != h[j - 1]),
            )
    return d[len(r), len(h)] / max(1, len(r))

rows = []
for name, expected in cases:
    wer_orig = wer(expected, transcribe(OUT / f"{name}-orig.wav"))
    wer_recon = wer(expected, transcribe(OUT / f"{name}-recon.wav"))
    rows.append((name, wer_orig, wer_recon))
    print(f"{name:28s} WER orig {wer_orig * 100:5.1f}% → "
          f"recon {wer_recon * 100:5.1f}%  "
          f"(delta {(wer_recon - wer_orig) * 100:+.1f}pp)")

mean_orig = float(np.mean([row[1] for row in rows]))
mean_recon = float(np.mean([row[2] for row in rows]))
print(f"\nmédia: orig {mean_orig * 100:.1f}% → recon "
      f"{mean_recon * 100:.1f}% (delta "
      f"{(mean_recon - mean_orig) * 100:+.1f}pp)")
(OUT / "report.json").write_text(json.dumps({
    "rows": [
        {"case": name, "werOrig": round(o, 4), "werRecon": round(c, 4)}
        for name, o, c in rows
    ],
    "meanWerOrig": round(mean_orig, 4),
    "meanWerRecon": round(mean_recon, 4),
}, indent=1))
