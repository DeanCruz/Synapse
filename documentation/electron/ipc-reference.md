# IPC Channels and Handlers Reference

This document provides a complete reference of every IPC channel in Synapse's Electron app. All IPC communication flows through the `window.electronAPI` context bridge defined in `electron/preload.js` (227 lines), with handlers registered in `electron/ipc-handlers.js` (2438 lines). There are **21 push event channels** and **139 pull request handlers** organized into 15 handler groups.

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

### Channel Whitelist (21 channels)

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
  'worker-permission-request',
  'swarm-state',
  'terminal-output',
  'terminal-exit',
  'ide-file-change',
  'heartbeat',
  'init_state',
  'tasks_unblocked',
  'debug-paused',
  'debug-resumed',
  'debug-stopped',
  'debug-output',
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

#### `worker-permission-request`

Fired when a worker CLI process encounters a permission prompt.

```javascript
{
  pid: 12345,
  taskId: "1.1",
  dashboardId: "dashboard1",
  ...                    // permission request details
}
```

#### `terminal-output`

Fired when a PTY terminal session produces output data.

```javascript
{
  id: "term_1711123456789",
  data: "$ ls\nfile1.txt  file2.txt\n"
}
```

#### `terminal-exit`

Fired when a PTY terminal session exits.

```javascript
{
  id: "term_1711123456789",
  exitCode: 0
}
```

#### `ide-file-change`

Fired when the IDE file watcher detects a file system change.

```javascript
{
  path: "/path/to/changed/file",
  type: "change"         // change type
}
```

#### `heartbeat`

Periodic heartbeat event for connection health monitoring.

```javascript
{
  timestamp: 1711123456789
}
```

#### `init_state`

Fired for initial state synchronization during app startup.

```javascript
{
  dashboardId: "dashboard1",
  ...                    // state data
}
```

#### `tasks_unblocked`

Fired when dependency completion unblocks downstream tasks.

```javascript
{
  dashboardId: "dashboard1",
  tasks: ["2.1", "2.2"]  // task IDs that are now unblocked
}
```

#### `debug-paused`

Fired when the debugger hits a breakpoint or is paused.

```javascript
{
  reason: "breakpoint",   // "breakpoint" | "step" | "exception" | "other"
  callStack: [{ id, name, source, line, column, scriptId }],
  scopes: [{ name, type, variablesReference, expensive }],
  pausedFile: "/path/to/file.js",
  pausedLine: 42,
  hitBreakpoints: ["1:42"]
}
```

#### `debug-resumed`

Fired when the debugger resumes execution.

```javascript
{}
```

#### `debug-stopped`

Fired when the debug session ends.

```javascript
{
  code: 0,
  signal: null,
  reason: "exited"       // "exited" | "error"
}
```

#### `debug-output`

Fired for console output, stdout, stderr, and exceptions from the debuggee.

```javascript
{
  type: "log",           // "log" | "error" | "warn" | "stdout" | "stderr"
  text: "Hello from debuggee",
  timestamp: 1711123456789,  // optional
  line: 42,                  // optional, for exceptions
  column: 5                  // optional, for exceptions
}
```

---

## Pull Requests (Renderer -> Main)

Pull requests are initiated by the renderer and return a Promise. The renderer calls `window.electronAPI.{method}()` which maps to `ipcRenderer.invoke(channel, ...args)`.

### Dashboard Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `ipcHeartbeat()` | `ipc-heartbeat` | -- | Verify IPC bridge is alive |
| `getDashboards()` | `get-dashboards` | DashboardService | List all dashboard IDs |
| `createDashboard()` | `create-dashboard` | DashboardService | Create a new dashboard, start watcher |
| `deleteDashboard(id)` | `delete-dashboard` | DashboardService | Delete a dashboard, stop watcher |
| `reorderDashboards(orderedIds)` | `reorder-dashboards` | settings | Persist sidebar dashboard order |
| `renameDashboard(id, displayName)` | `rename-dashboard` | settings | Set custom display name for a dashboard |
| `getDashboardMeta()` | `get-dashboard-meta` | settings | Get dashboard order and custom names |
| `getDashboardStatuses()` | `get-dashboard-statuses` | DashboardService | Derive status for all dashboards |
| `getDashboardInit(id)` | `get-dashboard-init` | DashboardService | Read `initialization.json` |
| `getDashboardLogs(id)` | `get-dashboard-logs` | DashboardService | Read `logs.json` |
| `getDashboardProgress(id)` | `get-dashboard-progress` | DashboardService | Read all progress files |
| `clearDashboard(id)` | `clear-dashboard` | DashboardService | Save history, reset to defaults |
| `archiveDashboard(id)` | `archive-dashboard` | ArchiveService | Copy to Archive, then clear |
| `saveDashboardHistory(id)` | `save-dashboard-history` | HistoryService | Save history summary JSON |
| `exportDashboard(id)` | `export-dashboard` | DashboardService | Export init + logs + progress + summary |
| `getDashboardMetrics(id)` | `get-dashboard-metrics` | DashboardService | Get metrics/analytics for a dashboard |

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

