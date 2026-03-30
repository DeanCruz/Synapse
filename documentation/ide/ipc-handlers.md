# IDE IPC Handlers Reference

The IDE operations are handled by 24 IPC handlers registered in `electron/ipc-handlers.js`: 9 file system handlers (`ide-*`), 2 diagnostics handlers (`ide-check-syntax*`), and 13 debug handlers (`debug-*`). All are exposed to the renderer via `window.electronAPI` in `electron/preload.js`.

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

### Debug Process Isolation

Debug sessions spawn Node.js child processes with `--inspect` on localhost only. The CDP WebSocket connection is not exposed externally.

### Diagnostics Safety

JavaScript syntax checking uses `vm.compileFunction()` which compiles but does not execute code, preventing arbitrary code execution during diagnostics.

---

## Push Channels

| Channel | Direction | Description |
|---|---|---|
| `ide-file-change` | main -> renderer | Reserved for future file watcher notifications (registered in preload whitelist) |
| `debug-paused` | main -> renderer | Debug session paused (breakpoint hit, step completed, or manual pause). Includes callStack, scopes, variables. |
| `debug-resumed` | main -> renderer | Debug session resumed after continue/step |
| `debug-stopped` | main -> renderer | Debug session terminated |
| `debug-output` | main -> renderer | stdout/stderr output from the debugged process |

---

## File System Handlers

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

## Diagnostics Handlers

### Helper Functions (Internal)

The diagnostics system uses 5 internal helper functions (not exposed as IPC handlers):

| Function | Description |
|---|---|
| `ideDiagLanguage(filePath)` | Maps file extension to language: `.json` -> `'json'`, `.js/.jsx/.mjs/.cjs` -> `'javascript'`, `.ts/.tsx/.mts/.cts` -> `'typescript'`, `.css` -> `'css'`, others -> `null` |
| `ideDiagJSON(content, filePath)` | Checks JSON syntax via `JSON.parse()`. Extracts line/column from error position. |
| `ideDiagJS(content, filePath)` | Checks JS/TS syntax via `vm.compileFunction()`. Parses V8 error stack for line/column. |
| `ideDiagCSS(content, filePath)` | Checks CSS bracket/brace/string matching. Tracks open/close pairs, strings, and comments. |
| `ideDiagCheck(content, filePath)` | Routes to the appropriate checker based on `ideDiagLanguage()`. Returns `[]` for unsupported languages. |

### Diagnostic Object Shape

All diagnostics follow this structure:

```javascript
{
  file: "/absolute/path/to/file.js",
  line: 10,
  column: 5,
  endLine: 10,
  endColumn: 6,
  message: "Unexpected token )",
  severity: "error",         // "error" | "warning"
  source: "javascript"       // "json" | "javascript" | "css" | "system"
}
```

### `ide-check-syntax`

Check syntax of a single file.

**Renderer API:** `electronAPI.ideCheckSyntax(filePath, workspaceRoot)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `filePath` | `string` | Yes | Absolute path to the file to check |
| `workspaceRoot` | `string` | No | Workspace root for path validation |

**Returns:**

```javascript
// Success
{
  success: true,
  diagnostics: [
    {
      file: "/path/to/file.js",
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 6,
      message: "Unexpected token )",
      severity: "error",
      source: "javascript"
    }
  ]
}

// No errors
{ success: true, diagnostics: [] }

// Error (e.g., file not found)
{ success: false, error: "Error message" }
```

**Behavior:**
1. Validates path against workspace root (if provided)
2. Reads file content as UTF-8
3. Runs `ideDiagCheck(content, filePath)` to detect syntax errors
4. Returns array of diagnostics (empty if no errors)

**Supported Languages:**

| Language | Detection Method |
|---|---|
| JSON | `JSON.parse()` with position extraction from error message |
| JavaScript/JSX | `vm.compileFunction()` with V8 error stack parsing |
| TypeScript/TSX | Same as JavaScript (catches basic syntax errors) |
| CSS | Bracket/brace/parenthesis/string matching analysis |
| Others | Returns empty array (no checking) |

---

### `ide-check-syntax-batch`

Check syntax of multiple files concurrently.

**Renderer API:** `electronAPI.ideCheckSyntaxBatch(filePaths, workspaceRoot)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `filePaths` | `string[]` | Yes | Array of absolute file paths to check |
| `workspaceRoot` | `string` | No | Workspace root for path validation |

