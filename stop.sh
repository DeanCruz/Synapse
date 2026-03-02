#!/bin/bash
PID=$(lsof -ti :3456 -sTCP:LISTEN 2>/dev/null)
if [ -z "$PID" ]; then
  echo "Synapse is not running."
else
  kill $PID 2>/dev/null
  echo "Synapse stopped (PID $PID)."
fi
