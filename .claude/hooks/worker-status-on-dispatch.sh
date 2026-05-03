#!/bin/bash
# worker-status-on-dispatch.sh — PostToolUse hook on Agent tool
#
# Fires after the master dispatches a worker via the Agent tool.
# Returns a compact status of all workers so the master always has
# full swarm visibility after every dispatch action.

set -o pipefail

ok() { exit 0; }

# Read stdin (tool input JSON from Claude Code)
INPUT=$(cat 2>/dev/null) || ok
[ -z "$INPUT" ] && ok

# Only fire for background agents (worker dispatches)
IS_BG=$(echo "$INPUT" | jq -r '.tool_input.run_in_background // false' 2>/dev/null)
[ "$IS_BG" != "true" ] && ok

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DASHBOARDS_DIR="$TRACKER_ROOT/dashboards"

# Find the active dashboard
BEST_DIR=""
BEST_MTIME=0
for dir in "$DASHBOARDS_DIR"/*/; do
  [ -d "${dir}progress" ] || continue
  NEWEST=$(find "${dir}progress" -name "*.json" -type f -exec stat -f "%m" {} \; 2>/dev/null | sort -rn | head -1)
  [ -z "$NEWEST" ] && continue
  if [ "$NEWEST" -gt "$BEST_MTIME" ]; then
    BEST_MTIME=$NEWEST
    BEST_DIR="$dir"
  fi
done

[ -z "$BEST_DIR" ] && ok

DASHBOARD_ID=$(basename "$BEST_DIR")
PROGRESS_DIR="$BEST_DIR/progress"
[ -d "$PROGRESS_DIR" ] || ok

if ! command -v jq &>/dev/null; then ok; fi

NOW=$(date +%s)
ACTIVE=0
COMPLETED=0
FAILED=0
TOTAL=0
SUMMARY=""

for pf in "$PROGRESS_DIR"/*.json; do
  [ -f "$pf" ] || continue
  TOTAL=$((TOTAL + 1))
  STATUS=$(jq -r '.status // "unknown"' "$pf" 2>/dev/null)
  case "$STATUS" in
    in_progress) ACTIVE=$((ACTIVE + 1)) ;;
    completed) COMPLETED=$((COMPLETED + 1)) ;;
    failed) FAILED=$((FAILED + 1)) ;;
  esac
done

MSG="Worker dispatched. Swarm ($DASHBOARD_ID): $COMPLETED/$TOTAL completed, $ACTIVE active, $FAILED failed. Run 'bash agent/utils/check_workers.sh' for full status."

echo "{\"message\":\"$MSG\"}"
exit 0
