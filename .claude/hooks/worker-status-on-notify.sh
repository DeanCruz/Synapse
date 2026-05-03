#!/bin/bash
# worker-status-on-notify.sh — Notification hook
#
# Fires when a background agent sends a notification (typically on
# completion or failure).  Reads all progress files and returns a
# compact status summary so the master/chat agent always has
# up-to-date swarm visibility without needing SendMessage.
#
# Output: JSON message injected into the agent's context.

set -o pipefail

ok() { exit 0; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DASHBOARDS_DIR="$TRACKER_ROOT/dashboards"

# Find the active dashboard (most recently modified progress dir)
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
STALE_THRESHOLD=600

ACTIVE=0
COMPLETED=0
FAILED=0
STALE=0
TOTAL=0
STALE_IDS=""
FAILED_IDS=""
ACTIVE_DETAIL=""

for pf in "$PROGRESS_DIR"/*.json; do
  [ -f "$pf" ] || continue
  TOTAL=$((TOTAL + 1))

  TASK_ID=$(jq -r '.task_id // "?"' "$pf" 2>/dev/null)
  STATUS=$(jq -r '.status // "unknown"' "$pf" 2>/dev/null)
  STAGE=$(jq -r '.stage // "?"' "$pf" 2>/dev/null)
  AGENT=$(jq -r '.assigned_agent // "?"' "$pf" 2>/dev/null)
  MESSAGE=$(jq -r '.message // ""' "$pf" 2>/dev/null)

  FILE_MTIME=$(stat -f "%m" "$pf" 2>/dev/null || echo "0")
  SECONDS_AGO=$((NOW - FILE_MTIME))

  case "$STATUS" in
    in_progress)
      ACTIVE=$((ACTIVE + 1))
      if [ "$SECONDS_AGO" -gt "$STALE_THRESHOLD" ]; then
        STALE=$((STALE + 1))
        STALE_IDS="$STALE_IDS $TASK_ID"
      fi
      if [ "$SECONDS_AGO" -lt 60 ]; then AGO="${SECONDS_AGO}s";
      elif [ "$SECONDS_AGO" -lt 3600 ]; then AGO="$((SECONDS_AGO / 60))m";
      else AGO="$((SECONDS_AGO / 3600))h$((SECONDS_AGO % 3600 / 60))m"; fi
      ACTIVE_DETAIL="$ACTIVE_DETAIL [$TASK_ID] $AGENT stage=$STAGE updated=${AGO}-ago;"
      ;;
    completed) COMPLETED=$((COMPLETED + 1)) ;;
    failed)
      FAILED=$((FAILED + 1))
      FAILED_IDS="$FAILED_IDS $TASK_ID"
      ;;
  esac
done

# Build a compact one-line status + actionable hints
MSG="Swarm status ($DASHBOARD_ID): $COMPLETED completed, $ACTIVE active, $FAILED failed of $TOTAL dispatched."

if [ "$STALE" -gt 0 ]; then
  MSG="$MSG STALE:$STALE_IDS (no update in 10+ min — consider !retry)."
fi

if [ "$FAILED" -gt 0 ]; then
  MSG="$MSG FAILED:$FAILED_IDS."
fi

if [ -n "$ACTIVE_DETAIL" ]; then
  MSG="$MSG Active workers:$ACTIVE_DETAIL"
fi

MSG="$MSG To get full details run: bash agent/utils/check_workers.sh $DASHBOARD_ID"

echo "{\"message\":\"$MSG\"}"
exit 0
