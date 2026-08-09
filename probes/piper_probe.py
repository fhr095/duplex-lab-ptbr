#!/usr/bin/env python
"""Probe do Piper pt-BR (faber-medium, edresson-low) em CPU: latência e WAVs."""

import time
import wave
from pathlib import Path

from piper import PiperVoice

MODELS = Path(
    "/tmp/claude-1000/-home-Felipe-work-duplex-lab-ptbr/"
    "83939f95-834c-424c-9ae0-d4d62dd9ddbd/scratchpad/models"
)
OUT = Path(__file__).resolve().parent.parent / "notes" / "audicao"
OUT.mkdir(parents=True, exist_ok=True)

SENTENCES = [
    ("saudacao", "Oi! Tudo bem? Pode falar naturalmente e me interromper quando quiser."),
    ("resposta", "Claro! O horário de Brasília agora é quatorze horas e vinte minutos."),
    ("confirmacao", "Entendido. Valor final confirmado: trezentos e cinquenta reais."),
    ("backchannel", "Aham, entendi."),
]

for name in ["pt_BR-faber-medium", "pt_BR-edresson-low"]:
    voice = PiperVoice.load(str(MODELS / f"{name}.onnx"))
    print(f"\n=== {name} ===")
    # aquecimento
    list(voice.synthesize("Olá."))
    for label, text in SENTENCES:
        started = time.perf_counter()
        first_chunk_ms = None
        frames = []
        sample_rate = None
        for chunk in voice.synthesize(text):
            if first_chunk_ms is None:
                first_chunk_ms = (time.perf_counter() - started) * 1000
            frames.append(chunk.audio_int16_bytes)
            sample_rate = chunk.sample_rate
        wall_ms = (time.perf_counter() - started) * 1000
        pcm = b"".join(frames)
        audio_ms = len(pcm) / 2 / sample_rate * 1000
        path = OUT / f"piper-{name.split('-')[1]}-{label}.wav"
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(sample_rate)
            handle.writeframes(pcm)
        print(f"{label:12s} 1º chunk {first_chunk_ms:5.0f}ms  total "
              f"{wall_ms:5.0f}ms  áudio {audio_ms:5.0f}ms  "
              f"RTF {wall_ms / audio_ms:.2f}  -> {path.name}")
