# Synapse Architecture Overview

Synapse is a standalone distributed control system for coordinating autonomous agent swarms. It decomposes complex software development tasks into parallel work streams, dispatches them to independent worker agents, and provides a real-time dashboard for monitoring progress. Synapse is project-agnostic and operates independently from the projects it manages.

---

## Core Design Philosophy

Synapse is built around four foundational principles:

1. **Separation of orchestration and execution.** The master agent plans and coordinates. Worker agents implement. These roles never overlap during an active swarm.
2. **File-based state with zero external dependencies.** All data is stored as JSON files on disk. There is no database, no message queue, no external service. The server uses only Node.js built-in modules.
3. **Real-time reactivity through file watchers.** Changes to JSON files on disk are detected by file system watchers and broadcast immediately to connected clients via SSE (Server-Sent Events) or Electron IPC.
4. **Dual transport for maximum flexibility.** The same dashboard works in both browser (SSE over HTTP) and desktop (Electron IPC) modes, sharing all backend services.

---

## System Components

Synapse consists of five major components that work together to plan, execute, and visualize parallel agent workloads.

### 1. Master Agent (Orchestrator)

The master agent is the central intelligence of a swarm. It runs within a Claude Code terminal session and has exactly five responsibilities:

| Responsibility | Description |
|---|---|
| **Gather Context** | Reads project files, CLAUDE.md, TOC, and source code to build a complete understanding of the task |
| **Plan** | Decomposes tasks into atomic units, maps dependencies, writes self-contained agent prompts |
| **Dispatch** | Spawns worker agents via the Task tool, sends all independent tasks in parallel |
| **Status** | Logs events to `logs.json`, updates the task record |
| **Report** | Compiles final summary when all agents complete or fail |

The master agent writes only to Synapse's own files (`initialization.json`, `logs.json`, task files, plan rationale). It never writes code, edits application files, or runs application commands.

### 2. Worker Agents

Worker agents are spawned by the master (via the Task tool in CLI mode) or by the SwarmOrchestrator (in Electron/desktop mode). Each worker:

- Receives a self-contained prompt with all context needed to complete its task
- Executes implementation work in `{project_root}` (the target project)
- Reports progress by writing JSON files to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`
- Progresses through fixed stages: `reading_context` -> `planning` -> `implementing` -> `testing` -> `finalizing` -> `completed` | `failed`

Workers are the sole owners of their progress files. They write the full file on every update (no read-modify-write). The dashboard server detects these writes and broadcasts them in real time.

### 3. Node.js Server (`src/server/`)

A zero-dependency HTTP server built on Node.js built-in modules (`http`, `fs`, `path`). It serves three functions:

| Function | Implementation |
|---|---|
| **SSE Event Stream** | `GET /events` endpoint. Clients connect and receive real-time events as file changes are detected. |
| **REST API** | Routes for dashboard CRUD, archives, history, queue, and commands. Handled by `routes/apiRoutes.js`. |
| **File Watching** | `WatcherService.js` uses `fs.watch` for progress directories (instant detection) and `fs.watchFile` for `initialization.json` and `logs.json` (100ms polling interval). |

The server runs on port 3456 (configurable via `PORT` environment variable). It is used when accessing the dashboard through a web browser. In Electron mode, the server is not started; all data flows through IPC instead.

**Key server services:**

| Service | File | Purpose |
|---|---|---|
| DashboardService | `services/DashboardService.js` | Dashboard directory CRUD, file reading |
| WatcherService | `services/WatcherService.js` | File system watching, change detection, SSE broadcast |
| DependencyService | `services/DependencyService.js` | Dependency graph computation, unblocked task detection |
| ArchiveService | `services/ArchiveService.js` | Dashboard archival to `Archive/` |
| HistoryService | `services/HistoryService.js` | Summary generation for completed swarms |
| QueueService | `services/QueueService.js` | Overflow queue management |
| SSEManager | `SSEManager.js` | SSE client connection management, heartbeat |

### 4. Electron Desktop App (`electron/`)

An Electron application that wraps the React dashboard in a native desktop window. It provides the same functionality as the browser mode but with additional capabilities:

| Component | File | Purpose |
|---|---|---|
| Main Process | `main.js` | App lifecycle, window creation, custom `app://` protocol |
| Preload Bridge | `preload.js` | Context bridge exposing `window.electronAPI` with 60+ IPC methods |
| IPC Handlers | `ipc-handlers.js` | Bridges renderer requests to server services, manages file watchers |
| Settings | `settings.js` | Persistent JSON settings store (window state, recent projects, preferences) |
| SwarmOrchestrator | `services/SwarmOrchestrator.js` | Self-managing dispatch engine for desktop-launched swarms |
| ClaudeCodeService | `services/ClaudeCodeService.js` | Claude CLI process spawning and lifecycle management |
| CodexService | `services/CodexService.js` | Codex CLI process management (alternative provider) |
| PromptBuilder | `services/PromptBuilder.js` | Worker prompt construction with upstream results |
| ProjectService | `services/ProjectService.js` | Project directory detection and context loading |
| CommandsService | `services/CommandsService.js` | Command file CRUD and generation |
| TaskEditorService | `services/TaskEditorService.js` | Swarm and task creation/editing |
| ConversationService | `services/ConversationService.js` | Chat conversation persistence |

