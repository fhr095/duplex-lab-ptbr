#!/usr/bin/env python3
"""Worker persistente de CENA ACÚSTICA — fala o MESMO protocolo JSONL do
asr-persistent-worker (ready/transcribe/result/cancel/close), então o
PersistentAsrWorker do lado Node o usa sem mudança de cliente.

Por requisição (PCM16LE 16 kHz do turno): fatias de 4 s com passo de 2 s
(janela limitada aos ÚLTIMOS 16 s — teto de latência; turno < 4 s = fatia
única). Para cada fatia:
  (a) métrica grátis — razão de energia 60-250 Hz / 300-3000 Hz
      (graves_voz) + flatness espectral geo/arit (sempre computada:
      explicabilidade + fallback quando o tagger está morto);
  (b) tagger sherpa-onnx (AudioSet zipformer-small int8, Apache-2.0) —
      prob. das classes Music e Speech.
Agregação da janela = MEDIANA das fatias (bancada:
var/observador/testes/cena/RELATORIO.md, AUC 1,00 no leito real).

Sem modelo no disco (ou sem sherpa_onnx), o worker NÃO morre: sobe em
modo degradado "gratis" e o veredicto cai no fallback (lado Node).
"""

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
           "NUMEXPR_NUM_THREADS", "ORT_NUM_THREADS"):
    os.environ.setdefault(_v, "1")

import argparse
import base64
import json
import math
import statistics
import sys
import time
from pathlib import Path


def emit(message):
    print(json.dumps(message, ensure_ascii=False), flush=True)


SR = 16000
FATIA_AMOSTRAS = SR * 4
PASSO_AMOSTRAS = SR * 2
JANELA_MAX_AMOSTRAS = SR * 16


