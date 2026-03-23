#!/bin/bash
# Start Synapse — double-click this file on macOS to launch
# Opens in Terminal.app automatically

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "================================================"
echo "  Starting Synapse..."
echo "================================================"
echo ""

PID=$(lsof -ti :3456 -sTCP:LISTEN 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Synapse is already running (PID $PID)."
  echo "Stop it first with 'Stop Synapse.command' or ./stop.sh"
  echo ""
  echo "Press any key to close..."
  read -n 1
  exit 1
fi

cd "$DIR" && npm start
