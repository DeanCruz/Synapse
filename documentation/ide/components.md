# IDE Components Reference

All IDE components live in `src/ui/components/ide/`. They use React Context (`useAppState()` and `useDispatch()`) for state management -- no prop drilling required except where noted.

---

## IDEView

**File:** `src/ui/components/ide/IDEView.jsx` (386 lines)

The root layout component for the Code Explorer. Assembles all IDE sub-components (WorkspaceTabs, FileExplorer, EditorTabs, CodeEditor, DebugToolbar, DebugPanels, BottomPanel, IDEWelcome) and manages the draggable split panel between the file explorer and editor. Also orchestrates workspace-dashboard lifecycle, debug IPC callbacks, and debug push event subscriptions.

**Props:** None (context only)

**Local State:**

| State | Default | Description |
|---|---|---|
| `explorerWidth` | `250` | File explorer panel width in pixels |
| `isDragging` | `false` | Whether the divider is actively being dragged |

**Refs:**

| Ref | Purpose |
|---|---|
| `debugLaunchConfigRef` | Persists the last debug launch config `{ scriptPath, cwd }` across restarts |
| `dragRef` | Stores drag start position and width for divider calculations |

**Derived Data from Context:**

| Variable | Source | Description |
|---|---|---|
| `activeWorkspace` | `ideWorkspaces.find(w => w.id === ideActiveWorkspaceId)` | Current workspace object |
| `activeWsOpenFiles` | `ideOpenFiles[activeWorkspaceId]` | Open files for current workspace |
| `activeFileId` | `ideActiveFileId[activeWorkspaceId]` | Active file ID in current workspace |
| `activeFile` | `activeWsOpenFiles.find(f => f.id === activeFileId)` | Full file object for active file |
| `projectPath` | `getDashboardProject(currentDashboardId)` | Project path for the current dashboard |

**Additional Context Consumed:**

| Context Field | Purpose |
|---|---|
| `currentDashboardId` | Dashboard syncing with workspace |
| `dashboardList` | Validates workspace-dashboard mappings |
| `currentLogs` | Passed to BottomPanel |
| `activeLogFilter` | Passed to BottomPanel |
| `debugSession` | Controls visibility of DebugToolbar and DebugPanels |

**Effects:**

1. **Load file tree on workspace change** -- When `activeWorkspace` changes, checks if tree is already cached in `ideFileTrees`. If not, calls `electronAPI.ideReadDir()` and dispatches `IDE_SET_FILE_TREE`. Includes cleanup cancellation to prevent stale updates.

2. **Sync dashboard to active workspace** -- When `ideActiveWorkspaceId` changes, dispatches `SWITCH_DASHBOARD` to keep the active dashboard in sync with the workspace.

3. **Subscribe to debug push events** -- Registers listeners for `debug-paused`, `debug-resumed`, and `debug-stopped` push events via `window.electronAPI.on()`:
   - `debug-paused` -- Updates session status to `'paused'`, dispatches `DEBUG_SET_SESSION`, `DEBUG_SET_CALL_STACK`, `DEBUG_SET_SCOPES`, and `DEBUG_SET_VARIABLES` for each scope that includes inline variables.
   - `debug-resumed` -- Updates session status to `'running'`, clears paused file/line.
   - `debug-stopped` -- Dispatches `DEBUG_CLEAR_SESSION` to reset all debug state.

4. **Draggable divider** -- Attaches global `mousemove`/`mouseup` listeners during drag. Constrains width between 180px and 500px. Applies `.ide-dragging` class to `document.body` for global `col-resize` cursor.

**Debug Callback Functions:**

| Function | Description |
|---|---|
| `handleDebugLaunch(scriptPath, args)` | Resolves CWD from active workspace, stores launch config in ref, calls `electronAPI.debugLaunch()` |
| `handleDebugContinue()` | Calls `electronAPI.debugContinue()` |
| `handleDebugPause()` | Calls `electronAPI.debugPause()` |
| `handleDebugStepOver()` | Calls `electronAPI.debugStepOver()` |
| `handleDebugStepInto()` | Calls `electronAPI.debugStepInto()` |
| `handleDebugStepOut()` | Calls `electronAPI.debugStepOut()` |
| `handleDebugStop()` | Calls `electronAPI.debugStop()` |
| `handleDebugRestart()` | Stops current session, waits 300ms, then re-launches with stored config. Includes error recovery (launches even if stop fails). |
| `handleDebugNavigate(filePath, line)` | Opens file via `IDE_OPEN_FILE`, then dispatches `ideNavigateToLine` for CodeEditor to jump to the line |
| `handleDebugNavigateToFrame(source, line, column)` | Same as navigate but with column support; used by DebugPanels call stack |

