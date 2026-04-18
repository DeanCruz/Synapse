# Dashboard Components Reference

This document covers every React component in the Synapse Dashboard UI. Components are organized by their role in the application.

---

## Root Components

### App (`src/ui/App.jsx`)

The root application component. Wires IPC data subscriptions, fetches initial data, manages view routing and modal rendering.

**Key responsibilities:**
- Calls `useDashboardData()` to connect IPC listeners (must be called once at App level)
- Initializes CSS-derived status colors via `initStatusColorsFromCSS()`
- Restores saved theme from localStorage on mount
- Fetches initial dashboard statuses and queue items
- Routes between views (`home`, `dashboard`, `swarmBuilder`, `claude`, `git`, `ide`, `preview`)
- Renders modals based on `activeModal` state
- Manages the floating Claude chat panel lifecycle (always mounted for persistent IPC)

**Internal sub-components (all defined in App.jsx):**
- `ClearDashboardSection` -- Renders a "Clear Dashboard" button with confirmation popup when a task has completed (with or without errors). Archives before clearing.
- `ProgressSection` -- Wraps `ProgressBar` + `StatsBar`, reads task completion counts from `currentStatus`
- `ReplanningBanner` -- Shows a pulsing notification when `task.overall_status === 'replanning'` (circuit breaker triggered)
- `DashboardContent` -- The main dashboard area with pipeline visualization, action bar, progress section, and bottom panel
- `ClaudeFloatingPanel` -- Floating wrapper around `ClaudeView` with drag-to-resize via `useResize` hook. Supports four view modes: minimized (pill button), collapsed, expanded (resizable), and maximized. Always mounted so IPC listeners stay alive.
- `ClaudeFloatingHeader` -- Title bar showing "Agent Chat" title, project name, processing status, and window controls (minimize, maximize/restore)

### AppProvider (`src/ui/context/AppContext.jsx`)

Context provider that wraps the entire app. See [State Management](./state-management.md) for details.

---

## Layout Components

### Header (`src/ui/components/Header.jsx`)

Top navigation bar. Sticky-positioned at the top of the viewport.

**Props:** None (reads from context).

**Sections:**
| Section | Contents |
|---|---|
| Left | Logo mark + "Synapse" brand label (clickable, navigates to home) |
| Center | Task name badge + task directory badge (shown when a task is active) |
| Right | Archive dropdown, History button, Commands button (Electron-only), active agents count badge |

**State used:**
- `currentStatus` -- Task name, directory, active agent count
- `connected` -- Connection status

**Archive dropdown items:**
- "Archive task" -- Archives the current dashboard's task
- "View Archive" -- Navigates to home view

### Sidebar (`src/ui/components/Sidebar.jsx`)

Left sidebar showing the dashboard selector, per-dashboard actions, queue items, and settings.

**Props:** None (reads from context).

**Features:**
- Collapsible (toggle button in header)
- Dashboard list with color-coded status dots
- Per-dashboard action buttons: Project (map icon), Agent Chat (chat icon), Delete (X icon)
- Add dashboard button (+)
- Queue items section (shown when queue is non-empty)
- Delete confirmation popup with "Archive & Close" / "Cancel" options
- Settings button in footer

**Sub-components:**
- `StatusDot({ status })` -- Renders a colored circle based on status (`idle`, `in_progress`, `completed`, `error`)

**Status dot colors:**
| Status | CSS Class |
|---|---|
| `idle` | `.dashboard-item-status.idle` |
| `in_progress` | `.dashboard-item-status.in-progress` |
| `completed` | `.dashboard-item-status.completed` |
| `error` | `.dashboard-item-status.error` |

---

## Pipeline Visualization

### WavePipeline (`src/ui/components/WavePipeline.jsx`)

Wave column layout -- the primary visualization mode. Renders agents in vertical columns grouped by wave.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `status` | `object` | Merged status object: `{ agents[], waves[], chains[] }` |
| `activeStatFilter` | `string \| null` | Filter agents by status string, or `null` for all |
| `onAgentClick` | `function(agent)` | Called with agent object when a card is clicked |
| `progressData` | `object` | `{ [taskId]: progressObject }` -- Raw progress data passed to AgentDetails |

