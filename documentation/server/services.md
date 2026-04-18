# Server Services Reference

All services are located in `src/server/services/`. Each service module exports pure functions (no class instances) and handles one area of responsibility.

---

## DashboardService

**File:** `src/server/services/DashboardService.js`

Manages dashboard directories, file I/O for dashboard data, and CRUD operations on dashboards.

### Functions

#### `getDashboardDir(id)`

Returns the absolute path to a dashboard directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier (e.g., `"dashboard1"`) |

**Returns:** `string` -- Absolute path to `dashboards/{id}/`

```javascript
getDashboardDir('dashboard1')
// => '/path/to/Synapse/dashboards/dashboard1'
```

---

#### `ensureDashboard(id)`

Ensures a dashboard directory exists with all required subdirectories and default JSON files. Creates the directory, `progress/` subdirectory, `initialization.json`, and `logs.json` if any are missing.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `void`

**Side effects:**
- Creates `dashboards/{id}/` directory if missing
- Creates `dashboards/{id}/progress/` directory if missing
- Creates `dashboards/{id}/initialization.json` with default content if missing
- Creates `dashboards/{id}/logs.json` with default content if missing

Default `initialization.json`:
```json
{ "task": null, "agents": [], "waves": [], "chains": [], "history": [] }
```

Default `logs.json`:
```json
{ "entries": [] }
```

---

#### `readDashboardInit(id)`

Reads and parses a dashboard's `initialization.json` synchronously.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Object | null` -- Parsed JSON object, or `null` if the file doesn't exist or is malformed.

---

#### `readDashboardInitAsync(id)`

Async version of `readDashboardInit`. Reads and parses a dashboard's `initialization.json` using `fs.promises`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Promise<Object | null>` -- Parsed JSON object, or `null` if the file doesn't exist or is malformed.

---

#### `readDashboardLogs(id)`

Reads and parses a dashboard's `logs.json` synchronously.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Object | null` -- Parsed JSON object, or `null` if the file doesn't exist or is malformed.

---

#### `readDashboardLogsAsync(id)`

Async version of `readDashboardLogs`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Promise<Object | null>`

---

#### `readDashboardProgress(id)`

Reads all progress files from a dashboard's `progress/` directory synchronously. Returns an object keyed by `task_id`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Object` -- Map of `task_id` to progress data. Empty object `{}` if the directory is missing or empty.

```javascript
readDashboardProgress('dashboard1')
// => { "1.1": { task_id: "1.1", status: "completed", ... }, "1.2": { ... } }
```

---

#### `readDashboardProgressAsync(id)`

Async version of `readDashboardProgress`. Reads all progress files in parallel using `Promise.all`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Promise<Object>` -- Map of `task_id` to progress data.

---

#### `clearDashboardProgress(id)`

Deletes all `.json` files from a dashboard's `progress/` directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `void`

---

#### `listDashboards()`

Lists all valid dashboard IDs. A dashboard is valid if it is a directory containing an `initialization.json` file. Returns a sorted array with numeric ordering (e.g., `dashboard1` before `dashboard2`).

**Returns:** `string[]` -- Sorted array of dashboard ID strings.

```javascript
listDashboards()
// => ['dashboard1', 'dashboard2', 'dashboard3']
```

---

#### `copyDirSync(src, dest)`

Recursively copies a directory from `src` to `dest` synchronously. Creates the destination directory if it doesn't exist.

| Parameter | Type | Description |
|-----------|------|-------------|
| `src` | `string` | Source directory path |
| `dest` | `string` | Destination directory path |

**Returns:** `void`

---

#### `deleteDashboard(id)`

Deletes a dashboard directory entirely (removes directory, all files including init, logs, and progress).

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `boolean` -- `true` if deleted, `false` if the dashboard didn't exist.

---

#### `nextDashboardId()`

Generates a new unique dashboard ID as a 6-character hex string using `crypto.randomBytes(3)`. Loops until the generated ID is not already in use by an existing dashboard.

**Returns:** `string` -- A 6-character hex string (e.g., `"a1b2c3"`, `"71894a"`).

```javascript
nextDashboardId()
// => '71894a'
```

---

#### `getDashboardCreationTime(id)`

Gets the creation time (birthtime) of a dashboard directory. Used for initial ordering of dashboards not yet in the persisted order array.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `number` -- Epoch milliseconds (`stat.birthtimeMs` or `stat.ctimeMs`), or `Infinity` if the directory is unreadable.

---

#### `getFullDashboardState(id)`

Returns the complete state of a dashboard: initialization, progress, and logs. A convenience wrapper that consolidates the individual read functions into a single call.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Object` with the following shape:

```javascript
{
  initialization: Object | null,  // readDashboardInit(id)
  progress: Object,               // readDashboardProgress(id)
  logs: Object | null              // readDashboardLogs(id)
}
```

---

## WatcherService

**File:** `src/server/services/WatcherService.js`

Manages file system watchers that detect changes in dashboard files and broadcast SSE events to connected clients. Implements a hybrid watching strategy: `fs.watch` for progress directories (event-driven, low latency) and `fs.watchFile` for `initialization.json` and `logs.json` (polling-based, more reliable).

### Internal State

- `dashboardWatchers` -- `Map<string, { initFile, logsFile, progressWatcher }>` tracking active watchers per dashboard
- `lastKnownProgress` -- `Map<string, Map<string, number>>` tracking last-known mtime per progress file for reconciliation

### Write Rejection Validation

Before broadcasting any progress file update, the WatcherService runs `validateAndBroadcast()` which performs two hard-rejection checks:

1. **`task_id` mismatch** -- The `task_id` field inside the progress file must match the filename (e.g., file `1.2.json` must contain `task_id: "1.2"`). Prevents workers from accidentally writing to the wrong progress file.

2. **`dashboard_id` mismatch** -- If the progress file contains a `dashboard_id` field, it must match the dashboard directory the file lives in. Prevents cross-dashboard writes.

On rejection, instead of broadcasting `agent_progress`, the server broadcasts a `write_rejected` event:

```json
{
  "dashboardId": "a3f7k2",
  "filename": "1.2.json",
  "task_id": "1.1",
  "reason": "task_id_mismatch",
  "details": "File contains task_id \"1.1\" but filename is \"1.2.json\" (expected task_id \"1.2\")",
  "expected_task_id": "1.2",
  "timestamp": "2026-03-20T14:05:00.000Z"
}
```

**Rejection reasons:**

| Reason | Description |
|--------|-------------|
| `task_id_mismatch` | Progress file `task_id` does not match the filename |
| `dashboard_id_mismatch` | Progress file `dashboard_id` does not match the dashboard directory |

Files missing a `dashboard_id` field are accepted with a console warning (backward compatibility with older format files).

### Functions

#### `watchDashboard(id, broadcastFn)`

Starts watching a single dashboard's files for changes. Sets up three watchers:

1. **`initialization.json`** -- `fs.watchFile` polling at `INIT_POLL_MS` intervals. On change, reads and validates the file, then broadcasts an `initialization` SSE event.
2. **`logs.json`** -- `fs.watchFile` polling at `INIT_POLL_MS` intervals. On change, reads and validates the file, then broadcasts a `logs` SSE event.
3. **`progress/` directory** -- `fs.watch` for file change events. On change, reads the modified progress file (with retry for mid-write scenarios), validates it, and broadcasts an `agent_progress` SSE event. If the progress file shows `status: "completed"`, triggers a dependency check after `DEPENDENCY_CHECK_DELAY_MS` and broadcasts a `tasks_unblocked` event if any tasks become dispatchable.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |
| `broadcastFn` | `function` | `(eventName, data) => void` -- SSE broadcast function |

