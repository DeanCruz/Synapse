# Circuit Breaker

The circuit breaker is Synapse's automatic replanning mechanism for cascading failures. When failures propagate through the dependency graph -- indicating a systemic problem rather than isolated task errors -- the circuit breaker halts new dispatches, analyzes the root cause, and produces a revised plan that addresses the underlying issue. This prevents the swarm from wasting cycles on doomed tasks while routing around the failure.

---

## Why a Circuit Breaker Exists

Individual task failures are expected in complex swarms. A worker might encounter a missing file, a flawed assumption, or an environment issue. Synapse handles these through the **repair task** mechanism -- the master creates a repair task, rewires downstream dependencies, dispatches a repair worker with full error context, and continues the pipeline.

But some failures are not isolated. They cascade:

- A shared assumption in the plan was wrong, causing multiple tasks to fail the same way
- A critical dependency failed in a way that poisons the entire downstream chain
- An environmental issue (broken package, missing service, wrong config) affects multiple tasks simultaneously
- Two consecutive tasks in the same dependency chain fail, indicating a systemic issue in that chain

When failures cascade, the repair task mechanism is insufficient. Patching individual tasks does not address the root cause -- it just creates more repair tasks that fail for the same reason. The circuit breaker detects this pattern and triggers **automatic replanning**: a structured analysis of what went wrong and a revised plan that accounts for the new reality.

---

## Trigger Conditions

The circuit breaker fires when **any** of these three conditions is met. Whichever threshold is hit first triggers the breaker:

### Condition 1: 3+ Tasks Fail in the Same Wave

```
Wave 2:
  Task 2.1 -- FAILED
  Task 2.2 -- FAILED
  Task 2.3 -- FAILED    <-- Circuit breaker fires
  Task 2.4 -- completed
```

**Rationale:** Three failures in the same wave suggest a shared root cause. Tasks at the same dependency level often share common assumptions, dependencies, or environmental requirements. When three fail simultaneously, it is unlikely to be coincidence -- something systemic is wrong at this level.

### Condition 2: Single Failure Blocks 3+ Downstream Tasks

```
Task 2.1 -- FAILED
  |
  +-- Task 3.1 (depends on 2.1) -- BLOCKED
  +-- Task 3.2 (depends on 2.1) -- BLOCKED
  +-- Task 4.1 (depends on 2.1 and 3.1) -- BLOCKED
                                               ^
                                    Circuit breaker fires
```

**Rationale:** When a single failure blocks three or more downstream tasks, the failure is on a critical path and its impact cascades through the dependency graph. While a repair task might fix the immediate failure, the downstream tasks may also need adjustment based on the root cause.

### Condition 3: Single Failure Blocks >50% of Remaining Tasks

```
Total tasks: 10
Completed: 3
Failed: 1 (task 2.1)
Remaining pending: 6

Tasks blocked by 2.1: 4 out of 6 remaining  -->  67% blocked
                                                   ^
                                        Circuit breaker fires
```

**Rationale:** When a single failure blocks more than half of all remaining work, the swarm cannot make meaningful progress. Continuing to run the few unblocked tasks while the majority of the swarm waits is wasteful -- it is better to pause, analyze, and replan.

---

## Circuit Breaker vs. Repair Tasks

These are two distinct failure-handling mechanisms that operate at different scales:

| Mechanism | Scale | Trigger | Action |
|---|---|---|---|
| **Repair Task** | Single isolated failure | Any individual task fails (before circuit breaker thresholds) | Create repair task with `r` suffix, rewire dependencies, dispatch repair worker |
| **Circuit Breaker** | Cascading/systemic failure | 3+ fails in wave, or 1 fail blocks 3+ tasks, or 1 fail blocks >50% remaining | Halt dispatches, analyze root cause, replan entire remaining dependency graph |

### Decision Flow

```
Task fails.
    |
    v
Is this the 3rd+ failure in the same wave?
  YES --> Circuit breaker
  NO  |
      v
Does this failure block 3+ downstream tasks?
  YES --> Circuit breaker
  NO  |
      v
Does this failure block >50% of remaining tasks?
  YES --> Circuit breaker
  NO  |
      v
Create repair task, rewire dependencies, dispatch repair worker
(Standard repair task protocol -- see Dispatch Phase)
```

The repair task mechanism handles the common case (isolated failures). The circuit breaker handles the exceptional case (systemic failures that require structural intervention).

---

## What Happens When the Circuit Breaker Fires

### Step 1: Set Swarm State to "Replanning"

