# Upstream Results Protocol

When a worker task depends on other tasks that ran before it, the worker **must** read those tasks' progress files and adapt to what was actually built. This is NON-NEGOTIABLE for any task with upstream dependencies.

This document covers the full upstream results protocol: how to read upstream progress files, what to extract, how to adapt, and how to log what was learned.

**Source of truth:** `agent/worker/upstream_deps.md`

---

## Why Upstream Results Matter

The master agent writes dispatch prompts during the **planning phase** -- before any work is done. By the time a dependent task runs, upstream workers may have:

- Deviated from the plan (different file names, different APIs, different approaches)
- Encountered errors (partial completion, workarounds)
- Changed interfaces (different function signatures, different types)
- Used different conventions (different patterns than what the master planned)

If a worker only relies on the master's dispatch prompt, it is working from a **stale snapshot** of what was planned, not what was actually built. Reading the upstream progress files gives the worker the **actual state of the world** as left by the workers before it.

The master may include an UPSTREAM RESULTS section in the dispatch prompt summarizing what upstream tasks accomplished, but the progress files contain the **ground truth**: what actually happened, what deviated, what failed, and what the upstream worker logged.

---

## The 4-Step Procedure

### Step 1: Read Upstream Progress Files

For each dependency task ID listed in the dispatch prompt, read the progress file at:

```
{tracker_root}/dashboards/{dashboardId}/progress/{dependency_task_id}.json
```

**Example:** If a task depends on `1.1` and `1.3`, read both files:
- `{tracker_root}/dashboards/{dashboardId}/progress/1.1.json`
- `{tracker_root}/dashboards/{dashboardId}/progress/1.3.json`

**Read these files in parallel** -- they have no dependency on each other. Use the Read tool to read them all in a single parallel call.

This read happens immediately after the initial progress file write, during the `reading_context` stage.

---

### Step 2: Extract Critical Information

From each upstream progress file, extract these fields:

| Field | What to Look For |
|---|---|
| `status` | Did it complete successfully or fail? If `"failed"`, assess whether the current task can still proceed. |
| `summary` | What the upstream task accomplished -- the definitive one-line result. Cross-reference with what the dispatch prompt expects. |
| `deviations[]` | Every plan divergence. Pay special attention to `CRITICAL` severity -- these may change assumptions about interfaces, file locations, or APIs. |
| `milestones[]` | What was actually built, in order. Cross-reference with what the dispatch prompt expects to exist. |
| `logs[]` | The full narrative of what happened. Scan for `"error"` and `"warn"` level entries -- these reveal issues that may affect the current task. |
| `message` | Final state message -- useful for understanding the last thing the upstream worker did. |

### Priority of Information

When there is a conflict between the dispatch prompt and the upstream progress file:

1. **Progress file wins** -- it reflects what actually happened
2. **Dispatch prompt is the original plan** -- it reflects what was intended
3. **The worker adapts to reality, not the plan**

---

### Step 3: Adapt Your Approach

Based on what was found in the upstream progress files, the worker must adapt its approach. The action depends on what the upstream tasks reported.

#### If an Upstream Task Failed

Log a `"warn"` entry explaining which dependency failed and how the worker is proceeding.

**If the failure means a file or API the worker needs does not exist:**
- Attempt to work around it if possible
- If the task fundamentally depends on the missing artifact, set the worker's own status to `"failed"` with a clear explanation

**Example log entry:**
```json
{ "at": "...", "level": "warn", "msg": "Upstream 1.1 FAILED -- auth middleware does not exist. Attempting to create endpoint without auth, will note as deviation." }
```

#### If an Upstream Task Has CRITICAL Deviations

The upstream worker changed something the dispatch prompt assumed would be a certain way. **Adapt the implementation to match what was actually built, not what was planned.**

Log every adaptation as a deviation in the worker's own progress file.

**Example:**
- The dispatch prompt says to import `getUsers()` from `src/services/user.ts`
- The upstream progress file shows a CRITICAL deviation: the function was renamed to `fetchUsers()`
- The worker imports `fetchUsers()` instead and logs the adaptation

```json
{
  "at": "...",
  "severity": "MODERATE",
  "description": "Adapting to upstream 1.3 CRITICAL deviation: importing fetchUsers() instead of planned getUsers() -- upstream renamed the export"
}
```

#### If an Upstream Task Has MODERATE Deviations

Note them but they likely do not affect the worker's task. Log that they were reviewed.

**Example log entry:**
```json
{ "at": "...", "level": "info", "msg": "Upstream 1.3 has 1 MODERATE deviation (used async readFile instead of sync) -- does not affect this task" }
```

#### If an Upstream Task's Logs Contain Error Entries

Even if the task completed, errors may indicate partial issues. Review them to ensure nothing impacts the current task.

**Example log entry:**
```json
{ "at": "...", "level": "info", "msg": "Upstream 1.1 completed but logged 2 errors during testing -- reviewed, both were transient test runner issues, not code problems" }
```

---

### Step 4: Log What Was Learned

After reading all upstream progress files, add a summary log entry:

```json
{
  "at": "...",
  "level": "info",
  "msg": "Read upstream dependencies: 1.1 (completed, no deviations), 1.3 (completed, 1 MODERATE deviation -- used alternative API pattern)"
}
```

