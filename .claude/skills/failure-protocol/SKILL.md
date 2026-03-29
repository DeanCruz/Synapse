---
name: failure-protocol
description: >
  Synapse failure recovery protocol. Loaded automatically when a worker returns with
  status failed, a task needs repair, or the circuit breaker threshold is approached.
  Contains repair task creation, dependency rewiring, circuit breaker thresholds, and
  the repair worker dispatch protocol.
user-invocable: false
---

# Failure Recovery Protocol

This protocol governs how the master agent handles worker failures, creates repair tasks, manages cascading failures, and validates worker returns. Follow it exactly.

---

## Worker Return Validation

Validate every worker return **before** processing it as a completion or running the eager dispatch scan.

| Section | Required? | Validation |
|---|---|---|
| `STATUS` | Yes | Must be `COMPLETED`, `FAILED`, or `PARTIAL`. Missing = treat as failure. |
| `SUMMARY` | Yes | Must be present and non-generic. Generic ("Done", "Completed", "Finished") = log warn. |
| `FILES CHANGED` | Conditional | Expected for file-modifying tasks. Missing = log warn. |
| `DIVERGENT ACTIONS` | Optional | Parse and log each at `"deviation"` level. |

**Processing order:** Parse return text -> Validate STATUS (missing = failure, create repair task) -> Validate SUMMARY (generic = warn) -> Validate FILES CHANGED (missing for file task = warn) -> Process deviations -> Handle PARTIAL as completed with warn -> Eager dispatch scan.

---

## On Failure -- Recovery Steps 0-7

When a worker returns with `status: "failed"`, execute these steps in order. Failed tasks do NOT satisfy dependencies. Downstream tasks remain blocked.

### Step 0 -- Check for Double Failure

If the failed task's ID ends with `r`, it is a repair task. Do NOT create another repair task.

1. Log `"error"`: `"Double failure: repair task {id} failed. Original task permanently blocked."`
2. Log `"permission"`: `"Repair task {id} failed -- manual intervention required."`
3. Add to permanently_failed list.
4. **Skip Steps 1-6.** Proceed to Step 7.

### Step 1 -- Log the Failure

Write an `"error"` entry to `logs.json` with the failed task's summary/error.

### Step 2 -- Create Repair Task in initialization.json

Append a new entry to `agents[]`. This is the **one exception** to the write-once rule.

- **ID:** `"{failed_task_wave}.{next_available_index}r"` (e.g., `2.1` fails, wave 2 has 3 tasks -> repair ID is `2.4r`)
- **Title:** `"REPAIR: {original task title}"`
- **Wave, Layer, Directory:** Same as the failed task
- **`depends_on`:** Identical to the failed task's deps (already satisfied)
- Increment `total_tasks` and relevant `waves[].total`

### Step 3 -- Rewire Dependency Chain

Every task with the failed ID in its `depends_on` -> replace with the repair ID. This splices the repair task in as a drop-in replacement.

### Step 4 -- Update chains[] (if applicable)

If `task.type` is `"Chains"`, find the chain containing the failed task and insert the repair ID immediately after the failed task's ID.

### Step 5 -- Dispatch Repair Worker

Send a worker with `failed_task.md` protocol. The dispatch prompt **must** include:

- The original task's full dispatch prompt
- The failed task's progress file contents (errors, logs, deviations)
- The repair task ID and progress file path
- Instruction to follow `failed_task.md`: diagnose before implementing

### Step 6 -- Log the Repair Dispatch

Write `"info"` to `logs.json`: `"Dispatching repair task {repair_id} for failed task {failed_id} -- {brief reason}"`.

### Step 7 -- Eager Dispatch Scan

Run the normal eager dispatch scan. Other unblocked tasks continue. The pipeline does not stop.

---

## Double Failure Escalation

> **NON-NEGOTIABLE:** If a repair task (ID ends with `r`) itself fails, do NOT create another repair task.

- Mark the original task as permanently failed
- Log `"error"` + `"permission"` entries (triggers dashboard popup)
- Continue dispatching other unblocked tasks -- the swarm does not stop
- List permanently failed tasks separately in the final report with both failure summaries

---

## Circuit Breaker Thresholds

The circuit breaker fires when **any** of these conditions is met (whichever hits first):

| Condition | Meaning |
|---|---|
| 3+ tasks fail within the same wave | Shared root cause likely |
| A single failure blocks 3+ downstream tasks | Cascading through dependency graph |
| A single failure blocks >50% of remaining tasks | Critical-path failure |

---

## Circuit Breaker Response (Steps 1-7)

### Step 1 -- Pause Dispatches
No new workers until replanning completes. Set internal replanning flag.

### Step 2 -- Gather Context
Read ALL progress files. Build three lists: completed (ID + summary), failed (ID + summary + stage + errors + deviations), pending/blocked (ID + deps + which deps failed vs completed).

### Step 3 -- Analyze Root Cause
Are failures related? Shared file, shared pattern, shared dependency? Shared root cause vs isolated? Which graph branches are salvageable?

### Step 4 -- Produce Revision Plan

| Category | Description |
|---|---|
| `modified` | Pending tasks needing updated descriptions or `depends_on` |
| `added` | New repair tasks (IDs suffixed with `r`, titles prefixed "REPAIR:") |
| `removed` | Pending tasks no longer viable (entire dep chain broken). Remove from `agents[]`, clean from all `depends_on` arrays |
| `retry` | Failed tasks to re-dispatch as-is (transient failures). Delete their progress files |

### Step 5 -- Apply Revision to initialization.json
Read -> modify agents[], update totals -> write. This is the documented write-once exception.

### Step 6 -- Log Replanning Outcome
`"info"`: `"Replanning complete -- modified: {N}, added: {N}, removed: {N}, retry: {N}. Resuming dispatch."`

### Step 7 -- Resume Dispatch
Clear replanning flag. Resume normal eager dispatch scan.

---

## Repair Worker Dispatch Requirements

Every repair worker dispatch **must** include all four of these:

1. **Original task's full dispatch prompt** -- complete context of what was intended
2. **Failed task's progress file** -- error details, logs, deviations, stage at failure
3. **Repair task ID and progress file path** -- where the repair worker reports progress
4. **Instruction to follow failed_task.md** -- diagnose root cause before implementing

> **Permission gate:** Repair workers report back to the master for major deviations instead of proceeding autonomously. The master writes a `"permission"` log entry (triggers dashboard popup) and asks the user for guidance before continuing.

---

## Rules Summary

1. Validate every worker return before processing -- NON-NEGOTIABLE
2. Failed tasks never satisfy dependencies
3. Create repair tasks, not second repair tasks (double failure = permanent)
4. Rewire the full dependency chain when creating a repair task
5. Always dispatch repair workers with the 4 required items
6. Check circuit breaker thresholds after every failure
7. Pause and replan on circuit breaker -- never push through cascading failures
8. The swarm continues around failures -- only direct dependents are blocked
9. Permission gate for major deviations -- do not guess on fundamental issues
10. Log everything: failures, repairs, replanning, permission requests
