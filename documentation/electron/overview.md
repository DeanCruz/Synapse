# Electron App Architecture Overview

Synapse ships as an Electron desktop application. The Electron layer wraps the React dashboard UI, manages IPC communication between the renderer and main processes, spawns CLI worker processes, and orchestrates parallel agent swarms entirely from the desktop.

---

## High-Level Architecture

```
+---------------------------+         +--------------------------+
|     Renderer Process      |         |      Main Process        |
|   (React Dashboard UI)    |  IPC    |   (electron/main.js)     |
|                           | <-----> |                          |
|  window.electronAPI.*     |         |  ipc-handlers.js         |
|  (preload.js bridge)      |         |  services/*              |
+---------------------------+         +-----------+--------------+
                                                  |
                                      +-----------+--------------+
                                      |  Child Processes         |
                                      |  (Claude CLI / Codex CLI)|
                                      |  One per dispatched task |
                                      +--------------------------+
```

### Process Model

| Process | Role | Entry Point |
|---|---|---|
| **Main Process** | App lifecycle, IPC handlers, file watchers, CLI process management, swarm orchestration | `electron/main.js` |
| **Renderer Process** | React UI (dashboard, chat, task editor, settings) | `dist/index.html` (Vite build output) |
| **Worker Processes** | Claude Code or Codex CLI instances spawned per task | `claude --print` or `codex exec` |

---

## Main Process Entry Point

**File:** `electron/main.js` (173 lines)

The main process is responsible for:

1. **Custom Protocol Registration** -- Registers the `app://` protocol scheme before `app.ready`. This protocol resolves file paths relative to the project root, checking `dist/` and `public/` as fallbacks.

2. **Window Creation** -- Creates a single `BrowserWindow` with:
   - Saved window dimensions and position (from `settings.js`)
   - `contextIsolation: true` and `nodeIntegration: false` for security
   - macOS `hiddenInset` title bar style
   - Dark background color (`#0a0a0c`)

3. **Settings Initialization** -- Loads the JSON-backed settings store and applies saved window state.

4. **IPC Handler Registration** -- Calls `registerIPCHandlers()` from `ipc-handlers.js` which sets up all IPC channels and file watchers.

5. **macOS Dock Icon** -- Sets the dock icon from either a 512x512 PNG or `.icns` file, supporting both development and packaged app paths.

6. **Window State Persistence** -- Debounced (500ms) saving of window position and size on resize/move events.

7. **App Lifecycle** -- Handles `window-all-closed` (stops watchers, kills all workers, quits), and `activate` (re-creates window on macOS).

### Custom `app://` Protocol

The `app://synapse/` protocol handler resolves file paths in this order:

1. `{PROJECT_ROOT}/{pathname}` -- Direct path
2. `{PROJECT_ROOT}/dist/{pathname}` -- Vite build output
3. `{PROJECT_ROOT}/public/{pathname}` -- Legacy fallback

This allows the renderer to load assets via `app://synapse/dist/index.html` without requiring a dev server.

---

## Preload Script and Context Bridge

**File:** `electron/preload.js` (244 lines)

The preload script exposes `window.electronAPI` to the renderer via Electron's `contextBridge`. All communication between renderer and main process flows through this API. There are no direct `ipcRenderer` calls from the renderer -- everything is proxied through the bridge.

### Two Communication Patterns

| Pattern | Direction | Mechanism | Purpose |
|---|---|---|---|
| **Push Events** | Main -> Renderer | `ipcRenderer.on()` / `webContents.send()` | Real-time updates (file changes, worker output, swarm state) |
| **Pull Requests** | Renderer -> Main | `ipcRenderer.invoke()` / `ipcMain.handle()` | Request-response data fetching and mutations |

### Push Event Channels (33 channels)

The preload script whitelists these channels for push events:

| Channel | Payload | Trigger |
|---|---|---|
| `initialization` | `{ dashboardId, ...initData }` | `initialization.json` file change |
| `logs` | `{ dashboardId, entries }` | `logs.json` file change |
| `agent_progress` | `{ dashboardId, task_id, ...progressData }` | Worker progress file change |
| `all_progress` | `{ dashboardId, ...allProgressData }` | Initial data burst on connection |
| `dashboards_list` | `{ dashboards: string[] }` | Initial dashboard list |
| `dashboards_changed` | `{ dashboards: string[] }` | Dashboard created/deleted |
| `queue_changed` | `{ queue: object[] }` | Queue directory change |
| `reload` | `{}` | Live reload trigger |
| `worker-output` | `{ pid, provider, taskId, dashboardId, chunk, parsed }` | Worker CLI stdout |
| `worker-complete` | `{ pid, provider, taskId, dashboardId, exitCode, output }` | Worker process exit |
| `worker-error` | `{ pid, provider, taskId, dashboardId, error }` | Worker process error |
| `worker-permission-request` | `{ pid, taskId, dashboardId, ... }` | Worker CLI permission prompt |
| `swarm-state` | `{ dashboardId, state }` | Swarm state change (replanning, paused, etc.) |
| `terminal-output` | `{ id, data }` | PTY terminal stdout data |
| `terminal-exit` | `{ id, exitCode }` | PTY terminal session exit |
| `ide-file-change` | `{ path, type }` | IDE file system change detected |
| `heartbeat` | `{ timestamp }` | Periodic heartbeat for connection health |
| `init_state` | `{ dashboardId, ...state }` | Initial state synchronization |
| `tasks_unblocked` | `{ dashboardId, tasks }` | Tasks unblocked by dependency completion |
| `debug-paused` | `{ reason, callStack, scopes, pausedFile, pausedLine }` | Debugger hit breakpoint or pause |
| `debug-resumed` | `{}` | Debugger resumed execution |
| `debug-stopped` | `{ code, signal, reason }` | Debug session ended |
| `debug-output` | `{ type, text }` | Console/stdout/stderr from debuggee |
| `settings-changed` | `{ settings }` | Settings updated (synced to renderer) |
| `preview-edit-request` | `{ label, newText }` | Live Preview inline text edit request |

