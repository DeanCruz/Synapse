# Completion Phase

The completion phase begins when all worker agents have returned with terminal status (completed or failed) and no more tasks are dispatchable. The master agent compiles a final report, optionally dispatches a verification agent, updates project metadata, writes final log entries, and prepares for archiving. This phase represents the transition from active swarm orchestration back to normal agent behavior.

---

## Phase Overview

```
All workers returned (completed or failed)
    |
    v
+----------------------------------+
| 1. UPDATE MASTER TASK FILE       |
|    Set overall_status             |
|    Verify all task summaries      |
+----------------------------------+
    |
    v
+----------------------------------+
| 2. WRITE COMPLETION LOG ENTRY    |
|    Final log to logs.json         |
|    "Swarm complete: N/M succeeded"|
+----------------------------------+
    |
    v
+----------------------------------+
| 3. VERIFICATION (optional)       |
|    Assess whether needed          |
|    Dispatch verification agent    |
|    Run tests, type checks, build  |
|    Log verification results       |
+----------------------------------+
    |
    v
+----------------------------------+
| 4. READ LOGS AND COMPILE REPORT  |
|    Read full logs.json            |
|    Analyze all events             |
|    Deliver structured final report|
+----------------------------------+
    |
    v
+----------------------------------+
| 5. POST-SWARM CLEANUP            |
|    Update project TOC if needed   |
|    Save history (if applicable)   |
|    Master resumes normal behavior |
+----------------------------------+
```

---

## Step 1: Update the Master Task File

When all tasks have reached terminal state, the master updates the task file at `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`:

- Set `<overall_status>` to `completed` (if all tasks succeeded or were repaired) or `failed` (if any tasks failed without recovery)
- Verify that every task has its `<status>`, `<completed_at>`, and `<summary>` populated from earlier monitoring-phase updates

The task file is the authoritative long-term record of the swarm. It contains the complete history: descriptions, context, dependency chains, status, summaries, logs, and timing for every task.

---

## Step 2: Write Completion Log Entry

The master captures a live timestamp and appends a final entry to `{tracker_root}/dashboards/{dashboardId}/logs.json`:

```json
{
  "timestamp": "2026-03-22T14:45:00Z",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Swarm complete: 7/8 tasks succeeded, 1 failed in 12m 34s",
  "task_name": "add-rate-limiting"
}
```

The dashboard displays a green "Complete" badge in the log panel header when it detects that the count of progress files with terminal status (completed or failed) equals `task.total_tasks` and no progress files show `in_progress`.

Note that the master does NOT update `initialization.json` on completion. The dashboard derives `overall_status` and timing from the aggregate of worker progress files. The elapsed timer freezes when all workers have `completed_at` set in their progress files.

---

## Step 3: Post-Swarm Verification

After all tasks complete, the master assesses whether a verification step is warranted. Verification catches integration issues that individual workers cannot detect -- problems that only emerge when changes from multiple workers are combined.

### When Verification Is Needed

| Condition | Verification Recommendation | Reason |
|---|---|---|
| Swarm modified existing code across multiple files | **Recommended** | Cross-file integration issues between workers |
| Any tasks reported CRITICAL deviations | **Strongly recommended** | Deviations may break downstream assumptions |
| Any tasks reported warnings about unexpected state | **Recommended** | Warnings may indicate latent issues |
| Swarm was purely additive (new files only, no modifications) | Optional | Lower risk of integration issues |
| All tasks succeeded with no warnings or deviations | May skip | Low risk |

### Verification Agent Prompt

If verification is warranted, the master dispatches a single verification agent:

```
You are verifying the combined output of a {N}-task parallel swarm: "{task-slug}"

## Files Changed
{Complete list from the master's result cache -- all files created/modified/deleted
across all tasks, with the task ID that changed each file}

## What To Verify
1. Run the project's test suite (if one exists)
2. Run type checking (if applicable)
3. Run the build (if applicable)
4. Check for integration issues:
   - Missing imports between files changed by different workers
   - Conflicting exports or type definitions
   - Broken references between modified files
   - Inconsistent naming or patterns across changes

## Report
Return:
- TESTS: pass | fail | no test suite
- TYPES: pass | fail | N/A
- BUILD: pass | fail | N/A
- ISSUES: {list of any integration problems found, or "None"}
```

