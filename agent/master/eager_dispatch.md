# Eager Dispatch Protocol

> **Self-contained module for the master agent's eager dispatch logic.** This document covers the complete protocol for identifying and dispatching available tasks on every worker completion, including wave vs. dependency semantics, upstream result injection, the mechanism for identifying available tasks, server-side automatic dependency tracking, and the core parallelization principles that drive dispatch behavior.

---

## CRITICAL — Eager Dispatch on Every Worker Completion

> **This is the master agent's highest-priority runtime obligation.** Failing to dispatch available tasks immediately is the single most common cause of pipeline stalls. Read this section carefully.

### The Rule

**Every time a worker agent completes (success or failure), the master MUST immediately scan ALL remaining tasks — across ALL waves — and dispatch an agent for EVERY task whose dependencies are fully satisfied.** Do not wait for an entire wave to finish. Do not batch dispatches. Do not limit yourself to "the current wave." The only gate is dependency satisfaction.

A completed task may unblock tasks in wave 3, wave 5, and wave 7 simultaneously. All of them must be dispatched in the same pass.

### Waves Are Visual, Not Execution Barriers — NON-NEGOTIABLE

**The master agent MUST NOT wait for a wave to complete before dispatching tasks in subsequent waves.** Waves exist purely as a visual grouping on the dashboard for human readability. They have zero bearing on dispatch logic. The dispatch engine operates on the dependency graph — individual `depends_on` arrays — and nothing else.

**The correct behavior:** The moment ANY task completes, scan the ENTIRE `agents[]` array. If a task in wave 4 has all its `depends_on` satisfied, dispatch it NOW — even if waves 2 and 3 still have running tasks. Every second a dispatchable task sits idle is wasted wall-clock time.

**The incorrect behavior (explicitly forbidden):**
- Waiting for all wave 1 tasks to finish before starting wave 2
- Waiting for "most" of a wave to finish before looking ahead
- Batching dispatch rounds by wave number
- Treating wave boundaries as synchronization points
- Any logic that references wave IDs when deciding what to dispatch

**Think of it this way:** if you removed the `wave` field from every agent, the dispatch logic should not change at all. Waves are a UI label. Dependencies are the only dispatch constraint.

### Upstream Result Injection

When dispatching a newly unblocked task, the master MUST populate the `UPSTREAM RESULTS` section of the worker prompt with structured summaries of all completed dependencies. See the "Upstream Result Summary Format" in `_commands/Synapse/p_track.md` Step 15D for the exact format. The KEY DETAILS field is critical — it provides the specific technical context (function signatures, export names, file locations) that the downstream worker needs to avoid redundant file reads.

---

## The Mechanism — How to Identify Available Tasks

Use this exact procedure every time a worker returns:

**Step 1 — Build the completed set.** List all files in `dashboards/{dashboardId}/progress/` and read each one. Collect every `task_id` where `status === "completed"` into a set. This is your **completed set**.

**Step 2 — Build the in-progress set.** From the same progress files, collect every `task_id` where `status === "in_progress"` into a set. These are already dispatched — do not re-dispatch them.

**Step 3 — Find all dispatchable tasks.** Read `initialization.json` and iterate over every entry in `agents[]`. A task is **available for dispatch** if and only if ALL of these are true:

1. Its `id` is **not** in the completed set (not already done)
2. Its `id` is **not** in the in-progress set (not already running)
3. **Every** ID in its `depends_on` array **is** in the completed set (all dependencies satisfied)
4. If `depends_on` is empty or omitted, the task has no dependencies and is available immediately (these are typically wave-1 tasks and should already be dispatched at swarm start)

**Step 4 — Dispatch ALL available tasks.** For every task that passes the check in Step 3, dispatch a worker agent immediately. Do not pick one — dispatch all of them in parallel.

**Step 5 — Log each dispatch.** Write a log entry to `dashboards/{dashboardId}/logs.json` for each newly dispatched task.

---

## Example Scenario — Normal Dispatch

```
agents[] contains:
  1.1 (depends_on: [])         <- Wave 1, already completed
  1.2 (depends_on: [])         <- Wave 1, already completed
  2.1 (depends_on: ["1.1"])    <- Wave 2, already in_progress
  2.2 (depends_on: ["1.2"])    <- Wave 2, already completed
  3.1 (depends_on: ["2.1"])    <- Wave 3, blocked (2.1 not done)
  3.2 (depends_on: ["2.2"])    <- Wave 3, available! (2.2 is done)
  4.1 (depends_on: ["3.1", "3.2"]) <- Wave 4, blocked

Worker for 2.1 just completed. New completed set: {1.1, 1.2, 2.1, 2.2}

Scan all agents:
  3.1 — depends_on: ["2.1"] -> 2.1 IS in completed set -> DISPATCH
  3.2 — depends_on: ["2.2"] -> already in_progress (dispatched last round) -> SKIP
  4.1 — depends_on: ["3.1", "3.2"] -> 3.1 NOT in completed set -> BLOCKED

Result: Dispatch 3.1 immediately. 4.1 stays blocked until both 3.1 and 3.2 complete.
```

## Example Scenario — Failure Recovery Dispatch

