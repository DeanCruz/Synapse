# p_track Phase 3: Completion — Verification, Reporting & Metrics

> **Module:** This file contains the Completion phase (Step 17) of the `!p_track` command.
> **Source:** Extracted from `{tracker_root}/_commands/Synapse/p_track.md`
> **Related modules:** `p_track_planning.md` (Phase 1), `p_track_execution.md` (Phase 2)

---

## Step 17: Overall completion

When all tasks reach `"completed"` or `"failed"`:

### 17A. Update the master task file

Set `overall_status` to `"completed"` (or `"failed"` if any tasks failed without recovery).

### 17B. Append final log entry

Run `date -u +"%Y-%m-%dT%H:%M:%SZ"` to capture the completion timestamp.

Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{captured timestamp}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Swarm complete: {completed}/{total} tasks succeeded, {failed} failed",
  "task_name": "{task-slug}"
}
```
Write back.

> **Note:** The master does NOT update `initialization.json` on completion. The dashboard derives `overall_status` and `completed_at` from the aggregate of worker progress files. The elapsed timer freezes when all workers have `completed_at` set in their progress files.

### 17C. Post-swarm verification (when warranted)

Before delivering the final report, assess whether a verification step is needed:

| Condition | Verification |
|---|---|
| Modified existing code across multiple files | Dispatch a verification agent — run tests, type check, build |
| Purely additive (new files only, no modifications) | Verification optional |
| Any tasks reported deviations | Verification strongly recommended |
| All tasks succeeded with no warnings | May skip verification |

If verification is needed, dispatch a single verification agent:
```
You are verifying the combined output of a {N}-task parallel swarm: "{task-slug}"

## Files Changed
{Complete list from the master's result cache — all files created/modified/deleted across all tasks}

## What To Verify
1. Run the project's test suite (if one exists)
2. Run type checking (if applicable)
3. Run the build (if applicable)
4. Check for integration issues: missing imports, conflicting exports, broken references between files changed by different workers

## Report
Return:
- TESTS: pass | fail | no test suite
- TYPES: pass | fail | N/A
- BUILD: pass | fail | N/A
- ISSUES: {list of any integration problems found, or "None"}
```

#### Cross-Repo Verification

When the swarm spans multiple repositories, add these checks to the verification agent's prompt:

1. **Type/interface consistency** — For every shared type or API contract modified by the swarm, verify that all consuming repos use the updated signature. Grep for the type name across all affected repos.
2. **Import path validity** — Verify that cross-repo imports (if any) resolve correctly after file moves or renames.
3. **Contract alignment** — If the swarm modified both a backend API and its frontend consumer, verify request/response shapes match.

If cross-repo inconsistencies are found, log them at level `"warn"` and include them in the final report's Warnings section.

Log the verification result to `dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "{info if passed, warn if issues found}",
  "message": "Verification: {result summary}",
  "task_name": "{task-slug}"
}
```

### 17D. Compute Swarm Metrics

After all tasks complete (and after verification, if run), compute swarm performance metrics and write them to `{tracker_root}/dashboards/{dashboardId}/metrics.json`. These metrics enable historical performance comparison and parallelization efficiency tracking.

**Computation procedure:**

1. Read all progress files in `{tracker_root}/dashboards/{dashboardId}/progress/`.
2. For each completed task, compute its duration: `completed_at - started_at` (in seconds).
3. Compute the following metrics:

| Metric | How to compute |
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

4. Write the metrics file:

```json
{
  "swarm_name": "{task-slug}",
  "computed_at": "{ISO 8601 timestamp}",
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

5. Log the metrics summary to `dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Metrics: {elapsed_seconds}s elapsed, {parallel_efficiency}x efficiency, {max_concurrent} max concurrent, {failure_rate} failure rate",
  "task_name": "{task-slug}"
}
```

> **Note:** `metrics.json` is written once after swarm completion. It is not watched by the server for live updates — it is a post-hoc analysis artifact. The dashboard may optionally read it for a metrics summary panel in future versions.

### 17E. Read logs and deliver final report

**Read `{tracker_root}/dashboards/{dashboardId}/logs.json` in full.** Analyze all entries for the current task. Then deliver:

```markdown
## Swarm Complete: {task-slug}

**{completed}/{total} tasks** · **{W} waves** · **{0 or N} failures** · **Type: {Waves|Chains}**

### What Was Done
{2-4 sentences. What was the goal? What was accomplished? Any significant decisions made?}

### Files Changed
| File | Action | Task |
|---|---|---|
| {path} | created / modified / deleted | {task id} |

### Important Logs & Observations
{Summary of the most significant log entries — not every log, just the ones that matter.
Focus on: unexpected findings, key decisions, performance notes.}

### Divergent Actions
(Only if any agents deviated from the plan — omit entirely if all agents followed the plan exactly)
- **{task id} — {title}:** {what was different and why}

### Warnings
(Only if agents reported unexpected findings — omit entirely if none)
- **{task id}:** {warning description}

### Failures
(Only if tasks failed — omit entirely if all succeeded)
- **{task id} — {title}:** {what failed and why}
- **Blocked by failure:** {any tasks that could not run as a result}

### Verification
(Only if a verification step was run — omit entirely if skipped)
- **Tests:** {pass | fail | no test suite}
- **Types:** {pass | fail | N/A}
- **Build:** {pass | fail | N/A}
- **Issues:** {list of integration problems, or "None"}

### Recommendations & Next Steps
(Only if applicable — omit entirely if the task is fully complete with no follow-up needed)
- {Recommendation or next step based on what was learned during execution}

### Artifacts
- **Task file:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
- **Plan:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`
- **Dashboard:** `{tracker_root}/dashboards/{dashboardId}/initialization.json`
- **Logs:** `{tracker_root}/dashboards/{dashboardId}/logs.json`
```

### 17F. Save to history

After delivering the final report, save a history summary to `{tracker_root}/history/` for future reference. The history file enables `!history` lookups without reading full dashboard data.

---

## Post-Swarm Behavior

Once all workers have finished and the master has compiled its final report, the swarm is over. At this point — and **only** at this point — the master agent may resume normal agent behavior (including direct code edits) if the user requests non-parallel work. The no-code restriction applies **exclusively during active swarm orchestration.**
