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

## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE

**1. You are the MASTER AGENT. You do NOT write code. You do NOT implement anything. You do NOT edit application files. You ONLY assess state, communicate with agents, and dispatch worker agents. No exceptions.**

**2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. Do not skip this. Do not work from memory. Read it NOW.**

**3. You MUST read the master task file to understand the full plan, task descriptions, context, and critical details before dispatching any worker.**

**4. Every dispatched worker gets a COMPLETE, SELF-CONTAINED prompt with all context needed to work independently — identical in quality and depth to what `!p_track` would produce.**

**5. Every dispatched worker is explicitly instructed to read the appropriate worker instructions file (`tracker_worker_instructions.md` or `tracker_worker_instructions_lite.md`). This is NON-NEGOTIABLE.**

**6. You MUST compile and deliver a comprehensive final report after all tasks complete. No exceptions. See Phase 5.**

**7. You MUST attempt to detect whether previously dispatched agents are still alive before re-dispatching them. Do not blindly re-dispatch everything — check progress file recency first.**

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
5. Log cache rebuild to `logs.json`:
   ```json
   {
     "timestamp": "{live via date -u}",
     "task_id": "0.0",
     "agent": "Orchestrator",
     "level": "info",
     "message": "Resume: rebuilt upstream cache from {N} completed progress files. master_state.json: {found | not found}.",
     "task_name": "{task-slug}"
   }
   ```

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

Display a comprehensive summary:

```markdown
## Resume Plan: {task-slug}

**Dashboard:** {dashboardId}
**Project:** {project_root}
**Task file:** {path to master task file}
**master_state.json:** {found | not found}
**Upstream cache:** {N entries rebuilt from {source}}

### Current State
| Status | Count | Tasks |
|---|---|---|
| Completed | {N} | {task_ids} |
| Failed (will retry) | {N} | {task_ids} |
| Likely alive (monitoring) | {N} | {task_ids} |
| Stale in-progress (will re-dispatch) | {N} | {task_ids} |
| Pending (ready) | {N} | {task_ids} |
| Pending (blocked) | {N} | {task_ids} |

### Will Dispatch Now: {total}
{List each task with ID, title, and reason (retry/re-dispatch/new)}

### Monitoring: {count}
{Agents that appear alive with current stage and last activity time}

### Still Blocked: {count}
{Blocked tasks and what they're waiting for}
```

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
2. Append to `logs.json`:
   ```json
   {
     "timestamp": "{timestamp}",
     "task_id": "{id}",
     "agent": "Agent {N}",
     "level": "info",
     "message": "Resumed: {task title} ({reason: retry | re-dispatch | new})",
     "task_name": "{task-slug}"
   }
   ```

**C. Write master state checkpoint** after all dispatches:
```json
{
  "last_updated": "{timestamp}",
  "completed": [{"id": "...", "summary": "..."}],
  "in_progress": ["{dispatched + monitoring task IDs}"],
  "failed": [{"id": "...", "summary": "...", "repair_id": "..."}],
  "ready_to_dispatch": [],
  "upstream_results": {rebuilt cache},
  "next_agent_number": {N},
  "permanently_failed": []
}
```

Output: "Resumed N tasks: {ids with reasons}. Monitoring M alive agents: {ids}."

---

## Phase 4: Execution Loop (Steps 12-15)

From this point, follow standard `!p_track` execution. You are the master orchestrator.

### Step 12: Process Completions & Dispatch

On **every worker completion:**

1. **Validate return** — per `agent/master/failure_recovery.md`:
   - STATUS missing -> treat as failure
   - SUMMARY generic -> log warn
   - FILES CHANGED missing for file-modifying task -> log warn
   - DIVERGENT ACTIONS -> log at "deviation" level

2. **Update master task file** with status, timestamp, summary, deviations.

3. **Append to logs.json** — completion entry at level `info`. Separate entries for deviations/warnings/errors.

4. **Cache result** for downstream injection (task ID, summary, files, exports, deviations).

5. **Run eager dispatch scan** — per `agent/master/eager_dispatch.md`:
   - Build completed set from progress files (all `status === "completed"`)
   - Build in-progress set (all `status === "in_progress"`)
   - Find dispatchable tasks: NOT completed, NOT in-progress, ALL `depends_on` in completed set
   - Dispatch ALL available tasks simultaneously with full prompts + upstream results
   - **Waves are visual, not barriers.** If wave-5 task has deps satisfied, dispatch NOW.

6. **Write master_state.json** after every event.

**No terminal status tables.** One-line confirmations only. Dashboard is the primary channel.

### Step 13: Handle Monitoring Agents

For "likely alive" agents from Phase 2:
- **If agent completes** — process normally (Step 12), run eager dispatch.
- **If no progress update for 10+ min** — reclassify as stale, save progress, delete file, build full prompt with RESUME CONTEXT, dispatch new worker, log re-dispatch.
- **If agent fails** — standard failure recovery per `agent/master/failure_recovery.md`.

