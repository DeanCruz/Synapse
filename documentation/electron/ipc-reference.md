# IPC Channels and Handlers Reference

This document provides a complete reference of every IPC channel in Synapse's Electron app. All IPC communication flows through the `window.electronAPI` context bridge defined in `electron/preload.js`, with handlers registered in `electron/ipc-handlers.js`.

---

## Communication Patterns

Synapse uses two IPC patterns:

| Pattern | Direction | Electron API | Usage |
|---|---|---|---|
| **Push Events** | Main -> Renderer | `webContents.send()` / `ipcRenderer.on()` | Real-time file change notifications, worker output, swarm state |
| **Pull Requests** | Renderer -> Main | `ipcMain.handle()` / `ipcRenderer.invoke()` | Data fetching, CRUD operations, CLI spawning |

---

## Push Events (Main -> Renderer)

Push events are initiated by the main process (typically from file watchers or worker process events) and delivered to the renderer. The preload script whitelists allowed channels.

### Channel Whitelist

```javascript
const PUSH_CHANNELS = [
  'initialization',
  'logs',
  'agent_progress',
  'all_progress',
  'dashboards_list',
  'dashboards_changed',
  'queue_changed',
  'reload',
  'worker-output',
  'worker-complete',
  'worker-error',
  'swarm-state',
];
```

### Renderer API for Push Events

```javascript
// Subscribe to a push event
const listener = window.electronAPI.on(channel, (data) => { ... });

// Unsubscribe from a push event
window.electronAPI.off(channel, listener);
```

### Push Event Details

#### `initialization`

Fired when a dashboard's `initialization.json` changes on disk.

```javascript
{
  dashboardId: "dashboard1",
  task: { name, type, directory, prompt, project, created, total_tasks, total_waves },
  agents: [{ id, title, wave, layer, directory, depends_on }],
  waves: [{ id, name, total }],
  chains: [],
  history: []
}
```

#### `logs`

Fired when a dashboard's `logs.json` changes on disk.

```javascript
{
  dashboardId: "dashboard1",
  entries: [
    { timestamp, task_id, agent, level, message, task_name }
  ]
}
```

#### `agent_progress`

Fired when a single worker's progress file changes. Also feeds into `SwarmOrchestrator.handleProgressUpdate()` for automatic dispatch.

```javascript
{
  dashboardId: "dashboard1",
  task_id: "1.1",
  status: "in_progress",
  started_at: "2026-03-22T15:00:00Z",
  completed_at: null,
  summary: null,
  assigned_agent: "Agent 1",
  stage: "implementing",
  message: "Creating user model",
  milestones: [{ at, msg }],
  deviations: [{ at, severity, description }],
  logs: [{ at, level, msg }]
}
```

#### `all_progress`

Fired during initial data load. Contains all progress files for a dashboard keyed by task ID.

```javascript
{
  dashboardId: "dashboard1",
  "1.1": { task_id, status, started_at, ... },
  "1.2": { task_id, status, started_at, ... }
}
```

#### `dashboards_list`

Fired once during initial data load. Contains the list of all dashboard IDs.

```javascript
{
  dashboards: ["dashboard1", "dashboard2", "dashboard3", "dashboard4", "dashboard5"]
}
```

#### `dashboards_changed`

Fired when a dashboard is created or deleted.

```javascript
{
  dashboards: ["dashboard1", "dashboard2"]
}
```

#### `queue_changed`

Fired when the queue directory changes.

```javascript
{
  queue: [{ id, name, status, ... }]
}
```

#### `reload`

Fired to trigger a full page reload (not used in production Electron builds).

```javascript
{}
```

#### `worker-output`

Fired for each NDJSON line from a worker's stdout. Streamed in real-time.

```javascript
{
  pid: 12345,
  provider: "claude",        // or "codex"
  taskId: "1.1",
  dashboardId: "dashboard1",
  chunk: "{\"type\":\"assistant\",...}\n",
  parsed: { type: "assistant", ... }  // or null if not valid JSON
}
```

#### `worker-complete`

Fired when a worker process exits.

```javascript
{
  pid: 12345,
  provider: "claude",
  taskId: "1.1",
  dashboardId: "dashboard1",
  exitCode: 0,
  output: "full accumulated stdout",
  errorOutput: "full accumulated stderr",
  lastMessage: "..."           // Codex only: content of -o output file
}
```

