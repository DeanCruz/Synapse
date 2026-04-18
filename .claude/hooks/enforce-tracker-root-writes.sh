#!/bin/bash
# enforce-tracker-root-writes.sh — PreToolUse hook on Edit|Write
# Blocks dashboard-pattern files from being written outside {tracker_root}.
# Prevents master agents from writing initialization.json, logs.json, etc.
# to {project_root}/dashboards/ instead of {tracker_root}/dashboards/.
#
# Event:   PreToolUse
# Matcher: Edit|Write
# Action:  BLOCK if dashboard file targets wrong root, ALLOW otherwise
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

# Determine tracker root (directory containing this script, up two levels)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Resolve to absolute path
FILE_PATH_ABS="$(cd "$(dirname "$FILE_PATH" 2>/dev/null)" 2>/dev/null && pwd)/$(basename "$FILE_PATH")" 2>/dev/null || FILE_PATH_ABS="$FILE_PATH"

# Quick exit: if the file is already under TRACKER_ROOT/dashboards/, allow
case "$FILE_PATH_ABS" in
  "$TRACKER_ROOT"/dashboards/*) allow ;;
esac

# Check if the file matches a dashboard file pattern (regardless of location)
DASHBOARD_FILE=false
case "$FILE_PATH_ABS" in
  */dashboards/*/initialization.json) DASHBOARD_FILE=true ;;
  */dashboards/*/logs.json) DASHBOARD_FILE=true ;;
  */dashboards/*/master_state.json) DASHBOARD_FILE=true ;;
  */dashboards/*/metrics.json) DASHBOARD_FILE=true ;;
  */dashboards/*/progress/*.json) DASHBOARD_FILE=true ;;
esac

# Not a dashboard file pattern -> allow (normal project file, nothing to enforce)
if [ "$DASHBOARD_FILE" = false ]; then
  allow
fi

# It IS a dashboard file but NOT under tracker_root -> block
# Extract the subpath for a helpful error message
SUBPATH=$(echo "$FILE_PATH_ABS" | sed -n 's|.*/dashboards/||p')

block "Dashboard file written to wrong location. Expected: ${TRACKER_ROOT}/dashboards/${SUBPATH} — Got: ${FILE_PATH_ABS}. Dashboard files MUST be written under {tracker_root}/dashboards/. Use the absolute path: ${TRACKER_ROOT}/dashboards/${SUBPATH}"
