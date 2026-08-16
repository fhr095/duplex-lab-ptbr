#!/bin/bash
# Ambiente Python do observador (.venv-obs): retranscrição forte offline.
# Os pesos do faster-whisper baixam no primeiro uso (~/.cache/huggingface).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  echo "uv não encontrado — instale (https://docs.astral.sh/uv/)" >&2
  exit 1
fi

[ -d .venv-obs ] || uv venv .venv-obs
uv pip install --python .venv-obs/bin/python -r requirements-obs.txt
echo "observador pronto: .venv-obs"
