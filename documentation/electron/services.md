# Electron Services Reference

All services live under `electron/services/` and run in the Electron main process. They are CommonJS modules imported by `ipc-handlers.js` during app initialization.

---

## SwarmOrchestrator

**File:** `electron/services/SwarmOrchestrator.js` (780 lines)

The SwarmOrchestrator is the core dispatch engine that replaces the terminal-based master agent for orchestrating parallel agent swarms. It manages the full swarm lifecycle: reading the dependency graph, dispatching unblocked tasks, handling completions and failures, implementing circuit breaker logic, and triggering automatic replanning.

### State Management

Active swarms are tracked in an in-memory map keyed by dashboard ID:

```javascript
activeSwarms = {
  "dashboard1": {
    state: "running",           // "running" | "paused" | "replanning" | "cancelled" | "completed"
    projectPath: "/path/to/project",
    provider: "claude",         // "claude" | "codex"
    model: "claude-sonnet-4-20250514",
    cliPath: "/usr/local/bin/claude",
    dangerouslySkipPermissions: false,
    trackerRoot: "/path/to/Synapse",
    dispatchedTasks: { "1.1": true },
    completedTasks: { "1.2": true },
    failedTasks: {},
  }
}
```

### Swarm States

| State | Description |
|---|---|
| `running` | Actively dispatching tasks |
| `paused` | Dispatch halted; active workers continue |
| `replanning` | Circuit breaker triggered; waiting for replanner |
| `cancelled` | Swarm cancelled; workers killed |
| `completed` | All tasks finished or blocked by failures |

### Exported Methods

#### `init(broadcast)`

Initialize the orchestrator with a broadcast function. Also initializes ClaudeCodeService and CodexService.

| Parameter | Type | Description |
|---|---|---|
| `broadcast` | `Function` | `(channel, data) => void` -- sends events to renderer |

#### `startSwarm(dashboardId, opts)`

Start orchestrating a swarm on a dashboard.

| Parameter | Type | Description |
|---|---|---|
| `dashboardId` | `string` | Target dashboard |
| `opts.projectPath` | `string` | Project directory |
| `opts.provider` | `string` | `"claude"` or `"codex"` |
| `opts.model` | `string` | Model name (optional) |
| `opts.cliPath` | `string` | Path to CLI binary (optional) |
| `opts.dangerouslySkipPermissions` | `boolean` | Skip permission prompts (optional) |

**Returns:** `{ success: boolean, error?: string }`

**Behavior:**
1. Validates that no swarm is already active on the dashboard
2. Reads `initialization.json` and validates a task plan exists
3. Creates swarm state entry in `activeSwarms`
4. Logs "Swarm started" event
5. Calls `dispatchReady()` to dispatch all initially unblocked tasks

#### `pauseSwarm(dashboardId)`

Pause the swarm. Active workers continue, but no new tasks are dispatched.

**Returns:** `{ success: boolean, error?: string }`

#### `resumeSwarm(dashboardId)`

Resume a paused swarm. Immediately dispatches all ready tasks.

**Returns:** `{ success: boolean, error?: string }`

#### `cancelSwarm(dashboardId)`

Cancel the swarm. Kills all workers for this dashboard and removes the swarm state.

**Returns:** `{ success: boolean, error?: string }`

**Behavior:**
1. Gets all active workers from both ClaudeCodeService and CodexService
2. Kills workers that belong to this dashboard
3. Logs "Swarm cancelled" event
4. Removes swarm from `activeSwarms`

#### `retryTask(dashboardId, taskId)`

Retry a failed task by clearing its failed state, deleting its progress file, and re-dispatching.

**Returns:** `{ success: boolean, error?: string }`

#### `getSwarmStates()`

Get the current state of all active swarms.

**Returns:**
```javascript
{
  "dashboard1": {
    state: "running",
    dispatched: 3,
    completed: 5,
    failed: 0
  }
}
```

#### `isActive(dashboardId)`

Check if a dashboard has an active swarm.

**Returns:** `boolean`

#### `handleProgressUpdate(dashboardId, taskId, progressData)`

Process a progress file change. Called by the broadcast bridge whenever an `agent_progress` event fires. Routes to `onTaskComplete()` or `onTaskFailed()` based on the progress status.

### Dispatch Loop

The `dispatchReady(dashboardId)` function implements the core dispatch algorithm:

```
For each agent in initialization.json:
  1. Skip if already dispatched, completed, or failed
  2. Check all dependencies in depends_on[]
  3. If ALL dependencies are in completedTasks -> task is ready
  4. Build upstream results from completed dependency progress files
  5. Build system prompt (worker instructions + paths)
  6. Build task prompt (description + project context + upstream results)
  7. Spawn CLI worker via ClaudeCodeService or CodexService
  8. Log dispatch event
```

This runs after every task completion, ensuring continuous pipeline flow.

### Circuit Breaker

