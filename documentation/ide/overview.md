# Code Explorer Architecture Overview

The Code Explorer is Synapse's dashboard-bound code workspace inside the Code page. It is rendered by `src/ui/pages/code/subpages/code-explorer/CodeExplorerPage.jsx` when `activeView === 'ide'`, and it uses the currently selected dashboard's project folder as its root. There is no independent workspace tab model; switching dashboards changes the active project context.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Code Editor | Monaco Editor ^0.55.1 |
| UI Framework | React 19 |
| Desktop Shell | Electron IPC for file system, search, diagnostics, terminal, and debugger operations |
| Debug Backend | Node.js Inspector Protocol through Electron services |
| Bundling | Vite 8 |
| Styling | Vanilla CSS under `src/ui/pages/code/subpages/code-explorer/styles/` |
| Persistence | Dashboard project bindings and dashboard-keyed editor state |

---

## Current Layout

```
CodePage
  |-- CodeSidebar
  |-- DashboardsPage / CodeExplorerPage / GitPage / PreviewPage
  |-- ClaudeFloatingPanel

CodeExplorerPage
  |-- FileExplorer or SearchPanel
  |-- EditorTabs
  |-- CodeEditor
  |-- DebugToolbar
  |-- DebugPanels
  |-- BottomPanel
```

`CodeExplorerPage` resolves the active project with `getDashboardProject(currentDashboardId)`. If the dashboard has no project folder, the page shows a project setup empty state and lets the user choose a folder through the Electron folder picker.

---

## Data Flow

### Setting a Project

1. The user selects a dashboard in the Code sidebar.
2. The user clicks the project action in Code Explorer when no project is bound.
3. Electron opens a native folder picker through `ideSelectFolder`.
4. The selected folder is saved with `saveDashboardProject(currentDashboardId, pickedPath)`.
5. Code Explorer re-renders against that dashboard-bound project.

### Opening and Editing Files

1. `FileExplorer` lazily loads directory entries through Electron IPC.
2. Selecting a file dispatches `IDE_OPEN_FILE` with the current dashboard id.
3. `CodeEditor` reads file content through `ideReadFile`.
4. Dirty state, open files, active file, diagnostics, and editor navigation are stored in dashboard-keyed app state.
5. Saving writes through `ideWriteFile` and marks the dashboard's file entry clean.

### Search and Diagnostics

`SearchPanel` runs project search against the active dashboard project. `CodeEditor` triggers diagnostics through the existing syntax-check IPC handlers and renders results in the editor and bottom panel.

### Debugging

Debug launch uses the active dashboard project as `cwd`. Debug push events are subscribed through `window.electronAPI.on(...)` and update debug session, call stack, scopes, variables, and console output in shared app state.

---

## Key Files

| Area | File |
|---|---|
| Code shell | `src/ui/pages/code/CodePage.jsx` |
| Code Explorer page | `src/ui/pages/code/subpages/code-explorer/CodeExplorerPage.jsx` |
| File tree | `src/ui/pages/code/subpages/code-explorer/components/FileExplorer.jsx` |
| Search | `src/ui/pages/code/subpages/code-explorer/components/SearchPanel.jsx` |
| Editor tabs | `src/ui/pages/code/subpages/code-explorer/components/EditorTabs.jsx` |
| Monaco editor | `src/ui/pages/code/subpages/code-explorer/components/CodeEditor.jsx` |
| Debug controls | `src/ui/pages/code/subpages/code-explorer/components/DebugToolbar.jsx` |
| Debug panels | `src/ui/pages/code/subpages/code-explorer/components/DebugPanels.jsx` |
| Project binding helpers | `src/ui/utils/dashboardProjects.js` |
| IPC handlers | `electron/ipc-handlers.js` |

---

## Current Constraints

- The dashboard id is required for editor actions because open files and active file state are dashboard-keyed.
- Project folder selection is stored per dashboard, not globally.
- File tree loading is lazy; recursive tree loading should not be reintroduced in the page component because it can overwrite populated tree state with stale responses.
- Git and Preview use the same dashboard project binding, so changing a dashboard project affects all Code subpages.
