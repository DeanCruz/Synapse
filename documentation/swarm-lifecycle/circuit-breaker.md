# Circuit Breaker

The circuit breaker is Synapse's automatic replanning mechanism. When failures cascade through the dependency graph -- indicating a systemic problem rather than isolated task failures -- the circuit breaker halts new dispatches, analyzes the root cause, and produces a revised plan that routes around the failure.

---

## Why a Circuit Breaker Exists

Individual task failures are expected in complex swarms. A worker might encounter a missing file, a flawed assumption, or an environment issue. Synapse handles these through the **repair task** mechanism -- the master creates a repair task, rewires dependencies, and dispatches a repair worker.

But some failures are not isolated. They cascade:

- A shared assumption in the plan was wrong, causing multiple tasks to fail
- A critical dependency failed in a way that poisons the entire downstream chain
- An environmental issue (broken package, missing service) affects multiple tasks simultaneously

When failures cascade, the repair task mechanism is insufficient. Patching individual tasks does not address the root cause. The circuit breaker detects this pattern and triggers **automatic replanning** -- a structured analysis of what went wrong and a revised plan that accounts for the new reality.

---

## Trigger Conditions

The circuit breaker fires when **any** of these three conditions is met (whichever is hit first):

### Condition 1: 3+ Tasks Fail in the Same Wave

```
Wave 2:
  Task 2.1 -- FAILED
  Task 2.2 -- FAILED
  Task 2.3 -- FAILED    <-- Circuit breaker fires
  Task 2.4 -- completed
```

**Rationale:** Three failures in the same wave suggest a shared root cause -- perhaps a common dependency, a shared assumption in the plan, or an environmental issue that affects all tasks at this dependency level.

### Condition 2: Single Failure Blocks 3+ Downstream Tasks

```
Task 2.1 -- FAILED
  |
  +-- Task 3.1 (depends on 2.1) -- BLOCKED
  +-- Task 3.2 (depends on 2.1) -- BLOCKED
  +-- Task 4.1 (depends on 2.1, 3.1) -- BLOCKED   <-- Circuit breaker fires
```

**Rationale:** When a single failure blocks three or more downstream tasks, the failure is cascading through the dependency graph. A repair task might fix the immediate failure, but the downstream tasks may need to be adjusted based on what went wrong.

### Condition 3: Single Failure Blocks >50% of Remaining Tasks

```
Total tasks: 10
Completed: 3
Failed: 1 (task 2.1)
Remaining: 6

Tasks blocked by 2.1: 4 out of 6 remaining   <-- >50%, circuit breaker fires
```

**Rationale:** When a single failure blocks more than half of all remaining work, the failure is on the critical path and the swarm cannot make meaningful progress. Continuing to run unblocked tasks while more than half the swarm waits is wasteful.

---

## What Happens When the Circuit Breaker Fires

### Step 1: Halt New Dispatches

The orchestrator sets the swarm state to `replanning`. This immediately:

- **Blocks all new task dispatches** -- No new workers are spawned
- **Allows running workers to finish** -- Workers already in progress continue to completion
- **Notifies the dashboard** -- The dashboard shows a "Replanning" state indicator

```
Swarm State: "replanning"
  - Running workers: continue
  - Pending tasks: held
  - New dispatches: blocked
  - Dashboard: shows replanning indicator
```

### Step 2: Gather Failure Context

The orchestrator collects comprehensive context about the failure:

```
FAILURE CONTEXT:
  What completed successfully:
    - Task 1.1: {summary, files changed}
    - Task 1.2: {summary, files changed}

  What failed and why:
    - Task 2.1: {error logs, stage at failure, deviations}
    - Task 2.2: {error logs, stage at failure, deviations}

  The original dependency graph:
    1.1 -> 2.1 -> 3.1 -> 4.1
    1.2 -> 2.2 -> 3.2
    1.3 -> 2.3

  All pending tasks:
    - Task 3.1: {description, depends_on}
    - Task 3.2: {description, depends_on}
    - Task 4.1: {description, depends_on}
```

### Step 3: Spawn Replanner

The orchestrator spawns a Claude CLI process in `--print` mode with the failure context. The replanner is a dedicated analysis agent -- it does not execute tasks, it only analyzes and produces a revised plan.

```
Replanner receives:
  - Full failure context (completed, failed, pending)
  - Error logs and stage information from failed workers
  - The original dependency graph
  - All pending task descriptions

Replanner returns:
  Structured JSON revision
```

