# Code Explorer (IDE) Architecture Overview

The Code Explorer is Synapse's built-in IDE, accessible via a tab in the sidebar alongside the Dashboards tab. It provides a file explorer, Monaco-powered code editor with breakpoint support, multi-workspace tabs, an integrated Node.js debugger with VS Code-style debug panels, syntax diagnostics, and a bridge to link workspaces with dashboards for integrated Claude chat.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Code Editor | Monaco Editor ^0.55.1 (VS Code's editor component) |
| UI Framework | React 19 (functional components, hooks, Context) |
| Desktop Shell | Electron (IPC for file system access, debugging, diagnostics) |
| Debug Backend | Node.js Inspector Protocol via Chrome DevTools Protocol (CDP) |
| Bundling | Vite 8 (Monaco worker pre-bundling, ES worker format) |
| Styling | Vanilla CSS with Synapse design tokens (CSS custom properties) |
| Persistence | localStorage (workspaces, workspace-dashboard mappings) |

---

## High-Level Architecture

```
Sidebar Tab Bar
  |-- "Code Explorer" tab --> SET_VIEW 'ide'
  |-- "Dashboards" tab   --> SET_VIEW 'dashboard'
      |
      v
IDEView (main layout)
  |-- WorkspaceTabs          -- Folder workspace tab bar
  |-- FileExplorer           -- Lazy-loaded directory tree
  |-- EditorTabs             -- Open file tab bar
  |-- CodeEditor             -- Monaco Editor wrapper (breakpoints, diagnostics)
  |-- DebugToolbar           -- Debug controls (play/pause/step/stop/restart)
  |-- DebugPanels            -- Debug sidebar (Variables, Call Stack, Breakpoints, Watch)
  |-- BottomPanel            -- VS Code-style bottom panel
  |   |-- Terminal tab
  |   |-- Output tab
  |   |-- Problems tab       -- ProblemsPanel (diagnostics aggregation)
  |   |-- Debug Console tab  -- DebugConsolePanel (REPL + output)
  |   |-- Ports tab
  |-- IDEWelcome             -- Welcome screen (no workspaces open)
      |
      v
Electron IPC
  |-- File System (9 handlers)
  |   |-- ide-read-file          -- Read file contents
  |   |-- ide-write-file         -- Save file contents
  |   |-- ide-read-dir           -- Recursive directory tree
  |   |-- ide-list-dir           -- Single-level directory listing (lazy load)
  |   |-- ide-create-file        -- Create new file
  |   |-- ide-create-folder      -- Create new directory
  |   |-- ide-rename             -- Rename file or folder
  |   |-- ide-delete             -- Delete file or folder
  |   |-- ide-select-folder      -- Native OS folder picker
  |
  |-- Diagnostics (2 handlers + 5 helpers)
  |   |-- ide-check-syntax       -- Check syntax of a single file
  |   |-- ide-check-syntax-batch -- Check syntax of multiple files
  |
  |-- Debug (13 handlers)
      |-- debug-launch           -- Start a Node.js debug session
      |-- debug-stop             -- Stop the active debug session
      |-- debug-set-breakpoint   -- Set breakpoint at file:line
      |-- debug-remove-breakpoint -- Remove breakpoint by ID
      |-- debug-continue         -- Resume execution
      |-- debug-pause            -- Pause execution
      |-- debug-step-over        -- Step over current statement
      |-- debug-step-into        -- Step into next function call
      |-- debug-step-out         -- Step out of current function
      |-- debug-evaluate         -- Evaluate expression in debug context
      |-- debug-get-variables    -- Get variables for a scope/object
      |-- debug-get-scopes       -- Get scopes for paused state
      |-- debug-session-info     -- Get current debug session info
```

---

## Component Hierarchy

