# Data Architecture Overview

Synapse uses a **file-based data architecture** with no database. All state is stored as JSON files on disk, watched by the server for changes, and broadcast to the dashboard via Server-Sent Events (SSE). This design eliminates external dependencies and keeps the system fully portable.

---

## Core Design Principles

### File-Based, Not Database-Backed

Every piece of data in Synapse lives in a plain JSON file. The server reads files on change, parses them, and pushes updates over SSE. There is no database, no ORM, no migration system. This means:

- Zero npm dependencies for the server
- Data is human-readable and editable
- Backup is a directory copy
- No connection pools, no schema migrations, no query language

### Separation of Static Plan vs Dynamic Lifecycle

Synapse cleanly separates two categories of data:

| Category | File | Owner | Write Pattern | Contents |
|---|---|---|---|---|
| **Static plan** | `initialization.json` | Master agent | Write-once | Task metadata, agent definitions, wave structure, chain layout |
| **Dynamic lifecycle** | `progress/{task_id}.json` | Worker agents | Write-on-every-update | Status, timing, stage, milestones, deviations, logs |
| **Event log** | `logs.json` | Master agent | Append-only (via read-modify-write) | Timestamped orchestration events |

The dashboard merges these two sources client-side to produce the combined view. This separation means the master agent writes `initialization.json` once during planning and never touches it again (with one exception: repair task creation after failures). Workers own all lifecycle data in their individual progress files.

### Derived Stats, Not Maintained Counters

The dashboard computes **all statistics** from progress files at render time:

- **Completed count**: Count of progress files where `status === "completed"`
- **Failed count**: Count of progress files where `status === "failed"`
- **In-progress count**: Count of progress files where `status === "in_progress"`
- **Pending count**: `total_tasks - completed - in_progress - failed`
- **Elapsed time**: Earliest worker `started_at` to latest worker `completed_at`
- **Wave status**: Derived from the statuses of agents within each wave
- **Overall status**: Derived from the combination of all agent statuses

No counters are stored anywhere. This eliminates an entire class of consistency bugs where counters drift out of sync with actual state.

---

## Data Files and Ownership

### Per-Dashboard Files

Each dashboard instance (`dashboard1` through `dashboard5`) contains:

```
{tracker_root}/dashboards/{dashboardId}/
  initialization.json     -- Static plan data (master-owned, write-once)
  logs.json               -- Event log (master-owned, append-only)
  progress/               -- Worker progress files (worker-owned)
    1.1.json
    1.2.json
    2.1.json
    ...
```

### Ownership Model

Synapse enforces strict file ownership. Each file has exactly one writer:

| File | Writer | Read By |
|---|---|---|
| `initialization.json` | Master agent (write-once during planning) | Dashboard, master (for dispatch scans), workers (optional) |
| `logs.json` | Master agent (append via read-modify-write) | Dashboard (log panel) |
| `progress/{task_id}.json` | The worker assigned to that task (sole writer) | Dashboard (agent cards, stats), master (for dispatch scans) |
| `tasks/{date}/parallel_{name}.xml` | Master agent | Workers (for context), master (for status tracking) |
| `tasks/{date}/parallel_plan_{name}.md` | Master agent | Users (for plan review) |

Workers never write to `initialization.json` or `logs.json`. The master never writes to `progress/` files. This eliminates all write conflicts.

### Default State

When a dashboard has no active swarm, files contain default empty state:

```json
// initialization.json (empty)
{ "task": null, "agents": [], "waves": [], "chains": [], "history": [] }

// logs.json (empty)
{ "entries": [] }

// progress/ directory is empty (no files)
```

These defaults are defined in `src/server/utils/constants.js`:

```javascript
const DEFAULT_INITIALIZATION = { task: null, agents: [], waves: [], chains: [], history: [] };
const DEFAULT_LOGS = { entries: [] };
```

---

## Data Flow

### Write Flow

```
1. Master plans the swarm
   |-> Writes initialization.json (full plan, write-once)
   |-> Writes logs.json (initialization entry)
   |-> Clears progress/ directory

2. Master dispatches workers
   |-> Appends dispatch entries to logs.json

3. Workers execute tasks
   |-> Each worker writes progress/{task_id}.json on every update
   |-> Workers do code work in {project_root}
   |-> Workers write progress to {tracker_root}

4. Master monitors completions
   |-> Reads progress/ files to build completed/in-progress sets
   |-> Appends completion/failure/deviation entries to logs.json
   |-> Updates XML task file with summaries

5. Swarm completes
   |-> Master appends final summary to logs.json
   |-> Master updates XML with final status
```

### Read Flow (Dashboard)

```
Server watches files:
  initialization.json  -- fs.watchFile (polling at 100ms)
  logs.json            -- fs.watchFile (polling at 100ms)
  progress/            -- fs.watch (OS-level directory events)

On change:
  Server reads the full file
  Server validates the JSON
  Server broadcasts via SSE to all connected clients

Dashboard receives SSE events:
  mergeState(initialization, progress) combines static + dynamic data
  React re-renders with merged state
```