**Key behavior:**
- Renders an SVG overlay for dependency lines (BFS-routed through corridor gaps)
- Uses `ResizeObserver` to redraw lines when the container resizes
- Shows an "unblocked tasks" toast notification that auto-dismisses after 8 seconds
- Precomputes per-wave completed/total counts for wave headers
- Filters agents by `activeStatFilter` and hides empty waves when filtering

**Sub-components:**
- `WaveHeader({ wave })` -- Displays wave title, completed/total count, and status badge

**Dependency line integration:**
- Calls `drawDependencyLines(svg, agents, agentMap, cardElements, container)` on render
- Calls `setupCardHoverEffects(container, svg)` for hover highlight behavior

### ChainPipeline (`src/ui/components/ChainPipeline.jsx`)

Chain row layout -- alternative visualization for narrow, deep dependency pipelines.

**Props:** Same as `WavePipeline`.

**Layout structure:**
```
+---------------+----------+----------+----------+
| (empty)       | Wave 1   | Wave 2   | Wave 3   |   <- header row
+---------------+----------+----------+----------+
| Chain A       | [card]   | [card]   | [card]   |   <- chain row
+---------------+----------+----------+----------+
| Chain B       | [card]   |          | [card]   |   <- chain row
+---------------+----------+----------+----------+
```

- Wave column headers show status badges
- Chain labels are sticky-positioned on the left
- Each cell contains at most one agent card
- Chains with no visible agents are hidden when filtering

**Sub-components:**
- `ChainWaveHeader({ wave })` -- Renders wave title + status badge in the header row

### AgentCard (`src/ui/components/AgentCard.jsx`)

Individual agent task card. Displayed in both Wave and Chain pipelines.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `agent` | `object` | Agent object with all merged fields |
| `onClick` | `function(agent)` | Called when card is clicked |

**Agent object shape:**
```javascript
{
  id: string,              // e.g., "1.1"
  title: string,           // Task title
  status: string,          // 'pending' | 'in_progress' | 'completed' | 'failed' | 'claimed'
  wave: number,            // Wave ID
  layer: string | null,    // Layer label (e.g., "Backend")
  directory: string | null,// Directory context
  assigned_agent: string,  // e.g., "Agent 1"
  started_at: ISO | null,
  completed_at: ISO | null,
  summary: string | null,
  stage: string | null,    // Current stage
  message: string | null,  // Current milestone message
  milestones: [],
  deviations: [],
  depends_on: [],
  logs: [],
}
```

**Card layout:**
```
+-------------------------------------------+
| [ID] [status dot] [title]                 |  <- top row
| [layer badge] [directory badge] [agent]   |  <- meta row
|-------------------------------------------|
| {status-dependent bottom content}          |  <- bottom row
| [deviation badge if any]                   |
+-------------------------------------------+
```

**Status-dependent bottom content:**

| Status | Content |
|---|---|
| `completed` | Summary text + duration |
| `in_progress` | Stage badge + elapsed timer + milestone message |
| `failed` | Failure summary text |
| `pending` | "Waiting..." (italic) |

**Exported sub-components:**
- `StatusBadge({ status })` -- Color-coded uppercase label badge (used by wave headers and agent details)

**Internal sub-components:**
- `ElapsedTimer({ startedAt })` -- Live-updating timer that refreshes every second

### StatusBadge (`src/ui/components/AgentCard.jsx`)

Named export from AgentCard. Renders a colored status label badge.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `status` | `string` | Status string (underscores replaced with spaces for display) |

**Styling:** Background from `STATUS_BG_COLORS`, text color from `STATUS_COLORS`, border at 30% alpha.

---

## Stats and Progress

### StatsBar (`src/ui/components/StatsBar.jsx`)

Six stat cards showing task counts and elapsed time.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `onOpenTimeline` | `function` | Called when the Elapsed card is clicked |

**Cards rendered:**

| Card | Value Source | Number Class | Click Behavior |
|---|---|---|---|
| Total | `task.total_tasks` | `total` | Clears filter |
| Completed | `task.completed_tasks` | `completed` | Filters to `completed` |
| In Progress | Count of `in_progress` agents | `in-progress` | Filters to `in_progress` |
| Failed | `task.failed_tasks` | `failed` | Filters to `failed` |
| Pending | Count of `pending` agents | `pending` | Filters to `pending` |
| Elapsed | Live timer or final duration | `total` | Opens timeline panel |

