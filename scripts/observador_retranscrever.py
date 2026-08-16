#!/usr/bin/env python3
"""Retranscrição forte (pseudo-referência) de um canal do pacote do
observador com faster-whisper. NÃO é WER real — sem correção humana serve
apenas como referência mais forte que o ASR de streaming da engine.

Escolha de modelo `auto`: large-v3 se houver RAM sobrando, senão medium
(ambos int8, CPU). Saída: linhas JSON {canal, inicio, fim, texto,
palavras, logprobMedio} anexadas ao arquivo --saida.
"""

import argparse
import json
import os
import sys


def modelo_auto() -> str:
    try:
        with open("/proc/meminfo", encoding="ascii") as arquivo:
            for linha in arquivo:
                if linha.startswith("MemAvailable"):
                    disponivel_mb = int(linha.split()[1]) // 1024
                    return "large-v3" if disponivel_mb >= 4500 else "medium"
    except OSError:
        pass
    return "medium"


def principal() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--entrada", required=True)
    parser.add_argument("--canal", required=True)
    parser.add_argument("--saida", required=True)
    parser.add_argument("--modelo", default="auto")
    argumentos = parser.parse_args()

    nome_modelo = (
        modelo_auto() if argumentos.modelo == "auto" else argumentos.modelo
    )
    print(
        f"faster-whisper {nome_modelo} int8 (cpu) em {argumentos.entrada}",
        file=sys.stderr,
    )

    from faster_whisper import WhisperModel

    modelo = WhisperModel(
        nome_modelo,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(1, (os.cpu_count() or 2) - 1),
    )
    segmentos, _info = modelo.transcribe(
        argumentos.entrada,
        language="pt",
        vad_filter=True,
        word_timestamps=True,
        beam_size=5,
    )
    with open(argumentos.saida, "a", encoding="utf-8") as saida:
        for segmento in segmentos:
            registro = {
                "canal": argumentos.canal,
                "modelo": nome_modelo,
                "inicio": round(segmento.start, 3),
                "fim": round(segmento.end, 3),
                "texto": segmento.text.strip(),
                "logprobMedio": round(segmento.avg_logprob, 3),
                "palavras": [
                    {
                        "p": palavra.word.strip(),
                        "inicio": round(palavra.start, 3),
                        "fim": round(palavra.end, 3),
                    }
                    for palavra in (segmento.words or [])
                ],
            }
            saida.write(json.dumps(registro, ensure_ascii=False) + "\n")
            print(
                f"[{registro['inicio']:7.2f}s] {registro['texto']}",
                file=sys.stderr,
            )
    return 0


if __name__ == "__main__":
    sys.exit(principal())