If any upstream deviation requires the worker to adapt, log it immediately as both a deviation and a log entry:

```json
{
  "at": "...",
  "level": "deviation",
  "msg": "Adapting to upstream 1.3 deviation: using fetchUsers() instead of planned getUsers() -- upstream changed the export name"
}
```

---

## Handling Upstream Failures

When an upstream task has `status: "failed"`, the downstream worker must make a viability assessment:

1. **Can the task proceed without the upstream output?** If the current task only loosely depends on the upstream (e.g., it can create a stub or alternative), attempt a workaround and log it as a deviation.

2. **Does the task fundamentally require the upstream output?** If a required file, API, or interface does not exist because the upstream failed, set the current task's status to `"failed"` with a clear explanation referencing the upstream failure.

3. **Always log the failure.** Whether proceeding or failing, add a `"warn"` level log entry documenting the upstream failure and the decision made.

---

## Handling Upstream CRITICAL Deviations

When an upstream task reports CRITICAL deviations, the downstream worker must:

1. **Identify what changed** -- Read the deviation description to understand which interface, API, or contract was modified.
2. **Compare against dispatch prompt assumptions** -- Determine if the dispatch prompt references the old interface.
3. **Adapt the implementation** -- Use the actual interface/API as reported in the upstream progress file, not the planned version from the dispatch prompt.
4. **Report the adaptation as a deviation** -- Add a MODERATE deviation to the worker's own progress file explaining the adaptation.
5. **Log the adaptation** -- Add a `"deviation"` level log entry for dashboard visibility.

---

## Complete Example

Consider a worker assigned task `2.1` which depends on tasks `1.1` and `1.3`.

### Reading Upstream Files

The worker reads both progress files in parallel:

**`progress/1.1.json`** -- status: `"completed"`, no deviations, summary: "Created User model with CRUD operations"

**`progress/1.3.json`** -- status: `"completed"`, 1 CRITICAL deviation:
```json
{
  "at": "2026-02-25T14:10:00Z",
  "severity": "CRITICAL",
  "description": "Changed createUser(name, email) to createUser(userData: CreateUserInput) -- existing validation middleware required structured input"
}
```

### Adapting

The worker's dispatch prompt says to call `createUser(name, email)`. But the upstream progress file shows this function signature changed to `createUser(userData: CreateUserInput)`.

The worker:

1. Adapts its implementation to use `createUser({ name, email })` with the new structured input
2. Reports a deviation in its own progress file:
   ```json
   {
     "at": "...",
     "severity": "MODERATE",
     "description": "Adapted createUser() call to use structured input (CreateUserInput) instead of positional args -- upstream 1.3 changed the function signature"
   }
   ```
3. Logs the adaptation:
   ```json
   { "at": "...", "level": "deviation", "msg": "Adapted to upstream 1.3 CRITICAL deviation: createUser() now takes CreateUserInput object instead of positional (name, email) args" }
   ```

### Summary Log

```json
{ "at": "...", "level": "info", "msg": "Read upstream dependencies: 1.1 (completed, no deviations), 1.3 (completed, 1 CRITICAL deviation -- changed createUser signature to structured input). Adapted implementation accordingly." }
```

---

## Decision Matrix

| Upstream Status | Upstream Deviations | Action |
|---|---|---|
| Completed | None | Proceed normally. Log that upstream was clean. |
| Completed | MINOR only | Proceed normally. Note the deviations in logs. |
| Completed | MODERATE | Proceed normally. Review deviations, note in logs. Unlikely to affect current task. |
| Completed | CRITICAL | **Adapt implementation** to match actual upstream output. Log every adaptation as a deviation. |
| Completed | Mixed severities | Handle each deviation by severity. CRITICAL deviations require adaptation. |
| Completed with errors in logs | Any | Review error entries. Assess if they indicate partial work that affects current task. |
| Failed | N/A | **Assess viability.** If the current task depends on the failed task's output, either work around it or fail with a clear explanation. |

---

## Timing in the Worker Lifecycle

The upstream results protocol happens at a specific point in the worker lifecycle:

```
1. Write initial progress file (status: in_progress, stage: reading_context)
2. >>> READ UPSTREAM PROGRESS FILES HERE <<<
3. Log what was learned from upstream
4. Read project files, CLAUDE.md, source code
5. Transition to planning stage
6. ... continue with normal execution
```

This happens **before reading any project files** and **before planning the approach**. The upstream results may change the approach entirely, so they must be absorbed before any planning begins.

---

## Rules Summary

1. **Reading upstream progress files is NON-NEGOTIABLE** for any task with dependencies
2. **Read in parallel** -- upstream files have no dependency on each other
3. **Progress files are ground truth** -- they override the dispatch prompt when there is a conflict
4. **CRITICAL deviations require adaptation** -- change the implementation to match actual upstream output
5. **Log everything** -- what was read, what was found, how the worker adapted
6. **Report adaptations as deviations** in the worker's own progress file
7. **Upstream errors matter** even in completed tasks -- review log entries for hidden issues
8. **Failed upstreams require assessment** -- can the current task proceed without the failed output?
