# Dispatch Phase

The dispatch phase transforms the static plan into active execution. The master agent spawns worker agents via the Task tool, feeds them self-contained prompts with upstream results, and manages the execution pipeline using dependency-driven dispatch. This phase is where Synapse's parallelism advantage is realized -- the pipeline must flow continuously, never stalling for artificial barriers.

---

## Phase Overview

```
User approves plan
    |
    v
+-----------------------------------+
| INITIAL DISPATCH                  |
|                                   |
| Dispatch all Wave 1 tasks         |
| + any higher-wave tasks with      |
|   no dependencies                 |
| All dispatched in parallel         |
+-----------------------------------+
    |
    v
+-----------------------------------+
| EXECUTION LOOP (repeats)          |
|                                   |
| Worker returns (success/failure)  |
|   -> Parse return format          |
|   -> Log to logs.json             |
|   -> Update master task file       |
|   -> Cache result for downstream  |
|   -> Build completed set          |
|   -> Build in-progress set        |
|   -> Scan ALL agents for unblocked|
|   -> Dispatch every available task|
|   -> Resume waiting               |
+-----------------------------------+
    |
    v (all tasks done or blocked)
Proceed to completion phase
```

---

## Initial Dispatch

When the user approves the plan, the master dispatches every task whose dependencies are already satisfied. This typically includes all Wave 1 tasks, plus any higher-wave tasks that happen to have no dependencies.

### Dispatch Sequence Per Task

For each task being dispatched, the master follows this exact sequence:

**1. Launch the agent FIRST.** Dispatch the Task agent with its full prompt via the Task tool. The agent is now running.

**2. Update tracker AFTER dispatch.** Only after the agent has been dispatched, the master:
   - Captures a live timestamp: `date -u +"%Y-%m-%dT%H:%M:%SZ"`
   - Appends a dispatch entry to `logs.json`

This ordering is non-negotiable. The agent must be launched before the dispatch is logged. Never write dispatch info to the tracker before the agent is actually running.

The master does **not** update `initialization.json` on dispatch. Workers write their own `status`, `assigned_agent`, and `started_at` to their progress files. The dashboard derives agent status from progress files.

### No Artificial Concurrency Cap

The master sends as many agents as there are ready tasks. If Wave 1 has 8 independent tasks, all 8 are dispatched simultaneously. The bottleneck should be dependencies, not artificial limits.

**Practical note:** The Task tool dispatches agents via tool calls. If a wave has more tasks than can be dispatched in a single message (~8-10 simultaneous tool calls), they are batched into back-to-back dispatch rounds -- but the master never waits for the first batch to complete before sending the second. Dispatch all ready tasks as fast as the tool allows.

### Terminal Output

The master does not display terminal status tables during execution. Terminal output is limited to brief one-line confirmations:

```
Dispatched Wave 1: 4 agents -- Foundation
```

The dashboard is the user's primary window into the swarm.

---

## The Worker Prompt

Every dispatched agent receives a self-contained prompt built from the plan and gathered context. The prompt contains everything the worker needs to execute independently -- it should not need to ask questions or search for additional files.

### Key Prompt Sections

| Section | Purpose |
|---|---|
| **DESCRIPTION** | Exactly what the agent must do |
| **CONTEXT** | Architectural context, current file state, design decisions |
| **PROJECT ROOT / TRACKER ROOT** | Both paths -- workers need to know where to write code and where to report progress |
| **CONVENTIONS** | Project conventions extracted from CLAUDE.md (quoted directly, not paraphrased) |
| **REFERENCE CODE** | Working examples the worker should follow as patterns |
| **UPSTREAM RESULTS** | Completed dependency summaries with files, exports, and deviations (downstream tasks only) |
| **CRITICAL** | Edge cases, gotchas, non-obvious requirements |
| **SUCCESS CRITERIA** | Specific, verifiable conditions for "done" |
| **FILES** | Every file to READ, MODIFY, or CREATE with full paths |
| **PREPARATION** | Readiness checklist: verify file paths, read patterns, confirm upstream exports |
| **PROGRESS REPORTING** | Progress file path, task ID, agent label, instruction mode |
| **RETURN FORMAT** | Structured report template |

### The Worker's Preparation Protocol

Before writing any code, workers complete a readiness checklist:

