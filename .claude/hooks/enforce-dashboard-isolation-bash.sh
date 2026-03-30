#!/bin/bash
# enforce-dashboard-isolation-bash.sh — PreToolUse hook on Bash
# Blocks agents from running bash commands that target a different dashboard.
# Catches mkdir, cp, rm, echo/cat redirects, etc. targeting wrong dashboards.
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

# Extract command from tool_input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || allow
if [ -z "$COMMAND" ]; then
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
  if [ "$DASH_ID" != "$SYNAPSE_DASHBOARD_ID" ]; then
    block "Dashboard isolation violation: you are assigned to dashboard '$SYNAPSE_DASHBOARD_ID' but your command references dashboard '$DASH_ID'. Agents can only operate on their assigned dashboard."
  fi
done

allow
