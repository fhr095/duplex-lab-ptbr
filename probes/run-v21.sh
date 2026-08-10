#!/bin/bash
# Fechamento v2.1: matriz Realtime corrigida + Caminho A no mesmo ponto.
set -e
cd "$(dirname "$0")/.."
node --check probes/realtime-reference.mjs
node --check probes/ab-comparison.mjs
for cfg in "gpt-realtime-2.1-mini server" "gpt-realtime-2.1-mini semantic" \
           "gpt-realtime-2.1 semantic"; do
  echo "== $cfg =="
  node probes/realtime-reference.mjs $cfg | tail -1
done
echo "== caminho A (challenger-fast, mesmo ponto RMS) =="
node probes/ab-comparison.mjs challenger-fast 2>/dev/null | tail -1