**Returns:** `void`

**Behavior:**
- No-op if already watching the given dashboard
- Calls `ensureDashboard(id)` to guarantee files exist before watching
- Progress file reads use `readJSONWithRetry()` to handle mid-write race conditions
- Schema validation via `isValidInitialization()`, `isValidProgress()`, `isValidLogs()`
- Invalid data is logged to stderr but does not crash the server

---

#### `unwatchDashboard(id)`

Stops watching a single dashboard. Cleans up all watchers (unwatchFile for init and logs, close for progress watcher).

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `void`

---

#### `startDashboardsWatcher(broadcastFn)`

Starts watching the `dashboards/` directory for new or removed dashboard subdirectories. Uses `fs.watch` with debouncing (`RECONCILE_DEBOUNCE_MS`). When a change is detected, calls `reconcileDashboards()` which:

1. Compares currently tracked watchers against actual directories
2. Starts watchers for newly created dashboards
3. Stops watchers for removed dashboards
4. Broadcasts a `dashboards_changed` SSE event with the updated list

| Parameter | Type | Description |
|-----------|------|-------------|
| `broadcastFn` | `function` | `(eventName, data) => void` -- SSE broadcast function |

**Returns:** `void`

---

#### `startQueueWatcher(broadcastFn)`

Starts watching the `queue/` directory recursively for new or removed queue items. Uses `fs.watch` with debouncing. On change, reads all queue summaries and broadcasts a `queue_changed` SSE event.

| Parameter | Type | Description |
|-----------|------|-------------|
| `broadcastFn` | `function` | `(eventName, data) => void` -- SSE broadcast function |

**Returns:** `void`

---

#### `startReconciliation(broadcastFn)`

Starts a periodic timer (`RECONCILE_INTERVAL_MS`, default 5000ms) that scans all watched dashboards' progress directories for files that may have been missed by `fs.watch`. This is a safety net -- `fs.watch` is not guaranteed to fire for every filesystem event (especially on network mounts, Docker volumes, or under heavy I/O).

| Parameter | Type | Description |
|-----------|------|-------------|
| `broadcastFn` | `function` | `(eventName, data) => void` -- SSE broadcast function |

**Returns:** `void`

**How it works:**

The internal `reconcileProgressFiles(id, broadcastFn)` function runs for each watched dashboard on every interval tick:

1. Reads all `.json` files from the dashboard's `progress/` directory
2. For each file, compares `stat.mtimeMs` against the `lastKnownProgress` map
3. Skips files whose mtime has not changed since last check
4. For changed files: reads the JSON, validates with `isValidProgress()`, broadcasts `agent_progress`
5. If a newly completed task is detected, runs `computeNewlyUnblocked()` and broadcasts `tasks_unblocked`
6. Cleans up stale entries from `lastKnownProgress` for deleted progress files

This ensures the dashboard stays in sync even if `fs.watch` drops events. The 5-second interval balances responsiveness against disk I/O overhead.

---

#### `stopReconciliation()`

Stops the periodic reconciliation timer.

**Returns:** `void`

---

#### `stopAll()`

Stops all watchers: per-dashboard watchers, the dashboards directory watcher, the queue directory watcher, all pending timers, and the periodic reconciliation.

**Returns:** `void`

---

## DependencyService

**File:** `src/server/services/DependencyService.js`

Resolves task dependency graphs by reading `initialization.json` for the dependency structure and `progress/` files for task completion status.

### Internal Helpers

#### `getAgents(initData)`

Safely retrieves the `agents` array from initialization data. Returns `[]` if data is missing or malformed.

#### `getDependsOn(agent)`

Safely retrieves a task's `depends_on` array. Returns `[]` if missing or not an array.

#### `resolveTaskStatus(taskId, progressMap)`

Determines the status of a single task based on its progress data. Returns `"completed"`, `"in_progress"`, `"failed"`, or `"pending"`.