1. Read their task section in the master task file
2. Read project CLAUDE.md (if conventions were not already provided in the prompt)
3. Verify each item:
   - Every file path to modify/create has been listed
   - At least one existing file following the required pattern has been read
   - The task's output can be stated in one sentence
   - Each file to modify exists at the expected path
   - Upstream exports (if applicable) exist as expected

If any check fails, the worker investigates (up to 3 additional file reads) before reporting as a blocker.

### Instruction Mode

The master selects FULL or LITE mode per task:

- **FULL mode** -- Worker reads `tracker_worker_instructions.md` with full progress reporting protocol. Used for tasks with dependencies, 3+ file modifications, coordination requirements, or high deviation risk.
- **LITE mode** -- Worker reads `tracker_worker_instructions_lite.md` with streamlined reporting. Used for simple, independent, single-file tasks.

Default to FULL when uncertain.

---

## The Core Principle: Dependency-Driven Dispatch

**Waves are visual groupings for humans. The dispatch engine looks only at individual task dependencies.**

This is the most important concept in the dispatch phase. If task 3.1 depends only on 1.1 and 1.1 is done, dispatch 3.1 immediately -- even if tasks 1.2, 1.3, and 2.1 are still running.

```
Correct:  Dispatch any task whose depends_on entries are all in the completed set
Wrong:    Wait for Wave 1 to finish before starting Wave 2
Wrong:    Wait for "most" of a wave to finish before looking ahead
Wrong:    Batch dispatch rounds by wave number
Wrong:    Treat wave boundaries as synchronization points
Wrong:    Reference wave IDs when deciding what to dispatch
```

**Mental model:** If you removed the `wave` field from every agent, the dispatch logic would not change at all. Waves are a UI label. Dependencies are the only dispatch constraint.

---

## Eager Dispatch Protocol

Every time a worker agent completes (success or failure), the master must immediately run the full eager dispatch scan. This is the master's highest-priority runtime obligation. Failing to dispatch available tasks immediately is the single most common cause of pipeline stalls.

### The Five-Step Scan

```
Step 1: BUILD COMPLETED SET
  - List all files in dashboards/{dashboardId}/progress/
  - Read each file
  - Collect every task_id where status === "completed"
  - This is the completed set

Step 2: BUILD IN-PROGRESS SET
  - From the same progress files
  - Collect every task_id where status === "in_progress"
  - These are already dispatched -- do not re-dispatch

Step 3: FIND ALL DISPATCHABLE TASKS
  - Read initialization.json
  - For each agent in agents[]:
    a) Its id is NOT in the completed set (not already done)         AND
    b) Its id is NOT in the in-progress set (not already running)    AND
    c) EVERY id in its depends_on IS in the completed set            AND
    d) If depends_on is empty, already dispatched at start

Step 4: DISPATCH ALL AVAILABLE TASKS
  - For every task passing the Step 3 check
  - Dispatch a worker agent immediately with its full prompt
  - Do not pick one -- dispatch ALL of them in parallel

Step 5: LOG EACH DISPATCH
  - Append an entry to logs.json for each newly dispatched task
```

### Example: Normal Dispatch Flow

```
agents[] contains:
  1.1 (depends_on: [])         -- Wave 1, already completed
  1.2 (depends_on: [])         -- Wave 1, already completed
  2.1 (depends_on: ["1.1"])    -- Wave 2, in_progress
  2.2 (depends_on: ["1.2"])    -- Wave 2, already completed
  3.1 (depends_on: ["2.1"])    -- Wave 3, blocked (2.1 not done)
  3.2 (depends_on: ["2.2"])    -- Wave 3, in_progress (dispatched last round)
  4.1 (depends_on: ["3.1", "3.2"]) -- Wave 4, blocked

Worker for 2.1 just completed.
New completed set: {1.1, 1.2, 2.1, 2.2}
In-progress set: {3.2}

Scan all agents:
  1.1 -- in completed set          -> SKIP
  1.2 -- in completed set          -> SKIP
  2.1 -- in completed set          -> SKIP
  2.2 -- in completed set          -> SKIP
  3.1 -- depends_on ["2.1"]        -> 2.1 IS completed -> DISPATCH
  3.2 -- in in-progress set        -> SKIP
  4.1 -- depends_on ["3.1", "3.2"] -> 3.1 NOT completed -> BLOCKED

Result: Dispatch 3.1 immediately.
```