```
<App>
  <Sidebar>
    Tab Bar: [Code Explorer] [Dashboards]
  </Sidebar>

  {activeView === 'ide' && (
    <IDEView>
      {hasWorkspaces ? (
        <>
          <WorkspaceTabs />
          <ide-main>
            <FileExplorer />       (draggable width: 180-500px)
            <ide-divider />        (drag handle)
            <ide-editor-area>
              <EditorTabs />
              {debugSession.status !== 'idle' && <DebugToolbar />}
              <ide-editor-content>
                <ide-editor-and-debug>
                  <ide-editor-main>
                    <CodeEditor />   (Monaco + breakpoints + diagnostics)
                  </ide-editor-main>
                  {debugSession.status !== 'idle' && (
                    <ide-debug-sidebar>
                      <DebugPanels />  (Variables, Call Stack, Breakpoints, Watch)
                    </ide-debug-sidebar>
                  )}
                </ide-editor-and-debug>
              </ide-editor-content>
            </ide-editor-area>
          </ide-main>
          <BottomPanel>
            Terminal | Output | Problems (ProblemsPanel) | Debug Console (DebugConsolePanel) | Ports
          </BottomPanel>
        </>
      ) : (
        <>
          <IDEWelcome />
          <BottomPanel />          (embedded mode)
        </>
      )}
    </IDEView>
  )}
</App>
```

---

## Data Flow

### Opening a Workspace

```
1. User clicks "Open Folder" (IDEWelcome or WorkspaceTabs + button)
2. electronAPI.ideSelectFolder() --> native OS dialog
3. User selects folder
4. Dispatch IDE_OPEN_WORKSPACE { path, name, id }
5. createWorkspaceDashboard(wsId) --> links workspace to a new dashboard
6. saveDashboardProject(dashboardId, folderPath) --> associates project path
7. FileExplorer effect detects new workspace, calls electronAPI.ideListDir(path)
8. Dispatch IDE_SET_FILE_TREE { workspaceId, tree }
9. FileExplorer renders root-level directory tree (lazy-loaded on expand)
```

### Opening a File

```
1. User clicks file in FileExplorer tree
2. Dispatch IDE_OPEN_FILE { workspaceId, file: { path, name } }
   (duplicate check: if already open, switches to it instead)
3. CodeEditor effect detects filePath change
4. electronAPI.ideReadFile(filePath, workspacePath)
5. Language auto-detected from file extension
6. Monaco model created/updated with content
7. onDidChangeModelContent listener attached for dirty tracking
8. Syntax diagnostics triggered (debounced 500ms) via ideCheckSyntax IPC
9. Existing breakpoints restored from debugBreakpoints state
```

### Saving a File

```
1. User presses Cmd+S / Ctrl+S in Monaco
2. CodeEditor.handleSave() fires
3. electronAPI.ideWriteFile(filePath, content, workspacePath)
4. Dispatch IDE_MARK_FILE_CLEAN { workspaceId, fileId }
5. "Saved" toast fades in and out (1.5s)
6. Syntax diagnostics re-triggered after save
```

### Dirty File Detection

```
1. User types in Monaco editor
2. onDidChangeModelContent listener fires
3. Content compared to originalContentRef
4. If different: Dispatch IDE_MARK_FILE_DIRTY
5. If matches original: Dispatch IDE_MARK_FILE_CLEAN
6. EditorTabs shows/hides purple dot indicator
7. Syntax diagnostics re-triggered (debounced 500ms)
```

### Debug Session Lifecycle

```
1. User enters script path in DebugToolbar launch config input
2. User clicks Run (or presses Enter) --> handleDebugLaunch(scriptPath, args)
3. electronAPI.debugLaunch({ scriptPath, args, cwd }) --> DebugService starts Node.js with --inspect
4. DebugService connects to CDP, broadcasts 'debug-paused'/'debug-resumed'/'debug-stopped'
5. IDEView subscribes to push events via window.electronAPI.on():
   - 'debug-paused'  --> dispatch DEBUG_SET_SESSION { status: 'paused', ... }
                      --> dispatch DEBUG_SET_CALL_STACK, DEBUG_SET_SCOPES, DEBUG_SET_VARIABLES
   - 'debug-resumed' --> dispatch DEBUG_SET_SESSION { status: 'running' }
   - 'debug-stopped' --> dispatch DEBUG_CLEAR_SESSION
6. DebugToolbar enables/disables buttons based on debugSession.status
7. CodeEditor highlights paused line with debug-current-line decoration
8. DebugPanels show Variables, Call Stack, Breakpoints, Watch
9. DebugConsolePanel receives 'debug-output' events for stdout/stderr
```

