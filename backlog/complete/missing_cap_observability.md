Add observability capabilities to Synapse: swarm performance metrics tracking, dashboard export command, dependency graph validation, and history analytics. The target project is Synapse itself at {tracker_root} = /Users/dean/Desktop/Working/Repos/Synapse (also {project_root} for this swarm, since we are working on Synapse's own codebase).

This swarm closes visibility gaps in Synapse's post-swarm analysis, data export, plan validation, and historical trend tracking. Each task has clear scope and verifiable success criteria.

---

TASK 1: Add swarm performance metrics computation and storage

After each swarm completes, the master agent should automatically compute and store performance metrics. Currently, swarm performance data is scattered across progress files and logs with no aggregated view — the user has to manually piece together durations, failure rates, and parallelism efficiency.

Changes required:

(A) In `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md`, add a new subsection to Step 17 ("Overall completion", starting at line 809) between subsection B ("Append final log entry") and subsection C ("Post-swarm verification"). Title it "#### B2. Compute and store swarm metrics". Content:

```markdown
#### B2. Compute and store swarm metrics

Read all progress files from `{tracker_root}/dashboards/{dashboardId}/progress/`. Compute the following metrics and write them to `{tracker_root}/dashboards/{dashboardId}/metrics.json`:

```json
{
  "task_name": "{task-slug}",
  "computed_at": "{ISO 8601}",
  "total_elapsed_seconds": <latest completed_at minus earliest started_at, in seconds>,
  "task_count": {
    "total": <total tasks>,
    "completed": <completed count>,
    "failed": <failed count>
  },
  "duration_distribution": {
    "min_seconds": <shortest task duration>,
    "max_seconds": <longest task duration>,
    "median_seconds": <median task duration>,
    "p90_seconds": <90th percentile task duration>
  },
  "dispatch_latency": {
    "description": "Seconds between all dependencies satisfied and worker started_at",
    "values": [
      { "task_id": "{id}", "latency_seconds": <computed latency> }
    ],
    "median_seconds": <median dispatch latency>,
    "max_seconds": <max dispatch latency>
  },
  "parallel_efficiency": {
    "sum_of_task_durations_seconds": <sum of all individual task durations>,
    "total_elapsed_seconds": <wall clock time>,
    "ratio": <sum / elapsed — values > 1.0 indicate parallelism benefit>
  },
  "failure_rate": <failed / total>,
  "deviation_summary": {
    "total_deviations": <sum of all deviations across all tasks>,
    "tasks_with_deviations": <count of tasks with non-empty deviations[]>,
    "by_severity": {
      "CRITICAL": <count>,
      "MODERATE": <count>,
      "MINOR": <count>
    }
  },
  "max_concurrent_workers": <maximum number of simultaneously in-progress tasks at any point>
}
```

**Computing dispatch latency:** For each task with dependencies, the "deps satisfied" time is the latest `completed_at` among all tasks in its `depends_on` array. The dispatch latency is `started_at - deps_satisfied_at`. For Wave 1 tasks (no dependencies), dispatch latency is `started_at - swarm_start_time` (the earliest `started_at` across all tasks).

**Computing max concurrent workers:** Build a timeline of all task start/end events. Walk the timeline chronologically, incrementing on each `started_at` and decrementing on each `completed_at`. The peak value is the max concurrent workers.

**Computing duration distribution:** Collect `completed_at - started_at` for all completed tasks. Sort and compute min, max, median, and p90.
```

(B) Add `metrics.json` to the "Files the Master Agent Writes" table in `/Users/dean/Desktop/Working/Repos/Synapse/CLAUDE.md`. Currently the table (in the "The Only Files the Master Agent Writes" section) lists 4 files. Add a 5th row:

| `dashboards/{dashboardId}/metrics.json` | Computed swarm performance metrics (written ONCE during final report) |

(C) In `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/tracker_master_instructions.md`, add `metrics.json` to the directory structure listing (around line 204-228) under the dashboard directory. Also add a brief note in the "Write Timing" section (around line 509) that metrics.json is written once during the final report step.

(D) Add a "Metrics" panel to the dashboard UI. In `/Users/dean/Desktop/Working/Repos/Synapse/src/ui/App.jsx`, add a metrics display that reads from the `/api/dashboards/:id/metrics` endpoint (to be added to the server). The panel should show:
- Total elapsed time
- Parallel efficiency ratio (with color: green if > 2.0, yellow if 1.0-2.0, red if < 1.0)
- Task duration distribution (min / median / max / p90)
- Failure rate
- Max concurrent workers
- Deviation count

The panel should be collapsible (like the log panel) and only visible when metrics.json exists for the current dashboard.

(E) Add the API endpoint `GET /api/dashboards/:id/metrics` in `/Users/dean/Desktop/Working/Repos/Synapse/src/server/routes/apiRoutes.js`. It should read `{tracker_root}/dashboards/{dashboardId}/metrics.json` and return it as JSON. If the file doesn't exist, return `{ "metrics": null }`.

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md` — Add metrics computation to Step 17
- `/Users/dean/Desktop/Working/Repos/Synapse/CLAUDE.md` — Add metrics.json to master agent files table
- `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/tracker_master_instructions.md` — Add metrics.json references
- `/Users/dean/Desktop/Working/Repos/Synapse/src/server/routes/apiRoutes.js` — Add GET /api/dashboards/:id/metrics endpoint
- `/Users/dean/Desktop/Working/Repos/Synapse/src/ui/App.jsx` — Add metrics panel (or create a new MetricsPanel component)
- `/Users/dean/Desktop/Working/Repos/Synapse/src/ui/components/` — May need a new `MetricsPanel.jsx` component
- `/Users/dean/Desktop/Working/Repos/Synapse/public/styles.css` — Add styles for metrics panel

Success criteria: Step 17 in p_track.md includes metrics computation with the full schema. The API endpoint returns metrics data. The dashboard displays a metrics panel when data exists. CLAUDE.md and tracker_master_instructions.md reference metrics.json.

---

TASK 2: Create the `!export` command and add dashboard export button

Currently, there is a `GET /api/dashboards/:id/export` endpoint in `apiRoutes.js` (lines 342-367) that returns JSON, but there is no CLI command to export a dashboard and no UI button to trigger a download. This task adds both.

Changes required:

(A) Create `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/export.md` with the following structure. Follow the same format as existing commands like `status.md` and `history.md`:

```markdown
# `!export [dashboardId] [--format markdown|json]`

**Purpose:** Export the current dashboard's full swarm state as a structured document for post-mortems, documentation, or sharing.

**Syntax:**
- `!export` — Export the active dashboard as markdown (auto-detect dashboard)
- `!export dashboard3` — Export a specific dashboard
- `!export --format json` — Export as raw JSON
- `!export --format markdown` — Export as formatted markdown (default)

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md`

---

## Steps

### Step 1: Resolve dashboard

Parse the optional `{dashboardId}` argument and `--format` flag. Default format is `markdown`.

### Step 2: Read all swarm data

Read in parallel:
- `{tracker_root}/dashboards/{dashboardId}/initialization.json`
- `{tracker_root}/dashboards/{dashboardId}/logs.json`
- All files in `{tracker_root}/dashboards/{dashboardId}/progress/`
- `{tracker_root}/dashboards/{dashboardId}/metrics.json` (if exists)

If no active task exists (task is null), report: "No swarm data to export."

### Step 3: Generate export

**JSON format:** Output the raw combined data structure (same as the existing GET /api/dashboards/:id/export endpoint).

**Markdown format:** Generate a structured document:

## Swarm Report: {task.name}

**Project:** {task.project}
**Created:** {task.created}
**Total Tasks:** {task.total_tasks} across {task.total_waves} waves
**Status:** {derived from progress — completed/failed/in_progress}

### Task Summary

| # | Task | Wave | Status | Duration | Summary |
|---|---|---|---|---|---|
| {id} | {title} | {wave} | {status emoji} | {duration} | {summary} |

### Deviations

{For each task with non-empty deviations[], list:}
- **{id} {title}:** {deviation description} (severity: {severity})

{If no deviations: "No deviations reported."}

### Event Timeline

{Chronological list of log entries:}
- {HH:MM:SS} [{level}] {agent}: {message}

### Performance Metrics

{If metrics.json exists, include key metrics:}
- Elapsed: {total_elapsed}
- Parallel Efficiency: {ratio}x
- Task Duration: {min}s / {median}s / {max}s (min/median/max)
- Failure Rate: {rate}%

{If no metrics: "Performance metrics not available."}

### Step 4: Output

Display the formatted export in the terminal. For JSON format, output the raw JSON.
```

(B) Add an "Export" button to the dashboard header in `/Users/dean/Desktop/Working/Repos/Synapse/src/ui/components/Header.jsx`. The button should:
- Only be visible when a task is active (task is not null)
- On click, call `GET /api/dashboards/{dashboardId}/export`
- Trigger a browser file download of the JSON response as `{task.name}_export.json`
- Use a download/export icon. Style consistently with existing header elements.

(C) Add styles for the export button to `/Users/dean/Desktop/Working/Repos/Synapse/public/styles.css`. Match the existing dark theme aesthetic — the button should be subtle (dim border, light text) and highlight on hover.

Files to create:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/export.md` (new command file)

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/src/ui/components/Header.jsx` — Add export button
- `/Users/dean/Desktop/Working/Repos/Synapse/public/styles.css` — Add export button styles

Do NOT modify `apiRoutes.js` for this task — the export endpoint already exists at `GET /api/dashboards/:id/export` (lines 342-367). The UI button should call that existing endpoint.

Success criteria: The `!export` command file exists and follows standard command structure. The dashboard header shows an Export button when a task is active. Clicking the button downloads a JSON file via the existing API endpoint. The button is styled consistently with the dashboard theme.

---

TASK 3: Add dependency graph validation to `!deps` and `!p_track`

Currently, dependency graphs are not validated — circular dependencies, broken references, and wave-dependency inconsistencies are only caught at runtime (when a worker blocks forever or gets dispatched against nonexistent output). This task adds programmatic validation.

Changes required:

(A) In `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/deps.md`, add a new section at the end of the file (after the `!deps [dashboardId] {task_id}` section) for `!deps validate`:

```markdown
---

## `!deps validate [dashboardId]`

### Steps

1. **Parse the optional `{dashboardId}` argument.** Run `detectDashboard()` per `dashboard_resolution.md` if not specified.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** Extract `agents[]` and `waves[]`.

3. **Build the full dependency graph** from `agents[].depends_on` arrays.

4. **Run validation checks:**

#### Check 1: Circular dependency detection
Run a topological sort (Kahn's algorithm or DFS-based cycle detection) on the dependency graph. If a cycle is found, report: "FAIL: Circular dependency detected: {task_id} -> {task_id} -> ... -> {task_id}"

#### Check 2: Broken references
For every task ID listed in any `depends_on` array, verify it exists as an `id` in `agents[]`. Report any missing references: "FAIL: Task {id} depends on {missing_id} which does not exist"

#### Check 3: Wave consistency
For each task, verify that every task in its `depends_on` array has a wave number strictly less than the task's own wave number. A task in Wave 3 should not depend on a task also in Wave 3 or higher. Report violations: "WARN: Task {id} (Wave {N}) depends on task {dep_id} (Wave {M}) — expected dep wave < task wave"

Note: This is a WARN, not FAIL, because dependency-driven dispatch handles same-wave dependencies correctly — but it indicates the wave assignments don't match the dependency structure, which may confuse users viewing the dashboard.

#### Check 4: Island detection
Find any tasks that have no dependencies AND no other tasks depend on them AND they are not in Wave 1. These are "islands" — disconnected from the graph. Wave 1 tasks with no dependents are expected (leaf tasks). Report: "WARN: Task {id} (Wave {N}) is disconnected — no dependencies and nothing depends on it"

#### Check 5: Completeness
Verify that every `agents[].id` appears in a valid wave (its `wave` value has a corresponding `waves[].id`). Verify `waves[].total` matches the actual count of agents in each wave.

5. **Output validation report:**

```
## Dependency Validation: {task.name} [{dashboardId}]

| Check | Result | Details |
|---|---|---|
| Circular dependencies | PASS/FAIL | {details if failed} |
| Broken references | PASS/FAIL | {details if failed} |
| Wave consistency | PASS/WARN | {details if warned} |
| Island tasks | PASS/WARN | {details if warned} |
| Completeness | PASS/FAIL | {details if failed} |

**Overall: {PASS | WARN | FAIL}**
```

PASS = all checks pass. WARN = no failures but warnings exist. FAIL = at least one check failed.
```

(B) In `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md`, add a validation step after the master writes initialization.json (Step 11 "Select a dashboard and populate the plan", ending around line 491) and before Step 12 ("Begin execution", line 492). Insert as a new subsection within Step 11, after the initialization.json write:

```markdown
#### Validate the dependency graph

After writing `initialization.json`, run these validation checks on the plan before presenting it to the user:

1. **No circular dependencies** — topological sort must succeed. If a cycle is found, fix the dependency graph before proceeding.
2. **All depends_on references resolve** — every ID in any depends_on array must exist in agents[]. If a reference is broken, fix it.
3. **Wave assignments are consistent** — every dependency should be in a strictly lower wave. If inconsistent, either fix the wave assignment or add a note explaining the exception.
4. **waves[].total matches actual agent counts** — recount and fix if needed.

If any FAIL-level validation errors are found, fix them before presenting the plan. WARN-level issues should be noted in the plan presentation for the user to review.
```

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/deps.md` — Add `!deps validate` section with 5 checks
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md` — Add dependency validation step in Step 11

Do NOT modify server code or UI for this task. Validation is performed by the master agent reading initialization.json — it is a protocol step, not a server feature.

Success criteria: The deps.md file contains a `!deps validate` section with 5 named validation checks (cycles, broken refs, wave consistency, islands, completeness). The p_track.md Step 11 includes a validation substep that runs after writing initialization.json. Both describe the same validation logic consistently.

---

TASK 4: Add history analytics computation and storage

The `!history` command currently lists past swarms but provides no aggregate analysis. This task adds cross-swarm analytics that reveal trends in swarm performance, common failure patterns, and frequently modified files.

Changes required:

(A) In `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/history.md`, add a `!history --analytics` subcommand. After the existing Step 7 ("Summary"), add:

```markdown
---

## `!history --analytics`

Compute and display aggregate statistics across all past swarms.

### Steps

8. **Read all history JSON files** from `{tracker_root}/history/`. Parse each summary.

9. **Compute aggregate metrics:**

| Metric | Computation |
|---|---|
| Total swarms | Count of history files |
| Average tasks per swarm | Mean of `total_tasks` across all swarms |
| Average duration | Mean of `duration` across swarms with valid duration data |
| Overall failure rate | Sum of `failed_tasks` / Sum of `total_tasks` across all swarms |
| Failure rate trend | Compare failure rate of last 3 swarms vs overall — improving, stable, or degrading |
| Most common status | Mode of `overall_status` across all swarms |
| Largest swarm | Swarm with highest `total_tasks` |
| Longest swarm | Swarm with highest `duration` |

10. **Analyze failure patterns** (if any swarms had failures):
- Group failed agents by their title keywords (e.g., "auth", "test", "migration")
- Report the top 3 most common failure keywords

11. **Store analytics** in `{tracker_root}/history/analytics.json`:

```json
{
  "computed_at": "{ISO 8601}",
  "total_swarms": <count>,
  "avg_tasks_per_swarm": <float>,
  "avg_duration_seconds": <float>,
  "overall_failure_rate": <float>,
  "failure_rate_trend": "improving" | "stable" | "degrading",
  "most_common_status": "<status>",
  "largest_swarm": { "name": "<name>", "total_tasks": <count> },
  "longest_swarm": { "name": "<name>", "duration_seconds": <seconds> },
  "failure_patterns": [
    { "keyword": "<keyword>", "count": <count> }
  ]
}
```

12. **Display analytics report:**

```
## Swarm Analytics ({total_swarms} swarms)

| Metric | Value |
|---|---|
| Total swarms | {count} |
| Average tasks/swarm | {avg} |
| Average duration | {formatted duration} |
| Overall failure rate | {rate}% |
| Failure trend | {trend} ({explanation}) |
| Largest swarm | {name} ({N} tasks) |
| Longest swarm | {name} ({duration}) |

### Failure Patterns
{If failures exist:}
| Keyword | Occurrences |
|---|---|
| {keyword} | {count} |

{If no failures: "No failures recorded across {N} swarms."}
```
```

(B) Add a history analytics display to the dashboard. In `/Users/dean/Desktop/Working/Repos/Synapse/src/ui/components/modals/HistoryModal.jsx`, add an "Analytics" tab or section that shows the aggregate stats from the `analytics.json` file. It should display: total swarms, average tasks per swarm, average duration, overall failure rate, and failure trend. If analytics.json doesn't exist, show "Run `!history --analytics` to compute analytics."

(C) Add an API endpoint `GET /api/history/analytics` in `/Users/dean/Desktop/Working/Repos/Synapse/src/server/routes/apiRoutes.js`. It should read `{tracker_root}/history/analytics.json` and return it. If the file doesn't exist, return `{ "analytics": null }`.

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/history.md` — Add `!history --analytics` subcommand with steps 8-12
- `/Users/dean/Desktop/Working/Repos/Synapse/src/ui/components/modals/HistoryModal.jsx` — Add analytics display section
- `/Users/dean/Desktop/Working/Repos/Synapse/src/server/routes/apiRoutes.js` — Add GET /api/history/analytics endpoint

Do NOT modify history JSON files or the server's `buildHistorySummary()` function. Analytics is computed from existing history data by the master agent when `!history --analytics` is invoked — it does not change the history recording flow.

Success criteria: The history.md file contains a `!history --analytics` section with 5 steps (read history, compute metrics, analyze failures, store analytics, display report). The analytics.json schema includes all listed metrics. The API endpoint returns analytics data. The HistoryModal shows an analytics section when data exists.
