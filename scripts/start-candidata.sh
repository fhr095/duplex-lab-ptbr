#!/bin/bash
# Perfil ÚNICO da engine candidata v1 (docs/CANDIDATA-V1.md).
# Toda a configuração da candidata vive AQUI — nada de conhecimento
# implícito de sessão: .env guarda só segredos/opt-ins; o resto é default
# de código ou está pinado abaixo. Uso:
#   bash scripts/start-candidata.sh              # engine pura
#   OBSERVER=1 bash scripts/start-candidata.sh   # com observador (opt-in)
set -euo pipefail
cd "$(dirname "$0")/.."

KROKO_DIR="${KROKO_MODEL_DIR:-var/observador/testes/kroko/modelos/pt-64L}"
if [ ! -f "$KROKO_DIR/encoder.onnx" ]; then
  echo "modelo Kroko ausente — rode: bash scripts/setup-kroko.sh" >&2
  exit 1
fi
if [ ! -x .venv-teste-supertonic/bin/python ]; then
  echo "venv do Supertonic ausente — rode: bash scripts/setup-engine-voices.sh" >&2
  exit 1
fi

# Perfil candidata v1: parciais Kroko streaming + voz Supertonic.
# Defaults de código já promovidos (não repetir aqui): final TAGARELA
# int8, teto de enunciado 30 s, guarda 400 chamadas/processo, VAD Silero
# 0.85/1, normalização números→extenso, especulação + fast-ack ligados.
# CONTINUACAO_POS_INTERRUPCAO fica OFF até validação viva (T4) — ligar
# explicitamente só em sessão de roda: CONTINUACAO_POS_INTERRUPCAO=1.
exec env \
  ASR_PARTIAL_ENGINE=kroko \
  TTS_PROVIDER=supertonic \
  bash scripts/start-engine.sh
