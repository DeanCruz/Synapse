#!/bin/bash
# enforce-tracker-root-writes-bash.sh — PreToolUse hook on Bash
# Blocks bash commands that write dashboard files to {project_root} instead
# of {tracker_root}. Defense-in-depth companion to enforce-tracker-root-writes.sh.
#
# Event:   PreToolUse
# Matcher: Bash
# Action:  BLOCK if command targets dashboard files in project_root, ALLOW otherwise
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

# Extract command from tool_input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || allow
if [ -z "$COMMAND" ]; then
  allow
fi

# Only check commands that reference dashboard file patterns
case "$COMMAND" in
  *dashboards/*/initialization.json*) ;;
  *dashboards/*/logs.json*) ;;
  *dashboards/*/master_state.json*) ;;
  *dashboards/*/metrics.json*) ;;
  *dashboards/*/progress/*.json*) ;;
  *) allow ;;
esac

# Determine tracker root (directory containing this script, up two levels)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# If the command references tracker_root/dashboards/, that's correct — allow
case "$COMMAND" in
  *"$TRACKER_ROOT"/dashboards/*) allow ;;
esac

# Read project_root from .synapse/project.json
PROJECT_JSON="$TRACKER_ROOT/.synapse/project.json"
if [ ! -f "$PROJECT_JSON" ]; then
  allow
fi

PROJECT_ROOT=$(jq -r '.project_root // empty' "$PROJECT_JSON" 2>/dev/null) || allow
if [ -z "$PROJECT_ROOT" ]; then
  allow
fi

# If tracker_root == project_root, no conflict possible
if [ "$PROJECT_ROOT" = "$TRACKER_ROOT" ]; then
  allow
fi

# Check if the command references project_root/dashboards/
case "$COMMAND" in
  *"$PROJECT_ROOT"/dashboards/*)
    block "Command writes dashboard files to project directory (${PROJECT_ROOT}/dashboards/) instead of tracker directory (${TRACKER_ROOT}/dashboards/). Dashboard files MUST be under {tracker_root}. Use: ${TRACKER_ROOT}/dashboards/..." ;;
esac

allow
