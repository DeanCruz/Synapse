# Chat IPC Handlers

## Overview

The Chat system communicates between the renderer (React UI) and main process (Electron) via IPC channels exposed through `electron/preload.js`. The bridge is exposed as `window.electronAPI`.

There are two categories:
1. **Push channels** (main -> renderer): Real-time events pushed from the main process
2. **Pull methods** (renderer -> main): Request/response invocations initiated by the UI

---

## Push Channels (Main -> Renderer)

These are events the main process broadcasts to the renderer. The UI subscribes via `api.on(channel, callback)`.

### `worker-output`

Fired for every line of output from a spawned Claude CLI process.

```typescript
{
  pid: number;           // Process ID
  provider: 'claude' | 'codex';
  taskId: string;        // e.g., "chat-msg-1234567890"
  dashboardId: string;   // e.g., "chat-agent-a1b2"
  chunk: string;         // Raw NDJSON line
  parsed: object | null; // Parsed JSON event (or null if not valid JSON)
  isStderr?: boolean;    // True for stderr output (tool activity)
}
```

### `worker-complete`

Fired when a Claude CLI process exits.

```typescript
{
  pid: number;
  provider: 'claude' | 'codex';
  taskId: string;
  dashboardId: string;
  exitCode: number;
  output: string;        // Full stdout accumulation
  errorOutput: string;   // Full stderr accumulation
}
```

### `worker-error`

Fired when a process fails to spawn or encounters a fatal error.

```typescript
{
  pid: number;
  provider: 'claude' | 'codex';
  taskId: string;
  dashboardId: string;
  error: string;         // Error message
}
```

### `worker-permission-request`

Fired when the CLI requests permission for a tool (non-bypass mode).

```typescript
{
  pid: number;
  taskId: string;
  dashboardId: string;
  tool: string;          // Tool name
  input: object;         // Tool input
}
```

### `chat_dashboard_changed`

Fired when any file changes inside a `dashboards/chat-agent-*` directory. Debounced at 200ms.

```typescript
{
  timestamp: number;     // Date.now()
}
```

### `settings-changed`

Fired when global settings are modified (used to sync model/provider selection).

```typescript
{
  settings: object;      // Full settings object
}
```

---

## Pull Methods (Renderer -> Main)

### Chat Context

#### `getChatSystemPrompt(projectDir, dashboardId, additionalContextDirs)`

Builds the full system prompt for an agent chat session.

**Parameters:**
- `projectDir: string` — Target project directory path
- `dashboardId: string` — Agent's dashboard ID (required)
- `additionalContextDirs: string[]` — Extra read-only context directories

**Returns:** `string` — Concatenated system prompt containing:
1. Response Priority Protocol (question > clarify > execute)
2. Communication Transparency Protocol (always narrate work)
3. Directory References (Synapse root, project root, dashboard binding, isolation rules)
4. Synapse CLAUDE.md content
5. Project CLAUDE.md content (with fallback to additional context dirs)

#### `logChatEvent(dashboardId, entry)`

Appends a log entry to the agent's dashboard `logs.json`.

**Parameters:**
- `dashboardId: string` — Target dashboard
- `entry: object` — Log entry to append

**Returns:** `{ success: true }` or `{ error: string }`

#### `getChatDashboardData()`

Reads all `chat-agent-*` dashboards and returns aggregated agent lanes for the dashboard view.

**Parameters:** None

**Returns:**
```typescript
{
  agents: Array<{
    name: string;       // Display name from initialization.json
    tasks: Array<{
      task_id: string;
      title: string;
      status: 'pending' | 'in_progress' | 'completed' | 'failed';
      started_at: string | null;
      completed_at: string | null;
      summary: string | null;
      stage: string | null;
      message: string | null;
      files_changed: string[];
      deviations: string[];
      depends_on: string[];
      layer: string | null;
      directory: string | null;
      assigned_agent: string | null;
    }>
  }>
}
```

#### `createChatAgent(opts)`

Creates a new chat agent with a unique 4-hex identifier.

**Parameters:**
- `opts.projectPath?: string` — Optional project path to associate

**Side effects:**
- Creates `Chat/chat{N}/agent{hex}/` directory
- Creates `dashboards/chat-agent-{hex}/` with empty `progress/` and `logs.json`
- Writes `project.json` in agent dir if projectPath provided

