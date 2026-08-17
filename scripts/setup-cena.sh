#!/bin/bash
# Modelo do tagger de CENA ACÚSTICA (sherpa-onnx AudioSet zipformer-small,
# Apache-2.0): baixa o tarball pinado por sha256 e desempacota o int8.
# O worker (scripts/cena-tagger-worker.py) usa o MESMO venv do Kroko
# (.venv-teste-kroko: sherpa-onnx + numpy) — rode setup-kroko.sh antes.
set -euo pipefail
cd "$(dirname "$0")/.."

DESTINO="${CENA_MODEL_DIR:-var/observador/testes/cena/modelo/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15}"
PASTA="$(dirname "$DESTINO")"
TARBALL="$PASTA/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15.tar.bz2"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15.tar.bz2"
SHA256="07e2fafcdcbc461f2816188d9b0bbafced12584030cf67d5652e549ef256a2c6"

if [ -f "$DESTINO/model.int8.onnx" ]; then
  echo "cena pronta: modelo em $DESTINO"
  exit 0
fi

mkdir -p "$PASTA"
if [ ! -f "$TARBALL" ]; then
  echo "baixando tagger AudioSet (~106 MB)…"
  curl -L --fail -o "$TARBALL" "$URL"
fi
echo "$SHA256  $TARBALL" | sha256sum -c -

tar -xjf "$TARBALL" -C "$PASTA"
test -f "$DESTINO/model.int8.onnx"
test -f "$DESTINO/class_labels_indices.csv"

if [ -x ".venv-teste-kroko/bin/python" ]; then
  .venv-teste-kroko/bin/python -c "import sherpa_onnx, numpy" \
    && echo "cena pronta: modelo em $DESTINO, venv .venv-teste-kroko"
else
  echo "AVISO: venv .venv-teste-kroko ausente — rode scripts/setup-kroko.sh" >&2
fi
