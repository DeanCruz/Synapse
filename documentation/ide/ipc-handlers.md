# IDE IPC Handlers Reference

The IDE file system operations are handled by 9 IPC handlers registered in `electron/ipc-handlers.js`. All handlers follow the `ide-*` naming convention and are exposed to the renderer via `window.electronAPI` in `electron/preload.js`.

---

## Security Model

All IDE IPC handlers enforce security constraints:

### Path Validation

The `ideValidatePath(filePath, workspaceRoot)` helper prevents directory traversal attacks:

1. Resolves the absolute path using `path.resolve()`
2. If `workspaceRoot` is provided, verifies the resolved path starts with the workspace root
3. Rejects paths that escape the workspace boundary (e.g., `../../etc/passwd`)

### Binary Detection

The `isBinaryFile(buffer)` helper detects binary files:

1. Takes a file buffer as input
2. Scans the first 8KB for null bytes (`0x00`)
3. Returns `true` if any null bytes found

### Symlink Safety

Directory traversal uses `fs.lstat()` instead of `fs.stat()` to avoid following symlinks outside workspace boundaries. Symlinks are silently skipped during recursive directory reads.

---

## Push Channel

| Channel | Description |
|---|---|
| `ide-file-change` | Reserved for future file watcher notifications (registered in preload whitelist) |

---

## Handler Reference

### `ide-read-file`

Read the contents of a file.

**Renderer API:** `electronAPI.ideReadFile(filePath, workspaceRoot)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `filePath` | `string` | Yes | Absolute path to the file |
| `workspaceRoot` | `string` | No | Workspace root for path validation |

**Returns:**

```javascript
// Success (text file)
{ success: true, binary: false, content: "file contents as UTF-8 string", path: "/absolute/path", name: "filename.ext" }

// Success (binary file)
{ success: true, binary: true, path: "/absolute/path", name: "filename.ext" }

// Error
{ success: false, error: "Error message" }
```

**Behavior:**
1. Validates path against workspace root (if provided)
2. Checks if file is binary (first 8KB scanned for null bytes)
3. If binary, returns `{ success: true, binary: true }` without content
4. If text, reads entire file as UTF-8 and returns content

---

### `ide-write-file`

Write content to an existing file.

**Renderer API:** `electronAPI.ideWriteFile(filePath, content, workspaceRoot)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `filePath` | `string` | Yes | Absolute path to the file |
| `content` | `string` | Yes | UTF-8 content to write |
| `workspaceRoot` | `string` | No | Workspace root for path validation |

**Returns:**

```javascript
{ success: true, path: "/absolute/path/to/file" }
// or
{ success: false, error: "Error message" }
```

---

### `ide-read-dir`

Read a directory tree recursively.

**Renderer API:** `electronAPI.ideReadDir(dirPath, options)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `dirPath` | `string` | Yes | Absolute path to the directory |
| `options` | `object` | No | Configuration options |
| `options.ignore` | `string[]` | No | Directory names to skip |
| `options.maxDepth` | `number` | No | Maximum recursion depth (default: 20) |

**Default Ignore List:**

```javascript
['.git', 'node_modules', '.DS_Store', '__pycache__', '.next', '.cache', 'dist', 'build', '.venv', 'venv']
```

**Returns:**

```javascript
{
  success: true,
  tree: {
    name: "my-project",
    path: "/Users/dean/my-project",
    type: "directory",
    children: [
      {
        name: "src",
        path: "/Users/dean/my-project/src",
        type: "directory",
        children: [
          {
            name: "index.js",
            path: "/Users/dean/my-project/src/index.js",
            type: "file"
          }
        ]
      },
      {
        name: "package.json",
        path: "/Users/dean/my-project/package.json",
        type: "file"
      }
    ]
  }
}
```

**Sort Order:**
- Directories first (case-insensitive alphabetical)
- Then files (case-insensitive alphabetical)

**Behavior:**
1. Uses `fs.lstat()` to avoid following symlinks
2. Skips entries matching the ignore list
3. Skips all hidden files/directories (names starting with `.`)
4. Skips symlinks entirely
5. Recurses up to `maxDepth` levels
6. Returns sorted tree with directories before files

---

### `ide-list-dir`

Single-level directory listing for lazy-loaded file explorer. Returns only immediate children (no recursion). Directories are returned with `children: null` to indicate they haven't been loaded yet.

**Renderer API:** `electronAPI.ideListDir(dirPath, options)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `dirPath` | `string` | Yes | Absolute path to the directory |
| `options` | `object` | No | Configuration options |
| `options.ignore` | `string[]` | No | Entry names to skip |

