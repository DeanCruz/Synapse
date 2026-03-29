# Server Configuration Reference

All server configuration constants are defined in `src/server/utils/constants.js`. The server is designed to work with zero external configuration, but the port can be overridden via environment variable.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP server listening port |

**Usage:**
```bash
# Default port
node src/server/index.js

# Custom port
PORT=8080 node src/server/index.js
```

---

## Directory Constants

These paths are computed relative to the Synapse repository root (`ROOT`), which is resolved as three levels up from `src/server/utils/constants.js`.

| Constant | Value | Description |
|----------|-------|-------------|
| `ROOT` | `path.resolve(__dirname, '..', '..', '..')` | Absolute path to the Synapse repository root |
| `DASHBOARDS_DIR` | `{ROOT}/dashboards` | Directory containing all dashboard subdirectories |
| `QUEUE_DIR` | `{ROOT}/queue` | Directory containing queued swarm tasks |
| `ARCHIVE_DIR` | `{ROOT}/Archive` | Directory containing archived dashboard snapshots |
| `HISTORY_DIR` | `{ROOT}/history` | Directory containing history summary JSON files |
| `CONVERSATIONS_DIR` | `{ROOT}/conversations` | Directory for conversation data |

### Directory Structure on Disk

```
{ROOT}/
  dashboards/
    dashboard1/
      initialization.json
      logs.json
      progress/
        1.1.json
        1.2.json
    dashboard2/
      ...
  queue/
    queue1/
      initialization.json
      logs.json
      progress/
  Archive/
    2026-03-20_api-refactor/
      initialization.json
      logs.json
      progress/
  history/
    2026-03-20_api-refactor.json
```

---

## Timing Constants

These constants control the server's file watching and event processing behavior.

| Constant | Default | Unit | Description |
|----------|---------|------|-------------|
| `INIT_POLL_MS` | `100` | ms | `fs.watchFile` polling interval for `initialization.json` and `logs.json`. Lower values mean faster detection but higher CPU usage. |
| `PROGRESS_RETRY_MS` | `80` | ms | Retry delay when reading a progress file that yielded invalid JSON (likely mid-write). The server waits this long then reads again. |
| `PROGRESS_READ_DELAY_MS` | `30` | ms | Initial delay before reading a changed progress file. Gives the writing process time to complete the atomic write. |
| `RECONCILE_DEBOUNCE_MS` | `300` | ms | Debounce interval for reconciling dashboard and queue directory changes. Prevents rapid-fire reconciliation when multiple files change simultaneously. |
| `RECONCILE_INTERVAL_MS` | `5000` | ms | Periodic reconciliation interval. Every 5 seconds, the server scans all watched dashboards for progress file changes that `fs.watch` may have missed. |
| `HEARTBEAT_MS` | `15000` | ms | SSE heartbeat ping interval. Keeps SSE connections alive by sending a comment ping every 15 seconds. |
| `DEPENDENCY_CHECK_DELAY_MS` | `100` | ms | Delay after a progress file status change before running the dependency check. Allows other concurrent writes to settle. |

### Timing Flow for Progress File Updates

```
Worker writes progress file
         |
         v  (fs.watch fires immediately)
Wait PROGRESS_READ_DELAY_MS (30ms)
         |
         v
Read progress file (attempt 1)
         |
    Valid JSON?
   /          \
  YES          NO
   |            |
   v            v
Broadcast    Wait PROGRESS_RETRY_MS (80ms)
SSE event        |
                 v
              Read again (attempt 2)
                 |
            Valid JSON?
           /          \
          YES          NO
           |            |
           v            v
        Broadcast    Silently
        SSE event    discard
```

### Timing Flow for Dependency Checks

```
Progress file shows status: "completed"
         |
         v
Wait DEPENDENCY_CHECK_DELAY_MS (100ms)
         |
         v
computeNewlyUnblocked(dashboardId, taskId)
         |
    Unblocked tasks found?
   /                \
  YES                NO
   |                  |
   v                  v
Broadcast           Done
"tasks_unblocked"
SSE event
```

---

## MIME Types

Used for static file serving (if applicable).

| Extension | MIME Type |
|-----------|-----------|
| `.html` | `text/html` |
| `.css` | `text/css` |
| `.js` | `application/javascript` |
| `.json` | `application/json` |

---

## Default Data Structures

These constants define the default (empty) state for dashboard files.

### `DEFAULT_INITIALIZATION`

```json
{
  "task": null,
  "agents": [],
  "waves": [],
  "chains": [],
  "history": []
}
```

Used when:
- Creating a new dashboard (`ensureDashboard`)
- Clearing a dashboard (`POST /api/dashboards/:id/clear`)
- Archiving a dashboard (`POST /api/dashboards/:id/archive`)
- Returning data for a dashboard with no `initialization.json`

### `DEFAULT_LOGS`

```json
{
  "entries": []
}
```

Used when:
- Creating a new dashboard
- Clearing a dashboard
- Returning data for a dashboard with no `logs.json`

