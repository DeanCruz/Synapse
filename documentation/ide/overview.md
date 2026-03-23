# Code Explorer (IDE) Architecture Overview

The Code Explorer is Synapse's built-in IDE, accessible via a tab in the sidebar alongside the Dashboards tab. It provides a file explorer, Monaco-powered code editor, multi-workspace tabs, and a bridge to link workspaces with dashboards for integrated Claude chat.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Code Editor | Monaco Editor ^0.55.1 (VS Code's editor component) |
| UI Framework | React 19 (functional components, hooks, Context) |
| Desktop Shell | Electron (IPC for file system access) |
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
  |-- CodeEditor             -- Monaco Editor wrapper
  |-- BottomPanel            -- VS Code-style bottom panel (Terminal, Output, etc.)
  |-- IDEWelcome             -- Welcome screen (no workspaces open)
      |
      v
Electron IPC (file system)
  |-- ide-read-file          -- Read file contents
  |-- ide-write-file         -- Save file contents
  |-- ide-read-dir           -- Recursive directory tree
  |-- ide-list-dir           -- Single-level directory listing (lazy load)
  |-- ide-create-file        -- Create new file
  |-- ide-create-folder      -- Create new directory
  |-- ide-rename             -- Rename file or folder
  |-- ide-delete             -- Delete file or folder
  |-- ide-select-folder      -- Native OS folder picker
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
              <CodeEditor />       (Monaco instance)
            </ide-editor-area>
          </ide-main>
          <BottomPanel />          (Terminal, Output, Problems, Debug Console, Ports)
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
```

### Saving a File

```
1. User presses Cmd+S / Ctrl+S in Monaco
2. CodeEditor.handleSave() fires
3. electronAPI.ideWriteFile(filePath, content, workspacePath)
4. Dispatch IDE_MARK_FILE_CLEAN { workspaceId, fileId }
5. "Saved" toast fades in and out (1.5s)
```

### Dirty File Detection

```
1. User types in Monaco editor
2. onDidChangeModelContent listener fires
3. Content compared to originalContentRef
4. If different: Dispatch IDE_MARK_FILE_DIRTY
5. If matches original: Dispatch IDE_MARK_FILE_CLEAN
6. EditorTabs shows/hides purple dot indicator
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

## File Structure

```
src/ui/
  components/ide/
    IDEView.jsx              -- Main layout orchestrator (226 lines)
    FileExplorer.jsx         -- Lazy-loaded tree view (422 lines)
    CodeEditor.jsx           -- Monaco editor wrapper (343 lines)
    EditorTabs.jsx           -- Open file tab bar (84 lines)
    WorkspaceTabs.jsx        -- Workspace folder tabs + dashboard bridge (118 lines)
    IDEWelcome.jsx           -- Welcome screen (156 lines)
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

electron/
  ipc-handlers.js            -- 9 IDE file system handlers (added ~260 lines)
  preload.js                 -- 9 IDE methods exposed via contextBridge
```

**Total:** ~2,491 lines of code across 14 files.

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

---

## Security

- **Path validation** -- `ideValidatePath()` prevents directory traversal attacks by checking that resolved paths stay within the workspace root
- **Binary detection** -- Files with null bytes in the first 8KB are flagged as binary and not displayed
- **Symlink safety** -- `lstat()` used instead of `stat()` to avoid following symlinks outside workspace boundaries
- **Context isolation** -- All IPC goes through Electron's `contextBridge` with channel whitelisting