**Render Logic:**

- If no workspaces: renders `<IDEWelcome />` + `<BottomPanel />` (embedded mode)
- If workspaces exist: renders the full IDE layout with `WorkspaceTabs`, `FileExplorer`, divider, `EditorTabs`, `CodeEditor`, and `<BottomPanel />`
- If `debugSession.status !== 'idle'`: renders `<DebugToolbar />` above editor and `<DebugPanels />` in a sidebar to the right of the editor
- If no file is active: renders an empty state placeholder with a file icon
- BottomPanel receives `projectDir` as the active workspace path (or dashboard project path as fallback) and `onNavigate` for problem click navigation

---

## FileExplorer

**File:** `src/ui/components/ide/FileExplorer.jsx` (452 lines)

Lazy-loaded tree view displaying the workspace's file system. Loads only the root level on workspace open and lazily fetches subdirectory contents on expand. Supports folder expand/collapse, file-type icons (as dedicated SVG components), active file highlighting, loading spinners per directory, and tree refresh with 10-second polling.

**Props:** None (context only)

**Local State:**

| State | Default | Description |
|---|---|---|
| `expandedPaths` | `new Set()` | Set of directory paths currently expanded |
| `loadingPaths` | `new Set()` | Set of directory paths currently loading children |
| `initialLoading` | `false` | Whether the root-level tree is being loaded |

**Event Handlers:**

| Handler | Description |
|---|---|
| `toggleExpand(nodePath, children)` | Toggles a directory in `expandedPaths`; triggers `loadChildren()` when children are `null` |
| `loadChildren(dirPath)` | Fetches a single directory's contents via `ideListDir` and dispatches `IDE_UPDATE_FILE_TREE_NODE` |
| `onFileClick(node)` | Dispatches `IDE_OPEN_FILE` with the file's path and name |
| `handleRefresh()` | Clears expanded paths, re-fetches root-level tree via `ideListDir` |

**File Type Icons:**

Dedicated SVG icon components for each file type:

| Extensions | Component | Icon Style | Description |
|---|---|---|---|
| `.js`, `.jsx`, `.mjs`, `.cjs` | `JsIcon` | Yellow badge with "JS" | JavaScript |
| `.ts`, `.tsx` | `TypeScriptIcon` | Blue badge with "TS" | TypeScript |
| `.css`, `.scss`, `.less` | `CssIcon` | Blue badge with "CSS" | Stylesheets |
| `.json` | `JsonIcon` | Yellow-green badge with "{ }" | JSON |
| `.html`, `.htm` | `HtmlIcon` | Red badge with "HTML" | HTML |
| `.md`, `.mdx` | `MarkdownIcon` | Purple badge with "MD" | Markdown |
| Other | `GenericFileIcon` | Document outline | Generic file |

Additional icon components: `FolderIcon`, `FolderOpenIcon`, `ChevronIcon`, `RefreshIcon`, `NewFileIcon`, `NewFolderIcon`, `LoadingSpinner`.

**TreeNode (Internal Component):**

Recursive component rendering a single file or folder node.

| Prop | Type | Description |
|---|---|---|
| `node` | `{ name, path, type, children? }` | Tree node data (`children: null` = not yet loaded) |
| `depth` | `number` | Nesting depth for indent calculation |
| `expandedPaths` | `Set` | Set of expanded directory paths |
| `toggleExpand` | `function` | Callback to toggle expansion |
| `onFileClick` | `function` | Callback when a file is clicked |
| `activeFilePath` | `string` | Path of the currently active file (for highlighting) |
| `loadingPaths` | `Set` | Set of directory paths currently loading (shows spinner) |

Indent is controlled via `data-depth` attribute (CSS-driven, capped at depth 10).

**IPC Calls:**

- `electronAPI.ideListDir(workspace.path)` -- Load root-level directory listing
- `electronAPI.ideListDir(dirPath)` -- Lazy-load a subdirectory's children on expand

---

## CodeEditor

**File:** `src/ui/components/ide/CodeEditor.jsx` (770 lines)

Monaco Editor wrapper with file loading, syntax highlighting, save functionality, dirty tracking, breakpoint toggling via gutter click, syntax diagnostics (debounced 500ms), and debug current-line highlighting.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `filePath` | `string` | Absolute path to the file being edited |
| `workspaceId` | `string` | ID of the containing workspace |
| `workspacePath` | `string` | Root path of the workspace (for IPC validation) |

**Local State:**

