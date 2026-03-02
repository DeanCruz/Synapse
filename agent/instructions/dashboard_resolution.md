# Dashboard Resolution Protocol

**Purpose:** Shared reference for how all commands resolve `{dashboardId}`, derive swarm status, and read dashboard data. Every command that interacts with dashboard data references this file.

---

## Data Paths

All dashboard data lives under `{tracker_root}/dashboards/{dashboardId}/`:

| Path | Contents | Written By |
|---|---|---|
| `initialization.json` | Static plan — task, agents, waves, chains | Master (write-once) |
| `logs.json` | Timestamped event log (`entries[]`) | Master |
| `progress/{task_id}.json` | Full agent lifecycle — status, timing, summary, logs | Worker (owns its file) |

Global directories (not per-dashboard):

| Path | Contents |
|---|---|
| `{tracker_root}/history/` | History summary JSON files (one per cleared task) |
| `{tracker_root}/Archive/` | Full archived dashboard snapshots |
| `{tracker_root}/tasks/{date}/` | Master XML and plan files |

---

## Parameter Parsing

All commands accept an optional `{dashboardId}` as the **first positional argument**.

**Rule:** If the first argument matches `dashboard[1-5]`, consume it as `{dashboardId}`. Otherwise, run auto-detection.

```
!status                     → auto-detect
!status dashboard3          → explicit: dashboard3
!inspect 2.3                → auto-detect + task_id "2.3"
!inspect dashboard1 2.3     → explicit: dashboard1 + task_id "2.3"
!logs --level error         → auto-detect + filter
!logs dashboard2 --level error → explicit: dashboard2 + filter
```

Task IDs use `N.N` format (e.g., `2.3`), flags start with `--` — neither conflicts with `dashboard[1-5]`.

---

## Auto-Detection — `detectDashboard()`

Used by read commands (`!status`, `!logs`, `!inspect`, `!deps`) when no dashboard is specified.

**Algorithm:**

1. Scan `dashboard1` through `dashboard5`.
2. For each, read `initialization.json`. Skip any where `task` is `null` (empty dashboard).
3. For dashboards with a task, derive `overallStatus` (see below) and find the latest activity timestamp (most recent `started_at` or `completed_at` from progress files, or `task.created` as fallback).
4. Collect all non-empty dashboards as candidates.

**Selection priority:**

| Condition | Result |
|---|---|
| 0 candidates | Report: "No active swarms. Use `!p_track` to start one." |
| 1 candidate | Use it |
| Exactly 1 candidate is `in_progress` | Use it |
| Multiple candidates | Use the one with the most recent activity timestamp |

If auto-detection selects a dashboard, announce it: `"[dashboard3] ..."` prefix on output.

---

## Dashboard Claiming — `selectDashboard()`

Used by `!p_track` when starting a new swarm. The master must claim a dashboard before writing `initialization.json`.

**Algorithm:**

1. Scan `dashboard1` through `dashboard5` in order.
2. For each dashboard:
   - Read `initialization.json`. If `task` is `null` → **available**. Return this dashboard.
   - If `task` is not null, read all files in `progress/`.
   - If no progress files exist → **stale claim** (plan was written but never dispatched). Treat as available.
   - If every progress file has status `"completed"` or `"failed"` → **finished but uncleared**. Save a history summary to `{tracker_root}/history/` before overwriting. Return this dashboard.
   - Otherwise (at least one agent is `"pending"` or `"in_progress"`) → **in use**. Skip.
3. If all 5 are in use, display a summary table and ask the user:

```markdown
## All Dashboards In Use

| Dashboard | Task | Status | Progress |
|---|---|---|---|
| dashboard1 | {task.name} | {overall_status} | {completed}/{total} |
| ... | ... | ... | ... |

Pick a dashboard to overwrite, or run `!reset {dashboardId}` first.
```

4. If the user picks a dashboard, save history before overwriting if it had data.

**User override:** `!p_track --dashboard dashboard3 {prompt}` bypasses auto-selection and uses `dashboard3` directly. If it's in use, warn and require confirmation.

---

## Status Derivation — `deriveOverallStatus()`

Since `initialization.json` stores no lifecycle fields, status must be derived from progress files.

**Algorithm:**

1. Read `initialization.json` → get `agents[]` array.
2. Read all files in `progress/` → build a map of `{ taskId: progressData }`.
3. For each agent in `initialization.json`:
   - If a matching progress file exists → use its `status` field.
   - If no progress file exists → status is `"pending"`.
4. From the collected statuses:

| Condition | Overall Status |
|---|---|
| All agents pending | `"pending"` |
| Any agent `in_progress` | `"in_progress"` |
| Mix of completed and pending (none in_progress) | `"in_progress"` (dispatch is ongoing) |
| All agents completed or failed, AND at least one failed | `"completed_with_errors"` |
| All agents completed, none failed | `"completed"` |

---

## Reading Agent Data — Merge Pattern

To get the full picture of an agent, merge two sources:

**From `initialization.json` agents[]:**
- `id`, `title`, `wave`, `layer`, `directory`, `depends_on`

**From `progress/{id}.json`:**
- `status`, `assigned_agent`, `started_at`, `completed_at`, `summary`
- `stage`, `message`, `milestones`, `deviations`, `logs`

**If no progress file exists:**
- `status` = `"pending"`, all other lifecycle fields = `null`

### Deriving Stats

All stats are computed, never stored:
- `completed_tasks` = count of progress files with `status: "completed"`
- `failed_tasks` = count with `status: "failed"`
- `in_progress_tasks` = count with `status: "in_progress"`
- `pending_tasks` = total agents minus the above
- `started_at` = earliest `started_at` across all progress files
- `completed_at` = latest `completed_at` (only meaningful when all agents are done)
- `elapsed` = `now - started_at` (or `completed_at - started_at` if all done)

### Deriving Wave Status

For each wave in `initialization.json`:
1. Find all agents belonging to that wave.
2. Check their statuses (from progress files).
3. Wave is `"completed"` if all its agents are completed/failed.
4. Wave is `"in_progress"` if any agent is in_progress or completed.
5. Wave is `"pending"` otherwise.

---

## Dashboard Availability Check

A dashboard is considered **available** if ANY of these are true:
- `initialization.json` has `task: null`
- `initialization.json` does not exist
- All progress files show terminal status (`completed` or `failed`) — the swarm finished but was never cleared

A dashboard is **in use** if:
- `initialization.json` has a `task` AND at least one agent is `pending` or `in_progress`

---

## Worker Dashboard Routing

Workers must know their `{dashboardId}` to write progress files to the correct location. The master includes the dashboard ID in every worker dispatch prompt:

```
Write your progress to: {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

Workers never auto-detect dashboards. They write exactly where the master tells them to.
