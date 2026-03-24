#!/bin/bash
# validate-archive-before-clear.sh — PreToolUse hook on Bash
# Blocks `rm` commands targeting dashboard progress directories unless
# the dashboard data has been archived first.
#
# Default: ALLOW on any error or unexpected input.

set -o pipefail

allow() {
  echo '{"decision":"allow"}'
  exit 0
}

block() {
  local reason="$1"
  echo "{\"decision\":\"block\",\"reason\":\"$reason\"}"
  exit 0
}

# Ensure jq is available
if ! command -v jq &>/dev/null; then
  allow
fi

# Read stdin (tool input JSON)
INPUT=$(cat 2>/dev/null) || allow
if [ -z "$INPUT" ]; then
  allow
fi

# Extract command from tool_input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || allow
if [ -z "$COMMAND" ]; then
  allow
fi

# Only check commands that contain "rm" and target dashboard progress
case "$COMMAND" in
  *rm*dashboards/*/progress*) ;;
  *rm*dashboards/*) ;;
  *) allow ;;
esac

# Determine tracker root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Try to extract dashboard ID from the command
# Look for patterns like dashboards/XXXXX or dashboards/dashboardN
DASH_ID=""
if echo "$COMMAND" | grep -qoE 'dashboards/[a-zA-Z0-9_]+' 2>/dev/null; then
  DASH_ID=$(echo "$COMMAND" | grep -oE 'dashboards/[a-zA-Z0-9_]+' | head -1 | sed 's|dashboards/||')
fi

if [ -z "$DASH_ID" ]; then
  allow
fi

# Skip ide dashboard — it's permanent and doesn't need archiving
if [ "$DASH_ID" = "ide" ]; then
  allow
fi

# Check if this dashboard has an active swarm (initialization.json with task)
INIT_FILE="$TRACKER_ROOT/dashboards/$DASH_ID/initialization.json"
if [ ! -f "$INIT_FILE" ]; then
  allow
fi

TASK_EXISTS=$(jq -r 'if .task != null and (.task | type) != "null" then "yes" else "no" end' "$INIT_FILE" 2>/dev/null) || allow
if [ "$TASK_EXISTS" != "yes" ]; then
  # No active task, safe to clear
  allow
fi
TASK_NAME=$(jq -r '.task.name // .task // "unknown"' "$INIT_FILE" 2>/dev/null) || TASK_NAME="unknown"

# Check if Archive/ has a directory for this swarm
# Look for any directory in Archive/ that contains the task name or dashboard ID
ARCHIVE_DIR="$TRACKER_ROOT/Archive"
if [ ! -d "$ARCHIVE_DIR" ]; then
  block "Archive dashboard data before clearing. No Archive/ directory found. Use: cp -r $TRACKER_ROOT/dashboards/$DASH_ID/* $ARCHIVE_DIR/\$(date +%Y-%m-%d)_${TASK_NAME}/"
fi

# Check if any archive directory matches this dashboard/task
FOUND_ARCHIVE=false
for dir in "$ARCHIVE_DIR"/*/; do
  [ -d "$dir" ] || continue
  DIR_NAME=$(basename "$dir")
  # Check if directory name contains the task name or dashboard ID
  if echo "$DIR_NAME" | grep -qi "$DASH_ID" 2>/dev/null; then
    FOUND_ARCHIVE=true
    break
  fi
  # Sanitize task name for comparison (replace spaces with underscores, etc.)
  SANITIZED_TASK=$(echo "$TASK_NAME" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')
  SANITIZED_DIR=$(echo "$DIR_NAME" | tr '[:upper:]' '[:lower:]')
  if echo "$SANITIZED_DIR" | grep -qi "$SANITIZED_TASK" 2>/dev/null; then
    FOUND_ARCHIVE=true
    break
  fi
done

if [ "$FOUND_ARCHIVE" = true ]; then
  allow
fi

# No archive found — block
block "Archive dashboard data before clearing. Use: cp -r $TRACKER_ROOT/dashboards/$DASH_ID/* $TRACKER_ROOT/Archive/\$(date +%Y-%m-%d)_task_name/"