| State | Default | Description |
|---|---|---|
| `loading` | `true` | Whether file content is being loaded |
| `error` | `null` | Error message if file load failed |
| `showSaving` | `false` | Whether the "Saved" toast is visible |

**Key Refs:**

| Ref | Purpose |
|---|---|
| `containerRef` | DOM element hosting the Monaco editor |
| `editorRef` | Monaco editor instance |
| `modelRef` | Monaco text model (document) |
| `onChangeDisposableRef` | Monaco change listener subscription |
| `originalContentRef` | Original file content for dirty comparison |
| `breakpointDecorationsRef` | Tracks Monaco gutter decorations for breakpoints |
| `diagnosticDecorationsRef` | Tracks Monaco marker decorations for syntax diagnostics |
| `debugLineDecorationRef` | Tracks the debug current-line highlight decoration |

**Effects:**

1. **Create/destroy editor** -- Creates Monaco editor instance on mount with `synapse-dark` theme, registers Cmd+S keybinding, sets up `ResizeObserver` for responsive layout. Registers gutter click handler for breakpoint toggling. Disposes everything on unmount.

2. **Load file content** -- When `filePath` changes, reads file via IPC, detects binary files, auto-detects language, updates Monaco model, attaches change listener for dirty tracking, and triggers initial syntax diagnostics.

3. **Syntax diagnostics** -- Debounced 500ms after content changes. Calls `electronAPI.ideCheckSyntax(filePath, workspacePath)`. Maps returned diagnostics to Monaco markers (`editor.setModelMarkers`) and dispatches to AppContext for the ProblemsPanel.

4. **Breakpoint sync** -- When `debugBreakpoints` state changes for the current file, updates Monaco gutter decorations (red dots). On gutter click, dispatches `DEBUG_TOGGLE_BREAKPOINT` and conditionally calls `debugSetBreakpoint`/`debugRemoveBreakpoint` if a debug session is active.

5. **Debug line highlighting** -- When `debugSession.pausedFile` matches the current file, adds a `debug-current-line` decoration (yellow/amber background highlight) at `debugSession.pausedLine`. Cleared when session resumes or stops.

6. **Navigate-to-line** -- Listens for `ideNavigateToLine` state changes. When the target file matches, scrolls to and reveals the specified line using `editor.revealLineInCenter()` and sets cursor position.

**Language Detection:**

Maps 25+ file extensions to Monaco language IDs:

| Extensions | Language |
|---|---|
| `.js`, `.jsx` | `javascript` |
| `.ts`, `.tsx` | `typescript` |
| `.py` | `python` |
| `.json` | `json` |
| `.md` | `markdown` |
| `.html`, `.htm` | `html` |
| `.css` | `css` |
| `.scss` | `scss` |
| `.less` | `less` |
| `.xml` | `xml` |
| `.yaml`, `.yml` | `yaml` |
| `.sh`, `.bash`, `.zsh` | `shell` |
| `.sql` | `sql` |
| `.go` | `go` |
| `.rs` | `rust` |
| `.java` | `java` |
| `.rb` | `ruby` |
| `.c`, `.h` | `c` |
| `.cpp`, `.cxx`, `.cc`, `.hpp` | `cpp` |
| `.swift` | `swift` |
| `.kt` | `kotlin` |
| `.php` | `php` |
| `.r` | `r` |
| `.lua` | `lua` |
| `.toml`, `.ini` | `ini` |
| `.dockerfile` | `dockerfile` |
| `Dockerfile` (filename) | `dockerfile` |
| `Makefile` (filename) | `makefile` |

**Monaco Configuration:**

```
Theme:           synapse-dark (custom)
Font:            SF Mono, Fira Code, Cascadia Code, JetBrains Mono, Menlo, Monaco
Font size:       13px
Line height:     20px
Tab size:        2 (spaces)
Minimap:         Enabled (mouseover slider)
Bracket pairs:   Colorized
Word wrap:       Off
Smooth scroll:   Enabled
Cursor:          Purple (#9B7CF0) with smooth animation
Gutter:          Click-to-toggle breakpoints (red dot decorations)
```

**Custom Theme Colors:**

| Element | Color |
|---|---|
| Editor background | `#0a0a0c` |
| Editor foreground | `#F5F5F7` |
| Line numbers | `#555555` (inactive), `#A1A1A6` (active) |
| Cursor | `#9B7CF0` |
| Selection | `#9B7CF033` |
| Widget background | `#121214` |
| Debug current line | Amber/yellow background highlight |

**IPC Calls:**