### The mergeState Function

The `mergeState` function in `src/ui/hooks/useDashboardData.js` is the core data merge logic. It takes the static plan data from `initialization.json` and the dynamic progress data from all progress files, and produces a single renderable state object.

**Source:** `{tracker_root}/src/ui/hooks/useDashboardData.js`

```javascript
export function mergeState(init, progress) {
  // 1. If no init or no task, return empty state
  if (!init || !init.task) {
    return { active_task: null, agents: [], waves: [], chains: [], history: [] };
  }

  // 2. Copy task metadata from init
  const task = { ...init.task };

  // 3. For each agent in init.agents[]:
  //    - Look up progress[agentId]
  //    - Merge static fields (id, title, wave, layer, directory, depends_on)
  //      with dynamic fields (status, assigned_agent, started_at, completed_at,
  //      summary, stage, message, milestones, deviations, logs)
  //    - If no progress file exists, status defaults to "pending"
  const agents = (init.agents || []).map(agentDef => {
    const prog = progress[agentDef.id];
    return {
      // Static fields from initialization.json
      id: agentDef.id,
      title: agentDef.title,
      wave: agentDef.wave,
      layer: agentDef.layer || null,
      directory: agentDef.directory || null,
      depends_on: agentDef.depends_on || [],
      // Dynamic fields from progress file (or defaults)
      status: prog ? prog.status : 'pending',
      assigned_agent: prog ? prog.assigned_agent : null,
      started_at: prog ? prog.started_at : null,
      completed_at: prog ? prog.completed_at : null,
      summary: prog ? prog.summary : null,
      stage: prog ? prog.stage : null,
      message: prog ? prog.message : null,
      milestones: prog ? prog.milestones : [],
      deviations: prog ? prog.deviations : [],
      logs: prog ? prog.logs : [],
    };
  });

  // 4. Derive stats from merged agents
  let completed = 0, failed = 0, inProgress = 0;
  agents.forEach(a => {
    if (a.status === 'completed') completed++;
    else if (a.status === 'failed') failed++;
    else if (a.status === 'in_progress') inProgress++;
  });
  task.completed_tasks = completed;
  task.failed_tasks = failed;

  // 5. Derive timing
  const startTimes = agents.filter(a => a.started_at).map(a => new Date(a.started_at).getTime());
  if (startTimes.length > 0) task.started_at = new Date(Math.min(...startTimes)).toISOString();

  // 6. Derive overall status
  const allDone = agents.length > 0 && agents.every(a =>
    a.status === 'completed' || a.status === 'failed');
  if (allDone) {
    const endTimes = agents.filter(a => a.completed_at).map(a => new Date(a.completed_at).getTime());
    if (endTimes.length > 0) task.completed_at = new Date(Math.max(...endTimes)).toISOString();
    task.overall_status = failed > 0 ? 'completed_with_errors' : 'completed';
  } else if (inProgress > 0 || completed > 0) {
    task.overall_status = 'in_progress';
  }

  // 7. Derive wave status from agents within each wave
  const waves = (init.waves || []).map(waveDef => {
    const waveAgents = agents.filter(a => a.wave === waveDef.id);
    const waveCompleted = waveAgents.filter(a => a.status === 'completed').length;
    const anyActive = waveAgents.some(a =>
      ['in_progress','completed','failed'].includes(a.status));
    return {
      id: waveDef.id, name: waveDef.name,
      total: waveDef.total || waveAgents.length,
      completed: waveCompleted,
      status: (waveCompleted === waveAgents.length && waveAgents.length > 0)
        ? 'completed' : anyActive ? 'in_progress' : 'pending',
    };
  });

  return { active_task: task, agents, waves, chains: init.chains || [], history: init.history || [] };
}
```

This merge happens entirely client-side. The server never combines these data sources; it pushes them independently and the React frontend merges on every state change.

---

## Persistence Locations

### Active Data (per dashboard)

| Path | Purpose | Lifecycle |
|---|---|---|
| `dashboards/{dashboardId}/initialization.json` | Current swarm plan | Overwritten when a new swarm starts |
| `dashboards/{dashboardId}/logs.json` | Current swarm event log | Overwritten when a new swarm starts |
| `dashboards/{dashboardId}/progress/*.json` | Worker progress files | Cleared when a new swarm starts |

### Historical Data

| Path | Purpose | Contents |
|---|---|---|
| `history/{name}_{date}.json` | Summary snapshots of completed swarms | Task metadata, agent summaries, timing, counts (no full progress data) |
| `Archive/{YYYY-MM-DD}_{task_name}/` | Full archived dashboard snapshots | Complete copy: `initialization.json`, `logs.json`, `progress/*.json` |

The distinction is important:

