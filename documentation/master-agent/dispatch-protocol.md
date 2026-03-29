# Master Agent — Dispatch Protocol

Dispatch is the execution phase of a swarm. This document covers the complete dispatch protocol: initial dispatch of Wave 1, the eager dispatch loop that fires on every worker completion, dependency-driven dispatch logic, upstream result injection, failure handling, repair tasks, and the circuit breaker.

---

## Core Principle: Dependency-Driven, Not Wave-Driven

Waves are a visual grouping mechanism for the dashboard. They have zero bearing on dispatch logic. The dispatch engine operates on the dependency graph -- individual `depends_on` arrays -- and nothing else.

If you removed the `wave` field from every agent, the dispatch logic should not change at all. Waves are a UI label. Dependencies are the only dispatch constraint.

**Correct behavior:** The moment ANY task completes, scan the ENTIRE agents array. If a task in Wave 4 has all its `depends_on` satisfied, dispatch it NOW -- even if Waves 2 and 3 still have running tasks. Every second a dispatchable task sits idle is wasted wall-clock time.

**Explicitly forbidden behavior:**
- Waiting for all Wave 1 tasks to finish before starting Wave 2.
- Waiting for "most" of a wave to finish before looking ahead.
- Batching dispatch rounds by wave number.
- Treating wave boundaries as synchronization points.
- Any logic that references wave IDs when deciding what to dispatch.

---

## Initial Dispatch

When the user approves the plan and execution begins:

1. Dispatch every task whose dependencies are already satisfied (all of Wave 1, plus any higher-wave tasks with no blockers).
2. There is no fixed concurrency cap -- maximize parallelism. Send as many agents as there are ready tasks.
3. If the tool limits simultaneous dispatches (roughly 8-10), send multiple dispatch rounds back-to-back without waiting for the first batch to complete.

For each dispatched task, follow the dispatch sequence:

### Dispatch Sequence

**Step A -- Launch the agent FIRST.** Dispatch the Task agent with its full self-contained prompt. The agent is now running.

**Step B -- Update the tracker AFTER dispatch.** Only after the agent has been dispatched, update the tracker files:

1. Capture a live timestamp via `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
2. Append a dispatch entry to `logs.json`:
   ```json
   {
     "timestamp": "{captured timestamp}",
     "task_id": "{id}",
     "agent": "Agent {N}",
     "level": "info",
     "message": "Dispatched: {task title}",
     "task_name": "{task-slug}"
   }
   ```

The order is critical: dispatch first, then log. Never write dispatch information to the tracker before the agent is actually running.

The master does NOT update `initialization.json` on dispatch. Workers write their own status, assigned_agent, and started_at to their progress files. The dashboard derives agent status from progress files.

Terminal output is a brief one-line confirmation per dispatch batch (e.g., "Dispatched Wave 1: 4 agents"). Full status tables are never displayed during execution.

---

## The Eager Dispatch Loop

This is the master agent's highest-priority runtime obligation. Failing to dispatch available tasks immediately is the single most common cause of pipeline stalls.

### The Rule

Every time a worker agent completes (success or failure), the master MUST immediately scan ALL remaining tasks -- across ALL waves -- and dispatch an agent for EVERY task whose dependencies are fully satisfied. Do not wait for an entire wave to finish. Do not batch dispatches. Do not limit yourself to "the current wave." The only gate is dependency satisfaction.

A completed task may unblock tasks in Wave 3, Wave 5, and Wave 7 simultaneously. All of them must be dispatched in the same pass.

### The Mechanism

Use this exact procedure every time a worker returns:

**Step 1 -- Build the completed set.** List all files in `dashboards/{dashboardId}/progress/` and read each one. Collect every `task_id` where `status === "completed"` into a set.

**Step 2 -- Build the in-progress set.** From the same progress files, collect every `task_id` where `status === "in_progress"`. These are already dispatched -- do not re-dispatch them.

**Step 3 -- Find all dispatchable tasks.** Read `initialization.json` and iterate over every entry in agents. A task is available for dispatch if and only if ALL of these are true:

1. Its `id` is NOT in the completed set (not already done).
2. Its `id` is NOT in the in-progress set (not already running).
3. EVERY ID in its `depends_on` array IS in the completed set (all dependencies satisfied).
4. If `depends_on` is empty or omitted, the task has no dependencies and is available immediately.

**Step 4 -- Dispatch ALL available tasks.** For every task that passes the check in Step 3, dispatch a worker agent immediately. Do not pick one -- dispatch all of them in parallel.

**Step 5 -- Log each dispatch.** Write a log entry to `logs.json` for each newly dispatched task.

### Example Scenario

```
agents[] contains:
  1.1 (depends_on: [])         -- Wave 1, already completed
  1.2 (depends_on: [])         -- Wave 1, already completed
  2.1 (depends_on: ["1.1"])    -- Wave 2, already in_progress
  2.2 (depends_on: ["1.2"])    -- Wave 2, already completed
  3.1 (depends_on: ["2.1"])    -- Wave 3, blocked (2.1 not done)
  3.2 (depends_on: ["2.2"])    -- Wave 3, available! (2.2 is done)
  4.1 (depends_on: ["3.1", "3.2"]) -- Wave 4, blocked