**Default Ignore List:** Same as `ide-read-dir`.

**Returns:**

```javascript
{
  success: true,
  entries: [
    {
      name: "src",
      path: "/Users/dean/my-project/src",
      type: "directory",
      children: null
    },
    {
      name: "package.json",
      path: "/Users/dean/my-project/package.json",
      type: "file"
    }
  ]
}
```

**Sort Order:**
- Directories first (case-insensitive alphabetical)
- Then files (case-insensitive alphabetical)

**Behavior:**
1. Uses `fs.lstat()` to avoid following symlinks
2. Filters entries matching the ignore list (does NOT filter all hidden files, unlike `ide-read-dir`)
3. Skips symlinks entirely
4. Directories include `children: null` to signal lazy-loadable
5. Files do not include a `children` property
6. Returns sorted entries with directories before files

---

### `ide-create-file`

Create a new file, optionally with initial content.

**Renderer API:** `electronAPI.ideCreateFile(filePath, content, workspaceRoot)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `filePath` | `string` | Yes | Absolute path for the new file |
| `content` | `string` | No | Initial content (default: empty string) |
| `workspaceRoot` | `string` | No | Workspace root for path validation |

**Returns:**

```javascript
{ success: true, path: "/absolute/path/to/file" }
// or
{ success: false, error: "File already exists" }
```

**Behavior:**
1. Validates path
2. Creates parent directories if they don't exist (`fs.mkdir({ recursive: true })`)
3. Checks if the file already exists via `fs.access()` -- fails with "File already exists" if so
4. Writes initial content as UTF-8

---

### `ide-create-folder`

Create a new directory.

**Renderer API:** `electronAPI.ideCreateFolder(dirPath, workspaceRoot)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `dirPath` | `string` | Yes | Absolute path for the new directory |
| `workspaceRoot` | `string` | No | Workspace root for path validation |

**Returns:**

```javascript
{ success: true, path: "/absolute/path/to/folder" }
// or
{ success: false, error: "Error message" }
```

**Behavior:**
- Creates the directory recursively (`fs.mkdir({ recursive: true })`)

---

### `ide-rename`

Rename a file or folder.

**Renderer API:** `electronAPI.ideRename(oldPath, newPath, workspaceRoot)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `oldPath` | `string` | Yes | Current absolute path |
| `newPath` | `string` | Yes | New absolute path |
| `workspaceRoot` | `string` | No | Workspace root for path validation |

**Returns:**

```javascript
{ success: true, oldPath: "...", newPath: "..." }
// or
{ success: false, error: "Error message" }
```

**Behavior:**
- Validates both old and new paths against workspace root
- Uses `fs.rename()` for atomic rename

---

### `ide-delete`

Delete a file or folder.

**Renderer API:** `electronAPI.ideDelete(targetPath, workspaceRoot)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `targetPath` | `string` | Yes | Absolute path to delete |
| `workspaceRoot` | `string` | No | Workspace root for path validation |

**Returns:**

```javascript
{ success: true, path: "..." }
// or
{ success: false, error: "Error message" }
```

**Behavior:**
- Validates path against workspace root
- For directories: uses `fs.rm({ recursive: true, force: true })`
- For files: uses `fs.unlink()`

---

### `ide-select-folder`

Open the native OS folder picker dialog.

**Renderer API:** `electronAPI.ideSelectFolder()`

**Parameters:** None

**Returns:**

```javascript
"/Users/dean/my-project"   // Selected folder path
// or
null                        // User cancelled
```

**Behavior:**
- Opens Electron's native `dialog.showOpenDialog()`
- Properties: `['openDirectory', 'createDirectory']`
- Returns the first selected path or `null` if cancelled

---

## Context Bridge Summary

All IDE methods exposed in `electron/preload.js`:

```javascript
// File operations
ideReadFile:     (filePath, workspaceRoot) => invoke('ide-read-file', ...)
ideWriteFile:    (filePath, content, workspaceRoot) => invoke('ide-write-file', ...)
ideReadDir:      (dirPath, options) => invoke('ide-read-dir', ...)
ideListDir:      (dirPath, options) => invoke('ide-list-dir', ...)
ideCreateFile:   (filePath, content, workspaceRoot) => invoke('ide-create-file', ...)
ideCreateFolder: (dirPath, workspaceRoot) => invoke('ide-create-folder', ...)
ideRename:       (oldPath, newPath, workspaceRoot) => invoke('ide-rename', ...)
ideDelete:       (targetPath, workspaceRoot) => invoke('ide-delete', ...)

// Dialog
ideSelectFolder: () => invoke('ide-select-folder')
```
