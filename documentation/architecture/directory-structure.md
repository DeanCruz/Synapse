# Synapse Directory Structure

This document provides a complete reference for every directory and file in the Synapse repository, with explanations of each component's role in the system.

---

## Table of Contents

- [Root Layout](#root-layout)
- [Electron Desktop App](#electron-desktop-app)
- [Node.js Server](#nodejs-server)
- [React Dashboard UI](#react-dashboard-ui)
- [Command System](#command-system)
- [Agent Instructions](#agent-instructions)
- [Dashboard Data](#dashboard-data)
- [Task Records](#task-records)
- [Archive and History](#archive-and-history)
- [Queue](#queue)
- [Configuration](#configuration)
- [Target Project Structure](#target-project-structure)

---

## Root Layout

```
Synapse/                                 <- {tracker_root}
|
+-- CLAUDE.md                            Master instructions for the AI agent
+-- package.json                         Electron + Vite config, npm scripts
+-- vite.config.js                       Vite build configuration
+-- index.html                           Entry HTML (loaded by Vite/Electron)
|
+-- electron/                            Electron desktop app (main process)
+-- src/
|   +-- server/                          Node.js backend (SSE + REST API)
|   +-- ui/                              React frontend (dashboard)
|
+-- _commands/                           Command system (markdown specs)
+-- agent/                               Agent instruction files
+-- dashboards/                          Live dashboard data (hex ID directories)
+-- tasks/                               Generated task files per swarm
+-- Archive/                             Full dashboard snapshots (archived swarms)
+-- history/                             Lightweight summary JSON files
+-- queue/                               Overflow queue for pending swarms
+-- conversations/                       Persisted chat conversations
+-- dist/                                Vite build output (generated)
+-- public/                              Static assets (legacy)
+-- documentation/                       Project documentation
```

### Root Files

| File | Purpose |
|---|---|
| `CLAUDE.md` | The master instruction file for the AI agent. Defines all protocols, commands, principles, and constraints for swarm orchestration. This is the single source of truth for agent behavior. |
| `package.json` | Defines the project metadata, npm scripts (`npm start` for Electron), Vite and Electron as dev dependencies, and the build configuration. |
| `vite.config.js` | Vite bundler configuration. Sets the React plugin, output directory (`dist/`), and base path for the Electron `app://` protocol. |
| `index.html` | The HTML shell loaded by Vite in development and Electron in production. Contains the `<div id="root">` mount point for the React app. |

---

## Electron Desktop App

```
electron/
+-- main.js                              Main process entry point (173 lines)
+-- preload.js                           Context bridge for IPC (244 lines)
+-- settings.js                          JSON settings store (105 lines)
+-- ipc-handlers.js                      IPC data bridge (~2,200 lines)
+-- services/
|   +-- SwarmOrchestrator.js             Self-managing dispatch engine (764 lines)
|   +-- ClaudeCodeService.js             Claude CLI process management (370 lines)
|   +-- CodexService.js                  Codex CLI process management (225 lines)
|   +-- PromptBuilder.js                 Worker prompt construction (372 lines)
|   +-- ProjectService.js               Project detection and context loading (193 lines)
|   +-- CommandsService.js              Command file CRUD and generation (651 lines)
|   +-- TaskEditorService.js            Swarm and task CRUD operations (377 lines)
|   +-- ConversationService.js          Chat conversation persistence (143 lines)
|   +-- DebugService.js                 IDE debug session management (796 lines)
|   +-- TerminalService.js             Integrated terminal (PTY) management (182 lines)
|   +-- InstrumentService.js          Project file instrumentation for Live Preview
|   +-- PreviewService.js             Label-to-source file mapping for Live Preview
|   +-- PreviewTextWriter.js          Text update writer for Live Preview edits
+-- assets/
    +-- icon.icns                        macOS app icon
    +-- icon.iconset/                    Icon set with multiple resolutions
```

### File Descriptions

| File | Description |
|---|---|
| `main.js` | Electron main process entry point. Registers the custom `app://synapse/` protocol scheme, creates the BrowserWindow, manages app lifecycle (ready, activate, window-all-closed), and saves window state (size, position) on resize/move. Loads `app://synapse/dist/index.html` as the app content. |
| `preload.js` | Context bridge that exposes `window.electronAPI` to the renderer process. Defines a push channel whitelist (33 channels for main-to-renderer events) and ~140 `ipcRenderer.invoke()` methods for renderer-to-main requests. All methods are organized by domain: dashboards, archives, history, queue, settings, project, task editor, commands, workers, orchestration, conversations, terminal, IDE, debug, git, preview, and file handling. |
| `settings.js` | A simple JSON file-backed settings store. Persists settings to `{userData}/synapse-settings.json` (where `{userData}` is the OS-specific user data directory, e.g., `~/Library/Application Support/synapse` on macOS). Stores window dimensions, position, maximized state, recent projects, and user preferences. Provides `get()`, `set()`, `getAll()`, `reset()`, and `init()` methods. |
| `ipc-handlers.js` | The largest Electron file. Registers all `ipcMain.handle()` handlers that bridge renderer IPC requests to server-side services. Also creates the broadcast function that routes file watcher events to the renderer via `webContents.send()`, and feeds progress updates to the SwarmOrchestrator. Sets up file watchers on startup and sends initial data to the renderer once the window is ready. |

### Electron Services

| Service | Description |
|---|---|
| `SwarmOrchestrator.js` | Implements the complete swarm dispatch loop for desktop mode. Reads the dependency graph from `initialization.json`, dispatches workers for unblocked tasks, handles task completion/failure, implements the circuit breaker (3+ wave failures, blast radius check), triggers automatic replanning via Claude CLI, and applies revised plans. Supports start, pause, resume, cancel, and retry operations. |
| `ClaudeCodeService.js` | Manages Claude Code CLI child processes. Spawns workers with configured prompts, system prompts, and model settings. Streams stdout/stderr to the renderer via IPC events (`worker-output`, `worker-complete`, `worker-error`). Tracks active workers and provides kill/killAll operations. |
| `CodexService.js` | Same as ClaudeCodeService but for the Codex CLI provider. Provides an alternative agent backend. |
| `PromptBuilder.js` | Constructs complete, self-contained prompts for worker agents. Builds system prompts (with tracker root, dashboard ID, task ID), task prompts (with project context, upstream results, task description), and replan prompts (with failure analysis context). Reads upstream task results from completed dependency progress files. |
| `ProjectService.js` | Handles project directory detection, context loading (reads CLAUDE.md files from the project root and one level of child directories), CLI detection (checks if `claude` or `codex` binaries are available), and directory scanning for the project explorer. |
| `CommandsService.js` | CRUD operations for command files in `_commands/` directories. Supports listing, reading, saving, and deleting commands. Also supports generating new commands via CLI and loading project-specific commands from `{project_root}/_commands/`. |
| `TaskEditorService.js` | Provides CRUD operations for swarm plans. Creates new swarms by writing `initialization.json`, adds/updates/removes individual tasks, manages wave definitions, generates task IDs, and validates dependency graphs for cycles and missing references. |
| `ConversationService.js` | Manages chat conversation persistence. Stores conversations as JSON files in `{tracker_root}/conversations/`. Supports listing (optionally filtered by dashboard), loading, saving, creating, deleting, and renaming conversations. |
| `DebugService.js` | Manages IDE debug sessions. Handles breakpoint management, debug session lifecycle (start, stop, step, continue), variable inspection, call stack retrieval, and debug console evaluation. Communicates debug state to the renderer via IPC events. |
| `TerminalService.js` | Manages integrated terminal instances using node-pty. Spawns PTY processes, handles terminal input/output streaming via IPC, supports resize events, and manages terminal lifecycle (create, destroy, list active terminals). |
| `InstrumentService.js` | Scans project JSX/TSX/HTML files and adds `data-synapse-label` attributes to text-bearing elements (headings, paragraphs, buttons, links) for Live Preview integration. |
| `PreviewService.js` | Maps `data-synapse-label` attributes back to source file locations, enabling the Live Preview to identify which source file and position correspond to a given labeled element. |
| `PreviewTextWriter.js` | Writes text edits from the Live Preview overlay back to the corresponding source files, updating the text content at the mapped location. |

---

## Node.js Server

```
src/server/
+-- index.js                             HTTP server entry point (218 lines)
+-- SSEManager.js                        SSE client management (108 lines)
+-- routes/
|   +-- apiRoutes.js                     REST API route handlers (507 lines)
+-- services/
|   +-- DashboardService.js              Dashboard CRUD operations (232 lines)
|   +-- WatcherService.js                File system watchers (364 lines)
|   +-- DependencyService.js             Dependency graph computation (198 lines)
|   +-- ArchiveService.js                Dashboard archival (72 lines)
|   +-- HistoryService.js                History summary generation (140 lines)
|   +-- QueueService.js                  Overflow queue management (162 lines)
+-- utils/
    +-- constants.js                     Configuration constants (48 lines)
    +-- json.js                          JSON read/write helpers (194 lines)
    +-- validation.js                    Dashboard data validation (88 lines)
```

### File Descriptions

| File | Description |
|---|---|
| `index.js` | Creates the HTTP server using Node.js built-in `http` module. Handles CORS headers, routes SSE connections (`GET /events`), delegates API requests to `apiRoutes.js`, and manages graceful shutdown. On startup, ensures all required directories exist, starts file watchers for all dashboards, starts the dashboards/queue directory watchers, starts periodic reconciliation, and begins the SSE heartbeat. |
| `SSEManager.js` | Manages connected SSE clients. Provides `addClient()`, `removeClient()`, `broadcast()` (sends events to all connected clients), `startHeartbeat()` (15s keepalive pings), and `closeAll()` (graceful shutdown). |
| `apiRoutes.js` | Defines all REST API endpoints. Handles dashboard CRUD (`GET/POST/DELETE /api/dashboards`), per-dashboard data (`GET /api/dashboards/:id/{initialization,logs,progress}`), dashboard operations (`POST /api/dashboards/:id/{clear,archive,save-history}`), export (`GET /api/dashboards/:id/export`), archives (`GET/DELETE /api/archives`), history (`GET /api/history`), and queue (`GET /api/queue`). |

### Server Services

| Service | Description |
|---|---|
| `DashboardService.js` | Core dashboard operations: listing dashboards, ensuring dashboard directories exist (creates `initialization.json`, `logs.json`, `progress/` with defaults), reading dashboard files (sync and async variants), clearing progress directories, copying directories for archival, deleting dashboards, and generating next dashboard IDs. |
| `WatcherService.js` | Manages all file system watchers. For each dashboard, watches `initialization.json` and `logs.json` via `fs.watchFile` (100ms polling) and the `progress/` directory via `fs.watch` (event-based). Also watches the `dashboards/` directory itself for new/removed dashboards, and the `queue/` directory for queue changes. Includes debounced reconciliation to handle `fs.watch` reliability issues, and periodic reconciliation (every 5s) as a fallback. When a task completes, triggers dependency checking via `DependencyService`. |
| `DependencyService.js` | Computes dependency relationships. Given a completed task ID, reads `initialization.json` for the dependency graph and all progress files for current status, then returns a list of task IDs that are newly unblocked (all dependencies satisfied, not yet started). Used by `WatcherService` to emit `tasks_unblocked` events. |
| `ArchiveService.js` | Lists archives in the `Archive/` directory, creates archives by copying dashboard directories, and deletes archive directories. |
| `HistoryService.js` | Lists history summary files from the `history/` directory. Builds history summaries from dashboard data (task name, type, counts, timing, agent details) for lightweight historical reference. |
| `QueueService.js` | Manages the overflow queue for swarms waiting to be promoted to active dashboards. Lists queue items with summaries, reads queue item data (init, logs, progress), and provides the queue directory path. |

### Server Utilities

| File | Description |
|---|---|
| `constants.js` | Central configuration constants. Defines `PORT` (default 3456), directory paths (`DASHBOARDS_DIR`, `QUEUE_DIR`, `ARCHIVE_DIR`, `HISTORY_DIR`, `CONVERSATIONS_DIR`), timing constants (poll intervals, retry delays, debounce periods), MIME types, and default data structures for empty `initialization.json` and `logs.json`. |
| `json.js` | JSON file I/O helpers. Provides `readJSON()` (sync read with parse), `readJSONAsync()` (async read), `readJSONWithRetry()` (async read with retry on parse failure -- handles mid-write race). |
| `validation.js` | Dashboard data validation functions. Provides `isValidInitialization()`, `isValidProgress()`, and `isValidLogs()` that check for required fields and correct types. Used by the server and IPC handlers to validate data before broadcasting. |

---

## React Dashboard UI

```
src/ui/
+-- main.jsx                             Entry point + Electron fetch shim (80 lines)
+-- App.jsx                              Root component (507 lines)
+-- context/
|   +-- AppContext.jsx                   State management (useReducer) (957 lines)
+-- hooks/
|   +-- useDashboardData.js              IPC/SSE event subscription + state merge (407 lines)
|   +-- useElectronAPI.js                API access hook (10 lines)
|   +-- useResize.js                     Resizable panel hook (155 lines)
+-- components/                          54 React components across 4 directories
|   +-- Header.jsx                       Top navigation bar
|   +-- Sidebar.jsx                      Dashboard list with status indicators
|   +-- WavePipeline.jsx                 Wave layout (vertical columns)
|   +-- ChainPipeline.jsx               Chain layout (horizontal rows)
|   +-- AgentCard.jsx                    Individual task card
|   +-- StatsBar.jsx                     Stat counter cards
|   +-- LogPanel.jsx                     Collapsible event log drawer
|   +-- SwarmBuilder.jsx                Visual swarm creation tool
|   +-- ClaudeView.jsx                  In-app agent chat interface
|   +-- HomeView.jsx                    Overview/home dashboard
|   +-- EmptyState.jsx                  Placeholder for empty dashboards
|   +-- ConnectionIndicator.jsx         Connection status indicator
|   +-- TerminalView.jsx               Integrated terminal emulator (xterm.js)
|   +-- BottomPanel.jsx                Resizable bottom panel container
|   +-- MetricsPanel.jsx               Swarm performance metrics
|   +-- TimelinePanel.jsx              Task timeline visualization
|   +-- ProgressBar.jsx                Progress bar component
|   +-- QueuePopup.jsx                 Queue overflow popup
|   +-- modals/                          14 modal components
|   |   +-- Modal.jsx                    Base modal component
|   |   +-- AgentDetails.jsx             Agent detail popup with log viewer
|   |   +-- TaskDetails.jsx              Task detail information
|   |   +-- CommandsModal.jsx           Command browser and editor
|   |   +-- ProjectModal.jsx            Project selection and explorer
|   |   +-- SettingsModal.jsx           Application settings
|   |   +-- TaskEditorModal.jsx         Visual swarm plan editor
|   |   +-- PlanningModal.jsx           Planning interface
|   |   +-- ArchiveModal.jsx            Archive browser
|   |   +-- HistoryModal.jsx            Swarm history browser
|   |   +-- ConfirmModal.jsx            Confirmation dialog
|   |   +-- ErrorModal.jsx              Error display dialog
|   |   +-- PermissionModal.jsx         Permission request dialog
|   |   +-- WorkerTerminal.jsx          Worker output terminal
|   +-- ide/                             10 IDE components
|   |   +-- IDEView.jsx                  IDE layout container
|   |   +-- CodeEditor.jsx              Monaco-based code editor
|   |   +-- FileExplorer.jsx            File tree browser
|   |   +-- DebugToolbar.jsx            Debug controls toolbar
|   |   +-- DebugPanels.jsx             Debug variable/callstack panels
|   |   +-- DebugConsolePanel.jsx       Debug console output
|   |   +-- ProblemsPanel.jsx           Problems/diagnostics panel
|   |   +-- EditorTabs.jsx              Open file tab bar
|   |   +-- WorkspaceTabs.jsx           Workspace tab bar
|   |   +-- IDEWelcome.jsx              IDE welcome screen
|   +-- preview/                         Live Preview components
|   |   +-- PreviewView.jsx              Embedded webview with inline text editing
|   +-- git/                             12 Git management components
|       +-- GitManagerView.jsx           Git manager layout container
|       +-- BranchPanel.jsx             Branch management
|       +-- ChangesPanel.jsx            Staged/unstaged changes
|       +-- CommitPanel.jsx             Commit creation
|       +-- DiffViewer.jsx              File diff display
|       +-- HistoryPanel.jsx            Commit history
|       +-- RemotePanel.jsx             Remote repository management
|       +-- QuickActions.jsx            Quick Git action buttons
|       +-- RepoTabs.jsx               Repository tab bar
|       +-- InitFlow.jsx               Git init wizard
|       +-- SafetyDialogs.jsx          Destructive action confirmations
|       +-- GitWelcome.jsx             Git welcome screen
+-- utils/
|   +-- constants.js                     UI constants (colors, labels) (114 lines)
|   +-- format.js                        Formatting helpers (dates, durations) (22 lines)
|   +-- markdown.js                      Markdown rendering utilities (256 lines)
|   +-- dependencyLines.js              Canvas-based dependency line drawing (664 lines)
|   +-- dashboardProjects.js            Dashboard-project association helpers (61 lines)
|   +-- ideWorkspaceManager.js          IDE workspace state management (142 lines)
|   +-- monacoWorkerSetup.js            Monaco editor web worker setup (35 lines)
+-- styles/                              10 CSS files totaling ~13,776 lines
|   +-- index.css                        Main stylesheet (8,071 lines)
|   +-- git-manager.css                  Git manager styles (2,401 lines)
|   +-- ide-debug.css                    IDE debug styles (1,124 lines)
|   +-- ide-debug-panels.css            Debug panel styles (525 lines)
|   +-- ide-editor.css                   Editor styles (297 lines)
|   +-- ide-explorer.css                File explorer styles (345 lines)
|   +-- ide-layout.css                   IDE layout styles (270 lines)
|   +-- ide-debug-console.css           Debug console styles (288 lines)
|   +-- ide-problems.css                Problems panel styles (233 lines)
|   +-- ide-sidebar.css                  IDE sidebar styles (222 lines)
+-- assets/
    +-- synapse-logo-mark.svg            Synapse logo
```

### Key UI Files

| File | Description |
|---|---|
| `main.jsx` | The application entry point. In Electron mode, patches `window.fetch` to intercept `/api/*` calls and route them through IPC using `window.electronAPI`. This shim returns fetch-compatible response objects so components work identically in both browser and Electron modes. Creates the React root and renders `AppProvider` wrapping `App`. |
| `App.jsx` | Root component that calls `useDashboardData()` to initialize data subscriptions, then renders the layout: Header, Sidebar, main content area (switching between HomeView, dashboard pipeline, SwarmBuilder, ClaudeView based on `activeView`), LogPanel, and modals. |
| `AppContext.jsx` | Central state management using React's `useReducer`. Defines the global state shape (current dashboard, init/progress/logs data, dashboard list, view state, Claude chat state, modal state), the action types (30+ action types), and the reducer function. Provides `useAppState()` and `useDispatch()` hooks. Includes debounced localStorage persistence for Claude chat messages. |
| `useDashboardData.js` | The data engine of the dashboard. Exports `mergeState()` which combines static plan data with dynamic progress data into a renderable state. The `useDashboardData()` hook subscribes to IPC push events, maintains a progress cache via refs, fetches data on dashboard switch, derives dashboard statuses for sidebar indicators, and triggers state merges when init or progress changes. Also includes connection health monitoring (30s check, 60s stale threshold). |

### UI Component Highlights

| Component | Description |
|---|---|
| `WavePipeline` | Renders tasks in vertical columns grouped by wave (dependency level). Each column represents a wave, and cards within a column are independent peers that can run in parallel. Draws dependency lines between cards using the `dependencyLines.js` canvas utility. |
| `ChainPipeline` | Alternative layout that renders tasks in horizontal rows grouped by dependency chain. Cards flow left-to-right through dependency levels. Best for narrow, deep pipelines. |
| `AgentCard` | Renders an individual task card showing: title, status badge (color-coded), stage badge (during execution), elapsed time (live counter), current message, deviation count badge, and dependency indicators. Clicking opens the `AgentDetails` modal. |
| `StatsBar` | Six stat cards showing aggregate swarm metrics: Total tasks, Completed, In Progress, Failed, Pending, and Elapsed time. All values are derived from the merged state (not stored in any file). |
| `LogPanel` | Collapsible bottom drawer showing all log entries from `logs.json`. Supports filtering by level (All, Info, Warn, Error, Deviation). Auto-scrolls to newest entries. |
| `ClaudeView` | In-app agent chat interface. Supports full conversations with Claude, image attachments, markdown rendering, and per-dashboard chat isolation. Messages are persisted to localStorage with debounced saves. |
| `SwarmBuilder` | Visual tool for creating swarm plans from the UI. Allows adding tasks, defining dependencies, setting wave assignments, and generating `initialization.json` without using the CLI. |

---

## Command System

```
_commands/
+-- Synapse/                             Swarm lifecycle commands (highest priority)
|   +-- p_track.md                       Plan + dispatch + track a full swarm
|   +-- p.md                             Lightweight parallel dispatch
|   +-- master_plan_track.md            Multi-stream orchestration
|   +-- project.md                       Set/show/clear target project
|   +-- start.md                         Start the dashboard server
|   +-- stop.md                          Stop the dashboard server
|   +-- status.md                        Terminal status summary
|   +-- reset.md                         Clear dashboard data
|   +-- dispatch.md                      Manually dispatch tasks
|   +-- retry.md                         Re-run failed tasks
|   +-- resume.md                        Resume a stalled swarm
|   +-- cancel.md                        Cancel the active swarm
|   +-- cancel-safe.md                  Graceful shutdown
|   +-- logs.md                          View/filter log entries
|   +-- inspect.md                       Deep-dive into a specific task
|   +-- history.md                       View past swarm history
|   +-- deps.md                          Visualize dependency graph
|   +-- guide.md                         Command decision tree
|   +-- update_dashboard.md             Update dashboard config
+-- project/                             Project analysis commands
|   +-- initialize.md                    Initialize Synapse for a project
|   +-- onboard.md                       Project walkthrough
|   +-- context.md                       Deep context gathering
|   +-- review.md                        Code review
|   +-- health.md                        Project health check
|   +-- scaffold.md                      Generate CLAUDE.md
|   +-- plan.md                          Implementation planning
|   +-- scope.md                         Blast radius analysis
|   +-- trace.md                         End-to-end code tracing
|   +-- contracts.md                     API contract audit
|   +-- env_check.md                     Environment variable audit
|   +-- toc.md                           Search project TOC
|   +-- toc_generate.md                 Generate project TOC
|   +-- toc_update.md                   Update project TOC
|   +-- commands.md                      List all available commands
|   +-- help.md                          Master agent guide
|   +-- profiles.md                      List available profiles
+-- profiles/                            Agent role profiles
    +-- analyst.md
    +-- architect.md
    +-- copywriter.md
    +-- customer-success.md
    +-- devops.md
    +-- founder.md
    +-- growth.md
    +-- legal.md
    +-- marketing.md
    +-- pricing.md
    +-- product.md
    +-- qa.md
    +-- sales.md
    +-- security.md
    +-- technical-writer.md
```

### Command Resolution

Commands are resolved in priority order when a user types `!{command}`:

1. `{tracker_root}/_commands/Synapse/{command}.md` -- Synapse swarm commands (highest)
2. `{tracker_root}/_commands/project/{command}.md` -- Project analysis commands
3. `{project_root}/_commands/{command}.md` -- Project-specific commands (lowest)

Each command file is a complete, self-contained specification in markdown. The agent reads the file and follows it exactly.

### Profiles

Profiles are role modifiers that adjust the agent's priorities, output style, and success criteria. They are applied with `!{profile_name}` before a prompt or command. For example, `!architect !p_track redesign the API layer` dispatches a swarm where all agents operate under the architect profile's priorities.

---

## Agent Instructions

```
agent/instructions/
+-- tracker_master_instructions.md       Dashboard field-to-UI mapping for masters
+-- tracker_worker_instructions.md       Progress reporting protocol for workers
+-- tracker_multi_plan_instructions.md   Multi-stream orchestration guide
+-- dashboard_resolution.md              Dashboard selection and detection protocol
+-- failed_task.md                       Failed task analysis guidance
+-- common_pitfalls.md                   Common mistakes and how to avoid them
```

| File | Description |
|---|---|
| `tracker_master_instructions.md` | Maps every field in `initialization.json` to the UI panel it drives. The master agent must read this before writing any dashboard files to ensure the plan renders correctly. |
| `tracker_worker_instructions.md` | Complete reference for worker progress reporting. Defines the progress file schema, fixed stages, mandatory write points, deviation reporting, upstream dependency reading, log formats, and the return format with EXPORTS. |
| `tracker_multi_plan_instructions.md` | Guide for multi-stream orchestration via `!master_plan_track`. Covers decomposing large tasks into independent swarms across multiple dashboard slots. |
| `dashboard_resolution.md` | Defines dashboard assignment: pre-assigned via system prompt (mandatory, no scanning) > `--dashboard` flag > ask user. |
| `failed_task.md` | Analysis framework for failed tasks. Helps the master agent assess whether to retry, replan, or skip. |
| `common_pitfalls.md` | Catalog of common mistakes agents make and how to avoid them. Covers issues like stale file reads, atomic write failures, dependency cycles, and over-sized tasks. |

---

## Dashboard Data

```
dashboards/
+-- 2d84ac/
|   +-- initialization.json              Static plan data (write-once by master)
|   +-- logs.json                        Timestamped event log (appended by master)
|   +-- progress/                        Worker progress files
|       +-- 1.1.json                     Task 1.1 progress (written by worker)
|       +-- 1.2.json                     Task 1.2 progress (written by worker)
|       +-- 2.1.json                     Task 2.1 progress (written by worker)
+-- 356dc5/
|   +-- initialization.json
|   +-- logs.json
|   +-- progress/
+-- 71894a/
|   +-- ...
+-- ...                                  (additional hex-ID dashboard directories)
```

Each dashboard is a fully independent swarm instance identified by a 6-character hex ID. The directory structure is identical across all dashboards. There is no fixed upper limit on the number of concurrent dashboards.

### File Descriptions

| File | Ownership | Update Pattern | Description |
|---|---|---|---|
| `initialization.json` | Master agent | Write-once (except replan) | Contains the complete swarm plan: task metadata, agent definitions with dependencies, wave structure, and chain definitions. Written during the planning phase and never updated during execution (the only exception is automatic replanning by the circuit breaker). |
| `logs.json` | Master agent / Orchestrator | Append-only | Event log with timestamped entries. Each entry has: `timestamp`, `task_id`, `agent`, `level`, `message`, `task_name`. Levels are `info`, `warn`, `error`, `debug`, `permission`, `deviation`. |
| `progress/{task_id}.json` | Worker agent (sole owner) | Full overwrite on each update | Contains the complete lifecycle state for a single task: status, timestamps, stage, message, milestones, deviations, and detailed logs. The worker writes the full file on every update. The server watches this directory for changes. |

### Data Separation Principle

The architecture deliberately separates static plan data from dynamic execution data:

- `initialization.json` holds **what should happen** (the plan)
- `progress/*.json` files hold **what is happening** (the execution state)
- The dashboard merges them client-side to produce **what to show** (the view)

This separation means:
- The master writes the plan once and never touches it again
- Workers write only their own progress files
- No file is written by multiple agents
- No read-modify-write cycles are needed (eliminating race conditions)
- The dashboard always has the latest data from both sources

---

## Task Records

```
tasks/
+-- 03_22_26/                            Date-based subdirectory (MM_DD_YY)
|   +-- parallel_auth_system.json         Full task record (plan, status, summaries)
|   +-- parallel_plan_auth_system.md     Strategy rationale document
+-- 03_21_26/
    +-- parallel_api_redesign.json
    +-- parallel_plan_api_redesign.md
```

| File | Description |
|---|---|
| `parallel_{name}.json` | The authoritative task record for the swarm. Contains task descriptions, context, critical details, file lists, dependencies, completion status, summaries, and error logs. Updated by the master after each task completion. |
| `parallel_plan_{name}.md` | The strategy rationale document. Explains the decomposition approach, dependency reasoning, wave grouping logic, risk assessment, and verification strategy. Written during planning for the user's review. |

---

## Archive and History

```
Archive/                                 Full dashboard snapshots
+-- 2026-03-21_api_redesign/
|   +-- initialization.json              Copy of the dashboard's plan
|   +-- logs.json                        Copy of the dashboard's event log
|   +-- progress/                        Copy of all worker progress files
|       +-- 1.1.json
|       +-- 1.2.json
|       +-- ...
+-- 2026-03-20_auth_system/
    +-- ...

history/                                 Lightweight summary files
+-- 2026-03-21_api_redesign.json         Summary: name, counts, timing, agents
+-- 2026-03-20_auth_system.json
```

| Directory | Description |
|---|---|
| `Archive/` | Complete snapshots of dashboard state at the time of archival. Contains exact copies of `initialization.json`, `logs.json`, and all progress files. Named with `{YYYY-MM-DD}_{task_name}` format. Used for reviewing past swarms in full detail. The master agent must archive a dashboard before clearing it -- previous swarm data is never discarded. |
| `history/` | Lightweight summary JSON files generated when a dashboard is cleared. Contains the task name, type, total/completed/failed counts, timing information, and per-agent summaries. Used for quick historical reference without loading full archives. |

---

## Queue

```
queue/
+-- queue1/
|   +-- initialization.json
|   +-- logs.json
|   +-- progress/
+-- queue2/
    +-- ...
```

The overflow queue holds swarm plans waiting to be promoted to an active dashboard. Queue items have the same structure as dashboard directories. When capacity allows, a queue item can be promoted to a new dashboard.

---

## Configuration

```
.synapse/                                Synapse configuration directory
+-- project.json                         Stored target project path
```

`project.json` stores the currently configured target project path, set via `!project set /path`:

```json
{
  "project_root": "/Users/dev/repos/my-app"
}
```

The settings file for window state and preferences is stored at `{userData}/synapse-settings.json` (the OS-specific user data directory, outside the repository).

---

## Target Project Structure

When Synapse is initialized for a target project (via `!initialize`), it creates a `.synapse/` directory inside the project:

```
{project_root}/
+-- .synapse/                            Synapse project metadata (add to .gitignore)
|   +-- toc.md                           Project Table of Contents (semantic file index)
|   +-- config.json                      Project-Synapse configuration
+-- CLAUDE.md                            Project conventions (may already exist)
+-- _commands/                           Project-specific commands (optional)
    +-- {command}.md
```

| File | Description |
|---|---|
| `.synapse/toc.md` | A semantic index of the project's files and directories. Generated by `!toc_generate` using a parallel agent swarm. Provides quick orientation for agents without scanning the full file tree. |
| `.synapse/config.json` | Project-Synapse configuration: project name, detected tech stack, initialization timestamp. |
| `CLAUDE.md` | Project conventions, architecture overview, coding standards. May pre-exist. Synapse reads this for context when planning swarms. Can be generated via `!scaffold`. |
| `_commands/*.md` | Project-specific commands. Checked last in the command resolution hierarchy. Allows projects to define custom workflows. |

The `.synapse/` directory should be added to the project's `.gitignore` since it contains Synapse-specific metadata that is not part of the project's source code.
