# Failure Recovery & Circuit Breaker

> **Self-contained module for the master agent's failure handling and recovery procedures.** This document covers single-task failure recovery via repair tasks, double failure handling, the circuit breaker for cascading failures with automatic replanning, worker return validation, and the core error resilience principle that governs swarm behavior during failures.

> **REMINDER: The master NEVER writes code during a swarm.** Not one line. Not a "quick fix." Not "just this one file." If you are about to edit an application file — STOP. Create a worker task instead.

---

## On Failure — Automatic Recovery via Repair Tasks

> **WARNING: Do NOT fix the failed task yourself.** Fixing code is a code-writing violation.
> Always create a repair task and dispatch it to a new worker agent. The only acceptable master
> actions are: logging the failure, creating a repair task, and dispatching a worker.

> **TEMPTATION WARNING — Read this every time a worker fails.**
>
> When a worker fails, you will feel a strong urge to "just fix it quickly" yourself. **Resist this urge completely.** Common temptation patterns:
>
> - "It's just a one-line fix" — **NO.** Create a repair worker task.
> - "I can see exactly what went wrong" — **NO.** Put that diagnosis in the repair worker's prompt and dispatch it.
> - "It'll be faster if I do it" — **NO.** Speed is not an excuse. The no-code constraint is absolute.
> - "The worker made a silly mistake" — **NO.** Dispatch a repair worker with the error context.
> - "I'll just edit this config file" — **NO.** Config files are application files. Dispatch a worker.
>
> **The ONLY things you do when a worker fails:** (1) log the failure, (2) create a repair task in `initialization.json`, (3) dispatch a repair worker agent. That is the complete list. There are no exceptions.

When a worker returns with `status: "failed"`, the master does NOT treat the failed task as completed. **Failed tasks do not satisfy dependencies.** Any downstream task with the failed task in its `depends_on` remains blocked. However, the master MUST still run the eager dispatch scan — other dependency chains unrelated to the failure may have been freed by concurrent completions.

**The master's failure recovery procedure is:**

### Step 0 — Check for Double Failure

If the failed task's ID ends with `r` (it is a repair task), do NOT create another repair task. Instead:

1. Log an `"error"` level entry to `logs.json`: `"Double failure: repair task {id} failed. Original task permanently blocked."`
2. Log a `"permission"` level entry to trigger the dashboard popup: `"Repair task {id} failed — manual intervention required."`
3. **Skip Steps 1-6** — do NOT create a repair task for a failed repair task
4. Proceed to Step 7 (eager dispatch scan) as normal — other unblocked tasks continue

### Step 1 — Log the Failure

Write an `"error"` level entry to `logs.json` with the failed task's summary/error.

### Step 2 — Create a Repair Task in `initialization.json`

The master adds a new agent entry to the `agents[]` array in `initialization.json`. This is the **one exception** to the "initialization.json is write-once" rule — repair tasks are appended to `agents[]` and `total_tasks` / the relevant `waves[].total` are incremented.

The repair task:
- **ID:** `"{failed_task_wave}.{next_available_index}r"` — the `r` suffix marks it as a repair task (e.g., if `2.1` failed and wave 2 has 3 tasks, the repair ID is `"2.4r"`).
- **Wave:** Same wave as the failed task.
- **Title:** `"REPAIR: {original task title}"` — prefixed so it's immediately recognizable on the dashboard.
- **Layer:** Same as the failed task (if any).
- **Directory:** Same as the failed task (if any).
- **`depends_on`:** Identical to the failed task's `depends_on` — the repair task has the same prerequisites (which are already satisfied, since the original task was dispatched).

### Step 3 — Rewire the Dependency Chain

Every task in `agents[]` that had the failed task's ID in its `depends_on` must be updated to depend on the **repair task's ID** instead. This splices the repair task into the dependency chain as a drop-in replacement.

Example: If `2.1` failed and the repair task is `2.4r`:
- Task `3.1` had `depends_on: ["2.1"]` -> update to `depends_on: ["2.4r"]`
- Task `3.2` had `depends_on: ["2.1", "1.2"]` -> update to `depends_on: ["2.4r", "1.2"]`

### Step 4 — Update `chains[]` if Applicable

If `task.type` is `"Chains"`, find the chain containing the failed task and insert the repair task ID immediately after the failed task's ID in the chain's `tasks[]` array.

### Step 5 — Dispatch the Repair Worker

Send a worker agent with instructions from `{tracker_root}/agent/instructions/failed_task.md`. The dispatch prompt must include:
- The failed task's original dispatch prompt (full context)
- The failed task's progress file contents (error details, logs, deviations)
- The failed task's summary/error description
- The repair task's ID and progress file path
- Clear instruction to follow the `failed_task.md` protocol: enter planning mode first, diagnose the root cause, plan the fix, then implement

### Step 6 — Log the Repair Dispatch