def decode_pcm(command, numpy):
    if command.get("sampleRate") != SR:
        raise ValueError("worker de cena requer PCM16LE mono em 16 kHz")
    raw = base64.b64decode(command["pcmBase64"], validate=True)
    if len(raw) % 2 != 0:
        raise ValueError("PCM16LE desalinhado")
    return numpy.frombuffer(raw, dtype="<i2").astype(numpy.float32) / 32768.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-dir",
        default="var/observador/testes/cena/modelo/"
                "sherpa-onnx-zipformer-small-audio-tagging-2024-04-15",
        help="pasta com model.int8.onnx e class_labels_indices.csv",
    )
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--warmup-ms", type=int, default=500)
    args = parser.parse_args()

    import numpy

    # Métrica grátis — mesma reimplementação da bancada (FFT hanning por
    # quadro de 1 s, espectro médio da fatia, razão de médias por banda).
    quadro = SR
    janela_hann = numpy.hanning(quadro)
    freqs = numpy.fft.rfftfreq(quadro, d=1.0 / SR)
    banda_graves = (freqs >= 60) & (freqs <= 250)
    banda_voz = (freqs >= 300) & (freqs <= 3000)
    banda_flat = (freqs >= 60) & (freqs <= 8000)

    def metrica_gratis(x):
        nq = len(x) // quadro
        if nq == 0:
            return 0.0, 1.0
        esp = numpy.zeros(len(freqs))
        for i in range(nq):
            q = x[i * quadro:(i + 1) * quadro] * janela_hann
            esp += numpy.abs(numpy.fft.rfft(q)) ** 2
        esp /= nq
        graves = float(numpy.mean(esp[banda_graves]))
        voz = float(numpy.mean(esp[banda_voz]))
        razao = graves / voz if voz > 0 else 0.0
        s = esp[banda_flat] + 1e-20
        flatness = float(numpy.exp(numpy.mean(numpy.log(s))) / numpy.mean(s))
        return razao, flatness

    def dbfs(x):
        rms = float(numpy.sqrt(numpy.mean(numpy.square(x)))) if len(x) else 0.0
        return -120.0 if rms <= 0 else 20.0 * math.log10(rms)

    # Tagger — carga tolerante: qualquer falha derruba SÓ o tagger.
    tagger = None
    modelo_erro = None
    pasta = Path(args.model_dir)
    inicio_carga = time.perf_counter()
    try:
        import sherpa_onnx
        modelo = pasta / "model.int8.onnx"
        rotulos = pasta / "class_labels_indices.csv"
        if not modelo.is_file() or not rotulos.is_file():
            raise FileNotFoundError(
                f"modelo ausente em {pasta} — rode scripts/setup-cena.sh"
            )
        tagger = sherpa_onnx.AudioTagging(
            sherpa_onnx.AudioTaggingConfig(
                model=sherpa_onnx.AudioTaggingModelConfig(
                    zipformer=sherpa_onnx.OfflineZipformerAudioTaggingModelConfig(
                        model=str(modelo)
                    ),
                    num_threads=args.threads,
                    provider="cpu",
                ),
                labels=str(rotulos),
                top_k=5,
            )
        )
    except Exception as erro:  # noqa: BLE001 — degrada, não morre
        modelo_erro = repr(erro)
    model_load_ms = round((time.perf_counter() - inicio_carga) * 1000)

    def rodar_tagger(x):
        s = tagger.create_stream()
        s.accept_waveform(SR, x)
        eventos = tagger.compute(s, top_k=527)
        music = speech = 0.0
        for e in eventos:
            if e.name == "Music":
                music = float(e.prob)
            elif e.name == "Speech":
                speech = float(e.prob)
        return music, speech

    inicio_warmup = time.perf_counter()
    if tagger is not None and args.warmup_ms > 0:
        rodar_tagger(numpy.zeros(
            round(SR * args.warmup_ms / 1000), dtype=numpy.float32
        ))
    warmup_ms = round((time.perf_counter() - inicio_warmup) * 1000)

    emit({
        "type": "ready",
        "engine": "cena-tagger",
        "model": "audioset-zipformer-small-int8" if tagger else "gratis",
        "modelLoadMs": model_load_ms,
        "warmupMs": warmup_ms,
        **({"aviso": modelo_erro} if modelo_erro else {}),
    })

    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            comando = json.loads(linha)
        except json.JSONDecodeError:
            continue
        tipo = comando.get("type")
        if tipo == "close":
            break
        if tipo == "cancel":
            # Processamento é inline e curto: quando o cancel chega, a
            # resposta já saiu ou sairá imediatamente — nada a fazer.
            continue
        if tipo != "transcribe":
            continue
        request_id = comando.get("requestId")
        try:
            audio = decode_pcm(comando, numpy)
            inicio = time.perf_counter()
            audio_ms = round(len(audio) / SR * 1000)
            if len(audio) > JANELA_MAX_AMOSTRAS:
                audio = audio[-JANELA_MAX_AMOSTRAS:]
            fatias = []
            t = 0
            while t + FATIA_AMOSTRAS <= len(audio):
                fatias.append(audio[t:t + FATIA_AMOSTRAS])
                t += PASSO_AMOSTRAS
            if not fatias:
                fatias = [audio]
            razoes, flats, musics, speechs, dbs = [], [], [], [], []
            for fatia in fatias:
                razao, flat = metrica_gratis(fatia)
                razoes.append(razao)
                flats.append(flat)
                dbs.append(dbfs(fatia))
                if tagger is not None:
                    music, speech = rodar_tagger(fatia)
                    musics.append(music)
                    speechs.append(speech)
            emit({
                "type": "result",
                "requestId": request_id,
                "engine": "cena-tagger",
                "modo": "tagger" if tagger is not None else "gratis",
                "fatias": len(fatias),
                "audioMs": audio_ms,
                "janelaMs": round(len(audio) / SR * 1000),
                "elapsedMs": round((time.perf_counter() - inicio) * 1000),
                "music": round(statistics.median(musics), 4) if musics else None,
                "musicMax": round(max(musics), 4) if musics else None,
                "speech": round(statistics.median(speechs), 4) if speechs else None,
                "gravesVoz": round(statistics.median(razoes), 3),
                "flatness": round(statistics.median(flats), 5),
                "dbfs": round(statistics.median(dbs), 1),
            })
        except Exception as erro:  # noqa: BLE001 — worker não pode morrer
            emit({
                "type": "error",
                "requestId": request_id,
                "code": "cena_error",
                "message": repr(erro),
            })
    return 0


if __name__ == "__main__":
    sys.exit(main())
