#!/bin/bash
# validate-master-state.sh — PostToolUse hook on Write
# Validates that master_state.json has required fields and correct types.
# A malformed checkpoint makes compaction recovery impossible.
# PostToolUse hooks cannot block (the write already happened), but can warn.
#
# Default: silent on any error or unexpected input.

set -o pipefail

ok() {
  # PostToolUse: output nothing
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

# Only validate master_state.json files
case "$FILE_PATH" in
  */master_state.json) ;;
  *) ok ;;
esac

# Read the written file from disk
if [ ! -f "$FILE_PATH" ]; then
  ok
fi

CONTENT=$(cat "$FILE_PATH" 2>/dev/null) || ok
if [ -z "$CONTENT" ]; then
  ok
fi

# Validate it's valid JSON
echo "$CONTENT" | jq empty 2>/dev/null || {
  warn "Warning: master_state.json is not valid JSON"
}

# Check required fields are present
MISSING_FIELDS=""

LAST_UPDATED=$(echo "$CONTENT" | jq -r '.last_updated // empty' 2>/dev/null)
if [ -z "$LAST_UPDATED" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}last_updated, "
fi

HAS_COMPLETED=$(echo "$CONTENT" | jq -r 'if has("completed") then "yes" else "no" end' 2>/dev/null)
if [ "$HAS_COMPLETED" != "yes" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}completed, "
fi

HAS_IN_PROGRESS=$(echo "$CONTENT" | jq -r 'if has("in_progress") then "yes" else "no" end' 2>/dev/null)
if [ "$HAS_IN_PROGRESS" != "yes" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}in_progress, "
fi

HAS_FAILED=$(echo "$CONTENT" | jq -r 'if has("failed") then "yes" else "no" end' 2>/dev/null)
if [ "$HAS_FAILED" != "yes" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}failed, "
fi

HAS_UPSTREAM=$(echo "$CONTENT" | jq -r 'if has("upstream_results") then "yes" else "no" end' 2>/dev/null)
if [ "$HAS_UPSTREAM" != "yes" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}upstream_results, "
fi

HAS_NEXT_AGENT=$(echo "$CONTENT" | jq -r 'if has("next_agent_number") then "yes" else "no" end' 2>/dev/null)
if [ "$HAS_NEXT_AGENT" != "yes" ]; then
  MISSING_FIELDS="${MISSING_FIELDS}next_agent_number, "
fi

if [ -n "$MISSING_FIELDS" ]; then
  # Remove trailing ", "
  MISSING_FIELDS="${MISSING_FIELDS%, }"
  warn "Warning: master_state.json at $FILE_PATH is missing required fields: $MISSING_FIELDS. Required: last_updated, completed (array), in_progress (array), failed (array), upstream_results (object), next_agent_number (number > 0)"
fi

# Type validation for fields that are present

# completed must be an array
if [ "$HAS_COMPLETED" = "yes" ]; then
  COMPLETED_TYPE=$(echo "$CONTENT" | jq -r '.completed | type' 2>/dev/null)
  if [ "$COMPLETED_TYPE" != "array" ]; then
    warn "Warning: master_state.json field 'completed' has wrong type. Expected array, got $COMPLETED_TYPE"
  fi
fi

# in_progress must be an array
if [ "$HAS_IN_PROGRESS" = "yes" ]; then
  IN_PROGRESS_TYPE=$(echo "$CONTENT" | jq -r '.in_progress | type' 2>/dev/null)
  if [ "$IN_PROGRESS_TYPE" != "array" ]; then
    warn "Warning: master_state.json field 'in_progress' has wrong type. Expected array, got $IN_PROGRESS_TYPE"
  fi
fi

# failed must be an array
if [ "$HAS_FAILED" = "yes" ]; then
  FAILED_TYPE=$(echo "$CONTENT" | jq -r '.failed | type' 2>/dev/null)
  if [ "$FAILED_TYPE" != "array" ]; then
    warn "Warning: master_state.json field 'failed' has wrong type. Expected array, got $FAILED_TYPE"
  fi
fi

# upstream_results must be an object
if [ "$HAS_UPSTREAM" = "yes" ]; then
  UPSTREAM_TYPE=$(echo "$CONTENT" | jq -r '.upstream_results | type' 2>/dev/null)
  if [ "$UPSTREAM_TYPE" != "object" ]; then
    warn "Warning: master_state.json field 'upstream_results' has wrong type. Expected object, got $UPSTREAM_TYPE"
  fi
fi

# next_agent_number must be a number > 0
if [ "$HAS_NEXT_AGENT" = "yes" ]; then
  NEXT_AGENT_TYPE=$(echo "$CONTENT" | jq -r '.next_agent_number | type' 2>/dev/null)
  if [ "$NEXT_AGENT_TYPE" != "number" ]; then
    warn "Warning: master_state.json field 'next_agent_number' has wrong type. Expected number, got $NEXT_AGENT_TYPE"
  else
    NEXT_AGENT_VAL=$(echo "$CONTENT" | jq -r '.next_agent_number' 2>/dev/null)
    IS_POSITIVE=$(echo "$CONTENT" | jq -r 'if .next_agent_number > 0 then "yes" else "no" end' 2>/dev/null)
    if [ "$IS_POSITIVE" != "yes" ]; then
      warn "Warning: master_state.json field 'next_agent_number' has wrong type. Expected number > 0, got $NEXT_AGENT_VAL"
    fi
  fi
fi

# last_updated must be a string (ISO 8601 timestamp)
if [ -n "$LAST_UPDATED" ]; then
  LAST_UPDATED_TYPE=$(echo "$CONTENT" | jq -r '.last_updated | type' 2>/dev/null)
  if [ "$LAST_UPDATED_TYPE" != "string" ]; then
    warn "Warning: master_state.json field 'last_updated' has wrong type. Expected string, got $LAST_UPDATED_TYPE"
  fi
fi

ok
