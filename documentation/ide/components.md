# Code Explorer Components

This page documents the current Code Explorer component set under `src/ui/pages/code/subpages/code-explorer/`.

---

## `CodeExplorerPage.jsx`

Root page for the code workspace. It resolves `currentDashboardId`, reads the dashboard-bound project path, renders the file/search sidebar, editor area, debug panels, and bottom panel, and handles project selection for dashboards without a project folder.

Key responsibilities:

- Reads the active project with `getDashboardProject(currentDashboardId)`.
- Saves a selected folder with `saveDashboardProject(currentDashboardId, path)`.
- Dispatches dashboard-keyed editor actions such as `IDE_OPEN_FILE`.
- Starts debug sessions with the dashboard project as the working directory.
- Subscribes to debug push events and updates shared debug state.

---

## `FileExplorer.jsx`

Lazy-loads the active dashboard project's directory tree. It receives `dashboardId`, resolves the project root, and loads child folders on expansion instead of recursively reading the full tree.

Key responsibilities:

- Requests directory entries through Electron IPC.
- Opens selected files into dashboard-keyed editor state.
- Keeps tree expansion local to the active dashboard context.

---

## `SearchPanel.jsx`

Searches inside the active dashboard project and opens selected results in the editor. `CodeExplorerPage` switches the left panel between file tree and search through the `ideSidebarView` app-state key.

---

## `EditorTabs.jsx`

Renders open files for the current dashboard and dispatches active-file, close-file, and dirty-state actions. Tabs are scoped by dashboard id so each dashboard can keep its own editor session.

---

## `CodeEditor.jsx`

Wraps Monaco Editor for the active file. It reads and writes files through Electron IPC, tracks dirty state, runs syntax diagnostics, restores breakpoints, and handles editor navigation requests from debug panels.

---

## Debug Components

| Component | Role |
|---|---|
| `DebugToolbar.jsx` | Launch, continue, pause, step, stop, and restart controls |
| `DebugPanels.jsx` | Variables, call stack, breakpoints, and watch views |
| `DebugConsolePanel.jsx` | Debug console output and evaluation |
| `ProblemsPanel.jsx` | Diagnostics and problem list |

Debug state is shared through `AppContext` and updated by Electron push events.

---

## Shared Bottom Panel

`CodeExplorerPage` uses `src/ui/pages/code/subpages/dashboards/components/BottomPanel.jsx` for terminal, output, problems, debug console, and ports views. The terminal and diagnostics operate against the active dashboard project.

---

## Component Boundaries

- `CodePage.jsx` owns the Code shell and chooses which Code subpage to render.
- `CodeExplorerPage.jsx` owns Code Explorer layout and dashboard project selection.
- Individual Code Explorer components receive the dashboard id or derive dashboard-keyed state from context.
- Electron handlers own file system, search, diagnostics, terminal, and debugger side effects.
