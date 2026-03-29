# Electron Services Reference

All services live under `electron/services/` and run in the Electron main process. They are CommonJS modules imported by `ipc-handlers.js` during app initialization.

---

## SwarmOrchestrator

**File:** `electron/services/SwarmOrchestrator.js` (764 lines)

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

**File:** `electron/services/ClaudeCodeService.js` (331 lines)

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

**File:** `electron/services/PromptBuilder.js` (334 lines)

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

**File:** `electron/services/ProjectService.js` (167 lines)

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

**File:** `electron/services/CommandsService.js` (461 lines)

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

**File:** `electron/services/TaskEditorService.js` (378 lines)

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

**File:** `electron/services/ConversationService.js` (144 lines)

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
