# `!dispatch [dashboardId] {task_id | --ready}`

**Purpose:** Manually dispatch a specific pending task or all tasks whose dependencies are satisfied.

**Syntax:**
- `!dispatch 2.3` — Dispatch a specific task (auto-detect dashboard)
- `!dispatch dashboard2 2.3` — Dispatch a specific task on a specific dashboard
- `!dispatch --ready` — Dispatch all tasks whose dependencies are met
- `!dispatch dashboard1 --ready` — Same, on a specific dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## `!dispatch [dashboardId] {task_id}`

### Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument matches `dashboard[1-5]`, use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** Find the agent entry matching `{task_id}`.

3. **Read all progress files** from `{tracker_root}/dashboards/{dashboardId}/progress/`. Build a status map.

4. **Validate:**
   - Task must exist in `initialization.json` agents[].
   - Task must have no progress file, or a progress file with `status: "pending"`. If it has any other status, report it and stop.
   - All tasks in `depends_on` must have progress files with `status: "completed"`. If any dependency is not completed, report which dependencies are blocking and stop.

5. **Read the master task file** at `{tracker_root}/tasks/{date}/parallel_{task_name}.json`. Extract the full task context for `{task_id}`.

6. **Resolve `{project_root}`** from the `task.project_root` field in `initialization.json`. If not present, resolve using the standard resolution order (see `{tracker_root}/CLAUDE.md` — Path Convention section).

7. **Dispatch the agent** using the standard prompt template from `p_track.md` Step 14. **Include `{dashboardId}`, `{tracker_root}`, and `{project_root}` in the worker prompt** so it writes progress to the correct dashboard and does code work in the correct project:
   ```
   PROJECT ROOT: {project_root}
   TRACKER ROOT: {tracker_root}
   Write your progress to: {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
   Do your code work in: {project_root}
   ```

8. **Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:**
   ```json
   {
     "timestamp": "{live timestamp via date -u}",
     "task_id": "{task_id}",
     "agent": "Agent {N}",
     "level": "info",
     "message": "Manually dispatched: {task title}",
     "task_name": "{task.name}"
   }
   ```

9. **Display a brief confirmation** with the task ID, title, and assigned agent.

> **Note:** Do NOT write a progress file. The worker creates its own progress file when it starts.

---

## `!dispatch [dashboardId] --ready`

### Steps

1. **Parse `{dashboardId}` and read initialization + progress** as above.

2. For each agent in `initialization.json` that has no progress file (or `status: "pending"`), check if all tasks in `depends_on` have progress files with `status: "completed"`.

3. Collect all dispatchable tasks. If none, report: "No tasks ready for dispatch."

4. **Dispatch all ready tasks simultaneously** — follow the same dispatch + log sequence as above for each task. Include `{dashboardId}` in every worker prompt.

5. **Display a summary** of all newly dispatched tasks.
