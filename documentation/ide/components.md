# IDE Components Reference

All IDE components live in `src/ui/components/ide/`. They use React Context (`useAppState()` and `useDispatch()`) for state management -- no prop drilling required except where noted.

---

## IDEView

**File:** `src/ui/components/ide/IDEView.jsx` (226 lines)

The root layout component for the Code Explorer. Assembles all IDE sub-components (WorkspaceTabs, FileExplorer, EditorTabs, CodeEditor, BottomPanel, IDEWelcome) and manages the draggable split panel between the file explorer and editor. Also orchestrates workspace-dashboard lifecycle (creation, validation, syncing).

**Props:** None (context only)

**Local State:**

| State | Default | Description |
|---|---|---|
| `explorerWidth` | `250` | File explorer panel width in pixels |
| `isDragging` | `false` | Whether the divider is actively being dragged |

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

**Effects:**

1. **Load file tree on workspace change** -- When `activeWorkspace` changes, checks if tree is already cached in `ideFileTrees`. If not, calls `electronAPI.ideReadDir()` and dispatches `IDE_SET_FILE_TREE`. Includes cleanup cancellation to prevent stale updates.

2. **Validate workspace-dashboard mappings** -- On app restart, iterates all workspaces and checks if their linked dashboard still exists in `dashboardList`. Stale or missing mappings are removed and recreated via `createWorkspaceDashboard()`. Newly created dashboards get their project path stored via `saveDashboardProject()`.

3. **Sync dashboard to active workspace** -- When `ideActiveWorkspaceId` changes, dispatches `SWITCH_DASHBOARD` to keep the active dashboard in sync with the workspace.

4. **Draggable divider** -- Attaches global `mousemove`/`mouseup` listeners during drag. Constrains width between 180px and 500px. Applies `.ide-dragging` class to `document.body` for global `col-resize` cursor.

**Render Logic:**

- If no workspaces: renders `<IDEWelcome />` + `<BottomPanel />` (embedded mode)
- If workspaces exist: renders the full IDE layout with `WorkspaceTabs`, `FileExplorer`, divider, `EditorTabs`, `CodeEditor`, and `<BottomPanel />`
- If no file is active: renders an empty state placeholder with a file icon
- BottomPanel receives `projectDir` as the active workspace path (or dashboard project path as fallback)

---

## FileExplorer

**File:** `src/ui/components/ide/FileExplorer.jsx` (422 lines)

Lazy-loaded tree view displaying the workspace's file system. Loads only the root level on workspace open and lazily fetches subdirectory contents on expand. Supports folder expand/collapse, file-type icons (as dedicated SVG components), active file highlighting, loading spinners per directory, and tree refresh.

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

**File:** `src/ui/components/ide/CodeEditor.jsx` (343 lines)

Monaco Editor wrapper with file loading, syntax highlighting, save functionality, and dirty tracking.

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

**Effects:**

1. **Create/destroy editor** -- Creates Monaco editor instance on mount with `synapse-dark` theme, registers Cmd+S keybinding, sets up `ResizeObserver` for responsive layout. Disposes everything on unmount.

2. **Load file content** -- When `filePath` changes, reads file via IPC, detects binary files, auto-detects language, updates Monaco model, and attaches change listener for dirty tracking.

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

**IPC Calls:**

- `electronAPI.ideReadFile(filePath, workspacePath)` -- Read file contents
- `electronAPI.ideWriteFile(filePath, content, workspacePath)` -- Save file

---

## EditorTabs

**File:** `src/ui/components/ide/EditorTabs.jsx` (84 lines)

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

**File:** `src/ui/components/ide/WorkspaceTabs.jsx` (118 lines)

Horizontal tab bar showing all open workspace folders. Each tab displays the folder name with a folder icon and close button. Manages full workspace-dashboard lifecycle: creates dashboards on add, syncs dashboard on switch, and cleans up dashboards on close.

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