#### `worker-error`

Fired when a worker process fails to spawn or encounters an OS-level error.

```javascript
{
  pid: 12345,
  provider: "claude",
  taskId: "1.1",
  dashboardId: "dashboard1",
  error: "spawn ENOENT"
}
```

#### `swarm-state`

Fired when the SwarmOrchestrator changes a swarm's state (e.g., entering replanning mode or pausing).

```javascript
{
  dashboardId: "dashboard1",
  state: "replanning"    // "running" | "paused" | "replanning"
}
```

---

## Pull Requests (Renderer -> Main)

Pull requests are initiated by the renderer and return a Promise. The renderer calls `window.electronAPI.{method}()` which maps to `ipcRenderer.invoke(channel, ...args)`.

### Dashboard Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `getDashboards()` | `get-dashboards` | DashboardService | List all dashboard IDs |
| `createDashboard()` | `create-dashboard` | DashboardService | Create a new dashboard, start watcher |
| `deleteDashboard(id)` | `delete-dashboard` | DashboardService | Delete a dashboard, stop watcher |
| `getDashboardStatuses()` | `get-dashboard-statuses` | DashboardService | Derive status for all dashboards |
| `getDashboardInit(id)` | `get-dashboard-init` | DashboardService | Read `initialization.json` |
| `getDashboardLogs(id)` | `get-dashboard-logs` | DashboardService | Read `logs.json` |
| `getDashboardProgress(id)` | `get-dashboard-progress` | DashboardService | Read all progress files |
| `clearDashboard(id)` | `clear-dashboard` | DashboardService | Save history, reset to defaults |
| `archiveDashboard(id)` | `archive-dashboard` | ArchiveService | Copy to Archive, then clear |
| `saveDashboardHistory(id)` | `save-dashboard-history` | HistoryService | Save history summary JSON |
| `exportDashboard(id)` | `export-dashboard` | DashboardService | Export init + logs + progress + summary |

#### `getDashboards()` -> `get-dashboards`

**Returns:** `{ dashboards: string[] }`

Lists all dashboard directory names under `dashboards/`.

#### `createDashboard()` -> `create-dashboard`

**Returns:** `{ success: boolean, id: string }`

Creates the next available dashboard directory, starts a file watcher, and broadcasts `dashboards_changed`.

#### `deleteDashboard(id)` -> `delete-dashboard`

**Parameters:** `id: string` (e.g., `"dashboard3"`)

**Returns:** `{ success: boolean, error?: string }`

Stops the file watcher, deletes the dashboard directory, and broadcasts `dashboards_changed`.

#### `getDashboardStatuses()` -> `get-dashboard-statuses`

**Returns:** `{ statuses: { [dashboardId]: 'idle' | 'in_progress' | 'completed' | 'error' } }`

Derives each dashboard's status from its initialization and progress data using `deriveDashboardStatus()`.

Status derivation logic:
- `idle` -- No task defined
- `in_progress` -- Has a task and at least one worker active or not all done
- `completed` -- All tasks completed successfully
- `error` -- All tasks finished but at least one failed

#### `clearDashboard(id)` -> `clear-dashboard`

**Returns:** `{ success: boolean }`

Saves a history summary before clearing, then resets `initialization.json` and `logs.json` to defaults and clears all progress files.

#### `archiveDashboard(id)` -> `archive-dashboard`

**Returns:** `{ success: boolean, archiveName?: string, error?: string }`

Copies the full dashboard directory to `Archive/{YYYY-MM-DD}_{taskName}/`, then clears the dashboard.

#### `exportDashboard(id)` -> `export-dashboard`

**Returns:**
```javascript
{
  exported_at: "ISO 8601",
  summary: { /* history summary */ },
  initialization: { /* full init data */ },
  logs: { /* full logs data */ },
  progress: { /* all progress files */ }
}
```

### Overview Handler

| Renderer API | IPC Channel | Description |
|---|---|---|
| `getOverview()` | `get-overview` | Aggregated data for the overview page |

**Returns:**
```javascript
{
  dashboards: [{ id, status, task: { name, type, directory, total_tasks, completed_tasks, failed_tasks, created } }],
  archives: [/* last 10 archive names */],
  history: [/* last 10 history entries */],
  recentLogs: [/* newest 30 log entries across all dashboards */]
}
```