The Electron app uses a custom `app://synapse/` protocol to serve the Vite-built React app from disk. The main process registers IPC handlers that reuse the same service layer as the Node.js server, ensuring consistent behavior across both modes.

### 5. React Dashboard (`src/ui/`)

A React frontend that provides real-time visualization of swarm progress. It can run in two contexts:

- **Electron mode:** Data arrives via IPC push events from the main process
- **Browser mode:** Data arrives via SSE from the Node.js server (and REST API for on-demand fetches)

**Key architectural patterns:**

| Pattern | Implementation |
|---|---|
| **State Management** | `useReducer` in `AppContext.jsx` — single global state store with action-based dispatch |
| **Data Flow Hook** | `useDashboardData.js` — subscribes to IPC push events, manages progress cache, triggers state merges |
| **Client-Side Merge** | `mergeState()` function combines static `initialization.json` data with dynamic progress file data to produce the renderable view |
| **Electron Fetch Shim** | `main.jsx` patches `window.fetch` to intercept `/api/*` calls and route them to IPC in Electron mode |

**Major UI components:**

| Component | Purpose |
|---|---|
| `WavePipeline` | Vertical column layout grouped by dependency waves |
| `ChainPipeline` | Horizontal row layout grouped by dependency chains |
| `AgentCard` | Individual task card showing status, stage, elapsed time, deviations |
| `StatsBar` | Six stat cards: Total, Completed, In Progress, Failed, Pending, Elapsed |
| `LogPanel` | Collapsible log drawer with level filtering |
| `Sidebar` | Multi-dashboard navigator with status indicators |
| `ClaudeView` | In-app agent chat interface |
| `SwarmBuilder` | Visual swarm plan creation tool |
| `Header` | Top navigation bar with view switching |

---

## Dual Transport Architecture

Synapse supports two transport mechanisms that share the same backend services:

```
                    +-----------------+
                    |  React Dashboard |
                    |    (src/ui/)     |
                    +--------+--------+
                             |
              +--------------+--------------+
              |                             |
     +--------v--------+          +--------v--------+
     |  Browser Mode   |          |  Electron Mode  |
     |  (SSE + REST)   |          |     (IPC)       |
     +--------+--------+          +--------+--------+
              |                             |
     +--------v--------+          +--------v--------+
     | Node.js Server  |          | IPC Handlers    |
     | (src/server/)   |          | (electron/)     |
     +--------+--------+          +--------+--------+
              |                             |
              +--------------+--------------+
                             |
                    +--------v--------+
                    | Shared Services  |
                    | (DashboardService|
                    |  WatcherService  |
                    |  ArchiveService  |
                    |  etc.)           |
                    +--------+--------+
                             |
                    +--------v--------+
                    | File System     |
                    | (dashboards/,   |
                    |  Archive/, etc.) |
                    +-----------------+
```

### Browser Mode (SSE)