### Breakpoint Management

```
1. User clicks gutter (line number area) in CodeEditor
2. Dispatch DEBUG_TOGGLE_BREAKPOINT { filePath, line }
3. CodeEditor adds/removes red dot decoration in Monaco gutter
4. If debug session active: electronAPI.debugSetBreakpoint(filePath, line)
   or electronAPI.debugRemoveBreakpoint(breakpointId)
5. DebugPanels Breakpoints section updates from debugBreakpoints state
6. Clicking a breakpoint in DebugPanels navigates to the file and line
```

### Syntax Diagnostics Flow

```
1. CodeEditor content changes (debounced 500ms) or file is loaded
2. electronAPI.ideCheckSyntax(filePath, workspacePath) called
3. Main process runs ideDiagCheck(content, filePath):
   - JSON: JSON.parse() with position extraction on error
   - JS/JSX/TS/TSX: vm.compileFunction() with V8 error parsing
   - CSS: Bracket/brace/string matching analysis
4. Diagnostics array returned: [{ file, line, column, message, severity, source }]
5. Dispatch updates diagnostics state in AppContext
6. ProblemsPanel (in BottomPanel) aggregates and displays all diagnostics
7. Monaco editor shows inline markers for errors/warnings
```

---

## Workspace-Dashboard Bridge

Each IDE workspace can be linked to a Synapse dashboard, enabling shared Claude chat between the IDE view and the dashboard view. This is managed by `ideWorkspaceManager.js`.

```
localStorage key: 'synapse-ide-workspace-dashboards'
Data: { [workspaceId]: dashboardId }

Functions:
  getAllWorkspaceDashboards()                         -- Full { workspaceId: dashboardId } mapping
  setWorkspaceDashboard(workspaceId, dashboardId)    -- Link workspace to dashboard
  getWorkspaceDashboard(workspaceId)                 -- Get linked dashboard
  removeWorkspaceDashboard(workspaceId)              -- Remove link
  isIdeDashboard(dashboardId)                        -- Check if dashboard is IDE-linked
  getWorkspaceForDashboard(dashboardId)              -- Reverse lookup
  getIdeDashboardLabel(dashboardId)                  -- "Dashboard N (IDE)" label
  createWorkspaceDashboard(workspaceId)              -- Create + link new dashboard
```

**Dashboard lifecycle:**

- **Open workspace:** Creates a dashboard via `createWorkspaceDashboard()`, stores the workspace-dashboard mapping, and associates the project path via `saveDashboardProject()`
- **Switch workspace:** Dispatches `SWITCH_DASHBOARD` to keep the active dashboard in sync with the active workspace
- **Close workspace:** Removes the workspace-dashboard mapping, deletes the dashboard from disk, and dispatches `REMOVE_DASHBOARD`
- **App restart:** IDEView validates all workspace-dashboard mappings on mount; stale or missing mappings are recreated automatically

---

## Debug System Architecture

The IDE includes a full Node.js debugger built on the Chrome DevTools Protocol (CDP). The architecture spans three layers:

### DebugService (Electron Main Process)

`electron/services/DebugService.js` manages the debug session lifecycle:

