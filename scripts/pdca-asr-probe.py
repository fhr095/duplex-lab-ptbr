#!/usr/bin/env python3
"""PDCA do ASR final — mede candidatos nos MESMOS áudios.

Conjuntos:
  --fatias  fatias.json  (dev: enunciados reais capturados; métrica válida
            só para candidatos NÃO-whisper — a pseudo-referência é whisper)
  --coraa   manifest.json (checagem independente com transcrição HUMANA;
            juiz primário de todos os candidatos)

Candidatos (--motor/--variante):
  parakeet  int8 | int8-norm | fp32 | fp32-norm   (.venv-parakeet)
  whisper   small-int8 | medium-int8              (.venv-obs)

Normalização (fixada a priori, sem ajuste por item): pico→0,9 quando
0,004 < pico; abaixo disso o buffer é tratado como ruído e fica intacto.
Saída: JSONL com {conjunto, id, referencia, texto, divergencia, ms}.
"""

import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import numpy


def normalizar_texto(texto):
    texto = unicodedata.normalize("NFC", texto.lower())
    texto = re.sub(r"[^\w\sáéíóúâêôãõàç]", " ", texto)
    return [p for p in texto.split() if p]


def divergencia(referencia, hipotese):
    a = normalizar_texto(referencia)
    b = normalizar_texto(hipotese)
    if not a and not b:
        return 0.0
    tabela = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        anterior = tabela[0]
        tabela[0] = i
        for j in range(1, len(b) + 1):
            atual = tabela[j]
            custo = 0 if a[i - 1] == b[j - 1] else 1
            tabela[j] = min(
                tabela[j] + 1, tabela[j - 1] + 1, anterior + custo
            )
            anterior = atual
    return round(tabela[len(b)] / max(len(a), len(b), 1), 3)


def ler_wav_mono16k(caminho):
    # leitor RIFF manual: o módulo wave recusa float32 (formato 3),
    # presente em parte do CORAA
    dados = Path(caminho).read_bytes()
    if dados[0:4] != b"RIFF" or dados[8:12] != b"WAVE":
        raise ValueError(f"não é WAV: {caminho}")
    offset = 12
    formato = canais = sr = bits = None
    corpo = None
    while offset + 8 <= len(dados):
        rotulo = dados[offset:offset + 4]
        tamanho = int.from_bytes(dados[offset + 4:offset + 8], "little")
        inicio = offset + 8
        if rotulo == b"fmt ":
            formato = int.from_bytes(dados[inicio:inicio + 2], "little")
            canais = int.from_bytes(dados[inicio + 2:inicio + 4], "little")
            sr = int.from_bytes(dados[inicio + 4:inicio + 8], "little")
            bits = int.from_bytes(dados[inicio + 14:inicio + 16], "little")
        elif rotulo == b"data":
            corpo = dados[inicio:inicio + tamanho]
        offset = inicio + tamanho + (tamanho % 2)
    if corpo is None or formato is None:
        raise ValueError(f"WAV sem fmt/data: {caminho}")
    if formato == 3 and bits == 32:
        pcm = numpy.frombuffer(corpo, dtype=numpy.float32).astype(
            numpy.float32
        )
    elif formato == 1 and bits == 16:
        pcm = numpy.frombuffer(corpo, dtype=numpy.int16).astype(
            numpy.float32
        ) / 32768.0
    else:
        raise ValueError(
            f"formato WAV não suportado ({formato}/{bits}b): {caminho}"
        )
    if canais > 1:
        pcm = pcm[: len(pcm) - len(pcm) % canais]
        pcm = pcm.reshape(-1, canais).mean(axis=1)
    if sr != 16000:
        posicoes = numpy.arange(
            0, len(pcm), sr / 16000.0, dtype=numpy.float64
        )
        pcm = numpy.interp(
            posicoes, numpy.arange(len(pcm), dtype=numpy.float64), pcm
        ).astype(numpy.float32)
        sr = 16000
    return pcm, sr


def normalizar_pico(pcm):
    pico = float(numpy.abs(pcm).max()) if len(pcm) else 0.0
    if pico <= 0.004:
        return pcm
    return numpy.clip(pcm * (0.9 / pico), -1.0, 1.0)


def criar_reconhecedor(motor, variante, threads, repo=None):
    if motor == "parakeet":
        import onnx_asr
        import onnxruntime

        opcoes = onnxruntime.SessionOptions()
        opcoes.intra_op_num_threads = threads
        opcoes.inter_op_num_threads = 1
        quantizacao = "int8" if variante.startswith("int8") else None
        modelo = onnx_asr.load_model(
            repo or "nemo-parakeet-tdt-0.6b-v3",
            quantization=quantizacao,
            sess_options=opcoes,
            providers=["CPUExecutionProvider"],
        )

        def reconhecer(pcm):
            return str(modelo.recognize(pcm, sample_rate=16000)).strip()

        return reconhecer

    from faster_whisper import WhisperModel

    tamanho = variante.split("-")[0]
    modelo = WhisperModel(
        tamanho, device="cpu", compute_type="int8", cpu_threads=threads
    )

    def reconhecer(pcm):
        segmentos, _ = modelo.transcribe(
            pcm, language="pt", beam_size=5, vad_filter=False
        )
        return " ".join(s.text.strip() for s in segmentos).strip()

    return reconhecer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--motor", required=True,
                        choices=("parakeet", "whisper"))
    parser.add_argument("--variante", required=True)
    parser.add_argument("--fatias", type=Path)
    parser.add_argument("--coraa", type=Path)
    parser.add_argument("--threads", type=int, default=3)
    parser.add_argument("--saida", type=Path, required=True)
    parser.add_argument("--repo", default=None)
    argumentos = parser.parse_args()

    reconhecer = criar_reconhecedor(
        argumentos.motor, argumentos.variante, argumentos.threads,
        repo=argumentos.repo
    )
    com_norm = argumentos.variante.endswith("-norm")
    rotulo = f"{argumentos.motor}/{argumentos.variante}"

    casos = []
    if argumentos.fatias:
        for item in json.loads(argumentos.fatias.read_text()):
            casos.append(("dev", item["origem"] + ":" +
                          f"{item['inicio']:.1f}s", item))
    if argumentos.coraa:
        manifesto = json.loads(argumentos.coraa.read_text())
        raiz = argumentos.coraa.parent.parent.parent
        for caso in manifesto["cases"]:
            casos.append(("coraa", caso["id"], {
                "wav": str(raiz / caso["audio"]),
                "inicio": None,
                "fim": None,
                "referencia": caso["expected"],
            }))

    with argumentos.saida.open("a", encoding="utf-8") as saida:
        for conjunto, identificador, item in casos:
            pcm, sr = ler_wav_mono16k(item["wav"])
            if item["inicio"] is not None:
                pcm = pcm[int(item["inicio"] * sr):int(item["fim"] * sr)]
            if com_norm:
                pcm = normalizar_pico(pcm)
            inicio = time.perf_counter()
            texto = reconhecer(pcm)
            ms = round((time.perf_counter() - inicio) * 1000)
            registro = {
                "candidato": rotulo,
                "conjunto": conjunto,
                "id": identificador,
                "audioS": round(len(pcm) / sr, 2),
                "referencia": item["referencia"],
                "texto": texto,
                "divergencia": divergencia(item["referencia"], texto),
                "ms": ms,
            }
            saida.write(json.dumps(registro, ensure_ascii=False) + "\n")
            print(
                f"{rotulo} [{conjunto}] {identificador}: "
                f"div={registro['divergencia']} {ms}ms",
                file=sys.stderr, flush=True,
            )


if __name__ == "__main__":
    main()
