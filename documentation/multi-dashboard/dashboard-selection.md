# Dashboard Selection

When a Synapse command needs to interact with a dashboard, it must determine which dashboard to use. Synapse employs two distinct selection mechanisms: **claiming** (for write operations like starting a new swarm) and **detection** (for read operations like checking status).

---

## Claiming a Dashboard (`selectDashboard`)

Used by `!p_track` when starting a new swarm. The master agent must claim a dashboard before writing `initialization.json`.

### Priority Chain

The selection follows a strict priority order. The first matching rule wins:

```
1. Pre-assigned dashboard (system prompt directive)     ← Highest priority
2. Explicit --dashboard flag
3. Auto-selection (create new or reuse available)       ← Fallback
```

### Priority 1: Pre-Assigned Dashboard

When an agent is spawned from the Synapse Electron app's chat view, its system prompt contains a `DASHBOARD ID:` directive identifying the dashboard bound to that chat. This is **always authoritative** and the agent uses it unconditionally.

Each chat view in the Electron app is associated with exactly one dashboard. The agent spawned from that chat writes to that specific dashboard so the user sees the swarm in the correct panel.

**Pre-assigned dashboards are never overridden by auto-selection.**

```
System prompt contains:  DASHBOARD ID: a1b2c3
Result:                  Agent uses a1b2c3 unconditionally
```

### Priority 2: Explicit `--dashboard` Flag

The user can force a specific dashboard with a command-line flag:

```
!p_track --dashboard a1b2c3 Implement user authentication
```

This bypasses auto-selection and uses `a1b2c3` directly. If the specified dashboard is currently in use (has agents that are `pending` or `in_progress`), Synapse warns the user and requires confirmation before overwriting.

### Priority 3: Auto-Selection

When no dashboard is pre-assigned and no `--dashboard` flag is specified, the master scans all existing dashboards to find an available one, or creates a new dashboard via `nextDashboardId()`.

**Algorithm:**

```
for each dashboard in listDashboards():
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

if no available dashboard found:
    → CREATE a new dashboard with nextDashboardId().
    → Use the new dashboard.
```

Since dashboards are created dynamically (no fixed slot limit), auto-selection will create a new dashboard when all existing ones are in use.

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

When auto-detection selects a dashboard, it announces the choice with a prefix: `"[a1b2c3] ..."`.

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
!status a1b2c3                  → explicit: a1b2c3
!inspect 2.3                    → auto-detect + task_id "2.3"
!inspect a1b2c3 2.3             → explicit: a1b2c3 + task_id "2.3"
!logs --level error             → auto-detect + filter
!logs a1b2c3 --level error      → explicit: a1b2c3 + filter
```

**Parsing rule:** If the first argument matches a dashboard ID format (6-character hex string), consume it as `{dashboardId}`. Otherwise, run auto-detection. Task IDs use `N.N` format and flags start with `--`, so there is no ambiguity.

---

## Worker Dashboard Routing

Workers do not auto-detect dashboards. The master includes the dashboard ID in every worker dispatch prompt:

```
Write your progress to: {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

Every worker receives:
- `{tracker_root}` — where to write progress files
- `{dashboardId}` — which dashboard to write to (6-character hex string)
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
