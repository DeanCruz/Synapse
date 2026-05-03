#!/bin/bash
# check_workers.sh — Worker status checker for master/chat agents
#
# Reads all progress files in the active (or specified) dashboard and
# produces a human-readable status report.  Safe to call mid-swarm — it
# never writes to progress files.
#
# Usage:
#   bash agent/utils/check_workers.sh              # auto-detect active dashboard
#   bash agent/utils/check_workers.sh <dashboardId> # specific dashboard
#
# Output: plain-text status report printed to stdout.
# Exit 0 always (errors degrade to warnings inside the report).

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DASHBOARDS_DIR="$TRACKER_ROOT/dashboards"

# ── Resolve dashboard ────────────────────────────────────────────

DASHBOARD_ID="$1"

if [ -z "$DASHBOARD_ID" ]; then
  # Auto-detect: find the dashboard with the most recent progress file activity
  BEST_DIR=""
  BEST_MTIME=0
  for dir in "$DASHBOARDS_DIR"/*/; do
    [ -d "${dir}progress" ] || continue
    # Find newest progress file mtime (seconds since epoch)
    NEWEST=$(find "${dir}progress" -name "*.json" -type f -exec stat -f "%m" {} \; 2>/dev/null | sort -rn | head -1)
    [ -z "$NEWEST" ] && continue
    if [ "$NEWEST" -gt "$BEST_MTIME" ]; then
      BEST_MTIME=$NEWEST
      BEST_DIR="$dir"
    fi
  done

  if [ -z "$BEST_DIR" ]; then
    echo "No active dashboards found with progress files."
    exit 0
  fi
  DASHBOARD_ID=$(basename "$BEST_DIR")
fi

PROGRESS_DIR="$DASHBOARDS_DIR/$DASHBOARD_ID/progress"
INIT_FILE="$DASHBOARDS_DIR/$DASHBOARD_ID/initialization.json"

if [ ! -d "$PROGRESS_DIR" ]; then
  echo "Dashboard $DASHBOARD_ID has no progress directory."
  exit 0
fi

# ── Gather progress data ─────────────────────────────────────────

NOW=$(date +%s)
STALE_THRESHOLD=600  # 10 minutes

ACTIVE=0
COMPLETED=0
FAILED=0
STALE=0
TOTAL_FILES=0

REPORT=""
STALE_LIST=""
ACTIVE_LIST=""
COMPLETED_LIST=""
FAILED_LIST=""

for pf in "$PROGRESS_DIR"/*.json; do
  [ -f "$pf" ] || continue
  TOTAL_FILES=$((TOTAL_FILES + 1))

  # Parse fields with jq
  TASK_ID=$(jq -r '.task_id // "?"' "$pf" 2>/dev/null)
  STATUS=$(jq -r '.status // "unknown"' "$pf" 2>/dev/null)
  STAGE=$(jq -r '.stage // "?"' "$pf" 2>/dev/null)
  AGENT=$(jq -r '.assigned_agent // "?"' "$pf" 2>/dev/null)
  MESSAGE=$(jq -r '.message // ""' "$pf" 2>/dev/null)
  SUMMARY=$(jq -r '.summary // ""' "$pf" 2>/dev/null)
  FILES_COUNT=$(jq -r '.files_changed | length' "$pf" 2>/dev/null)
  [ "$FILES_COUNT" = "null" ] && FILES_COUNT=0
  LOGS_COUNT=$(jq -r '.logs | length' "$pf" 2>/dev/null)
  [ "$LOGS_COUNT" = "null" ] && LOGS_COUNT=0
  MILESTONES_COUNT=$(jq -r '.milestones | length' "$pf" 2>/dev/null)
  [ "$MILESTONES_COUNT" = "null" ] && MILESTONES_COUNT=0
  DEVIATIONS=$(jq -r '.deviations | length' "$pf" 2>/dev/null)
  [ "$DEVIATIONS" = "null" ] && DEVIATIONS=0
  STARTED_AT=$(jq -r '.started_at // ""' "$pf" 2>/dev/null)
  COMPLETED_AT=$(jq -r '.completed_at // ""' "$pf" 2>/dev/null)

  # Last log entry
  LAST_LOG=$(jq -r '.logs[-1].msg // ""' "$pf" 2>/dev/null)
  LAST_LOG_AT=$(jq -r '.logs[-1].at // ""' "$pf" 2>/dev/null)

  # Check file mtime for staleness (seconds since last modification)
  FILE_MTIME=$(stat -f "%m" "$pf" 2>/dev/null || echo "0")
  SECONDS_AGO=$((NOW - FILE_MTIME))
  if [ "$SECONDS_AGO" -lt 60 ]; then
    AGE_STR="${SECONDS_AGO}s ago"
  elif [ "$SECONDS_AGO" -lt 3600 ]; then
    AGE_STR="$((SECONDS_AGO / 60))m ago"
  else
    AGE_STR="$((SECONDS_AGO / 3600))h $((SECONDS_AGO % 3600 / 60))m ago"
  fi

  IS_STALE=false
  if [ "$STATUS" = "in_progress" ] && [ "$SECONDS_AGO" -gt "$STALE_THRESHOLD" ]; then
    IS_STALE=true
    STALE=$((STALE + 1))
  fi

  # Build per-task line
  ENTRY="  [$TASK_ID] $AGENT"
  case "$STATUS" in
    in_progress)
      ACTIVE=$((ACTIVE + 1))
      if $IS_STALE; then
        ENTRY="$ENTRY — STALE ($AGE_STR since last update)"
        ENTRY="$ENTRY\n    Stage: $STAGE | Files: $FILES_COUNT | Logs: $LOGS_COUNT | Milestones: $MILESTONES_COUNT"
        [ -n "$MESSAGE" ] && ENTRY="$ENTRY\n    Current: $MESSAGE"
        [ -n "$LAST_LOG" ] && ENTRY="$ENTRY\n    Last log: $LAST_LOG"
        [ "$DEVIATIONS" -gt 0 ] && ENTRY="$ENTRY\n    ⚠ $DEVIATIONS deviation(s)"
        STALE_LIST="$STALE_LIST\n$ENTRY"
      else
        ENTRY="$ENTRY — ACTIVE ($AGE_STR)"
        ENTRY="$ENTRY\n    Stage: $STAGE | Files: $FILES_COUNT | Logs: $LOGS_COUNT | Milestones: $MILESTONES_COUNT"
        [ -n "$MESSAGE" ] && ENTRY="$ENTRY\n    Current: $MESSAGE"
        [ "$DEVIATIONS" -gt 0 ] && ENTRY="$ENTRY\n    ⚠ $DEVIATIONS deviation(s)"
        ACTIVE_LIST="$ACTIVE_LIST\n$ENTRY"
      fi
      ;;
    completed)
      COMPLETED=$((COMPLETED + 1))
      ENTRY="$ENTRY — COMPLETED"
      [ -n "$SUMMARY" ] && ENTRY="$ENTRY\n    Summary: $SUMMARY"
      ENTRY="$ENTRY\n    Files: $FILES_COUNT | Logs: $LOGS_COUNT"
      [ "$DEVIATIONS" -gt 0 ] && ENTRY="$ENTRY | ⚠ $DEVIATIONS deviation(s)"
      COMPLETED_LIST="$COMPLETED_LIST\n$ENTRY"
      ;;
    failed)
      FAILED=$((FAILED + 1))
      ENTRY="$ENTRY — FAILED"
      [ -n "$SUMMARY" ] && ENTRY="$ENTRY\n    Reason: $SUMMARY"
      [ -n "$LAST_LOG" ] && ENTRY="$ENTRY\n    Last log: $LAST_LOG"
      FAILED_LIST="$FAILED_LIST\n$ENTRY"
      ;;
    *)
      ENTRY="$ENTRY — $STATUS"
      ACTIVE_LIST="$ACTIVE_LIST\n$ENTRY"
      ;;
  esac
done

# ── Count pending tasks from initialization.json ──────────────────

PENDING=0
if [ -f "$INIT_FILE" ] && command -v jq &>/dev/null; then
  TOTAL_PLANNED=$(jq '[.agents[]] | length' "$INIT_FILE" 2>/dev/null || echo 0)
  PENDING=$((TOTAL_PLANNED - TOTAL_FILES))
  [ "$PENDING" -lt 0 ] && PENDING=0
fi

# ── Print report ──────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════╗"
echo "║           Worker Status — Dashboard $DASHBOARD_ID"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Active: $ACTIVE   Completed: $COMPLETED   Failed: $FAILED   Pending: $PENDING   Stale: $STALE"
echo "╚══════════════════════════════════════════════════════╝"

if [ "$STALE" -gt 0 ]; then
  echo ""
  echo "⚠ STALE WORKERS (no update in ${STALE_THRESHOLD}s+):"
  echo -e "$STALE_LIST"
  echo ""
  echo "  → Consider running: !retry <task_id>  to re-dispatch stale tasks"
fi

if [ -n "$FAILED_LIST" ]; then
  echo ""
  echo "✗ FAILED:"
  echo -e "$FAILED_LIST"
fi

if [ -n "$ACTIVE_LIST" ]; then
  echo ""
  echo "● ACTIVE:"
  echo -e "$ACTIVE_LIST"
fi

if [ -n "$COMPLETED_LIST" ]; then
  echo ""
  echo "✓ COMPLETED:"
  echo -e "$COMPLETED_LIST"
fi

if [ "$PENDING" -gt 0 ]; then
  echo ""
  echo "○ $PENDING task(s) pending dispatch (dependencies not yet satisfied)"
fi

echo ""
echo "Last checked: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
