#!/usr/bin/env python3
"""Worker persistente do Kroko-ASR (zipformer2 transducer streaming) para a
perna de PARCIAIS — fala o MESMO protocolo JSONL do asr-persistent-worker
(ready/transcribe/result/cancel/close), então o PersistentAsrWorker do lado
Node o usa sem nenhuma mudança de cliente.

Diferença essencial: o modelo é streaming de verdade. A sessão JS manda o
PCM ACUMULADO do turno a cada passo; aqui mantemos um stream sherpa-onnx
por sessionId e alimentamos só o DELTA — decodificação incremental real
(p95 medido 62-78 ms por chunk de 320 ms com 1 thread), sem re-decodificar
o turno inteiro como o whisper fazia.

Detecção de endpoint fica DESLIGADA: quem fecha turno é a engine (VAD +
endpoint adaptativo). Modelo: Banafo/Kroko-ASR PT community 64-L extraído
(encoder/decoder/joiner/tokens) — ver var/observador/testes/kroko/ para a
receita de download/desempacote.
"""

import argparse
import base64
import json
import sys
import time
from collections import OrderedDict
from pathlib import Path


def emit(message):
    print(json.dumps(message, ensure_ascii=False), flush=True)


def decode_pcm(command, numpy):
    if command.get("sampleRate") != 16000:
        raise ValueError("worker requer PCM16LE mono em 16 kHz")
    raw = base64.b64decode(command["pcmBase64"], validate=True)
    if len(raw) % 2 != 0:
        raise ValueError("PCM16LE desalinhado")
    return numpy.frombuffer(raw, dtype="<i2").astype(numpy.float32) / 32768.0


class Streams:
    """Um stream sherpa por sessionId, com o total de amostras já
    alimentadas — o delta entre chamadas é o que entra no modelo."""

    MAX_SESSOES = 16
    OCIOSO_S = 180.0

    def __init__(self, recognizer):
        self.recognizer = recognizer
        self.por_sessao = OrderedDict()

    def obter(self, session_id):
        agora = time.monotonic()
        estado = self.por_sessao.pop(session_id, None)
        if estado is None:
            estado = {
                "stream": self.recognizer.create_stream(),
                "amostras": 0,
                "tocado_em": agora,
            }
        estado["tocado_em"] = agora
        self.por_sessao[session_id] = estado
        while len(self.por_sessao) > self.MAX_SESSOES:
            self.por_sessao.popitem(last=False)
        for chave in [
            k for k, v in self.por_sessao.items()
            if agora - v["tocado_em"] > self.OCIOSO_S
        ]:
            del self.por_sessao[chave]
        return estado

    def reiniciar(self, session_id, estado):
        estado["stream"] = self.recognizer.create_stream()
        estado["amostras"] = 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-dir",
        required=True,
        help="pasta com encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt",
    )
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument(
        "--decoding", default="greedy_search",
        choices=["greedy_search", "modified_beam_search"],
    )
    parser.add_argument("--warmup-ms", type=int, default=500)
    args = parser.parse_args()

    import numpy
    import sherpa_onnx

    pasta = Path(args.model_dir)
    for arquivo in ("encoder.onnx", "decoder.onnx", "joiner.onnx",
                    "tokens.txt"):
        if not (pasta / arquivo).is_file():
            emit({
                "type": "fatal",
                "code": "kroko_model_missing",
                "message": f"faltando {pasta / arquivo} — receita de "
                           "download em var/observador/testes/kroko/",
            })
            return 1

    inicio_carga = time.perf_counter()
    recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(pasta / "tokens.txt"),
        encoder=str(pasta / "encoder.onnx"),
        decoder=str(pasta / "decoder.onnx"),
        joiner=str(pasta / "joiner.onnx"),
        num_threads=args.threads,
        sample_rate=16000,
        feature_dim=80,
        decoding_method=args.decoding,
        enable_endpoint_detection=False,
    )
    model_load_ms = round((time.perf_counter() - inicio_carga) * 1000)

    inicio_warmup = time.perf_counter()
    if args.warmup_ms > 0:
        aquecimento = recognizer.create_stream()
        silencio = numpy.zeros(
            round(16000 * args.warmup_ms / 1000), dtype=numpy.float32
        )
        aquecimento.accept_waveform(16000, silencio)
        while recognizer.is_ready(aquecimento):
            recognizer.decode_stream(aquecimento)
    warmup_ms = round((time.perf_counter() - inicio_warmup) * 1000)

    streams = Streams(recognizer)
    emit({
        "type": "ready",
        "engine": "kroko",
        "model": f"kroko-pt-64L/{args.decoding}",
        "modelLoadMs": model_load_ms,
        "warmupMs": warmup_ms,
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
            # Processamento é inline (<100 ms): quando o cancel chega, a
            # resposta já saiu ou sairá imediatamente — nada a fazer.
            continue
        if tipo != "transcribe":
            continue
        request_id = comando.get("requestId")
        try:
            audio = decode_pcm(comando, numpy)
            inicio = time.perf_counter()
            sessao = comando.get("sessionId") or "sem-sessao"
            estado = streams.obter(sessao)
            if len(audio) < estado["amostras"]:
                # Cumulativo encolheu = sessão reusada de forma inesperada;
                # recomeça o stream e alimenta tudo (defensivo).
                streams.reiniciar(sessao, estado)
            delta = audio[estado["amostras"]:]
            if len(delta) > 0:
                estado["stream"].accept_waveform(16000, delta)
                estado["amostras"] = len(audio)
            while recognizer.is_ready(estado["stream"]):
                recognizer.decode_stream(estado["stream"])
            texto = recognizer.get_result(estado["stream"])
            elapsed_ms = round((time.perf_counter() - inicio) * 1000)
            emit({
                "type": "result",
                "requestId": request_id,
                "engine": "kroko",
                "text": str(texto).strip(),
                "elapsedMs": elapsed_ms,
                "language": comando.get("language", "pt"),
                "languageProbability": None,
                "segments": [],
            })
        except Exception as erro:  # noqa: BLE001 — worker não pode morrer
            emit({
                "type": "error",
                "requestId": request_id,
                "code": "kroko_error",
                "message": repr(erro),
            })
    return 0


if __name__ == "__main__":
    sys.exit(main())