---

## JSON Utilities

**File:** `src/server/utils/json.js`

### Reading Functions

#### `readJSON(filePath)`

Synchronous JSON file reader. Returns parsed object or `null` on error. Logs malformed JSON errors to stderr.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the JSON file |

**Returns:** `Object | null`

---

#### `readJSONAsync(filePath)`

Asynchronous JSON file reader using `fs.promises.readFile`. Returns parsed object or `null` on error.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the JSON file |

**Returns:** `Promise<Object | null>`

---

#### `readJSONWithRetry(filePath, retryDelayMs)`

Reads a JSON file with one retry. Used for progress files that may be mid-write when `fs.watch` fires. If the first read returns `null` (parse error), waits `retryDelayMs` then tries once more.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the JSON file |
| `retryDelayMs` | `number` (optional) | Retry delay in milliseconds. Defaults to `PROGRESS_RETRY_MS` (80ms). |

**Returns:** `Promise<Object | null>`

---

### Validation Functions

#### `isValidInitialization(data)`

Validates that a parsed JSON object conforms to the initialization.json schema.

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `any` | Parsed JSON data to validate |

**Returns:** `boolean`

**Validation rules:**
- Must be a non-null object
- Must have a `task` field that is `null` or an object
- Must have an `agents` field that is an array
- If `task` is not null:
  - `task.name` must be a non-empty string
  - `task.type` must be `"Waves"` or `"Chains"`
  - `task.total_tasks` and `task.total_waves` (if present) must be numbers or strings
- Each agent must have non-empty `id` and `title` strings
- `waves` (if present) must be an array of objects with `id` and non-empty `name`

---

#### `isValidProgress(data, expectedTaskId, expectedDashboardId)`

Validates that a parsed JSON object conforms to the progress file schema. Optionally checks that the `task_id` and `dashboard_id` fields match expected values (used by the WatcherService to reject cross-worker writes and dashboard binding violations).

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `any` | Parsed JSON data to validate |
| `expectedTaskId` | `string` (optional) | If provided, `data.task_id` must match this value exactly. A mismatch is logged and rejected. |
| `expectedDashboardId` | `string` (optional) | If provided and `data.dashboard_id` is present, they must match. |

**Returns:** `boolean`

**Validation rules:**
- Must be a non-null object
- `task_id` must be a non-empty string
- If `expectedTaskId` is provided, `data.task_id` must equal it (logs rejection message on mismatch)
- `dashboard_id` (if present) must be a non-empty string; if `expectedDashboardId` is also provided, they must match
- `status` must be one of: `"in_progress"`, `"completed"`, `"failed"`
- `stage` (if present) must be one of: `"reading_context"`, `"planning"`, `"implementing"`, `"testing"`, `"finalizing"`, `"completed"`, `"failed"`
- `started_at` and `completed_at` (if present) must be strings or null
- `completed_at` must be null when `status` is `"in_progress"`
- `milestones`, `deviations`, `logs` (if present) must be arrays

---

#### `isValidLogs(data)`

Validates that a parsed JSON object conforms to the logs.json schema.

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `any` | Parsed JSON data to validate |

**Returns:** `boolean`

**Validation rules:**
- Must be a non-null object
- Must have an `entries` field that is an array

---

### Writing Functions

#### `writeAtomic(filePath, data)`

Writes data to a file atomically (synchronous). Writes to a `.tmp` file first, then renames to the target path. If `data` is an object, it is JSON-stringified with 2-space indentation. On error, cleans up the `.tmp` file and rethrows.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the target file |
| `data` | `Object \| string` | Data to write. Objects are JSON-stringified. |

**Returns:** `void`

**Throws:** Rethrows any write/rename errors after cleaning up the temp file.

---

#### `writeAtomicAsync(filePath, data)`

Asynchronous version of `writeAtomic`. Uses `fs.promises` for all operations.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the target file |
| `data` | `Object \| string` | Data to write. Objects are JSON-stringified. |

**Returns:** `Promise<void>`

**Throws:** Rethrows any write/rename errors after cleaning up the temp file.

---

### Atomic Write Strategy

Both `writeAtomic` and `writeAtomicAsync` use the write-then-rename pattern:

```
1. Write content to {filePath}.tmp
2. Rename {filePath}.tmp to {filePath}   (atomic on POSIX and NTFS)
3. On error: delete {filePath}.tmp, then rethrow
```

This guarantees that the target file is never in a partially-written state. Readers always see either the old complete file or the new complete file, never a truncated or corrupted intermediate state. This is critical for the server's file watching system, where `fs.watch` may fire before a non-atomic write completes.

---

## Dependency Graph Validation

**File:** `src/server/utils/validation.js`

This utility is not imported by the server runtime. It provides a `validateDependencyGraph(agents)` function used by the master agent during planning to validate the agents array before writing `initialization.json`. See [Services Reference -- Validation Utility](./services.md#validation-utility) for full API documentation.
