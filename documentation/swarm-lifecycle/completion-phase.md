# Completion Phase

The completion phase begins when all worker agents have returned (completed or failed) and no more tasks are dispatchable. The master agent compiles a final report, optionally dispatches verification, updates project metadata, and archives the swarm data.

---

## Phase Overview

```
All workers returned (completed or failed)
    |
    v
+----------------------------------+
| 1. COMPILE FINAL SUMMARY        |
|                                  |
|    What was accomplished         |
|    What failed and why           |
|    What needs follow-up          |
+----------------------------------+
    |
    v
+----------------------------------+
| 2. VERIFICATION (optional)       |
|                                  |
|    Dispatch verification agent   |
|    Run tests, type checks, build |
|    Catch integration issues      |
+----------------------------------+
    |
    v
+----------------------------------+
| 3. UPDATE PROJECT METADATA       |
|                                  |
|    Update TOC if structure changed|
|    Update XML with final status  |
|    Write completion log entry    |
+----------------------------------+
    |
    v
+----------------------------------+
| 4. ARCHIVE (if needed)           |
|                                  |
|    Save history summary          |
|    Archive dashboard data        |
|    Return to normal mode         |
+----------------------------------+
```

---

## Step 1: Compile Final Summary

When all tasks have reached a terminal state (completed or failed), the master compiles a comprehensive summary.

### Summary Components

The master gathers data from multiple sources:

| Source | What to Extract |
|---|---|
| **Progress files** | Final status, summary, deviations for each task |
| **Master XML** | Task descriptions, file lists, dependency chains |
| **logs.json** | Timeline of events, errors, warnings |

### Summary Structure

```markdown
## Swarm Complete: {task-slug}

**Duration:** {elapsed time}
**Tasks:** {completed}/{total} completed, {failed}/{total} failed

### Completed Tasks
| Task | Title | Summary | Duration |
|---|---|---|---|
| 1.1 | Create rate limiter | Created middleware with sliding window | 3m 22s |
| 1.2 | Define config types | Defined RateLimitConfig interface | 1m 45s |

### Failed Tasks (if any)
| Task | Title | Error | Repair Status |
|---|---|---|---|
| 2.1 | Integrate auth routes | Missing dependency | Repaired (2.4r) |

### Deviations
| Task | Severity | Description |
|---|---|---|
| 1.3 | MODERATE | Used interface instead of type alias |
| 2.2 | CRITICAL | Changed function signature for compatibility |

### Files Changed (aggregate)
- src/middleware/rateLimiter.ts (created)
- src/middleware/index.ts (modified)
- src/types/rateLimit.ts (created)
- ...

### Follow-Up Items
- {Items that need manual attention}
- {Integration concerns from deviations}
```

### What the Master Assesses

During compilation, the master evaluates:

1. **Complete success** -- All tasks completed, no deviations requiring attention
2. **Partial success** -- Some tasks completed with deviations or partial work
3. **Failures recovered** -- Tasks failed but were repaired successfully
4. **Unrecoverable failures** -- Tasks that failed and could not be repaired
5. **Downstream impact** -- Whether CRITICAL deviations affected other tasks

---

## Step 2: Verification

After all tasks complete, the master assesses whether a verification step is warranted.

### When Verification Is Needed

| Condition | Verification | Reason |
|---|---|---|
| Swarm modified code across multiple files | **Recommended** | Integration issues between workers |
| Any tasks reported CRITICAL deviations | **Strongly recommended** | Deviations may break assumptions |
| Swarm was purely additive (new files only) | Optional | Lower risk of integration issues |
| Single-file modifications, no dependencies | Optional | Workers validated independently |

### Verification Agent

If verification is warranted, the master dispatches a verification agent with:

- A list of ALL files changed across the swarm (aggregated from all worker returns)
- The project's standard validation commands (from CLAUDE.md or project conventions)
- Instructions to run tests, type checking, build validation, or linting

```
You are the verification agent for the "{task-slug}" swarm.

All implementation is complete. Your job is to verify that the combined
changes work together correctly.

FILES CHANGED ACROSS SWARM:
  - src/middleware/rateLimiter.ts (created by task 1.1)
  - src/types/rateLimit.ts (created by task 1.2)
  - src/routes/auth.ts (modified by task 2.1)
  - src/routes/users.ts (modified by task 2.2)

VERIFICATION STEPS:
1. Run the project's test suite
2. Run type checking (if applicable)
3. Run the build (if applicable)
4. Check for import/export consistency across changed files

Report any failures with specific file and line references.
```

### Verification Scope

The verification agent focuses on **integration issues** that individual workers cannot detect:

- Import/export mismatches between files modified by different workers
- Type inconsistencies across module boundaries
- Build failures from incompatible changes
- Test failures from cross-cutting changes

---