- **History files** are lightweight summaries. They contain task metadata, agent results (id, title, wave, status, summary, timing), and aggregate counts but no milestone/deviation/log detail from progress files. They are created when a swarm completes and moved to history.
- **Archive files** are full copies of the entire dashboard directory, preserved when the master archives a dashboard before starting a new swarm. Archives contain the complete progress files with full milestone, deviation, and log data. The archive-before-clear protocol is **non-negotiable** -- previous swarm data is never discarded, only archived.

### History File Example

From `history/2026-03-21_estate-crm-frontend.json`:

```json
{
  "task_name": "estate-crm-frontend",
  "task_type": "Waves",
  "project": "RE_CRM",
  "directory": "src/app",
  "prompt": "Build all 7 frontend pages for the Estate Sales CRM...",
  "overall_status": "completed",
  "total_tasks": 9,
  "completed_tasks": 9,
  "failed_tasks": 0,
  "in_progress_tasks": 0,
  "pending_tasks": 0,
  "total_waves": 4,
  "started_at": "2026-03-18T05:31:04.000Z",
  "completed_at": "2026-03-18T05:50:11.000Z",
  "duration": "19m 7s",
  "cleared_at": "2026-03-21T21:19:27.591Z",
  "dashboard_id": "dashboard1",
  "agents": [
    {
      "id": "1.1",
      "title": "App Shell + Sidebar Navigation",
      "wave": 1,
      "status": "completed",
      "assigned_agent": "Agent 1",
      "started_at": "2026-03-18T05:31:04Z",
      "completed_at": "2026-03-18T05:33:35Z",
      "summary": "Created app shell with persistent sidebar navigation..."
    }
  ],
  "log_count": 30
}
```

### Archive Directory Structure

```
Archive/
  2026-03-22_estate-crm-frontend/
    initialization.json     -- Full plan data
    logs.json               -- Complete event log
    progress/               -- All worker progress files
      1.1.json
      2.1.json
      2.2.json
      ...
```

### Task Records

| Path | Purpose |
|---|---|
| `tasks/{MM_DD_YY}/parallel_{name}.xml` | Authoritative task record with full context, descriptions, dependencies, and completion summaries |
| `tasks/{MM_DD_YY}/parallel_plan_{name}.md` | Strategy rationale document explaining the plan |

---

## Server File Watching

The server uses two different watching mechanisms, defined in `src/server/utils/constants.js`:

| Mechanism | Used For | Constant | Value | Behavior |
|---|---|---|---|---|
| `fs.watchFile` (polling) | `initialization.json`, `logs.json` | `INIT_POLL_MS` | 100ms | Polls at fixed intervals; reliable across all platforms |
| `fs.watch` (OS events) | `progress/` directory | N/A | OS-level | Immediate notification on file changes; more efficient |

When a progress file changes, the server applies:
1. An initial read delay (`PROGRESS_READ_DELAY_MS` = 30ms) to let the write settle
2. A retry on parse failure (`PROGRESS_RETRY_MS` = 80ms) if the file was mid-write

This ensures atomic reads of complete JSON even during rapid worker updates.

### Reconciliation

A periodic reconciliation scan provides a safety net:

| Constant | Value | Purpose |
|---|---|---|
| `RECONCILE_INTERVAL_MS` | 5000ms | Full scan interval for all progress files |
| `RECONCILE_DEBOUNCE_MS` | 300ms | Debounce on rapid directory changes |

This catches any file changes that OS-level watchers might miss (edge cases on network filesystems or rapid successive writes).

### SSE Broadcasting

| Constant | Value | Purpose |
|---|---|---|
| `HEARTBEAT_MS` | 15000ms | SSE heartbeat ping to keep connections alive |
| `DEPENDENCY_CHECK_DELAY_MS` | 100ms | Delay after completion before running dependency check |

---

## Multi-Dashboard Architecture

Synapse supports up to 5 concurrent dashboards, each an independent swarm with its own data:

```
dashboards/
  dashboard1/
    initialization.json
    logs.json
    progress/
  dashboard2/
    ...
  dashboard3/
    ...
  dashboard4/
    ...
  dashboard5/
    ...
```

Each dashboard can serve a different project simultaneously. The `task.project_root` field in `initialization.json` identifies which project each swarm belongs to.

The server watches all 5 dashboards independently, broadcasting SSE events tagged with `dashboardId` so the client routes updates to the correct dashboard view. The sidebar shows status dots (idle, in_progress, completed, error) for each dashboard, derived from its progress files.

---

## Related Documentation

- [initialization.json Schema](./initialization-json.md) -- Complete schema, field-to-UI mapping, write rules
- [logs.json Schema](./logs-json.md) -- Event log format, levels, entry structure
- [Progress Files Schema](./progress-files.md) -- Worker progress lifecycle, stages, rendering
- [XML Task Files](./xml-task-files.md) -- Authoritative task record format and structure
