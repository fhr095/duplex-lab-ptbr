#!/bin/bash
# Engine candidata — instalação reproduzível dos componentes de voz.
# Idempotente; máquina limpa: bash scripts/setup-engine-voices.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=eval/generated/tts-models
mkdir -p "$DIR"

# Piper pt-BR (piso de latência; GPL-3.0 código, card da voz no HF)
PIPER_SHA=858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7
if ! sha256sum -c <<<"$PIPER_SHA  $DIR/pt_BR-faber-medium.onnx" 2>/dev/null; then
  curl -sL -o "$DIR/pt_BR-faber-medium.onnx" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx"
  sha256sum -c <<<"$PIPER_SHA  $DIR/pt_BR-faber-medium.onnx"
fi
curl -sL -o "$DIR/pt_BR-faber-medium.onnx.json" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json"

# Venv dos sidecars (Pocket TTS PT + Piper; pesos Pocket via HF no 1º uso)
if [ ! -x .venv-tts/bin/python ]; then
  uv venv --python 3.12 .venv-tts
fi
uv pip install --python .venv-tts/bin/python --quiet \
  pocket-tts piper-tts flask

cat <<'EOF'
Pronto. Sidecars (terminais separados):
  .venv-tts/bin/pocket-tts serve --host 127.0.0.1 --port 8321 \
    --language portuguese --quantize
  .venv-tts/bin/python -m piper.http_server --host 127.0.0.1 --port 8331 \
    -m eval/generated/tts-models/pt_BR-faber-medium.onnx --length-scale 0.85
EOF