### Step 14: Handle Failures

Follow `agent/master/failure_recovery.md`:

**Single failure:**
1. Log error to `logs.json`
2. Create repair task in `initialization.json`: ID `"{wave}.{next}r"`, title `"REPAIR: {original}"`, same wave/deps
3. Rewire downstream `depends_on` to point at repair task ID
4. Dispatch repair worker with `failed_task.md` protocol
5. Log repair dispatch
6. Run eager dispatch scan

**Double failure (repair task fails):**
1. Log error + permission popup
2. Do NOT create another repair — mark permanently failed
3. Continue with unrelated tasks

**Circuit breaker — evaluate after every failure:**

| Threshold | Condition |
|---|---|
| **A** | 3+ tasks failed in the same wave |
| **B** | Single failure blocks 3+ downstream tasks |
| **C** | Single failure blocks >50% remaining tasks |

If ANY threshold fires: pause dispatches, read all progress files, analyze root cause, produce revision plan (`modified`/`added`/`removed`/`retry`), apply to `initialization.json`, log, resume.

### Step 15: Handle Context Compaction

If context compaction drops upstream caches (detected by losing cached results for completed tasks):

1. Read `master_state.json` (checkpoint)
2. Read `initialization.json` (plan)
3. Read all progress files (authoritative ground truth)
4. Cross-reference and rebuild upstream cache
5. Log `warn` recovery entry
6. Resume dispatch

This is why `master_state.json` is written after every event.

---

## Phase 5: Completion — NON-NEGOTIABLE (Steps 16A-16F)

When all tasks reach `"completed"` or `"failed"`:

### 16A: Update Master Task File

Set `overall_status` to `"completed"` (or `"failed"` if unrecovered failures).

### 16B: Append Final Log Entry

```json
{
  "timestamp": "{live via date -u}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Swarm resumed and completed: {completed}/{total} tasks succeeded, {failed} failed",
  "task_name": "{task-slug}"
}
```

### 16C: Post-Swarm Verification

| Condition | Action |
|---|---|
| Modified existing code across multiple files | Dispatch verification agent (tests, types, build) |
| Purely additive (new files only) | Optional |
| Any tasks reported deviations | Strongly recommended |
| All succeeded, no warnings | May skip |

### 16D: Compute Metrics

Read all progress files. Compute and write `metrics.json`:

| Metric | Computation |
|---|---|
| `elapsed_seconds` | Latest `completed_at` - earliest `started_at` |
| `serial_estimate_seconds` | Sum of all task durations |
| `parallel_efficiency` | serial / elapsed |
| `duration_distribution` | { min, avg, max, median } of task durations |
| `failure_rate` | failed / total |
| `max_concurrent` | Peak overlapping in-progress tasks |
| `deviation_count` | Sum of all `deviations[]` lengths |

### 16E: Final Report — NON-NEGOTIABLE

> **Read ALL data before writing:** logs.json, every progress file, master task file, metrics.json.

```markdown
## Swarm Resumed & Completed: {task-slug}

**{completed}/{total} tasks** . **{W} waves** . **{N} failures** . **{elapsed}s elapsed** . **{efficiency}x parallel efficiency** . **Type: {Waves|Chains}** . **Resumed from: {dashboardId}**

---

### Summary of Work Completed (REQUIRED)
{Thorough summary — goal, what was built, how it works, design decisions,
current state. What was the state at resume? What additional work was needed?}

### Files Changed (REQUIRED)
| File | Action | Task | What Changed |
|---|---|---|---|

### Deviations & Their Impact (CONDITIONAL — if any)
For each: Task ID, what changed, why, impact on project.

### Warnings & Observations (CONDITIONAL — if any)

### Failures (CONDITIONAL — if any)
What failed, recovery attempted, blocked tasks, residual impact.

### Resume Details (REQUIRED)
- Tasks completed before resume: {N} ({ids})
- Tasks re-dispatched (stale): {N} ({ids})
- Tasks retried (failed): {N} ({ids})
- Tasks dispatched fresh (pending): {N} ({ids})
- Agents found alive during resume: {N} ({ids or "none"})

### Verification Results (CONDITIONAL — if verification ran)

### Potential Improvements (REQUIRED)
{Expert analysis from worker logs, deviations, code patterns.}

### Future Steps (REQUIRED)
{Concrete, actionable next steps.}

### Performance (REQUIRED)
| Metric | Value |
|---|---|

### Artifacts
- Task file: `{tracker_root}/tasks/{date}/parallel_{task_name}.json`
- Plan: `{tracker_root}/tasks/{date}/parallel_plan_{task_name}.md`
- Dashboard: `{tracker_root}/dashboards/{dashboardId}/initialization.json`
- Logs: `{tracker_root}/dashboards/{dashboardId}/logs.json`
- Metrics: `{tracker_root}/dashboards/{dashboardId}/metrics.json`
```