The circuit breaker triggers when failures cascade. Two conditions are checked in `onTaskFailed()`:

**Condition 1: Wave Failure Threshold**
- 3 or more tasks fail within the same wave
- Indicates a shared root cause

**Condition 2: Blast Radius Threshold**
- A single failed task blocks 3+ remaining tasks, OR
- A single failed task blocks more than 50% of remaining tasks
- Indicates a critical-path failure

When triggered:
1. State transitions to `"replanning"`
2. Log entry at `warn` level
3. Broadcasts `swarm-state` with `state: "replanning"`
4. Spawns a replanner CLI process via `startReplan()`

### Replanning

The `startReplan()` function spawns a Claude CLI process in `--print` mode with the full failure context. The replanner receives:
- Original task info
- Completed tasks with summaries and deviations
- Failed tasks with error details, logs, and stage information
- Pending/blocked tasks
- Full agents array from `initialization.json`

The replanner must return a JSON object with:
- `summary` -- Explanation of changes
- `modified` -- Updated task entries
- `added` -- New repair/replacement tasks (ID suffix `r`)
- `removed` -- Task IDs to remove
- `retry` -- Task IDs to retry as-is

`applyReplan()` applies the revision:
1. Removes tasks and cleans up dangling `depends_on` references
2. Merges modifications into existing agents
3. Adds new tasks and updates wave totals
4. Clears failed state and deletes progress files for retried tasks
5. Updates `total_tasks` in `initialization.json`
6. Writes updated `initialization.json` to disk
7. Resumes dispatch

**Fallback:** If the replanner CLI fails to spawn, exits non-zero, or returns invalid JSON, the swarm is paused for manual intervention.

### Completion Detection

`isSwarmComplete()` returns true when:
- No tasks are currently dispatched (in flight)
- Every task is either completed, failed, or blocked by a failed dependency

---

## ClaudeCodeService

**File:** `electron/services/ClaudeCodeService.js` (369 lines)

Manages Claude Code CLI worker processes. Each spawned worker is an independent `claude` CLI process running in `--print` mode with `stream-json` output.

### State

```javascript
activeWorkers = {
  12345: {                        // Keyed by PID
    provider: "claude",
    taskId: "1.1",
    dashboardId: "dashboard1",
    process: <ChildProcess>,
    pid: 12345,
    startedAt: "2026-03-22T15:00:00Z",
    output: "",                   // Accumulated stdout
    errorOutput: "",              // Accumulated stderr
    lineBuffer: "",               // Partial line buffer for NDJSON parsing
  }
}
```

### Exported Methods

#### `init(broadcast)`

Set the broadcast function for sending worker events to the renderer.

#### `spawnWorker(opts)`

Spawn a Claude Code CLI worker process.

| Parameter | Type | Description |
|---|---|---|
| `opts.taskId` | `string` | Task identifier (e.g., `"1.1"`) |
| `opts.dashboardId` | `string` | Dashboard this worker belongs to |
| `opts.projectDir` | `string` | Working directory for the CLI |
| `opts.prompt` | `string` | Task prompt (sent via stdin) |
| `opts.systemPrompt` | `string` | System prompt (via `--append-system-prompt`) |
| `opts.model` | `string` | Model name (optional) |
| `opts.cliPath` | `string` | Path to `claude` binary (default: `"claude"`) |
| `opts.dangerouslySkipPermissions` | `boolean` | Add `--dangerously-skip-permissions` flag |
| `opts.resumeSessionId` | `string` | Session ID for `--resume` (optional) |
| `opts.additionalContextDirs` | `string[]` | Additional directories to add via `--add-dir` (optional) |

**Returns:** `{ pid: number, taskId: string, dashboardId: string }`

**CLI Arguments Built:**
```
claude --print --output-format stream-json --verbose
       [--model <model>]
       [--dangerously-skip-permissions]
       [--resume <sessionId>]
       --add-dir <synapseRoot>
       [--add-dir <projectDir>]           # if different from Synapse root
       --append-system-prompt <systemPrompt>
```

**Process Lifecycle:**
1. Prompt is written to stdin, then stdin is closed
2. stdout is streamed as NDJSON lines -- each complete line is parsed and broadcast as `worker-output`
3. stderr is accumulated for error reporting
4. A 10-second safety timeout warns if no stdout is received
5. On process close, `worker-complete` is broadcast with full output and exit code
6. On process error, `worker-error` is broadcast

**Environment:** The process environment inherits from `process.env` with `ELECTRON_RUN_AS_NODE` and `CLAUDECODE` deleted to prevent interference.

#### `killWorker(pid)`

Kill a worker by PID. Sends `SIGTERM` initially, then `SIGKILL` after 5 seconds.

**Returns:** `boolean`

#### `killAllWorkers()`

Kill all active workers.

**Returns:** `number` -- count of workers killed

#### `getActiveWorkers()`

List active workers with metadata.

