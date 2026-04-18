#!/bin/bash
# enforce-dashboard-isolation-bash.sh — PreToolUse hook on Bash
# Blocks agents from running bash commands that target a different dashboard.
# Catches mkdir, cp, rm, echo/cat redirects, etc. targeting wrong dashboards.
#
# Resolves the assigned dashboard in this order:
#   1. SYNAPSE_DASHBOARD_ID env var
#   2. `DASHBOARD ID:` directive from the transcript's system prompt
#
# Event:   PreToolUse
# Matcher: Bash
# Action:  BLOCK if command targets a different dashboard, ALLOW otherwise
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

# Resolve the assigned dashboard.
ASSIGNED_DASH="${SYNAPSE_DASHBOARD_ID:-}"
ASSIGNED_SRC="env var SYNAPSE_DASHBOARD_ID"

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

if [ -z "$ASSIGNED_DASH" ]; then
  allow
fi

# Only check commands that reference dashboards/
case "$COMMAND" in
  *dashboards/*) ;;
  *) allow ;;
esac

# Extract all dashboard IDs referenced in the command
# Pattern: dashboards/{id}/ or dashboards/{id}
REFERENCED_DASHES=$(echo "$COMMAND" | grep -oE 'dashboards/[a-zA-Z0-9_]+' | sed 's|dashboards/||' | sort -u)

if [ -z "$REFERENCED_DASHES" ]; then
  allow
fi

# Check each referenced dashboard — all must match the assigned one
for DASH_ID in $REFERENCED_DASHES; do
  if [ "$DASH_ID" != "$ASSIGNED_DASH" ]; then
    block "Dashboard isolation violation: you are assigned to dashboard '$ASSIGNED_DASH' (source: $ASSIGNED_SRC) but your command references dashboard '$DASH_ID'. Agents can only operate on their assigned dashboard."
  fi
done

allow