1. **Launch** -- Spawns `node --inspect=<port>` with the user's script, connects to the CDP WebSocket
2. **Breakpoints** -- Sends `Debugger.setBreakpointByUrl` / `Debugger.removeBreakpoint` to the CDP session
3. **Execution control** -- Maps continue/pause/stepOver/stepInto/stepOut to CDP `Debugger.*` commands
4. **State inspection** -- Retrieves call frames, scopes, and variables via CDP `Runtime.getProperties`
5. **Expression evaluation** -- Evaluates expressions in a specific call frame via `Runtime.evaluate` / `Debugger.evaluateOnCallFrame`
6. **Push events** -- Broadcasts `debug-paused`, `debug-resumed`, `debug-stopped`, and `debug-output` to all renderer windows via `broadcastFn`

### IPC Layer (13 Handlers)

13 `debug-*` IPC handlers in `electron/ipc-handlers.js` delegate to DebugService methods. See the [IDE IPC Handlers Reference](ipc-handlers.md) for the full handler list.

### UI Components (4 Components)

| Component | Location | Role |
|---|---|---|
| `DebugToolbar` | Above editor | Launch config, play/pause/step/stop/restart controls |
| `DebugPanels` | Right sidebar | Variables, Call Stack, Breakpoints, Watch expressions |
| `DebugConsolePanel` | BottomPanel tab | REPL input + stdout/stderr output stream |
| `ProblemsPanel` | BottomPanel tab | Syntax diagnostics aggregation with severity filtering |

### Debug State (AppContext)

```javascript
{
  debugSession: { status: 'idle'|'running'|'paused', pausedFile, pausedLine, threadId },
  debugCallStack: [],           // [{ id, name, source, line, column }]
  debugScopes: [],              // [{ name, variablesReference }]
  debugVariables: {},           // { [scopeId]: [{ name, value, type, variablesReference }] }
  debugBreakpoints: {},         // { [filePath]: [lineNumber, ...] }
  debugWatchExpressions: [],    // [{ id, expression, value, error }]
  diagnostics: {},              // { [filePath]: [{ line, column, message, severity, source }] }
}
```

### Push Event Channels

| Channel | Direction | Description |
|---|---|---|
| `debug-paused` | main -> renderer | Execution paused (breakpoint, step, pause). Includes callStack, scopes, variables. |
| `debug-resumed` | main -> renderer | Execution resumed after continue/step |
| `debug-stopped` | main -> renderer | Debug session terminated |
| `debug-output` | main -> renderer | stdout/stderr output from debugged process |

---

## File Structure

```
src/ui/
  components/ide/
    IDEView.jsx              -- Main layout orchestrator (386 lines)
    FileExplorer.jsx         -- Lazy-loaded tree view (452 lines)
    CodeEditor.jsx           -- Monaco editor wrapper + breakpoints + diagnostics (770 lines)
    EditorTabs.jsx           -- Open file tab bar (85 lines)
    WorkspaceTabs.jsx        -- Workspace folder tabs + dashboard bridge (155 lines)
    IDEWelcome.jsx           -- Welcome screen (156 lines)
    DebugToolbar.jsx         -- Debug control bar (288 lines)
    DebugPanels.jsx          -- Debug sidebar: Variables, Call Stack, Breakpoints, Watch (443 lines)
    DebugConsolePanel.jsx    -- REPL-style debug console (340 lines)
    ProblemsPanel.jsx        -- Diagnostics aggregation panel (237 lines)
  components/
    BottomPanel.jsx          -- VS Code-style bottom panel (shared component)
  utils/
    ideWorkspaceManager.js   -- Workspace-dashboard bridge (122 lines)
    dashboardProjects.js     -- Dashboard-project path mapping
    monacoWorkerSetup.js     -- Monaco web worker config (35 lines)
  styles/
    ide-sidebar.css          -- Sidebar tab bar (206 lines)
    ide-explorer.css         -- File explorer + welcome (345 lines)
    ide-editor.css           -- Editor tabs + Monaco container (193 lines)
    ide-layout.css           -- Main layout + workspace tabs (241 lines)
    ide-debug.css            -- Debug toolbar + debug panels + problems panel
    ide-debug-panels.css     -- Debug sidebar panel styles
    ide-debug-console.css    -- Debug console styles

electron/
  ipc-handlers.js            -- 9 IDE file system + 2 diagnostics + 13 debug handlers
  services/DebugService.js   -- Node.js debug session manager (CDP client)
  preload.js                 -- IDE, diagnostics, and debug methods exposed via contextBridge
```