### History Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `getHistory()` | `get-history` | List all history summary files |
| `getHistoryAnalytics()` | `get-history-analytics` | Get aggregated analytics across all history |

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
| `getChatSystemPrompt(projectDir, dashboardId, additionalContextDirs)` | `get-chat-system-prompt` | Build system prompt with directory refs + Synapse CLAUDE.md + project CLAUDE.md |
| `logChatEvent(dashboardId, entry)` | `log-chat-event` | Append an event to a dashboard's `logs.json` |

### Attachment Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `saveTempImages(attachments)` | `save-temp-images` | Save base64 image attachments to temp files |
| `saveTempFile(base64, mimeType, name)` | `save-temp-file` | Save a single base64 file to temp directory |
| `selectImageFile()` | `select-image-file` | Open native file picker, return base64 + metadata |
| `readFileAsBase64(filePath)` | `read-file-as-base64` | Read any file and return as base64 data URI |

### User Commands Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `listUserCommands()` | `list-user-commands` | CommandsService | List commands from the user commands directory |
| `getUserCommand(name, folderName)` | `get-user-command` | CommandsService | Get a user command by name and folder |
| `saveUserCommand(name, content, folderName)` | `save-user-command` | CommandsService | Save a user command |
| `deleteUserCommand(name, folderName)` | `delete-user-command` | CommandsService | Delete a user command |
| `generateUserCommand(desc, folder, name, opts)` | `generate-user-command` | CommandsService | AI-generate a user command |

### Worker Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `spawnWorker(opts)` | `spawn-worker` | ClaudeCodeService / CodexService | Spawn a CLI worker process |
| `killWorker(pid)` | `kill-worker` | ClaudeCodeService / CodexService | Kill a worker by PID |
| `killAllWorkers()` | `kill-all-workers` | ClaudeCodeService + CodexService | Kill all active workers |
| `getActiveWorkers()` | `get-active-workers` | ClaudeCodeService + CodexService | List active worker metadata |
| `writeWorker(pid, data)` | `write-worker` | ClaudeCodeService | Write data to a worker's stdin |

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

### Terminal Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `spawnTerminal(opts)` | `spawn-terminal` | TerminalService | Spawn a PTY terminal session |
| `writeTerminal(id, data)` | `write-terminal` | TerminalService | Write input to a terminal |
| `resizeTerminal(id, cols, rows)` | `resize-terminal` | TerminalService | Resize a terminal session |
| `killTerminal(id)` | `kill-terminal` | TerminalService | Kill a terminal session |
| `killAllTerminals()` | `kill-all-terminals` | TerminalService | Kill all active terminals |
| `getActiveTerminals()` | `get-active-terminals` | TerminalService | List active terminal sessions |

#### `spawnTerminal(opts)` -> `spawn-terminal`

**Parameters:**
```javascript
{
  cwd: "/path/to/directory",   // optional, defaults to process.cwd()
  cols: 80,                    // optional, default 80
  rows: 24,                    // optional, default 24
  shell: "/bin/zsh"            // optional, defaults to $SHELL or /bin/zsh
}
```

**Returns:** `{ id: string, pid: number, shell: string, cwd: string, cols: number, rows: number }`

### IDE File System Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `ideReadFile(filePath, workspaceRoot)` | `ide-read-file` | Read file contents with binary detection |
| `ideWriteFile(filePath, content, workspaceRoot)` | `ide-write-file` | Write content to a file |
| `ideReadDir(dirPath, options)` | `ide-read-dir` | Recursive directory tree |
| `ideListDir(dirPath, options)` | `ide-list-dir` | Single-level directory listing (lazy load) |
| `ideCreateFile(filePath, content, workspaceRoot)` | `ide-create-file` | Create a new file |
| `ideCreateFolder(dirPath, workspaceRoot)` | `ide-create-folder` | Create a new directory |
| `ideRename(oldPath, newPath, workspaceRoot)` | `ide-rename` | Rename a file or folder |
| `ideDelete(targetPath, workspaceRoot)` | `ide-delete` | Delete a file or folder |
| `ideSelectFolder()` | `ide-select-folder` | Native folder picker dialog |
| `ideCheckSyntax(filePath, workspaceRoot)` | `ide-check-syntax` | Check syntax of a single file |
| `ideCheckSyntaxBatch(filePaths, workspaceRoot)` | `ide-check-syntax-batch` | Check syntax of multiple files |

### Debug Handlers

