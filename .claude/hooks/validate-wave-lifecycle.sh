#!/bin/bash
# validate-wave-lifecycle.sh — PreToolUse hook on Agent
#
# For lightweight (q_) swarms, enforces the wave task card lifecycle:
#   1. Before dispatching workers for wave N, the master MUST have written
#      progress/{wave_id}.json with status: "in_progress"
#   2. All waves before wave N MUST have status: "completed"
#
# This prevents the master from dispatching workers without properly updating
# task cards, ensuring the dashboard accurately reflects swarm state.
#
# Only activates for q_ swarms (agent IDs matching wave-{N} or s{N}-wave-{N}).
# Default: ALLOW on any error or unexpected input (fail-open).

set -o pipefail

allow() { echo '{"decision":"allow"}'; exit 0; }
block() { echo "{\"decision\":\"block\",\"reason\":\"$1\"}"; exit 0; }

command -v jq &>/dev/null || allow

INPUT=$(cat 2>/dev/null) || allow
[ -z "$INPUT" ] && allow

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DASHBOARDS_DIR="$TRACKER_ROOT/dashboards"

# Find the active q_ swarm dashboard (most recently modified initialization.json with wave-level IDs)
ACTIVE_DASH=""
BEST_MTIME=0
for init_file in "$DASHBOARDS_DIR"/*/initialization.json; do
  [ -f "$init_file" ] || continue

  IS_Q=$(jq '
    (.agents // []) | length > 0 and
    ([.[] | .id] | all(test("^(s[0-9]+-)?wave-[0-9]+$")))
  ' "$init_file" 2>/dev/null)
  [ "$IS_Q" != "true" ] && continue

  MTIME=$(stat -f "%m" "$init_file" 2>/dev/null) || continue
  if [ "$MTIME" -gt "$BEST_MTIME" ]; then
    BEST_MTIME=$MTIME
    ACTIVE_DASH=$(dirname "$init_file")
  fi
done

[ -z "$ACTIVE_DASH" ] && allow

# Skip stale swarms — only enforce on dashboards modified within the last 4 hours
NOW=$(date +%s)
FOUR_HOURS_AGO=$(( NOW - 14400 ))
if [ "$BEST_MTIME" -lt "$FOUR_HOURS_AGO" ]; then
  allow
fi

INIT_FILE="$ACTIVE_DASH/initialization.json"
PROGRESS_DIR="$ACTIVE_DASH/progress"
DASHBOARD_ID=$(basename "$ACTIVE_DASH")

WAVE_IDS=$(jq -r '[.agents // [] | .[] | .id] | .[]' "$INIT_FILE" 2>/dev/null)
[ -z "$WAVE_IDS" ] && allow

if [ ! -d "$PROGRESS_DIR" ]; then
  block "Wave lifecycle ($DASHBOARD_ID): progress directory does not exist. Before dispatching workers, write the wave progress file with status 'in_progress' to dashboards/$DASHBOARD_ID/progress/{wave_id}.json"
fi

# Find the first non-completed wave — it must be in_progress before any dispatch
FIRST_NON_COMPLETED=""
FIRST_STATUS=""
for wid in $WAVE_IDS; do
  PF="$PROGRESS_DIR/$wid.json"
  STATUS="pending"
  if [ -f "$PF" ]; then
    STATUS=$(jq -r '.status // "pending"' "$PF" 2>/dev/null)
  fi

  if [ "$STATUS" != "completed" ]; then
    FIRST_NON_COMPLETED="$wid"
    FIRST_STATUS="$STATUS"
    break
  fi
done

# All waves completed — swarm is done, allow any Agent call
[ -z "$FIRST_NON_COMPLETED" ] && allow

# The first non-completed wave must be in_progress before workers can be dispatched
if [ "$FIRST_STATUS" != "in_progress" ]; then
  block "Wave lifecycle ($DASHBOARD_ID): wave '$FIRST_NON_COMPLETED' has status '$FIRST_STATUS'. Before dispatching workers, you MUST write its progress file with status 'in_progress' to dashboards/$DASHBOARD_ID/progress/$FIRST_NON_COMPLETED.json. This is enforced for all !q_ commands — mark the task card in_progress first, then dispatch."
fi

allow