### Archive Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `getArchives()` | `get-archives` | List all archive names |
| `getArchive(name)` | `get-archive` | Read full archive (init + logs + progress) |
| `deleteArchive(name)` | `delete-archive` | Delete an archive directory |

### History Handler

| Renderer API | IPC Channel | Description |
|---|---|---|
| `getHistory()` | `get-history` | List all history summary files |

### Queue Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `getQueue()` | `get-queue` | List queue item summaries |
| `getQueueItem(id)` | `get-queue-item` | Read full queue item (init + logs + progress) |

### Settings Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `getSettings()` | `get-settings` | Get all settings (merged defaults + overrides) |
| `setSetting(key, value)` | `set-setting` | Set a single setting |
| `resetSettings()` | `reset-settings` | Reset all settings to defaults |

### Project Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `selectProjectDirectory()` | `select-project-directory` | Electron dialog | Open native directory picker |
| `loadProject(dirPath)` | `load-project` | ProjectService | Load project metadata (name, language, CLAUDE.md paths) |
| `getRecentProjects()` | `get-recent-projects` | settings | Get recent projects list |
| `addRecentProject(project)` | `add-recent-project` | settings | Add/promote a project in recents (max 10) |
| `getProjectContext(dirPath)` | `get-project-context` | ProjectService | Read all CLAUDE.md file contents |
| `scanProjectDirectory(dirPath, depth)` | `scan-project-directory` | ProjectService | Scan directory tree (default depth 2) |
| `detectClaudeCli()` | `detect-claude-cli` | ProjectService | Find Claude CLI binary path |
| `detectAgentCli(provider)` | `detect-agent-cli` | ProjectService | Find CLI binary for provider |

### Task Editor Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `createSwarm(dashboardId, opts)` | `create-swarm` | TaskEditorService | Create new swarm (resets init + logs + progress) |
| `addTask(dashboardId, task)` | `add-task` | TaskEditorService | Add a task to the plan |
| `updateTask(dashboardId, taskId, updates)` | `update-task` | TaskEditorService | Update task fields |
| `removeTask(dashboardId, taskId)` | `remove-task` | TaskEditorService | Remove a task and clean up deps |
| `addWave(dashboardId, wave)` | `add-wave` | TaskEditorService | Add a new wave |
| `removeWave(dashboardId, waveId)` | `remove-wave` | TaskEditorService | Remove a wave and all its tasks |
| `nextTaskId(dashboardId, waveNum)` | `next-task-id` | TaskEditorService | Generate next task ID for a wave |
| `validateDependencies(dashboardId)` | `validate-dependencies` | TaskEditorService | Check for cycles and missing refs |

### Commands Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `listCommands(commandsDir)` | `list-commands` | CommandsService | List commands grouped by folder |
| `getCommand(name, commandsDir)` | `get-command` | CommandsService | Get full command content |
| `saveCommand(name, content, commandsDir)` | `save-command` | CommandsService | Create or update a command |
| `deleteCommand(name, commandsDir)` | `delete-command` | CommandsService | Delete a command file |
| `createCommandFolder(folderName)` | `create-command-folder` | CommandsService | Create a new command subfolder |
| `saveCommandInFolder(name, content, folderName)` | `save-command-in-folder` | CommandsService | Save command to specific folder |
| `generateCommand(description, folderName, commandName, opts)` | `generate-command` | CommandsService | AI-generate a command using Claude CLI |
| `loadProjectClaudeMd(projectDir)` | `load-project-claude-md` | CommandsService | Load project CLAUDE.md content |
| `listProjectCommands(projectDir)` | `list-project-commands` | CommandsService | List commands from project `_commands/` |

### Chat Context Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `getChatSystemPrompt(projectDir, dashboardId)` | `get-chat-system-prompt` | Build system prompt with directory refs + Synapse CLAUDE.md + project CLAUDE.md |
| `logChatEvent(dashboardId, entry)` | `log-chat-event` | Append an event to a dashboard's `logs.json` |

