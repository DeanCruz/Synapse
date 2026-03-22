# Multi-Dashboard Architecture

Synapse supports up to **5 concurrent agent swarms** through its multi-dashboard system. Each dashboard slot operates independently with its own plan data, event logs, and worker progress files. Different dashboards can even serve different projects simultaneously, enabling true parallel orchestration across multiple workstreams.

---

## Core Concepts

### Dashboard Slots

Synapse provides 5 fixed dashboard slots, named `dashboard1` through `dashboard5`. Each slot is a self-contained environment for a single swarm:

```
{tracker_root}/dashboards/
├── dashboard1/
│   ├── initialization.json    # Static plan data (written once by master)
│   ├── logs.json              # Timestamped event log
│   └── progress/              # Worker-owned progress files
├── dashboard2/
│   └── ...
├── dashboard3/
│   └── ...
├── dashboard4/
│   └── ...
└── dashboard5/
    └── ...
```

Each slot contains three data stores:

| File / Directory | Purpose | Written By |
|---|---|---|
| `initialization.json` | Static plan — task metadata, agents, waves, chains | Master agent (write-once) |
| `logs.json` | Timestamped event log (`entries[]` array) | Master agent |
| `progress/` | Per-agent lifecycle files (`{task_id}.json`) | Worker agents (each owns its file) |

### Independence Between Dashboards

Each dashboard is fully isolated:

- **No shared state.** Dashboard 1's swarm has no knowledge of Dashboard 3's swarm.
- **No shared files.** Each dashboard's `initialization.json`, `logs.json`, and `progress/` directory are independent.
- **Different projects allowed.** Dashboard 1 might be running a swarm on Project A while Dashboard 4 runs one on Project B. The `task.project_root` field in `initialization.json` identifies which project each swarm targets.
- **Independent lifecycles.** One dashboard can be mid-execution while another is pending, completed, or empty.

### Dashboard States

A dashboard slot is always in one of these states:

| State | Condition | Description |
|---|---|---|
| **Empty** | `initialization.json` has `task: null` | No swarm assigned. Available for use. |
| **Planned** | `task` exists, no progress files | Plan written but workers not yet dispatched. Treated as available (stale claim). |
| **In Progress** | At least one agent is `pending` or `in_progress` | Active swarm execution. Dashboard is in use. |
| **Completed** | All agents are `completed` or `failed` | Swarm finished. Can be auto-cleared for reuse. |

---

## Data Flow

The multi-dashboard system follows this data flow during a swarm:

```
Master plans
    │
    ▼
Writes initialization.json to dashboards/{dashboardId}/
    │
    ▼
Workers dispatched — each writes to dashboards/{dashboardId}/progress/{task_id}.json
    │
    ▼
server.js watches each dashboard's progress/ directory via fs.watch
    │
    ▼
SSE broadcasts changes to the browser with the dashboard ID
    │
    ▼
Dashboard UI renders the selected dashboard's merged data
```

### Server Monitoring

The server (`src/server/index.js`) monitors all 5 dashboard directories simultaneously:

- **`fs.watchFile`** on each `initialization.json` and `logs.json` for plan and log changes (polling at 100ms intervals)
- **`fs.watch`** on each `progress/` directory for real-time worker updates
- **Periodic reconciliation** every 5 seconds to catch any file system events that `fs.watch` may have missed

When a change is detected, the server broadcasts an SSE event scoped to the specific dashboard that changed. The browser client receives the event and updates only the relevant dashboard panel.

---

## Sidebar Navigation

The dashboard UI includes a sidebar listing all 5 dashboard slots. Each entry shows:

- **Dashboard name** (e.g., "Dashboard 1")
- **Task name** (if a swarm is active)
- **Status indicator** (empty, in progress, completed, error)
- **Progress count** (e.g., "7/12 tasks")

Clicking a sidebar entry switches the main view to that dashboard. The selected dashboard's data is rendered by merging its `initialization.json` (static plan) with its `progress/` files (dynamic lifecycle).

---

## Stat Derivation

All dashboard statistics are **derived at render time** from the progress files. Nothing is stored as a counter or aggregate:

| Stat | Derivation |
|---|---|
| Total | `agents.length` from `initialization.json` |
| Completed | Count of progress files with `status: "completed"` |
| In Progress | Count of progress files with `status: "in_progress"` |
| Failed | Count of progress files with `status: "failed"` |
| Pending | Total minus (Completed + In Progress + Failed) |
| Elapsed | `now - earliest started_at` (or `latest completed_at - earliest started_at` when all done) |

This derivation model means the master agent never needs to maintain counters. Workers simply write their progress files, and the dashboard computes everything on the fly.

---

## Multi-Project Support

Each dashboard can serve a different project. When a swarm starts, the resolved `{project_root}` is stored in `initialization.json` at `task.project_root`. This field tells the dashboard and commands which project the swarm belongs to.

**Example:** Running three concurrent swarms across two projects:

| Dashboard | Project | Task |
|---|---|---|
| dashboard1 | `/Users/dean/repos/frontend-app` | Refactor auth flow |
| dashboard2 | `/Users/dean/repos/frontend-app` | Add dark mode |
| dashboard3 | `/Users/dean/repos/api-server` | Migrate to PostgreSQL |
| dashboard4 | *(empty)* | *(available)* |
| dashboard5 | *(empty)* | *(available)* |

Commands like `!status`, `!logs`, and `!inspect` auto-detect the active dashboard regardless of which project it serves.

---

## Related Documentation

- [Dashboard Selection](./dashboard-selection.md) — How Synapse chooses which dashboard to use
- [Queue System](./queue-system.md) — What happens when all dashboards are busy
- [Archive and History](./archive-history.md) — Preserving swarm data after completion

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/server/services/DashboardService.js` | Dashboard directory operations, listing, reading, clearing |
| `src/server/utils/constants.js` | Path constants (`DASHBOARDS_DIR`, `QUEUE_DIR`, etc.) |
| `src/server/index.js` | SSE server with multi-dashboard file watching |
| `agent/instructions/dashboard_resolution.md` | Full dashboard resolution protocol |
