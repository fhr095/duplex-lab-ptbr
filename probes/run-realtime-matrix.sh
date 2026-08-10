#!/bin/bash
# Matriz do Benchmark de Tetos v2 — Realtime
set -e
cd "$(dirname "$0")/.."
node --check probes/realtime-reference.mjs
for vad in semantic semantic-high server; do
  echo "== gpt-realtime-2.1-mini / $vad =="
  node probes/realtime-reference.mjs gpt-realtime-2.1-mini "$vad" | tail -1
done
echo "== gpt-realtime-2.1 / semantic =="
node probes/realtime-reference.mjs gpt-realtime-2.1 semantic | tail -1
