#!/bin/bash
# validate-initialization-immutable.sh — PreToolUse hook on Edit|Write
# Blocks unauthorized modifications to initialization.json that change task.name
# after its initial creation. The initialization file is write-once for task identity.
#
# Event:   PreToolUse
# Matcher: Edit|Write
# Action:  BLOCK on task.name mutation, ALLOW otherwise
# Default: ALLOW on any error or unexpected input (fail-open)

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

# -------------------------------------------------------------------
# Fail-open: if jq is not available, allow everything
# -------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
  allow
fi

# -------------------------------------------------------------------
# Read stdin (tool input JSON from Claude)
# -------------------------------------------------------------------
INPUT=$(cat 2>/dev/null) || allow
if [ -z "$INPUT" ]; then
  allow
fi

# -------------------------------------------------------------------
# Extract file_path from tool_input
# -------------------------------------------------------------------
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || allow
if [ -z "$FILE_PATH" ]; then
  allow
fi

# -------------------------------------------------------------------
# Only care about files matching */initialization.json
# -------------------------------------------------------------------
case "$FILE_PATH" in
  */initialization.json) ;;  # This is an initialization file — continue checking
  *) allow ;;
esac

# -------------------------------------------------------------------
# If the file doesn't exist yet, this is the first write — always allow
# -------------------------------------------------------------------
if [ ! -f "$FILE_PATH" ]; then
  allow
fi

# -------------------------------------------------------------------
# File exists — read current task.name from disk
# -------------------------------------------------------------------
EXISTING_TASK_NAME=$(jq -r '.task.name // empty' "$FILE_PATH" 2>/dev/null) || allow

# If existing file has no task.name set, allow (nothing to protect yet)
if [ -z "$EXISTING_TASK_NAME" ]; then
  allow
fi

# -------------------------------------------------------------------
# Determine the tool being used (Edit vs Write)
# -------------------------------------------------------------------
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null) || allow

# -------------------------------------------------------------------
# For Edit tool: ALLOW
# Edits to initialization.json are typically legitimate — repair tasks,
# dependency rewiring, agent assignment updates, etc.
# -------------------------------------------------------------------
if [ "$TOOL_NAME" != "Write" ]; then
  allow
fi

# -------------------------------------------------------------------
# For Write tool: parse the new content and check if task.name changed
# -------------------------------------------------------------------
NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null) || allow
if [ -z "$NEW_CONTENT" ]; then
  allow
fi

# Parse the new content as JSON and extract task.name
NEW_TASK_NAME=$(echo "$NEW_CONTENT" | jq -r '.task.name // empty' 2>/dev/null) || allow

# If we can't extract a task.name from the new content, allow
# (might be a non-JSON write or a structural change we can't parse)
if [ -z "$NEW_TASK_NAME" ]; then
  allow
fi

# -------------------------------------------------------------------
# Compare: if task.name is different, BLOCK
# -------------------------------------------------------------------
if [ "$EXISTING_TASK_NAME" != "$NEW_TASK_NAME" ]; then
  block "initialization.json is write-once — task.name cannot change after planning. Existing: '${EXISTING_TASK_NAME}', attempted: '${NEW_TASK_NAME}'. Only repair tasks, circuit breaker replanning, and !add_task may modify this file (preserving task.name)."
fi

# task.name is preserved — allow the write
allow
