# `!cancel [dashboardId] [--force]`

**Purpose:** Cancel the active swarm on a dashboard. Marks all non-completed tasks as cancelled via their progress files.

**Syntax:**
- `!cancel` — Cancel the auto-detected active swarm
- `!cancel a3f7k2` — Cancel the swarm on a specific hex dashboard
- `!cancel dashboard3` — Cancel the swarm on a specific dashboard
- `!cancel --force` — Skip confirmation
- `!cancel a3f7k2 --force` — Cancel a specific hex dashboard without confirmation
- `!cancel dashboard2 --force` — Cancel a specific dashboard without confirmation

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

1. **Parse the optional `{dashboardId}` and `--force` flag.** If the first argument is a valid dashboard ID (any non-flag string that is not a task ID, including 6-char hex IDs like `a3f7k2`, `ide`, and legacy `dashboardN`), use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** If `task` is `null`, report: "No active swarm on {dashboardId}."

3. **Read all progress files** from `{tracker_root}/dashboards/{dashboardId}/progress/`. Derive `overallStatus`. If already fully completed, report: "Swarm is already complete."

4. **Confirmation:**

   a. **Without `--force`:** Write a `"permission"` log entry to `{tracker_root}/dashboards/{dashboardId}/logs.json` (triggers dashboard popup), then ask the user in the terminal for confirmation.

   b. **With `--force`:** Skip confirmation.

5. **Cancel logic — write progress files for each non-completed agent:**

   > **Note:** This is the ONE exception where the master writes progress files. Cancellation is a forced state override.

   - Run `date -u +"%Y-%m-%dT%H:%M:%SZ"` to capture the timestamp.
   - For each agent in `initialization.json`:
     - If progress file shows `"completed"` → **leave it alone**. Completed work is preserved.
     - If progress file shows `"in_progress"` → **update** the progress file: set `status: "failed"`, `summary: "Cancelled by user — may still be running"`, `completed_at: {timestamp}`.
     - If no progress file exists (pending) → **create** a progress file: `{ "task_id": "{id}", "status": "failed", "summary": "Cancelled by user", "started_at": "{timestamp}", "completed_at": "{timestamp}" }`.

6. **Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:**
   ```json
   {
     "timestamp": "{captured timestamp}",
     "task_id": "0.0",
     "agent": "Orchestrator",
     "level": "warn",
     "message": "Swarm cancelled by user — {completed}/{total} tasks were completed before cancellation",
     "task_name": "{task.name}"
   }
   ```

7. **Display the final summary:**

```markdown
Swarm '{task.name}' on {dashboardId} cancelled.
{completed} tasks completed, {cancelled} tasks cancelled.
```

**Note:** Running agents may continue to completion in the background. Their progress file writes will succeed (the files exist), but the swarm is effectively finalized. If you need to cleanly stop running agents, restart the Claude Code session.