**Returns:**

```javascript
// Success
{
  success: true,
  results: {
    "/path/to/file.js": [
      { file: "...", line: 10, column: 5, message: "...", severity: "error", source: "javascript" }
    ],
    "/path/to/style.css": [],
    "/path/to/missing.js": [
      { file: "...", line: 1, column: 1, message: "ENOENT: no such file", severity: "error", source: "system" }
    ]
  }
}

// Input error
{ success: false, error: "filePaths must be an array" }
```

**Behavior:**
1. Validates that `filePaths` is an array
2. Processes all files concurrently via `Promise.all()`
3. Each file: validates path, reads content, runs diagnostics
4. If a file fails to read, returns a system-level diagnostic instead of failing the batch
5. Returns a map of `{ [filePath]: diagnostics[] }`

---

## Debug Handlers

All debug handlers delegate to `DebugService` (`electron/services/DebugService.js`), which manages the Node.js debug session via the Chrome DevTools Protocol (CDP).

### `debug-launch`

Start a debug session for a Node.js script.

**Renderer API:** `electronAPI.debugLaunch(opts)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `opts` | `object` | Yes | Launch configuration |
| `opts.scriptPath` | `string` | Yes | Path to the Node.js script to debug |
| `opts.args` | `string` | No | Command-line arguments for the script |
| `opts.cwd` | `string` | No | Working directory for the script |

**Returns:**

```javascript
{ success: true, ... }
// or
{ success: false, error: "Error message" }
```

**Behavior:**
1. Spawns `node --inspect=<port>` with the specified script
2. Connects to the CDP WebSocket endpoint
3. Enables `Debugger` and `Runtime` CDP domains
4. Broadcasts `debug-output` events for stdout/stderr from the child process

---

### `debug-stop`

Stop the active debug session.

**Renderer API:** `electronAPI.debugStop()`

**Parameters:** None

**Returns:**

```javascript
{ success: true }
// or
{ success: false, error: "Error message" }
```

**Behavior:**
1. Kills the debugged child process
2. Closes the CDP WebSocket connection
3. Broadcasts `debug-stopped` push event to all renderers

---

### `debug-set-breakpoint`

Set a breakpoint at a specific file and line number.

**Renderer API:** `electronAPI.debugSetBreakpoint(filePath, lineNumber, condition)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `filePath` | `string` | Yes | Absolute path to the source file |
| `lineNumber` | `number` | Yes | Line number for the breakpoint (1-based) |
| `condition` | `string` | No | Optional conditional expression for the breakpoint |

**Returns:**

```javascript
{ success: true, breakpointId: "1:10:0:..." }
// or
{ success: false, error: "Error message" }
```

**Behavior:** Sends `Debugger.setBreakpointByUrl` CDP command with the file URL and line number.

---

### `debug-remove-breakpoint`

Remove a breakpoint by its ID.

