#!/bin/bash
# mark-annotation-stale.sh — PostToolUse hook on Write
# Marks PKI annotations as stale when an agent writes to a project file
# that has an entry in the PKI manifest.
#
# Default: silent on any error or unexpected input (exit 0).

set -o pipefail

ok() {
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

# Guard: skip Synapse internal progress files (dashboards/*/progress/*)
case "$FILE_PATH" in
  */dashboards/*/progress/*) ok ;;
esac

# Guard: skip anything inside .synapse/knowledge/ to prevent infinite loops
case "$FILE_PATH" in
  */.synapse/knowledge/*) ok ;;
esac

# Determine tracker root (directory containing this script, up two levels)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Read project_root from .synapse/project.json
PROJECT_JSON="$TRACKER_ROOT/.synapse/project.json"
if [ ! -f "$PROJECT_JSON" ]; then
  ok
fi

PROJECT_ROOT=$(jq -r '.project_root // empty' "$PROJECT_JSON" 2>/dev/null) || ok
if [ -z "$PROJECT_ROOT" ]; then
  ok
fi

# Resolve file_path to absolute
FILE_PATH_ABS="$(cd "$(dirname "$FILE_PATH" 2>/dev/null)" 2>/dev/null && pwd)/$(basename "$FILE_PATH")" 2>/dev/null || FILE_PATH_ABS="$FILE_PATH"

# Guard: file must be under project_root
case "$FILE_PATH_ABS" in
  "$PROJECT_ROOT"/*) ;;
  *) ok ;;
esac

# Compute relative path from project root
REL_PATH="${FILE_PATH_ABS#"$PROJECT_ROOT"/}"

# Guard: if relative path is empty or same as absolute, something went wrong
if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "$FILE_PATH_ABS" ]; then
  ok
fi

# Locate manifest
MANIFEST="$PROJECT_ROOT/.synapse/knowledge/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  ok
fi

# Read manifest and check if this file has an annotation entry
HAS_ENTRY=$(jq -r --arg path "$REL_PATH" '.files[$path] // empty' "$MANIFEST" 2>/dev/null) || ok
if [ -z "$HAS_ENTRY" ]; then
  ok
fi

# Check if already stale — if so, nothing to do
ALREADY_STALE=$(jq -r --arg path "$REL_PATH" '.files[$path].stale // false' "$MANIFEST" 2>/dev/null) || ok
if [ "$ALREADY_STALE" = "true" ]; then
  ok
fi

# Mark the file as stale and recompute the stale count
# Use write-then-rename for atomic update
TMP_MANIFEST="${MANIFEST}.tmp.$$"
jq --arg path "$REL_PATH" '
  .files[$path].stale = true |
  .stats.stale = ([.files[] | select(.stale == true)] | length)
' "$MANIFEST" > "$TMP_MANIFEST" 2>/dev/null || { rm -f "$TMP_MANIFEST"; ok; }

# Atomic rename
mv "$TMP_MANIFEST" "$MANIFEST" 2>/dev/null || { rm -f "$TMP_MANIFEST"; ok; }

ok
