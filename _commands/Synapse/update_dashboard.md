# `!update_dashboard [dashboardId]`

**Purpose:** Generate a visual progress report of the current swarm — showing all completed tasks, their summaries, milestones, and deviations. Highlights the most recently completed task.

**Syntax:**
- `!update_dashboard` — Update your assigned dashboard
- `!update_dashboard dashboard1` — Show report for a specific dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument matches `dashboard[1-5]`, use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** If `task` is `null`, report: "No active swarm on {dashboardId}. Nothing to display."

3. **Read all progress files** from `{tracker_root}/dashboards/{dashboardId}/progress/`. Build a status map of `{ taskId: progressData }`. For any agent in `initialization.json` with no progress file, treat as `status: "pending"`.

4. **Identify the most recently completed task** by finding the progress file with the latest `completed_at` timestamp among all tasks with `status: "completed"`. If none are completed yet, note "No tasks completed yet."

5. **Compute swarm stats:**
   - `completed` — count of tasks with `status: "completed"`
   - `in_progress` — count with `status: "in_progress"`
   - `failed` — count with `status: "failed"`
   - `pending` — agents in initialization with no progress file or `status: "pending"`
   - `total` — total agent count from `initialization.json`
   - `pct` — `Math.round((completed / total) * 100)`
   - `overall_status` — use `deriveOverallStatus()` per dashboard_resolution.md
   - `elapsed` — from earliest `started_at` to now (or latest `completed_at` if all done); format as `Xm Ys`
   - `wave_summary` — for each wave, count completed/total agents in that wave

6. **Display the report using this template:**

---

```markdown
## Dashboard Update — {task.name} [{dashboardId}]
> {task.prompt truncated to 120 chars}…

**Status:** {overall_status_emoji} {overall_status}  ·  **Project:** {task.project}  ·  **Elapsed:** {elapsed}

### Progress
{progress_bar}  {completed}/{total} tasks ({pct}%)
{if failed > 0: "⚠️ {failed} failed"}
{if in_progress > 0: "🔵 {in_progress} running"}
{if pending > 0: "⚪ {pending} pending"}

### Waves
| Wave | Name | Progress | Status |
|------|------|----------|--------|
{for each wave: | {wave.id} | {wave.name} | {mini_bar} {completed}/{total} | {wave_status_emoji} |}

### Latest Completed
**{latest.task_id} — {latest.title}**  ·  Agent {latest.assigned_agent}  ·  Completed {latest.completed_at formatted as HH:MM UTC}
> {latest.summary}

{if latest.milestones present and non-empty:}
**Milestones:**
{for each milestone: `· {milestone.msg} ({milestone.at formatted as HH:MM})`}

{if latest.deviations present and non-empty:}
**Deviations:**
{for each deviation: `⚠️ [{deviation.severity}] {deviation.description}`}

### Completed Tasks
| # | Task | Agent | Duration | Summary |
|---|------|-------|----------|---------|
{for each completed task sorted by completed_at ascending:
| {task_id} | {title} | {assigned_agent} | {duration: completed_at - started_at, formatted Xm Ys} | {summary truncated to 80 chars} |}

{if any tasks have deviations:}
### Deviations Across Swarm
{for each completed task with deviations[].length > 0:}
- **{task_id}** ⚠️ [{severity}] {description}

{if pending > 0 or in_progress > 0:}
### Remaining
{for each task NOT completed or failed, grouped by wave:}
Wave {wave.id} — {wave.name}:
{for each task in wave that is pending or in_progress:
  - {status_emoji} **{task_id}** {title}{if depends_on non-empty: " (needs: {depends_on joined with ', '})"}
}
```

---

### Progress Bar Format

Build `progress_bar` as a text bar of width 20:
- `filled = Math.round((completed / total) * 20)`
- `bar = "█".repeat(filled) + "░".repeat(20 - filled)`
- Display as: `[{bar}]`

### Mini Bar Format (for wave table)

Width 10 bar using the same logic but scoped to the wave's tasks.

### Status Emojis

- `completed` → ✅
- `completed_with_errors` → ⚠️
- `in_progress` → 🔵
- `failed` → 🔴
- `pending` → ⚪

### Wave Status

A wave is:
- ✅ `done` — all tasks completed
- 🔴 `failed` — any task failed
- 🔵 `running` — any task in_progress
- ⚪ `pending` — all tasks pending

### Duration Format

`completed_at - started_at` in seconds. Display as:
- Under 60s: `{N}s`
- 60s to 3600s: `{M}m {S}s`
- Over 3600s: `{H}h {M}m`

If either timestamp is missing, show `—`.

---

> **Note:** This command is read-only. It does not modify any progress files or logs.
