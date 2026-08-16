#!/usr/bin/env python3
"""Sidecar HTTP do Supertonic-3 para o TTS_PROVIDER=supertonic.

Contrato (o mesmo do provider genérico do serve.mjs):
  POST /  corpo text/plain UTF-8  ->  audio/wav completo (PCM_16, 44100 Hz)
  GET  /  (qualquer caminho)      ->  200 JSON de health

Voz padrão via SUPERTONIC_VOICE (F1..F5, M1..M5; default F4 — provisória
até o re-bake-off). Override por requisição com ?voz=F1 (usado pelo
harness do bake-off para gerar todas as vozes pelo caminho real do
produto). Sem normalização de texto aqui: a engine já manda o texto
falado normalizado.

HF_HUB_OFFLINE=1 e auto_download=False por padrão: o download automático
do pacote APAGA o cache ~/.cache/supertonic3 inteiro antes de rebaixar, e
o exp-0019 usa esse mesmo cache. Se o cache não existir, falha alto em vez
de baixar (destrave consciente: SUPERTONIC_ALLOW_DOWNLOAD=1).
"""

import argparse
import io
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

VOZES = tuple(f"{g}{i}" for g in "FM" for i in range(1, 6))
VOZ_PADRAO = os.environ.get("SUPERTONIC_VOICE", "F4").strip() or "F4"
STEPS = int(os.environ.get("SUPERTONIC_STEPS", "8"))
SPEED = float(os.environ.get("SUPERTONIC_SPEED", "1.05"))
SAMPLE_RATE = 44100

# Frases longas demais degradam prosódia/duração num passe só; corta em
# sentenças e emenda com um respiro curto.
LIMITE_CHARS = 300
PAUSA_S = 0.12


def fatiar(texto):
    pedacos = re.split(r"(?<=[.!?…])\s+", texto.strip())
    saida = []
    for pedaco in pedacos:
        while len(pedaco) > LIMITE_CHARS:
            corte = pedaco.rfind(",", 0, LIMITE_CHARS)
            if corte < LIMITE_CHARS // 2:
                corte = pedaco.rfind(" ", 0, LIMITE_CHARS)
            if corte <= 0:
                corte = LIMITE_CHARS
            saida.append(pedaco[:corte + 1].strip())
            pedaco = pedaco[corte + 1:].strip()
        if pedaco:
            saida.append(pedaco)
    return saida or [texto.strip()]


class Sintetizador:
    def __init__(self):
        from supertonic import TTS

        permitir_download = os.environ.get("SUPERTONIC_ALLOW_DOWNLOAD") == "1"
        cache = os.path.expanduser("~/.cache/supertonic3")
        if not permitir_download and not os.path.isdir(cache):
            raise SystemExit(
                f"cache do modelo ausente em {cache} e download automático "
                "desativado (ele APAGA o cache compartilhado com o exp-0019). "
                "Destrave consciente: SUPERTONIC_ALLOW_DOWNLOAD=1"
            )
        self.tts = TTS(
            model="supertonic-3",
            auto_download=permitir_download,
            intra_op_num_threads=int(
                os.environ.get("SUPERTONIC_INTRA_OP_THREADS", "3")
            ),
            inter_op_num_threads=int(
                os.environ.get("SUPERTONIC_INTER_OP_THREADS", "1")
            ),
        )
        self.estilos = {}
        self.trava = threading.Lock()
        self.get_estilo(VOZ_PADRAO)  # valida a voz padrão já na carga

    def get_estilo(self, voz):
        if voz not in VOZES:
            raise ValueError(f"voz desconhecida: {voz} (use {'/'.join(VOZES)})")
        if voz not in self.estilos:
            self.estilos[voz] = self.tts.get_voice_style(voz)
        return self.estilos[voz]

    def sintetizar(self, texto, voz):
        estilo = self.get_estilo(voz)
        trechos = []
        pausa = np.zeros(int(SAMPLE_RATE * PAUSA_S), dtype=np.float32)
        with self.trava:  # sessões ONNX servem uma síntese por vez
            for indice, frase in enumerate(fatiar(texto)):
                wav, _dur = self.tts.synthesize(
                    frase,
                    voice_style=estilo,
                    lang="pt",
                    total_steps=STEPS,
                    speed=SPEED,
                )
                if indice > 0:
                    trechos.append(pausa)
                trechos.append(np.asarray(wav, dtype=np.float32).reshape(-1))
        return np.concatenate(trechos) if len(trechos) > 1 else trechos[0]


SINT = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # log enxuto no stdout
        print(f"[sidecar] {self.address_string()} {fmt % args}", flush=True)

    def _responder(self, codigo, corpo, content_type):
        self.send_response(codigo)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        corpo = json.dumps({
            "ok": True,
            "engine": "supertonic-3",
            "voice": VOZ_PADRAO,
            "steps": STEPS,
            "speed": SPEED,
            "sample_rate": SAMPLE_RATE,
        }).encode()
        self._responder(200, corpo, "application/json")

    def do_POST(self):
        try:
            tamanho = int(self.headers.get("content-length") or 0)
            texto = self.rfile.read(tamanho).decode("utf-8").strip()
            if not texto:
                self._responder(400, b"texto vazio", "text/plain")
                return
            voz = VOZ_PADRAO
            if "?" in self.path:
                for par in self.path.split("?", 1)[1].split("&"):
                    if par.startswith("voz="):
                        voz = par.split("=", 1)[1].upper()
            inicio = time.monotonic()
            audio = SINT.sintetizar(texto, voz)
            buffer = io.BytesIO()
            sf.write(buffer, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
            wav = buffer.getvalue()
            gasto = time.monotonic() - inicio
            duracao = len(audio) / SAMPLE_RATE
            print(
                f"[sidecar] voz={voz} chars={len(texto)} "
                f"audio={duracao:.2f}s sintese={gasto:.2f}s "
                f"rtf={gasto / duracao:.2f}",
                flush=True,
            )
            self._responder(200, wav, "audio/wav")
        except ValueError as erro:
            self._responder(400, str(erro).encode(), "text/plain")
        except Exception as erro:  # noqa: BLE001 — sidecar não pode morrer
            print(f"[sidecar] ERRO: {erro!r}", flush=True)
            self._responder(500, repr(erro).encode(), "text/plain")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8341)
    args = parser.parse_args()

    global SINT
    t0 = time.monotonic()
    SINT = Sintetizador()
    # Warmup: a 1ª síntese real paga JIT/alocações; melhor pagar aqui.
    SINT.sintetizar("Pronto para falar.", VOZ_PADRAO)
    print(
        f"[sidecar] supertonic-3 carregado em {time.monotonic() - t0:.1f}s "
        f"(voz={VOZ_PADRAO} steps={STEPS} speed={SPEED})",
        flush=True,
    )

    servidor = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[sidecar] ouvindo em http://{args.host}:{args.port}", flush=True)
    servidor.serve_forever()


if __name__ == "__main__":
    main()