**Elapsed timer behavior:**
- Shows `"--"` when no task is started
- Shows live `formatElapsed()` when task is running (updates every second)
- Shows final `calcDuration()` when task is completed

**Internal sub-components:**
- `StatCard({ id, value, label, numberClass, isActive, onClick })` -- Individual stat card with active highlight and keyboard accessibility

---

## Log and Timeline

### LogPanel (`src/ui/components/LogPanel.jsx`)

Event log viewer showing log entries. Now rendered inside `BottomPanel` as the "OUTPUT" tab rather than as a standalone fixed-position drawer.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `logs` | `object` | Logs payload: `{ entries: [...] }` |
| `activeFilter` | `string` | Current filter level: `'all'` or a level string |
| `onFilterChange` | `function(level)` | Called when a filter button is clicked |

**Features:**
- Collapsible toggle button showing entry count
- Filter bar with buttons: All, Info, Warn, Error, Deviation (with per-level counts)
- Auto-scrolls to bottom when new entries arrive (only if user is near bottom)
- Each entry shows: timestamp, task_id, agent, level badge, message

**Internal sub-components:**
- `LogRow({ entry })` -- Single log entry row with color-coded level badge

**Filter levels:** `['all', 'info', 'warn', 'error', 'deviation']`

### TimelinePanel (`src/ui/components/TimelinePanel.jsx`)

Side panel showing a chronological timeline of task events.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `status` | `object` | Merged status with `active_task`, `agents`, `history` |
| `visible` | `boolean` | Whether the panel is expanded |
| `onClose` | `function` | Callback to close the panel |

