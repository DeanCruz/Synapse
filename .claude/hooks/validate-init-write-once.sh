#!/bin/bash
# validate-init-write-once.sh — PreToolUse hook on Write
# Enforces write-once semantics on initialization.json files.
# Once initialization.json has task != null, it cannot be overwritten
# except for repair tasks or total_tasks increments.
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

# Extract file_path from tool_input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || allow
if [ -z "$FILE_PATH" ]; then
  allow
fi

# Only check initialization.json files
case "$FILE_PATH" in
  */initialization.json) ;;
  *) allow ;;
esac

# If the file doesn't exist yet, allow (first write)
if [ ! -f "$FILE_PATH" ]; then
  allow
fi

# Read existing file
EXISTING=$(cat "$FILE_PATH" 2>/dev/null) || allow
if [ -z "$EXISTING" ]; then
  allow
fi

# Check if existing file has a non-null task (task is an object when set)
EXISTING_HAS_TASK=$(echo "$EXISTING" | jq -r 'if .task != null and (.task | type) != "null" then "yes" else "no" end' 2>/dev/null) || allow
if [ "$EXISTING_HAS_TASK" != "yes" ]; then
  # No task set yet — allow the write
  allow
fi

# File already has task set. Check if the new content is an allowed exception.
NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null) || allow
if [ -z "$NEW_CONTENT" ]; then
  # Can't read new content — allow to be safe
  allow
fi

# Exception 1: Repair task — check if any agent ID in the new content has "r" suffix
# Look at the tasks array for repair indicators
HAS_REPAIR=$(echo "$NEW_CONTENT" | jq -r '
  if .tasks then
    [.tasks[] | select(.id | test("r$"))] | length > 0
  else
    false
  end
' 2>/dev/null) || allow

if [ "$HAS_REPAIR" = "true" ]; then
  allow
fi

# Exception 2: total_tasks increment (may be at top level or inside .task)
EXISTING_TOTAL=$(echo "$EXISTING" | jq -r '.task.total_tasks // .total_tasks // 0' 2>/dev/null) || allow
NEW_TOTAL=$(echo "$NEW_CONTENT" | jq -r '.task.total_tasks // .total_tasks // 0' 2>/dev/null) || allow

if [ "$NEW_TOTAL" -gt "$EXISTING_TOTAL" ] 2>/dev/null; then
  allow
fi

# No exception matched — block
block "initialization.json is write-once after task is set. Use repair tasks or add_task for modifications."
