#!/bin/bash
# verify-final-report.sh — Stop hook
# Checks if an active swarm exists without a completion report.
# Stop hooks should warn, not block.
#
# Default: silent on any error or unexpected input.

set -o pipefail

ok() {
  exit 0
}

warn() {
  local msg="$1"
  echo "{\"message\":\"$msg\"}"
  exit 0
}

# Ensure jq is available
if ! command -v jq &>/dev/null; then
  ok
fi

# Determine tracker root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Check all non-ide dashboards for active swarms
for init_file in "$TRACKER_ROOT"/dashboards/*/initialization.json; do
  [ -f "$init_file" ] || continue

  DASH_DIR=$(dirname "$init_file")
  DASH_ID=$(basename "$DASH_DIR")

  # Skip ide dashboard
  if [ "$DASH_ID" = "ide" ]; then
    continue
  fi

  # Check if this dashboard has an active task (task is an object, not null)
  TASK_EXISTS=$(jq -r 'if .task != null and (.task | type) != "null" then "yes" else "no" end' "$init_file" 2>/dev/null) || continue
  if [ "$TASK_EXISTS" != "yes" ]; then
    continue
  fi
  TASK_NAME=$(jq -r '.task.name // "unknown"' "$init_file" 2>/dev/null) || TASK_NAME="unknown"

  # Active swarm found — check logs.json for completion
  LOGS_FILE="$DASH_DIR/logs.json"
  if [ ! -f "$LOGS_FILE" ]; then
    warn "Warning: Active swarm '$TASK_NAME' on dashboard '$DASH_ID' has no logs.json file. Swarm may not have a completion report."
    ok
  fi

  # Check if logs contain a completion message
  HAS_COMPLETION=$(jq -r '
    if type == "array" then
      [.[] | select(.msg // .message | test("(?i)(swarm complete|all tasks completed|swarm finished|completion report)"))] | length > 0
    else
      false
    end
  ' "$LOGS_FILE" 2>/dev/null) || continue

  if [ "$HAS_COMPLETION" != "true" ]; then
    warn "Warning: Active swarm '$TASK_NAME' on dashboard '$DASH_ID' detected without completion report. Consider running !status or completing the swarm before exiting."
    ok
  fi
done

ok