**Renderer API:** `electronAPI.debugRemoveBreakpoint(breakpointId)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `breakpointId` | `string` | Yes | Breakpoint ID returned from `debug-set-breakpoint` |

**Returns:**

```javascript
{ success: true }
// or
{ success: false, error: "Error message" }
```

**Behavior:** Sends `Debugger.removeBreakpoint` CDP command.

---

### `debug-continue`

Resume execution after being paused.

**Renderer API:** `electronAPI.debugContinue()`

**Parameters:** None

**Returns:**

```javascript
{ success: true }
// or
{ success: false, error: "Error message" }
```

**Behavior:** Sends `Debugger.resume` CDP command. Broadcasts `debug-resumed` push event.

---

### `debug-pause`

Pause execution of the running debug session.

**Renderer API:** `electronAPI.debugPause()`

**Parameters:** None

**Returns:**

```javascript
{ success: true }
// or
{ success: false, error: "Error message" }
```

**Behavior:** Sends `Debugger.pause` CDP command. When paused, broadcasts `debug-paused` push event with call stack and scope data.

---

### `debug-step-over`

Step over the current statement.

**Renderer API:** `electronAPI.debugStepOver()`

**Parameters:** None

**Returns:**

```javascript
{ success: true }
// or
{ success: false, error: "Error message" }
```

**Behavior:** Sends `Debugger.stepOver` CDP command. On completion, broadcasts `debug-paused` with updated call stack.

---

### `debug-step-into`

Step into the next function call.

**Renderer API:** `electronAPI.debugStepInto()`

**Parameters:** None

**Returns:**

```javascript
{ success: true }
// or
{ success: false, error: "Error message" }
```

**Behavior:** Sends `Debugger.stepInto` CDP command. On completion, broadcasts `debug-paused` with updated call stack.

---

### `debug-step-out`

Step out of the current function.

**Renderer API:** `electronAPI.debugStepOut()`

**Parameters:** None

**Returns:**

```javascript
{ success: true }
// or
{ success: false, error: "Error message" }
```

**Behavior:** Sends `Debugger.stepOut` CDP command. On completion, broadcasts `debug-paused` with updated call stack.

---

### `debug-evaluate`

Evaluate an expression in the current debug context.

**Renderer API:** `electronAPI.debugEvaluate(expression, callFrameId)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `expression` | `string` | Yes | JavaScript expression to evaluate |
| `callFrameId` | `string` | No | Call frame ID for scope context (uses `Debugger.evaluateOnCallFrame` if provided, else `Runtime.evaluate`) |

**Returns:**

```javascript
// Success
{
  success: true,
  result: {
    type: "number",
    value: 42,
    description: "42"
  }
}

// Error
{ success: false, error: "ReferenceError: x is not defined" }
```

**Behavior:**
- If `callFrameId` is provided: uses `Debugger.evaluateOnCallFrame` for local scope access
- If no `callFrameId`: uses `Runtime.evaluate` for global scope evaluation
- Returns the CDP RemoteObject result with type, value, and description

---

### `debug-get-variables`

Get variables for a specific scope or object reference.

**Renderer API:** `electronAPI.debugGetVariables(objectId)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `objectId` | `number` | Yes | Variables reference ID from a scope or expandable variable |

**Returns:**

```javascript
{
  success: true,
  variables: [
    { name: "count", value: "42", type: "number", variablesReference: 0 },
    { name: "items", value: "Array(3)", type: "object", variablesReference: 15 }
  ]
}
```

**Behavior:** Calls `Runtime.getProperties` CDP command to retrieve object properties. Maps CDP property descriptors to a simplified `{ name, value, type, variablesReference }` format.

---

### `debug-get-scopes`

Get scopes for the current paused call frame.

**Renderer API:** `electronAPI.debugGetScopes(callFrameId)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `callFrameId` | `string` | No | Call frame ID; defaults to the topmost frame if not provided |

**Returns:**

```javascript
{
  success: true,
  scopes: [
    { name: "Local", variablesReference: 10 },
    { name: "Closure", variablesReference: 11 },
    { name: "Global", variablesReference: 12 }
  ]
}
```

**Behavior:** Retrieves scope chain from the CDP call frame data. Each scope has a `variablesReference` that can be passed to `debug-get-variables` to load its variables.

---

### `debug-session-info`

Get current debug session information.

**Renderer API:** `electronAPI.debugSessionInfo()`

**Parameters:** None

**Returns:**

```javascript
// Session active
{
  success: true,
  status: "running",
  pid: 12345,
  scriptPath: "/path/to/script.js"
}

// No session
{
  success: true,
  status: "idle"
}
```

**Behavior:** Returns metadata about the current debug session from DebugService state. Does not involve any CDP communication.

---

## Context Bridge Summary

All IDE methods exposed in `electron/preload.js`:

```javascript
// File operations
ideReadFile:           (filePath, workspaceRoot) => invoke('ide-read-file', ...)
ideWriteFile:          (filePath, content, workspaceRoot) => invoke('ide-write-file', ...)
ideReadDir:            (dirPath, options) => invoke('ide-read-dir', ...)
ideListDir:            (dirPath, options) => invoke('ide-list-dir', ...)
ideCreateFile:         (filePath, content, workspaceRoot) => invoke('ide-create-file', ...)
ideCreateFolder:       (dirPath, workspaceRoot) => invoke('ide-create-folder', ...)
ideRename:             (oldPath, newPath, workspaceRoot) => invoke('ide-rename', ...)
ideDelete:             (targetPath, workspaceRoot) => invoke('ide-delete', ...)

// Dialog
ideSelectFolder:       () => invoke('ide-select-folder')

// Diagnostics
ideCheckSyntax:        (filePath, workspaceRoot) => invoke('ide-check-syntax', ...)
ideCheckSyntaxBatch:   (filePaths, workspaceRoot) => invoke('ide-check-syntax-batch', ...)

// Debug session
debugLaunch:           (opts) => invoke('debug-launch', ...)
debugStop:             () => invoke('debug-stop')
debugSetBreakpoint:    (filePath, lineNumber, condition) => invoke('debug-set-breakpoint', ...)
debugRemoveBreakpoint: (breakpointId) => invoke('debug-remove-breakpoint', ...)
debugContinue:         () => invoke('debug-continue')
debugPause:            () => invoke('debug-pause')
debugStepOver:         () => invoke('debug-step-over')
debugStepInto:         () => invoke('debug-step-into')
debugStepOut:          () => invoke('debug-step-out')
debugEvaluate:         (expression, callFrameId) => invoke('debug-evaluate', ...)
debugGetVariables:     (objectId) => invoke('debug-get-variables', ...)
debugGetScopes:        (callFrameId) => invoke('debug-get-scopes', ...)
debugSessionInfo:      () => invoke('debug-session-info')

// Push event subscriptions (via electronAPI.on)
on('debug-paused', callback)   -- Execution paused with call stack + scopes
on('debug-resumed', callback)  -- Execution resumed
on('debug-stopped', callback)  -- Session terminated
on('debug-output', callback)   -- stdout/stderr from debugged process
```

---

## Handler Summary Table

| Channel | Category | Method | Description |
|---|---|---|---|
| `ide-read-file` | File System | `fsPromises.readFile` | Read file contents (with binary detection) |
| `ide-write-file` | File System | `fsPromises.writeFile` | Write file contents |
| `ide-read-dir` | File System | `fsPromises.readdir` (recursive) | Recursive directory tree |
| `ide-list-dir` | File System | `fsPromises.readdir` (single level) | Single-level directory listing |
| `ide-create-file` | File System | `fsPromises.writeFile` | Create new file |
| `ide-create-folder` | File System | `fsPromises.mkdir` | Create new directory |
| `ide-rename` | File System | `fsPromises.rename` | Rename file or folder |
| `ide-delete` | File System | `fsPromises.rm` / `fsPromises.unlink` | Delete file or folder |
| `ide-select-folder` | File System | `dialog.showOpenDialog` | Native OS folder picker |
| `ide-check-syntax` | Diagnostics | `vm.compileFunction` / `JSON.parse` / bracket matching | Check syntax of a single file |
| `ide-check-syntax-batch` | Diagnostics | Same (concurrent) | Check syntax of multiple files |
| `debug-launch` | Debug | `DebugService.launch` | Start Node.js debug session |
| `debug-stop` | Debug | `DebugService.stop` | Stop debug session |
| `debug-set-breakpoint` | Debug | `DebugService.setBreakpoint` | Set breakpoint at file:line |
| `debug-remove-breakpoint` | Debug | `DebugService.removeBreakpoint` | Remove breakpoint by ID |
| `debug-continue` | Debug | `DebugService.resume` | Resume execution |
| `debug-pause` | Debug | `DebugService.pause` | Pause execution |
| `debug-step-over` | Debug | `DebugService.stepOver` | Step over statement |
| `debug-step-into` | Debug | `DebugService.stepInto` | Step into function |
| `debug-step-out` | Debug | `DebugService.stepOut` | Step out of function |
| `debug-evaluate` | Debug | `DebugService.evaluate` | Evaluate expression |
| `debug-get-variables` | Debug | `DebugService.getVariables` | Get scope/object variables |
| `debug-get-scopes` | Debug | `DebugService.getScopes` | Get call frame scopes |
| `debug-session-info` | Debug | `DebugService.getSessionInfo` | Get session metadata |