### Cross-Repository Verification

When the swarm spans multiple repositories, the verification agent also checks:

1. **Type/interface consistency** -- For every shared type or API contract modified, verify that all consuming repos use the updated signature
2. **Import path validity** -- Verify that cross-repo imports resolve correctly after file moves or renames
3. **Contract alignment** -- If the swarm modified both a backend API and its frontend consumer, verify request/response shapes match

### Logging Verification Results

The master logs the verification result to `logs.json`:

```json
{
  "timestamp": "2026-03-22T14:47:00Z",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Verification: Tests pass (24/24), types pass, build pass, no integration issues",
  "task_name": "add-rate-limiting"
}
```

If verification found issues:

```json
{
  "timestamp": "2026-03-22T14:47:00Z",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "warn",
  "message": "Verification: Tests pass, but 2 type errors found -- missing export in src/types/rateLimit.ts",
  "task_name": "add-rate-limiting"
}
```

---

## Step 4: Final Report

The master reads `{tracker_root}/dashboards/{dashboardId}/logs.json` in full, analyzes all entries for the current task, and delivers a structured final report.

### Final Report Template

```markdown
## Swarm Complete: {task-slug}

**{completed}/{total} tasks** -- **{W} waves** -- **{0 or N} failures** -- **Type: {Waves|Chains}**

### What Was Done
{2-4 sentences. What was the goal? What was accomplished? Any significant decisions?}

### Files Changed
| File | Action | Task |
|---|---|---|
| {path} | created / modified / deleted | {task id} |

### Important Logs and Observations
{Summary of the most significant log entries -- not every log, just the ones that
matter. Focus on: unexpected findings, key decisions, performance notes.}

### Divergent Actions
(Only if any agents deviated -- omit entirely if all followed the plan)
- **{task id} -- {title}:** {what was different and why}

### Warnings
(Only if agents reported unexpected findings -- omit entirely if none)
- **{task id}:** {warning description}

### Failures
(Only if tasks failed -- omit entirely if all succeeded)
- **{task id} -- {title}:** {what failed and why}
- **Blocked by failure:** {any tasks that could not run as a result}

### Verification
(Only if a verification step was run -- omit entirely if skipped)
- **Tests:** {pass | fail | no test suite}
- **Types:** {pass | fail | N/A}
- **Build:** {pass | fail | N/A}
- **Issues:** {list of integration problems, or "None"}

### Recommendations and Next Steps
(Only if applicable -- omit if the task is fully complete)
- {Recommendation based on what was learned during execution}

### Artifacts
- **Task Record:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
- **Plan:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`
- **Dashboard:** `{tracker_root}/dashboards/{dashboardId}/initialization.json`
- **Logs:** `{tracker_root}/dashboards/{dashboardId}/logs.json`
```

### What the Master Assesses

During report compilation, the master evaluates the overall outcome:

| Outcome | Description | Report Tone |
|---|---|---|
| **Complete success** | All tasks completed, no significant deviations | Straightforward summary |
| **Success with deviations** | All tasks completed, some deviated from plan | Note deviations, assess impact |
| **Partial success** | Some tasks completed, some failed | Report both; recommend follow-up |
| **Failures recovered** | Tasks failed but repair workers succeeded | Note the recovery, original errors, and final state |
| **Unrecoverable failures** | Tasks failed and could not be repaired | Explain what blocked recovery, recommend manual intervention |

---

## Step 5: Post-Swarm Cleanup

### Project TOC Update

If the swarm created, moved, or restructured files in the project, and a project TOC exists at `{project_root}/.synapse/toc.md`, the master updates it to reflect the new file structure.

This update is done only when:
- A TOC already exists (the master does not create one during completion)
- The swarm actually changed the project's file structure (new files, moved files, deleted files)

### History Summary

The master may save a history summary to `{tracker_root}/history/` for future reference via the `!history` command:

```json
{
  "name": "add-rate-limiting",
  "completed_at": "2026-03-22T14:45:00Z",
  "duration": "12m 34s",
  "total_tasks": 8,
  "completed_tasks": 7,
  "failed_tasks": 1,
  "repaired_tasks": 1,
  "dashboard": "dashboard1",
  "project_root": "/Users/dean/repos/my-app"
}
```

### Dashboard Data Preservation

The completed swarm data remains on the dashboard until cleared by the next swarm or `!reset`. When a new swarm needs the dashboard, the planning phase archives the existing data to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/` before clearing. This archiving happens during the next swarm's planning, not during the current completion.

