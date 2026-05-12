#!/bin/bash
# enforce-instance-type.sh — PreToolUse hook on Edit|Write
#
# Blocks writes when an agent's instance type doesn't match the target dashboard's shape:
#   - instance_type=code  → may NOT write to dashboards/chat-agent-*/...
#   - instance_type=chat  → may ONLY write to dashboards/chat-agent-*/...
#
# Instance type is resolved in this order:
#   1. SYNAPSE_INSTANCE_TYPE env var (set by Electron when spawning the CLI)
#   2. `INSTANCE TYPE:` directive parsed from the transcript's system prompt
#      (covers raw-CLI invocations where the env var is not set)
#
# If neither source provides an instance type, the hook fails open — raw CLI
# usage without any binding stays unblocked (mirrors enforce-dashboard-isolation.sh).
#
# Event:   PreToolUse
# Matcher: Edit|Write
# Action:  BLOCK on instance/dashboard shape mismatch, ALLOW otherwise
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

if ! command -v jq &>/dev/null; then
  allow
fi

INPUT=$(cat 2>/dev/null) || allow
if [ -z "$INPUT" ]; then
  allow
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || allow
if [ -z "$FILE_PATH" ]; then
  allow
fi

# Determine tracker root (this script lives at {tracker_root}/.claude/hooks/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Only enforce on writes inside {tracker_root}/dashboards/
case "$FILE_PATH" in
  "$TRACKER_ROOT"/dashboards/*) ;;
  *) allow ;;
esac

# Extract the target dashboard ID
TARGET_DASH=$(echo "$FILE_PATH" | sed -n 's|.*/dashboards/\([^/]*\)/.*|\1|p')
if [ -z "$TARGET_DASH" ]; then
  allow
fi

# Resolve instance type. First source: env var.
INSTANCE_TYPE="${SYNAPSE_INSTANCE_TYPE:-}"
INSTANCE_SRC="env var SYNAPSE_INSTANCE_TYPE"

# Second source: `INSTANCE TYPE:` directive between the dashboard-binding sentinels.
if [ -z "$INSTANCE_TYPE" ]; then
  TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
  if [ -n "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ]; then
    CAND=$(awk '
      /===DASHBOARD_BINDING_START===/ { cap=1; next }
      /===DASHBOARD_BINDING_END===/   { if (cap) exit }
      cap { print }
    ' "$TRANSCRIPT" 2>/dev/null \
      | grep -oE 'INSTANCE TYPE: (code|chat)' \
      | head -1 \
      | sed 's/^INSTANCE TYPE: //')
    if [ "$CAND" = "code" ] || [ "$CAND" = "chat" ]; then
      INSTANCE_TYPE="$CAND"
      INSTANCE_SRC="system prompt INSTANCE TYPE: directive"
    fi
  fi
fi

# No binding discoverable — fail open
if [ -z "$INSTANCE_TYPE" ]; then
  allow
fi

# Determine target dashboard shape
case "$TARGET_DASH" in
  chat-agent-*) TARGET_SHAPE="chat" ;;
  *)            TARGET_SHAPE="code" ;;
esac

# Enforce shape match
if [ "$INSTANCE_TYPE" = "code" ] && [ "$TARGET_SHAPE" = "chat" ]; then
  block "Instance type violation: this agent is INSTANCE TYPE 'code' (source: $INSTANCE_SRC) but attempted to write to chat dashboard '$TARGET_DASH'. Code-page agents must use individual (non-chat-agent) dashboards. Use a dashboard whose ID does not start with 'chat-agent-'."
fi

if [ "$INSTANCE_TYPE" = "chat" ] && [ "$TARGET_SHAPE" = "code" ]; then
  block "Instance type violation: this agent is INSTANCE TYPE 'chat' (source: $INSTANCE_SRC) but attempted to write to code dashboard '$TARGET_DASH'. Chat-page agents must use chat-agent-* dashboards only."
fi

allow