---

## Service Layer

The main process delegates all business logic to service modules under `electron/services/`:

| Service | File | Responsibility |
|---|---|---|
| **SwarmOrchestrator** | `SwarmOrchestrator.js` | Dispatch loop, dependency resolution, circuit breaker, replanning |
| **ClaudeCodeService** | `ClaudeCodeService.js` | Claude Code CLI process spawning, output streaming, lifecycle |
| **CodexService** | `CodexService.js` | Codex CLI process spawning, output streaming, lifecycle |
| **PromptBuilder** | `PromptBuilder.js` | Worker prompt construction (system prompt, task prompt, replan prompt) |
| **ProjectService** | `ProjectService.js` | Project detection, CLAUDE.md discovery, CLI binary detection |
| **CommandsService** | `CommandsService.js` | `_commands/` directory management, command CRUD, AI generation |
| **TaskEditorService** | `TaskEditorService.js` | Swarm/task/wave CRUD on `initialization.json` |
| **ConversationService** | `ConversationService.js` | Chat conversation persistence (JSON files) |
| **DebugService** | `DebugService.js` | Node.js debugger via Chrome DevTools Protocol (breakpoints, stepping, evaluation) |
| **TerminalService** | `TerminalService.js` | PTY terminal session management via `node-pty` |
| **InstrumentService** | `InstrumentService.js` | Project file instrumentation (`data-synapse-label` attributes) |
| **PreviewService** | `PreviewService.js` | Label-to-source file mapping for Live Preview |
| **PreviewTextWriter** | `PreviewTextWriter.js` | Text update writer for Live Preview edits |

Additionally, the main process imports shared services from `src/server/services/`:

| Shared Service | Purpose |
|---|---|
| `DashboardService` | Dashboard directory management, init/logs/progress reading |
| `WatcherService` | `fs.watch` on dashboard and queue directories |
| `ArchiveService` | Dashboard archiving |
| `HistoryService` | Swarm history summaries |
| `QueueService` | Overflow queue management |

---

## Data Flow

### Dashboard Updates (File Watcher -> SSE -> UI)

```
1. Worker writes progress file to dashboards/{id}/progress/{taskId}.json
2. WatcherService detects file change via fs.watch
3. WatcherService calls broadcastFn('agent_progress', data)
4. broadcastFn sends to renderer via webContents.send()
5. broadcastFn also feeds SwarmOrchestrator.handleProgressUpdate()
6. React UI receives event via window.electronAPI.on('agent_progress', cb)
7. UI merges progress data with initialization.json and re-renders
```

### Swarm Dispatch (UI -> Orchestrator -> CLI)

```
1. User clicks "Start Swarm" in UI
2. Renderer calls electronAPI.startSwarm(dashboardId, opts)
3. IPC handler routes to SwarmOrchestrator.startSwarm()
4. Orchestrator reads initialization.json for task dependency graph
5. Orchestrator finds all tasks with satisfied dependencies
6. For each ready task:
   a. PromptBuilder constructs system + task prompts
   b. ClaudeCodeService/CodexService spawns CLI process
   c. CLI process receives prompt via stdin
   d. stdout streams NDJSON events back to renderer
7. Worker writes progress files -> triggers more dispatches (step 1 above)
```

### Initial Data Load

When the window first loads, `sendInitialData()` pushes:

1. Full dashboard list via `dashboards_list`
2. `initialization.json` for each dashboard via `initialization`
3. All progress files for each dashboard via `all_progress`
4. Queue summaries via `queue_changed`

This mirrors the SSE initial data burst from the web server, ensuring the renderer has a complete snapshot before any incremental updates arrive.

---

## Security Model

- **Context Isolation:** Enabled (`contextIsolation: true`)
- **Node Integration:** Disabled (`nodeIntegration: false`)
- **Channel Whitelisting:** Push events are restricted to a hardcoded whitelist in `preload.js`
- **No Remote Module:** Not used
- **Custom Protocol:** `app://` scheme registered with `standard`, `secure`, `supportFetchAPI`, and `corsEnabled` privileges

---

## File Structure

```
electron/
  main.js                          -- Main process entry point (173 lines)
  preload.js                       -- Context bridge (244 lines)
  settings.js                      -- JSON-backed settings store (105 lines)
  ipc-handlers.js                  -- IPC handler registration + watchers (~2200 lines)
  assets/
    icon.icns                      -- macOS app icon
    icon.iconset/
      icon_512x512.png             -- High-res PNG for dock icon
  services/
    SwarmOrchestrator.js           -- Dispatch engine (764 lines)
    ClaudeCodeService.js           -- Claude CLI management (370 lines)
    CodexService.js                -- Codex CLI management (225 lines)
    PromptBuilder.js               -- Prompt construction (372 lines)
    ProjectService.js              -- Project detection (193 lines)
    CommandsService.js             -- Command management (651 lines)
    TaskEditorService.js           -- Swarm/task CRUD (377 lines)
    ConversationService.js         -- Chat conversations (143 lines)
    DebugService.js                -- Node.js CDP debugger (796 lines)
    TerminalService.js             -- PTY terminal sessions (182 lines)
    InstrumentService.js           -- Project instrumentation for Live Preview
    PreviewService.js              -- Label-to-source mapper for Live Preview
    PreviewTextWriter.js           -- Text update writer for Live Preview
```