- `electronAPI.ideReadFile(filePath, workspacePath)` -- Read file contents
- `electronAPI.ideWriteFile(filePath, content, workspacePath)` -- Save file
- `electronAPI.ideCheckSyntax(filePath, workspacePath)` -- Run syntax diagnostics
- `electronAPI.debugSetBreakpoint(filePath, line)` -- Set breakpoint in active debug session
- `electronAPI.debugRemoveBreakpoint(breakpointId)` -- Remove breakpoint in active debug session

---

## EditorTabs

**File:** `src/ui/components/ide/EditorTabs.jsx` (85 lines)

Horizontal tab bar showing all open files in the current workspace with active highlighting, dirty indicators, and close buttons.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `workspaceId` | `string` | ID of the active workspace |

**Tab Features:**

| Feature | Description |
|---|---|
| Active indicator | Purple top border (2px `#9B7CF0`) and lighter background |
| Dirty indicator | Small purple dot (7x7px) next to filename |
| Close button | `x` button, visible on hover or when tab is active |
| Unsaved prompt | `window.confirm()` dialog before closing a dirty file |
| Auto-scroll | Active tab scrolls into view smoothly |
| Max width | 160px with text ellipsis overflow |

**Dispatch Actions:**

- `IDE_SWITCH_FILE` -- Switch active file
- `IDE_CLOSE_FILE` -- Close a file tab

---

## WorkspaceTabs

**File:** `src/ui/components/ide/WorkspaceTabs.jsx` (155 lines)

Horizontal tab bar showing all open workspace folders. Each tab displays the folder name with a folder icon and close button. Manages full workspace-dashboard lifecycle: creates dashboards on add, syncs dashboard on switch, and cleans up dashboards on close. Includes a mount-time recovery effect that recreates dashboards for persisted workspaces after app restart.

**Props:** None (context only)

**Tab Features:**

| Feature | Description |
|---|---|
| Active indicator | Darker background and full opacity icon |
| Close button | `x` button, visible on hover or when tab is active |
| Add button | `+` button at end of tab bar, opens native folder picker |
| Folder icon | Folder outline SVG icon |

**Event Handlers:**

| Handler | Description |
|---|---|
| `handleAddWorkspace()` | Opens native folder picker, dispatches `IDE_OPEN_WORKSPACE` with pre-generated ID, creates a linked dashboard via `createWorkspaceDashboard()`, stores project path via `saveDashboardProject()`, and switches to the new dashboard |
| `handleSwitchWorkspace(id)` | Dispatches `IDE_SWITCH_WORKSPACE`, then dispatches `SWITCH_DASHBOARD` to keep dashboard in sync with workspace |
| `handleCloseWorkspace(e, id)` | Removes workspace-dashboard mapping via `removeWorkspaceDashboard()`, switches to another dashboard if the deleted one was active, dispatches `IDE_CLOSE_WORKSPACE`, deletes dashboard from disk via `electronAPI.deleteDashboard()`, and dispatches `REMOVE_DASHBOARD` |

**IPC Calls:**

- `electronAPI.ideSelectFolder()` -- Open native folder picker
- `electronAPI.deleteDashboard(dashboardId)` -- Delete workspace's linked dashboard from disk

---

## IDEWelcome

**File:** `src/ui/components/ide/IDEWelcome.jsx` (156 lines)

Welcome screen displayed when no workspaces are open. Provides buttons to open an existing folder or create a new one. Both actions create a linked dashboard for the new workspace.

**Props:** None (context only)

**Actions:**

| Button | Behavior |
|---|---|
| **Open Folder** | Opens native folder picker, dispatches `IDE_OPEN_WORKSPACE` with pre-generated workspace ID, creates a linked dashboard via `createWorkspaceDashboard()`, stores project path via `saveDashboardProject()` |
| **Create New Folder** | Opens native folder picker (select parent), prompts for folder name, calls `electronAPI.ideCreateFolder()`, dispatches `IDE_OPEN_WORKSPACE` with pre-generated ID, creates a linked dashboard |

**Render Structure:**

```
ide-welcome
  |-- Code bracket icon (SVG, CodeBracketIcon component)
  |-- "Code Explorer" title
  |-- "Open a project folder to browse files, edit code, and manage your workspace." subtitle
  |-- [Open Folder] button (primary, with FolderOpenActionIcon)
  |-- [Create New Folder] button (secondary, with FolderPlusIcon)
```

**IPC Calls:**

- `electronAPI.ideSelectFolder()` -- Native folder picker
- `electronAPI.ideCreateFolder(path)` -- Create directory

---

## DebugToolbar

**File:** `src/ui/components/ide/DebugToolbar.jsx` (288 lines)

