#!/bin/bash
# nudge-progress-update.sh — PostToolUse hook on Edit
# Reminds workers to update their progress file after editing project code.
# Only fires when:
#   1. The edited file is a project file (not a Synapse internal file)
#   2. An active swarm exists (in_progress progress files found)
#   3. No progress file was updated in the last ~1 minute (avoids nagging
#      workers who are already diligently updating)
#
# The nudge is a lightweight PostToolUse message — non-blocking.

set -o pipefail

ok() { exit 0; }

# Ensure jq is available
if ! command -v jq &>/dev/null; then ok; fi

# Read stdin (tool input JSON)
INPUT=$(cat 2>/dev/null) || ok
[ -z "$INPUT" ] && ok

# Extract file_path from tool_input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || ok
[ -z "$FILE_PATH" ] && ok

# Resolve tracker root (two levels up from this script's location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Skip if editing a Synapse internal file (dashboards, agent, commands, etc.)
case "$FILE_PATH" in
  "$TRACKER_ROOT"/*) ok ;;
esac

# Skip if editing hidden config directories
case "$FILE_PATH" in
  */.claude/*|*/.git/*|*/.synapse/*) ok ;;
esac

# Quick exit: if no dashboards directory exists, no swarm is possible
[ -d "$TRACKER_ROOT/dashboards" ] || ok

# Check if any swarm is active (any in_progress progress file exists)
HAS_ACTIVE=false
for dir in "$TRACKER_ROOT"/dashboards/*/progress/; do
  [ -d "$dir" ] || continue
  for pf in "$dir"*.json; do
    [ -f "$pf" ] || continue
    PF_STATUS=$(jq -r '.status // empty' "$pf" 2>/dev/null)
    if [ "$PF_STATUS" = "in_progress" ]; then
      HAS_ACTIVE=true
      break 2
    fi
  done
done

$HAS_ACTIVE || ok

# Check if any progress file was updated within the last minute.
# If so, the worker is actively updating — no nudge needed.
RECENTLY_UPDATED=false
for dir in "$TRACKER_ROOT"/dashboards/*/progress/; do
  [ -d "$dir" ] || continue
  if [ -n "$(find "$dir" -name "*.json" -mmin -1 2>/dev/null | head -1)" ]; then
    RECENTLY_UPDATED=true
    break
  fi
done

$RECENTLY_UPDATED && ok

# Progress file is stale — nudge the worker
echo "{\"message\":\"📝 You edited a project file but haven't updated your progress file recently. Add a detailed log entry describing: what you changed, why, and the result. Keep your logs telling the full story.\"}"
exit 0
