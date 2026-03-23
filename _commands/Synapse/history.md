# `!history [--last N] [--analytics]`

**Purpose:** Display all past swarm tasks from the `{tracker_root}/history/` directory. Each entry is a JSON summary file created when a dashboard is cleared.

**Syntax:**
- `!history` — Show all past tasks
- `!history --last 5` — Show only the last 5 tasks
- `!history --analytics` — Compute and display aggregate analytics across all history

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

---

## `--analytics` Subcommand

When `!history --analytics` is specified, compute aggregate metrics across all history and display an analytics report.

8. **Read all history JSON files from `{tracker_root}/history/`.** Parse every `.json` file in the directory. If no history files exist, report: "No history data available for analytics."

9. **Compute aggregate metrics:**
   - `total_swarms` — number of history entries
   - `avg_tasks_per_swarm` — average `total_tasks` across all swarms (rounded to 1 decimal)
   - `avg_duration_seconds` — average duration in seconds (parse `duration` field or compute from `started_at`/`completed_at`), rounded to nearest integer
   - `overall_failure_rate` — `sum(failed_tasks) / sum(total_tasks)` as a percentage (rounded to 1 decimal)
   - `failure_rate_trend` — compare failure rate of the last 3 swarms (by `cleared_at`) vs the overall rate: `"improving"` if last-3 rate < overall rate, `"degrading"` if last-3 rate > overall rate, `"stable"` otherwise
   - `most_common_status` — the most frequent `overall_status` value across all history entries
   - `largest_swarm` — `{ "name": task_name, "total_tasks": N }` for the swarm with the most tasks
   - `longest_swarm` — `{ "name": task_name, "duration_seconds": N }` for the swarm with the longest duration

10. **Analyze failure patterns:** Collect all failed agents from all history entries (agents with `status: "failed"`). Group them by title keywords (first significant word in the title, lowercased). Report the top 3 most common failure keyword patterns as `failure_patterns: [{ "keyword": "...", "count": N }]`.

11. **Store analytics in `{tracker_root}/history/analytics.json`** with schema:
```json
{
  "computed_at": "ISO 8601",
  "total_swarms": N,
  "avg_tasks_per_swarm": N,
  "avg_duration_seconds": N,
  "overall_failure_rate": N,
  "failure_rate_trend": "improving|stable|degrading",
  "most_common_status": "status",
  "largest_swarm": { "name": "...", "total_tasks": N },
  "longest_swarm": { "name": "...", "duration_seconds": N },
  "failure_patterns": [{ "keyword": "...", "count": N }]
}
```

12. **Display the analytics report table:**

```markdown
## Swarm Analytics

| Metric | Value |
|---|---|
| Total Swarms | {total_swarms} |
| Avg Tasks/Swarm | {avg_tasks_per_swarm} |
| Avg Duration | {formatted duration} |
| Overall Failure Rate | {overall_failure_rate}% |
| Failure Trend | {failure_rate_trend} |
| Most Common Status | {most_common_status} |
| Largest Swarm | {name} ({total_tasks} tasks) |
| Longest Swarm | {name} ({formatted duration}) |

### Failure Patterns (Top 3)
| Keyword | Count |
|---|---|
| {keyword} | {count} |
```
