# Synapse Data Flow

This document describes how data flows through Synapse from the moment a swarm is planned to the final rendering of real-time updates on the dashboard. It covers the three main data flows: planning, execution, and rendering.

---

## Table of Contents

- [High-Level Data Flow](#high-level-data-flow)
- [Planning Phase](#planning-phase)
- [Execution Phase](#execution-phase)
- [Rendering Phase](#rendering-phase)
- [File Watching Mechanisms](#file-watching-mechanisms)
- [Transport Layer Details](#transport-layer-details)
- [Client-Side State Merge](#client-side-state-merge)
- [Dependency Resolution Flow](#dependency-resolution-flow)
- [Circuit Breaker and Replanning Flow](#circuit-breaker-and-replanning-flow)
- [Dashboard Switching Flow](#dashboard-switching-flow)
- [Startup Flow](#startup-flow)

---

## High-Level Data Flow

```
Master Agent                    File System                   Server/IPC              Dashboard UI
    |                               |                            |                        |
    |-- writes init.json ---------> |                            |                        |
    |                               |-- fs.watchFile detects --> |                        |
    |                               |                            |-- SSE/IPC push ------> |
    |                               |                            |                        |-- mergeState()
    |                               |                            |                        |-- renders cards
    |                               |                            |                        |
    |-- dispatches workers          |                            |                        |
    |                               |                            |                        |
Workers execute tasks               |                            |                        |
    |                               |                            |                        |
    |-- write progress/*.json ----> |                            |                        |
    |                               |-- fs.watch detects ------> |                        |
    |                               |                            |-- SSE/IPC push ------> |
    |                               |                            |                        |-- mergeState()
    |                               |                            |                        |-- updates cards
    |                               |                            |                        |
Master logs events                  |                            |                        |
    |                               |                            |                        |
    |-- appends to logs.json -----> |                            |                        |
    |                               |-- fs.watchFile detects --> |                        |
    |                               |                            |-- SSE/IPC push ------> |
    |                               |                            |                        |-- updates log panel
```

---

## Planning Phase

The planning phase is where the master agent transforms a user request into a structured execution plan.

### Data Flow

```
User prompt
    |
    v
Master reads context:
  - {tracker_root}/CLAUDE.md (Synapse instructions)
  - {project_root}/CLAUDE.md (project conventions)
  - {project_root}/.synapse/toc.md (optional file index)
  - Source files via Glob/Grep/Read tools
    |
    v
Master decomposes task into agents with dependencies
    |
    v
Master writes plan files:
    |
    +-- {tracker_root}/dashboards/{dashboardId}/initialization.json  (static plan)
    +-- {tracker_root}/dashboards/{dashboardId}/logs.json            (initial log entry)
    +-- {tracker_root}/tasks/{date}/parallel_{name}.json              (task record)
    +-- {tracker_root}/tasks/{date}/parallel_plan_{name}.md          (strategy rationale)
```

### initialization.json Structure

This file is the static plan data store, written once during planning. It contains all information needed to render the dashboard before any work begins:

```json
{
  "task": {
    "name": "Add user authentication",
    "type": "Waves",
    "directory": "src/",
    "prompt": "Original user prompt...",
    "project": "my-app",
    "project_root": "/Users/dev/repos/my-app",
    "created": "2026-03-22T10:00:00Z",
    "total_tasks": 8,
    "total_waves": 3
  },
  "agents": [
    {
      "id": "1.1",
      "title": "Create auth middleware",
      "wave": 1,
      "layer": null,
      "directory": "src/middleware/",
      "depends_on": [],
      "description": "Full task description with context..."
    },
    {
      "id": "1.2",
      "title": "Create user model",
      "wave": 1,
      "layer": null,
      "directory": "src/models/",
      "depends_on": []
    },
    {
      "id": "2.1",
      "title": "Create auth routes",
      "wave": 2,
      "layer": null,
      "directory": "src/routes/",
      "depends_on": ["1.1", "1.2"]
    }
  ],
  "waves": [
    { "id": 1, "name": "Foundation", "total": 3 },
    { "id": 2, "name": "Integration", "total": 3 },
    { "id": 3, "name": "Verification", "total": 2 }
  ],
  "chains": [],
  "history": []
}
```

**Key rule:** `initialization.json` is write-once. The master never updates it after the planning phase. The only exception is when the circuit breaker triggers automatic replanning, which updates the agent list and wave definitions.

### logs.json Structure

The event log is append-only, with each entry becoming a row in the dashboard log panel:

```json
{
  "entries": [
    {
      "timestamp": "2026-03-22T10:00:00Z",
      "task_id": null,
      "agent": "master",
      "level": "info",
      "message": "Swarm initialized — 8 tasks across 3 waves",
      "task_name": null
    }
  ]
}
```

**Log levels:** `info`, `warn`, `error`, `debug`, `permission`, `deviation`

---

## Execution Phase

### Worker Dispatch Flow

```
Master identifies ready tasks (no unsatisfied dependencies)
    |
    v
For each ready task, master spawns a worker agent:
  - Via Task tool (CLI/terminal mode)
  - Via SwarmOrchestrator -> ClaudeCodeService (Electron mode)
    |
    v
Worker receives self-contained prompt containing:
  - Task description and success criteria
  - {tracker_root} (for progress reporting)
  - {project_root} (for code work)
  - {dashboardId} (for progress file path)
  - Project conventions from CLAUDE.md
  - Relevant code snippets
  - Upstream task results (if task has dependencies)
    |
    v
Worker begins execution
```

### Worker Progress Reporting

Each worker owns exactly one file: `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`

```
Worker starts
    |
    v
Write initial progress file:
  { status: "in_progress", stage: "reading_context", started_at: "..." }
    |
    v
Read upstream dependency progress files (if applicable)
    |
    v
Progress through stages, writing file on each transition:
  reading_context -> planning -> implementing -> testing -> finalizing
    |
    v
Write final progress file:
  { status: "completed", stage: "completed", completed_at: "...", summary: "..." }
```

### Progress File Structure

```json
{
  "task_id": "2.1",
  "status": "in_progress",
  "started_at": "2026-03-22T10:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 3",
  "stage": "implementing",
  "message": "Creating auth routes -- 2/4 endpoints done",
  "milestones": [
    { "at": "2026-03-22T10:05:10Z", "msg": "Read CLAUDE.md and upstream results" },
    { "at": "2026-03-22T10:05:45Z", "msg": "Created POST /auth/login endpoint" },
    { "at": "2026-03-22T10:06:20Z", "msg": "Created POST /auth/register endpoint" }
  ],
  "deviations": [
    {
      "at": "2026-03-22T10:06:30Z",
      "severity": "MODERATE",
      "description": "Used bcryptjs instead of argon2 -- bcryptjs was already in package.json"
    }
  ],
  "logs": [
    { "at": "2026-03-22T10:05:00Z", "level": "info", "msg": "Starting task" },
    { "at": "2026-03-22T10:05:10Z", "level": "info", "msg": "Read upstream 1.1 (completed, no deviations)" },
    { "at": "2026-03-22T10:06:30Z", "level": "deviation", "msg": "Using bcryptjs instead of argon2" }
  ]
}
```

### Worker-to-Dashboard Update Latency

The path from a worker writing a file to the dashboard updating:

```
Worker writes progress/{task_id}.json
    |  (~0ms)
    v
fs.watch detects filesystem event (progress/ directory)
    |  (~30ms - PROGRESS_READ_DELAY_MS)
    v
WatcherService reads and validates the JSON file
    |  (~80ms retry if mid-write - PROGRESS_RETRY_MS)
    v
broadcastFn called with parsed data
    |  (~0ms)
    v
SSE event sent to connected clients OR IPC event sent to renderer
    |  (~0ms)
    v
useDashboardData handler updates React state
    |  (~16ms - next React render)
    v
Dashboard UI reflects the change

Total: ~50-150ms from write to visual update
```

---

## Rendering Phase

### Client-Side State Merge

The dashboard does not receive a single combined data structure. Instead, it receives two separate data sources and merges them on every update:

```
initialization.json (static plan)     progress/*.json (dynamic lifecycle)
        |                                       |
        v                                       v
    { task, agents[], waves[] }         { task_id -> progress data }
        |                                       |
        +------- mergeState() ---------+
                     |
                     v
        {
          active_task: { ...task, completed_tasks, failed_tasks, overall_status },
          agents: [{ ...planData, ...progressData }],
          waves: [{ ...waveDef, completed, status }],
          chains: [...],
          history: [...]
        }
```

The `mergeState()` function (in `useDashboardData.js`) performs this merge:

1. **For each agent defined in `initialization.json`**, look up its progress data by `task_id`
2. **Overlay progress fields** (`status`, `stage`, `message`, `milestones`, `deviations`, `logs`, `started_at`, `completed_at`, `summary`, `assigned_agent`) onto the static plan fields (`id`, `title`, `wave`, `layer`, `directory`, `depends_on`)
3. **Derive aggregate stats** from the merged agent list:
   - `completed_tasks` = count of agents with status `"completed"`
   - `failed_tasks` = count of agents with status `"failed"`
   - `started_at` = earliest worker `started_at` timestamp
   - `completed_at` = latest worker `completed_at` (only when all done)
   - `overall_status` = derived from agent statuses (`pending` | `in_progress` | `completed` | `completed_with_errors`)
4. **Derive wave status** from the agents in each wave:
   - `completed` count per wave
   - `status` = `pending` | `in_progress` | `completed`

This separation of concerns means the master only writes the plan once, workers only write their own progress, and the dashboard derives everything else.

### React State Flow

```
IPC/SSE Event arrives
    |
    v
useDashboardData listener dispatches action to AppContext
    |
    v
appReducer processes action, returns new state
    |
    v
useEffect detects currentInit or currentProgress change
    |
    v
mergeState(currentInit, currentProgress) called
    |
    v
Merged result dispatched as SET_STATUS action
    |
    v
Components re-render with new merged state:
  - StatsBar reads active_task for counters
  - WavePipeline/ChainPipeline reads agents[] and waves[]
  - AgentCard reads individual agent status/stage/message
  - LogPanel reads logs from currentLogs
```

---

## File Watching Mechanisms

Synapse uses two different file watching strategies, chosen based on the update pattern of each file:

### fs.watch (Event-Based)

Used for the `progress/` directory. Provides near-instant notification when files are created or modified.

```
fs.watch(progressDir, (eventType, filename) => {
    // Fires immediately on any filesystem event
    // ~30ms read delay to avoid reading mid-write
    // ~80ms retry if JSON parse fails (file still being written)
})
```

**Why fs.watch for progress files:** Workers write their progress files frequently (on every stage transition, milestone, etc.). The event-based approach provides minimal latency. The small read delay and retry logic handle the atomic write race condition.

### fs.watchFile (Polling)

Used for `initialization.json` and `logs.json`. Polls at 100ms intervals.

```
fs.watchFile(initFile, { interval: 100 }, (curr, prev) => {
    // Fires every 100ms if mtime has changed
    if (curr.mtimeMs === prev.mtimeMs) return;
    // Read and broadcast
})
```

**Why fs.watchFile for init/logs:** These files are updated less frequently (init is write-once; logs are appended on events). Polling provides reliable cross-platform detection. The 100ms interval balances responsiveness with CPU usage.

### Periodic Reconciliation

A fallback mechanism that runs every 5 seconds to catch any `fs.watch` events that may have been dropped (a known limitation on some platforms):

```
setInterval(() => {
    for each dashboard:
        scan progress/ directory
        compare file mtimes against last known values
        broadcast any files that changed since last check
}, 5000)
```

### Timing Constants

| Constant | Value | Purpose |
|---|---|---|
| `INIT_POLL_MS` | 100ms | Polling interval for `initialization.json` and `logs.json` |
| `PROGRESS_READ_DELAY_MS` | 30ms | Delay before reading a changed progress file |
| `PROGRESS_RETRY_MS` | 80ms | Retry delay if progress file JSON is malformed |
| `RECONCILE_DEBOUNCE_MS` | 300ms | Debounce for dashboard directory reconciliation |
| `RECONCILE_INTERVAL_MS` | 5000ms | Periodic reconciliation scan interval |
| `HEARTBEAT_MS` | 15000ms | SSE heartbeat interval |
| `DEPENDENCY_CHECK_DELAY_MS` | 100ms | Delay before running dependency check after task completion |

---

## Transport Layer Details

### SSE (Server-Sent Events) — Browser Mode

The SSE connection provides a unidirectional push channel from server to client.

**Connection lifecycle:**

```
Client -> GET /events
    |
    v
Server sends initial burst:
  1. dashboards_list        <- list of all dashboard IDs
  2. initialization         <- for each dashboard
  3. all_progress           <- for each dashboard
  4. init_state             <- combined init+progress+logs for reconnection
  5. queue_changed          <- current queue state
    |
    v
Server keeps connection open, sends events as files change:
  - initialization          <- init.json changed
  - logs                    <- logs.json changed
  - agent_progress          <- individual progress file changed
  - all_progress            <- bulk progress update
  - dashboards_changed      <- dashboard created/deleted
  - queue_changed           <- queue item added/removed
  - tasks_unblocked         <- dependency check found newly unblocked tasks
  - heartbeat               <- keepalive ping every 15s
```

**Event format (SSE protocol):**
```
event: agent_progress
data: {"dashboardId":"2d84ac","task_id":"1.1","status":"in_progress","stage":"implementing",...}

```

### IPC (Inter-Process Communication) — Electron Mode

In Electron mode, communication happens via Electron's IPC mechanism between the main process and the renderer.

**Push events** (main -> renderer via `webContents.send()`):

| Channel | Payload |
|---|---|
| `initialization` | `{ dashboardId, task, agents, waves, ... }` |
| `logs` | `{ dashboardId, entries }` |
| `agent_progress` | `{ dashboardId, task_id, status, stage, ... }` |
| `all_progress` | `{ dashboardId, [task_id]: progressData, ... }` |
| `dashboards_list` | `{ dashboards: ["2d84ac", ...] }` |
| `dashboards_changed` | `{ dashboards: ["2d84ac", ...] }` |
| `queue_changed` | `{ queue: [...] }` |
| `tasks_unblocked` | `{ dashboardId, completedTaskId, unblocked: [...] }` |
| `reload` | `{}` |
| `worker-output` | Worker stdout/stderr streaming data |
| `worker-complete` | Worker process exit notification |
| `worker-error` | Worker process error |
| `swarm-state` | `{ dashboardId, state }` — orchestrator state changes |

**Pull requests** (renderer -> main via `ipcRenderer.invoke()`):

Over 60 IPC methods are exposed through the preload context bridge, covering:
- Dashboard CRUD (get, create, delete, clear, archive, export)
- Data fetching (init, logs, progress per dashboard)
- Project management (select directory, load project, recent projects)
- Task editing (create swarm, add/update/remove tasks and waves)
- Worker management (spawn, kill, list active workers)
- Swarm orchestration (start, pause, resume, cancel, retry)
- Commands (list, get, save, delete, generate)
- Conversations (list, load, save, create, delete, rename)
- Settings (get, set, reset)
- File handling (save temp files, select images, read as base64)

### Electron Fetch Shim

The `main.jsx` entry point patches `window.fetch` to intercept `/api/*` calls in Electron mode:

```
Component calls fetch('/api/dashboards/2d84ac/initialization')
    |
    v
Patched fetch() detects /api/ prefix
    |
    v
Routes to IPC: window.electronAPI.getDashboardInit('2d84ac')
    |
    v
IPC handler reads file and returns data
    |
    v
Shim wraps response in fetch-compatible object:
  { ok: true, status: 200, json: () => Promise.resolve(data) }
```

This allows components to use standard `fetch()` calls that work in both browser and Electron modes.

---

## Dependency Resolution Flow

When a task completes, the system checks if any downstream tasks are now unblocked:

```
Worker writes progress file with status: "completed"
    |
    v
WatcherService detects change, reads file
    |
    v
After DEPENDENCY_CHECK_DELAY_MS (100ms):
    |
    v
DependencyService.computeNewlyUnblocked(dashboardId, completedTaskId)
    |
    v
Read initialization.json for the dependency graph
Read all progress files for current status
    |
    v
For each agent:
  - Skip if already completed, failed, or in_progress
  - Check if ALL depends_on tasks are completed
  - If yes: this task is newly unblocked
    |
    v
Broadcast 'tasks_unblocked' event with list of unblocked task IDs
    |
    v
SwarmOrchestrator.handleProgressUpdate() also fires:
  - In Electron mode, the broadcast function feeds progress updates
    to the orchestrator, which calls dispatchReady() to spawn
    workers for newly unblocked tasks
```

In CLI/terminal mode, the master agent manually scans for unblocked tasks after each completion and dispatches them. In Electron mode, the SwarmOrchestrator automates this loop.

---

## Circuit Breaker and Replanning Flow

When failures cascade, the circuit breaker triggers automatic replanning:

```
Task fails
    |
    v
SwarmOrchestrator.onTaskFailed(dashboardId, taskId)
    |
    v
Check circuit breaker conditions:
  1. 3+ failures in the same wave?
  2. This failure blocks 3+ downstream tasks?
  3. This failure blocks >50% of remaining tasks?
    |
    v
If any condition met:
    |
    v
Set swarm state to 'replanning'
    |
    v
Spawn Claude CLI process with --print mode
    Input: full context (completed, failed, errors, dependency graph, pending tasks)
    |
    v
Replanner analyzes root cause and returns JSON:
  {
    "summary": "Root cause analysis...",
    "modified": [...],     // existing tasks with updated descriptions/deps
    "added": [...],        // new repair tasks (suffixed with 'r')
    "removed": [...],      // tasks no longer viable
    "retry": [...]         // tasks to re-dispatch as-is
  }
    |
    v
applyReplan():
  1. Remove tasks from agents[] and clean depends_on references
  2. Modify existing task descriptions and dependencies
  3. Add new repair/replacement tasks
  4. Clear failed state for retry tasks, delete old progress files
  5. Update total_tasks count
  6. Write updated initialization.json
    |
    v
Resume swarm dispatch with revised plan
```

If the replanner fails (non-zero exit, invalid JSON), the swarm pauses for manual intervention.

---

## Dashboard Switching Flow

When the user switches between dashboards in the sidebar:

```
User clicks Dashboard 2 in sidebar
    |
    v
Dispatch SWITCH_DASHBOARD action
    |
    v
AppContext reducer:
  1. Stash current dashboard's chat messages to claudeChatStash
  2. Stash current processing state to claudeProcessingStash
  3. Reset currentInit, currentProgress, currentLogs to null
  4. Set currentDashboardId to new dashboard
  5. Restore target dashboard's chat messages from stash (or localStorage)
  6. Restore target processing state from stash
    |
    v
useDashboardData effect fires (currentDashboardId changed):
  1. fetchDashboardData(newDashboardId) via IPC pull
  2. Fetches init, progress, logs for the new dashboard
  3. Dispatches SET_INIT, SET_PROGRESS, SET_LOGS
    |
    v
mergeState() runs with new init + progress
    |
    v
Dashboard re-renders with new dashboard's data
```

IPC push listeners continue receiving events for all dashboards. Events for the non-active dashboard update the `allDashboardProgress` and `allDashboardLogs` caches (used for sidebar status dots) but do not trigger full re-renders.

---

## Startup Flow

### Electron App Startup

```
npm start
    |
    v
Vite builds the React app to dist/
    |
    v
Electron launches main.js
    |
    v
1. Register 'app' protocol scheme (synchronous, before app.ready)
    |
    v
2. app.whenReady():
   a. Register app:// protocol handler (resolves paths to PROJECT_ROOT)
   b. Initialize settings (window state, preferences)
   c. Set macOS dock icon
   d. registerIPCHandlers(getMainWindow):
      - Ensure directories exist (dashboards/, Archive/, history/, queue/)
      - Register 60+ ipcMain.handle() handlers
      - Initialize ClaudeCodeService and CodexService
      - Initialize SwarmOrchestrator
      - Start file watchers for all dashboards
      - Start dashboards directory watcher
      - Start queue directory watcher
      - Schedule initial data push to renderer
   e. createWindow():
      - Create BrowserWindow with settings (size, position)
      - Load app://synapse/dist/index.html
    |
    v
3. Window loads React app:
   a. main.jsx installs Electron fetch shim
   b. AppProvider wraps App with useReducer state
   c. App renders, useDashboardData hook initializes:
      - Fetches dashboard list and statuses via IPC pull
      - Fetches data for default dashboard (first available hex-ID dashboard)
      - Subscribes to IPC push events
   d. mergeState() produces initial renderable state
   e. Dashboard renders with initial data
    |
    v
4. File watchers begin detecting changes
   Initial data push arrives from sendInitialData()
   Dashboard is fully live and reactive
```

### Node.js Server Startup

```
node src/server/index.js
    |
    v
1. startup():
   a. Ensure dashboards/ directory exists
   b. Ensure at least one dashboard directory exists
   c. Ensure Archive/, history/, queue/ directories exist
   d. Start file watchers for all dashboards
   e. Start dashboards directory watcher
   f. Start queue directory watcher
   g. Start periodic reconciliation (5s interval)
   h. Start SSE heartbeat (15s interval)
    |
    v
2. server.listen(3456):
   - HTTP server ready to accept connections
   - SSE endpoint at /events
   - REST API at /api/*
    |
    v
3. Client connects to /events:
   - Initial burst: dashboards_list, initialization, all_progress, init_state, queue
   - Live updates via SSE as files change
```
