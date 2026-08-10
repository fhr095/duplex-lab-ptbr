#!/usr/bin/env python
"""B1a — fidelidade do codec Mimi (Moshi/PersonaPlex) para PT-BR, local/CPU.

Pergunta decomposta: o codec neural que sustenta a família Moshi preserva
fala PT-BR o bastante para ASR (proxy de inteligibilidade)? Compara WER do
áudio original vs reconstruído (encode→decode) nas MESMAS referências.
"""

import json
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly
from transformers import MimiModel

ROOT = Path("/home/Felipe/work/duplex-lab-ptbr")
MODELS = Path(
    "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/"
    "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models"
)
OUT = Path(__file__).resolve().parent.parent / "notes/evidencia/mimi"
OUT.mkdir(parents=True, exist_ok=True)
MIMI_RATE = 24_000

print("carregando Mimi…")
mimi = MimiModel.from_pretrained("kyutai/mimi")
mimi.eval()

def load_24k(path):
    audio, rate = sf.read(path, dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != MIMI_RATE:
        audio = resample_poly(audio, MIMI_RATE, rate).astype("float32")
    return audio

def roundtrip(audio):
    with torch.no_grad():
        values = torch.tensor(audio)[None, None, :]
        encoded = mimi.encode(values)
        decoded = mimi.decode(encoded.audio_codes)
    return decoded.audio_values[0, 0].numpy()

manifest = json.loads(
    (ROOT / "eval/generated/coraa/manifest.json").read_text()
)
cases = [
    (ROOT / item["audio"], item["expected"], item["id"].split("/")[-1])
    for item in manifest["cases"][:6]
]
cases += [
    (MODELS / "fala-correcao.wav",
     "O valor é de trezentos reais, na verdade quatrocentos reais.",
     "piper-correcao"),
    (MODELS / "fala-explica.wav",
     "Me explica com calma como funciona o rendimento da poupança.",
     "piper-explica"),
]

pairs = []
for path, expected, name in cases:
    audio = load_24k(path)
    recon = roundtrip(audio)
    sf.write(OUT / f"{name}-recon.wav", recon, MIMI_RATE)
    sf.write(OUT / f"{name}-orig.wav", audio, MIMI_RATE)
    pairs.append((name, expected))
    print(f"roundtrip ok: {name} ({len(audio) / MIMI_RATE:.1f}s)")

# WER com faster-whisper (base) nas mesmas referências
from faster_whisper import WhisperModel  # noqa: E402

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
for name, expected in pairs:
    wer_orig = wer(expected, transcribe(OUT / f"{name}-orig.wav"))
    wer_recon = wer(expected, transcribe(OUT / f"{name}-recon.wav"))
    rows.append((name, wer_orig, wer_recon))
    print(f"{name:28s} WER orig {wer_orig * 100:5.1f}% → "
          f"recon {wer_recon * 100:5.1f}%  "
          f"(delta {(wer_recon - wer_orig) * 100:+.1f}pp)")

mean_orig = float(np.mean([row[1] for row in rows]))
mean_recon = float(np.mean([row[2] for row in rows]))
print(f"\nmédia: orig {mean_orig * 100:.1f}% → recon "
      f"{mean_recon * 100:.1f}% (delta {(mean_recon - mean_orig) * 100:+.1f}pp)")
(OUT / "report.json").write_text(json.dumps({
    "rows": [
        {"case": name, "werOrig": round(o, 4), "werRecon": round(c, 4)}
        for name, o, c in rows
    ],
    "meanWerOrig": round(mean_orig, 4),
    "meanWerRecon": round(mean_recon, 4),
}, indent=1))
