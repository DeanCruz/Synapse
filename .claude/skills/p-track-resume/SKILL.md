---
name: p-track-resume
description: >
  Resume a stalled, interrupted, or partially completed Synapse swarm. Reconstructs state
  from dashboard files, checks agent health, re-dispatches stuck/failed tasks, and runs
  the full execution-to-completion lifecycle with comprehensive reporting.
argument-hint: "[--dashboard <id>]"
user-invocable: true
context: fork
model: opus
---

# Synapse Swarm Resume — !p_track_resume

## NON-NEGOTIABLE RULES

**The master-protocol skill provides your core identity, constraints, and schemas. Follow it absolutely.**

**Additionally for resume:**

**1. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files.**

**2. You MUST read the master task file to understand full task descriptions before dispatching any worker.**

**3. Every dispatched worker gets a COMPLETE, SELF-CONTAINED prompt — identical in quality to what `!p_track` produces.**

**4. You MUST attempt to detect whether previously dispatched agents are still alive before re-dispatching.**

**5. You MUST compile and deliver a comprehensive final report. No exceptions. See Phase 5.**

---

## Dynamic Context

!`echo "PROJECT_ROOT: $(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null || echo 'UNSET — resolve before planning')"`
!`echo "TRACKER_ROOT: $(pwd)"`
!`echo "DATE: $(date -u +%Y-%m-%dT%H:%M:%SZ)"`
!`echo "TASK_DATE: $(date -u +%m_%d_%y)"`
!`echo "AVAILABLE_DASHBOARDS: $(ls dashboards/ 2>/dev/null | grep -v ide | tr '\n' ' ')"`
!`echo "DASHBOARD_STATES: $(for d in $(ls dashboards/ 2>/dev/null | grep -v ide); do init=$(cat dashboards/$d/initialization.json 2>/dev/null | jq -r '.task.name // empty' 2>/dev/null); prog=$(ls dashboards/$d/progress/ 2>/dev/null | wc -l | tr -d ' '); echo \"$d:task=${init:-empty},progress=$prog\"; done | tr '\n' ' ')"`

## Project Context

!`cat "$(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null)/CLAUDE.md" 2>/dev/null | head -100 || echo "No project CLAUDE.md found — scan the project structure to understand the codebase layout."`

---

## Phase 1: State Reconstruction (Steps 1-5)

### Step 1: Resolve the Dashboard

**If `--dashboard {id}` was specified:** Use it directly.

**If auto-detecting:** Scan all dashboards (excluding `ide`). For each:
1. Read `initialization.json` — if `task` is `null`, skip (empty).
2. Read all progress files from `progress/`.
   - If every progress file has `status: "completed"` — skip (fully done).
   - If any has `"in_progress"`, `"failed"`, or is missing (task in `agents[]` but no progress file) — select this dashboard.
3. If no resumable dashboard found, report: "No dashboards have incomplete swarms to resume." List all states.

### Step 2: Read Full Dashboard State

Read in parallel:
1. **`initialization.json`** — Full plan: task metadata, agents array, waves, chains, `task.project_root`.
2. **All progress files** from `progress/` — Build status map: `{ task_id -> { status, summary, deviations, logs, started_at, completed_at, stage, milestones } }`.
3. **`logs.json`** — Event history. Note last timestamp and highest agent number.
4. **`master_state.json`** (if exists) — Previous master cache: completed/in-progress/failed tasks, upstream results, `next_agent_number`, permanently failed.

### Step 3: Locate and Read Master Task File

