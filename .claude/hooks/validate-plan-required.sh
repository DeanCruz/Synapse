#!/bin/bash
# validate-plan-required.sh — PreToolUse hook on Edit|Write
# Blocks the master from writing initialization.json unless a properly structured
# plan.json exists in the same dashboard directory.
#
# plan.json captures the master's deep planning thinking. It is read by every
# worker at dispatch time. Schema (see agent/master/initialization_blueprint.md
# and agent/_commands/p_track_planning.md):
#
#   {
#     "name":    "<kebab-case-slug>",
#     "created": "<ISO 8601>",
#     "context": {
#       "prompt":       "<verbatim user prompt — NON-EMPTY>",
#       "project_root": "<absolute path>",
#       "tracker_root": "<absolute path>",
#       "dashboard_id": "<id>",
#       "type":         "Waves" | "Chains",
#       "directories":  [...],
#       "conventions":  { naming: [...], file_structure: [...], ... },
#       "reference_code":         [...],   // optional
#       "architectural_decisions":"...",   // optional
#       "edge_cases":             "...",   // optional
#       "shared_constraints":     "..."    // optional
#     },
#     "tasks": [
#       {
#         "id":               "1.1",
#         "title":            "...",
#         "wave":             1,
#         "depends_on":       [],
#         "directory":        "...",
#         "description":      "<what the worker must do — NON-EMPTY>",
#         "approach":         "<how to do it most effectively — NON-EMPTY>",
#         "files":            [{ "action": "read|modify|create|delete", "path": "..." }],
#         "context":          "...",
#         "critical":         "...",
#         "success_criteria": [...],
#         "instruction_mode": "FULL" | "LITE",
#         "tags":             [...]
#       }
#     ]
#   }
#
# Default: ALLOW on any error or unexpected input (fail-open).

set -o pipefail

allow() { echo '{"decision":"allow"}'; exit 0; }
block() { echo "{\"decision\":\"block\",\"reason\":\"$1\"}"; exit 0; }

command -v jq &>/dev/null || allow

INPUT=$(cat 2>/dev/null) || allow
[ -z "$INPUT" ] && allow

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || allow
[ -z "$FILE_PATH" ] && allow

# Only gate writes to initialization.json
case "$FILE_PATH" in
  */initialization.json) ;;
  *) allow ;;
esac

# Allow Edits to existing initialization.json — only initial Write needs plan.json
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null) || allow
if [ "$TOOL_NAME" = "Edit" ] && [ -f "$FILE_PATH" ]; then
  EXISTING_TASK=$(jq -r '.task // empty' "$FILE_PATH" 2>/dev/null)
  if [ -n "$EXISTING_TASK" ] && [ "$EXISTING_TASK" != "null" ]; then
    # initialization.json already populated — Edits (repair, add_task) are fine
    allow
  fi
fi

# Identify the dashboard directory and look for plan.json
DASH_DIR=$(dirname "$FILE_PATH")
PLAN_FILE="$DASH_DIR/plan.json"

if [ ! -f "$PLAN_FILE" ]; then
  block "Planning gate: plan.json not found at $PLAN_FILE. Before writing initialization.json, the master MUST create plan.json in the same directory containing { name, created, context, tasks }. See agent/_commands/p_track_planning.md Step 8 and agent/master/initialization_blueprint.md. plan.json captures the deep planning thinking and is read by every worker on dispatch."
fi

# Validate plan.json is parseable
if ! jq -e . "$PLAN_FILE" >/dev/null 2>&1; then
  block "Planning gate: plan.json at $PLAN_FILE is not valid JSON. Repair it before writing initialization.json."
fi

# Required top-level fields
NAME=$(jq -r '.name // empty' "$PLAN_FILE" 2>/dev/null)
[ -z "$NAME" ] && block "Planning gate: plan.json missing required top-level field 'name' (kebab-case task slug)."

CREATED=$(jq -r '.created // empty' "$PLAN_FILE" 2>/dev/null)
[ -z "$CREATED" ] && block "Planning gate: plan.json missing required top-level field 'created' (ISO 8601 timestamp)."

# Required context fields
PROMPT=$(jq -r '.context.prompt // empty' "$PLAN_FILE" 2>/dev/null)
if [ -z "$PROMPT" ]; then
  block "Planning gate: plan.json missing context.prompt — the verbatim user prompt is required so workers know the original goal. If you forgot the deep thinking context, redo the deep analysis before writing the plan."
fi

# tasks array length and structure
TASK_COUNT=$(jq '.tasks // [] | length' "$PLAN_FILE" 2>/dev/null)
if [ -z "$TASK_COUNT" ] || [ "$TASK_COUNT" = "null" ] || [ "$TASK_COUNT" -lt 1 ]; then
  block "Planning gate: plan.json has no tasks. Decompose the prompt into at least one task with id, title, description, approach, and files."
fi

# Each task must have id, title, description, approach, files
MISSING=$(jq -r '
  [.tasks // [] | to_entries[] |
    {
      idx: .key,
      task: .value,
      missing: (
        ([
          (if (.value.id // "") == "" then "id" else null end),
          (if (.value.title // "") == "" then "title" else null end),
          (if (.value.description // "") == "" then "description" else null end),
          (if (.value.approach // "") == "" then "approach" else null end),
          (if ((.value.files // []) | length) == 0 then "files" else null end)
        ] | map(select(. != null)))
      )
    } |
    select((.missing | length) > 0) |
    "task[" + (.idx | tostring) + "] (id=" + (.task.id // "null") + ") missing: " + (.missing | join(", "))
  ] | join("; ")
' "$PLAN_FILE" 2>/dev/null)

if [ -n "$MISSING" ] && [ "$MISSING" != "null" ]; then
  block "Planning gate: plan.json tasks are incomplete — $MISSING. Every task needs id, title, description, approach (the deep-thought how-to), and a non-empty files list. If the deep-thinking context is forgotten, redo it before writing initialization.json."
fi

# Cross-check: agents.length in initialization.json content (if Write) should match tasks.length
if [ "$TOOL_NAME" = "Write" ]; then
  NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)
  if [ -n "$NEW_CONTENT" ]; then
    AGENT_COUNT=$(echo "$NEW_CONTENT" | jq '.agents // [] | length' 2>/dev/null)
    if [ -n "$AGENT_COUNT" ] && [ "$AGENT_COUNT" != "null" ] && [ "$AGENT_COUNT" -ne "$TASK_COUNT" ]; then
      block "Planning gate: initialization.json declares $AGENT_COUNT agents but plan.json has $TASK_COUNT tasks. They must match — every agent must correspond to a task in plan.json."
    fi
  fi
fi

allow