**Events displayed:**
- Task started (from `task.started_at`)
- Agent started (from each agent's `started_at`)
- Agent completed/failed (from each agent's `completed_at`)
- Task completed (from `task.completed_at`)

Events are sorted chronologically. History entries (from `init.history`) are shown below a divider.

**Internal sub-components:**
- `TimelineEntry({ event })` -- Single event with colored dot, time, label, and title
- `HistoryEntry({ histTask })` -- Historical task with colored dot, name, and duration

---

## Views

### HomeView (`src/ui/components/HomeView.jsx`)

Overview page showing all dashboards, archives, and history.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `dashboardStates` | `object` | `{ [dashboardId]: statusObj }` |
| `dashboardList` | `string[]` | Ordered list of dashboard IDs |
| `allDashboardLogs` | `object` | `{ [dashboardId]: { entries: [...] } }` |
| `onSwitchDashboard` | `function(id)` | Switch to a dashboard |
| `onArchiveClick` | `function(archive)` | Open an archive |

**Sections:**
1. **Active Dashboards** -- Cards for dashboards with active tasks (progress bar, task info)
2. **Inactive Dashboards** -- Simple items for idle dashboards
3. **Recently Archived** -- Archived task entries (clickable to view)
4. **Recent History** -- Completed task history entries

**Internal sub-components:**
- `HomeSection({ title, empty, children })` -- Section wrapper with title and empty state
- `DashboardCard({ dashboard, onClick })` -- Active dashboard card with progress bar
- `IdleItem({ dashboard, onClick })` -- Simple idle dashboard item
- `ArchiveEntry({ archive, onClick })` -- Archive entry with task name and date
- `HistoryEntry({ item })` -- History entry with stats, duration, and date

### SwarmBuilder (`src/ui/components/SwarmBuilder.jsx`)

Visual swarm plan editor for creating and editing task plans.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `onLaunch` | `function(initData)` | Called with complete init data when launched |
| `onCancel` | `function` | Called when cancelled |
| `initData` | `object \| null` | Existing init data to edit |
| `dashboardId` | `string` | Target dashboard ID |

**Features:**
- Swarm name input + type toggle (Waves/Chains)
- Tasks grouped by wave with add/edit/delete controls
- Task editor modal for individual task configuration
- Launch button that produces a complete `initialization.json` structure
- Empty state when no tasks are added

### ClaudeView (`src/ui/components/ClaudeView.jsx`)

Full in-app agent chat interface. Now rendered inside a `ClaudeFloatingPanel` wrapper (defined in `App.jsx`) that provides floating panel behavior with four view modes: minimized, collapsed, expanded, and maximized. The `ClaudeFloatingPanel` uses the `useResize` hook for drag-to-resize from the left edge, top edge, and top-left corner when in expanded mode.

**Key features:**
- Multi-provider support (Claude, Codex) with model selection
- Streaming message rendering with markdown support
- Tool call visualization (collapsible, shows server tool results)
- File attachment support (images, documents)
- System prompt injection with Synapse CLAUDE.md + project CLAUDE.md
- Per-dashboard, per-tab chat history persisted in localStorage
- Follow-up messages while agent is still running
- Multi-tab chat support (create, switch, close, rename tabs per dashboard)

**Message types rendered:**

| Type | Renderer | Description |
|---|---|---|
| `user` | `.claude-message.claude-user` | User messages (right-aligned) |
| `assistant` | `.claude-message.claude-assistant` | Assistant messages with `pre-wrap` and `break-all` |
| `tool_call` | `ToolCallBlock` sub-component | Collapsible tool call with name, input, and result sections |
| `tool_result_standalone` | Inline-styled `<div>` | Standalone tool results — uses `overflowWrap: 'break-word'`, `wordBreak: 'break-word'`, and `minWidth: 0` to prevent long paths from overflowing |
| `system` | `.claude-system-msg` | System messages, optionally styled as errors |
| `thinking` | `ThinkingBubble` sub-component | Extended thinking blocks with expand/collapse |

**Sub-components:**
- `ToolCallBlock` — Collapsible panel showing tool name, input preview, and result. Uses `.claude-tool-call` CSS class with `.expanded` and `.has-result` modifiers.
- `ThinkingBubble` — Expandable thinking block with animated dots indicator. Uses `.claude-thinking-bubble` CSS class.

### EmptyState (`src/ui/components/EmptyState.jsx`)

Simple placeholder shown when no active task is loaded.

**Props:** None.

**Renders:** "No active agents" title + "Waiting for !p to dispatch agents..." subtitle.

---

## Bottom Panel and Terminal

### BottomPanel (`src/ui/components/BottomPanel.jsx`)

VS Code-style bottom panel with tabbed views for Terminal, Output, Problems, Debug Console, and Ports. Supports drag-to-resize from the top edge and can be embedded (IDE mode) or used as an overlay (dashboard mode).

**Props:**

| Prop | Type | Description |
|---|---|---|
| `logs` | `object` | Logs payload: `{ entries: [...] }` |
| `activeFilter` | `string` | Current log filter level |
| `onFilterChange` | `function(level)` | Called when a log filter button is clicked |
| `projectDir` | `string` | Working directory for the terminal |

**Tabs:**

| Tab ID | Label | Component |
|---|---|---|
| `terminal` | TERMINAL | `TerminalView` (PTY-backed) |
| `problems` | PROBLEMS | `ProblemsPanel` |
| `output` | OUTPUT | `LogPanel` |
| `debug-console` | DEBUG CONSOLE | `DebugConsolePanel` |
| `ports` | PORTS | Placeholder |

**Features:**
- Collapsible toggle (shows/hides the panel body)
- Drag-to-resize from top edge
- Multiple terminal instances via sub-tabs (up to 5)
- Default height: 300px, minimum: 120px

### TerminalView (`src/ui/components/TerminalView.jsx`)

Interactive terminal component using @xterm/xterm. Renders a PTY-backed terminal inside the bottom panel. Communicates with the Electron main process via IPC for spawning, writing, resizing, and killing terminal sessions.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `projectDir` | `string` | Working directory for the terminal process |
| `tabId` | `string` | Terminal tab identifier |

**Features:**
- Full PTY terminal via xterm.js with FitAddon for auto-sizing
- Theme colors derived from CSS custom properties (e.g., `--terminal-bg`, `--terminal-fg`, `--terminal-cursor`)
- IPC channels for spawn, write, resize, and kill operations

### MetricsPanel (`src/ui/components/MetricsPanel.jsx`)

Collapsible panel showing swarm performance metrics. Fetches from `GET /api/dashboards/:id/metrics` on mount and polls every 10 seconds.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `dashboardId` | `string` | Dashboard ID to fetch metrics for |

**Features:**
- Auto-polling with 10-second interval
- Duration formatting utility (seconds to human-readable)
- Collapsible display

### ProgressBar (`src/ui/components/ProgressBar.jsx`)

Thin horizontal fill bar showing task completion percentage.

**Props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `completed` | `number` | `0` | Number of completed tasks |
| `total` | `number` | `0` | Total number of tasks |

Renders a `role="progressbar"` element with ARIA attributes. Fill width transitions with `cubic-bezier(0.16, 1, 0.3, 1)`.

---

## Git Manager

### GitManagerView (`src/ui/components/git/GitManagerView.jsx`)

Full Git repository manager view with multi-repo tab support. Activated via the `'git'` view.

**Sub-components (all in `src/ui/components/git/`):**

| Component | File | Description |
|---|---|---|
| `GitManagerView` | `GitManagerView.jsx` | Root view with repo tabs and panel layout |
| `GitWelcome` | `GitWelcome.jsx` | Welcome screen shown when no repo is open |
| `RepoTabs` | `RepoTabs.jsx` | Tab bar for switching between open repositories |
| `BranchPanel` | `BranchPanel.jsx` | Branch listing, switching, creation |
| `ChangesPanel` | `ChangesPanel.jsx` | Staged/unstaged/untracked file changes |
| `CommitPanel` | `CommitPanel.jsx` | Commit message input and commit action |
| `DiffViewer` | `DiffViewer.jsx` | Side-by-side or unified diff display |
| `HistoryPanel` | `HistoryPanel.jsx` | Git log with commit history |
| `RemotePanel` | `RemotePanel.jsx` | Remote repository management |
| `InitFlow` | `InitFlow.jsx` | Git init workflow for non-repo directories |
| `QuickActions` | `QuickActions.jsx` | Common git operations (pull, push, fetch) |
| `SafetyDialogs` | `SafetyDialogs.jsx` | Confirmation dialogs for destructive operations |

**State:** Uses `GIT_*` action types in AppContext (see [State Management](./state-management.md)).

---

## IDE

### IDEView (`src/ui/components/ide/IDEView.jsx`)

Multi-workspace code editor view with file explorer, editor tabs, debug support, and integrated chat. Activated via the `'ide'` view.

**Sub-components (all in `src/ui/components/ide/`):**

| Component | File | Description |
|---|---|---|
| `IDEView` | `IDEView.jsx` | Root IDE layout with sidebar, editor area, and bottom panel |
| `IDEWelcome` | `IDEWelcome.jsx` | Welcome screen when no workspace is open |
| `FileExplorer` | `FileExplorer.jsx` | Tree-view file browser with lazy-loaded children |
| `WorkspaceTabs` | `WorkspaceTabs.jsx` | Tab bar for switching between open workspaces |
| `EditorTabs` | `EditorTabs.jsx` | Tab bar for open files within a workspace |
| `CodeEditor` | `CodeEditor.jsx` | Code display/editing area |
| `DebugToolbar` | `DebugToolbar.jsx` | Debug controls (continue, step over, step into, etc.) |
| `DebugPanels` | `DebugPanels.jsx` | Variables, call stack, breakpoints, watch expressions |
| `DebugConsolePanel` | `DebugConsolePanel.jsx` | Debug console output and input |
| `ProblemsPanel` | `ProblemsPanel.jsx` | Diagnostics display (errors, warnings, info) |
| `SearchPanel` | `SearchPanel.jsx` | IDE search sidebar with text/regex/case/word search, replace, and glob filters |
| `SearchResults` | `SearchResults.jsx` | Grouped search results with highlighted matches and file navigation |

**State:** Uses `IDE_*` and `DEBUG_*` action types in AppContext (see [State Management](./state-management.md)).

---

## Live Preview

### PreviewView (`src/ui/components/preview/PreviewView.jsx`)

Live Preview tab that embeds the running web application in a webview and enables inline text editing. Users can double-click any text element with a `data-synapse-label` attribute to edit it directly, and the change is written back to the source file automatically.

**Props:** None (reads from context).

**Features:**
- URL input for the dev server address (e.g., `http://localhost:3000`)
- Embedded webview with overlay script injection (`inject-overlay.js`)
- Double-click on labeled elements opens an inline text editor
- Text edits are sent to the main process via `preview-edit-request` IPC channel
- PreviewService resolves the label to the source file location
- PreviewTextWriter writes the updated text back to the source code
- Supports React, Next.js, Vite, and any HTML/JS project with instrumented labels

**How it works:**
1. User runs `!instrument` to add `data-synapse-label` attributes to project files
2. User starts their dev server and enters the URL in the Preview tab
3. The webview loads the app with an injected overlay script
4. The overlay detects elements with `data-synapse-label` and enables double-click editing
5. On edit, the new text and label are sent via IPC to the Electron main process
6. PreviewService maps the label to the source file, PreviewTextWriter updates the code

---

## Modals

### Modal (`src/ui/components/modals/Modal.jsx`)

Base modal wrapper component used by all other modals.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `title` | `string` | Modal header title |
| `onClose` | `function` | Close callback |
| `children` | `React.node` | Modal body content |
| `className` | `string` | Optional extra CSS class |

**Features:**
- Overlay with blur backdrop
- Closes on Escape key
- Closes on click outside the modal
- ARIA `role="dialog"` and `aria-modal="true"`

### AgentDetails (`src/ui/components/modals/AgentDetails.jsx`)

Detailed view of a single agent's lifecycle, shown when clicking an agent card.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `agent` | `object` | The agent object from the merged status |
| `progressData` | `object` | `{ [taskId]: progressObject }` |
| `findAgentFn` | `function(id)` | Lookup function for dependency agents |
| `onClose` | `function` | Close callback |
| `projectRoot` | `string` | Project root path (for file navigation) |

**Sections displayed:**
1. **Header** -- Agent ID badge + title
2. **Badges** -- Status, wave, layer, directory, assigned agent
3. **Summary** -- Completion summary text
4. **Dependencies** -- List of dependency chips with status-colored borders
5. **Meta grid** -- Started, Completed, Duration, Status (2-column grid)
6. **Milestones** -- Chronological list with timestamps
7. **Deviations** -- Plan divergences with yellow styling
8. **Activity Log** -- Scrollable log box with level-colored entries

### CommandsModal (`src/ui/components/modals/CommandsModal.jsx`)

Browse, view, edit, add, and delete command `.md` files.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `onClose` | `function` | Close callback |
| `projectDir` | `string` | Project directory for project-specific commands |

**Layout:** Sidebar list (grouped by folder, collapsible) + content viewer/editor.

**States:** `placeholder` (no selection), `view` (viewing a command), `edit` (editing), `generate` (AI-generating a new command)

**Internal sub-components:**
- `CommandFolder` -- Collapsible folder with command list
- `CommandViewer` -- Displays command content with edit/delete buttons
- `CommandEditor` -- Markdown editor for command files
- `CommandGenerator` -- AI-powered command generation via Claude CLI

### SettingsModal (`src/ui/components/modals/SettingsModal.jsx`)

Theme picker and application configuration.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `onClose` | `function` | Close callback |
| `currentTheme` | `string` | Current theme identifier |
| `onThemeChange` | `function(theme)` | Theme change callback |

**Sections:**
1. **Color Theme** -- Theme cards (Original, Light, Custom) with color swatches
2. **Custom Color Picker** -- Color inputs for bg, surface, text, accent, completed, error (shown when Custom is active)
3. **App Configuration** -- Numeric inputs for dashboard count, polling intervals (Electron-only)

**Built-in themes:** Original (dark), Light

### ProjectModal (`src/ui/components/modals/ProjectModal.jsx`)

Per-dashboard project directory selector.

### PlanningModal (`src/ui/components/modals/PlanningModal.jsx`)

Swarm planning workflow modal.

### Other Modals

| Modal | File | Purpose |
|---|---|---|
| `ArchiveModal` | `modals/ArchiveModal.jsx` | Archive browsing |
| `ConfirmModal` | `modals/ConfirmModal.jsx` | Generic confirmation dialog |
| `ErrorModal` | `modals/ErrorModal.jsx` | Error display |
| `HistoryModal` | `modals/HistoryModal.jsx` | History viewing |
| `LogsModal` | `modals/LogsModal.jsx` | Full-screen log viewer with filter, search, and auto-scroll |
| `PermissionModal` | `modals/PermissionModal.jsx` | Permission request popup |
| `TaskDetails` | `modals/TaskDetails.jsx` | Task detail view |
| `TaskEditorModal` | `modals/TaskEditorModal.jsx` | Individual task editor (used by SwarmBuilder) |
| `WorkerTerminal` | `modals/WorkerTerminal.jsx` | Worker terminal output |
