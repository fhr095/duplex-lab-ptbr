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
JSON_SHA=7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f
if ! sha256sum -c <<<"$JSON_SHA  $DIR/pt_BR-faber-medium.onnx.json" 2>/dev/null; then
  curl -sL -o "$DIR/pt_BR-faber-medium.onnx.json" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json"
  sha256sum -c <<<"$JSON_SHA  $DIR/pt_BR-faber-medium.onnx.json"
fi

# Venv dos sidecars — versões congeladas (requirements-tts.txt).
# Pesos do Pocket: baixados pelo pacote no 1º uso a partir do HF; a versão
# efetiva dos pesos é a publicada para pocket-tts==2.1.0 (o pacote resolve
# o repo/revision compatível; upgrade só com mudança deliberada do pin).
if [ ! -x .venv-tts/bin/python ]; then
  uv venv --python 3.12 .venv-tts
fi
uv pip install --python .venv-tts/bin/python --quiet \
  -r requirements-tts.txt

# Supertonic-3 (voz da candidata v1; MIT+OpenRAIL-M com cláusula de
# disclosure — o lede da página declara voz sintética). O pip supertonic
# 1.3.1 pina a revisão dos pesos; o cache ~/.cache/supertonic3 é
# compartilhado com o exp-0019 — auto_download fica DESLIGADO no sidecar
# (ver scripts/tts-sidecar-supertonic.py) para nunca clobberar o cache.
if [ ! -x .venv-teste-supertonic/bin/python ]; then
  uv venv --python 3.12 .venv-teste-supertonic
fi
uv pip install --python .venv-teste-supertonic/bin/python --quiet \
  "supertonic==1.3.1" soundfile
.venv-teste-supertonic/bin/python - <<'PY'
import os
os.environ.setdefault("HF_HUB_OFFLINE", "0")
cache = os.path.expanduser("~/.cache/supertonic3")
if not os.path.isdir(cache):
    from supertonic import TTS
    TTS(model="supertonic-3", auto_download=True)
    print("pesos do supertonic baixados")
else:
    print("cache do supertonic já presente (não tocado)")
PY

cat <<'EOF'
Pronto. Sidecars (terminais separados; start-engine.sh sobe sozinho o do
TTS_PROVIDER escolhido):
  .venv-teste-supertonic/bin/python scripts/tts-sidecar-supertonic.py \
    --host 127.0.0.1 --port 8341
  .venv-tts/bin/pocket-tts serve --host 127.0.0.1 --port 8321 \
    --language portuguese --quantize
  .venv-tts/bin/python -m piper.http_server --host 127.0.0.1 --port 8331 \
    -m eval/generated/tts-models/pt_BR-faber-medium.onnx --length-scale 0.85
EOF
