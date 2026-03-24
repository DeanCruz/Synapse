#!/bin/bash
# validate-log-entry.sh — PostToolUse hook on Write
# Validates that logs.json entries have required fields and valid level values.
# PostToolUse hooks cannot block (the write already happened), but can warn.
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

# Read stdin (tool input JSON)
INPUT=$(cat 2>/dev/null) || ok
if [ -z "$INPUT" ]; then
  ok
fi

# Extract file_path from tool_input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || ok
if [ -z "$FILE_PATH" ]; then
  ok
fi

# Only validate logs files
case "$FILE_PATH" in
  */logs.json) ;;
  *) ok ;;
esac

# Read the written file
if [ ! -f "$FILE_PATH" ]; then
  ok
fi

CONTENT=$(cat "$FILE_PATH" 2>/dev/null) || ok
if [ -z "$CONTENT" ]; then
  ok
fi

# Validate it's valid JSON
echo "$CONTENT" | jq empty 2>/dev/null || {
  warn "Warning: logs.json is not valid JSON"
}

# Extract the last entry from entries[] array
LAST_ENTRY=$(echo "$CONTENT" | jq '.entries[-1] // empty' 2>/dev/null) || ok
if [ -z "$LAST_ENTRY" ] || [ "$LAST_ENTRY" = "null" ]; then
  ok
fi

# Check required fields on the last entry
MISSING_FIELDS=""

TIMESTAMP=$(echo "$LAST_ENTRY" | jq -r '.timestamp // empty' 2>/dev/null)
if [ -z "$TIMESTAMP" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}timestamp, "
fi

TASK_ID=$(echo "$LAST_ENTRY" | jq -r '.task_id // empty' 2>/dev/null)
if [ -z "$TASK_ID" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}task_id, "
fi

AGENT=$(echo "$LAST_ENTRY" | jq -r '.agent // empty' 2>/dev/null)
if [ -z "$AGENT" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}agent, "
fi

LEVEL=$(echo "$LAST_ENTRY" | jq -r '.level // empty' 2>/dev/null)
if [ -z "$LEVEL" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}level, "
fi

MESSAGE=$(echo "$LAST_ENTRY" | jq -r '.message // empty' 2>/dev/null)
if [ -z "$MESSAGE" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}message, "
fi

if [ -n "$MISSING_FIELDS" ]; then
  # Remove trailing ", "
  MISSING_FIELDS="${MISSING_FIELDS%, }"
  warn "Warning: Last log entry in $FILE_PATH is missing required fields: $MISSING_FIELDS. Required: timestamp, task_id, agent, level (info|warn|error|deviation|permission|debug), message"
fi

# Validate level value
if [ -n "$LEVEL" ]; then
  case "$LEVEL" in
    info|warn|error|deviation|permission|debug) ;;
    *) warn "Warning: Log entry in $FILE_PATH has invalid level '$LEVEL'. Must be one of: info, warn, error, deviation, permission, debug" ;;
  esac
fi

ok