The archive preserves:
- `initialization.json` -- The complete plan
- `logs.json` -- The full event timeline
- `progress/` -- All worker progress files with stages, milestones, deviations, and logs

### Archive Directory Structure

```
{tracker_root}/Archive/
  2026-03-22_add-rate-limiting/
    initialization.json
    logs.json
    progress/
      1.1.json
      1.2.json
      2.1.json
      ...
  2026-03-20_refactor-auth/
    initialization.json
    logs.json
    progress/
      ...
```

Previous swarm data is never discarded. This is a non-negotiable constraint -- every swarm that runs through a dashboard is preserved in the archive for future reference.

---

## Return to Normal Mode

Once the swarm is complete and the final report is delivered, the master agent's orchestrator restrictions are lifted. It may resume normal agent behavior (including direct code edits) if the user requests non-parallel work.

### Conditions for Exiting Orchestrator Mode

The master exits orchestrator mode when ALL of the following are true:

1. All workers have returned with terminal status (completed or failed)
2. No repair tasks are pending or in progress
3. The final report has been compiled and presented to the user
4. No verification agent is currently running

The no-code restriction applies exclusively during active swarm orchestration. Once the swarm is over, the agent operates normally.

---

## Dashboard Final State

When all tasks reach terminal status, the dashboard shows:

| Element | State |
|---|---|
| **Progress bar** | 100% (or less if tasks failed) |
| **Stat cards** | Completed = N, Failed = M, In Progress = 0, Pending = 0 |
| **Elapsed timer** | Frozen at final duration |
| **Agent cards** | All green (completed) or red (failed), with duration badges |
| **Deviation badges** | Yellow on any card with deviations |
| **Log panel** | Green "Complete" badge next to entry count |
| **Dependency lines** | All rendered; green for completed chains |

The dashboard remains in this state until cleared.

---

## Partial Completion Scenarios

Not every swarm finishes cleanly. The master must handle several partial completion scenarios.

### Some Tasks Failed, Others Succeeded

The master reports both successes and failures:

```markdown
## Swarm Partially Complete: {task-slug}

**Tasks:** 6/8 completed, 2/8 failed
**Successful work:** Auth middleware, rate limiting, config types (tasks 1.1-1.4, 2.1-2.2)
**Failed work:** Integration tests, e2e tests (tasks 3.1, 3.2 -- blocked by missing test fixtures)

### Recommended Follow-Up
- Create test fixtures manually, then run `!retry 3.1` and `!retry 3.2`
```

### Worker Partial Completion

Individual workers may report partial completion (80%+ of the task done but a blocker on the remainder). Workers set `status: "completed"` (not `"failed"`) for partial completion, with a clear summary stating what was done and what remains.

The master includes these in the report:

```markdown
### Partially Completed Tasks
| Task | Title | Done | Remaining |
|---|---|---|---|
| 2.3 | Create user endpoints | 3/4 endpoints | /users/delete blocked by missing soft-delete migration |
```

### Circuit Breaker Was Triggered

If the circuit breaker fired and replanning occurred during execution, the completion report includes the replanning details: what triggered it, what the root cause was, what revision was applied, and how the revised plan executed. See [Circuit Breaker](./circuit-breaker.md) for the full protocol.

---

## Related Documentation

- [Overview](./overview.md) -- End-to-end swarm lifecycle summary
- [Planning Phase](./planning-phase.md) -- Context gathering and task decomposition
- [Dispatch Phase](./dispatch-phase.md) -- Worker dispatch mechanics and eager dispatch protocol
- [Monitoring Phase](./monitoring-phase.md) -- Live progress tracking and deviation handling
- [Circuit Breaker](./circuit-breaker.md) -- Automatic replanning on cascading failures
