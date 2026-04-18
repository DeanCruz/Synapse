#!/bin/bash
# validate-initialization-schema.sh — PreToolUse hook on Write
# Validates the full schema of dashboards/{id}/initialization.json before the write lands.
# Catches the class of bugs where the master writes waves but no agents, or agents that
# reference non-existent waves — producing a dashboard that renders wave headers with no
# task cards.
#
# Event:   PreToolUse
# Matcher: Write
# Action:  BLOCK on schema violation, ALLOW otherwise
# Default: ALLOW on any error or unexpected input (fail-open), except where noted
#
# Bypass:  SYNAPSE_SKIP_SCHEMA=1 in env skips this hook. Use sparingly — only for
#          scratch/repair work outside a real swarm.

set -o pipefail

allow() {
  echo '{"decision":"allow"}'
  exit 0
}

block() {
  local reason="$1"
  # Escape for JSON (newlines, quotes, backslashes)
  reason=$(printf '%s' "$reason" | jq -R -s '.' 2>/dev/null || printf '"%s"' "$reason")
  echo "{\"decision\":\"block\",\"reason\":${reason}}"
  exit 0
}

# Fail-open if jq missing
if ! command -v jq &>/dev/null; then
  allow
fi

# Explicit escape hatch
if [ "${SYNAPSE_SKIP_SCHEMA:-}" = "1" ]; then
  allow
fi

# Read stdin (tool input JSON)
INPUT=$(cat 2>/dev/null) || allow
if [ -z "$INPUT" ]; then
  allow
fi

# Only interested in Write (Edit uses partial patches, harder to validate)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null) || allow
if [ "$TOOL_NAME" != "Write" ]; then
  allow
fi

# Extract file_path
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || allow
if [ -z "$FILE_PATH" ]; then
  allow
fi