**Returns:** `{ pid, provider, taskId, dashboardId, startedAt }[]`

#### `writeToWorker(pid, data)`

Write data to a worker's stdin. Used for sending follow-up input to a running worker process.

| Parameter | Type | Description |
|---|---|---|
| `pid` | `number` | Worker process ID |
| `data` | `string` | Data to write to stdin |

**Returns:** `boolean`

#### `getActiveCountForDashboard(dashboardId)`

Count active workers for a specific dashboard.

**Returns:** `number`

---

## CodexService

**File:** `electron/services/CodexService.js` (225 lines)

Manages Codex CLI worker processes. Similar to ClaudeCodeService but uses Codex-specific CLI arguments and output handling.

### Key Differences from ClaudeCodeService

| Aspect | ClaudeCodeService | CodexService |
|---|---|---|
| Default binary | `claude` | `codex` |
| CLI args | `--print --output-format stream-json --verbose` | `exec --json` |
| Permission flag | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` |
| Default mode | -- | `--full-auto` (when not skipping permissions) |
| Project dir | `--add-dir <dir>` | `-C <dir>` |
| Resume | `--resume <id>` | `exec resume --json <id>` |
| Extra flags | -- | `--skip-git-repo-check` |
| System prompt | `--append-system-prompt` | Prepended to prompt text |
| Output file | -- | `-o <tempFile>` for last message capture |

### Exported Methods

Same interface as ClaudeCodeService: `init()`, `spawnWorker()`, `killWorker()`, `killAllWorkers()`, `getActiveWorkers()`.

### Internal Helpers

#### `buildArgs(opts)`

Constructs Codex CLI arguments:
```
codex exec --json [--model <model>] [--full-auto | --dangerously-bypass-approvals-and-sandbox]
           [-C <projectDir>] --skip-git-repo-check -o <outputLastMessagePath>
```

For resume sessions:
```
codex exec resume --json [--model <model>] [...] <sessionId>
```

#### `buildPromptText(opts)`

Combines system prompt and task prompt for Codex (which does not support a separate system prompt flag):
```
Follow these operating instructions exactly:
<systemPrompt>

User request:
<prompt>
```

#### `cleanErrorOutput(errorOutput)`

Strips noise from stderr (empty lines, `"Reading prompt from stdin..."` messages).

---

## PromptBuilder

**File:** `electron/services/PromptBuilder.js` (407 lines)

Constructs the prompts that worker agents receive. Handles system prompts (worker instructions), task prompts (description + context), and replan prompts (failure analysis context).

### Exported Methods

#### `buildSystemPrompt(opts)`

Builds the system prompt appended via `--append-system-prompt`. Contains the worker progress reporting instructions and concrete dispatch context.

| Parameter | Type | Description |
|---|---|---|
| `opts.taskId` | `string` | Task identifier |
| `opts.dashboardId` | `string` | Dashboard identifier |
| `opts.trackerRoot` | `string` | Path to Synapse root |

**Output structure:**
```
<Contents of agent/instructions/tracker_worker_instructions.md>

---

## Your Dispatch Context

- **tracker_root:** `/path/to/Synapse`
- **dashboardId:** `dashboard1`
- **task_id:** `1.1`
- **progress_file:** `/path/to/Synapse/dashboards/dashboard1/progress/1.1.json`
```

Falls back to a minimal progress path note if the instructions file is missing.

#### `buildTaskPrompt(opts)`

Builds the main task prompt passed to the CLI via stdin.

| Parameter | Type | Description |
|---|---|---|
| `opts.task` | `object` | Agent entry from `initialization.json` |
| `opts.taskDescription` | `string` | Additional description/context |
| `opts.projectContexts` | `{ path, content }[]` | CLAUDE.md file contents (truncated to 8000 chars each) |
| `opts.upstreamResults` | `{ taskId, summary, files?, deviations? }[]` | Completed dependency results |

**Output structure:**
```markdown
# Task 1.1: Create User Model

**Working directory:** `/path/to/project`

## Task Description
<taskDescription>

## Project Context
### project/CLAUDE.md
```
<CLAUDE.md content, truncated at 8000 chars>
```

## Upstream Task Results
The following tasks have completed before yours. Use their results as context:

