#!/bin/bash
# Setup do Kroko-ASR PT (perna de parciais streaming) — reproduzível do
# zero: baixa o contêiner .data do HF (sha256 conferido), desempacota os
# ONNX e cria o venv do worker. Licença do modelo: CC-BY-SA (comercial ok,
# share-alike) — ver var/observador/varredura-hf-2026-08-14.md.
set -euo pipefail
cd "$(dirname "$0")/.."

DESTINO="${KROKO_MODEL_DIR:-var/observador/testes/kroko/modelos/pt-64L}"
DATA_DIR="$(dirname "$DESTINO")"
ARQUIVO="Kroko-PT-Community-64-L-Streaming-001.data"
URL="https://huggingface.co/Banafo/Kroko-ASR/resolve/main/$ARQUIVO"
# sha256 INTEGRAL medido do artefato validado localmente (o relatório de
# teste registrava só o prefixo; o 1º run do gate pegou um pin inventado
# além da 8ª casa — este valor foi conferido contra o download do HF).
SHA_ESPERADO="36c4a92f25c9243cbd8f007cfc624b09986debf2919a1e397891e62e063d0e61"

if [ -f "$DESTINO/encoder.onnx" ]; then
  echo "modelo já desempacotado em $DESTINO"
else
  mkdir -p "$DATA_DIR"
  if [ ! -f "$DATA_DIR/$ARQUIVO" ]; then
    echo "baixando $ARQUIVO (156MB)…"
    curl -sL -o "$DATA_DIR/$ARQUIVO" "$URL"
  fi
  SHA_LIDO=$(sha256sum "$DATA_DIR/$ARQUIVO" | cut -d' ' -f1)
  if [ "$SHA_LIDO" != "$SHA_ESPERADO" ]; then
    echo "sha256 divergente: $SHA_LIDO (esperado $SHA_ESPERADO)" >&2
    exit 1
  fi
  PY=".venv-teste-kroko/bin/python"
  [ -x "$PY" ] || PY=python3
  "$PY" scripts/kroko-desempacotar.py "$DATA_DIR/$ARQUIVO" "$DESTINO"
fi

if [ ! -x ".venv-teste-kroko/bin/python" ]; then
  echo "criando venv do worker…"
  uv venv .venv-teste-kroko
  VIRTUAL_ENV="$PWD/.venv-teste-kroko" uv pip install sherpa-onnx numpy
fi
.venv-teste-kroko/bin/python -c "import sherpa_onnx, numpy" \
  && echo "kroko pronto: modelo em $DESTINO, venv .venv-teste-kroko"