# Only match dashboards/{id}/initialization.json
case "$FILE_PATH" in
  */dashboards/*/initialization.json) ;;
  *) allow ;;
esac

# Skip the reserved `ide` dashboard and any Archive paths
case "$FILE_PATH" in
  */dashboards/ide/initialization.json) allow ;;
  */Archive/*) allow ;;
esac

# Extract the content being written
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null) || allow
if [ -z "$CONTENT" ]; then
  allow
fi

# Must be valid JSON
if ! echo "$CONTENT" | jq empty 2>/dev/null; then
  block "initialization.json schema error: content is not valid JSON. An invalid file silently stops all dashboard updates until corrected. See agent/master/initialization_blueprint.md."
fi

# Allow the default empty template (ensureDashboard writes this on dashboard creation)
# Shape: { "task": null, "agents": [], "waves": [], "chains": [], "history": [] }
IS_DEFAULT=$(echo "$CONTENT" | jq -r '
  if (.task == null) and ((.agents // []) | length == 0) and ((.waves // []) | length == 0)
  then "yes" else "no" end' 2>/dev/null)
if [ "$IS_DEFAULT" = "yes" ]; then
  allow
fi

# ---- task object ----
TASK_NAME=$(echo "$CONTENT" | jq -r '.task.name // empty' 2>/dev/null)
TASK_TYPE=$(echo "$CONTENT" | jq -r '.task.type // empty' 2>/dev/null)
TASK_CREATED=$(echo "$CONTENT" | jq -r '.task.created // empty' 2>/dev/null)
TASK_TOTAL_TASKS=$(echo "$CONTENT" | jq -r '.task.total_tasks // empty' 2>/dev/null)
TASK_TOTAL_WAVES=$(echo "$CONTENT" | jq -r '.task.total_waves // empty' 2>/dev/null)

ERRORS=""

if [ -z "$TASK_NAME" ]; then
  ERRORS="${ERRORS}\n- task.name is missing or empty (required: kebab-case slug)"
else
  # kebab-case-ish: lowercase letters, digits, hyphens
  if ! echo "$TASK_NAME" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
    ERRORS="${ERRORS}\n- task.name='${TASK_NAME}' is not kebab-case (lowercase letters/digits/hyphens only)"
  fi
fi

case "$TASK_TYPE" in
  Waves|Chains) ;;
  "") ERRORS="${ERRORS}\n- task.type is missing (required: \"Waves\" or \"Chains\")" ;;
  *) ERRORS="${ERRORS}\n- task.type='${TASK_TYPE}' is invalid (must be exactly \"Waves\" or \"Chains\")" ;;
esac

if [ -z "$TASK_CREATED" ]; then
  ERRORS="${ERRORS}\n- task.created is missing (required: ISO 8601 timestamp, immutable)"
fi

if [ -z "$TASK_TOTAL_TASKS" ] || ! echo "$TASK_TOTAL_TASKS" | grep -Eq '^[0-9]+$' || [ "$TASK_TOTAL_TASKS" -lt 1 ]; then
  ERRORS="${ERRORS}\n- task.total_tasks must be a positive integer (got: '${TASK_TOTAL_TASKS}')"
fi

if [ -z "$TASK_TOTAL_WAVES" ] || ! echo "$TASK_TOTAL_WAVES" | grep -Eq '^[0-9]+$' || [ "$TASK_TOTAL_WAVES" -lt 1 ]; then
  ERRORS="${ERRORS}\n- task.total_waves must be a positive integer (got: '${TASK_TOTAL_WAVES}')"
fi

# ---- agents[] ----
AGENT_COUNT=$(echo "$CONTENT" | jq -r '(.agents // []) | length' 2>/dev/null)
if [ "$AGENT_COUNT" = "0" ] || [ -z "$AGENT_COUNT" ]; then
  ERRORS="${ERRORS}\n- agents[] is empty or missing — the dashboard will render wave headers with NO task cards. Every swarm needs at least one agent entry."
fi

# ---- waves[] ----
WAVE_COUNT=$(echo "$CONTENT" | jq -r '(.waves // []) | length' 2>/dev/null)
if [ "$WAVE_COUNT" = "0" ] || [ -z "$WAVE_COUNT" ]; then
  ERRORS="${ERRORS}\n- waves[] is empty or missing — required even for Chains type (waves define layout rows)."
fi

# total_waves must equal waves[].length
if [ -n "$TASK_TOTAL_WAVES" ] && [ -n "$WAVE_COUNT" ] && [ "$TASK_TOTAL_WAVES" != "$WAVE_COUNT" ]; then
  ERRORS="${ERRORS}\n- task.total_waves (${TASK_TOTAL_WAVES}) does not equal waves[].length (${WAVE_COUNT})"
fi

# total_tasks must equal agents[].length
if [ -n "$TASK_TOTAL_TASKS" ] && [ -n "$AGENT_COUNT" ] && [ "$TASK_TOTAL_TASKS" != "$AGENT_COUNT" ]; then
  ERRORS="${ERRORS}\n- task.total_tasks (${TASK_TOTAL_TASKS}) does not equal agents[].length (${AGENT_COUNT})"
fi

# sum(waves[].total) must equal agents[].length
WAVE_TOTAL_SUM=$(echo "$CONTENT" | jq -r '[(.waves // [])[] | (.total // 0)] | add // 0' 2>/dev/null)
if [ -n "$AGENT_COUNT" ] && [ -n "$WAVE_TOTAL_SUM" ] && [ "$AGENT_COUNT" != "$WAVE_TOTAL_SUM" ]; then
  ERRORS="${ERRORS}\n- sum of waves[].total (${WAVE_TOTAL_SUM}) does not equal agents[].length (${AGENT_COUNT})"
fi

# agent ID format + uniqueness
BAD_IDS=$(echo "$CONTENT" | jq -r '[(.agents // [])[] | .id // "MISSING"] | map(select(test("^[0-9]+\\.[0-9]+r?$") | not)) | join(", ")' 2>/dev/null)
if [ -n "$BAD_IDS" ] && [ "$BAD_IDS" != "" ]; then
  ERRORS="${ERRORS}\n- agents[].id format invalid for: ${BAD_IDS} (must match \"{wave}.{index}\" or \"{wave}.{index}r\")"
fi

DUP_IDS=$(echo "$CONTENT" | jq -r '[(.agents // [])[] | .id] | group_by(.) | map(select(length > 1) | .[0]) | join(", ")' 2>/dev/null)
if [ -n "$DUP_IDS" ] && [ "$DUP_IDS" != "" ]; then
  ERRORS="${ERRORS}\n- agents[].id has duplicates: ${DUP_IDS}"
fi

# every agents[i].wave must exist in waves[j].id
ORPHAN_WAVES=$(echo "$CONTENT" | jq -r '
  (.waves // []) as $ws
  | [$ws[].id] as $wids
  | [(.agents // [])[] | select((.wave as $w | $wids | index($w)) == null) | "\(.id)→wave=\(.wave)"]
  | join(", ")' 2>/dev/null)
if [ -n "$ORPHAN_WAVES" ] && [ "$ORPHAN_WAVES" != "" ]; then
  ERRORS="${ERRORS}\n- agents reference non-existent wave IDs: ${ORPHAN_WAVES}. Every agents[i].wave must match a waves[j].id exactly."
fi

# every depends_on entry must reference an existing agent id
ORPHAN_DEPS=$(echo "$CONTENT" | jq -r '
  [(.agents // [])[].id] as $ids
  | [(.agents // [])[]
     | . as $a
     | (.depends_on // [])[] as $dep
     | select(($ids | index($dep)) == null)
     | "\($a.id)→\($dep)"]
  | join(", ")' 2>/dev/null)
if [ -n "$ORPHAN_DEPS" ] && [ "$ORPHAN_DEPS" != "" ]; then
  ERRORS="${ERRORS}\n- depends_on references non-existent agent IDs: ${ORPHAN_DEPS}"
fi

# Chains mode: chains[] must be present; every agent must appear in exactly one chain's tasks[]
if [ "$TASK_TYPE" = "Chains" ]; then
  CHAIN_COUNT=$(echo "$CONTENT" | jq -r '(.chains // []) | length' 2>/dev/null)
  if [ "$CHAIN_COUNT" = "0" ] || [ -z "$CHAIN_COUNT" ]; then
    ERRORS="${ERRORS}\n- task.type=\"Chains\" but chains[] is empty or missing"
  else
    MISPLACED=$(echo "$CONTENT" | jq -r '
      [(.agents // [])[].id] as $aids
      | [(.chains // [])[].tasks[]?] as $ctasks
      | (
          # agents not in any chain
          ([$aids[] as $aid | select(($ctasks | index($aid)) == null) | $aid] | map("\(.) missing from chains"))
          + # duplicates across chains
          ($ctasks | group_by(.) | map(select(length > 1) | .[0] + " in multiple chains"))
        )
      | join(", ")' 2>/dev/null)
    if [ -n "$MISPLACED" ] && [ "$MISPLACED" != "" ]; then
      ERRORS="${ERRORS}\n- chains[] coverage error: ${MISPLACED}. Every agent must appear in exactly one chain."
    fi
  fi
fi

# ---- verdict ----
if [ -n "$ERRORS" ]; then
  MSG="initialization.json schema violations:${ERRORS}\n\nSee agent/master/initialization_blueprint.md for the authoritative schema + worked examples. Fix and re-write the full file atomically."
  block "$MSG"
fi

allow
