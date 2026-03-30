# Dashboard Resolution Protocol

**Purpose:** Shared reference for how all commands resolve `{id}`, derive swarm status, and read dashboard data. Every command that interacts with dashboard data references this file.

---

## Data Paths

All dashboard data lives under `{tracker_root}/dashboards/{id}/`:

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
| `{tracker_root}/tasks/{date}/` | Master task and plan files |

---

## Parameter Parsing

All commands accept an optional `{id}` as the **first positional argument**.

**Rule:** If the first argument is a valid dashboard ID (any non-flag string that is not a task ID), consume it as `{id}`. Otherwise, use your assigned dashboard. Valid IDs include `ide`, 6-char hex strings (e.g., `a3f7k2`), and legacy `dashboardN` format.

```
!status                     → use your assigned dashboard
!status a3f7k2              → explicit: a3f7k2
!inspect 2.3                → use your assigned dashboard + task_id "2.3"
!inspect a3f7k2 2.3         → explicit: a3f7k2 + task_id "2.3"
!logs --level error         → use your assigned dashboard + filter
!logs ide --level error     → explicit: ide + filter
```

Task IDs use `N.N` format (e.g., `2.3`), flags start with `--` — neither conflicts with dashboard IDs.

---

## Dashboard Resolution for Read Commands

Used by read commands (`!status`, `!logs`, `!inspect`, `!deps`) when no explicit dashboard ID is given.

**Rule:** If your system prompt contains a `DASHBOARD ID:` directive, use that dashboard. You have no access to any other dashboard. This applies to both read and write commands.

---

## Dashboard Claiming — `selectDashboard()`

Used by `!p_track` when starting a new swarm. The master must claim a dashboard before writing `initialization.json`.

**Resolution order (first match wins):**

### 1. Pre-assigned dashboard (highest priority) — MANDATORY ISOLATION

When an agent is spawned from the Synapse chat view, its system prompt contains a `DASHBOARD ID:` directive identifying the dashboard bound to that chat. **This binding is absolute and unconditional.**

**Rules for pre-assigned dashboards:**

- **ALWAYS use this dashboard.** No scanning. No auto-selection. No fallback. No exceptions.
- **You have NO read or write access to any other dashboard.** Treat all other dashboards as if they do not exist. Never scan, read, query, or write to any dashboard other than your assigned one.
- **If the dashboard is empty** (`initialization.json` has `task: null` or does not exist) — proceed directly to set up the new dashboard.
- **If the dashboard contains previous data** (i.e., `initialization.json` has `task` not `null`), **you MUST ask the user before proceeding.** Present the current state and wait for explicit approval:

  ```markdown
  ## Dashboard {id} has an existing task

  | Field | Value |
  |---|---|
  | Task | {task.name} |
  | Status | {derived overall status} |
  | Progress | {completed}/{total} agents done |

  Would you like me to archive this dashboard and set up the new one?
  ```

  **Wait for the user's answer.** Do NOT proceed until approved.
  - **If yes:** follow the archive protocol in Step 11A of `p_track_planning.md`:
    1. Copy the full dashboard contents to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`
    2. Delete all progress files (`rm -f {tracker_root}/dashboards/{id}/progress/*.json`)
    3. Reset `initialization.json` and `logs.json` to empty state
    4. Proceed with setting up the new dashboard
  - **If no:** **stop.** Do not proceed with the swarm. The user may want to resume the existing task or cancel it first.
- **Never "find the next free dashboard."** Your dashboard is your dashboard. Ask the user, archive if approved, and reuse.

Each chat view in the Synapse Electron app is associated with exactly one dashboard. The agent spawned from that chat must write to that dashboard so the user sees the swarm in the correct panel.

### 2. Explicit `--dashboard` flag

`!p_track --dashboard a3f7k2 {prompt}` uses `a3f7k2` directly. If it's in use, warn and require confirmation.

### No auto-selection. No scanning. No fallback.

Every agent MUST have a dashboard assigned — either via system prompt (`DASHBOARD ID:` directive) or via `--dashboard` flag. There is no scanning or auto-selection algorithm. If you have no assigned dashboard and no `--dashboard` flag, ask the user which dashboard to use. Never scan dashboards to find an available one.

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

## IDE Dashboard Protocol

The `ide` dashboard is permanently reserved for the IDE agent:

- **Always exists** — auto-created on Electron app startup via `ensureIdeDashboard()`
- **Cannot be deleted** — `DashboardService.deleteDashboard('ide')` returns false
- **Exclusively bound to IDE chat views** — IDE chat views bind to `ide` via the system prompt `DASHBOARD ID: ide`
- **Never used by swarm agents** — swarm agents use their own assigned dashboard only

---

## Worker Dashboard Routing

Workers must know their `{id}` to write progress files to the correct location. The master includes the dashboard ID in every worker dispatch prompt:

```
Write your progress to: {tracker_root}/dashboards/{id}/progress/{task_id}.json
```

Workers write exactly where the master tells them to.
