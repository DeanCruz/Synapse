# `!export [dashboardId] [--format markdown|json]`

**Purpose:** Export a dashboard's full swarm state as a formatted document for post-mortems, documentation, or sharing.

**Syntax:**
- `!export` — Export active dashboard as markdown (auto-detect)
- `!export dashboard3` — Export a specific dashboard
- `!export --format json` — Export as raw JSON
- `!export --format markdown` — Export as formatted markdown (default)

Flags can be combined with a dashboard ID: `!export dashboard2 --format json`

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

### Step 1: Resolve Dashboard and Parse Flags

1. **Parse the optional `{dashboardId}` argument.** If the first argument matches `dashboard[1-5]`, use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Parse the `--format` flag.** Accepted values: `markdown` (default), `json`. If an unrecognized format is provided, report: "Unknown format '{value}'. Supported formats: markdown, json."

### Step 2: Read All Swarm Data

Read the following files **in parallel** — they have no dependency on each other:

- `{tracker_root}/dashboards/{dashboardId}/initialization.json` — static plan data
- `{tracker_root}/dashboards/{dashboardId}/logs.json` — event log entries
- All files in `{tracker_root}/dashboards/{dashboardId}/progress/` — worker lifecycle data
- `{tracker_root}/dashboards/{dashboardId}/metrics.json` — performance metrics (optional, may not exist)

If `initialization.json` has `task` set to `null`, report: "No swarm data to export on {dashboardId}."

### Step 3: Merge and Derive Stats

Build the combined swarm state by merging initialization data with progress files (same merge pattern as `!status`):

- For each agent in `initialization.json`, look up its progress file for `status`, `assigned_agent`, `started_at`, `completed_at`, `summary`, `stage`, `milestones`, `deviations`, `logs`.
- If no progress file exists for an agent, it is `"pending"`.
- Compute: `completed`, `failed`, `in_progress`, `pending` counts.
- Compute: `overall_status` using `deriveOverallStatus()`.
- Compute: `elapsed` from earliest `started_at` to latest `completed_at` (or to now if still running).
- Collect all deviations across all agents.
- Parse all log entries from `logs.json`.

### Step 4: Generate Export

#### JSON Format (`--format json`)

Output the raw combined data as a single JSON object:

```json
{
  "task": {
    "name": "...",
    "type": "...",
    "project": "...",
    "project_root": "...",
    "directory": "...",
    "prompt": "...",
    "created": "...",
    "total_tasks": 12,
    "total_waves": 4
  },
  "derived": {
    "overall_status": "completed",
    "completed": 10,
    "failed": 1,
    "in_progress": 0,
    "pending": 1,
    "elapsed": "5m 32s"
  },
  "agents": [
    {
      "id": "1.1",
      "title": "...",
      "wave": 1,
      "depends_on": [],
      "status": "completed",
      "assigned_agent": "Agent 1",
      "started_at": "...",
      "completed_at": "...",
      "summary": "...",
      "stage": "completed",
      "milestones": [],
      "deviations": [],
      "logs": []
    }
  ],
  "waves": [
    { "id": 1, "name": "...", "total": 4, "completed": 4, "failed": 0 }
  ],
  "log_entries": [],
  "metrics": null
}
```

Display the JSON output in a fenced code block.

#### Markdown Format (`--format markdown`, default)

Generate a structured markdown document:

```markdown
# Swarm Export: {task.name}

**Project:** {task.project}
**Project Root:** {task.project_root}
**Created:** {task.created}
**Status:** {overall_status}
**Tasks:** {total_tasks} ({completed} completed, {failed} failed, {in_progress} in progress, {pending} pending)
**Waves:** {total_waves}
**Elapsed:** {elapsed}
**Prompt:** {task.prompt}

---

## Task Summary

| ID | Title | Wave | Status | Agent | Duration | Summary |
|---|---|---|---|---|---|---|
| {id} | {title} | {wave} | {status_emoji} {status} | {assigned_agent or —} | {duration or —} | {summary or —} |

Status emojis: completed = done, in_progress = running, failed = error, pending = waiting

---

## Deviations

{If any deviations exist across all agents:}

| Task | Severity | Time | Description |
|---|---|---|---|
| {task_id} | {severity} | {timestamp} | {description} |

{If no deviations: "No deviations reported across any tasks."}

---

## Event Timeline

| Time | Task | Agent | Level | Message |
|---|---|---|---|---|
| {timestamp} | {task_id} | {agent} | {level} | {message} |

{Chronological, from logs.json entries.}

---

## Performance Metrics

{If metrics.json exists:}

| Metric | Value |
|---|---|
| Total Elapsed | {elapsed} |
| Parallel Efficiency | {parallel_efficiency}% |
| Avg Task Duration | {avg_duration} |
| Min Task Duration | {min_duration} |
| Max Task Duration | {max_duration} |
| Failure Rate | {failure_rate}% |

{If metrics.json does not exist: "No performance metrics available. Metrics are generated after swarm completion."}
```

### Step 5: Output

Display the formatted export directly in the terminal.

For markdown format, output the full document as-is — it renders well in terminal markdown viewers and can be copy-pasted into documentation.

For JSON format, wrap the output in a fenced code block with `json` language hint.

**Summary line:** `"Exported {dashboardId} swarm '{task.name}' — {total_tasks} tasks, {format} format."`
