#!/bin/bash
# validate-master-write.sh — PreToolUse hook on Edit/Write
# Blocks master agent from writing files in {project_root} during an active swarm.
# Master agents orchestrate; they never write application code.
#
# Default: ALLOW on any error or unexpected input.

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

# Read project_root from .synapse/project.json
PROJECT_JSON="$TRACKER_ROOT/.synapse/project.json"
if [ ! -f "$PROJECT_JSON" ]; then
  allow
fi

PROJECT_ROOT=$(jq -r '.project_root // empty' "$PROJECT_JSON" 2>/dev/null) || allow
if [ -z "$PROJECT_ROOT" ]; then
  allow
fi

# Resolve to absolute path
FILE_PATH_ABS="$(cd "$(dirname "$FILE_PATH" 2>/dev/null)" 2>/dev/null && pwd)/$(basename "$FILE_PATH")" 2>/dev/null || FILE_PATH_ABS="$FILE_PATH"

# If the file is NOT under project_root, allow (it's a tracker file)
case "$FILE_PATH_ABS" in
  "$PROJECT_ROOT"/*) ;;  # File is in project_root, continue checking
  *) allow ;;
esac

# If project_root == tracker_root, the file is always allowed
# (Synapse is targeting itself — hooks, dashboards, etc.)
if [ "$PROJECT_ROOT" = "$TRACKER_ROOT" ]; then
  allow
fi

# Check allowed tracker paths — master can always write to these
case "$FILE_PATH_ABS" in
  "$TRACKER_ROOT"/dashboards/*) allow ;;
  "$TRACKER_ROOT"/tasks/*) allow ;;
  "$TRACKER_ROOT"/Archive/*) allow ;;
  "$TRACKER_ROOT"/.claude/*) allow ;;
  "$TRACKER_ROOT"/.synapse/*) allow ;;
esac

# Check if a swarm is active: any non-ide dashboard has initialization.json with task != null
SWARM_ACTIVE=false
for init_file in "$TRACKER_ROOT"/dashboards/*/initialization.json; do
  [ -f "$init_file" ] || continue
  # Skip ide dashboard
  DASH_DIR=$(dirname "$init_file")
  DASH_ID=$(basename "$DASH_DIR")
  if [ "$DASH_ID" = "ide" ]; then
    continue
  fi
  TASK_VAL=$(jq -r 'if .task != null and (.task | type) != "null" then "active" else empty end' "$init_file" 2>/dev/null) || continue
  if [ "$TASK_VAL" = "active" ]; then
    SWARM_ACTIVE=true
    break
  fi
done

if [ "$SWARM_ACTIVE" = false ]; then
  allow
fi

# Swarm is active and file is in project_root — block
block "Master agent cannot write to project files during an active swarm. File: $FILE_PATH. Create a worker task instead."