Debug control bar with standard debugger actions, displayed above the editor area when a debug session is active (`debugSession.status !== 'idle'`). Pure UI component: receives debug state and callbacks as props. Includes a launch configuration row with script path and arguments inputs.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `debugStatus` | `string` | Current debug status: `'idle'`, `'running'`, `'paused'`, or `'stopped'` |
| `onContinue` | `function` | Resume execution callback (F5 when paused) |
| `onPause` | `function` | Pause execution callback (F5 when running) |
| `onStepOver` | `function` | Step over callback (F10) |
| `onStepInto` | `function` | Step into callback (F11) |
| `onStepOut` | `function` | Step out callback (Shift+F11) |
| `onRestart` | `function` | Restart debug session callback (Ctrl+Shift+F5) |
| `onStop` | `function` | Stop debug session callback (Shift+F5) |
| `onLaunch` | `function` | Launch callback `(scriptPath, args)` |

**Local State:**

| State | Default | Description |
|---|---|---|
| `scriptPath` | `''` | Script path input value |
| `args` | `''` | Arguments input value |

**Button Enable States:**

| Status | Available Actions |
|---|---|
| `idle` | Launch (if script path non-empty) |
| `running` | Pause, Stop |
| `paused` | Continue, Step Over, Step Into, Step Out, Restart, Stop |
| `stopped` | Launch (if script path non-empty) |

**Internal SVG Icon Components:**

`PlayIcon`, `PauseIcon`, `StepOverIcon`, `StepIntoIcon`, `StepOutIcon`, `RestartIcon`, `StopIcon`, `LaunchIcon`, `StatusDot`

**StatusDot Colors:**

| Status | Color |
|---|---|
| `idle` | `var(--text-tertiary)` |
| `running` | `var(--color-in-progress)` (purple) |
| `paused` | `var(--color-warning, #f59e0b)` (amber) |
| `stopped` | `var(--text-tertiary)` |

**Render Structure:**

```
debug-toolbar
  |-- debug-toolbar-controls
  |   |-- StatusDot + status label
  |   |-- separator
  |   |-- [Continue] [Pause] | [StepOver] [StepInto] [StepOut] | [Restart] [Stop]
  |-- debug-toolbar-launch
      |-- Script path input (placeholder: "Script path (e.g. index.js)")
      |-- Arguments input (placeholder: "Arguments")
      |-- [Run] launch button (with LaunchIcon)
```

**Keyboard Shortcut:** Enter key in either input field triggers launch.

---

## DebugPanels

**File:** `src/ui/components/ide/DebugPanels.jsx` (443 lines)

VS Code-style debug sidebar with four collapsible sections: Variables, Call Stack, Breakpoints, and Watch Expressions. Displayed as a right sidebar next to the editor when a debug session is active. Reads debug state from AppContext.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `onNavigateToFrame` | `function` | Callback `(source, line, column)` when a call stack frame is clicked |
| `onNavigateToBreakpoint` | `function` | Callback `(filePath, line)` when a breakpoint row is clicked |

**Internal Components:**

### CollapsibleSection

Generic collapsible section container with chevron toggle, title, and optional count badge.

| Prop | Type | Description |
|---|---|---|
| `title` | `string` | Section header text (e.g., "VARIABLES") |
| `defaultOpen` | `boolean` | Whether the section starts expanded (default: `true`) |
| `count` | `number` | Optional badge count displayed next to the title |
| `children` | `ReactNode` | Section content |

### VariablesSection

Displays scope-grouped variables when the debug session is paused. Reads `debugSession`, `debugScopes`, and `debugVariables` from AppContext.

- Shows "Not paused" when the session is not in paused state
- Shows "No scopes available" when paused but no scopes returned
- Groups variables by scope (Local, Closure, Global, etc.)
- Each variable rendered as a `VariableRow`

### VariableRow

Single variable display with optional lazy-expandable children for object/array types.

| Prop | Type | Description |
|---|---|---|
| `variable` | `object` | Variable object: `{ name, value, type, variablesReference }` |
| `depth` | `number` | Nesting depth for indentation (default: `0`) |

- If `variablesReference > 0`, the row is expandable (click to load children)
- Children are lazy-loaded via `electronAPI.debugGetVariables(variablesReference)` on first expand
- Shows a loading spinner during child fetch
- Values are truncated at 80 characters with ellipsis
- Recursive: child variables can themselves be expanded

**IPC Calls:** `electronAPI.debugGetVariables(variablesReference)` -- Lazy-load child variables

### CallStackSection

Displays the call stack frames when paused. Reads `debugCallStack` and `debugSession` from AppContext.

