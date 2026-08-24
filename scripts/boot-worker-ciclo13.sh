#!/usr/bin/env bash
# VALIDATE ciclo 14 — sobe um worker isolado com as vars passadas e espera o
# /api/status responder. Uso:
#   scripts/boot-worker-ciclo13.sh 8790 ARRAY_APP_KEY:xxx ARRAY_SERVER_TOKEN:yyy
# Imprime o PID na primeira linha (mate com `kill`).
set -u
PORT="$1"; shift
ARGS=()
for kv in "$@"; do ARGS+=(--var "$kv"); done
cd "$(dirname "$0")/.."/worker || exit 1
LOG="/tmp/wk-$PORT.log"
npx wrangler dev --local --port "$PORT" "${ARGS[@]}" > "$LOG" 2>&1 &
PID=$!
echo "$PID"
for i in $(seq 1 60); do
  if curl -s -m 2 "localhost:$PORT/api/health" > /dev/null 2>&1; then exit 0; fi
  sleep 1
done
echo "TIMEOUT subindo worker na porta $PORT (log: $LOG)" >&2
exit 1