### Task 1.0
**Summary:** Created database schema
**Files changed:** src/models/schema.ts
**Deviations:**
- [MODERATE] Used different column naming convention
```

#### `readUpstreamResults(dashboardId, dependsOn, trackerRoot)`

Reads progress files for completed upstream dependencies.

| Parameter | Type | Description |
|---|---|---|
| `dashboardId` | `string` | Dashboard identifier |
| `dependsOn` | `string[]` | Task IDs this task depends on |
| `trackerRoot` | `string` | Path to Synapse root |

**Returns:** `{ taskId, summary, deviations }[]`

For each dependency, reads `{trackerRoot}/dashboards/{dashboardId}/progress/{taskId}.json` and extracts `task_id`, `summary`, and `deviations`. Returns a fallback entry if the file is missing.

#### `buildReplanPrompt(opts)`

Builds the full context prompt for the circuit breaker's replanner CLI process.

| Parameter | Type | Description |
|---|---|---|
| `opts.dashboardId` | `string` | Dashboard identifier |
| `opts.init` | `object` | Current `initialization.json` contents |
| `opts.progress` | `object` | All progress files keyed by task ID |
| `opts.failedTasks` | `object` | `{ taskId: true }` map of failures |
| `opts.completedTasks` | `object` | `{ taskId: true }` map of completions |
| `opts.failedInWave` | `number` | Wave that triggered the circuit breaker |

**Output sections:**
1. Circuit Breaker Triggered header
2. Original Task info (name, prompt, project)
3. Completed Tasks (summaries + deviations)
4. Failed Tasks (description, dependencies, error summary, stage, last 10 logs, deviations)
5. Pending Tasks (title + dependencies)
6. Full Current Plan (agents JSON array)
7. Output format instructions (JSON schema)

#### `buildReplanSystemPrompt()`

Returns a short system prompt identifying the agent as a swarm replanner that must output only valid JSON.

---

## ProjectService

**File:** `electron/services/ProjectService.js` (193 lines)

Handles project detection, metadata extraction, and CLI binary discovery.

### Language Detection

Uses a priority-ordered list of marker files:

| File | Detected Language |
|---|---|
| `package.json` | JavaScript |
| `tsconfig.json` | TypeScript |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `requirements.txt` | Python |
| `pyproject.toml` | Python |
| `Gemfile` | Ruby |
| `pom.xml` | Java |
| `build.gradle` | Java |

### Exported Methods

#### `loadProject(dirPath)`

Load project metadata from a directory.

**Returns:**
```javascript
{
  path: "/path/to/project",
  name: "my-app",               // from package.json or directory name
  language: "typescript",        // detected language
  hasClaudeMd: true,
  claudeMdPaths: [
    "/path/to/project/CLAUDE.md",
    "/path/to/project/packages/core/CLAUDE.md"
  ]
}
```

CLAUDE.md discovery searches the root directory and one level deep (excluding `.` prefixed dirs and `node_modules`).

#### `getProjectContext(dirPath)`

Read all CLAUDE.md file contents.

**Returns:** `{ path: string, content: string }[]`

#### `scanDirectory(dirPath, maxDepth)`

Recursively scan a directory tree for display purposes. Default depth is 2. Skips `.` prefixed entries, `node_modules`, and `dist`.

**Returns:** `{ name, type: "dir" | "file", children? }[]`

Directories are sorted before files, both alphabetically.

#### `detectClaudeCLI()`

Find the Claude CLI binary. Checks `which claude` first, then common paths:
- `/usr/local/bin/claude`
- `~/.claude/bin/claude`
- `~/.local/bin/claude`

**Returns:** `string | null`

#### `detectCodexCLI()`

Find the Codex CLI binary. Checks `which codex` first, then:
- `/opt/homebrew/bin/codex`
- `/usr/local/bin/codex`
- `~/.local/bin/codex`

**Returns:** `string | null`

#### `detectAgentCLI(provider)`

Dispatch to `detectClaudeCLI()` or `detectCodexCLI()` based on provider.

---

## CommandsService

**File:** `electron/services/CommandsService.js` (651 lines)

Manages the `_commands/` directory hierarchy -- listing, reading, creating, updating, deleting, and AI-generating command markdown files.

### Constants

- `SYNAPSE_ROOT` -- Resolved path to Synapse repository root
- `COMMANDS_DIR` -- `{SYNAPSE_ROOT}/_commands`

### Command File Structure

Command files are parsed for:
- **name** -- Filename without `.md` extension
- **title** -- First H1 heading in the file
- **purpose** -- Content after `**Purpose:**` marker
- **syntax** -- Content after `**Syntax:**` marker
- **content** -- Full raw markdown
- **lastModified** -- File modification timestamp

### Exported Methods

#### `listCommands(commandsDir?)`

List all commands grouped by subfolder. Returns `{ folder, commands[] }[]`.

Root-level `.md` files are grouped under `"General"`. Each subdirectory becomes its own group. Recursively discovers commands in nested directories (skipping `_` and `.` prefixed dirs).

#### `getCommand(name, commandsDir?)`

Get full parsed command by name. Searches direct path first, then recursively.

**Returns:** Full parsed command object or `null`.

#### `saveCommand(name, content, commandsDir?)`

Create or update a command. Finds existing file first (recursive search), updates in place. Otherwise creates at root of directory.

**Returns:** `{ success, name, filePath }`

#### `deleteCommand(name, commandsDir?)`

Delete a command file by name.

**Returns:** `{ success: boolean, error?: string }`

#### `createCommandFolder(folderName)`

Create a new subfolder under `_commands/`.

**Returns:** `{ success, name, path }` or `{ success: false, error }` if already exists.

#### `saveCommandInFolder(name, content, folderName)`

Save a command to a specific subfolder. Creates the folder if needed.

**Returns:** `{ success, name, filePath }`

#### `generateCommand(description, folderName, commandName, opts)`

AI-generate a command file using Claude CLI.

| Parameter | Type | Description |
|---|---|---|
| `description` | `string` | User's description of the command |
| `folderName` | `string` | Target folder |
| `commandName` | `string` | Desired command name |
| `opts.cliPath` | `string` | Claude binary path (optional) |
| `opts.model` | `string` | Model to use (optional) |

**Returns:** `Promise<{ success, name?, filePath?, content?, error? }>`

**Process:**
1. Reads `CLAUDE.md` for context (first 8000 chars)
2. Reads up to 3 example commands from the target folder
3. Builds a system prompt with structure rules and examples
4. Spawns `claude --print --max-turns 1` with the prompt
5. Parses streamed JSON output to extract text content
6. Strips code fences if present
7. Saves to `_commands/{folderName}/{commandName}.md`

#### `loadProjectClaudeMd(projectDir)`

Load a project's `CLAUDE.md` if it exists.

**Returns:** `{ content, filePath, lastModified }` or `null`

#### `listProjectCommands(projectDir)`

List commands from a project's `_commands/` directory.

**Returns:** Same format as `listCommands()`.

---

## TaskEditorService

**File:** `electron/services/TaskEditorService.js` (377 lines)

Provides CRUD operations on `initialization.json` for building and editing swarm plans through the UI task editor.

### Exported Methods

#### `createSwarm(dashboardId, opts)`

Create a new swarm on a dashboard.

| Parameter | Type | Description |
|---|---|---|
| `dashboardId` | `string` | Target dashboard |
| `opts.name` | `string` | Swarm name |
| `opts.type` | `string` | `"Waves"` or `"Chains"` (default `"Waves"`) |
| `opts.directory` | `string` | Project directory (optional) |
| `opts.project` | `string` | Project name (optional) |
| `opts.prompt` | `string` | Original prompt (optional) |

**Returns:** The new initialization data object.

**Side effects:**
- Writes `initialization.json` with task metadata, empty agents/waves
- Resets `logs.json` with a "Swarm created" entry
- Clears all progress files

#### `addTask(dashboardId, task)`

Add a task to the swarm plan.

| Parameter | Type | Description |
|---|---|---|
| `task.id` | `string` | Task ID (e.g., `"1.1"`) |
| `task.title` | `string` | Task title |
| `task.wave` | `number` | Wave number |
| `task.layer` | `string` | Layer label (optional) |
| `task.directory` | `string` | Working directory (optional) |
| `task.depends_on` | `string[]` | Dependency task IDs (optional) |
| `task.description` | `string` | Task description for worker prompt (optional) |

**Returns:** Updated initialization data.

Auto-creates the wave if it does not exist and recalculates `total_tasks` and `total_waves`.

#### `updateTask(dashboardId, taskId, updates)`

Update fields on an existing task. Merges `updates` into the agent entry.

**Returns:** Updated initialization data, or `null` if task not found.

Recalculates wave totals after update.

#### `removeTask(dashboardId, taskId)`

Remove a task. Also cleans up any `depends_on` references pointing to the removed task and deletes the progress file.

**Returns:** Updated initialization data, or `null` if not found.

#### `addWave(dashboardId, wave)`

Add a new wave with the next available ID.

| Parameter | Type | Description |
|---|---|---|
| `wave.name` | `string` | Wave name (optional, defaults to `"Wave N"`) |

**Returns:** Updated initialization data.

#### `removeWave(dashboardId, waveId)`

Remove a wave and all tasks belonging to it. Cleans up dependency references.

**Returns:** Updated initialization data.

#### `nextTaskId(dashboardId, waveNum)`

Generate the next available task ID for a given wave number.

**Returns:** `string` (e.g., `"2.3"`)

Scans existing tasks in the wave and returns `{waveNum}.{maxSubId + 1}`.

#### `validateDependencies(dashboardId)`

Validate the dependency graph for cycles and missing references.

**Returns:** `{ valid: boolean, errors: string[] }`

Uses Kahn's algorithm (BFS topological sort) to detect cycles. Also checks that every `depends_on` reference points to an existing task.

---

## ConversationService

**File:** `electron/services/ConversationService.js` (143 lines)

Manages chat conversation persistence. Conversations are stored as individual JSON files in `{ROOT}/conversations/`.

### Conversation Schema

```javascript
{
  id: "conv_1711123456789",
  name: "Session 1",
  created: "2026-03-22T15:00:00Z",
  updated: "2026-03-22T16:30:00Z",
  dashboardId: "dashboard1",    // optional
  messages: [
    { role: "user", content: "..." },
    { role: "assistant", content: "..." }
  ]
}
```

### Exported Methods

#### `listConversations(dashboardId?)`

List all conversations, optionally filtered by dashboard ID.

**Returns:** `{ id, name, created, updated, dashboardId, messageCount }[]`

Sorted newest-first by `updated` timestamp.

#### `loadConversation(id)`

Load a full conversation by ID.

**Returns:** Full conversation object or `null`.

#### `saveConversation(data)`

Save a conversation to disk. Automatically sets the `updated` timestamp.

**Returns:** Saved conversation object or `null`.

#### `createConversation(name?)`

Create a new empty conversation. Defaults name to `"Session {count+1}"`.

**Returns:** New conversation object.

ID format: `conv_{Date.now()}`

#### `deleteConversation(id)`

Delete a conversation file.

**Returns:** `{ success: true }` or `{ error: string }`

#### `renameConversation(id, name)`

Rename an existing conversation.

**Returns:** Updated conversation object or `{ error: string }`.

---

## TerminalService

**File:** `electron/services/TerminalService.js` (187 lines)

Manages PTY (pseudo-terminal) sessions using `node-pty`. Each terminal is an independent shell process with full TTY emulation, enabling the embedded terminal tabs in the Synapse UI.

### State

```javascript
activeTerminals = {
  "term_1711123456789": {       // Keyed by generated ID
    id: "term_1711123456789",
    process: <IPty>,
    pid: 54321,
    cols: 80,
    rows: 24,
    cwd: "/path/to/project",
    shell: "/bin/zsh",
    startedAt: "2026-03-22T15:00:00Z",
  }
}
```

### Exported Methods

#### `init(broadcast)`

Set the broadcast function for sending terminal events to the renderer.

#### `spawnTerminal(opts)`

Spawn a new PTY terminal session.

| Parameter | Type | Description |
|---|---|---|
| `opts.cwd` | `string` | Working directory (default: `process.cwd()`) |
| `opts.cols` | `number` | Terminal columns (default: `80`) |
| `opts.rows` | `number` | Terminal rows (default: `24`) |
| `opts.shell` | `string` | Shell binary (default: `$SHELL` or `/bin/zsh`) |
| `opts.dashboardId` | `string` | Dashboard binding for hook isolation (optional) |

**Returns:** `{ id, pid, shell, cwd, cols, rows }`

**Behavior:**
1. Generates a unique ID (`term_{Date.now()}`)
2. Inherits `process.env` with `ELECTRON_RUN_AS_NODE` removed
3. If `dashboardId` is provided, sets `SYNAPSE_DASHBOARD_ID` in the child environment for PreToolUse hook isolation
4. Spawns a PTY process with `xterm-256color` terminal type
5. Streams output to the renderer via `terminal-output` push events
6. On exit, broadcasts `terminal-exit` and removes from `activeTerminals`

#### `writeTerminal(id, data)`

Write user input data to a terminal's PTY process.

| Parameter | Type | Description |
|---|---|---|
| `id` | `string` | Terminal session ID |
| `data` | `string` | Input data from xterm.js `onData` |

**Returns:** `boolean`

#### `resizeTerminal(id, cols, rows)`

Resize a terminal session. Updates the PTY dimensions and stored state.

| Parameter | Type | Description |
|---|---|---|
| `id` | `string` | Terminal session ID |
| `cols` | `number` | New column count |
| `rows` | `number` | New row count |

**Returns:** `boolean`

#### `killTerminal(id)`

Kill a specific terminal session by ID.

**Returns:** `boolean`

#### `killAllTerminals()`

Kill all active terminal sessions.

**Returns:** `number` -- count of terminals killed

#### `getActiveTerminals()`

List active terminal sessions with metadata.

**Returns:** `{ id, pid, shell, cwd, cols, rows, startedAt }[]`

---

## DebugService

**File:** `electron/services/DebugService.js` (796 lines)

Provides a full Node.js debugging experience via the Chrome DevTools Protocol (CDP). Manages a single debug session at a time: spawns a Node.js process with `--inspect-brk=0`, connects to the CDP WebSocket, and exposes debugger operations (breakpoints, stepping, evaluation, variable inspection) to the renderer.

### State

Only one debug session can be active at a time:

```javascript
activeSession = {
  process: <ChildProcess>,         // Node.js debuggee process
  ws: <WebSocket>,                 // CDP WebSocket connection
  scriptPath: "/path/to/script.js",
  cwd: "/path/to/dir",
  breakpoints: {                   // { breakpointId: { file, line } }
    "1:10:0:...": { file: "/path/to/file.js", line: 10 }
  },
  scriptSources: {                 // { scriptId: url } from Debugger.scriptParsed
    "42": "file:///path/to/module.js"
  },
  nextId: 0,                       // Auto-incrementing CDP command ID
}
```

### CDP Event Handling

The service listens for these CDP events and broadcasts them to the renderer:

| CDP Event | Push Channel | Description |
|---|---|---|
| `Debugger.paused` | `debug-paused` | Hit breakpoint or pause; includes call stack, scopes, paused file/line |
| `Debugger.resumed` | `debug-resumed` | Execution resumed |
| `Debugger.scriptParsed` | -- | Caches `scriptId` to URL mapping (internal) |
| `Runtime.consoleAPICalled` | `debug-output` | Console output from the debuggee |
| `Runtime.exceptionThrown` | `debug-output` | Uncaught exception in the debuggee |

### Exported Methods

#### `init(broadcast)`

Set the broadcast function for sending debug events to the renderer.

#### `launch(opts)`

Launch a Node.js script with `--inspect-brk=0` and connect to the CDP WebSocket.

| Parameter | Type | Description |
|---|---|---|
| `opts.scriptPath` | `string` | Absolute path to the `.js` file to debug |
| `opts.cwd` | `string` | Working directory (default: script's directory) |
| `opts.args` | `string[]` | Additional arguments for the script (optional) |
| `opts.env` | `object` | Additional environment variables (optional) |

**Returns:** `Promise<{ success: true, pid: number } | { success: false, error: string }>`

**Behavior:**
1. Rejects if a session is already active
2. Spawns the script with `--inspect-brk=0` (random port, break on first statement)
3. Parses stderr for the `ws://` debugger URL
4. Connects via WebSocket within a 5-second timeout
5. Enables `Debugger` and `Runtime` CDP domains
6. Calls `Runtime.runIfWaitingForDebugger` to start execution (pauses on first line)
7. On process exit, broadcasts `debug-stopped` and cleans up