**Returns:**
```typescript
{
  chatNumber: number;   // Sequential chat folder number
  agentHex: string;     // 4-hex unique ID (e.g., "a1b2")
  agentDir: string;     // Full path to agent directory
  chatDir: string;      // Full path to chat directory
  dashDir: string;      // Full path to dashboard directory
}
```

#### `deleteChatAgent(agentHex)`

Removes a chat agent's on-disk directories.

**Parameters:**
- `agentHex: string` — The 4-hex agent ID

**Side effects:**
- Removes `Chat/chat{N}/agent{hex}/` directory
- Removes parent `chat{N}/` if empty after deletion
- Removes `dashboards/chat-agent-{hex}/` directory

**Returns:** `{ success: true }`

---

### Conversation Management

#### `listConversations(dashboardId?, surface?)`

Lists saved conversations, filtered by dashboard and/or surface.

**Parameters:**
- `dashboardId?: string` — Filter to this dashboard's conversations
- `surface?: 'chat' | 'code'` — Filter by surface (legacy entries default to `'code'`)

**Returns:**
```typescript
{
  conversations: Array<{
    id: string;
    name: string;
    created: string;     // ISO timestamp
    updated: string;     // ISO timestamp
    dashboardId: string | null;
    surface: string | null;
    messageCount: number;
  }>
}
```

#### `loadConversation(id)`

Loads a full conversation with all messages.

**Parameters:**
- `id: string` — Conversation ID (e.g., `"conv_1234567890"`)

**Returns:** Full conversation object or `{ error: string }`

```typescript
{
  id: string;
  name: string;
  created: string;
  updated: string;
  dashboardId?: string;
  surface?: 'chat' | 'code';
  sessionId?: string;
  sessionProvider?: string;
  messages: Array<MessageObject>;
}
```

#### `saveConversation(conv)`

Saves (creates or updates) a conversation to disk.

**Parameters:**
- `conv: object` — Full conversation object (must include `id`)

**Returns:** `{ success: true, id: string }` or `{ success: false, error: string }`

#### `createConversation(name?)`

Creates a new empty conversation.

**Parameters:**
- `name?: string` — Display name (defaults to `"Session {N}"`)

**Returns:** The created conversation object

#### `deleteConversation(id)`

Deletes a conversation file.

**Parameters:**
- `id: string` — Conversation ID

**Returns:** `{ success: true }` or `{ error: string }`

#### `renameConversation(id, newName)`

Renames a conversation.

**Parameters:**
- `id: string` — Conversation ID
- `newName: string` — New display name

**Returns:** Updated conversation object or `{ error: string }`

---

### Worker Management

#### `spawnWorker(opts)`

Spawns a Claude Code CLI process.

**Parameters:**
```typescript
{
  taskId: string;           // Unique task identifier
  dashboardId: string;      // Dashboard to bind to
  projectDir: string;       // Working directory
  prompt: string;           // User prompt text
  systemPrompt: string;     // Full system prompt
  model?: string;           // Model selection
  cliPath?: string;         // Path to claude binary
  dangerouslySkipPermissions?: boolean;
  resumeSessionId?: string; // Resume existing session
  additionalContextDirs?: string[];
}
```

**Returns:** `{ pid: number, taskId: string, dashboardId: string }`

#### `killWorker(pid)`

Terminates a specific worker process (SIGTERM, then SIGKILL after 5s).

#### `writeWorker(pid, data)`

Writes data to a worker's stdin (used for permission relay responses).

#### `getActiveWorkers()`

Returns array of currently running workers with their metadata.

---

### File/Attachment Handling

#### `saveTempFile(base64, mimeType, name)`

Saves a base64-encoded file to a temp location for CLI consumption.

#### `selectImageFile()`

Opens a native file picker dialog for image selection.

#### `readFileAsBase64(filePath)`

Reads a file and returns its base64 representation.

#### `saveTempImages(attachments)`

Batch saves multiple attachments to temp files.

---

## Chat Dashboard File Watcher

The `startChatDashboardWatcher()` function sets up a recursive `fs.watch` on the `dashboards/` directory. It:
1. Filters for changes in directories starting with `chat-agent-`
2. Debounces at 200ms
3. Broadcasts `chat_dashboard_changed` to all renderer windows

This enables the ChatDashboardView to live-update when agents write progress files.
