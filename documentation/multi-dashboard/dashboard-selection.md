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
3. No dashboard? Ask the user.                          ← Never scan or auto-select
```

### Priority 1: Pre-Assigned Dashboard (MANDATORY ISOLATION)

When an agent is spawned from the Synapse Electron app's chat view, its system prompt contains a `DASHBOARD ID:` directive identifying the dashboard bound to that chat. This is **always authoritative** and the agent uses it unconditionally.

Each chat view in the Electron app is associated with exactly one dashboard. The agent spawned from that chat writes to that specific dashboard so the user sees the swarm in the correct panel.

**Rules for pre-assigned dashboards:**
- **ALWAYS use this dashboard** — regardless of whether it is empty, full, or has an active swarm.
- **The agent has NO read or write access to any other dashboard.** Other dashboards do not exist for this agent.
- **If the dashboard is empty** — proceed directly to set up the new dashboard.
- **If the dashboard has previous data** — the agent **asks the user** if they want to archive it and set up the new dashboard. The agent does NOT proceed without explicit user approval. If the user declines, the agent stops.
- **Never "find the next free dashboard."** Ask the user, archive if approved, and reuse.

```
System prompt contains:  DASHBOARD ID: a1b2c3
Dashboard is empty:      Proceed directly
Dashboard has data:      Ask user → Archive → Clear → Reuse a1b2c3
User declines:           Stop. Do not proceed.
```

### Priority 2: Explicit `--dashboard` Flag

The user can force a specific dashboard with a command-line flag:

```
!p_track --dashboard a1b2c3 Implement user authentication
```

This bypasses auto-selection and uses `a1b2c3` directly. If the specified dashboard is currently in use (has agents that are `pending` or `in_progress`), Synapse warns the user and requires confirmation before overwriting.

### No Auto-Selection. No Scanning.

Every agent MUST have a dashboard assigned — either via system prompt (`DASHBOARD ID:` directive) or via `--dashboard` flag. There is no scanning or auto-selection algorithm. If an agent has no assigned dashboard and no `--dashboard` flag, it asks the user which dashboard to use.

---

## Dashboard Resolution for Read Commands

Used by read commands (`!status`, `!logs`, `!inspect`, `!deps`) when no specific dashboard is given.

**Rule:** Use your assigned dashboard from the `DASHBOARD ID:` directive in your system prompt. You have no access to any other dashboard. This applies to both read and write commands. If no assignment exists and no explicit ID was provided, ask the user.

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
!status                         → use your assigned dashboard
!status a1b2c3                  → explicit: a1b2c3
!inspect 2.3                    → use your assigned dashboard + task_id "2.3"
!inspect a1b2c3 2.3             → explicit: a1b2c3 + task_id "2.3"
!logs --level error             → use your assigned dashboard + filter
!logs a1b2c3 --level error      → explicit: a1b2c3 + filter
```

**Parsing rule:** If the first argument matches a dashboard ID format (6-character hex string), consume it as `{dashboardId}`. Otherwise, use your assigned dashboard. Task IDs use `N.N` format and flags start with `--`, so there is no ambiguity.

---

## Worker Dashboard Routing

The master includes the dashboard ID in every worker dispatch prompt:

```
Write your progress to: {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

Every worker receives:
- `{tracker_root}` — where to write progress files
- `{dashboardId}` — which dashboard to write to (6-character hex string)
- `{task_id}` — which progress file to create
- `{project_root}` — where to do code work

Workers write exactly where instructed.

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
