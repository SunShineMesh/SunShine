#!/usr/bin/env bash
#
# MeshCredit — start everything in one terminal.
#   Treasury API  -> http://localhost:8787   (funds wallets on boot)
#   Web console   -> http://localhost:5173
#
# Usage:
#   ./start.sh            # start both; Ctrl+C stops both
#
# Default settlement is XRP (zero setup). To settle in the RLUSD stand-in IOU,
# run `npm run setup:stablecoin` once and add the printed lines to .env first.

# Always operate from this script's own directory (the meshcredit/ project root).
cd "$(cd "$(dirname "$0")" && pwd)" || exit 1

SERVER_PORT=8787
WEB_PORT=5173

# ---- helpers --------------------------------------------------------------

# Recursively kill a process and all of its descendants (npm -> node -> vite/tsx).
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null
}

# Free a TCP port if a leftover process is holding it (scoped to that port only).
free_port() {
  local port="$1" pid
  pid="$(lsof -ti "tcp:${port}" 2>/dev/null)"
  if [ -n "$pid" ]; then
    echo "  - port ${port} busy; freeing pid(s): ${pid}"
    echo "$pid" | xargs kill 2>/dev/null
    sleep 1
  fi
}

PIDS=()
SHUTTING_DOWN=0
cleanup() {
  [ "$SHUTTING_DOWN" = "1" ] && return
  SHUTTING_DOWN=1
  trap '' INT TERM
  echo ""
  echo "Shutting down MeshCredit..."
  for pid in "${PIDS[@]}"; do
    kill_tree "$pid"
  done
  wait 2>/dev/null
  echo "Stopped."
}
trap cleanup INT TERM EXIT

# ---- dependencies (install only if missing) -------------------------------

if [ ! -d node_modules ]; then
  echo "Installing root dependencies..."
  npm install || exit 1
fi
if [ ! -d web/node_modules ]; then
  echo "Installing web dependencies..."
  npm --prefix web install || exit 1
fi

# ---- launch ---------------------------------------------------------------

echo "Freeing ports if needed..."
free_port "$SERVER_PORT"
free_port "$WEB_PORT"

echo "Starting treasury API on :${SERVER_PORT} (funds wallets on boot)..."
npm run server &
PIDS+=($!)

echo "Starting web console on :${WEB_PORT}..."
npm --prefix web run dev &
PIDS+=($!)

echo ""
echo "=================================================="
echo "  MeshCredit is up:"
echo "    Service       ->  http://localhost:${SERVER_PORT}"
echo "    Console       ->  http://localhost:${WEB_PORT}"
echo "    How it works  ->  http://localhost:${WEB_PORT}/#/how-it-works"
echo ""
echo "  Logs from both processes interleave below."
echo "  Press Ctrl+C to stop both."
echo "=================================================="
echo ""

# Wait for both. If either exits, fall through to cleanup (which stops the other).
wait
