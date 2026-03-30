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
|    Post-verification fix if needed|
+----------------------------------+
    |
    v
+----------------------------------+
| 4. COMPUTE SWARM METRICS         |
|    Read all progress files        |
|    Calculate performance metrics  |
|    Write metrics.json             |
|    Log metrics summary            |
+----------------------------------+
    |
    v
+----------------------------------+
| 5. READ LOGS AND COMPILE REPORT  |
|    Read full logs.json            |
|    Read all progress files        |
|    Read task file + metrics.json  |
|    Deliver structured final report|
+----------------------------------+
    |
    v
+----------------------------------+
| 6. POST-SWARM CLEANUP            |
|    Save to history/               |
|    Update project TOC if needed   |
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

1. **Type/interface consistency** -- For every shared type or API contract modified by the swarm, verify that all consuming repos use the updated signature. Grep for the type name across all affected repos.
2. **Import path validity** -- Verify that cross-repo imports (if any) resolve correctly after file moves or renames.
3. **Contract alignment** -- If the swarm modified both a backend API and its frontend consumer, verify request/response shapes match.

If cross-repo inconsistencies are found, log them at level `"warn"` and include them in the final report's Warnings section.

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

### Post-Verification Fix Procedure

If the verification agent reports issues:

1. Log each issue in `logs.json` at `"warn"` level with the specific file and line
2. For each issue, create a targeted repair task with:
   - A clear description of what needs fixing
   - The specific files and lines involved
   - The verification failure message
3. Dispatch repair tasks to worker agents
4. **Do NOT fix issues directly** -- the no-code constraint still applies during verification and post-verification
5. After repair tasks complete, re-run verification if the issues were integration-related
6. Update the final report to reflect the additional fix tasks

---

## Step 4: Compute Swarm Metrics

After all tasks complete (and after verification, if run), the master computes swarm performance metrics and writes them to `{tracker_root}/dashboards/{dashboardId}/metrics.json`. These metrics enable historical performance comparison and parallelization efficiency tracking.

### Computation Procedure

1. Read all progress files in `{tracker_root}/dashboards/{dashboardId}/progress/`.
2. For each completed task, compute its duration: `completed_at - started_at` (in seconds).
3. Compute the following metrics:

| Metric | How to Compute |
|---|---|
| `elapsed_seconds` | Latest `completed_at` across all workers minus earliest `started_at` across all workers |
| `serial_estimate_seconds` | Sum of all individual task durations (what it would take if tasks ran sequentially) |
| `parallel_efficiency` | `serial_estimate_seconds / elapsed_seconds` (higher = better parallelism; 1.0 = no benefit; >1.0 = parallel speedup) |
| `duration_distribution` | `{ min, avg, max, median }` of individual task durations in seconds |
| `failure_rate` | `failed_tasks / total_tasks` (0.0 = no failures) |
| `max_concurrent` | Peak number of simultaneously in-progress tasks (compute from overlapping `started_at`/`completed_at` windows) |
| `deviation_count` | Total deviations across all tasks (sum of all `deviations[]` array lengths) |
| `total_tasks` | Total number of tasks in the swarm |
| `completed_tasks` | Count of tasks with `status === "completed"` |
| `failed_tasks` | Count of tasks with `status === "failed"` |

### Metrics File Schema

```json
{
  "swarm_name": "add-rate-limiting",
  "computed_at": "2026-03-22T14:45:30Z",
  "elapsed_seconds": 187,
  "serial_estimate_seconds": 612,
  "parallel_efficiency": 3.27,
  "duration_distribution": {
    "min": 28,
    "avg": 76.5,
    "max": 142,
    "median": 71
  },
  "failure_rate": 0.0,
  "max_concurrent": 5,
  "deviation_count": 2,
  "total_tasks": 8,
  "completed_tasks": 8,
  "failed_tasks": 0
}
```

### Logging Metrics

The master logs the metrics summary to `logs.json`:

```json
{
  "timestamp": "2026-03-22T14:45:30Z",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Metrics: 187s elapsed, 3.27x efficiency, 5 max concurrent, 0.0 failure rate",
  "task_name": "add-rate-limiting"
}
```

Note: `metrics.json` is written once after swarm completion. It is not watched by the server for live updates -- it is a post-hoc analysis artifact. The dashboard may optionally read it for a metrics summary panel in future versions.

---

## Step 5: Final Report

The master must read ALL of the following data before compiling the report:

1. **`{tracker_root}/dashboards/{dashboardId}/logs.json` in full** -- Analyze all entries for the current task
2. **Every progress file** in `{tracker_root}/dashboards/{dashboardId}/progress/` -- Extract summaries, deviations, milestones, warnings, and logs from each worker
3. **The master task file** at `{tracker_root}/tasks/{date}/parallel_{task_name}.json` -- Cross-reference planned vs. actual outcomes
4. **`{tracker_root}/dashboards/{dashboardId}/metrics.json`** -- Include performance data from Step 4

The master then synthesizes all gathered data into a structured final report. Every section marked REQUIRED must appear. Sections marked CONDITIONAL appear only when their trigger condition is met. The report is non-negotiable -- it must be comprehensive enough that a developer who was not present during the swarm can understand what happened, what changed, and what to do next.

