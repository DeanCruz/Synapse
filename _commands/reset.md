# `!reset [dashboardId | --all]`

**Purpose:** Clear a dashboard and reset it to empty state. Saves a history summary before clearing.

**Syntax:**
- `!reset` — Reset the auto-detected active dashboard
- `!reset dashboard2` — Reset a specific dashboard
- `!reset --all` — Reset all 5 dashboards

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

### Single Dashboard Reset

1. **Parse the optional `{dashboardId}` argument.** If the first argument matches `dashboard[1-5]`, use it. If `--all` is specified, see the "Reset All" section below. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** If `task` is `null`, report: "Dashboard {dashboardId} is already empty." and stop.

3. **Save a history summary** before clearing:
   - Read `initialization.json`, all progress files from `progress/`, and `logs.json`.
   - Derive a history summary (same structure as the server's `buildHistorySummary()`):
     - `task_name`, `task_type`, `project`, `directory`, `prompt`
     - `overall_status` (derived from progress files)
     - `total_tasks`, `completed_tasks`, `failed_tasks`, `in_progress_tasks`, `pending_tasks`
     - `total_waves`, `started_at` (earliest), `completed_at` (latest), `duration`
     - `cleared_at` (current timestamp), `dashboard_id`
     - `agents[]` — summary of each agent (id, title, status, duration)
     - `log_count`
     - `lessons_learned` — object with:
       - `deviations[]` — all deviations reported across agents (from progress files)
       - `failure_causes[]` — root cause summary for each failed agent (from progress file summaries)
       - `warnings[]` — all warnings from logs.json (level "warn")
       - `patterns` — brief note on what worked well or poorly (e.g., "tasks with shared file deps caused conflicts", "right-sizing at 3 files per task worked well")
   - Write to `{tracker_root}/history/{YYYY-MM-DD}_{task_name}.json`.

4. **Clear the dashboard:**
   - Delete all `.json` files in `{tracker_root}/dashboards/{dashboardId}/progress/`.
   - Write `initialization.json`:
     ```json
     { "task": null, "agents": [], "waves": [], "chains": [], "history": [] }
     ```
   - Write `logs.json`:
     ```json
     { "entries": [] }
     ```

5. **Report:** "Dashboard {dashboardId} cleared. History saved to `history/{filename}.json`."

---

### Reset All (`--all`)

1. For each dashboard from `dashboard1` through `dashboard5`:
   - If `initialization.json` has `task: null`, skip (already empty).
   - Otherwise, save history summary and clear (same as steps 3-4 above).

2. **Report:** "All dashboards cleared. {N} history summaries saved."