### Step 4: Apply the Revision

The replanner returns a structured JSON revision with four possible action types:

#### Modified Tasks

Existing tasks with updated descriptions, dependencies, or scope:

```json
{
  "modified": [
    {
      "id": "3.1",
      "description": "Updated description accounting for 2.1 failure",
      "depends_on": ["2.4r", "1.2"]
    }
  ]
}
```

#### Added Tasks

New repair or replacement tasks inserted into the graph. These are suffixed with `r` to indicate they were added during replanning:

```json
{
  "added": [
    {
      "id": "2.5r",
      "title": "REPAIR: Alternative approach for auth setup",
      "wave": 2,
      "depends_on": ["1.1"],
      "description": "Use token-based auth instead of session-based..."
    }
  ]
}
```

#### Removed Tasks

Tasks that are no longer viable due to the failure. Dangling `depends_on` references to removed tasks are automatically cleaned:

```json
{
  "removed": ["3.2", "4.2"]
}
```

#### Retried Tasks

Tasks to re-dispatch as-is (for transient failures). The orchestrator deletes their old progress files before re-dispatch:

```json
{
  "retry": ["2.1", "2.3"]
}
```

### Step 5: Update initialization.json

The orchestrator applies the revision:

1. **Modified tasks** -- Update the corresponding entries in `agents[]`
2. **Added tasks** -- Append new entries to `agents[]`, update `total_tasks`, update the relevant `waves[].total`
3. **Removed tasks** -- Remove entries from `agents[]`, clean `depends_on` references, update counters
4. **Retried tasks** -- Delete their progress files from `progress/`

This is the second exception to the "initialization.json is write-once" rule (the first being repair task creation).

### Step 6: Resume Dispatch

The orchestrator exits the `replanning` state and resumes the normal execution loop:

- The eager dispatch scan runs
- All tasks with satisfied dependencies are dispatched
- The pipeline flows again

---

## Replanning Flow Diagram

```
Circuit breaker triggers
    |
    v
Set swarm state to "replanning"
  (blocks new dispatches, running workers continue)
    |
    v
Gather failure context:
  - Completed tasks + summaries
  - Failed tasks + error details
  - Original dependency graph
  - All pending tasks
    |
    v
Spawn replanner (Claude CLI --print mode)
    |
    +---> Replanner analyzes root cause
    |     Returns structured JSON revision:
    |       { modified, added, removed, retry }
    |
    v
Apply revision to initialization.json:
  - Update modified tasks
  - Append added tasks (suffixed with "r")
  - Remove non-viable tasks
  - Delete progress files for retried tasks
    |
    v
Resume dispatch
  (exit "replanning" state, run eager dispatch scan)
    |
    v
Pipeline continues with revised plan
```

---

## Fallback: Replanner Failure

If the replanner CLI fails to spawn, exits non-zero, or returns invalid JSON, the swarm **pauses for manual intervention** rather than pushing through blind.

```
Replanner failed to produce valid revision.
Swarm paused. Options:
  - !retry {task_id}     -- Manually retry specific tasks
  - !dispatch --ready    -- Dispatch all currently unblocked tasks
  - !cancel              -- Cancel the swarm
  - !resume              -- Resume with manual intervention
```

The master writes a `"permission"` log entry to trigger the dashboard popup, then asks the user for guidance in the terminal.

**The swarm never pushes through cascading failures blind.** Either the replanner produces a valid revision, or the user intervenes manually.

---

## Circuit Breaker vs. Repair Tasks

These are two distinct failure-handling mechanisms that operate at different scales:

| Mechanism | Scale | Trigger | Action |
|---|---|---|---|
| **Repair Task** | Single task failure | Any individual task fails | Create repair task, rewire dependencies, dispatch repair worker |
| **Circuit Breaker** | Cascading failure | 3+ fails in wave, or 1 fail blocks 3+ tasks, or 1 fail blocks >50% remaining | Halt dispatches, analyze root cause, replan entire remaining graph |

### When Each Activates

```
Task 2.1 fails.
    |
    v
Is this the 3rd failure in Wave 2?
  YES -> Circuit breaker
  NO  |
      v
Does 2.1 block 3+ downstream tasks?
  YES -> Circuit breaker
  NO  |
      v
Does 2.1 block >50% of remaining tasks?
  YES -> Circuit breaker
  NO  |
      v
Create repair task 2.Xr, rewire, dispatch
(Standard repair task protocol)
```