The orchestrator immediately sets the swarm state to `replanning`. This:

- **Blocks all new task dispatches** -- No new workers are spawned
- **Allows running workers to finish** -- Workers already in progress continue to completion (their results are useful context for replanning)
- **Notifies the dashboard** -- The dashboard shows a "Replanning" state indicator
- **Logs the trigger** -- A `"warn"` level entry to `logs.json` explaining why the circuit breaker fired

```json
{
  "timestamp": "2026-03-22T14:33:08Z",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "warn",
  "message": "Circuit breaker triggered: 3 failures in Wave 2 -- shared root cause suspected. Pausing dispatch for replanning.",
  "task_name": "typescript-migration"
}
```

### Step 2: Gather Failure Context

The orchestrator collects comprehensive context for the replanner:

**What completed successfully:**
- Task summaries, files changed, and exports for each completed task
- These represent the known-good state of the codebase

**What failed and why:**
- Error logs from each failed worker's progress file
- The stage at which each failure occurred (reading_context, implementing, testing)
- Any deviations that preceded the failure
- The full log timeline from each failed worker

**The original dependency graph:**
- All tasks, dependencies, waves, and chains from `initialization.json`
- Which tasks are completed, failed, in-progress, and pending

**All pending tasks:**
- Description and dependencies for every task not yet dispatched
- These are the tasks that need to be revised

### Step 3: Spawn the Replanner

The orchestrator spawns a Claude CLI process in `--print` mode with the full failure context. The replanner is a dedicated analysis agent -- it does not execute tasks, it only analyzes the failure pattern and produces a revised plan.

```
Replanner receives:
  - Complete failure context (everything from Step 2)
  - The original plan's intent (from initialization.json and the XML)
  - Instructions to analyze root cause and produce a structured revision

Replanner returns:
  Structured JSON revision with four action categories
```

### Step 4: Receive and Validate the Revision

The replanner returns a structured JSON object with four categories of actions:

#### Modified Tasks

Existing tasks whose descriptions, dependencies, or scope need adjustment:

```json
{
  "modified": [
    {
      "id": "3.1",
      "description": "Updated description: use CommonJS require() instead of ES import. The project uses CommonJS module system throughout.",
      "depends_on": ["2.4r", "1.2"]
    }
  ]
}
```

Modified tasks retain their original ID. Only the specified fields are updated.

#### Added Tasks

New repair or replacement tasks inserted into the dependency graph. These are suffixed with `r` to mark them as replanning additions:

```json
{
  "added": [
    {
      "id": "2.5r",
      "title": "REPAIR: Create API types with CommonJS exports",
      "wave": 2,
      "depends_on": ["1.1"],
      "description": "Create API types using module.exports pattern instead of ES export. The project uses CommonJS -- use require() for imports and module.exports for exports throughout."
    }
  ]
}
```

#### Removed Tasks

Tasks that are no longer viable due to the failure. Dangling `depends_on` references to removed tasks are automatically cleaned from all remaining tasks:

```json
{
  "removed": ["3.2", "4.2"]
}
```

#### Retried Tasks

Tasks to re-dispatch as-is, for cases where the failure was transient (network timeout, temporary resource unavailability). The orchestrator deletes their old progress files before re-dispatch:

```json
{
  "retry": ["2.1", "2.3"]
}
```

### Step 5: Apply the Revision to initialization.json

The orchestrator applies the revision atomically (read full file, modify in memory, write full file):

1. **Modified tasks** -- Update the corresponding entries in `agents[]` with new fields
2. **Added tasks** -- Append new entries to `agents[]`, increment `task.total_tasks`, increment the relevant `waves[].total`
3. **Removed tasks** -- Remove entries from `agents[]`, clean all `depends_on` references to removed IDs, decrement counters
4. **Retried tasks** -- Delete their progress files from `{tracker_root}/dashboards/{dashboardId}/progress/`

If the layout type is `"Chains"`, also update the `chains[]` array: insert added task IDs into the appropriate chain positions, remove deleted task IDs.

This is the second exception to the "initialization.json is write-once" rule (the first being single repair task insertion during normal failure handling).

### Step 6: Log the Revision

```json
{
  "timestamp": "2026-03-22T14:33:16Z",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Replanning complete: 2 tasks modified, 1 task added (2.5r), 0 removed, 1 retried -- root cause: CommonJS/ESM mismatch",
  "task_name": "typescript-migration"
}
```

### Step 7: Resume Dispatch

The orchestrator exits the `replanning` state and resumes the normal execution loop:

- The eager dispatch scan runs against the revised plan
- All tasks with satisfied dependencies are dispatched
- The pipeline flows again with the corrected plan
- Worker agents for newly dispatched tasks receive updated prompts reflecting the revision

---

## Replanning Flow Diagram

```
Circuit breaker triggers (any condition met)
    |
    v
Set swarm state to "replanning"
  (blocks new dispatches, running workers continue to completion)
    |
    v
Log circuit breaker trigger to logs.json (level: "warn")
    |
    v
Gather failure context:
  - Completed tasks + summaries + files changed
  - Failed tasks + error logs + stage at failure + deviations
  - Original dependency graph from initialization.json
  - All pending tasks with descriptions and dependencies
    |
    v
Spawn replanner (Claude CLI in --print mode)
    |
    +---> Replanner analyzes root cause across all failures
    |     Identifies shared assumptions, environmental issues, or plan flaws
    |     Returns structured JSON revision:
    |       { modified: [...], added: [...], removed: [...], retry: [...] }
    |
    v
Validate replanner output (must be valid JSON with expected structure)
    |
    +---> VALID: Apply revision to initialization.json
    |       - Update modified tasks in agents[]
    |       - Append added tasks (suffixed with "r")
    |       - Remove non-viable tasks, clean dangling depends_on
    |       - Delete progress files for retried tasks
    |       - Update total_tasks, waves[].total
    |       - Update chains[] if applicable
    |
    +---> INVALID: Fall back to manual intervention (see Fallback below)
    |
    v
Log revision applied to logs.json (level: "info")
    |
    v
Exit "replanning" state
    |
    v
Run eager dispatch scan against revised plan
    |
    v
Pipeline continues with corrected plan
```

---

## Fallback: Replanner Failure

If the replanner CLI fails to spawn, exits non-zero, or returns invalid JSON, the swarm **pauses for manual intervention** rather than pushing through blind.

The orchestrator:

1. Writes a `"permission"` log entry to trigger the dashboard popup
2. Presents the user with options in the terminal:

```
Replanner failed to produce valid revision.
Swarm paused. Options:
  - !retry {task_id}     -- Manually retry specific failed tasks
  - !dispatch --ready    -- Dispatch all currently unblocked tasks (skip failed chains)
  - !cancel              -- Cancel the swarm entirely
  - !resume              -- Resume with manual guidance
```

The swarm never pushes through cascading failures blind. Either the replanner produces a valid revision, or the user intervenes manually. This is a safety guarantee: no matter what goes wrong, the swarm stops and asks rather than compounding errors.

---

## Worked Example: TypeScript Migration

### Scenario

A swarm is migrating a codebase from JavaScript to TypeScript. The plan has 12 tasks across 4 waves.

```
Wave 1: Foundation Types (4 tasks)
  1.1: Create base types            -- COMPLETED
  1.2: Create utility types         -- COMPLETED
  1.3: Create API types             -- FAILED (assumed ES modules, project uses CommonJS)
  1.4: Create config types          -- COMPLETED

Wave 2: Module Conversion (4 tasks)
  2.1: Convert auth module          -- depends on [1.1, 1.3] -- BLOCKED
  2.2: Convert user module          -- depends on [1.2, 1.3] -- BLOCKED
  2.3: Convert admin module         -- depends on [1.1, 1.3] -- BLOCKED
  2.4: Convert config loader        -- depends on [1.4]      -- DISPATCHED (independent chain)

Wave 3: Integration (3 tasks)
  3.1: Wire up auth routes          -- depends on [2.1]
  3.2: Wire up user routes          -- depends on [2.2]
  3.3: Wire up admin routes         -- depends on [2.3]

Wave 4: Testing (1 task)
  4.1: Run full test suite          -- depends on [3.1, 3.2, 3.3]
```

### What Happens

1. **Wave 1 dispatches:** Tasks 1.1, 1.2, 1.3, 1.4 all dispatched in parallel
2. **Tasks 1.1, 1.2, 1.4 complete** successfully
3. **Task 1.3 fails** -- It used `export type` syntax but the project uses `module.exports`
4. **Assessment:** Task 1.3 blocks tasks 2.1, 2.2, and 2.3 (3 downstream tasks)
5. **Circuit breaker fires** (Condition 2: single failure blocks 3+ downstream tasks)

Meanwhile, task 2.4 was dispatched because its only dependency (1.4) completed. It continues running during replanning.

### Replanning Process