Worker for 2.1 just completed. New completed set: {1.1, 1.2, 2.1, 2.2}

Scan all agents:
  3.1 -- depends_on: ["2.1"] -> 2.1 IS in completed set -> DISPATCH
  3.2 -- depends_on: ["2.2"] -> already in_progress (dispatched last round) -> SKIP
  4.1 -- depends_on: ["3.1", "3.2"] -> 3.1 NOT in completed set -> BLOCKED

Result: Dispatch 3.1 immediately. 4.1 stays blocked until both 3.1 and 3.2 complete.
```

### Common Mistakes in Eager Dispatch

| Mistake | Consequence | Fix |
|---|---|---|
| Waiting for an entire wave to finish before checking the next wave | Pipeline stalls -- tasks sit available but undispatched | Scan ALL tasks on every completion, not just the next wave |
| Only checking tasks in Wave N+1 | Tasks in Wave N+2 or beyond with satisfied deps are missed | Iterate the entire agents array every time |
| Forgetting to check for failed dependencies | Dispatching a task whose dependency failed, leading to cascading failures | Only count `status === "completed"` in the completed set -- failed tasks do NOT satisfy dependencies |
| Not re-scanning after dispatching | A newly dispatched task might have been the last blocker for another task | One full scan per completion event is sufficient -- newly dispatched tasks are in_progress, not completed |
| Treating a failed task as completed | Downstream tasks dispatched against broken/missing output -- cascading failures | Failed tasks NEVER enter the completed set. Create a repair task instead. |
| Not rewiring depends_on after creating a repair task | Downstream tasks still point at the failed task ID, which will never complete | Replace every reference to the failed task's ID with the repair task's ID in all depends_on arrays |

---

## Upstream Result Injection

When dispatching a newly unblocked task, the master MUST populate the `UPSTREAM RESULTS` section of the worker prompt with structured summaries of all completed dependencies.

### Caching Completion Results

When a worker returns, the master stores its results in working memory:

- Task ID, title, status.
- Summary (the worker's SUMMARY line).
- Files changed (the worker's FILES CHANGED list).
- New interfaces, types, exports, or APIs introduced (from the EXPORTS section).
- Any deviations or warnings.

This cache feeds downstream prompts. After context compaction, reconstruct the cache from prior conversation output or by re-reading the task file summaries.

### Upstream Result Summary Format

When injecting upstream results into a downstream worker's prompt:

```
UPSTREAM RESULTS:
--- Dependency: Task {id} -- {title} ---
STATUS: {completed | failed}
SUMMARY: {worker's SUMMARY line verbatim}
FILES CHANGED:
  - {path} ({created | modified | deleted})
NEW EXPORTS:
  - {type} {name} -- {description}
DEVIATIONS: {none | list of deviations}
KEY DETAILS: {1-2 sentences of specific technical details the downstream
  worker needs}
--- End Dependency ---
```

**KEY DETAILS is the most important field.** It bridges the gap between the upstream worker's output and the downstream worker's needs. Without it, the downstream worker knows WHAT was done but not HOW -- leading to redundant file reads or incorrect assumptions.

Populate KEY DETAILS by:

1. Reading the upstream worker's SUMMARY and FILES CHANGED.
2. Extracting the specific technical facts the downstream task needs (based on the downstream task's description in the plan).
3. If the upstream summary is too vague, quickly read the modified files to extract the relevant details (function signatures, export names, file structure).

When multiple dependencies exist, list each one in a separate dependency block. Order them by relevance to the downstream task (most important first).

---

## Server-Side Dependency Tracking

The Synapse server automatically monitors task completions and proactively identifies which downstream tasks become dispatchable. This supplements the manual eager dispatch scan.

### How It Works

When any worker's progress file changes to `status: "completed"`, the server:

1. Detects the completion via `fs.watch` on the progress directory.
2. Runs a dependency scan after a 100ms delay (`DEPENDENCY_CHECK_DELAY_MS`) to allow file writes to settle.
3. Identifies newly unblocked tasks by calling `DependencyService.computeNewlyUnblocked(dashboardId, completedTaskId)` -- this efficiently checks only tasks that depend on the completed task.
4. Broadcasts a `tasks_unblocked` SSE event to the dashboard if any tasks became dispatchable. The dashboard displays a green toast notification showing which tasks are ready for dispatch.

### The `tasks_unblocked` SSE Event

When the server detects newly dispatchable tasks, it broadcasts:

```json
{
  "dashboardId": "dashboard1",
  "completedTaskId": "1.1",
  "unblocked": [
    {
      "id": "2.1",
      "title": "Add auth middleware",
      "wave": 2,
      "depends_on": ["1.1"],
      "dependency_status": { "1.1": "completed" }
    }
  ]
}
```

### The Dispatchable API Endpoint

The master can query dispatchable tasks at any time:

```
GET /api/dashboards/:id/dispatchable
```

This returns all tasks where every dependency is completed and the task has no progress file (still pending).

### Relationship to Manual Dispatch

The automatic dependency tracking is a complement, not a replacement. The master still follows the full eager dispatch protocol on every worker completion. The server-side alerts provide:

- **Proactive notification** -- The dashboard shows unblocked tasks immediately, before the master finishes processing.
- **Redundancy** -- If the master misses a dispatch opportunity, the server alerts catch it.
- **Visibility** -- The user sees real-time dependency resolution on the dashboard.

The manual procedure remains the authoritative dispatch mechanism.

---

## Error Handling

### Single Task Failure

A failed task blocks only its direct dependents. Everything else continues. The master logs the error, marks the task, and keeps dispatching.

**Failed tasks do NOT satisfy dependencies.** Any downstream task with the failed task in its `depends_on` remains blocked. However, the master MUST still run the eager dispatch scan -- other dependency chains unrelated to the failure may have been freed by concurrent completions.

### Failure Recovery via Repair Tasks

When a worker returns with `status: "failed"`, the master follows this recovery procedure:

**Step 1 -- Log the failure.** Write an `"error"` level entry to `logs.json`.

**Step 2 -- Create a repair task in `initialization.json`.** This is the one exception to the "initialization.json is write-once" rule. The master adds a new agent entry to the agents array:

- **ID:** `"{failed_task_wave}.{next_available_index}r"` -- the `r` suffix marks it as a repair task (e.g., if `2.1` failed and Wave 2 has 3 tasks, the repair ID is `"2.4r"`).
- **Wave:** Same wave as the failed task.
- **Title:** `"REPAIR: {original task title}"` -- prefixed so it is immediately recognizable on the dashboard.
- **depends_on:** Identical to the failed task's depends_on (already satisfied since the original was dispatched).

Increment `task.total_tasks` and the relevant `waves[].total`.

**Step 3 -- Rewire the dependency chain.** Every task that had the failed task's ID in its `depends_on` must be updated to depend on the repair task's ID instead. This splices the repair task into the dependency chain as a drop-in replacement.

**Step 4 -- Update chains if applicable.** If `task.type` is "Chains", insert the repair task ID immediately after the failed task's ID in the chain's tasks array.

**Step 5 -- Dispatch the repair worker.** Send a worker agent with instructions from `{tracker_root}/agent/instructions/failed_task.md`. The dispatch prompt includes:

- The failed task's original dispatch prompt (full context).
- The failed task's progress file contents (error details, logs, deviations).
- The failed task's summary/error description.
- The repair task's ID and progress file path.
- Clear instruction to follow the `failed_task.md` protocol: enter planning mode first, diagnose the root cause, plan the fix, then implement.

**Step 6 -- Log the repair dispatch.**

**Step 7 -- Run the eager dispatch scan as normal.**

### Example: Failure Recovery

```
agents[] contains the same as the standard scenario.
Worker 2.1 returns with status: "failed".

Completed set: {1.1, 1.2, 2.2} (2.1 is NOT completed -- it failed)

Step 1 -- Log the failure to logs.json.

Step 2 -- Create repair task:
  New agent: 2.4r (depends_on: ["1.1"], title: "REPAIR: Add auth middleware")
  Increment total_tasks: 7 -> 8
  Increment waves[1].total: 3 -> 4

Step 3 -- Rewire dependencies:
  3.1 had depends_on: ["2.1"] -> update to depends_on: ["2.4r"]

Step 4 -- Dispatch repair worker 2.4r.

Step 5 -- Run eager dispatch scan:
  3.1 depends_on: ["2.4r"] -> 2.4r NOT in completed set -> BLOCKED
  No additional tasks to dispatch (but 2.4r is running).

Later, when 2.4r completes successfully:
  Completed set: {1.1, 1.2, 2.2, 2.4r}
  3.1 depends_on: ["2.4r"] -> DISPATCH
  Pipeline continues as if 2.1 had succeeded.
```

### Failure Taxonomy

Use the worker's failure stage to diagnose root cause:

| Worker Stage at Failure | Likely Root Cause | Action |
|---|---|---|
| `reading_context` | Upstream issue -- missing file, bad path, or failed dependency produced unexpected output | Check upstream task's output; verify file paths in prompt |
| `implementing` | Ambiguous spec -- the task description or context is insufficient | Rewrite the prompt with more detail and reference code |
| `testing` | Integration issue -- the code works in isolation but conflicts with other changes | Dispatch a verification agent or merge with the conflicting task |

### Retry vs. Replan Decision

After a failure:

- If the failure blocks more than 50% of remaining pending tasks, **replan the swarm**. The dependency graph is too damaged for piecemeal fixes.
- If the failure blocks less than 50% of remaining tasks, **retry the individual task** with a fixed prompt.
- If the same task fails twice, escalate to the user regardless of blast radius.

---

## The Circuit Breaker

The circuit breaker pauses dispatch and triggers reassessment when failures indicate a systemic problem rather than isolated issues.

### Trigger Conditions

The circuit breaker fires when ANY of these conditions are met (whichever is hit first):

- **3 or more tasks fail within the same wave** -- Suggests a shared root cause, not isolated failures.
- **A single failure blocks 3 or more downstream tasks** -- The failure is cascading through the dependency graph.
- **A single failure blocks more than half of all remaining tasks** -- Critical-path failure.
- **2 consecutive tasks in the same dependency chain fail** -- Indicates a systemic issue in that chain.

### Circuit Breaker Procedure

When the circuit breaker triggers:

1. **Pause all dispatching** -- Do not launch any new agents.
2. **Log to `logs.json`** at level `"warn"`: `"Circuit breaker triggered: {reason}. Pausing dispatch for reassessment."`
3. **Write a `"permission"` level log entry** to trigger the dashboard popup.
4. **Present an assessment to the user:**
   - What failed and why (root cause analysis).
   - Whether a shared root cause is likely.
   - Whether the plan needs revision.
   - Options: continue, revise plan, or cancel swarm.
5. Resume only after user confirmation.

### Automatic Replanning

When the circuit breaker fires, the orchestrator may enter automatic replanning mode:

1. Set swarm state to `'replanning'` (blocks new dispatches, notifies the dashboard).
2. Spawn a Claude CLI process (`--print` mode) with full context: what completed, what failed and why, the original dependency graph, and all pending tasks.
3. The replanner analyzes root cause and returns a structured JSON revision:
   - `modified` -- Existing tasks with updated descriptions, rewired dependencies.
   - `added` -- New repair/replacement tasks inserted into the graph (suffixed with `r`).
   - `removed` -- Tasks that are no longer viable.
   - `retry` -- Tasks to re-dispatch as-is (transient failures, old progress files are deleted).
4. The orchestrator applies the revision to `initialization.json`, updates `total_tasks`, and resumes dispatch.

**Fallback:** If the replanner CLI fails to spawn, exits non-zero, or returns invalid JSON, the swarm pauses for manual intervention rather than pushing through blind.

---

## No Artificial Concurrency Cap

Send as many agents as there are ready tasks. The bottleneck should be dependencies, not artificial limits.

If a wave has more tasks than can be dispatched in a single message (roughly 8-10 simultaneous tool calls), batch them into back-to-back dispatch rounds -- but never wait for the first batch to complete before sending the second. Dispatch all ready tasks as fast as the tool allows.

---

## Pipeline Flow Summary

The complete execution loop:

```
1. Dispatch all initially ready tasks (Wave 1 + any others with no deps)
2. Wait for a worker to return
3. Parse the return (STATUS, SUMMARY, FILES CHANGED, EXPORTS, DEVIATIONS)
4. Update master task file with completion data
5. Append completion entry to logs.json
6. Cache the result for downstream injection
7. If failure: create repair task, rewire deps, dispatch repair worker
8. Build completed set from progress files
9. Build in-progress set from progress files
10. Scan ALL agents for newly dispatchable tasks
11. Dispatch ALL available tasks with upstream results injected
12. Log each dispatch
13. Go to step 2
14. When all tasks reach terminal state: final report
```

The pipeline must flow continuously. Every idle moment where an available task sits undispatched is wasted wall-clock time.

---

## Related Documentation

- [Master Agent Overview](./overview.md) -- Role definition, constraints, and responsibilities.
- [Planning Protocol](./planning.md) -- Task decomposition, dependency mapping, wave grouping, and prompt writing.
- [Statusing Protocol](./statusing.md) -- Dashboard updates, logs.json, task file updates, and terminal output rules.
