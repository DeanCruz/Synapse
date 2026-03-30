# `!status [dashboardId]`

**Purpose:** Display a quick summary of the current swarm state from dashboard data without opening the browser.

**Syntax:**
- `!status` — Auto-detect the active dashboard
- `!status a3f7k2` — Show status for a specific hex dashboard
- `!status dashboard3` — Show status for a specific dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument is a valid dashboard ID (any non-flag string that is not a task ID, including 6-char hex IDs like `a3f7k2`, `ide`, and legacy `dashboardN`), use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** If `task` is `null`, report: "No active swarm on {dashboardId}."

3. **Read all progress files** from `{tracker_root}/dashboards/{dashboardId}/progress/`. Build a map of `{ taskId: progressData }`.

4. **Derive all stats** by merging initialization data with progress data (see `dashboard_resolution.md` — Merge Pattern):
   - For each agent in `initialization.json`, look up its progress file for `status`, `assigned_agent`, `started_at`, `completed_at`, `summary`.
   - If no progress file exists for an agent, it is `"pending"`.
   - Compute: `completed`, `failed`, `in_progress`, `pending` counts.
   - Compute: `overall_status` using `deriveOverallStatus()`.
   - Compute: `elapsed` from earliest `started_at` to now (or to latest `completed_at` if all done).

5. **Display:**

```markdown
## Swarm: {task.name} [{dashboardId}]

**Status:** {overall_status} · **Type:** {task.type}
**Progress:** {completed}/{total} ({pct}%) · **Failed:** {failed}
**Elapsed:** {elapsed}
**Directory:** {task.directory}

### Agents
| # | Title | Wave | Status | Agent | Summary |
|---|---|---|---|---|---|
| {id} | {title} | {wave} | {status emoji + text} | {assigned_agent or —} | {summary or —} |
```

Status emojis:
- `completed` → ✅
- `in_progress` → 🔵
- `failed` → 🔴
- `pending` → ⚪

### Wave Summary
| Wave | Name | Status | Progress |
|---|---|---|---|
| {id} | {name} | {status} | {completed}/{total} |

6. **History note:** `"Run !history to view past swarms."`