#### `stop()`

Stop the active debug session. Closes the WebSocket and kills the debuggee process (SIGTERM, then SIGKILL after 2 seconds).

**Returns:** `{ success: boolean, error?: string }`

#### `setBreakpoint(filePath, lineNumber, condition?)`

Set a breakpoint by file path and line number.

| Parameter | Type | Description |
|---|---|---|
| `filePath` | `string` | Absolute file path |
| `lineNumber` | `number` | 1-based line number |
| `condition` | `string` | Optional conditional expression |

**Returns:** `Promise<{ success: boolean, breakpointId?: string, actualLine?: number, error?: string }>`

Resolves symlinks before setting the breakpoint (e.g., `/tmp` to `/private/tmp` on macOS) so paths match V8's internal URLs.

#### `removeBreakpoint(breakpointId)`

Remove a breakpoint by its CDP breakpoint ID.

**Returns:** `Promise<{ success: boolean, error?: string }>`

#### `resume()`

Resume script execution (continue).

**Returns:** `Promise<{ success: boolean, error?: string }>`

#### `pause()`

Pause script execution.

**Returns:** `Promise<{ success: boolean, error?: string }>`

#### `stepOver()`

Step over the current statement.

**Returns:** `Promise<{ success: boolean, error?: string }>`

#### `stepInto()`