Notice that 3.1 (Wave 3) is dispatched while 3.2 (also Wave 3) is still running. Wave boundaries have no bearing on dispatch timing.

### Example: Cross-Wave Dispatch

A single completion can unblock tasks across multiple waves simultaneously:

```
Task 1.1 completes. It was the only dependency for:
  - Task 2.1 (Wave 2, depends_on: ["1.1"])
  - Task 3.3 (Wave 3, depends_on: ["1.1"])
  - Task 4.2 (Wave 4, depends_on: ["1.1"])

All three are dispatched in the same scan -- despite spanning three different waves.
```

---

## Feeding Upstream Results to Downstream Tasks

When a task completes and its dependents become dispatchable, the master must include the upstream task's results in the downstream worker's prompt. This is critical because the downstream prompt was written during planning -- before the upstream work was done.

### What the Master Caches

When a worker returns, the master stores in working memory:
- Task ID, title, status
- Summary (the worker's SUMMARY line)
- Files changed (the worker's FILES CHANGED list)
- New exports (from the worker's EXPORTS section)
- Any deviations or warnings

### Upstream Result Summary Format

For each completed dependency, the downstream prompt includes:

```
UPSTREAM RESULTS:
--- Dependency: Task 1.1 -- Create rate limiter middleware ---
STATUS: completed
SUMMARY: Created rate limiter middleware with configurable windows
FILES CHANGED:
  - src/middleware/rateLimiter.ts (created)
  - src/middleware/index.ts (modified)
NEW EXPORTS:
  - function createRateLimiter -- factory accepting RateLimitConfig
  - type RateLimitConfig -- { windowMs, maxRequests, keyGenerator }
DEVIATIONS: none
KEY DETAILS: The createRateLimiter function is exported from
  src/middleware/rateLimiter.ts and registered in src/middleware/index.ts.
  It accepts a RateLimitConfig object and returns Express middleware.
--- End Dependency ---
```

### Why KEY DETAILS Matters

The KEY DETAILS field is the most important part of the upstream result. It bridges the gap between what the upstream worker did and what the downstream worker needs to know. Without it, the downstream worker knows WHAT was done but not HOW -- leading to redundant file reads or incorrect assumptions about function signatures, export locations, and file structure.

The master populates KEY DETAILS by:
1. Reading the upstream worker's SUMMARY and FILES CHANGED
2. Extracting specific technical facts the downstream task needs (function signatures, export names, file locations)
3. If the upstream summary is too vague, quickly reading the modified files to extract relevant details

### Cache Reconstruction After Context Compaction

If context compaction drops the result cache, the master reconstructs it by re-reading the task file summaries before dispatching downstream tasks. Stale or missing upstream results cause downstream workers to operate on incorrect assumptions.

---

## Failure Handling During Dispatch

### Failed Tasks Do Not Satisfy Dependencies

When a worker returns with `status: "failed"`, the failed task does **not** enter the completed set. Any downstream task with the failed task in its `depends_on` remains blocked.

However, the master must still run the eager dispatch scan -- other dependency chains unrelated to the failure may have been freed by concurrent completions.

### Repair Task Protocol

When a worker fails, the master follows this recovery procedure:

**Step 1 -- Log the failure.** Write an `"error"` level entry to `logs.json` with the failed task's summary and error.

**Step 2 -- Create a repair task in `initialization.json`.** This is the one exception to the write-once rule. The master appends a new agent entry:
- **ID:** `"{failed_wave}.{next_index}r"` (e.g., if task 2.1 failed and Wave 2 has 3 tasks, the repair ID is `"2.4r"`)
- **Title:** `"REPAIR: {original title}"`
- **Wave:** Same as the failed task
- **Dependencies:** Same as the failed task (which are already satisfied)

The master also increments `task.total_tasks` and the relevant `waves[].total`.

**Step 3 -- Rewire the dependency chain.** Every task that depended on the failed task now depends on the repair task:
```
Before: 3.1 depends_on: ["2.1"]
After:  3.1 depends_on: ["2.4r"]
```

**Step 4 -- Dispatch the repair worker.** The repair worker receives:
- The failed task's original dispatch prompt (full context)
- The failed task's progress file contents (error details, logs, deviations)
- The failed task's summary/error description
- Instructions to follow `failed_task.md` protocol: diagnose root cause first, plan the fix, then implement

**Step 5 -- Log the repair dispatch.**

**Step 6 -- Run the eager dispatch scan as normal.** The repair task is now in-progress. Unrelated unblocked tasks are dispatched. The pipeline continues.

### Repair Task Example

```
Task 2.1 fails. Wave 2 has 3 tasks.

Before repair:
  2.1 (FAILED)     -> 3.1 depends on 2.1 (BLOCKED)
  2.2 (completed)  -> 3.2 depends on 2.2 (DISPATCHABLE)

Repair created:
  2.4r (repair for 2.1, same depends_on as 2.1)
  3.1 rewired: depends_on ["2.4r"]

After 2.4r completes successfully:
  Completed set: {1.1, 1.2, 2.2, 2.4r}
  3.1 depends on ["2.4r"] -> 2.4r IS completed -> DISPATCH
  Pipeline continues as if 2.1 had succeeded.
```

### Failure Taxonomy

The worker's stage at failure helps diagnose the root cause:

| Worker Stage at Failure | Likely Root Cause | Recommended Action |
|---|---|---|
| `reading_context` | Upstream issue -- missing file, bad path, failed dependency output | Check upstream output; verify file paths in prompt |
| `implementing` | Ambiguous spec -- insufficient description or context | Rewrite prompt with more detail and reference code |
| `testing` | Integration issue -- code works in isolation but conflicts | Dispatch verification agent or merge with conflicting task |

---

## Server-Side Dependency Tracking

The Synapse server provides automatic dependency monitoring as a complement to the master's manual eager dispatch.

### How It Works

1. When a progress file changes to `status: "completed"`, the server detects it via `fs.watch` on the `progress/` directory
2. After a brief delay (100ms) to allow file writes to settle, the server runs a dependency scan
3. It calls `DependencyService.computeNewlyUnblocked()` to identify tasks whose dependencies are now fully satisfied
4. It broadcasts a `tasks_unblocked` SSE event to all connected browsers
5. The dashboard shows a green toast notification for dispatchable tasks

### The Dispatchable Tasks API

The master (or any client) can query dispatchable tasks at any time:

```
GET /api/dashboards/:id/dispatchable
```

This returns all tasks where every dependency is completed and no progress file exists yet (still pending).

### Relationship to Manual Dispatch

The server-side tracking is a **complement** to the manual eager dispatch, not a replacement. The master's scan remains the authoritative dispatch mechanism. The server alerts provide:

- **Proactive notification** -- the dashboard shows unblocked tasks before the master finishes processing
- **Redundancy** -- if the master misses a dispatch opportunity, the server catches it
- **Visibility** -- the user sees real-time dependency resolution on the dashboard

---

## Common Dispatch Mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Waiting for a full wave before checking the next | Pipeline stalls -- available tasks sit undispatched | Scan ALL tasks on every completion, not just the next wave |
| Only checking tasks in wave N+1 | Tasks in N+2 or beyond with satisfied deps are missed | Iterate the entire `agents[]` array every time |
| Forgetting to check for failed dependencies | Dispatching against broken/missing output | Only count `status === "completed"` in the completed set |
| Not re-scanning after dispatching | A newly dispatched task may unblock another | One full scan per completion event is sufficient |
| Treating failed tasks as completed | Downstream dispatched against broken output | Failed tasks never enter the completed set |
| Not rewiring `depends_on` after repair task | Downstream still points at failed ID, never completes | Replace every reference to failed ID with repair ID |
| Skipping planning in repair workers | Repair repeats the same mistake | Always dispatch with `failed_task.md` -- diagnosis before implementation |
| Dispatching before the agent is running | Log says dispatched but agent hasn't started | Launch agent FIRST, update tracker AFTER |
| Master implementing instead of dispatching | Entire swarm bypassed, dashboard empty, user blind | Never write application code as master |

---

## Related Documentation

- [Overview](./overview.md) -- End-to-end swarm lifecycle summary
- [Planning Phase](./planning-phase.md) -- Context gathering and task decomposition
- [Monitoring Phase](./monitoring-phase.md) -- Live progress tracking and deviation handling
- [Completion Phase](./completion-phase.md) -- Final report and archiving
- [Circuit Breaker](./circuit-breaker.md) -- Automatic replanning on cascading failures
