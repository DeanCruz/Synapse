#!/bin/bash
# validate-progress-log-detail.sh — PostToolUse hook on Write
# Validates that progress file logs are detailed and meaningful.
# Workers MUST maintain rich, narrative logs that tell the full story of
# task execution — not vague placeholders like "Starting..." or "Done."
#
# Checks:
#   1. logs[] is non-empty
#   2. message field is descriptive (≥15 chars)
#   3. Latest log entry is descriptive (≥20 chars)
#   4. No lazy/vague log patterns
#   5. Minimum log count per stage
#   6. No consecutive duplicate log messages
#   7. Milestones exist for later stages
#
# PostToolUse hooks cannot block — they warn the agent to improve quality.

set -o pipefail

ok() { exit 0; }

warn() {
  local msg="$1"
  echo "{\"message\":\"$msg\"}"
  exit 0
}

# Ensure jq is available
if ! command -v jq &>/dev/null; then ok; fi

# Read stdin (tool input JSON)
INPUT=$(cat 2>/dev/null) || ok
[ -z "$INPUT" ] && ok

# Extract file_path from tool_input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || ok
[ -z "$FILE_PATH" ] && ok

# Only validate progress files: */progress/*.json
case "$FILE_PATH" in
  */progress/*.json) ;;
  *) ok ;;
esac

# Read the written file
[ ! -f "$FILE_PATH" ] && ok

CONTENT=$(cat "$FILE_PATH" 2>/dev/null) || ok
[ -z "$CONTENT" ] && ok

# Validate it's valid JSON
echo "$CONTENT" | jq empty 2>/dev/null || ok

WARNINGS=""

# Extract key fields
STAGE=$(echo "$CONTENT" | jq -r '.stage // empty' 2>/dev/null)
STATUS=$(echo "$CONTENT" | jq -r '.status // empty' 2>/dev/null)
MESSAGE=$(echo "$CONTENT" | jq -r '.message // empty' 2>/dev/null)

# --- Check 1: logs[] must not be empty ---
LOG_COUNT=$(echo "$CONTENT" | jq '.logs | length' 2>/dev/null) || LOG_COUNT=0
if [ "$LOG_COUNT" -eq 0 ]; then
  warn "⚠️ PROGRESS LOG QUALITY: Your progress file has ZERO log entries. Workers MUST include detailed logs documenting what files you read, what you learned, decisions made, code changes, and outcomes. Add entries to logs[] immediately."
fi

# --- Check 2: message field quality ---
if [ -n "$MESSAGE" ]; then
  MSG_LEN=${#MESSAGE}
  if [ "$MSG_LEN" -lt 15 ]; then
    WARNINGS="${WARNINGS}• 'message' field is too vague (${MSG_LEN} chars: '${MESSAGE}') — describe specifically what you are doing right now. "
  fi
fi

# --- Check 3: latest log entry quality ---
if [ "$LOG_COUNT" -gt 0 ]; then
  LATEST_MSG=$(echo "$CONTENT" | jq -r '.logs[-1].msg // empty' 2>/dev/null)
  if [ -n "$LATEST_MSG" ]; then
    LATEST_LEN=${#LATEST_MSG}
    if [ "$LATEST_LEN" -lt 20 ]; then
      WARNINGS="${WARNINGS}• Latest log entry too brief (${LATEST_LEN} chars: '${LATEST_MSG}') — each log should describe WHAT you did and the outcome. "
    fi
  fi

  # Check for lazy/vague log messages
  if [ -n "$LATEST_MSG" ]; then
    LATEST_LOWER=$(echo "$LATEST_MSG" | tr '[:upper:]' '[:lower:]')
    case "$LATEST_LOWER" in
      "starting..."|"done"|"done."|"working on it"|"in progress"|"continuing"|"moving on"|"started"|"finished"|"working..."|"complete"|"processing"|"processing..."|"reading..."|"implementing..."|"testing..."|"finalizing...")
        WARNINGS="${WARNINGS}• Latest log '${LATEST_MSG}' is a vague placeholder — replace with a specific description of what you actually did or found. "
        ;;
    esac
  fi
fi

# --- Check 4: minimum log count by stage ---
case "$STAGE" in
  planning)
    [ "$LOG_COUNT" -lt 2 ] && WARNINGS="${WARNINGS}• Stage 'planning' should have ≥2 logs (context read + planning decisions). Currently: ${LOG_COUNT}. "
    ;;
  implementing)
    [ "$LOG_COUNT" -lt 3 ] && WARNINGS="${WARNINGS}• Stage 'implementing' should have ≥3 logs (context + planning + implementation steps). Currently: ${LOG_COUNT}. "
    ;;
  testing)
    [ "$LOG_COUNT" -lt 4 ] && WARNINGS="${WARNINGS}• Stage 'testing' should have ≥4 logs (context + planning + implementation + test results). Currently: ${LOG_COUNT}. "
    ;;
  finalizing|completed)
    [ "$LOG_COUNT" -lt 5 ] && WARNINGS="${WARNINGS}• Stage '${STAGE}' should have ≥5 logs covering the full task lifecycle. Currently: ${LOG_COUNT}. "
    ;;
esac

# --- Check 5: consecutive duplicate log messages ---
if [ "$LOG_COUNT" -gt 1 ]; then
  LAST_MSG=$(echo "$CONTENT" | jq -r '.logs[-1].msg // empty' 2>/dev/null)
  PREV_MSG=$(echo "$CONTENT" | jq -r '.logs[-2].msg // empty' 2>/dev/null)
  if [ -n "$LAST_MSG" ] && [ "$LAST_MSG" = "$PREV_MSG" ]; then
    WARNINGS="${WARNINGS}• Last two log entries are identical ('${LAST_MSG}') — each entry should describe a distinct action or finding. "
  fi
fi

# --- Check 6: milestones for later stages ---
MILESTONE_COUNT=$(echo "$CONTENT" | jq '.milestones | length' 2>/dev/null) || MILESTONE_COUNT=0
case "$STAGE" in
  implementing|testing|finalizing|completed)
    if [ "$MILESTONE_COUNT" -eq 0 ]; then
      WARNINGS="${WARNINGS}• No milestones at stage '${STAGE}' — add milestones for significant accomplishments (files created, features implemented, tests passed). "
    fi
    ;;
esac

# --- Emit warnings if any ---
if [ -n "$WARNINGS" ]; then
  warn "⚠️ PROGRESS LOG QUALITY: ${WARNINGS}Update your progress file with more detailed logs. Every log entry should describe what you did, what you found, or what you decided — never use vague placeholders."
fi

ok