1. Server starts on port 3456
2. Client connects to `GET /events` (SSE endpoint)
3. Server sends initial state burst (all dashboard data)
4. File watchers detect changes and broadcast SSE events
5. Client uses `fetch()` for REST API calls

### Electron Mode (IPC)

1. Electron main process registers IPC handlers via `ipc-handlers.js`
2. Preload script exposes `window.electronAPI` with typed methods
3. `main.jsx` patches `window.fetch` to intercept `/api/*` calls and route to IPC
4. File watchers detect changes and broadcast via `webContents.send()`
5. `useDashboardData.js` subscribes to IPC push events

The Electron fetch shim ensures that components written for browser mode work identically in Electron mode without modification.

---

## Multi-Dashboard Support

Synapse supports up to 5 concurrent dashboard instances, each representing an independent swarm:

```
dashboards/
  dashboard1/        <- Swarm A (project X)
    initialization.json
    logs.json
    progress/
  dashboard2/        <- Swarm B (project Y)
    initialization.json
    logs.json
    progress/
  ...
  dashboard5/
```

Each dashboard is fully independent:
- Has its own `initialization.json` (static plan), `logs.json` (event log), and `progress/` directory (worker files)
- Can serve a different project (identified by `task.project_root` in `initialization.json`)
- Has its own set of file watchers
- Has its own chat conversation context in the Claude view

The sidebar in the dashboard UI shows all active dashboards with status indicators. Users can switch between dashboards to monitor different swarms simultaneously.

---

## SwarmOrchestrator (Desktop Dispatch Engine)

When running in Electron mode, the `SwarmOrchestrator` service provides a self-managing dispatch loop that replaces the terminal-based master agent:

```
User clicks "Start Swarm" in UI
        |
        v
SwarmOrchestrator.startSwarm(dashboardId, opts)
        |
        v
Read initialization.json for task plan
        |
        v
dispatchReady() -> find all tasks with satisfied dependencies
        |
        v
For each ready task:
  1. Build system prompt + task prompt via PromptBuilder
  2. Read upstream results from completed dependency progress files
  3. Spawn CLI worker via ClaudeCodeService or CodexService
        |
        v
Worker writes progress file -> WatcherService detects change
        |
        v
broadcastFn routes update to SwarmOrchestrator.handleProgressUpdate()
        |
        v
If completed: onTaskComplete() -> dispatchReady() (next wave)
If failed: onTaskFailed() -> circuit breaker check -> dispatch or replan
```

The orchestrator implements:
- **Dependency-driven dispatch:** Tasks are dispatched the moment their dependencies are satisfied, not when a whole wave completes
- **Circuit breaker:** Triggers automatic replanning when 3+ tasks fail in the same wave, or a failure blocks 3+ downstream tasks, or a failure blocks >50% of remaining tasks
- **Automatic replanning:** Spawns a Claude CLI process to analyze failures and produce a revised plan (modified/added/removed/retry tasks)
- **Swarm lifecycle management:** Start, pause, resume, cancel operations with proper worker cleanup

---

## Security Model

Synapse follows Electron security best practices:

| Mechanism | Purpose |
|---|---|
| `contextIsolation: true` | Renderer cannot access Node.js APIs directly |
| `nodeIntegration: false` | No Node.js globals in the renderer process |
| Preload context bridge | Explicit whitelist of IPC channels and methods |
| Push channel whitelist | Only listed event types can be received by the renderer |
| Custom `app://` protocol | Secure, privileged scheme for serving local files |

---

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Desktop Shell | Electron | Custom protocol, IPC bridge, native dialogs |
| Build Tool | Vite | Fast HMR in development, optimized production builds |
| Frontend | React 19 | Functional components, hooks, useReducer for state |
| Styling | CSS | Single 5,973-line stylesheet, no CSS framework |
| Backend | Node.js | Zero npm dependencies for the server |
| Data Store | JSON files on disk | No database, watched by fs.watch/fs.watchFile |
| Agent Runtime | Claude Code CLI / Codex CLI | Workers spawned as child processes |
| Transport | SSE (browser) / IPC (Electron) | Dual mode with shared service layer |