### Attachment Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `saveTempImages(attachments)` | `save-temp-images` | Save base64 image attachments to temp files |
| `saveTempFile(base64, mimeType, name)` | `save-temp-file` | Save a single base64 file to temp directory |
| `selectImageFile()` | `select-image-file` | Open native file picker, return base64 + metadata |
| `readFileAsBase64(filePath)` | `read-file-as-base64` | Read any file and return as base64 data URI |

### Worker Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `spawnWorker(opts)` | `spawn-worker` | ClaudeCodeService / CodexService | Spawn a CLI worker process |
| `killWorker(pid)` | `kill-worker` | ClaudeCodeService / CodexService | Kill a worker by PID |
| `killAllWorkers()` | `kill-all-workers` | ClaudeCodeService + CodexService | Kill all active workers |
| `getActiveWorkers()` | `get-active-workers` | ClaudeCodeService + CodexService | List active worker metadata |

#### `spawnWorker(opts)` -> `spawn-worker`

**Parameters:**
```javascript
{
  provider: "claude" | "codex",
  taskId: "1.1",
  dashboardId: "dashboard1",
  projectDir: "/path/to/project",
  prompt: "task prompt text",
  systemPrompt: "system prompt text",
  model: "claude-sonnet-4-20250514",       // optional
  cliPath: "/usr/local/bin/claude",   // optional
  dangerouslySkipPermissions: false   // optional
}
```

**Returns:** `{ pid: number, taskId: string, dashboardId: string }`

Routes to `ClaudeCodeService.spawnWorker()` or `CodexService.spawnWorker()` based on provider.

### Orchestration Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `startSwarm(dashboardId, opts)` | `start-swarm` | SwarmOrchestrator | Start orchestrating a swarm |
| `pauseSwarm(dashboardId)` | `pause-swarm` | SwarmOrchestrator | Pause dispatch (workers continue) |
| `resumeSwarm(dashboardId)` | `resume-swarm` | SwarmOrchestrator | Resume paused swarm |
| `cancelSwarm(dashboardId)` | `cancel-swarm` | SwarmOrchestrator | Kill all workers and cancel |
| `retryTask(dashboardId, taskId)` | `retry-task` | SwarmOrchestrator | Retry a failed task |
| `getSwarmStates()` | `get-swarm-states` | SwarmOrchestrator | Get state of all active swarms |

#### `startSwarm(dashboardId, opts)` -> `start-swarm`

**Parameters:**
```javascript
{
  projectPath: "/path/to/project",
  provider: "claude",
  model: "claude-sonnet-4-20250514",
  cliPath: "/usr/local/bin/claude",
  dangerouslySkipPermissions: false
}
```

**Returns:** `{ success: boolean, error?: string }`

### Conversation Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `listConversations(dashboardId)` | `list-conversations` | ConversationService | List conversations (optional dashboard filter) |
| `loadConversation(filename)` | `load-conversation` | ConversationService | Load full conversation by ID |
| `saveConversation(conv)` | `save-conversation` | ConversationService | Save conversation to disk |
| `createConversation(name)` | `create-conversation` | ConversationService | Create a new named conversation |
| `deleteConversation(filename)` | `delete-conversation` | ConversationService | Delete a conversation file |
| `renameConversation(filename, newName)` | `rename-conversation` | ConversationService | Rename a conversation |

---

## Broadcast Bridge

The `createBroadcastFn()` function in `ipc-handlers.js` creates a bridge between `WatcherService` events and the IPC system:

```javascript
function createBroadcastFn(getMainWindow) {
  return function broadcast(eventName, data) {
    // 1. Send to renderer via IPC
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(eventName, data);
    }

    // 2. Feed progress updates to SwarmOrchestrator
    if (eventName === 'agent_progress' && data && data.task_id && data.dashboardId) {
      SwarmOrchestrator.handleProgressUpdate(data.dashboardId, data.task_id, data);
    }
  };
}
```

This dual-purpose broadcast ensures that:
- The UI gets real-time updates for rendering
- The SwarmOrchestrator gets completion/failure signals for automatic dispatch

---

## Initial Data Push

When the renderer window first loads, `sendInitialData()` pushes a complete snapshot:

1. `dashboards_list` -- All dashboard IDs
2. `initialization` -- Full init data per dashboard
3. `all_progress` -- All progress files per dashboard
4. `queue_changed` -- Queue summaries

This is retried on a 100ms interval until the window is available, with an initial 200ms delay to let the window finish loading.
