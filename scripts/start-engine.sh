#!/bin/bash
# Engine RC v0.1 — arranque supervisionado: sidecars + servidor, com espera
# de health real. Encerra os sidecars ao sair (trap).
set -euo pipefail
cd "$(dirname "$0")/.."

PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_http() { # url, tentativas
  for _ in $(seq 1 "$2"); do
    curl -sf -m 3 "$1" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "health falhou: $1" >&2; return 1
}

if [ "${TTS_PROVIDER:-pocket}" = "pocket" ]; then
  .venv-tts/bin/pocket-tts serve --host 127.0.0.1 --port 8321 \
    --language portuguese --quantize >/tmp/pocket-tts.log 2>&1 &
  PIDS+=($!)
  echo "aguardando Pocket TTS (carrega ~1-2min no 1º uso)…"
  wait_http http://127.0.0.1:8321/health 90
elif [ "${TTS_PROVIDER:-}" = "piper" ]; then
  .venv-tts/bin/python -m piper.http_server --host 127.0.0.1 --port 8331 \
    -m eval/generated/tts-models/pt_BR-faber-medium.onnx \
    --length-scale 0.85 >/tmp/piper-tts.log 2>&1 &
  PIDS+=($!)
  wait_http http://127.0.0.1:8331/ 30
fi

FAST_PATH="${FAST_PATH:-1}" \
TTS_PROVIDER="${TTS_PROVIDER:-pocket}" \
BRAIN_PROVIDER="${BRAIN_PROVIDER:-openai}" \
OPENAI_INTERACTION_MODEL="${OPENAI_INTERACTION_MODEL:-gpt-5.4-mini}" \
OPENAI_TASK_MODEL="${OPENAI_TASK_MODEL:-gpt-5.6-luna}" \
VAD_CONTROL=silero VAD_SHADOW=silero \
SILERO_VAD_THRESHOLD=0.85 SILERO_VAD_ONSET_WINDOWS=1 \
node src/cli/serve.mjs
