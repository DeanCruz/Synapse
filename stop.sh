#!/bin/bash
# Stop the Electron app and server
PID=$(lsof -ti :3456 -sTCP:LISTEN 2>/dev/null)
ELECTRON_PID=$(pgrep -f "Synapse.*electron" 2>/dev/null)

if [ -z "$PID" ] && [ -z "$ELECTRON_PID" ]; then
  echo "Synapse is not running."
  exit 0
fi

if [ -n "$ELECTRON_PID" ]; then
  kill $ELECTRON_PID 2>/dev/null
  echo "Synapse Electron app stopped (PID $ELECTRON_PID)."
fi

if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  echo "Synapse server stopped (PID $PID)."
fi
