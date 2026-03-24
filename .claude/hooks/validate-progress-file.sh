#!/bin/bash
# validate-progress-file.sh — PostToolUse hook on Write
# Validates that progress files have required fields and valid status values.
# PostToolUse hooks cannot block (the write already happened), but can warn.
#
# Default: silent on any error or unexpected input.

set -o pipefail

ok() {
  # PostToolUse: output nothing or a message
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

# Only validate progress files: */progress/*.json
case "$FILE_PATH" in
  */progress/*.json) ;;
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
  warn "Warning: Progress file $FILE_PATH is not valid JSON"
}

# Check required fields
MISSING_FIELDS=""

TASK_ID=$(echo "$CONTENT" | jq -r '.task_id // empty' 2>/dev/null)
if [ -z "$TASK_ID" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}task_id, "
fi

STATUS=$(echo "$CONTENT" | jq -r '.status // empty' 2>/dev/null)
if [ -z "$STATUS" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}status, "
fi

AGENT=$(echo "$CONTENT" | jq -r '.assigned_agent // empty' 2>/dev/null)
if [ -z "$AGENT" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}assigned_agent, "
fi

STAGE=$(echo "$CONTENT" | jq -r '.stage // empty' 2>/dev/null)
if [ -z "$STAGE" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}stage, "
fi

if [ -n "$MISSING_FIELDS" ]; then
  # Remove trailing ", "
  MISSING_FIELDS="${MISSING_FIELDS%, }"
  warn "Warning: Progress file $FILE_PATH is missing required fields: $MISSING_FIELDS"
fi

# Validate status value
if [ -n "$STATUS" ]; then
  case "$STATUS" in
    in_progress|completed|failed) ;;
    *) warn "Warning: Progress file $FILE_PATH has invalid status '$STATUS'. Must be: in_progress, completed, or failed" ;;
  esac
fi

ok