- Shows "Not paused" or "No call frames" empty state
- Frame 0 (topmost) gets `.paused-frame` styling
- Each frame shows function name and source location (`filename:line`)
- Clicking a frame calls `onNavigateToFrame(frame.source, frame.line, frame.column)`

### BreakpointsSection

Lists all set breakpoints across all files, sorted by filename then line number. Reads `debugBreakpoints` from AppContext.

- Flattens `debugBreakpoints` map into a sorted list: `[{ filePath, line }]`
- Each row shows a checkbox (toggle), filename, and line number
- Clicking a row calls `onNavigateToBreakpoint(filePath, line)`
- Checkbox click dispatches `DEBUG_TOGGLE_BREAKPOINT` to remove the breakpoint

### WatchSection

User-managed watch expressions evaluated in the current debug context. Reads `debugWatchExpressions`, `debugSession`, and `debugCallStack` from AppContext.

- Input field with "Add expression..." placeholder and add button
- Enter key triggers expression evaluation
- Evaluates via `electronAPI.debugEvaluate(expression, callFrameId)` using the top call frame
- Displays `expression = value` or `expression = error` for each watch
- Remove button (minus icon) on each watch row
- Values truncated at 60 characters

**IPC Calls:** `electronAPI.debugEvaluate(expression, callFrameId)` -- Evaluate watch expression

**Internal SVG Icons:** `ChevronIcon`, `CheckboxCheckedIcon`, `AddIcon`, `RemoveIcon`

**Helper Functions:**

| Function | Description |
|---|---|
| `baseName(filePath)` | Extracts filename from a full path |
| `truncate(str, max)` | Truncates string with ellipsis at max length |

---

## DebugConsolePanel

**File:** `src/ui/components/ide/DebugConsolePanel.jsx` (340 lines)

REPL-style debug console for evaluating expressions and viewing debug output (stdout/stderr). Mounted in BottomPanel's "Debug Console" tab. Subscribes to `debug-output` and `debug-stopped` push events via `window.electronAPI.on()`.

**Props:** None (context only)

**Local State:**

| State | Default | Description |
|---|---|---|
| `outputLines` | `[]` | Array of output entries: `[{ id, type, text, timestamp }]` |
| `inputValue` | `''` | Current REPL input text |
| `commandHistory` | `[]` | Array of previously evaluated expressions |
| `historyIndex` | `-1` | Current position in command history (`-1` = new input) |

**Constants:**

| Constant | Value | Description |
|---|---|---|
| `MAX_OUTPUT_ENTRIES` | `1000` | Maximum output buffer size (trims oldest entries) |

**Output Entry Types:**

| Type | CSS Class | Gutter Label | Description |
|---|---|---|---|
| `stdout` | `--stdout` | `out` | Standard output from debugged process |
| `stderr` / `error` | `--error` | `err` / `ERR` | Standard error or error messages |
| `log` | `--log` | `log` | Log-level messages |
| `eval-input` | `--eval-input` | `>>>` | Echoed user expression (prefixed with `> `) |
| `eval-result` | `--eval-result` | `<<<` | Evaluation result |
| `eval-error` | `--eval-error` | `ERR` | Evaluation error |
| `system` | `--system` | `sys` | System messages (e.g., "[Session ended]") |

**Event Subscriptions (Push Events):**

| Event | Behavior |
|---|---|
| `debug-output` | Appends `{ type, text, timestamp }` entry to output buffer |
| `debug-stopped` | Appends `[Session ended]` system marker |

**Expression Evaluation:**

1. User types expression and presses Enter
2. Expression echoed to output as `eval-input` type
3. Calls `electronAPI.debugEvaluate(expression, callFrameId)` using top call frame ID
4. Result appended as `eval-result` (success) or `eval-error` (failure)
5. Expression added to command history (deduplicated, most recent at end)

**Command History Navigation:**

- Arrow Up: Navigate to previous command
- Arrow Down: Navigate to next command (or clear input at end)

**Auto-Scroll Behavior:**

