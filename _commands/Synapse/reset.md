# `!reset [dashboardId | --all]`

**Purpose:** Clear a dashboard and reset it to empty state. Saves a history summary before clearing.

**Syntax:**
- `!reset` — Reset your assigned dashboard
- `!reset {dashboardId}` — Reset a specific dashboard
- `!reset --all` — Reset all dashboards

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

4. **Archive the dashboard** (MANDATORY — never skip):
   - Copy the entire dashboard directory to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`:
     ```bash
     TASK_NAME=$(cat {tracker_root}/dashboards/{dashboardId}/initialization.json | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
     ARCHIVE_NAME="$(date -u +%Y-%m-%d)_${TASK_NAME:-unnamed}"
     mkdir -p {tracker_root}/Archive/${ARCHIVE_NAME}
     cp -r {tracker_root}/dashboards/{dashboardId}/* {tracker_root}/Archive/${ARCHIVE_NAME}/
     ```

5. **Clear the dashboard:**
   - Delete all `.json` files in `{tracker_root}/dashboards/{dashboardId}/progress/`.
   - Write `initialization.json`:
     ```json
     { "task": null, "agents": [], "waves": [], "chains": [], "history": [] }
     ```
   - Write `logs.json`:
     ```json
     { "entries": [] }
     ```

6. **Report:** "Dashboard {dashboardId} cleared. Archived to `Archive/{archive_name}/`. History saved to `history/{filename}.json`."

---

### Reset All (`--all`)

1. For each dashboard returned by `listDashboards()` (excluding `ide`):
   - If `initialization.json` has `task: null`, skip (already empty).
   - Otherwise, archive, save history summary, and clear (same as steps 3-5 above).

2. **Report:** "All dashboards cleared. {N} archived and history summaries saved."
