# IDE Components Reference

All IDE components live in `src/ui/components/ide/`. They use React Context (`useAppState()` and `useDispatch()`) for state management -- no prop drilling required except where noted.

---

## IDEView

**File:** `src/ui/components/ide/IDEView.jsx` (167 lines)

The root layout component for the Code Explorer. Assembles all IDE sub-components and manages the draggable split panel between the file explorer and editor.

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

**Effects:**

1. **Load file tree on workspace change** -- When `activeWorkspace` changes, checks if tree is already cached in `ideFileTrees`. If not, calls `electronAPI.ideReadDir()` and dispatches `IDE_SET_FILE_TREE`. Includes cleanup cancellation to prevent stale updates.

2. **Draggable divider** -- Attaches global `mousemove`/`mouseup` listeners during drag. Constrains width between 180px and 500px. Applies `.ide-dragging` class to `document.body` for global `col-resize` cursor.

**Render Logic:**

- If no workspaces: renders `<IDEWelcome />`
- If workspaces exist: renders the full IDE layout with `WorkspaceTabs`, `FileExplorer`, divider, `EditorTabs`, and `CodeEditor`
- If no file is active: renders an empty state placeholder with a file icon

---

## FileExplorer

**File:** `src/ui/components/ide/FileExplorer.jsx` (364 lines)

Recursive tree view displaying the workspace's file system. Supports folder expand/collapse, file-type icons, active file highlighting, and tree refresh.

**Props:** None (context only)

**Local State:**

| State | Default | Description |
|---|---|---|
| `expandedPaths` | `new Set()` | Set of directory paths currently expanded |
| `loading` | `false` | Whether the tree is being loaded |

**Event Handlers:**

| Handler | Description |
|---|---|
| `toggleExpand(path)` | Toggles a directory path in the `expandedPaths` Set |
| `onFileClick(node)` | Dispatches `IDE_OPEN_FILE` with the file's path and name |
| `handleRefresh()` | Re-fetches the directory tree from disk via IPC |

**File Type Icons:**

The `getFileIcon()` function returns colored SVG icons based on file extension:

| Extensions | Icon Color | Description |
|---|---|---|
| `.js`, `.jsx` | Yellow (#E8D44D) | JavaScript |
| `.ts`, `.tsx` | Blue (#3178C6) | TypeScript |
| `.css`, `.scss`, `.less` | Blue (#1572B6) | Stylesheets |
| `.json` | Green (#6DB33F) | JSON |
| `.html` | Orange (#E44D26) | HTML |
| `.md`, `.mdx` | White (#F5F5F7) | Markdown |
| Other | Gray (#A1A1A6) | Generic file |

**TreeNode (Internal Component):**

Recursive component rendering a single file or folder node.

| Prop | Type | Description |
|---|---|---|
| `node` | `{ name, path, type, children? }` | Tree node data |
| `depth` | `number` | Nesting depth for indent calculation |
| `expandedPaths` | `Set` | Set of expanded directory paths |
| `toggleExpand` | `function` | Callback to toggle expansion |
| `onFileClick` | `function` | Callback when a file is clicked |
| `activeFilePath` | `string` | Path of the currently active file (for highlighting) |

Indent is calculated as `8 + (depth * 14)` pixels of left padding.

**IPC Calls:**

- `electronAPI.ideReadDir(workspace.path, { maxDepth: 3 })` -- Load directory tree

---

## CodeEditor

**File:** `src/ui/components/ide/CodeEditor.jsx` (344 lines)

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
| `.js`, `.mjs`, `.cjs` | `javascript` |
| `.jsx` | `javascript` (JSX) |
| `.ts`, `.mts`, `.cts` | `typescript` |
| `.tsx` | `typescript` (TSX) |
| `.py` | `python` |
| `.json` | `json` |
| `.html`, `.htm` | `html` |
| `.css` | `css` |
| `.scss` | `scss` |
| `.less` | `less` |
| `.xml`, `.svg` | `xml` |
| `.yaml`, `.yml` | `yaml` |
| `.sh`, `.bash`, `.zsh` | `shell` |
| `.sql` | `sql` |
| `.go` | `go` |
| `.rs` | `rust` |
| `.java` | `java` |
| `.rb` | `ruby` |
| `.c`, `.h` | `c` |
| `.cpp`, `.hpp`, `.cc` | `cpp` |
| `.swift` | `swift` |
| `.kt` | `kotlin` |
| `.php` | `php` |
| `.r` | `r` |
| `.lua` | `lua` |
| `.toml` | `toml` |
| `Dockerfile` | `dockerfile` |
| `Makefile` | `makefile` |

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

**File:** `src/ui/components/ide/WorkspaceTabs.jsx` (85 lines)

Horizontal tab bar showing all open workspace folders. Each tab displays the folder name with a folder icon and close button.

**Props:** None (context only)

**Tab Features:**

| Feature | Description |
|---|---|
| Active indicator | Darker background and full opacity icon |
| Close button | `x` button, visible on hover or when tab is active |
| Add button | `+` button at end of tab bar, opens native folder picker |
| Folder icon | Purple folder SVG icon |

**Event Handlers:**

| Handler | Description |
|---|---|
| `handleAddWorkspace()` | Opens native folder picker, dispatches `IDE_OPEN_WORKSPACE` |
| `handleSwitchWorkspace(id)` | Dispatches `IDE_SWITCH_WORKSPACE` |
| `handleCloseWorkspace(e, id)` | Dispatches `IDE_CLOSE_WORKSPACE` |

**IPC Calls:**

- `electronAPI.ideSelectFolder()` -- Open native folder picker
- `electronAPI.ideReadDir(folderPath)` -- Load file tree for new workspace

---

## IDEWelcome

**File:** `src/ui/components/ide/IDEWelcome.jsx` (129 lines)

Welcome screen displayed when no workspaces are open. Provides buttons to open an existing folder or create a new one.

**Props:** None (context only)

**Actions:**

| Button | Behavior |
|---|---|
| **Open Folder** | Opens native folder picker, dispatches `IDE_OPEN_WORKSPACE` |
| **Create New Folder** | Opens native folder picker (select parent), prompts for folder name, calls `electronAPI.ideCreateFolder()`, dispatches `IDE_OPEN_WORKSPACE` |

**Render Structure:**

```
ide-welcome
  |-- Code bracket icon (64x64px SVG)
  |-- "Code Explorer" title
  |-- "Open a folder to start editing" subtitle
  |-- [Open Folder] button (primary, purple gradient)
  |-- [Create New Folder] button (secondary)
```

**IPC Calls:**

- `electronAPI.ideSelectFolder()` -- Native folder picker
- `electronAPI.ideCreateFolder(path, workspacePath)` -- Create directory

---

## Utility Modules

### monacoWorkerSetup.js

**File:** `src/ui/utils/monacoWorkerSetup.js` (36 lines)

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

**File:** `src/ui/utils/ideWorkspaceManager.js` (123 lines)

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
