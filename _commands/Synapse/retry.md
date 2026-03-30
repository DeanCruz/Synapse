# `!retry [dashboardId] {task_id}`

**Purpose:** Re-dispatch a failed or blocked task. Deletes the old progress file and launches a fresh agent.

**Syntax:**
- `!retry 2.3` — Retry a task (uses your assigned dashboard)
- `!retry dashboard1 2.3` — Retry a task on a specific dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument is a valid dashboard ID (see `dashboard_resolution.md`), use it as `{dashboardId}`. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** Find the agent entry matching `{task_id}`.

3. **Read `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`** for the current lifecycle state.

4. **Validate:**
   - If no agent matching `{task_id}` exists in initialization.json, report an error with valid task IDs.
   - If no progress file exists (agent is pending), report: "Task hasn't been attempted yet — use `!dispatch` instead."
   - If progress file shows `"in_progress"`, warn the user it's already running and ask for confirmation.
   - If progress file shows `"completed"`, warn the user and ask for confirmation before re-running.
   - If progress file shows `"failed"`, proceed.

5. **Check dependencies.** Read all progress files. Verify all tasks in `depends_on` have `status: "completed"`. If any dependency is `"failed"`, warn: "Dependency {dep_id} has failed — resolve it first (try `!retry {dep_id}`)."

6. **Save the previous failure summary** from the old progress file (if it exists) for inclusion in the retry prompt.

7. **Delete the old progress file:**
   ```bash
   rm -f {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
   ```
   The new worker will create a fresh one.

8. **Read the master task file** at `{tracker_root}/tasks/{date}/parallel_{task_name}.json`. Extract the full task context for `{task_id}`.

9. **Analyze the failure root cause.** Before blindly re-dispatching:
   - Read the previous progress file's `logs[]` array (saved in step 6) to understand WHERE the worker failed.
   - Identify the likely root cause: missing file? Type mismatch? Wrong pattern? Environment issue? Ambiguous requirement?
   - Read any files that are relevant to the failure (e.g., if the worker reported a missing import, read the file to verify the current state).
   - Determine what to include in the retry prompt to prevent the same failure.

10. **Resolve `{project_root}`** from the `task.project_root` field in `initialization.json`. If not present, resolve using the standard resolution order.

11. **Dispatch a new agent** using the standard prompt template from `p_track.md` Step 14. **Include `{dashboardId}`, `{tracker_root}`, and `{project_root}` in the worker prompt.** Add a retry section with root cause context:
   ```
   NOTE: This is a RETRY of a previously failed task.

   PREVIOUS FAILURE:
   "{previous summary or error}"

   ROOT CAUSE ANALYSIS:
   {Master's analysis of what went wrong and why}

   REMEDIATION GUIDANCE:
   {Specific instructions to avoid the same failure — e.g., "The import path should be
   '../utils/auth' not '../auth/utils'", or "The function signature changed in the
   upstream task — use the new signature: foo(bar: string, baz: number)"}

   PREVIOUS WORKER LOGS:
   {Key log entries from the failed attempt that provide context}
   ```

12. **Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:**
    ```json
    {
      "timestamp": "{live timestamp via date -u}",
      "task_id": "{task_id}",
      "agent": "Agent {N}",
      "level": "info",
      "message": "Retrying: {task title} — previous failure: {summary}",
      "task_name": "{task.name}"
    }
    ```

13. **Display a brief confirmation** showing the retried task and its new agent assignment.

---

> For complex failures requiring a diagnostic-first approach, dispatch a repair worker using the protocol at `{tracker_root}/agent/instructions/failed_task.md` instead of `!retry`.