| Renderer API | IPC Channel | Handler Service | Description |
|---|---|---|---|
| `debugLaunch(opts)` | `debug-launch` | DebugService | Start a debug session for a Node.js script |
| `debugStop()` | `debug-stop` | DebugService | Stop the active debug session |
| `debugSetBreakpoint(filePath, line, condition)` | `debug-set-breakpoint` | DebugService | Set a breakpoint at file:line |
| `debugRemoveBreakpoint(breakpointId)` | `debug-remove-breakpoint` | DebugService | Remove a breakpoint by ID |
| `debugContinue()` | `debug-continue` | DebugService | Resume execution |
| `debugPause()` | `debug-pause` | DebugService | Pause execution |
| `debugStepOver()` | `debug-step-over` | DebugService | Step over the current statement |
| `debugStepInto()` | `debug-step-into` | DebugService | Step into the next function call |
| `debugStepOut()` | `debug-step-out` | DebugService | Step out of the current function |
| `debugEvaluate(expression, callFrameId)` | `debug-evaluate` | DebugService | Evaluate an expression in debug context |
| `debugGetVariables(objectId)` | `debug-get-variables` | DebugService | Get variables for a scope/object |
| `debugGetScopes(callFrameId)` | `debug-get-scopes` | DebugService | Get scopes for the current paused state |
| `debugSessionInfo()` | `debug-session-info` | DebugService | Get current debug session info |

#### `debugLaunch(opts)` -> `debug-launch`

**Parameters:**
```javascript
{
  scriptPath: "/path/to/script.js",  // required — absolute path to Node.js file
  cwd: "/path/to/directory",         // optional, defaults to script's directory
  args: ["--flag", "value"],         // optional, additional script arguments
  env: { NODE_ENV: "development" }   // optional, additional environment variables
}
```

**Returns:** `{ success: true, pid: number }` or `{ success: false, error: string }`

Spawns a Node.js process with `--inspect-brk=0`, connects to the Chrome DevTools Protocol WebSocket, and enables the Debugger and Runtime domains.

### Git Handlers

| Renderer API | IPC Channel | Description |
|---|---|---|
| `gitIsRepo(repoPath)` | `git-is-repo` | Check if a directory is a git repository |
| `gitInit(repoPath)` | `git-init` | Initialize a new git repository |
| `gitStatus(repoPath)` | `git-status` | Get working tree status (porcelain v1) |
| `gitDiff(repoPath, staged)` | `git-diff` | Get unstaged diff (or staged with flag) |
| `gitDiffFile(repoPath, filePath, staged)` | `git-diff-file` | Get diff for a specific file |
| `gitLog(repoPath, maxCount, extraArgs)` | `git-log` | Get commit log |
| `gitBranches(repoPath)` | `git-branches` | List all branches |
| `gitCurrentBranch(repoPath)` | `git-current-branch` | Get current branch name |
| `gitStage(repoPath, files)` | `git-stage` | Stage specific files |
| `gitUnstage(repoPath, files)` | `git-unstage` | Unstage specific files |
| `gitStageAll(repoPath)` | `git-stage-all` | Stage all changes |
| `gitUnstageAll(repoPath)` | `git-unstage-all` | Unstage all changes |
| `gitCommit(repoPath, message)` | `git-commit` | Create a commit |
| `gitPush(repoPath, remote, branch, setUpstream)` | `git-push` | Push to remote |
| `gitPull(repoPath, remote, branch)` | `git-pull` | Pull from remote |
| `gitFetch(repoPath, remote)` | `git-fetch` | Fetch from remote |
| `gitCheckout(repoPath, target)` | `git-checkout` | Checkout a branch or commit |
| `gitCreateBranch(repoPath, branchName, checkout)` | `git-create-branch` | Create and optionally checkout a new branch |
| `gitDeleteBranch(repoPath, branchName, force)` | `git-delete-branch` | Delete a branch |
| `gitMerge(repoPath, branchName)` | `git-merge` | Merge a branch into the current branch |
| `gitStash(repoPath, message)` | `git-stash` | Stash current changes |
| `gitStashPop(repoPath)` | `git-stash-pop` | Pop the most recent stash |
| `gitRemotes(repoPath)` | `git-remotes` | List remotes with URLs |
| `gitReset(repoPath, target, mode)` | `git-reset` | Reset to a specific commit |
| `gitRevert(repoPath, commitHash)` | `git-revert` | Revert a specific commit |
| `gitAheadBehind(repoPath, branch)` | `git-ahead-behind` | Count commits ahead/behind upstream |
| `gitDiscardFile(repoPath, filePath)` | `git-discard-file` | Discard changes to a specific file |
| `gitGraph(repoPath, maxCount)` | `git-graph` | Get commit graph with branch refs for visualization |

All Git handlers execute `git` commands via `child_process.execFile` in the specified repository path. They are implemented directly in `ipc-handlers.js` without a separate service module.

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