**Total:** ~4,800 lines of component code across 10 IDE components + IPC handlers + DebugService.

---

## Key Design Decisions

1. **Monaco Editor over CodeMirror** -- Monaco provides VS Code-level editing features (IntelliSense, bracket matching, minimap, multi-cursor) out of the box with a single dependency.

2. **Electron IPC for file system** -- All file operations go through Electron's main process via IPC handlers with path validation and binary detection. The renderer never accesses `fs` directly.

3. **Per-workspace state isolation** -- Each workspace maintains its own open files, active file, and file tree. Switching workspaces restores the previous editing context.

4. **localStorage persistence** -- Workspaces and workspace-dashboard mappings persist across app restarts via localStorage, avoiding the need for additional server-side storage.

5. **Lazy tree loading** -- The file explorer loads only the root level on workspace open via `ide-list-dir` (single-level listing). Subdirectories load children on demand when expanded. The recursive `ide-read-dir` remains available for full-depth tree reads but is no longer used for the default file explorer view.

6. **Draggable split panel** -- The file explorer width is adjustable (180-500px) via a CSS-driven drag handle, matching IDE conventions.

7. **Synapse design token integration** -- All IDE styles use CSS custom properties (`--bg`, `--surface`, `--border`, `--text`, `--color-in-progress`) to match Synapse's dark theme automatically.

8. **VS Code-style bottom panel** -- IDEView integrates a shared `BottomPanel` component providing Terminal, Output, Problems, Debug Console, and Ports tabs. The terminal session is bound to the active workspace's project directory. The panel renders in both the workspace view and the welcome screen (embedded mode).

9. **Node.js Inspector Protocol for debugging** -- The debug system uses the Chrome DevTools Protocol (CDP) via Node.js's `--inspect` flag rather than a custom debug adapter. This provides full compatibility with standard Node.js debugging and avoids external dependencies. DebugService manages the CDP WebSocket connection and translates protocol messages into Synapse-friendly push events.

10. **Gutter-click breakpoints** -- Breakpoints are set by clicking the editor gutter (line number area), matching VS Code's UX. Breakpoint state is maintained in AppContext and synced with the debug backend when a session is active. Visual feedback includes red dot decorations in the gutter.

11. **Syntax diagnostics via main process** -- Syntax checking runs in Electron's main process via `vm.compileFunction()` (JS), `JSON.parse()` (JSON), and bracket matching (CSS). This avoids shipping a separate language server while still providing real-time error feedback. Results feed into both Monaco's inline markers and the Problems panel.

12. **Conditional debug UI** -- DebugToolbar and DebugPanels only render when `debugSession.status !== 'idle'`, keeping the UI clean when debugging is not in use. The debug sidebar appears to the right of the editor, shrinking the editor area.

---

## Security

- **Path validation** -- `ideValidatePath()` prevents directory traversal attacks by checking that resolved paths stay within the workspace root
- **Binary detection** -- Files with null bytes in the first 8KB are flagged as binary and not displayed
- **Symlink safety** -- `lstat()` used instead of `stat()` to avoid following symlinks outside workspace boundaries
- **Context isolation** -- All IPC goes through Electron's `contextBridge` with channel whitelisting
- **Debug process isolation** -- Debug sessions spawn child processes with `--inspect` on localhost only; the CDP connection is not exposed externally
- **Diagnostics sandboxing** -- JavaScript syntax checking uses `vm.compileFunction()` which compiles but does not execute the code, preventing arbitrary code execution during diagnostics
