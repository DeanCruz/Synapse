#!/bin/bash
# validate-worker-prompt.sh — PreToolUse hook on Task
# Blocks worker dispatch prompts that are missing required sections.
# Prompt quality is the #1 determinant of worker success — this hook
# ensures every dispatched worker gets the metadata it needs.
#
# Template versions:
#   p_track_v2 — Full set: 8 required sections (dashboard tracking)
#   p_v2       — Reduced set: 5 required sections (no progress file)
#
# Default: ALLOW on any error or unexpected input (fail-open).

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

# Read stdin (tool input JSON from Claude Code hook system)
INPUT=$(cat 2>/dev/null) || allow
if [ -z "$INPUT" ]; then
  allow
fi

# Extract the prompt field from tool_input (Task tool's prompt parameter)
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // empty' 2>/dev/null) || allow
if [ -z "$PROMPT" ]; then
  allow
fi

# If the prompt does NOT contain TEMPLATE_VERSION:, this is not a worker
# dispatch — it's a regular Task call (research, exploration, etc.)
if ! echo "$PROMPT" | grep -q "TEMPLATE_VERSION:"; then
  allow
fi

# Determine which template version we're validating
MISSING=""

if echo "$PROMPT" | grep -q "TEMPLATE_VERSION: p_track_v2"; then
  # Full set: 8 required sections for dashboard-tracked workers
  echo "$PROMPT" | grep -q "YOUR PROGRESS FILE:" || MISSING="${MISSING}YOUR PROGRESS FILE:, "
  echo "$PROMPT" | grep -q "YOUR TASK ID:"        || MISSING="${MISSING}YOUR TASK ID:, "
  echo "$PROMPT" | grep -q "YOUR AGENT LABEL:"    || MISSING="${MISSING}YOUR AGENT LABEL:, "
  echo "$PROMPT" | grep -q "RETURN FORMAT"         || MISSING="${MISSING}RETURN FORMAT, "
  echo "$PROMPT" | grep -q "PROJECT ROOT:"         || MISSING="${MISSING}PROJECT ROOT:, "
  echo "$PROMPT" | grep -q "TRACKER ROOT:"         || MISSING="${MISSING}TRACKER ROOT:, "
  echo "$PROMPT" | grep -q "INSTRUCTION MODE:"     || MISSING="${MISSING}INSTRUCTION MODE:, "

elif echo "$PROMPT" | grep -q "TEMPLATE_VERSION: p_v2"; then
  # Reduced set: 5 required sections (no progress-file-related fields)
  echo "$PROMPT" | grep -q "RETURN FORMAT"     || MISSING="${MISSING}RETURN FORMAT, "
  echo "$PROMPT" | grep -q "PROJECT ROOT:"     || MISSING="${MISSING}PROJECT ROOT:, "
  echo "$PROMPT" | grep -q "TRACKER ROOT:"     || MISSING="${MISSING}TRACKER ROOT:, "
  echo "$PROMPT" | grep -q "INSTRUCTION MODE:" || MISSING="${MISSING}INSTRUCTION MODE:, "

else
  # Unknown template version — allow (fail-open)
  allow
fi

# If nothing is missing, allow
if [ -z "$MISSING" ]; then
  allow
fi

# Remove trailing ", "
MISSING="${MISSING%, }"

block "Worker dispatch prompt is missing required sections: ${MISSING}. All worker prompts must include these for proper tracking and reporting."