## Step 3: Update Project Metadata

### Master XML Finalization

The master reads the XML task file and updates the overall status:

```xml
<metadata>
  <overall_status>completed</overall_status>
  <!-- or "failed" if unrecoverable failures exist -->
</metadata>
```

Each task in the XML should already have its `<status>`, `<completed_at>`, and `<summary>` set from the monitoring phase updates.

### Completion Log Entry

The master writes a final entry to `logs.json`:

```json
{
  "timestamp": "2026-03-22T14:45:00Z",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Swarm complete: 7/8 tasks succeeded in 12m 34s -- 1 task repaired, 2 deviations",
  "task_name": "add-rate-limiting"
}
```

The dashboard displays a green "Complete" badge in the log panel header when it detects that all progress files show terminal status.

### TOC Update

If the swarm created, moved, or restructured files in the project, and a project TOC exists at `{project_root}/.synapse/toc.md`, the master updates it to reflect the new file structure.

This is done only when the TOC already exists. The master does not create a TOC as part of the completion phase.

---

## Step 4: Archiving

### History Summary

When a swarm completes, the master may save a history summary to `{tracker_root}/history/`:

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

### Dashboard Archiving

If the dashboard will be reused for a new swarm, the current swarm data must be archived first. This happens during the next swarm's planning phase, not during the current completion phase.

When archiving occurs:

```
1. Copy entire dashboard directory to:
   {tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/

2. Clear progress files:
   rm -f {tracker_root}/dashboards/{dashboardId}/progress/*.json

3. Reset initialization.json and logs.json for the new swarm
```

**Previous swarm data is never discarded.** The archive preserves:

- `initialization.json` -- The complete plan
- `logs.json` -- The full event timeline
- `progress/` -- All worker progress files with stage histories, milestones, and logs

### What Gets Archived

| File | Contents |
|---|---|
| `initialization.json` | Static plan: task metadata, agent entries, waves, chains |
| `logs.json` | Complete event log from initialization through completion |
| `progress/*.json` | Full lifecycle data for every worker: stages, milestones, deviations, logs |

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

---

## Step 5: Return to Normal Mode

Once the swarm is complete and the final report is delivered:

1. The master agent's orchestrator restrictions are lifted
2. The master may resume normal agent behavior (including direct code edits) if the user requests non-parallel work
3. The dashboard continues showing the completed swarm until cleared by the next swarm or `!reset`

### Conditions for Exiting Orchestrator Mode

The master exits orchestrator mode when ALL of the following are true:

- All workers have returned with terminal status (completed or failed)
- No repair tasks are pending or in progress
- The final report has been compiled and presented to the user
- No verification agent is currently running

---

## Partial Completion

Not every swarm finishes cleanly. The master must handle partial completion scenarios:

### Some Tasks Failed, Others Succeeded

The master reports both:

```markdown
## Swarm Partially Complete: {task-slug}

**Tasks:** 6/8 completed, 2/8 failed
**Successful work:** Auth middleware, rate limiting, config types (tasks 1.1-1.4, 2.1-2.2)
**Failed work:** Integration tests, e2e tests (tasks 3.1, 3.2 -- blocked by missing test fixtures)

### Recommended Follow-Up
- Create test fixtures manually, then run `!retry 3.1` and `!retry 3.2`
```

### Circuit Breaker Triggered

If the circuit breaker fired during execution, the completion report includes the replanning details. See [Circuit Breaker](./circuit-breaker.md) for the full replanning protocol.

### Worker Partial Completion

Individual workers may report partial completion (80%+ done but hit a blocker). The master includes these in the report:

```markdown
### Partially Completed Tasks
| Task | Title | Done | Remaining |
|---|---|---|---|
| 2.3 | Create user endpoints | 3/4 endpoints | /users/delete blocked by missing migration |
```

---

## Dashboard Final State

When all tasks reach terminal status, the dashboard shows:

- **Progress bar** at 100% (or less if tasks failed)
- **Stat cards**: Completed = N, Failed = M, In Progress = 0, Pending = 0
- **Elapsed timer**: Frozen at final duration
- **Agent cards**: All green (completed) or red (failed)
- **Log panel**: "Complete" badge next to entry count
- **Dependency lines**: All green for completed chains

The dashboard remains in this state until cleared by the next swarm or `!reset`.

---

## Related Documentation

- [Overview](./overview.md) -- End-to-end swarm lifecycle summary
- [Planning Phase](./planning-phase.md) -- Context gathering and task decomposition
- [Dispatch Phase](./dispatch-phase.md) -- Worker dispatch mechanics and eager dispatch protocol
- [Monitoring Phase](./monitoring-phase.md) -- Live progress tracking and deviation handling
- [Circuit Breaker](./circuit-breaker.md) -- Automatic replanning on cascading failures
