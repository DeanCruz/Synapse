#!/bin/bash
# enforce-dashboard-isolation.sh — PreToolUse hook on Edit|Write
# Blocks agents from writing to any dashboard other than their assigned one.
#
# The assigned dashboard is resolved in this order:
#   1. SYNAPSE_DASHBOARD_ID env var (set by Electron when spawning the CLI)
#   2. `DASHBOARD ID:` directive parsed from the transcript's system prompt
#      (covers raw-CLI invocations where the env var is not set)
#
# If neither source provides an assignment, the hook fails open — raw CLI usage
# without any dashboard binding stays unblocked.
#
# Event:   PreToolUse
# Matcher: Edit|Write
# Action:  BLOCK if file targets a different dashboard, ALLOW otherwise
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

# Resolve the assigned dashboard. First source: env var.
ASSIGNED_DASH="${SYNAPSE_DASHBOARD_ID:-}"
ASSIGNED_SRC="env var SYNAPSE_DASHBOARD_ID"

# Second source: DASHBOARD ID: directive between ===DASHBOARD_BINDING_START/END===
# markers in the transcript. Only accept an ID that matches a real dashboard-ID
# shape (6-char hex, `ide`, or legacy `dashboardN`) — the transcript can contain
# quoted conversational text that happens to include the marker pair, and we must
# not derive a fake assignment from that.
if [ -z "$ASSIGNED_DASH" ]; then
  TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
  if [ -n "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ]; then
    CAND=$(awk '
      /===DASHBOARD_BINDING_START===/ { cap=1; next }
      /===DASHBOARD_BINDING_END===/   { if (cap) exit }
      cap { print }
    ' "$TRANSCRIPT" 2>/dev/null \
      | grep -oE 'DASHBOARD ID: [a-zA-Z0-9_-]+' \
      | head -1 \
      | sed 's/^DASHBOARD ID: //')
    if echo "$CAND" | grep -Eq '^(ide|[a-f0-9]{6}|dashboard[0-9]+)$'; then
      ASSIGNED_DASH="$CAND"
      ASSIGNED_SRC="system prompt DASHBOARD ID: directive"
    fi
  fi
fi

# No binding discoverable — fail open (raw CLI without an assignment is allowed)
if [ -z "$ASSIGNED_DASH" ]; then
  allow
fi

# Determine tracker root (directory containing this script, up two levels)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Only care about files under {tracker_root}/dashboards/
case "$FILE_PATH" in
  "$TRACKER_ROOT"/dashboards/*) ;;
  */dashboards/*) ;;
  *) allow ;;
esac

# Extract the dashboard ID from the file path
# Pattern: .../dashboards/{id}/...
TARGET_DASH=$(echo "$FILE_PATH" | sed -n 's|.*/dashboards/\([^/]*\)/.*|\1|p')
if [ -z "$TARGET_DASH" ]; then
  # Could be writing to the dashboards dir itself (not a specific dashboard)
  allow
fi

# Check if the target dashboard matches the assigned one
if [ "$TARGET_DASH" = "$ASSIGNED_DASH" ]; then
  allow
fi

# Mismatch — block the write
block "Dashboard isolation violation: you are assigned to dashboard '$ASSIGNED_DASH' (source: $ASSIGNED_SRC) but attempted to write to dashboard '$TARGET_DASH'. Agents can only write to their assigned dashboard."