The replanner receives:
- Completed tasks: 1.1 (base types), 1.2 (utility types), 1.4 (config types) -- all using CommonJS patterns
- Failed task: 1.3 -- error logs show `SyntaxError: Unexpected token 'export'`
- Root cause analysis: Task 1.3's prompt said "create TypeScript types" but did not specify the module system. The worker defaulted to ES modules. The project uses CommonJS throughout.

The revision:

```json
{
  "retry": ["1.3"],
  "modified": [
    {
      "id": "1.3",
      "description": "Create API types using CommonJS module.exports pattern. CRITICAL: This project uses CommonJS, NOT ES modules. All type definitions must use module.exports = { ... } for exports and require() for imports. See completed tasks 1.1 and 1.2 for the correct pattern."
    }
  ]
}
```

### Result

1. Task 1.3's progress file is deleted
2. Task 1.3 is re-dispatched with the corrected description
3. Task 1.3 completes successfully this time
4. Tasks 2.1, 2.2, and 2.3 become unblocked and are dispatched
5. The swarm continues normally from this point

**Total delay:** Approximately 3 minutes for replanning + 1 task re-execution.
**Without the circuit breaker:** Tasks 2.1, 2.2, and 2.3 would have been individually repaired, each independently discovering the same root cause. Three repair tasks, three diagnosis cycles, three re-implementations -- significantly more wasted time and context.

---

## Dashboard Visibility During Replanning

During the replanning process, the dashboard provides full visibility:

### Log Panel Entries

```
14:30:00  [info]    1.1  Agent 1      Completed: Create base types -- 12 types defined
14:30:15  [info]    1.2  Agent 2      Completed: Create utility types -- 8 utility types
14:30:30  [info]    1.4  Agent 4      Completed: Create config types -- 5 config interfaces
14:31:00  [error]   1.3  Agent 3      FAILED: Create API types -- SyntaxError: Unexpected token 'export'
14:31:01  [warn]    0.0  Orchestrator Circuit breaker: task 1.3 blocks 3 downstream tasks (2.1, 2.2, 2.3)
14:31:02  [info]    0.0  Orchestrator Entering replanning mode -- halting new dispatches
14:31:15  [info]    0.0  Orchestrator Replanner: root cause = CommonJS/ESM mismatch in task 1.3
14:31:16  [info]    0.0  Orchestrator Revision applied: task 1.3 retried with corrected module system
14:31:16  [info]    0.0  Orchestrator Resuming dispatch -- replanning complete
14:31:17  [info]    1.3  Agent 3      Dispatched: Create API types (retry -- CommonJS pattern)
```

### Card States During Replanning

- **Task 1.3:** Red (failed), then resets to pending after revision, then goes purple when re-dispatched
- **Tasks 2.1, 2.2, 2.3:** Show "Waiting..." (blocked state)
- **Task 2.4:** Purple (still running -- independent of the failed chain)
- **Stat cards:** Show the replanning state; completed count and failed count reflect current reality

### After Revision Applied

- New/modified tasks appear with updated descriptions
- Removed tasks disappear from the pipeline view
- Retried tasks reset to pending state
- The pipeline resumes flowing

---

## Configuration

The circuit breaker thresholds are currently fixed values. They are calibrated to catch genuine cascading failures while avoiding false triggers from isolated, independent failures:

| Threshold | Value | Rationale |
|---|---|---|
| Same-wave failure count | 3 | 1-2 failures may be coincidental. 3 suggests a shared root cause. |
| Downstream block count | 3 | A single failure blocking 3+ tasks is a clear cascade signal. |
| Remaining tasks percentage | 50% | More than half the swarm blocked means minimal useful progress. |

### Why These Specific Values

- **3 same-wave failures:** In a typical 4-8 task swarm, 3 failures in one wave means 37-75% of that wave failed. This is almost certainly systemic.
- **3 downstream blocks:** This threshold catches hub-and-spoke patterns where one critical task gates many others. Below 3, the repair task mechanism handles it fine.
- **50% remaining blocked:** This is the tipping point where the swarm's throughput drops below useful levels. Continuing to run a few unblocked tasks while most of the swarm waits is not efficient.

---

## Related Documentation

- [Overview](./overview.md) -- End-to-end swarm lifecycle summary
- [Planning Phase](./planning-phase.md) -- Context gathering and task decomposition
- [Dispatch Phase](./dispatch-phase.md) -- Worker dispatch mechanics, repair tasks, and eager dispatch protocol
- [Monitoring Phase](./monitoring-phase.md) -- Live progress tracking and deviation handling
- [Completion Phase](./completion-phase.md) -- Final report, verification, and archiving
