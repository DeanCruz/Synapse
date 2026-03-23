# `!cancel-safe [dashboardId]`

**Purpose:** Graceful shutdown of the active swarm. Stops dispatching new tasks but lets all in-progress agents finish their work naturally. Pending tasks are marked as cancelled. This is the preferred alternative to `!cancel` when you want to preserve work from running agents.

**Syntax:**
- `!cancel-safe` — Graceful shutdown of the auto-detected active swarm
- `!cancel-safe dashboard3` — Graceful shutdown of a specific dashboard's swarm

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

> **Contrast with `!cancel`:** The standard `!cancel` command immediately marks in-progress agents as failed (though they may continue running in the background). `!cancel-safe` waits for in-progress agents to complete or fail on their own, preserving their work. Use `!cancel` for immediate termination; use `!cancel-safe` when you want running work to finish cleanly.

---

## Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument matches `dashboard[1-5]`, use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** If `task` is `null`, report: "No active swarm on {dashboardId}."

3. **Read all progress files** from `{tracker_root}/dashboards/{dashboardId}/progress/`. Derive `overallStatus`. If already fully completed, report: "Swarm is already complete — nothing to cancel."

4. **Set the graceful shutdown flag.** The master agent sets an internal flag (in its own working memory) that prevents any further task dispatches for this swarm. From this point forward:
   - **No new agents are dispatched** — even if dependencies are satisfied, pending tasks are not dispatched.
   - **Running agents continue** — in-progress agents are not interrupted and will finish naturally.

5. **Log the graceful shutdown initiation** — append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
   ```json
   {
     "timestamp": "{captured timestamp}",
     "task_id": "0.0",
     "agent": "Orchestrator",
     "level": "warn",
     "message": "Graceful shutdown initiated — no new dispatches, waiting for in-progress agents",
     "task_name": "{task.name}"
   }
   ```

6. **Display the initiation message:**
   ```markdown
   Graceful shutdown initiated for '{task.name}' on {dashboardId}.
   No new tasks will be dispatched. Waiting for {in_progress_count} in-progress agent(s) to finish...
   ```

7. **Wait for all in-progress agents to complete or fail.** Poll progress files in `{tracker_root}/dashboards/{dashboardId}/progress/` periodically (every 10 seconds):
   - For each agent whose progress file shows `"in_progress"`, continue waiting.
   - When an agent's progress file changes to `"completed"` or `"failed"`, log the completion to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
     ```json
     {
       "timestamp": "{captured timestamp}",
       "task_id": "{id}",
       "agent": "{assigned_agent}",
       "level": "info",
       "message": "Agent finished during graceful shutdown — status: {status}",
       "task_name": "{task.name}"
     }
     ```
   - Display a brief terminal update: `"Agent {id} ({title}) finished — {status}."`
   - If **all** in-progress agents have finished, proceed to step 8.

   > **Timeout:** If agents remain in-progress for more than 10 minutes, warn the user:
   > `"Graceful shutdown has been waiting 10 minutes. {remaining} agent(s) still running. Continue waiting or use !cancel --force to terminate immediately?"`

8. **Mark remaining pending tasks as cancelled** — write progress files for each non-started agent:

   > **Note:** Like `!cancel`, this is an exception where the master writes progress files.

   - Run `date -u +"%Y-%m-%dT%H:%M:%SZ"` to capture the timestamp.
   - For each agent in `initialization.json`:
     - If progress file shows `"completed"` or `"failed"` → **leave it alone**. Work is preserved as-is.
     - If no progress file exists (pending/never dispatched) → **create** a progress file:
       ```json
       {
         "task_id": "{id}",
         "status": "failed",
         "started_at": "{timestamp}",
         "completed_at": "{timestamp}",
         "summary": "Cancelled — graceful shutdown, task was never dispatched",
         "assigned_agent": null,
         "stage": "failed",
         "message": "Cancelled during graceful shutdown",
         "milestones": [],
         "deviations": [],
         "logs": [
           { "at": "{timestamp}", "level": "warn", "msg": "Task cancelled during graceful shutdown — was never dispatched" }
         ]
       }
       ```

9. **Update the master task file** — for each pending task that was cancelled, update its `status` to `cancelled` and add a log entry noting the graceful shutdown.

10. **Log the completion of graceful shutdown** — append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
    ```json
    {
      "timestamp": "{captured timestamp}",
      "task_id": "0.0",
      "agent": "Orchestrator",
      "level": "warn",
      "message": "Graceful shutdown complete — {completed}/{total} completed, {failed}/{total} failed, {cancelled}/{total} cancelled",
      "task_name": "{task.name}"
    }
    ```

11. **Display the final summary report:**

```markdown
## Graceful Shutdown Complete — '{task.name}' on {dashboardId}

### Results
| Status | Count |
|---|---|
| Completed | {completed} |
| Failed (during execution) | {failed_during} |
| Cancelled (never dispatched) | {cancelled} |
| **Total** | **{total}** |

### Completed Tasks
| # | Title | Agent | Summary |
|---|---|---|---|
| {id} | {title} | {agent} | {summary} |

### Cancelled Tasks
| # | Title | Reason |
|---|---|---|
| {id} | {title} | Never dispatched — graceful shutdown |

### Failed Tasks (if any)
| # | Title | Agent | Summary |
|---|---|---|---|
| {id} | {title} | {agent} | {summary} |
```

**Note:** Unlike `!cancel`, which may leave agents running with their progress files overwritten to "failed", `!cancel-safe` preserves all in-progress work. Agents that were running at shutdown time completed naturally and their results are fully intact.
