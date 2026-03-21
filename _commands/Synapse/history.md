# `!history [--last N]`

**Purpose:** Display all past swarm tasks from the `{tracker_root}/history/` directory. Each entry is a JSON summary file created when a dashboard is cleared.

**Syntax:**
- `!history` — Show all past tasks
- `!history --last 5` — Show only the last 5 tasks

> **Note:** History is global across all dashboards — no `{dashboardId}` parameter needed. History summaries are created automatically when a dashboard is cleared (via the Clear Dashboard button or `!reset`).

---

## Steps

1. **Read the `{tracker_root}/history/` directory.** List all `.json` files.

2. **If empty**, report: "No swarm history. History is saved when dashboards are cleared."

3. **Read each history JSON file.** Each contains a summary with these fields (produced by the server's `buildHistorySummary()` function):
   - `task_name`, `task_type`, `project`, `directory`, `prompt`
   - `overall_status`, `total_tasks`, `completed_tasks`, `failed_tasks`, `in_progress_tasks`, `pending_tasks`
   - `total_waves`, `started_at`, `completed_at`, `duration`
   - `cleared_at`, `dashboard_id`
   - `agents[]` — array of agent summaries
   - `log_count`

4. **Sort by `cleared_at` descending** (newest first).

5. **If `--last N` is specified**, show only the first N entries after sorting.

6. **Display the history table:**

```markdown
## Swarm History ({count} tasks)

| # | Name | Project | Tasks | Waves | Status | Duration | Cleared |
|---|---|---|---|---|---|---|---|
| 1 | {task_name} | {project} | {completed_tasks}/{total_tasks} ({failed_tasks} failed) | {total_waves} | {status emoji} | {duration} | {cleared_at formatted} |
| 2 | {task_name} | {project} | {completed_tasks}/{total_tasks} | {total_waves} | {status emoji} | {duration} | {cleared_at formatted} |
```

Status emojis:
- `completed` → ✅
- `completed_with_errors` → ⚠️
- `failed` → 🔴
- `in_progress` → 🔵 (shouldn't normally appear in history)

Duration: From the `duration` field in the summary, or calculated from `started_at` to `completed_at`. If unavailable, show "—".

Cleared: Formatted as `MMM DD, HH:MM` from the `cleared_at` field.

7. **Summary:** `"{total_completed} completed, {total_failed} failed across {total_history_entries} swarms"`
