#!/bin/bash
# Bateria de replays de regressão: reinjeta cada sessão gravada na engine
# atual (um processo por replay — um pacote por replay) e compara com a
# original. Uso: bash scripts/observador-replay-bateria.sh <pacote...>
set -uo pipefail
cd "$(dirname "$0")/.."

PORTA=4321
for ORIGEM in "$@"; do
  echo "=== replay de $ORIGEM ==="
  OBSERVER=1 PORT=$PORTA BRAIN_PROVIDER=local FAST_PATH=1 \
  ASR_FINAL_COMPUTE=fp32 ASR_FINAL_CONTEXT_MS=2500 \
  VAD_CONTROL=silero VAD_SHADOW=silero \
  SILERO_VAD_THRESHOLD=0.85 SILERO_VAD_ONSET_WINDOWS=1 \
  TTS_PROVIDER=pocket \
  OBSERVER_OBJETIVO="Replay de regressão de $ORIGEM" \
  node src/cli/serve.mjs >/tmp/replay-serve.log 2>&1 &
  SERVE=$!
  for _ in $(seq 1 60); do
    curl -sf -m 2 "http://127.0.0.1:$PORTA/api/health" >/dev/null 2>&1 \
      && break
    sleep 2
  done
  PACOTE=$(curl -s "http://127.0.0.1:$PORTA/api/health" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).observador.pasta))")
  node scripts/observador-replay.mjs --origem "$ORIGEM" \
    --url "ws://127.0.0.1:$PORTA/api/audio" || true
  kill -TERM "$SERVE" 2>/dev/null
  wait "$SERVE" 2>/dev/null
  node scripts/observador.mjs empacotar \
    --sessao "var/observador/$PACOTE" >/dev/null || true
  echo "--- comparação $ORIGEM × $PACOTE ---"
  node scripts/observador-replay-comparar.mjs \
    --original "$ORIGEM" --replay "var/observador/$PACOTE" || true
  echo
done
echo "BATERIA-COMPLETA"