Write an `"info"` level entry to `logs.json`: `"Dispatching repair task {repair_id} for failed task {failed_id} — {brief reason}"`.

### Step 7 — Run the Eager Dispatch Scan as Normal

The repair task is now in-progress. Other unblocked tasks (unrelated to the failure) are dispatched. The pipeline continues.

> **Permission gate for major deviations:** The repair worker follows `failed_task.md`, which instructs it to diagnose and fix the issue autonomously for straightforward failures. If the repair requires a **major deviation** from the original plan (e.g., the approach is fundamentally wrong, a dependency is missing, the task scope needs to change), the repair worker reports back to the master instead of proceeding. The master then writes a `"permission"` log entry and asks the user for guidance before continuing. See `agent/instructions/failed_task.md` for the full repair worker protocol.

---

## Example Scenario — Failure Recovery

```
agents[] contains:
  1.1 (depends_on: [])         <- Wave 1, already completed
  1.2 (depends_on: [])         <- Wave 1, already completed
  2.1 (depends_on: ["1.1"])    <- Wave 2, already in_progress
  2.2 (depends_on: ["1.2"])    <- Wave 2, already completed
  3.1 (depends_on: ["2.1"])    <- Wave 3, blocked (2.1 not done)
  3.2 (depends_on: ["2.2"])    <- Wave 3, available! (2.2 is done)
  4.1 (depends_on: ["3.1", "3.2"]) <- Wave 4, blocked

Worker 2.1 returns with status: "failed".

Completed set: {1.1, 1.2, 2.2} (2.1 is NOT completed — it failed)

Step 1 — Log the failure to logs.json.

Step 2 — Create repair task in initialization.json:
  New agent: 2.4r (depends_on: ["1.1"], title: "REPAIR: Add auth middleware", wave: 2)
  Increment task.total_tasks: 7 -> 8
  Increment waves[1].total: 3 -> 4

Step 3 — Rewire dependencies:
  3.1 had depends_on: ["2.1"] -> update to depends_on: ["2.4r"]

Step 4 — Dispatch repair worker 2.4r with failed_task.md protocol.

Step 5 — Run eager dispatch scan:
  3.1 — depends_on: ["2.4r"] -> 2.4r NOT in completed set -> BLOCKED (waiting for repair)
  3.2 — depends_on: ["2.2"] -> already in_progress -> SKIP
  4.1 — depends_on: ["3.1", "3.2"] -> BLOCKED

  No additional tasks to dispatch (but 2.4r is already dispatched as the repair).

Later, when 2.4r completes successfully:
  Completed set: {1.1, 1.2, 2.2, 2.4r}
  3.1 — depends_on: ["2.4r"] -> 2.4r IS in completed set -> DISPATCH
  Pipeline continues as if 2.1 had succeeded.
```

---

## Circuit Breaker — Automatic Replanning

When the circuit breaker fires, the master performs inline replanning. The circuit breaker triggers when any of these thresholds are met:

- **3+ tasks fail within the same wave** — suggests a shared root cause, not isolated failures
- **A single failure blocks 3+ downstream tasks** — the failure is cascading through the dependency graph
- **A single failure blocks more than half of all remaining tasks** — critical-path failure

Whichever threshold is hit first triggers the circuit breaker.

### Step 1 — Pause Dispatches

No new workers are dispatched until replanning completes. Set an internal replanning flag.

### Step 2 — Gather Failure Context

Read ALL progress files from `{tracker_root}/dashboards/{dashboardId}/progress/`. Build three lists:
- **Completed tasks:** ID and one-line summary
- **Failed tasks:** ID, summary, stage at failure, error from `logs[]`, `deviations[]`
- **Pending/blocked tasks:** ID, `depends_on` list, which deps are failed vs completed

### Step 3 — Analyze Root Cause

Examine the failed tasks and determine:
- Are the failures related? (Same file, same pattern, same dependency?)
- Is there a shared root cause? (Missing prerequisite, wrong assumption in the plan, environmental issue?)
- Which parts of the dependency graph are salvageable?

### Step 4 — Produce a Revision Plan

Create a structured revision with four categories:

| Category | Description |
|---|---|
| `modified` | Existing pending tasks whose descriptions or `depends_on` need updating (e.g., rewiring around a permanently failed chain) |
| `added` | New repair/replacement tasks with IDs suffixed with `r` (e.g., `"2.1r"`, `"3.2r"`). Each has: id, title (prefixed "REPAIR:"), wave, depends_on, full task description |
| `removed` | Pending tasks that are no longer viable (their entire dependency chain is broken). Removed from `agents[]` and their IDs cleaned from all other tasks' `depends_on` arrays |
| `retry` | Failed tasks to re-dispatch as-is (transient failures like timeouts). Their progress files are deleted so workers start fresh |

### Step 5 — Apply the Revision to initialization.json

