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

### 17E. Compile and deliver final report — NON-NEGOTIABLE

> **The master MUST compile and deliver a comprehensive final report after every swarm. No exceptions. This is not optional. Do not skip it. Do not abbreviate it. The report is the user's primary artifact for understanding what happened, what changed, and what to do next.**

**Data gathering — read ALL of these before writing the report:**

1. **Read `{tracker_root}/dashboards/{dashboardId}/logs.json` in full** — analyze all entries for the current task.
2. **Read every progress file** in `{tracker_root}/dashboards/{dashboardId}/progress/` — extract summaries, deviations, milestones, warnings, and logs from each worker.
3. **Read the master task file** at `{tracker_root}/tasks/{date}/parallel_{task_name}.json` — cross-reference planned vs. actual outcomes.
4. **Read `{tracker_root}/dashboards/{dashboardId}/metrics.json`** (written in Step 17D) — include performance data.

**Synthesize all gathered data into a report with the following structure. Every section marked REQUIRED must appear. Sections marked CONDITIONAL appear only when their trigger condition is met.**

```markdown
## Swarm Complete: {task-slug}

**{completed}/{total} tasks** · **{W} waves** · **{0 or N} failures** · **{elapsed_seconds}s elapsed** · **{parallel_efficiency}x parallel efficiency** · **Type: {Waves|Chains}**

---

### Summary of Work Completed (REQUIRED)

{Thorough summary of what was accomplished. This is NOT a 2-sentence blurb — it should give the
user a complete understanding of the work without needing to read individual task outputs. Cover:
- What was the original goal?
- What was actually built/changed/fixed?
- How does the implementation work at a high level?
- Any significant architectural or design decisions made during execution?
- What is the current state of the feature/fix — is it fully functional, partially complete, or needs follow-up?

Aim for a well-structured summary that tells the full story. Use sub-bullets for clarity if the
swarm touched multiple areas. The user should walk away from this section understanding exactly
what happened.}

### Files Changed (REQUIRED)

| File | Action | Task | What Changed |
|---|---|---|---|
| {path} | created / modified / deleted | {task id} | {1-line description of the change} |

{Group files logically if the swarm was large — by feature area, directory, or layer.}

### Deviations & Their Impact (CONDITIONAL — include if ANY worker reported deviations)

> Any time a worker deviated from the original plan, it must be reported here with an analysis
> of how it affects the project. This is not just a list — explain the WHY and the IMPACT.

For each deviation:
- **Task {id} — {title}**
  - **What changed:** {What the worker did differently from the plan}
  - **Why:** {The reason for the deviation — discovered constraint, better approach, missing dependency, etc.}
  - **Impact on project:** {How this deviation affects the codebase, other features, future work, or maintenance. Does it introduce technical debt? Does it change an API contract? Does it affect other parts of the system not touched by this swarm?}

If no deviations occurred, omit this section entirely.

### Warnings & Observations (CONDITIONAL — include if any workers reported warnings or unexpected findings)

- **{task id}:** {warning description and its significance}

If no warnings occurred, omit this section entirely.

### Failures (CONDITIONAL — include if any tasks failed)

- **{task id} — {title}:** {what failed and why}
- **Recovery:** {was a repair task dispatched? Did it succeed?}
- **Blocked by failure:** {any tasks that could not run as a result}
- **Residual impact:** {any incomplete work or broken state left behind}

If no failures occurred, omit this section entirely.

### Verification Results (CONDITIONAL — include if a verification step was run in 17C)

- **Tests:** {pass | fail | no test suite}
- **Types:** {pass | fail | N/A}
- **Build:** {pass | fail | N/A}
- **Issues:** {list of integration problems, or "None"}

If verification was skipped, omit this section entirely.

### Potential Improvements (REQUIRED)

{Based on everything the master observed during the swarm — worker logs, deviations, code patterns,
architectural decisions — identify improvements that could be made to the work that was just completed
or to the surrounding codebase. This is the master's expert analysis, not a generic checklist.

Consider:
- Code quality: Are there patterns that could be cleaner? DRY violations? Missing abstractions?
- Performance: Did any worker note potential performance concerns? Are there obvious optimizations?
- Robustness: Error handling gaps? Missing edge cases? Incomplete validation?
- Testing: Are the changes adequately tested? What test coverage is missing?
- Architecture: Does the new code fit well with the existing architecture? Any coupling concerns?

If the work is genuinely clean and complete with no improvements needed, explicitly state that
and briefly explain why (e.g., "The implementation follows existing patterns consistently and
all edge cases identified during planning were addressed.").}

### Future Steps (REQUIRED)

{Concrete, actionable next steps the user could take. These should emerge naturally from the
work that was done — not generic advice. Think about:
- Follow-up work that was out of scope but is now possible or necessary
- Integration steps (e.g., "Wire the new component into the main layout")
- Testing that should be done manually (e.g., "Test the auth flow end-to-end in the browser")
- Configuration or environment changes needed
- Related features or improvements that would complement this work
- Technical debt that should be addressed soon

If the task is truly self-contained with no follow-up, state: "No immediate follow-up required.
The implementation is self-contained and fully integrated."}

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

> **Quality bar:** The final report should be good enough that a developer who was not present during the swarm can read it and fully understand: (1) what was done, (2) what went sideways, (3) what state the project is in now, (4) what they should do next. If your report doesn't meet this bar, it's incomplete.

### 17F. Save to history

After delivering the final report, save a history summary to `{tracker_root}/history/` for future reference. The history file enables `!history` lookups without reading full dashboard data.

---

## Post-Swarm Behavior

Once all workers have finished and the master has compiled its final report, the swarm is over. At this point — and **only** at this point — the master agent may resume normal agent behavior (including direct code edits) if the user requests non-parallel work. The no-code restriction applies **exclusively during active swarm orchestration.**