### Final Report Template

```markdown
## Swarm Complete: {task-slug}

**{completed}/{total} tasks** -- **{W} waves** -- **{0 or N} failures** -- **{elapsed_seconds}s elapsed** -- **{parallel_efficiency}x parallel efficiency** -- **Type: {Waves|Chains}**

---

### Summary of Work Completed (REQUIRED)

{Thorough summary of what was accomplished. This is NOT a 2-sentence blurb -- it should
give the user a complete understanding of the work without needing to read individual task
outputs. Cover:
- What was the original goal?
- What was actually built/changed/fixed?
- How does the implementation work at a high level?
- Any significant architectural or design decisions made during execution?
- What is the current state of the feature/fix -- is it fully functional, partially
  complete, or needs follow-up?

Aim for a well-structured summary that tells the full story.}

### Files Changed (REQUIRED)

| File | Action | Task | What Changed |
|---|---|---|---|
| {path} | created / modified / deleted | {task id} | {1-line description of the change} |

{Group files logically if the swarm was large -- by feature area, directory, or layer.}

### Deviations & Their Impact (CONDITIONAL -- include if ANY worker reported deviations)

For each deviation:
- **Task {id} -- {title}**
  - **What changed:** {What the worker did differently from the plan}
  - **Why:** {The reason for the deviation}
  - **Impact on project:** {How this deviation affects the codebase, other features, future work}

### Warnings & Observations (CONDITIONAL -- include if any workers reported warnings)

- **{task id}:** {warning description and its significance}

### Failures (CONDITIONAL -- include if any tasks failed)

- **{task id} -- {title}:** {what failed and why}
- **Recovery:** {was a repair task dispatched? Did it succeed?}
- **Blocked by failure:** {any tasks that could not run as a result}
- **Residual impact:** {any incomplete work or broken state left behind}

### Verification Results (CONDITIONAL -- include if a verification step was run)

- **Tests:** {pass | fail | no test suite}
- **Types:** {pass | fail | N/A}
- **Build:** {pass | fail | N/A}
- **Issues:** {list of integration problems, or "None"}

### Potential Improvements (REQUIRED)

{Based on everything the master observed during the swarm -- worker logs, deviations, code
patterns, architectural decisions -- identify improvements that could be made to the work
that was just completed or to the surrounding codebase. Consider:
- Code quality: DRY violations? Missing abstractions?
- Performance: Any potential concerns noted by workers?
- Robustness: Error handling gaps? Missing edge cases?
- Testing: Adequate coverage? What is missing?
- Architecture: Does the new code fit well? Coupling concerns?

If the work is genuinely clean and complete with no improvements needed, explicitly state
that and briefly explain why.}

### Future Steps (REQUIRED)

{Concrete, actionable next steps that emerge naturally from the work done:
- Follow-up work that was out of scope but is now possible or necessary
- Integration steps (e.g., "Wire the new component into the main layout")
- Manual testing that should be done
- Configuration or environment changes needed
- Related features or improvements that would complement this work

If the task is self-contained: "No immediate follow-up required."}

### Performance (REQUIRED)

| Metric | Value |
|---|---|
| Wall-clock time | {elapsed_seconds}s |
| Serial estimate | {serial_estimate_seconds}s |
| Parallel efficiency | {parallel_efficiency}x |
| Max concurrent agents | {max_concurrent} |
| Total deviations | {deviation_count} |
| Failure rate | {failure_rate} |

### Artifacts

- **Task file:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
- **Plan:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`
- **Dashboard:** `{tracker_root}/dashboards/{dashboardId}/initialization.json`
- **Logs:** `{tracker_root}/dashboards/{dashboardId}/logs.json`
- **Metrics:** `{tracker_root}/dashboards/{dashboardId}/metrics.json`
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

## Step 6: Post-Swarm Cleanup

### Save to History

After delivering the final report, the master saves a history summary to `{tracker_root}/history/` for future reference via the `!history` command. This enables history lookups without reading full dashboard data.

```json
{
  "name": "add-rate-limiting",
  "completed_at": "2026-03-22T14:45:00Z",
  "duration": "12m 34s",
  "total_tasks": 8,
  "completed_tasks": 7,
  "failed_tasks": 1,
  "repaired_tasks": 1,
  "dashboard": "540931",
  "project_root": "/Users/dean/repos/my-app"
}
```

### Project TOC Update

If the swarm created, moved, or restructured files in the project, and a project TOC exists at `{project_root}/.synapse/toc.md`, the master updates it to reflect the new file structure.

This update is done only when:
- A TOC already exists (the master does not create one during completion)
- The swarm actually changed the project's file structure (new files, moved files, deleted files)

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

### Post-Swarm Transition Checklist

ALL of the following conditions must be true before the master exits orchestrator mode:

1. All tasks are in a terminal state (completed or failed) -- no in_progress or pending tasks remain
2. The final report has been written and presented to the user
3. Metrics have been recorded in `metrics.json`
4. The dashboard has been archived (if the user requested archiving)
5. The user has explicitly acknowledged the swarm is finished

Only after ALL five conditions are met does the master role end. "Almost done" is not done. "Just one task left" still requires a worker agent.

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
