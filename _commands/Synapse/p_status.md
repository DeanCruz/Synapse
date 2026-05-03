# `!p_status [dashboardId]`

**Purpose:** Mid-swarm health check. Status all currently dispatched workers, surface stalls and failures, log any transitions, and re-saturate the pipeline by dispatching any newly-ready tasks and re-dispatching cleanly failed ones — **without interrupting any worker that is actively running**.

> ## NON-NEGOTIABLE SAFETY RULES — READ BEFORE ANY ACTION
>
> **1. THIS COMMAND IS NON-DISRUPTIVE.** It runs WHILE a swarm is live. You MUST NOT interrupt, kill, restart, or overwrite any worker whose progress file shows `status: "in_progress"`. Read-only for in-progress workers. No exceptions.
>
> **2. NEVER DELETE OR OVERWRITE AN ACTIVE PROGRESS FILE.** If `status == "in_progress"`, the file belongs to that worker until it completes or fails. Touching it corrupts state and causes double-dispatch.
>
> **3. NEVER DOUBLE-DISPATCH.** Before dispatching ANY task, re-read its progress file. Dispatch only if (a) no progress file exists, (b) `status: "pending"`, or (c) `status: "failed"` (re-dispatch path). NEVER dispatch a task whose progress file currently says `in_progress` or `completed`.
>
> **4. THE MASTER STILL NEVER WRITES CODE.** This command only reads dashboard files, appends log entries, and dispatches workers. No application code, no edits to project files. Same role as `!p_track`.
>
> **5. SAFE TO RE-RUN.** Running `!p_status` twice in a row should be idempotent — the second run sees the same in-progress tasks and does nothing for them.

**Syntax:**
- `!p_status` — Auto-detect the active dashboard
- `!p_status a3f7k2` — Status a specific hex dashboard
- `!p_status dashboard1` — Status a specific named dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## When to use

- The user wants a snapshot of swarm health while it is still running.
- A wave appears stuck and the user wants to know whether it is genuinely blocked or a worker silently failed.
- The user suspects the dispatch pipeline has gaps — tasks with satisfied deps that were never dispatched.
- After a transient failure or external interruption that did NOT kill the active workers (e.g., a single dependency completed with no follow-up dispatch).

## When NOT to use

- The swarm has fully stalled / no agents are running anymore → use `!p_track_resume` (full reconstruction).
- You need to abort the swarm → use `!cancel`.
- You only want a printable summary with no actions → use `!status`.
- A specific task needs a clean re-run with root-cause analysis → use `!retry {task_id}`.

---

## Steps

### 1. Resolve the dashboard

Parse the optional `{dashboardId}` argument. If absent, run `detectDashboard()` per `dashboard_resolution.md`. Confirm the chosen dashboard ID in the first line of output.

### 2. Read current state (read-only)

Read all of the following without modifying anything:

- `{tracker_root}/dashboards/{dashboardId}/initialization.json` — full task plan.
- `{tracker_root}/dashboards/{dashboardId}/plan.json` — canonical plan (for re-dispatch context).
- Every file in `{tracker_root}/dashboards/{dashboardId}/progress/*.json` — current per-task state.
- `{tracker_root}/dashboards/{dashboardId}/logs.json` — to know what has already been logged (avoid duplicate entries).

If `initialization.json` is missing, abort: "No active swarm on dashboard `{dashboardId}` — nothing to status. Use `!p_track` to start one."

### 3. Build a status map

For every agent in `initialization.json`, classify into one of the following buckets by inspecting its progress file:

| Bucket | Definition | Action in this command |
|---|---|---|
| **active** | Progress file exists, `status == "in_progress"`, last `updated_at` within the staleness threshold (see Step 4) | **Read-only.** Report and move on. Do not touch. |
| **stale** | `status == "in_progress"` but no `updated_at`/log activity for ≥ 10 minutes (or the worker reported `last_seen` long ago) | **Flag for user confirmation.** Do not auto-kill. Log a `warning` entry. |
| **completed** | `status == "completed"` | Counted. Used to satisfy downstream `depends_on`. |
| **failed** | `status == "failed"` | Candidate for re-dispatch (Step 6). |
| **pending** | No progress file, OR progress file with `status == "pending"` | Candidate for dispatch (Step 5). |
| **blocked** | Pending, but at least one `depends_on` task is not `completed` | Counted but NOT dispatched. Report which dep is blocking. |

Print a one-line summary: `active=N pending=N blocked=N failed=N completed=N stale=N total=N`.

### 4. Staleness detection (do not auto-act)

