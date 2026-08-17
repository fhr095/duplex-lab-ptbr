#!/bin/bash
# Bancada de FUNDOS COMPETINDO: repete a MESMA janela de um pacote
# gravado sob fundos contínuos diferentes (limpa + música real +
# burburinho PT + ruído rosa), em engine DESCARTÁVEL na 4321 com BRAIN
# local — mede o dano de captação por fundo e alimenta a calibração da
# cena. Roda sobre qualquer teste novo sem regravar nada.
#
#   bash scripts/observador-replay-fundos.sh <pacote> <desde> <ate> [snr]
#   ex.: bash scripts/observador-replay-fundos.sh \
#          var/observador/2026-08-16-18-33-30-685b 7086 7180 5
#
# Limite honesto (ver cabeçalho do observador-replay.mjs): soma digital
# não simula AGC/AEC do navegador, reverberação, ducking nem Lombard —
# bancada de estresse da cadeia de escuta, não experiência completa.
set -uo pipefail
cd "$(dirname "$0")/.."

PACOTE="${1:?uso: <pacote> <desde> <ate> [snr]}"
DESDE="${2:?falta <desde>}"
ATE="${3:?falta <ate>}"
SNR="${4:-5}"
PORTA=4321
MUSICA="var/fora-do-corpus/2026-08-16-e2c0-mic3/mic-3.raw"
FUNDOS_DIR="var/observador/testes/cena/fundos"

if [ ! -f "$FUNDOS_DIR/burburinho-coraa.raw" ]; then
  node scripts/gerar-fundos-cena.mjs
fi

OBSERVER=1 PORT=$PORTA BRAIN_PROVIDER=local FAST_PATH=1 \
ASR_PARTIAL_ENGINE=kroko \
VAD_CONTROL=silero VAD_SHADOW=silero \
SILERO_VAD_THRESHOLD=0.85 SILERO_VAD_ONSET_WINDOWS=1 \
TTS_PROVIDER=pocket \
OBSERVER_OBJETIVO="Bancada de fundos: $PACOTE $DESDE-$ATE snr=$SNR" \
node src/cli/serve.mjs >/tmp/replay-fundos-serve.log 2>&1 &
SERVE=$!
for _ in $(seq 1 60); do
  curl -sf -m 2 "http://127.0.0.1:$PORTA/api/health" >/dev/null 2>&1 \
    && break
  sleep 2
done

rodar() {
  echo "=== $1 ==="
  shift
  node scripts/observador-replay.mjs --origem "$PACOTE" \
    --desde "$DESDE" --ate "$ATE" \
    --url "ws://127.0.0.1:$PORTA/api/audio" "$@" || true
  echo
}

rodar "SEM FUNDO (referência)"
if [ -f "$MUSICA" ]; then
  rodar "MÚSICA REAL (snr $SNR dB)" --fundo "$MUSICA" --fundo-offset 120 --snr "$SNR"
fi
rodar "BURBURINHO PT (snr $SNR dB)" --fundo "$FUNDOS_DIR/burburinho-coraa.raw" --snr "$SNR"
rodar "RUÍDO ROSA (snr $SNR dB)" --fundo "$FUNDOS_DIR/ruido-rosa.raw" --snr "$SNR"

kill -TERM "$SERVE" 2>/dev/null
wait "$SERVE" 2>/dev/null
echo "BANCADA-DE-FUNDOS-COMPLETA (logs da engine em /tmp/replay-fundos-serve.log)"
