#!/bin/bash
# enforce-dashboard-isolation.sh — PreToolUse hook on Edit|Write
# Blocks agents from writing to any dashboard other than their assigned one.
# The assigned dashboard is identified by the SYNAPSE_DASHBOARD_ID env var,
# which is set when the Electron app spawns the CLI process.
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

# If no dashboard binding is set, allow (non-Electron context, e.g. raw CLI)
if [ -z "$SYNAPSE_DASHBOARD_ID" ]; then
  allow
fi

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
if [ "$TARGET_DASH" = "$SYNAPSE_DASHBOARD_ID" ]; then
  allow
fi

# Mismatch — block the write
block "Dashboard isolation violation: you are assigned to dashboard '$SYNAPSE_DASHBOARD_ID' but attempted to write to dashboard '$TARGET_DASH'. Agents can only write to their assigned dashboard."