### Functions

#### `getDispatchableTasks(dashboardId)`

Returns all tasks that are ready to be dispatched. A task is dispatchable when:
- All entries in its `depends_on` array have a progress file with `status === "completed"`
- The task itself does NOT have a progress file (still pending)

| Parameter | Type | Description |
|-----------|------|-------------|
| `dashboardId` | `string` | Dashboard identifier |

**Returns:** `Array<Object>` -- Array of dispatchable agent objects, each augmented with a `dependency_status` object mapping each dependency ID to its current status.

```javascript
getDispatchableTasks('dashboard1')
// => [
//   {
//     id: "2.1", title: "Create API", wave: 2, depends_on: ["1.1"],
//     dependency_status: { "1.1": "completed" }
//   }
// ]
```

---

#### `computeNewlyUnblocked(dashboardId, completedTaskId)`

Efficiently computes which tasks became newly unblocked after a specific task completed. Instead of scanning all tasks, only examines tasks that list `completedTaskId` in their `depends_on` array. For each such task, checks whether ALL other dependencies are also completed and the task itself has no progress file yet.

| Parameter | Type | Description |
|-----------|------|-------------|
| `dashboardId` | `string` | Dashboard identifier |
| `completedTaskId` | `string` | The task ID that just completed |

**Returns:** `Array<Object>` -- Array of newly dispatchable agent objects with `dependency_status`.

---

#### `getDependencyStatus(dashboardId, taskId)`

Gets the dependency status for a single task. Returns detailed information about each dependency's current status.

| Parameter | Type | Description |
|-----------|------|-------------|
| `dashboardId` | `string` | Dashboard identifier |
| `taskId` | `string` | The task ID to check dependencies for |

**Returns:** `Object` with the following shape:

```javascript
{
  dependencies: { "1.1": "completed", "1.2": "in_progress" },
  allSatisfied: false,
  satisfiedCount: 1,
  totalCount: 2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `dependencies` | `Object` | Map of dependency ID to status string |
| `allSatisfied` | `boolean` | Whether all dependencies are completed |
| `satisfiedCount` | `number` | Number of completed dependencies |
| `totalCount` | `number` | Total number of dependencies |

---

## ArchiveService

**File:** `src/server/services/ArchiveService.js`

Manages archived dashboard snapshots stored in the `Archive/` directory. Archives preserve the full state of a completed swarm for future reference.

### Functions

#### `listArchives()`

Lists all archived dashboards with basic metadata, sorted newest-first by archive name (which embeds the date).

**Returns:** `Array<Object>` -- Array of archive summary objects:

```javascript
[
  {
    name: "2026-03-20_api-refactor",
    task: { name: "api-refactor", type: "Waves", ... },
    agentCount: 8
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Archive folder name (`YYYY-MM-DD_taskName`) |
| `task` | `Object \| null` | Task metadata from `initialization.json`, or `null` |
| `agentCount` | `number` | Number of agents in the archived swarm |

---

#### `archiveDashboard(id)`

Archives a dashboard by copying its entire contents to `Archive/`. The archive name is formatted as `{YYYY-MM-DD}_{taskName}`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier to archive |

**Returns:** `string` -- The archive name (e.g., `"2026-03-20_api-refactor"`)

---

#### `deleteArchive(name)`

Deletes an archived dashboard by name. Removes the entire archive directory recursively.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Archive folder name |

**Returns:** `boolean` -- `true` if deleted, `false` if not found.

---

## HistoryService

**File:** `src/server/services/HistoryService.js`

Generates and manages history summary files. History summaries are lightweight JSON records of completed swarms, stored in the `history/` directory.

### Functions

#### `listHistory()`

Lists all history summary files, sorted newest-first by `cleared_at` timestamp.

**Returns:** `Array<Object>` -- Array of history summary objects (see `buildHistorySummary` for the full schema).

---

#### `buildHistorySummary(id)`

Builds a comprehensive history summary from a dashboard's current data. Derives stats, timing, and per-agent summaries by reading `initialization.json`, all progress files, and `logs.json`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Object` -- History summary with the following structure:

```javascript
{
  task_name: "api-refactor",
  task_type: "Waves",
  project: "my-app",
  directory: "/path/to/project",
  prompt: "Refactor the API layer...",
  overall_status: "completed",          // "completed" | "completed_with_errors" | "in_progress" | "pending"
  total_tasks: 8,
  completed_tasks: 7,
  failed_tasks: 1,
  in_progress_tasks: 0,
  pending_tasks: 0,
  total_waves: 3,
  started_at: "2026-03-20T14:00:00Z",  // Earliest worker started_at
  completed_at: "2026-03-20T14:15:00Z", // Latest worker completed_at
  duration: "15m 0s",                   // Human-readable duration
  cleared_at: "2026-03-20T14:16:00Z",   // When the summary was generated
  dashboard_id: "dashboard1",
  agents: [                              // Per-agent summary array
    {
      id: "1.1",
      title: "Create User Model",
      wave: 1,
      status: "completed",
      assigned_agent: "Agent 1",
      started_at: "2026-03-20T14:00:00Z",
      completed_at: "2026-03-20T14:05:00Z",
      summary: "Created User model with CRUD operations"
    }
  ],
  log_count: 24
}
```

**Derived fields:**
- `overall_status` -- Computed from agent statuses: `"completed"` (all done, none failed), `"completed_with_errors"` (all done, some failed), `"in_progress"` (some running), `"pending"` (none started)
- `started_at` -- Minimum of all agent `started_at` timestamps
- `completed_at` -- Maximum of all agent `completed_at` timestamps
- `duration` -- Human-readable difference between `started_at` and `completed_at` (format: `Xm Ys` or `Ys`)

---

#### `saveHistorySummary(id)`

Builds a history summary and saves it to the `history/` directory. The file is named `{YYYY-MM-DD}_{task_name}.json`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Dashboard identifier |

**Returns:** `Object` -- The saved summary object.

---

## QueueService

**File:** `src/server/services/QueueService.js`

Manages queued swarm tasks stored in the `queue/` directory. Queue items have the same structure as dashboards (`initialization.json`, `logs.json`, `progress/`).

### Functions

#### `listQueue()`

Lists all queued dashboard IDs (directories with `initialization.json` inside `queue/`). Returns a sorted array of queue ID strings.

**Returns:** `string[]` -- Sorted array of queue IDs (e.g., `['queue1', 'queue2']`).

---

#### `getQueueDir(id)`

Returns the absolute path to a queue item directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Queue item identifier |

**Returns:** `string` -- Absolute path to `queue/{id}/`

---

#### `readQueueInit(id)`

Reads and parses a queue item's `initialization.json` synchronously.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Queue item identifier |

**Returns:** `Object | null`

---

#### `readQueueInitAsync(id)`

Async version of `readQueueInit`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Queue item identifier |

**Returns:** `Promise<Object | null>`

---

#### `readQueueLogs(id)`

Reads and parses a queue item's `logs.json` synchronously.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Queue item identifier |

**Returns:** `Object | null`

---

#### `readQueueLogsAsync(id)`

Async version of `readQueueLogs`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Queue item identifier |

**Returns:** `Promise<Object | null>`

---

#### `readQueueProgress(id)`

Reads all progress files from a queue item's `progress/` directory synchronously. Returns an object keyed by `task_id`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Queue item identifier |

**Returns:** `Object` -- Map of `task_id` to progress data.

---

#### `readQueueProgressAsync(id)`

Async version of `readQueueProgress`. Reads all progress files in parallel.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Queue item identifier |

**Returns:** `Promise<Object>`

---

#### `listQueueSummaries()`

Lists all queue items with summary metadata. Derives status from progress files using the same logic as dashboard status derivation.

**Returns:** `Array<Object>` -- Array of queue summary objects:

```javascript
[
  {
    id: "queue1",
    task: {
      name: "feature-xyz",
      type: "Waves",
      directory: "/path/to/project",
      total_tasks: 5,
      created: "2026-03-20T14:00:00Z"
    },
    agentCount: 5,
    status: "pending"    // "pending" | "in_progress" | "completed" | "error"
  }
]
```

---

## SSEManager

**File:** `src/server/SSEManager.js`

Manages SSE (Server-Sent Events) client connections. Tracks connected clients, broadcasts events, and maintains keep-alive heartbeats. See the [SSE Events Reference](./sse-events.md) for all event types.

### Internal State

- `sseClients` -- `Map<http.ServerResponse, { dashboardFilter: string|null }>` of active SSE client connections with per-client metadata

### Functions

#### `broadcast(eventName, data)`

Broadcasts an SSE event to all connected clients. Supports per-client dashboard filtering: if a client has a `dashboardFilter` set, it only receives events that either contain a matching `dashboardId` in the data payload or have no `dashboardId` (global events like `dashboards_list`, `queue_changed`). Clients without a filter receive all events. Automatically cleans up destroyed or ended connections.

| Parameter | Type | Description |
|-----------|------|-------------|
| `eventName` | `string` | SSE event name (e.g., `"initialization"`, `"agent_progress"`) |
| `data` | `any` | Data payload (JSON-serialized). If the payload contains `dashboardId`, it is used for client filtering. |

**Returns:** `void`

**Wire format:**
```
event: {eventName}
data: {JSON.stringify(data)}

```

---

#### `addClient(res, options)`

Adds an SSE client response object to the tracked map with optional configuration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `res` | `http.ServerResponse` | The client's response object |
| `options` | `Object` (optional) | Configuration options |
| `options.dashboardFilter` | `string \| null` (optional) | If set, this client only receives events for the specified dashboard ID. Global events (no `dashboardId`) are always delivered. |

**Returns:** `void`

---

#### `removeClient(res)`

Removes an SSE client response object from the tracked map.

| Parameter | Type | Description |
|-----------|------|-------------|
| `res` | `http.ServerResponse` | The client's response object |

**Returns:** `void`

---

#### `startHeartbeat()`

Starts the SSE heartbeat timer. Sends a comment-based ping (`: ping`) to all clients at `HEARTBEAT_MS` intervals (default: 15 seconds) to keep connections alive. Automatically cleans up dead connections during each ping cycle.

**Returns:** `void`

---

#### `stopHeartbeat()`

Stops the SSE heartbeat timer.

**Returns:** `void`

---

#### `closeAll()`

Closes all SSE client connections by calling `.end()` on each response, then clears the client map.

**Returns:** `void`

---

## Validation Utility

**File:** `src/server/utils/validation.js`

Provides dependency graph validation for the agents array defined in `initialization.json`. Used by the master agent during planning to catch structural errors before dispatching workers.

### Functions

#### `validateDependencyGraph(agents)`

Validates the dependency graph defined by the agents array. Checks for:

1. **Self-references** -- A task that depends on itself (error)
2. **Dangling references** -- A dependency pointing to a non-existent task ID (error)
3. **Circular dependencies** -- Cycles in the dependency graph, detected using Kahn's algorithm / BFS topological sort (error)
4. **Orphan tasks** -- Tasks with no dependencies and nothing depends on them (warning only; Wave 1 tasks are exempt since they are root tasks by design)

| Parameter | Type | Description |
|-----------|------|-------------|
| `agents` | `Array` | Array of agent objects with `{ id, depends_on, wave }` fields |

**Returns:** `Object` with the following shape:

```javascript
{
  valid: true,           // false if any errors found
  errors: [              // Array of error objects
    { type: 'self_ref', message: 'Task 1.1 depends on itself' },
    { type: 'dangling_ref', message: 'Task 2.1 depends on 9.9 which does not exist' },
    { type: 'cycle', message: 'Circular dependency detected involving tasks: 2.1, 2.2' }
  ],
  warnings: [            // Array of warning objects
    { type: 'orphan', message: 'Task 3.1 has no dependencies and nothing depends on it' }
  ]
}
```

| Error Type | Severity | Description |
|------------|----------|-------------|
| `self_ref` | Error | Task lists itself in `depends_on` |
| `dangling_ref` | Error | `depends_on` references a task ID not in the agents array |
| `cycle` | Error | Circular dependency chain detected (lists all involved task IDs) |
| `orphan` | Warning | Task has no connections to the dependency graph (Wave 1 exempt) |

---

## JSON Utilities

**File:** `src/server/utils/json.js`

Provides JSON file I/O with retry logic, atomic write operations, and schema validators for dashboard data files. Used throughout the server by DashboardService, WatcherService, and API routes.

### Reading Functions

#### `readJSON(filePath)`

Reads and parses a JSON file synchronously. Returns `null` on any error (file missing, permission denied, malformed JSON). Malformed JSON is logged to stderr for debugging.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the JSON file |

**Returns:** `Object | null` -- Parsed JSON, or `null` on error.

---

#### `readJSONAsync(filePath)`

Async version of `readJSON` using `fs.promises.readFile`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the JSON file |

**Returns:** `Promise<Object | null>`

---

#### `readJSONWithRetry(filePath, retryDelayMs)`

Reads a JSON file with a single retry after a delay. Designed for progress files that may be mid-write when read. On first attempt, if the file is missing or malformed, waits `retryDelayMs` (default: `PROGRESS_RETRY_MS` = 80ms) and tries once more.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the JSON file |
| `retryDelayMs` | `number` (optional) | Delay before retry in milliseconds. Defaults to `PROGRESS_RETRY_MS` (80ms). |

**Returns:** `Promise<Object | null>` -- Parsed JSON, or `null` if both attempts fail.

**Usage context:** Called by `WatcherService.watchDashboard()` when reading progress files after an `fs.watch` event fires. The delay accounts for the window between a file being opened for writing and the write completing.

---

### Atomic Write Functions

These functions prevent data corruption that can occur when a reader opens a file while a writer is mid-write. They work by writing to a temporary `.tmp` file first, then atomically renaming it to the target path. On POSIX systems, `rename()` is atomic -- readers either see the old complete file or the new complete file, never a partial write.

#### `writeAtomic(filePath, data)`

Writes data to a file atomically (synchronous). If `data` is an object, it is JSON-stringified with 2-space indentation. On error, cleans up the `.tmp` file and rethrows.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Target file path |
| `data` | `string | Object` | Content to write. Objects are JSON-stringified. |

**Returns:** `void`

**Throws:** Rethrows any filesystem error after cleaning up the temp file.

**Implementation:**
1. Write content to `{filePath}.tmp`
2. Rename `{filePath}.tmp` to `{filePath}` (atomic on POSIX)
3. On error: delete `{filePath}.tmp` if it exists, then rethrow

**Used by:** `DashboardService.ensureDashboard()` for creating default `initialization.json` and `logs.json` files.

---

#### `writeAtomicAsync(filePath, data)`

Async version of `writeAtomic` using `fs.promises`. Same behavior and error handling.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Target file path |
| `data` | `string | Object` | Content to write. Objects are JSON-stringified. |

**Returns:** `Promise<void>`

**Throws:** Rethrows any filesystem error after cleaning up the temp file.

---

### Schema Validators

These functions validate the structure of dashboard JSON files. They enforce required fields and value constraints but are intentionally lenient on optional fields for backward compatibility. Used by `WatcherService` to reject invalid data before broadcasting SSE events.

#### `isValidInitialization(data)`

Validates an `initialization.json` object.

**Checks:**
- `task` must be `null` (empty dashboard) or an object with required fields
- If `task` is non-null: `task.name` must be a non-empty string, `task.type` must be `"Waves"` or `"Chains"`
- `agents` must be an array; each entry must have non-empty string `id` and `title`
- `waves` (if present) must be an array; each entry must have `id` and non-empty string `name`

**Returns:** `boolean`

---

#### `isValidProgress(data, expectedTaskId, expectedDashboardId)`

Validates a progress file object. Enforces field types and optionally checks that `task_id` and `dashboard_id` match expected values (used to catch cross-worker write violations).

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Object` | Progress data to validate |
| `expectedTaskId` | `string` (optional) | Expected `task_id` value (derived from filename) |
| `expectedDashboardId` | `string` (optional) | Expected `dashboard_id` value (derived from directory) |

**Checks:**
- `task_id` must be a non-empty string
- `status` must be one of: `"in_progress"`, `"completed"`, `"failed"`
- `stage` (if present) must be one of: `"reading_context"`, `"planning"`, `"implementing"`, `"testing"`, `"finalizing"`, `"completed"`, `"failed"`
- `started_at` and `completed_at` (if present) must be strings or null
- `completed_at` must be null when `status` is `"in_progress"`
- `milestones`, `deviations`, `logs` (if present) must be arrays
- If `expectedTaskId` is provided and `data.task_id` does not match, validation fails (logged as a cross-worker write violation)
- If `expectedDashboardId` is provided and `data.dashboard_id` is present but does not match, validation fails

**Returns:** `boolean`

---

#### `isValidLogs(data)`

Validates a `logs.json` object.

**Checks:**
- Must be a non-null object
- Must have an `entries` field that is an array

**Returns:** `boolean`

---

## Named Constants

**File:** `src/server/utils/constants.js`

Defines all timing values, directory paths, and default data structures used across the server.

### Directory Paths

| Constant | Default | Description |
|----------|---------|-------------|
| `ROOT` | `path.resolve(__dirname, '..', '..', '..')` | Synapse repository root |
| `DASHBOARDS_DIR` | `{ROOT}/dashboards` | Active dashboard data |
| `QUEUE_DIR` | `{ROOT}/queue` | Queued swarm tasks |
| `ARCHIVE_DIR` | `{ROOT}/Archive` | Archived dashboard snapshots |
| `HISTORY_DIR` | `{ROOT}/history` | History summary files |
| `CONVERSATIONS_DIR` | `{ROOT}/conversations` | Chat conversation files |

### Timing Values

| Constant | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP server port (overridable via `PORT` env var) |
| `INIT_POLL_MS` | `100` | `fs.watchFile` polling interval for `initialization.json` and `logs.json` |
| `PROGRESS_RETRY_MS` | `80` | Retry delay for reading progress files that may be mid-write |
| `PROGRESS_READ_DELAY_MS` | `30` | Initial delay before reading a changed progress file (lets the write finish) |
| `RECONCILE_DEBOUNCE_MS` | `300` | Debounce interval for directory-level reconciliation |
| `RECONCILE_INTERVAL_MS` | `5000` | Periodic reconciliation scan interval (catches missed `fs.watch` events) |
| `HEARTBEAT_MS` | `15000` | SSE heartbeat ping interval (15 seconds) |
| `DEPENDENCY_CHECK_DELAY_MS` | `100` | Delay after a task completes before checking for unblocked downstream tasks |

### Default Data Structures

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_INITIALIZATION` | `{ task: null, agents: [], waves: [], chains: [], history: [] }` | Empty dashboard initialization state |
| `DEFAULT_LOGS` | `{ entries: [] }` | Empty logs state |
| `MIME_TYPES` | `{ .html, .css, .js, .json }` | Static file MIME type mapping |
