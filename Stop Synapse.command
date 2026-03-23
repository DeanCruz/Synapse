#!/bin/bash
# Stop Synapse — double-click this file on macOS to stop
# Opens in Terminal.app automatically

echo "================================================"
echo "  Stopping Synapse..."
echo "================================================"
echo ""

PID=$(lsof -ti :3456 -sTCP:LISTEN 2>/dev/null)
ELECTRON_PID=$(pgrep -f "Synapse.*electron" 2>/dev/null)

if [ -z "$PID" ] && [ -z "$ELECTRON_PID" ]; then
  echo "Synapse is not running."
  echo ""
  echo "Press any key to close..."
  read -n 1
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

echo ""
echo "Synapse stopped successfully."
echo ""
echo "Press any key to close..."
read -n 1