**Quality bar:** A developer not present during the swarm can read this and understand: (1) what was done, (2) what went sideways, (3) current project state, (4) what to do next.

### 16F: Save to History

Save history summary to `{tracker_root}/history/`.

---

## Key Schemas

### initialization.json

```json
{
  "task": {
    "name": "{task-slug}", "type": "Waves|Chains",
    "directory": "{optional}", "prompt": "{original prompt}",
    "project": "{directories}", "project_root": "{absolute path}",
    "created": "{ISO 8601}", "total_tasks": 0, "total_waves": 0
  },
  "agents": [
    { "id": "1.1", "title": "{~40 chars}", "wave": 1,
      "layer": "{optional}", "directory": "{optional}", "depends_on": [] }
  ],
  "waves": [{ "id": 1, "name": "{name}", "total": 0 }],
  "chains": [], "history": []
}
```

### master_state.json (checkpoint — write after every event)

```json
{
  "last_updated": "{ISO 8601}",
  "completed": [{ "id": "1.1", "summary": "..." }],
  "in_progress": ["2.1"],
  "failed": [{ "id": "2.2", "summary": "...", "repair_id": "2.4r" }],
  "ready_to_dispatch": ["3.1"],
  "upstream_results": { "1.1": "one-line summary" },
  "next_agent_number": 5,
  "permanently_failed": []
}
```

### logs.json entry

```json
{
  "timestamp": "{ISO 8601 — always live via date -u}",
  "task_id": "{wave.index or 0.0}",
  "agent": "{Orchestrator or Agent N}",
  "level": "info|warn|error|deviation|permission",
  "message": "{action verb first}",
  "task_name": "{task-slug}"
}
```

### metrics.json

```json
{
  "swarm_name": "{task-slug}", "computed_at": "{ISO 8601}",
  "elapsed_seconds": 0, "serial_estimate_seconds": 0,
  "parallel_efficiency": 0, "duration_distribution": { "min": 0, "avg": 0, "max": 0, "median": 0 },
  "failure_rate": 0, "max_concurrent": 0, "deviation_count": 0,
  "total_tasks": 0, "completed_tasks": 0, "failed_tasks": 0
}
```

---

## Dispatch & Tracking Rules

1. **Dispatch FIRST, update tracker AFTER** — launch agent before writing logs.json
2. **Dependency-driven dispatch, not wave-driven** — waves are visual only
3. **Fill all open slots simultaneously** — dispatch ALL ready tasks
4. **No artificial concurrency cap** — as many agents as there are ready tasks
5. **Errors do not stop the swarm** — circuit breaker at cascading failures only
6. **Dashboard is primary reporting** — no terminal status tables, one-line confirmations
7. **Tracker writes mandatory** — initialization.json once, logs.json every event
8. **Atomic writes only** — read -> modify -> write full file
9. **Timestamps live** — always `date -u +"%Y-%m-%dT%H:%M:%SZ"`
10. **Workers own lifecycle data** in progress files
11. **Agent prompts self-contained** with embedded conventions
12. **Workers skip CLAUDE.md re-read** if master provided conventions
13. **Cache every completion** for downstream injection
14. **Feed upstream results** into downstream prompts
15. **Reconstruct cache after compaction** from master_state.json + progress files
16. **Right-size tasks** — 1-5 min, 1-2 files modified
17. **Final report NON-NEGOTIABLE** — comprehensive, every section filled
18. **Permission popup before terminal questions** — write log entry first
19. **Check agent health before re-dispatch** — never blindly clobber running workers
20. **Archive before clear** — always archive to `Archive/` before clearing dashboard

## Instruction Mode Selection

| Criteria | FULL | LITE |
|---|---|---|
| Has upstream dependencies | Yes | |
| Modifies 3+ files | Yes | |
| Coordination with other tasks | Yes | |
| High deviation risk | Yes | |
| Simple, independent, single-file | | Yes |
| Well-defined, mechanical change | | Yes |

Default to FULL when uncertain.

## Module References

For deep detail on specific protocols, read these files:
- Master instructions: `agent/instructions/tracker_master_instructions.md`
- Dashboard writes: `agent/master/dashboard_writes.md`
- Worker prompts: `agent/master/worker_prompts.md`
- Eager dispatch: `agent/master/eager_dispatch.md`
- Failure recovery: `agent/master/failure_recovery.md`
- Compaction recovery: `agent/master/compaction_recovery.md`
- Failed task protocol: `agent/instructions/failed_task.md`
- Completion protocol: `agent/_commands/p_track_completion.md`
- Common pitfalls: `agent/instructions/common_pitfalls.md`
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