```
Same agents[] as above. But this time, worker 2.1 returns with status: "failed".

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

## Why This Matters

Waves are a **visual grouping mechanism for the dashboard**, not an execution barrier. The dependency graph is the only thing that controls dispatch order. A task in wave 5 with all dependencies met is dispatchable NOW — it does not wait for waves 2, 3, and 4 to fully complete.

The master agent's job is to keep the pipeline **maximally saturated**. Every idle moment where an available task sits undispatched is wasted wall-clock time. Scan aggressively, dispatch immediately, log everything.

---

## Common Mistakes in Eager Dispatch

| Mistake | Consequence | Fix |
|---|---|---|
| Waiting for an entire wave to finish before checking the next wave | Pipeline stalls — tasks sit available but undispatched | Scan ALL tasks on every completion, not just the next wave |
| Only checking tasks in wave N+1 | Tasks in wave N+2 or beyond with satisfied deps are missed | Iterate the entire `agents[]` array every time |
| Forgetting to check for failed dependencies | Dispatching a task whose dependency failed, leading to cascading failures | Only count `status === "completed"` in the completed set — failed tasks do NOT satisfy dependencies |
| Not re-scanning after dispatching | A newly dispatched task might have been the last blocker for another task | One full scan per completion event is sufficient — newly dispatched tasks are in_progress, not completed |
| Treating a failed task as completed | Downstream tasks dispatched against broken/missing output — cascading failures | Failed tasks NEVER enter the completed set. Create a repair task instead. |
| Not rewiring `depends_on` after creating a repair task | Downstream tasks still point at the failed task ID, which will never complete | Replace every reference to the failed task's ID with the repair task's ID in all `depends_on` arrays |
| Skipping the planning/diagnosis phase in repair workers | Repair worker repeats the same mistake, fails again | Always dispatch repair workers with `failed_task.md` protocol — diagnosis before implementation is mandatory |

---

## Automatic Dependency Tracking — Server-Side Alerts

The Synapse server automatically monitors task completions and proactively identifies which downstream tasks become dispatchable. This supplements the master agent's manual eager dispatch scan with server-side intelligence.

### How It Works

When any worker's progress file changes to `status: "completed"`, the server:

1. **Detects the completion** via `fs.watch` on the `progress/` directory
2. **Runs a dependency scan** after a brief delay (`DEPENDENCY_CHECK_DELAY_MS` = 100ms) to allow file writes to settle
3. **Identifies newly unblocked tasks** by calling `DependencyService.computeNewlyUnblocked(dashboardId, completedTaskId)` — this efficiently checks only tasks that depend on the completed task
4. **Broadcasts a `tasks_unblocked` SSE event** if any tasks became dispatchable

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

The dashboard displays a green toast notification showing which tasks are ready for dispatch.

### The `/api/dashboards/:id/dispatchable` Endpoint

The master agent (or any client) can query dispatchable tasks at any time:

```
GET /api/dashboards/:id/dispatchable
```

Response:
```json
{
  "dispatchable": [
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

This returns all tasks where every dependency is completed and the task has no progress file (still pending).

### Relationship to Manual Eager Dispatch

The automatic dependency tracking is a **complement** to the manual eager dispatch procedure, not a replacement. The master agent still follows the full eager dispatch protocol (Steps 1-5 above) on every worker completion. The server-side alerts provide:

- **Proactive notification** — the dashboard shows unblocked tasks immediately, before the master finishes processing
- **Redundancy** — if the master misses a dispatch opportunity, the server alerts catch it
- **Visibility** — the user sees real-time dependency resolution on the dashboard

The manual procedure remains the authoritative dispatch mechanism. The server alerts are an acceleration layer.

---

## Core Parallelization Principles

These principles from the Synapse architecture govern how the master agent plans and executes parallel dispatch. They are the foundational rules behind every dispatch decision.

### Principle 1 — Always Parallelize Independent Work

If two or more tasks have no dependency between them, they **must** run in parallel. This applies to everything — file reads, file writes, searches, edits, agent dispatches. Sequential execution of independent tasks is a failure mode.

### Principle 2 — Dependency-Driven Dispatch, Not Wave-Driven

Waves are a visual grouping for humans. The dispatch engine looks **only** at individual task dependencies. If task 2.3 depends only on 1.1 and 1.1 is done, dispatch 2.3 immediately — even if tasks 1.2 through 1.8 are still running. Never wait for a full wave to complete.

### Principle 3 — Pipeline Must Flow Continuously

When an agent completes:
1. Record the completion
2. Immediately scan ALL pending tasks for newly satisfied dependencies
3. Dispatch every unblocked task in the same update cycle
4. Never let the pipeline stall waiting for a batch

### Principle 4 — No Artificial Concurrency Cap

Send as many agents as there are ready tasks. The bottleneck should be dependencies, not artificial limits.

**Practical note:** The Task tool dispatches agents via tool calls. If a wave has more tasks than can be dispatched in a single message (~8-10 simultaneous tool calls), batch them into back-to-back dispatch rounds — but never wait for the first batch to complete before sending the second. Dispatch all ready tasks as fast as the tool allows.
