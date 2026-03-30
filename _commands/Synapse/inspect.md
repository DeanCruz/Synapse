# `!inspect [dashboardId] {task_id}`

**Purpose:** Show detailed information about a specific task — its full context, dependencies, status timeline, milestones, deviations, and worker logs.

**Syntax:**
- `!inspect 2.3` — Inspect a task (uses your assigned dashboard)
- `!inspect dashboard1 2.3` — Inspect a task on a specific dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument is a valid dashboard ID (see `dashboard_resolution.md`), use it as `{dashboardId}`. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** Find the agent entry matching `{task_id}`. If not found, report an error with the list of valid task IDs.

3. **Read `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`** for the full lifecycle data. If no progress file exists, the task is `"pending"` with no lifecycle data.

4. **Read the master task file** at `{tracker_root}/tasks/{date}/parallel_{task_name}.json`. Find the task entry for `{task_id}`.

5. **Read `{tracker_root}/dashboards/{dashboardId}/logs.json`** and filter for entries where `task_id` matches.

6. **Read all other progress files** to resolve dependency statuses and downstream blocks.

7. **Display detailed report:**

```markdown
## Task {id}: {title} [{dashboardId}]

**Status:** {status emoji} {status}
**Wave:** {wave} — {wave name}
**Layer:** {layer}
**Directory:** {directory}

### Timeline
| Event | Timestamp |
|---|---|
| Created | {task.created from initialization.json} |
| Dispatched | {started_at from progress file, or "Not dispatched"} |
| Completed | {completed_at from progress file, or "Not completed"} |
| Duration | {calculated, or "—"} |

### Agent
**Assigned:** {assigned_agent from progress file, or "None"}
**Stage:** {stage from progress file, or "—"}
**Message:** {message from progress file, or "—"}
**Summary:** {summary from progress file, or "No summary yet"}

### Milestones
{From progress file milestones[] array, if present:}
| Time | Label |
|---|---|
| {timestamp} | {label} |

### Deviations
{From progress file deviations[] array, if present:}
- ⚠️ {description}
{If none: "No deviations reported."}

### Dependencies (needs)
{For each task in depends_on from initialization.json:}
- **{dep_id}** — {dep_title} — {dep_status emoji} {dep_status from progress file}

### Blocks (downstream)
{For each agent in initialization.json that lists this task in its depends_on:}
- **{downstream_id}** — {downstream_title} — {downstream_status emoji} {downstream_status}

### Context (from task file)
{Full context content from the task file}

### Critical Details
{Full critical content from the task file, or "None"}

### Files
{List each file with its action from the task file}
- {action}: {path}

### Worker Logs
{From progress file logs[] array, if present:}
| Time | Message |
|---|---|
| {timestamp} | {message} |

### Dashboard Logs
{Filtered entries from logs.json where task_id matches:}
| Time | Level | Message |
|---|---|---|
| {timestamp} | {level} | {message} |
```

This gives the user a complete picture of a single task's role in the swarm, enhanced with worker-reported milestones, deviations, and logs from the progress file.