Step into the next function call.

**Returns:** `Promise<{ success: boolean, error?: string }>`

#### `stepOut()`

Step out of the current function.

**Returns:** `Promise<{ success: boolean, error?: string }>`

#### `evaluate(expression, callFrameId?)`

Evaluate a JavaScript expression. If `callFrameId` is provided, evaluates on that call frame (when paused); otherwise evaluates in the global runtime context.

| Parameter | Type | Description |
|---|---|---|
| `expression` | `string` | JavaScript expression to evaluate |
| `callFrameId` | `string` | Specific call frame ID (optional) |

**Returns:** `Promise<{ success: boolean, result?: { type, subtype, value, description, objectId, preview }, exceptionDetails?, error?: string }>`

#### `getVariables(objectId)`

Get properties for a scope or object. Used for drilling into the variables panel.

| Parameter | Type | Description |
|---|---|---|
| `objectId` | `string` | CDP `Runtime.RemoteObject` objectId |

**Returns:** `Promise<{ success: boolean, variables?: { name, value, type, subtype, variablesReference, preview }[], error?: string }>`

#### `getScopes(callFrameId?)`

Returns a hint that scopes are provided with the `debug-paused` push event. Use `getVariables()` with a scope's `objectId` to drill into specific scopes.

**Returns:** `Promise<{ success: boolean, message: string }>`

