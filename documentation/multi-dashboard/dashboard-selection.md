# Dashboard Selection

When a Synapse command needs to interact with a dashboard, it must determine which of the 5 dashboard slots to use. Synapse employs two distinct selection mechanisms: **claiming** (for write operations like starting a new swarm) and **detection** (for read operations like checking status).

---

## Claiming a Dashboard (`selectDashboard`)

Used by `!p_track` when starting a new swarm. The master agent must claim a dashboard before writing `initialization.json`.

### Priority Chain

The selection follows a strict priority order. The first matching rule wins:

```
1. Pre-assigned dashboard (system prompt directive)     ← Highest priority
2. Explicit --dashboard flag
3. Auto-selection (scan for first available slot)       ← Fallback
```

### Priority 1: Pre-Assigned Dashboard

When an agent is spawned from the Synapse Electron app's chat view, its system prompt contains a `DASHBOARD ID:` directive identifying the dashboard bound to that chat. This is **always authoritative** and the agent uses it unconditionally.

Each chat view in the Electron app is associated with exactly one dashboard. The agent spawned from that chat writes to that specific dashboard so the user sees the swarm in the correct panel.

**Pre-assigned dashboards are never overridden by auto-selection.**

```
System prompt contains:  DASHBOARD ID: dashboard3
Result:                  Agent uses dashboard3 unconditionally
```

### Priority 2: Explicit `--dashboard` Flag

The user can force a specific dashboard slot with a command-line flag:

```
!p_track --dashboard dashboard3 Implement user authentication
```

This bypasses auto-selection and uses `dashboard3` directly. If the specified dashboard is currently in use (has agents that are `pending` or `in_progress`), Synapse warns the user and requires confirmation before overwriting.

### Priority 3: Auto-Selection

When no dashboard is pre-assigned and no `--dashboard` flag is specified, the master scans all 5 dashboard slots in order to find the first available one.

**Algorithm:**

```
for each dashboard in [dashboard1, dashboard2, ..., dashboard5]:
    read initialization.json

    if task is null:
        → AVAILABLE. Use this dashboard.

    if task exists but no progress files exist:
        → STALE CLAIM (plan written, never dispatched).
        → Treat as available. Use this dashboard.

    if all progress files have status "completed" or "failed":
        → FINISHED BUT UNCLEARED.
        → Save a history summary to history/.
        → Use this dashboard (overwrite).

    if any agent is "pending" or "in_progress":
        → IN USE. Skip.
```

If all 5 dashboards are in use, Synapse displays a summary table and asks the user to choose:

```
## All Dashboards In Use

| Dashboard | Task            | Status      | Progress |
|-----------|-----------------|-------------|----------|
| dashboard1| Auth refactor   | in_progress | 5/12     |
| dashboard2| Dark mode       | in_progress | 3/8      |
| dashboard3| DB migration    | in_progress | 1/6      |
| dashboard4| API endpoints   | in_progress | 7/10     |
| dashboard5| Test suite      | in_progress | 2/5      |

Pick a dashboard to overwrite, or run `!reset {dashboardId}` first.
```

### Auto-Selection: Finished Dashboards

When auto-selection encounters a dashboard whose swarm has finished (all agents completed or failed), it automatically:

1. Calls `saveHistorySummary()` to persist a lightweight summary to `{tracker_root}/history/`
2. Archives the dashboard to `{tracker_root}/Archive/` (preserving all data)
3. Clears the dashboard for reuse

This means finished swarms are never lost -- they are always preserved in both history and archive before being overwritten.

---

## Detecting a Dashboard (`detectDashboard`)

Used by read commands (`!status`, `!logs`, `!inspect`, `!deps`) when no specific dashboard is given.

### Algorithm

1. Scan all dashboards returned by `listDashboards()`.
2. For each, read `initialization.json`. Skip any where `task` is `null` (empty dashboard).
3. For non-empty dashboards, derive `overallStatus` from progress files and find the latest activity timestamp.
4. Collect all non-empty dashboards as candidates.

### Selection Priority

| Condition | Result |
|---|---|
| 0 candidates | Report: "No active swarms. Use `!p_track` to start one." |
| 1 candidate | Use it |
| Exactly 1 candidate is `in_progress` | Use it |
| Multiple candidates | Use the one with the most recent activity timestamp |

When auto-detection selects a dashboard, it announces the choice with a prefix: `"[dashboard3] ..."`.

---

## Status Derivation

Since `initialization.json` stores no lifecycle fields, overall swarm status is derived from progress files:

### `deriveOverallStatus()` Algorithm

1. Read `initialization.json` to get the `agents[]` array.
2. Read all files in `progress/` to build a map of `{ taskId: progressData }`.
3. For each agent in `initialization.json`:
   - If a matching progress file exists, use its `status` field.
   - If no progress file exists, status is `"pending"`.
4. Derive the overall status:

| Condition | Overall Status |
|---|---|
| All agents pending | `"pending"` |
| Any agent `in_progress` | `"in_progress"` |
| Mix of completed and pending (none in progress) | `"in_progress"` (dispatch ongoing) |
| All done, at least one failed | `"completed_with_errors"` |
| All completed, none failed | `"completed"` |

---

## Parameter Parsing

All commands accept an optional `{dashboardId}` as the **first positional argument**:

```
!status                         → auto-detect
!status dashboard3              → explicit: dashboard3
!inspect 2.3                    → auto-detect + task_id "2.3"
!inspect dashboard1 2.3         → explicit: dashboard1 + task_id "2.3"
!logs --level error             → auto-detect + filter
!logs dashboard2 --level error  → explicit: dashboard2 + filter
```

**Parsing rule:** If the first argument matches the pattern `dashboard\d+`, consume it as `{dashboardId}`. Otherwise, run auto-detection. Task IDs use `N.N` format and flags start with `--`, so there is no ambiguity.

---

## Worker Dashboard Routing

Workers do not auto-detect dashboards. The master includes the dashboard ID in every worker dispatch prompt:

```
Write your progress to: {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

Every worker receives:
- `{tracker_root}` — where to write progress files
- `{dashboardId}` — which dashboard slot to write to
- `{task_id}` — which progress file to create
- `{project_root}` — where to do code work

Workers write exactly where instructed. There is no auto-detection at the worker level.

---

## Merging Agent Data

To render a complete view of an agent, the dashboard merges data from two sources:

**From `initialization.json` (static plan):**
- `id`, `title`, `wave`, `layer`, `directory`, `depends_on`

**From `progress/{id}.json` (dynamic lifecycle):**
- `status`, `assigned_agent`, `started_at`, `completed_at`, `summary`
- `stage`, `message`, `milestones`, `deviations`, `logs`

**If no progress file exists for an agent:**
- `status` = `"pending"`, all other lifecycle fields = `null`

---

## Key Source Files

| File | Purpose |
|---|---|
| `agent/instructions/dashboard_resolution.md` | Complete dashboard resolution protocol |
| `src/server/services/DashboardService.js` | `listDashboards()`, `readDashboardInit()`, `readDashboardProgress()` |
| `src/server/services/HistoryService.js` | `saveHistorySummary()` for auto-clearing finished dashboards |
