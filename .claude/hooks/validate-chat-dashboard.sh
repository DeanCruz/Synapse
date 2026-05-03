#!/bin/bash
# validate-chat-dashboard.sh — PostToolUse hook on Write
# Warns when a chat agent writes to a dashboard other than its assigned one.
# PostToolUse hooks cannot block — they only warn.

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

# Only check writes to dashboards/ directories
case "$FILE_PATH" in
  */dashboards/*) ;;
  *) ok ;;
esac

# Extract the dashboard ID from the file path (dashboards/{id}/...)
DASH_ID=$(echo "$FILE_PATH" | sed -n 's|.*/dashboards/\([^/]*\)/.*|\1|p')
if [ -z "$DASH_ID" ]; then
  ok
fi

# Check if SYNAPSE_DASHBOARD_ID is set (indicates a swarm worker context)
if [ -z "$SYNAPSE_DASHBOARD_ID" ]; then
  ok
fi

# If assigned dashboard is a chat-agent, verify the write targets the same one
if [[ "$SYNAPSE_DASHBOARD_ID" == chat-agent-* ]]; then
  if [ "$DASH_ID" != "$SYNAPSE_DASHBOARD_ID" ]; then
    warn "Warning: Chat agent $SYNAPSE_DASHBOARD_ID is writing to dashboard $DASH_ID — expected writes to $SYNAPSE_DASHBOARD_ID only."
  fi
fi

# If assigned dashboard is NOT a chat-agent (code agent), warn if writing to a chat dashboard
if [[ "$SYNAPSE_DASHBOARD_ID" != chat-agent-* ]] && [[ "$DASH_ID" == chat-agent-* ]]; then
  warn "Warning: Code agent $SYNAPSE_DASHBOARD_ID is writing to chat dashboard $DASH_ID — this may be a routing error."
fi

ok
