#!/usr/bin/env python
"""Probe do Kokoro-82M int8 em CPU para PT-BR: latência, RTF e WAVs de audição.

Mede por frase: wall-clock da síntese completa e TTFA simulado por chunking
(primeira cláusula curta). Salva WAVs para julgamento auditivo humano.
"""

import time
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

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
    ("clausula-curta", "Claro!"),
]

kokoro = Kokoro(
    str(MODELS / "kokoro-v1.0.int8.onnx"),
    str(MODELS / "voices-v1.0.bin"),
)

for voice in ["pf_dora", "pm_alex"]:
    print(f"\n=== voz {voice} ===")
    # aquecimento
    kokoro.create("Olá.", voice=voice, speed=1.0, lang="pt-br")
    for name, text in SENTENCES:
        started = time.perf_counter()
        samples, sample_rate = kokoro.create(
            text, voice=voice, speed=1.0, lang="pt-br"
        )
        wall_ms = (time.perf_counter() - started) * 1000
        audio_ms = len(samples) / sample_rate * 1000
        rtf = wall_ms / audio_ms if audio_ms else float("inf")
        path = OUT / f"kokoro-{voice}-{name}.wav"
        sf.write(path, np.asarray(samples), sample_rate)
        print(f"{name:16s} sintese {wall_ms:6.0f}ms  audio {audio_ms:6.0f}ms  "
              f"RTF {rtf:.2f}  ({len(text)} chars) -> {path.name}")