#### `getSessionInfo()`

Check if a debug session is currently active.

**Returns:** `{ active: boolean, scriptPath?: string, pid?: number, breakpoints?: { breakpointId, file, line }[] }`

---

## InstrumentService

**File:** `electron/services/InstrumentService.js`

Scans project files (JSX, TSX, HTML) and adds `data-synapse-label` attributes to text-bearing elements for Live Preview integration. This is the backend for the `!instrument` command.

### Exported Methods

#### `instrumentProject(projectDir, opts)`

Scan a project directory and add `data-synapse-label` attributes to text elements.

| Parameter | Type | Description |
|---|---|---|
| `projectDir` | `string` | Root directory of the target project |
| `opts` | `object` | Options (e.g., file filters, dry run) |

**Returns:** `{ success: boolean, filesModified: number, labelsAdded: number }`

**Behavior:**
1. Scans for JSX/TSX/HTML files in the project
2. Identifies text-bearing elements (headings, paragraphs, buttons, links, spans with text content)
3. Adds `data-synapse-label` attributes with unique identifiers
4. Writes modified files back to disk

---

## PreviewService

**File:** `electron/services/PreviewService.js`

Maps `data-synapse-label` attribute values back to source file locations. When a user double-clicks a labeled element in the Live Preview, this service identifies the corresponding source file and position.

