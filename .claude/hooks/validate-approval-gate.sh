#!/bin/bash
# validate-approval-gate.sh — PreToolUse hook on Task
# Blocks worker dispatch when the user has not approved the plan.
#
# Per .claude/skills/p-track/SKILL.md Step 11E (Approval Gate — NON-NEGOTIABLE):
#   1. Master writes a `permission` log entry: "Plan ready for review: ..."
#   2. Master halts and waits for user approval.
#   3. On approval, master writes an `info` log entry: "Approval granted ..."
#   4. Only then may the master dispatch workers.
#
# Repair dispatches and Phase 3 verification dispatches inherit the original
# approval — they are not gated again. Once "Approval granted" exists after the
# latest "Plan ready for review", every subsequent dispatch passes.
#
# Default: ALLOW on any error or unexpected input (fail-open).

set -o pipefail

allow() { echo '{"decision":"allow"}'; exit 0; }
block() { echo "{\"decision\":\"block\",\"reason\":\"$1\"}"; exit 0; }

command -v jq &>/dev/null || allow

INPUT=$(cat 2>/dev/null) || allow
[ -z "$INPUT" ] && allow

PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // empty' 2>/dev/null) || allow
[ -z "$PROMPT" ] && allow

# Only gate worker dispatches. Research/Explore Task calls have no TEMPLATE_VERSION.
echo "$PROMPT" | grep -q "TEMPLATE_VERSION:" || allow

# Extract dashboard ID from the worker prompt's progress-file path.
DASHBOARD_ID=$(echo "$PROMPT" | grep -oE 'dashboards/[A-Za-z0-9_-]+/' | head -1 | sed -E 's|dashboards/([^/]+)/|\1|')
[ -z "$DASHBOARD_ID" ] && allow

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOGS_FILE="$TRACKER_ROOT/dashboards/$DASHBOARD_ID/logs.json"

if [ ! -f "$LOGS_FILE" ]; then
  block "Approval gate: logs.json not found for dashboard '$DASHBOARD_ID'. The master must write the plan and request approval before dispatching workers. See .claude/skills/p-track/SKILL.md Step 11E."
fi

LATEST_PERMISSION_IDX=$(jq '
  [.entries // [] | to_entries[] |
   select(.value.level == "permission" and (.value.message // "" | test("Plan ready for review"; "i")))
   | .key] | last // -1
' "$LOGS_FILE" 2>/dev/null)

if [ -z "$LATEST_PERMISSION_IDX" ] || [ "$LATEST_PERMISSION_IDX" = "null" ] || [ "$LATEST_PERMISSION_IDX" = "-1" ]; then
  block "Approval gate: no 'Plan ready for review' permission entry found in logs.json. The master must (1) write a permission-level log entry, (2) ask 'Ready to execute. Approve to begin dispatching N agents?', (3) wait for approval, (4) write an 'Approval granted' info entry, before dispatching any worker. See .claude/skills/p-track/SKILL.md Step 11E."
fi

APPROVAL_AFTER=$(jq --argjson permIdx "$LATEST_PERMISSION_IDX" '
  [.entries // [] | to_entries[] |
   select(.key > $permIdx) |
   select(.value.level == "info" and (.value.message // "" | test("Approval granted"; "i")))
  ] | length
' "$LOGS_FILE" 2>/dev/null)

if [ -z "$APPROVAL_AFTER" ] || [ "$APPROVAL_AFTER" = "null" ] || [ "$APPROVAL_AFTER" = "0" ]; then
  block "Approval gate: plan was presented for review but the user has not approved yet. Wait for the user to respond, then append an info-level log entry 'Approval granted — activating eager dispatch' to logs.json BEFORE dispatching any worker. See .claude/skills/p-track/SKILL.md Step 11E."
fi

allow