1. Extract `task.name` (slug) and `task.created` (date) from `initialization.json`.
2. Look for: `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
   - Fallback: `{tracker_root}/tasks/*/parallel_{task_name}.json`
3. **Read the full master task file** — you need every task's `description`, `context`, `critical`, `files`, `tags`, `depends_on`.

### Step 4: Read Project Context

1. **Resolve `{project_root}`** from `task.project_root` in `initialization.json`. Fallback: `.synapse/project.json` -> CWD.
2. **Read `{project_root}/CLAUDE.md`** if it exists.
3. Check `{project_root}/.synapse/toc.md` for orientation.
4. **Build convention_map** — categorize rules from CLAUDE.md into: `naming`, `file_structure`, `imports`, `frontend_styling`, `backend_api`, `error_handling`, `testing`, `types`. Used for filtering conventions per-worker.

### Step 5: Rebuild Upstream Result Cache

1. **Start with `master_state.json`** (if exists) — its `upstream_results` has one-line summaries per completed task.
2. **Cross-reference against progress files** (progress files are authoritative if conflict):
   - For each `status: "completed"` progress file, verify cache has an entry.
   - If missing, reconstruct from `summary`, `milestones[]`, and `deviations[]`.
3. If no `master_state.json`, build entire cache from completed progress files.
4. **Determine `next_agent_number`:**
   - From `master_state.json` if available.
   - Otherwise, scan `logs.json` for highest `Agent {N}` reference, set to N+1.
   - If logs empty, set to 1.
5. Log cache rebuild to `logs.json`: `"Resume: rebuilt upstream cache from {N} completed progress files. master_state.json: {found | not found}."`

---

## Phase 2: Agent Health Check & Classification (Steps 6-8)

> **Do not blindly re-dispatch everything.** The previous master session is dead, but worker agents may still be alive.

### Step 6: Check Agent Health

For each task with `status: "in_progress"`, assess worker health:

**Alive indicators (ANY suggests still running):**
- Most recent `milestones[]` or `logs[]` entry within the last **10 minutes**
- `stage` shows active work (`implementing`, `testing`) and file was modified recently

**Stale indicators (ALL suggest dead):**
- No milestone or log entry within the last **10 minutes**
- `started_at` is more than **20 minutes** old with no recent updates
- `stage` is still `reading_context` or `planning` after more than **10 minutes**
- Progress file has not been modified since the previous master session died

**Classification decision:**

| Evidence | Classification | Action |
|---|---|---|
| Recent milestone/log within 10 min | **Likely alive** | Monitor — do NOT re-dispatch |
| No recent activity, started < 20 min ago | **Uncertain** | Monitor 2-3 min. If no update, reclassify stale. |
| No recent activity, started > 20 min ago | **Stale** | Mark for re-dispatch. Save progress for retry context. |
| `stage: "completed"` but `status: "in_progress"` | **Likely completed** | Treat as completed. Worker finished but master never processed return. |

### Step 7: Classify Every Task

For each agent in `initialization.json`'s `agents[]`:

| Category | Condition | Action |
|---|---|---|
| **Completed** | Progress `status: "completed"` | Skip. Cache result for downstream. |
| **Failed** | Progress `status: "failed"` | Re-dispatch with failure context (`!retry` style). |
| **Likely Alive** | `in_progress` with recent activity | Monitor. Do NOT re-dispatch. |
| **Stale In-Progress** | `in_progress` with no recent activity | Re-dispatch with partial progress context. |
| **Pending (ready)** | No progress file, all `depends_on` completed | Dispatch immediately. |
| **Pending (blocked)** | No progress file, some `depends_on` not completed | Wait for deps. |

### Step 8: Present Resume Plan

Display a comprehensive summary with header `## Resume Plan: {task-slug}` including:
- **Context line:** Dashboard ID, project root, task file path, master_state.json status, upstream cache size
- **Current State table:** Status (Completed/Failed/Likely alive/Stale/Pending ready/Pending blocked) with count and task IDs per row
- **Will Dispatch Now:** Each task with ID, title, reason (retry/re-dispatch/new)
- **Monitoring:** Alive agents with current stage and last activity time
- **Still Blocked:** Blocked tasks and what they await

**Wait for user approval before dispatching.**

---

## Phase 3: Cleanup, Dispatch & Monitor (Steps 9-11)

### Step 9: Clean Up Stale Progress Files

For each task being re-dispatched (failed or stale):
1. **Save** the previous progress file contents (failure summary, logs, deviations, stage) for retry context.
2. **Delete** the old progress file: `rm -f {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`

**Do NOT delete progress files for "likely alive" agents.**

### Step 10: Build Worker Prompts

For each task to dispatch, build a **complete, self-contained prompt**. Read `{tracker_root}/agent/master/worker_prompts.md` for the full template. Every prompt MUST include:

```
You are a worker agent in the "{task-slug}" swarm, executing task {id}.
TEMPLATE_VERSION: p_track_v2

[TASK header with DESCRIPTION, CONTEXT, PROJECT ROOT, TRACKER ROOT]
[CONVENTIONS — filtered from convention_map, only relevant categories]
[REFERENCE CODE — patterns from the codebase]
[UPSTREAM RESULTS — structured per-dependency summaries]
[SIBLING TASKS — optional, same-wave related files]
[CRITICAL — edge cases, gotchas]
[SUCCESS CRITERIA — verifiable "done" conditions]
[FILES — READ/MODIFY/CREATE list]
[DIRECTORY]

═══════════════════════════════════
RESUME CONTEXT
═══════════════════════════════════

NOTE: This is a RESUMED swarm. Some tasks completed by previous workers.
The project may already contain files from earlier tasks. Read actual file
state before making changes — do not assume pre-swarm state.

{If RETRY of failed/stale task:}
PREVIOUS ATTEMPT:
This task was previously attempted and {failed | was interrupted}.
Previous status: {from old progress file}
Previous stage: {from old progress file}
Previous summary: {if any}
Previous milestones: {key accomplishments before interruption}
Previous logs: {key entries about what happened}
Previous deviations: {any reported}

ROOT CAUSE ANALYSIS:
{Master's analysis of what went wrong}

REMEDIATION GUIDANCE:
{Specific instructions to avoid same failure or continue from partial state}

═══════════════════════════════════
PREPARATION — REQUIRED BEFORE STARTING WORK
═══════════════════════════════════

1. READ YOUR TASK IN THE MASTER TASK FILE
2. READ PROJECT INSTRUCTIONS (if CONVENTIONS empty)
3. CHECK ACTUAL FILE STATE (resumed swarm — files may be modified)
4. READ UPSTREAM DEPENDENCY PROGRESS FILES
5. READINESS CHECKLIST

═══════════════════════════════════
LIVE PROGRESS REPORTING — NON-NEGOTIABLE
═══════════════════════════════════

INSTRUCTION MODE: {FULL | LITE}
Read: {tracker_root}/agent/instructions/tracker_worker_instructions{_lite}.md
YOUR PROGRESS FILE: {tracker_root}/dashboards/{dashboardId}/progress/{id}.json
YOUR TASK ID: {id}
YOUR AGENT LABEL: Agent {N}

═══════════════════════════════════
RETURN FORMAT
═══════════════════════════════════

STATUS: completed | failed
SUMMARY: {one-sentence description}
FILES CHANGED: ...
```

**Prompt Completeness Checklist** — before dispatching, verify:
- File paths (every file listed with full path)
- CLAUDE.md conventions (filtered by relevance)
- Reference code (if following existing patterns)
- Upstream results (summary, files, exports, deviations, KEY DETAILS per dep)
- Resume context (previous attempt details for retries)
- Actual file state instruction (check files before modifying)
- Success criteria (unambiguous "done" conditions)
- Critical details (edge cases, gotchas)
- Both paths (`{tracker_root}` AND `{project_root}`)
- Dashboard ID in progress file path
- Worker instructions (FULL or LITE mode)

### Step 11: Dispatch All Ready Tasks

Dispatch **every ready task simultaneously** (failed retries, stale re-dispatches, pending with satisfied deps).

**A. Launch the agent FIRST** — dispatch via Task tool with the full prompt.

**B. Update tracker AFTER dispatch (NON-NEGOTIABLE):**
1. Capture timestamp: `date -u +"%Y-%m-%dT%H:%M:%SZ"`
2. Append to `logs.json` (see master-protocol for schema): message = `"Resumed: {task title} ({reason: retry | re-dispatch | new})"`

**C. Write master state checkpoint** after all dispatches (see master-protocol for master_state.json schema). Include all dispatched + monitoring task IDs in `in_progress`.

Output: "Resumed N tasks: {ids with reasons}. Monitoring M alive agents: {ids}."

---

## Phase 4: Execution Loop (Steps 12-15)

From this point, follow standard `!p_track` execution. You are the master orchestrator.

### Step 12: Process Completions & Dispatch

On **every worker completion:**

1. **Validate return** per failure-protocol skill.
2. **Update master task file** with status, timestamp, summary, deviations.
3. **Append to logs.json** — completion entry. Separate entries for deviations/warnings/errors.
4. **Cache result** for downstream injection.
5. **Run eager dispatch scan** per master-protocol (build completed/in-progress sets, dispatch ALL tasks with satisfied deps). Waves are visual, not barriers.
6. **Write master_state.json** after every event.

One-line confirmations only. Dashboard is the primary channel.

### Step 13: Handle Monitoring Agents

For "likely alive" agents from Phase 2:
- **If agent completes** — process normally (Step 12), run eager dispatch.
- **If no progress update for 10+ min** — reclassify as stale, save progress, delete file, build full prompt with RESUME CONTEXT, dispatch new worker, log re-dispatch.
- **If agent fails** — standard failure recovery per `agent/master/failure_recovery.md`.

### Step 14: Handle Failures

See the failure-protocol skill for complete failure handling:
- **Single failure:** Create repair task -> rewire deps -> dispatch repair worker
- **Double failure:** Permanent failure -> escalate to user
- **Circuit breaker:** Pause -> analyze -> revise plan -> resume

Evaluate circuit breaker thresholds after every failure (3 conditions from failure-protocol).

### Step 15: Handle Context Compaction

If context compaction drops upstream caches, recover from `master_state.json` + `initialization.json` + progress files. Cross-reference, rebuild cache, log `warn`, resume. This is why `master_state.json` is written after every event.

---

## Phase 5: Completion — NON-NEGOTIABLE (Steps 16A-16F)

When all tasks reach `"completed"` or `"failed"`:

### 16A: Update Master Task File

Set `overall_status` to `"completed"` (or `"failed"` if unrecovered failures).

### 16B: Append Final Log Entry

Append a log entry (see master-protocol for schema) with `task_id: "0.0"`, `agent: "Orchestrator"`, `level: "info"`, message: `"Swarm resumed and completed: {completed}/{total} tasks succeeded, {failed} failed"`.

### 16C: Post-Swarm Verification

Dispatch verification agent if: multi-file modifications or deviations reported. Optional for purely additive changes. May skip if all succeeded with no warnings.

### 16D: Compute Metrics

Read all progress files. Compute and write `metrics.json` per the master-protocol schema (elapsed_seconds, serial_estimate_seconds, parallel_efficiency, duration_distribution, failure_rate, max_concurrent, deviation_count).

### 16E: Final Report — NON-NEGOTIABLE

> **Read ALL data before writing:** logs.json, every progress file, master task file, metrics.json.

Header: `## Swarm Resumed & Completed: {task-slug}` with stats line (completed/total, waves, failures, elapsed, parallel efficiency, type, resumed from dashboard).

**Required sections:** Summary of Work Completed, Files Changed (table: File/Action/Task/What Changed), Resume Details (tasks completed before resume, re-dispatched stale, retried failed, dispatched fresh, agents found alive), Potential Improvements, Future Steps, Performance (metrics table), Artifacts (task file, plan, dashboard, logs, metrics paths).

**Conditional sections (include if applicable):** Deviations & Their Impact, Warnings & Observations, Failures, Verification Results.

**Quality bar:** A developer not present during the swarm can read this and understand: (1) what was done, (2) what went sideways, (3) current project state, (4) what to do next.

### 16F: Save to History

Save history summary to `{tracker_root}/history/`.

---

## Key Schemas

See master-protocol skill for all dashboard write schemas (initialization.json, logs.json, master_state.json, metrics.json). The master-protocol auto-loads and provides compact schema references.

---

## Dispatch & Tracking Rules

See master-protocol skill for complete dispatch and tracking rules.

**Resume-specific additions:**
1. Check agent health before re-dispatch — never blindly clobber running workers
2. Include RESUME CONTEXT in re-dispatched worker prompts
3. Build upstream cache from master_state.json + progress files
4. Final report NON-NEGOTIABLE — include Resume Details section

### Instruction Mode Selection

See the p-track skill for the instruction mode selection table. Default to FULL when uncertain.

## Module References

The master-protocol and failure-protocol skills cover schemas, dispatch rules, failure recovery, and pitfalls. For deep detail, read:
- Worker prompts: `agent/master/worker_prompts.md`
- Completion protocol: `agent/_commands/p_track_completion.md`
- Worker instructions: `agent/instructions/tracker_worker_instructions.md`

---

## Post-Swarm Behavior

Once all workers finish and the final report is delivered, the swarm is over. Only at this point may the master resume normal agent behavior (including direct code edits) if the user requests non-parallel work.

---

## Quick Reference: Resume Commands

| Command | Scope | Description |
|---|---|---|
| `!p_track_resume` | Full lifecycle | Comprehensive resume: state reconstruction, health check, full dispatch, execution loop, NON-NEGOTIABLE final report |
| `!track_resume` | Dispatch-focused | Lighter resume: state assessment, re-dispatch, monitor completion |
| `!dispatch --ready` | Pending only | Dispatch tasks with satisfied deps. No retry of failed tasks |
| `!retry {id}` | Single task | Re-dispatch one specific failed task with failure context |
| `!resume` | Chat session | Resume non-swarm chat. Not for swarm orchestration |

---

Resume the swarm for dashboard: $ARGUMENTS