### Exported Methods

#### `resolveLabel(projectDir, label)`

Find the source file and position for a given label.

| Parameter | Type | Description |
|---|---|---|
| `projectDir` | `string` | Root directory of the target project |
| `label` | `string` | The `data-synapse-label` value to resolve |

**Returns:** `{ filePath: string, line: number, column: number }` or `null`

---

## PreviewTextWriter

**File:** `electron/services/PreviewTextWriter.js`

Writes text edits from the Live Preview overlay back to the corresponding source files. When a user edits text inline in the Preview tab, this service updates the source code at the mapped location.

### Exported Methods

#### `writeTextUpdate(projectDir, label, newText)`

Update the text content at the source location identified by a label.

| Parameter | Type | Description |
|---|---|---|
| `projectDir` | `string` | Root directory of the target project |
| `label` | `string` | The `data-synapse-label` identifying the element |
| `newText` | `string` | The new text content to write |

**Returns:** `{ success: boolean, filePath?: string, error?: string }`

---

## AutoUpdateService

**File:** `electron/services/AutoUpdateService.js` (166 lines)

Implements an auto-update state machine using `electron-updater`. Checks for updates on startup (after a 10-second delay), downloads them automatically, and prompts the user to restart to install. In development (non-packaged) builds, update checks are disabled with an informational message.

### Configuration

```javascript
autoUpdater.autoDownload = true;          // Download updates automatically
autoUpdater.autoInstallOnAppQuit = true;  // Install on app quit
```

### State

The service maintains a reactive state object that is broadcast to the renderer on every change:

```javascript
{
  currentVersion: "1.2.3",        // From app.getVersion()
  checking: false,                // Currently checking for updates
  available: false,               // An update is available
  downloaded: false,              // Update has been downloaded and is ready to install
  updateInfo: null,               // electron-updater UpdateInfo object
  progress: null,                 // Download progress ({ percent, bytesPerSecond, ... })
  error: null,                    // Error message string, if any
  lastCheckedAt: null,            // ISO timestamp of last check
  message: "...",                 // Human-readable status message
}
```

### Update Lifecycle

The state machine progresses through these stages:

| Event | State Changes | Message |
|---|---|---|
| `checking-for-update` | `checking: true`, `error: null` | "Checking for updates..." |
| `update-available` | `checking: false`, `available: true` | "Downloading {version}..." |
| `download-progress` | `progress: { percent, ... }` | "Downloading update: {N}%" |
| `update-downloaded` | `downloaded: true`, `progress: { percent: 100 }` | "Update downloaded. Restart Synapse to install it." |
| `update-not-available` | `checking: false`, `available: false` | "You are on the latest version." |
| `error` | `checking: false`, `error: message` | Error description |

### Exported Methods

#### `initAutoUpdater(broadcast)`

Initialize the auto-update system. In packaged builds, registers all `electron-updater` event handlers and schedules an initial update check after 10 seconds. In development builds, emits a status message but does not check for updates.

| Parameter | Type | Description |
|---|---|---|
| `broadcast` | `Function` | `(channel, data) => void` -- sends `update-status` events to renderer |

Only initializes once (idempotent). Subsequent calls are no-ops.

#### `checkForUpdates()`

Manually trigger an update check. In development builds, returns immediately with an informational message.

**Returns:** `Promise<{ currentVersion, checking, available, downloaded, updateInfo, progress, error, lastCheckedAt, message }>`

#### `quitAndInstallUpdate()`

Quit the application and install the downloaded update. Requires that an update has already been downloaded (`state.downloaded === true`).

**Returns:** `{ success: boolean, error?: string }`

Uses `setImmediate` to defer the quit/install call, allowing the IPC response to reach the renderer before the app restarts. Calls `autoUpdater.quitAndInstall(false, true)` -- does not force-close windows silently, but does restart after install.

#### `getUpdateState()`

Get the current snapshot of the update state.

**Returns:** `{ currentVersion, checking, available, downloaded, updateInfo, progress, error, lastCheckedAt, message }`

#### `disposeAutoUpdater()`

Clean up resources. Clears the startup check timer if it has not yet fired. Called during app shutdown.