A task is stale when `status == "in_progress"` AND the most recent of (`updated_at`, last log entry's `timestamp`) is older than **10 minutes** relative to the live `date -u` timestamp.

For each stale task:
- Append ONE log entry (only if no equivalent warning already exists in the last 50 log entries):
  ```json
  {
    "timestamp": "{live timestamp via date -u}",
    "task_id": "{task_id}",
    "agent": "Agent {N}",
    "level": "warning",
    "message": "Stale: no progress for {minutes}m. Worker may have hung. Use `!retry {task_id}` to force re-dispatch (will lose in-flight work).",
    "task_name": "{task.name}"
  }
  ```
- DO NOT delete the progress file. DO NOT re-dispatch automatically. The user decides whether to `!retry` it (which is destructive and explicit) or wait longer.

### 5. Dispatch newly-ready pending tasks (eager dispatch round)

For every task in the **pending** bucket whose entire `depends_on` set is in the **completed** bucket:

1. **Re-read its progress file** immediately before dispatching to confirm it is still pending. If it changed since Step 2 (e.g., a worker just started it via the orchestrator), skip it.
2. Build the worker prompt using the standard template from `p_track.md` Step 14 — pull the deeply-thought `approach` and `files` from `plan.json` for that `task.id`, plus shared `context`. Include `UPSTREAM RESULTS` from completed dependencies (read their progress files' `summary` and `files_changed`).
3. Resolve `{project_root}` from `task.project_root` in `initialization.json`, falling back to standard resolution order.
4. Include in the prompt:
   ```
   PROJECT ROOT: {project_root}
   TRACKER ROOT: {tracker_root}
   Write your progress to: {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
   Do your code work in: {project_root}
   ```
5. Append to `logs.json`:
   ```json
   {
     "timestamp": "{live timestamp via date -u}",
     "task_id": "{task_id}",
     "agent": "Agent {N}",
     "level": "info",
     "message": "Dispatched via !p_status: deps satisfied — {dep_ids_csv}",
     "task_name": "{task.name}"
   }
   ```
6. Dispatch the worker via the Task tool.

If no pending task is ready, log nothing for this step and report: "No newly-dispatchable tasks."

### 6. Re-dispatch cleanly failed tasks

For every task in the **failed** bucket:

1. **Check downstream blast radius.** If 3+ failures cluster in the same wave or a single failure blocks ≥3 downstream tasks or > 50% of remaining work, STOP and surface the circuit-breaker recommendation per `agent/master/failure_recovery.md`. Do not auto-retry — ask the user.
2. **Check dependency health.** If any `depends_on` is itself `failed`, do NOT retry this task — report that the upstream failure must be resolved first.
3. **Otherwise:** re-dispatch following the same protocol as `!retry` (see `_commands/Synapse/retry.md` Steps 6-12) — save the prior failure summary, delete the old progress file, perform root-cause analysis from the previous logs, and dispatch a new worker with a `RETRY` section in the prompt.
4. Append a log entry:
   ```json
   {
     "timestamp": "{live timestamp via date -u}",
     "task_id": "{task_id}",
     "agent": "Agent {N}",
     "level": "info",
     "message": "Re-dispatched via !p_status (root cause: {one-line analysis})",
     "task_name": "{task.name}"
   }
   ```

If the user passed a flag to suppress auto-retry (none defined here — keep behavior simple), skip and just list failures with retry suggestions instead.

### 7. Update master_state.json (if present)

If `master_state.json` exists, refresh its checkpoint fields per `agent/master/compaction_recovery.md` to reflect the post-status-pass dispatch state. If it does not exist (e.g., this swarm started in lightweight mode), do NOT create one — leave the dashboard in its original mode.

### 8. Print the status report

Output a concise terminal report in this exact shape:

```
Dashboard: {dashboardId}
Mode: {full | lightweight}  (inferred from presence of master_state.json)

ACTIVE ({n}):
  - {task_id}  Agent {N}  {task.name}  ({minutes_running}m running)
  ...

STALE ({n}):
  - {task_id}  Agent {N}  {task.name}  (no progress for {minutes}m)  → consider `!retry {task_id}`
  ...

DISPATCHED THIS PASS ({n}):
  - {task_id}  Agent {N}  {task.name}  (deps satisfied: {dep_ids})
  ...

RE-DISPATCHED FAILURES ({n}):
  - {task_id}  Agent {N}  {task.name}  (prev failure: {one-line summary})
  ...

BLOCKED ({n}):
  - {task_id}  {task.name}  ← waiting on {dep_ids}
  ...

COMPLETED: {n} / {total}
FAILED:    {n}
PENDING:   {n}
```

Omit any section that has zero entries to keep the report short.

### 9. Do NOT close the swarm

`!p_status` never marks the swarm complete and never writes `metrics.json`. Completion belongs to the original `!p_track` lifecycle (or to whatever orchestrator owns the swarm). This command is a checkpoint, not a terminator.

---

## Idempotency contract

Two consecutive `!p_status` runs with no worker activity in between MUST produce identical "DISPATCHED THIS PASS" and "RE-DISPATCHED FAILURES" sections of length 0 on the second run. If you find yourself dispatching the same task twice, you are violating Rule 3 (never double-dispatch) — re-read each candidate's progress file immediately before dispatch.

## Failure modes

| Symptom | Likely cause | Resolution |
|---|---|---|
| Reports "active" tasks that the user knows are dead | Worker crashed without writing failure status | Wait for staleness threshold (10m), or `!retry {task_id}` to force a clean re-dispatch |
| Dispatches a task that was already running | Race with the orchestrator OR you skipped the re-read in Step 5.1 | Read the progress file ONE MORE TIME right before dispatch — never trust the Step 2 snapshot |
| Same warning logged on every run | Step 4 dedupe check failed | Scan the last 50 log entries for an equivalent stale-warning before appending |
| No tasks dispatched but pipeline is empty | All remaining tasks are `blocked` (transitive failure) | Report blocked chain, suggest `!retry` on the upstream failure |

---

## Related commands

- `!p_track_resume` — Full state reconstruction when the swarm is dead, not just stalled.
- `!eager_dispatch` — Dispatch-only; does not status active workers or handle failures.
- `!retry {task_id}` — Force re-dispatch of a single specific task (destructive for in-progress).
- `!status` — Print-only summary, no dispatch, no log writes.
- `!dispatch --ready` — Dispatch all ready tasks; does not retry failures or surface stalls.