This is the documented exception to the write-once rule:
1. Read `initialization.json`
2. For `modified` tasks: update the matching `agents[]` entry's title, `depends_on`, or other fields
3. For `added` tasks: append new entries to `agents[]`, increment `task.total_tasks` and the relevant `waves[].total`
4. For `removed` tasks: remove from `agents[]`, decrement `task.total_tasks` and `waves[].total`, scan all remaining agents' `depends_on` arrays and remove references to removed task IDs
5. For `retry` tasks: delete their progress files from `dashboards/{dashboardId}/progress/`
6. Write the updated `initialization.json`

### Step 6 — Log the Replanning Outcome

Write an `"info"` level entry to `logs.json`:
`"Replanning complete — modified: {N}, added: {N}, removed: {N}, retry: {N}. Resuming dispatch."`

### Step 7 — Resume Dispatch

Clear the replanning flag and resume the normal eager dispatch scan.

### Example: Shared Utility Failure

Three tasks in wave 2 (2.1, 2.2, 2.3) all fail because they depend on a shared utility that task 1.3 was supposed to create but created incorrectly. The replanner:
1. Identifies the shared root cause: task 1.3's output is broken
2. Adds a repair task `1.4r` with title "REPAIR: Fix shared utility from 1.3" and full context about what went wrong
3. Modifies tasks 2.1, 2.2, 2.3: updates their `depends_on` to include `1.4r`
4. Sets all three as `retry` (their progress files are deleted)
5. Applies the revision: agents[] gains 1.4r, tasks 2.1-2.3 gain the new dependency
6. Resumes dispatch: 1.4r is immediately dispatchable (no deps), and once it completes, 2.1-2.3 become dispatchable

**Note:** During replanning, bulk operations replace individual repair task creation. The standard repair task procedure (Steps 1-6 in the failure section above) is for single failures; the circuit breaker handles cascading failures.

---

## Principle 5 — Errors Don't Stop the Swarm (But Cascading Failures Trigger Automatic Replanning)

A failed task blocks only its direct dependents. Everything else continues. Log the error, mark the task, keep dispatching.

**Circuit breaker thresholds** (whichever is hit first triggers automatic replanning):
- **3+ tasks fail within the same wave** — suggests a shared root cause, not isolated failures
- **A single failure blocks 3+ downstream tasks** — the failure is cascading through the dependency graph
- **A single failure blocks more than half of all remaining tasks** — critical-path failure

**Automatic replanning:** When the circuit breaker fires, the master performs replanning inline: (a) pauses all new dispatches, (b) reads all progress files to build a full picture of completed, failed, and blocked tasks, (c) analyzes root cause from failure patterns, (d) produces a revision plan with four categories — `modified` (updated pending tasks), `added` (new repair tasks with `r`-suffixed IDs), `removed` (no longer viable tasks), and `retry` (re-dispatch as-is) — (e) applies the revision to `initialization.json` (the documented exception to write-once), and (f) resumes dispatch.

**Fallback:** If replanning analysis fails to produce a valid revision (e.g., the master cannot determine root cause or all remaining tasks are blocked), the swarm pauses for manual intervention rather than pushing through blind. The user can then manually retry tasks or cancel the swarm.

Never blindly push through cascading failures.

---

## Worker Return Validation

When a worker agent returns, the master must validate the return text **before** processing it as a completion and before the eager dispatch scan. This validation catches malformed returns early and prevents silent data loss.

### Validation Table

| Section | Required? | Validation |
|---|---|---|
| `STATUS` | Yes | Must be one of: `COMPLETED`, `FAILED`, `PARTIAL`. If missing, treat the return as a failure — log `"error"` level: `"Worker returned without STATUS section — treating as failure."` Create a repair task per the standard failure recovery procedure. |
| `SUMMARY` | Yes | Must be present and non-generic. If empty or matches generic patterns (`"Done"`, `"Completed"`, `"Finished"`, `"Task complete"`), log `"warn"` level: `"Worker returned generic summary — quality check needed."` Still count as completed, but flag for review in the final report. |
| `FILES CHANGED` | Conditional | If the task description mentions creating, modifying, or editing files, this section should list specific file paths. If empty or missing for a file-modifying task, log `"warn"` level: `"Worker reported no files changed for a task expected to modify files."` |
| `DIVERGENT ACTIONS` | Optional | If present, parse each deviation and log at `"deviation"` level in `logs.json`. This is already part of the standard completion processing but restated for completeness. |

### Processing Order

1. Parse the return text for STATUS, SUMMARY, FILES CHANGED, DIVERGENT ACTIONS sections
2. Validate STATUS — if missing, treat as failure (create repair task, skip remaining validation)
3. Validate SUMMARY — log warning if generic
4. Validate FILES CHANGED — log warning if expected but missing
5. Process DIVERGENT ACTIONS — log deviations
6. If STATUS is `PARTIAL`, treat as completed but log `"warn"` and include incomplete items in final report
7. Proceed to eager dispatch scan