The repair task mechanism handles the common case (isolated failures). The circuit breaker handles the exceptional case (systemic failures).

---

## Example: Circuit Breaker in Action

### Scenario

A swarm is migrating a codebase from JavaScript to TypeScript. The plan has 12 tasks across 4 waves.

```
Wave 1: Foundation types (4 tasks)
  1.1: Create base types         -- COMPLETED
  1.2: Create utility types      -- COMPLETED
  1.3: Create API types          -- FAILED (wrong module system assumption)
  1.4: Create config types       -- COMPLETED

Wave 2: Module conversion (4 tasks)
  2.1: Convert auth module       -- depends on 1.1, 1.3
  2.2: Convert user module       -- depends on 1.2, 1.3
  2.3: Convert admin module      -- depends on 1.1, 1.3
  2.4: Convert config loader     -- depends on 1.4
```

### What Happens

1. **Task 1.3 fails** -- It assumed ES modules but the project uses CommonJS
2. **Assessment**: 1.3 blocks 2.1, 2.2, and 2.3 (3 downstream tasks)
3. **Circuit breaker fires** (Condition 2: single failure blocks 3+ tasks)

### Replanning

The replanner analyzes:
- Root cause: Task 1.3 assumed ES modules, project uses CommonJS
- Impact: All API types need CommonJS-compatible declarations
- Three downstream tasks cannot proceed without correct API types

The revision:

```json
{
  "retry": ["1.3"],
  "modified": [
    {
      "id": "1.3",
      "description": "Create API types using CommonJS module.exports pattern. The project uses CommonJS, NOT ES modules. Use require/module.exports, not import/export."
    }
  ]
}
```

### Result

- Task 1.3's progress file is deleted
- Task 1.3 is re-dispatched with the corrected description
- When 1.3 completes, tasks 2.1, 2.2, and 2.3 are dispatched normally
- Total delay: ~3 minutes for replanning + 1 task re-execution
- Without the circuit breaker: 3 repair tasks, each independently discovering the same root cause

---

## Dashboard Visibility

During replanning, the dashboard shows:

- **Stat cards**: A "Replanning" state indicator
- **Log panel**: Entries documenting the circuit breaker trigger, replanning process, and revision applied
- **Agent cards**: Failed tasks show red, blocked tasks show their blocked state
- **After revision**: New/modified tasks appear, removed tasks disappear, retried tasks reset to pending

Log entries during circuit breaker operation:

```
14:33:05  [error]   2.1  Agent 4  FAILED: Convert auth module -- wrong module system
14:33:06  [error]   2.2  Agent 5  FAILED: Convert user module -- wrong module system
14:33:07  [error]   2.3  Agent 6  FAILED: Convert admin module -- wrong module system
14:33:08  [warn]    0.0  Orchestrator  Circuit breaker: 3 failures in Wave 2
14:33:08  [info]    0.0  Orchestrator  Entering replanning mode -- halting new dispatches
14:33:15  [info]    0.0  Orchestrator  Replanner: root cause identified -- CommonJS assumption
14:33:16  [info]    0.0  Orchestrator  Revision applied: 1 task retried with corrected description
14:33:16  [info]    0.0  Orchestrator  Resuming dispatch -- replanning complete
```

---

## Configuration

The circuit breaker thresholds are currently fixed:

| Threshold | Value | Rationale |
|---|---|---|
| Same-wave failure count | 3 | Balances sensitivity vs. noise. 1-2 failures may be coincidental. |
| Downstream block count | 3 | A single failure blocking 3+ tasks is a clear cascade signal. |
| Remaining tasks percentage | 50% | More than half the swarm blocked means minimal useful progress. |

These thresholds are designed to catch genuine cascading failures while avoiding false triggers from isolated, independent failures.

---

## Related Documentation

- [Overview](./overview.md) -- End-to-end swarm lifecycle summary
- [Planning Phase](./planning-phase.md) -- Context gathering and task decomposition
- [Dispatch Phase](./dispatch-phase.md) -- Worker dispatch mechanics, repair tasks, and eager dispatch protocol
- [Monitoring Phase](./monitoring-phase.md) -- Live progress tracking and deviation handling
- [Completion Phase](./completion-phase.md) -- Final report, verification, and archiving