- Auto-scrolls to bottom when new entries arrive (if user hasn't manually scrolled up)
- Scroll position tracked via `autoScrollRef` -- set to `false` when user scrolls up more than 30px from bottom
- Re-enables auto-scroll when user scrolls back to bottom

**Input State by Debug Status:**

| Status | Placeholder | Enabled |
|---|---|---|
| `paused` | "Evaluate expression..." | Yes |
| `running` | "Pause execution to evaluate..." | No |
| `idle` / `stopped` | "Start a debug session to evaluate..." | No |

**Helper Functions:**

| Function | Description |
|---|---|
| `stripAnsi(text)` | Removes ANSI escape codes from output text |
| `formatTimestamp(ts)` | Formats ISO timestamp to `HH:MM:SS` (24-hour) |

**Render Structure:**

```
debug-console
  |-- debug-console-output (scrollable)
  |   |-- OutputLine entries (or empty state message)
  |-- debug-console-input-area
      |-- ">" prompt
      |-- input field (disabled when not paused)
      |-- [Clear] button (ClearIcon)
```

**IPC Calls:**

- `electronAPI.debugEvaluate(expression, callFrameId)` -- Evaluate expression in debug context

---

## ProblemsPanel

**File:** `src/ui/components/ide/ProblemsPanel.jsx` (237 lines)

Diagnostics aggregation panel displayed in BottomPanel's "Problems" tab. Groups diagnostics by file path with severity filtering (errors, warnings, info). Reads from `diagnostics` state in AppContext. Clicking a diagnostic row navigates to the error location.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `onNavigate` | `function` | Callback `(filePath, line, column)` to navigate to error location in the editor |

**Local State:**

| State | Default | Description |
|---|---|---|
| `activeFilters` | `{ error: true, warning: true, info: true }` | Which severity levels are currently visible |

**Constants:**

| Constant | Description |
|---|---|
| `SEVERITY_ORDER` | `{ error: 0, warning: 1, info: 2, hint: 3 }` -- Sort priority |
| `SEVERITY_CONFIG` | Maps severity to `{ label, cssClass }` for filter buttons |

**Computed Data (useMemo):**

| Variable | Description |
|---|---|
| `counts` | `{ error: N, warning: N, info: N }` -- Total counts per severity (unfiltered) |
| `groupedDiagnostics` | `{ [filePath]: diagnosticItem[] }` -- Filtered and sorted diagnostics grouped by file |
| `totalVisible` | Total number of visible diagnostics after filtering |

**Severity Filter Buttons:**

Each severity has a toggle button in the summary bar showing an icon, count, and label. Active filters have the `.active` class. Clicking toggles visibility of that severity level.

**Diagnostic Row Features:**

| Feature | Description |
|---|---|
| Severity icon | Circle (error), triangle (warning), or info icon -- color-coded |
| Message | The diagnostic message text |
| Source | Optional source identifier (e.g., "json", "javascript", "css") |
| Location | `[line:column]` display |
| Click to navigate | Calls `onNavigate(filePath, line, column)` |
| Keyboard accessible | Enter/Space key triggers navigation (role="button", tabIndex=0) |

**Summary Bar:**

Displays total counts: `N errors, N warnings, N info` with filter toggle buttons.

**Empty States:**

- No diagnostics at all: Shows checkmark icon + "No problems detected"
- All filtered out: Shows "All problems filtered out"

**Internal Components:**

### SeverityIcon

| Severity | Icon | Color |
|---|---|---|
| `error` | Filled circle with exclamation | `var(--color-failed, #FF6B6B)` (red) |
| `warning` | Filled triangle with exclamation | `var(--color-warning, #FFD93D)` (yellow) |
| `info` / `hint` | Filled circle with "i" | `var(--color-in-progress, #9B7CF0)` (purple) |

**Helper Functions:**

| Function | Description |
|---|---|
| `shortenPath(filePath)` | Strips common workspace root prefix, shows from project-level directories (`/src/`, `/lib/`, etc.) or last 3 path segments |
| `fileName(filePath)` | Extracts just the filename from a full path |

**Render Structure:**

```
problems-panel
  |-- problems-summary-bar
  |   |-- [Errors: N] [Warnings: N] [Info: N] filter buttons
  |   |-- "N errors, N warnings, N info" summary text
  |-- problems-list
      |-- problems-file-group (per file)
          |-- problems-file-header
          |   |-- File icon + filename + shortened path + count badge
          |-- problems-row (per diagnostic)
              |-- SeverityIcon + message + [source] + [line:column]
```

---

## Utility Modules

### monacoWorkerSetup.js

**File:** `src/ui/utils/monacoWorkerSetup.js` (35 lines)

Configures Monaco Editor's web workers for language features. Must be imported before any Monaco editor instantiation as a side-effect import.

```javascript
import '@/utils/monacoWorkerSetup';
```

**Worker Mapping:**

| Language Labels | Worker |
|---|---|
| `json` | `jsonWorker` |
| `css`, `scss`, `less` | `cssWorker` |
| `html`, `handlebars`, `razor` | `htmlWorker` |
| `typescript`, `javascript` | `tsWorker` |
| (all others) | `editorWorker` |

### ideWorkspaceManager.js

**File:** `src/ui/utils/ideWorkspaceManager.js` (122 lines)

Bridges IDE workspaces to Synapse dashboards via localStorage. Enables shared Claude chat context between the IDE view and a linked dashboard.

**localStorage Key:** `synapse-ide-workspace-dashboards`

**Exported Functions:**

| Function | Return Type | Description |
|---|---|---|
| `getAllWorkspaceDashboards()` | `object` | Full `{ workspaceId: dashboardId }` mapping |
| `getWorkspaceDashboard(workspaceId)` | `string \| null` | Dashboard ID linked to workspace |
| `setWorkspaceDashboard(workspaceId, dashboardId)` | `void` | Store workspace-dashboard link |
| `removeWorkspaceDashboard(workspaceId)` | `void` | Remove link |
| `isIdeDashboard(dashboardId)` | `boolean` | Check if dashboard is linked to any workspace |
| `getWorkspaceForDashboard(dashboardId)` | `string \| null` | Reverse lookup: dashboard -> workspace |
| `getIdeDashboardLabel(dashboardId)` | `string` | Returns "Dashboard N (IDE)" if linked, else "Dashboard N" |
| `createWorkspaceDashboard(workspaceId)` | `Promise<string>` | Create new dashboard and link to workspace |

---

## Component Relationship Map

```
IDEView (root)
  |
  |-- IDEWelcome                  (no workspaces open)
  |-- WorkspaceTabs               (always, when workspaces exist)
  |
  |-- [Explorer Panel]
  |   |-- FileExplorer            (lazy-loaded directory tree)
  |       |-- TreeNode            (recursive file/folder node)
  |
  |-- [Editor Area]
  |   |-- EditorTabs              (open file tabs)
  |   |-- DebugToolbar            (when debugSession.status !== 'idle')
  |   |-- [Editor + Debug sidebar]
  |       |-- CodeEditor          (Monaco wrapper + breakpoints + diagnostics)
  |       |-- DebugPanels         (when debugSession.status !== 'idle')
  |           |-- VariablesSection
  |           |   |-- VariableRow (recursive, lazy-expandable)
  |           |-- CallStackSection
  |           |-- BreakpointsSection
  |           |-- WatchSection
  |
  |-- [Bottom Panel]
      |-- Terminal tab
      |-- Output tab
      |-- ProblemsPanel           (Problems tab -- diagnostics aggregation)
      |-- DebugConsolePanel       (Debug Console tab -- REPL + output)
      |-- Ports tab
```

---

## Dispatch Actions Used

All actions dispatched by IDE components:

| Action | Dispatched By | Description |
|---|---|---|
| `IDE_OPEN_WORKSPACE` | WorkspaceTabs, IDEWelcome | Open a new workspace |
| `IDE_SWITCH_WORKSPACE` | WorkspaceTabs | Switch to a different workspace tab |
| `IDE_CLOSE_WORKSPACE` | WorkspaceTabs | Close a workspace tab |
| `IDE_SET_FILE_TREE` | IDEView | Set the file tree for a workspace |
| `IDE_UPDATE_FILE_TREE_NODE` | FileExplorer | Update a single directory's children in the tree |
| `IDE_OPEN_FILE` | FileExplorer, IDEView (debug navigate) | Open a file in the editor |
| `IDE_SWITCH_FILE` | EditorTabs | Switch active file |
| `IDE_CLOSE_FILE` | EditorTabs | Close a file tab |
| `IDE_MARK_FILE_DIRTY` | CodeEditor | Mark file as having unsaved changes |
| `IDE_MARK_FILE_CLEAN` | CodeEditor | Mark file as clean (saved or unchanged) |
| `SWITCH_DASHBOARD` | IDEView, WorkspaceTabs | Sync active dashboard with workspace |
| `REMOVE_DASHBOARD` | WorkspaceTabs | Remove a closed workspace's dashboard |
| `SET` (activeLogFilter) | IDEView | Update log filter for BottomPanel |
| `SET` (ideNavigateToLine) | IDEView (debug navigate) | Navigate CodeEditor to a specific line |
| `SET` (debugWatchExpressions) | DebugPanels WatchSection | Update watch expression list |
| `DEBUG_SET_SESSION` | IDEView (push events) | Update debug session status |
| `DEBUG_SET_CALL_STACK` | IDEView (push events) | Update call stack frames |
| `DEBUG_SET_SCOPES` | IDEView (push events) | Update scope list |
| `DEBUG_SET_VARIABLES` | IDEView (push events) | Update variables for a scope |
| `DEBUG_CLEAR_SESSION` | IDEView (push events) | Clear all debug state on stop |
| `DEBUG_TOGGLE_BREAKPOINT` | CodeEditor, DebugPanels | Toggle a breakpoint at file:line |
