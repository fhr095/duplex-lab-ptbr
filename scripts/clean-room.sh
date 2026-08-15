#!/bin/bash
# Clean-room release gate (candidata v1): clone externo novo, instalação
# integral, arranque pelo PERFIL da candidata e doctor. Recibo por etapa.
# Branch por env: CLEANROOM_BRANCH (default engine/candidata-v1).
set -uo pipefail
ROOM="${1:-/tmp/claude-1000/engine-clean-room}"
BRANCH="${CLEANROOM_BRANCH:-engine/candidata-v1}"
RECEIPT="$ROOM/recibo.txt"
rm -rf "$ROOM"; mkdir -p "$ROOM"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RECEIPT"; }

log "clone ($BRANCH)…"
git clone --quiet --branch "$BRANCH" \
  https://github.com/fhr095/duplex-lab-ptbr.git "$ROOM/repo" \
  || { log "FALHA clone"; exit 1; }
cd "$ROOM/repo"
log "commit: $(git rev-parse --short HEAD)"

log "npm ci…"
npm ci --silent >>"$RECEIPT" 2>&1 || { log "FALHA npm ci"; exit 1; }
log "setup:asr…"
npm run setup:asr >>"$RECEIPT" 2>&1 || { log "FALHA setup:asr"; exit 1; }
log "setup:vad…"
npm run setup:vad >>"$RECEIPT" 2>&1 || { log "FALHA setup:vad"; exit 1; }
log "setup-engine-voices…"
bash scripts/setup-engine-voices.sh >>"$RECEIPT" 2>&1 \
  || { log "FALHA voices"; exit 1; }
log "setup-kroko…"
bash scripts/setup-kroko.sh >>"$RECEIPT" 2>&1 \
  || { log "FALHA kroko"; exit 1; }

cp "${ENV_SOURCE:-$HOME/work/duplex-lab-ptbr/.env}" .env \
  || { log "FALHA .env"; exit 1; }

log "start-candidata (perfil único; cérebro local p/ gate)…"
BRAIN_PROVIDER=local PORT=4199 bash scripts/start-candidata.sh \
  >>"$RECEIPT" 2>&1 &
ENGINE=$!
trap 'kill $ENGINE 2>/dev/null' EXIT

for _ in $(seq 1 120); do
  curl -sf -m 3 http://127.0.0.1:4199/api/health >/dev/null 2>&1 && break
  sleep 5
done

log "doctor…"
node scripts/engine-doctor.mjs --turns 4 \
  --url ws://127.0.0.1:4199/api/audio >>"$RECEIPT" 2>&1
DOCTOR=$?
log "doctor exit=$DOCTOR"
tail -3 "$RECEIPT"
[ "$DOCTOR" -eq 0 ] && log "CLEAN-ROOM VERDE" || log "CLEAN-ROOM FALHOU"
exit "$DOCTOR"
