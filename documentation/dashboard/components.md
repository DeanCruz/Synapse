# Dashboard Components Reference

This document summarizes the current React component structure for the Synapse Electron UI. The app is now page-centered: `App.jsx` renders shared chrome and modals, then routes to Chat or Code mode.

---

## Root Components

### App (`src/ui/App.jsx`)

The root application component. It calls `useDashboardData()` once, initializes CSS-derived status colors, renders `Header`, switches between `ChatPage` and `CodePage`, and mounts shared modals.

Shared modals live under `src/ui/shared/modals/` and include `AgentDetails`, `ArchiveModal`, `CommandsModal`, `ConfirmModal`, `ErrorModal`, `GuideModal`, `HistoryModal`, `Modal`, `PermissionModal`, `PlanningModal`, `ProjectModal`, `SettingsModal`, `TaskDetails`, `TaskEditorModal`, and `WorkerTerminal`.

### AppProvider (`src/ui/context/AppContext.jsx`)

Context provider wrapping the app. It stores dashboard state, current progress/log/init data, chat state, modal state, Code mode state, debug state, and Git state. See [State Management](./state-management.md).

### Header (`src/ui/shared/Header.jsx`)

Top app chrome with Chat/Code mode controls, Archive, Guide, Commands, active-agent count, and settings access. The Guide button opens `GuideModal`, which loads markdown from `documentation/guide` through Electron IPC.

---

## Chat Mode

### ChatPage (`src/ui/pages/chat/ChatPage.jsx`)

Full-page chat experience with its own sidebar, dashboard-linked chat views, standalone chat instances, conversation persistence, and shared `ClaudeView` integration.

Key supporting components:

| Component | Purpose |
|---|---|
| `ChatSidebar` | Conversation/project navigation |
| `ChatDashboardView` | Dashboard-aware chat context |
| `ChatInstanceView` | Individual persisted chat session |
| `ChatMakePage` | Chat/project creation flow |
| `ClaudeView` | Shared agent chat UI under `src/ui/shared/claude/` |

---

## Code Mode

### CodePage (`src/ui/pages/code/CodePage.jsx`)

Code mode shell. It renders `CodeSidebar` and switches among dashboard monitoring, Code Explorer, Git Manager, and Preview subpages.

### CodeSidebar (`src/ui/pages/code/components/CodeSidebar.jsx`)

Dashboard and subpage navigator. It lists dynamic hex-ID dashboards, supports create/delete/rename/reorder, exposes settings, and lets users switch among Dashboards, Code Explorer, Git Manager, and Preview.

Creating a dashboard opens a folder picker and binds the new dashboard to that project path. The active dashboard's project binding drives Code Explorer, Git Manager, Preview, and worker `{project_root}`.

---

## Dashboards Subpage

### DashboardsPage (`src/ui/pages/code/subpages/dashboards/DashboardsPage.jsx`)

Main swarm visualization surface. It merges static plan data with progress files, shows dashboard action controls, and renders either `WavePipeline` or `ChainPipeline`.

Key components:

| Component | Purpose |
|---|---|
| `WavePipeline` | Column layout grouped by wave, with dependency/sibling lines |
| `ChainPipeline` | Row layout grouped by dependency chain |
| `AgentCard` | Task card with status, stage, message, elapsed time, deviations, and dependency indicators |
| `StatsBar` | Total, Completed, In Progress, Failed, Pending, and Elapsed metrics derived from progress files |
| `ProgressBar` | Overall completion percentage |
| `LogPanel` | `logs.json` event log with level filtering |
| `TimelinePanel` | Task/event timeline |
| `MetricsPanel` | Post-swarm metrics display |
| `BottomPanel` | Terminal/logs/metrics/debug/progress panel container |
| `TerminalView` | PTY-backed xterm terminal |
| `SwarmBuilder` | Visual swarm-plan creation/editing tool |
| `EmptyState` | Placeholder for an empty dashboard |
| `QueuePopup` | Queue status/control popup |

---

## Code Explorer Subpage

### CodeExplorerPage (`src/ui/pages/code/subpages/code-explorer/CodeExplorerPage.jsx`)

Dashboard-project-keyed editor surface. It does not use independent workspace tabs as the primary user model; the selected dashboard's project path is the workspace.

Key components:

| Component | Purpose |
|---|---|
| `FileExplorer` | Lazy file tree browser |
| `CodeEditor` | Monaco editor host |
| `EditorTabs` | Open file tabs and dirty-state indicators |
| `SearchPanel` / `SearchResults` | Project search UI |
| `DebugToolbar` | Debug controls |
| `DebugPanels` | Variables, call stack, breakpoints, and watch panels |
| `DebugConsolePanel` | Debug console |
| `ProblemsPanel` | Diagnostics display |

---

## Git Manager Subpage

### GitPage (`src/ui/pages/code/subpages/git/GitPage.jsx`)

Dashboard-project-keyed Git UI. It discovers the root and nested repositories under the selected dashboard project, then lets users switch active discovered repo tabs.

Key components:

| Component | Purpose |
|---|---|
| `ChangesPanel` | Staged, unstaged, and untracked file lists |
| `CommitPanel` | Commit message input and commit action |
| `DiffViewer` | File diff display |
| `HistoryPanel` | Commit history |
| `BranchPanel` | Branch list and branch actions |
| `RemotePanel` | Remote management |
| `QuickActions` | Common Git commands |
| `InitFlow` | Initialize Git in a non-repo project |
| `SafetyDialogs` | Confirmation dialogs for destructive actions |

---

## Preview Subpage

### PreviewPage (`src/ui/pages/code/subpages/preview/PreviewPage.jsx`)

Embeds a project preview in a webview. It supports manual URL entry, dev-server detection, injected overlay/bridge scripts, and inline text edits through preview instrumentation labels.

---

## Data Components

### useDashboardData (`src/ui/hooks/useDashboardData.js`)

Subscribes to Electron IPC push events and exposes merged dashboard state. The `mergeState()` function combines static `initialization.json` plan data with dynamic worker progress files; statistics are derived from progress rather than stored counters.

### dependencyLines (`src/ui/utils/dependencyLines.js`)

Draws dependency and sibling communication lines for the wave pipeline. It uses card measurements, corridor/pathway grids, and BFS pathfinding to route lines around task cards.
