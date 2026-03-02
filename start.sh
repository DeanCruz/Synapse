#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

PID=$(lsof -ti :3456 -sTCP:LISTEN 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Synapse is already running (PID $PID). Stop it first with ./stop.sh"
  exit 1
fi

node "$DIR/src/server/index.js" "$@"
