# SSE Events Reference

The Synapse server uses Server-Sent Events (SSE) to push real-time updates to the browser dashboard. All SSE communication flows through a single endpoint.

---

## SSE Endpoint

```
GET /events
```

Establishes an SSE connection. The server responds with the following headers:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dashboard` | `string` (optional) | Filter to receive data for a specific dashboard only. If omitted, receives data for all dashboards. |

**Example:**
```
GET /events?dashboard=2d84ac
```

### Connection Lifecycle

1. Client connects to `/events`
2. Server sends initial data burst (see [Initial Data Burst](#initial-data-burst))
3. Server sends real-time events as file changes occur
4. Server sends heartbeat pings every `HEARTBEAT_MS` (default 15 seconds)
5. On client disconnect, server removes the client from the tracked set

### Connection Management

Connections are managed by the SSEManager module:

- `addClient(res, options)` -- adds the client's response object to the tracked `Map` with optional `{ dashboardFilter }` metadata
- `removeClient(res)` -- removes the client on connection close
- `broadcast(eventName, data)` -- sends an event to all connected clients. If a client has a `dashboardFilter` set, it only receives events whose `data.dashboardId` matches the filter (or global events with no `dashboardId`).
- Dead connections (destroyed or ended responses) are automatically cleaned up during broadcast and heartbeat cycles

---

## Initial Data Burst

When a client connects, the server immediately sends a batch of events to bring the client up to speed. This happens before any file-change-driven events.

### Sequence

| Order | Event | Description |
|-------|-------|-------------|
| 1 | `dashboards_list` | List of all dashboard IDs |
| 2 | `initialization` | Static plan data for each dashboard (one event per dashboard) |
| 3 | `all_progress` | All progress files for each dashboard (one event per dashboard, only if non-empty) |
| 4 | `init_state` | Combined state for each dashboard (initialization + progress + logs) |
| 5 | `queue_changed` | Current queue state (only if queue is non-empty) |

If the `?dashboard=` query parameter is set, events 2-4 are sent only for the specified dashboard. Event 1 always includes all dashboards.

---

## Event Types

### `dashboards_list`

Sent on initial connection. Contains the list of all dashboard IDs.

**Trigger:** SSE connection established

**Data:**
```json
{
  "dashboards": ["2d84ac", "356dc5", "71894a"]
}
```

---

### `initialization`

Contains the static plan data from a dashboard's `initialization.json`.

**Trigger:**
- Sent on initial connection (for each dashboard)
- Broadcast when `initialization.json` is modified and passes schema validation

**Data:**
```json
{
  "dashboardId": "2d84ac",
  "task": {
    "name": "api-refactor",
    "type": "Waves",
    "directory": "/path/to/project",
    "prompt": "Refactor the API layer...",
    "project": "my-app",
    "project_root": "/path/to/project",
    "created": "2026-03-20T14:00:00Z",
    "total_tasks": 8,
    "total_waves": 3
  },
  "agents": [
    {
      "id": "1.1",
      "title": "Create User Model",
      "wave": 1,
      "layer": 0,
      "directory": "src/models",
      "depends_on": []
    }
  ],
  "waves": [
    { "id": 1, "name": "Wave 1 - Foundation", "total": 3 }
  ],
  "chains": [],
  "history": []
}
```

**Validation:** Must pass `isValidInitialization()`:
- `task` must be `null` or an object
- If `task` is not null: `name` must be a non-empty string, `type` must be `"Waves"` or `"Chains"`
- `agents` must be an array; each agent must have non-empty `id` and `title` strings
- `waves` (if present) must be an array; each wave must have `id` and non-empty `name`

---

### `all_progress`

Contains all progress files for a dashboard, sent as a single batch. Only sent during initial connection if there are progress files.

**Trigger:** SSE connection established (only if progress files exist)

**Data:**
```json
{
  "dashboardId": "2d84ac",
  "1.1": {
    "task_id": "1.1",
    "status": "completed",
    "started_at": "2026-03-20T14:00:00Z",
    "completed_at": "2026-03-20T14:05:00Z",
    "summary": "Created User model",
    "assigned_agent": "Agent 1",
    "stage": "completed",
    "message": "Task complete",
    "milestones": [...],
    "deviations": [],
    "logs": [...]
  },
  "1.2": { ... }
}
```

The data object contains `dashboardId` plus one key per task ID, each containing the full progress file contents.

---

### `init_state`

Combined state for a dashboard, providing all data needed for full reconnection catch-up. Sent once per dashboard on initial connection.

**Trigger:** SSE connection established

**Data:**
```json
{
  "dashboardId": "2d84ac",
  "initialization": {
    "task": { ... },
    "agents": [...],
    "waves": [...],
    "chains": [],
    "history": []
  },
  "progress": {
    "1.1": { "task_id": "1.1", "status": "completed", ... },
    "1.2": { "task_id": "1.2", "status": "in_progress", ... }
  },
  "logs": {
    "entries": [...]
  }
}
```

This event provides everything the dashboard needs to render the full current state in a single event. It is the primary reconnection mechanism.

---

### `agent_progress`

Individual agent progress update. Broadcast whenever a worker writes to its progress file.

**Trigger:**
- `fs.watch` detects a change in `progress/{task_id}.json`
- Periodic reconciliation detects a missed change

**Data:**
```json
{
  "dashboardId": "2d84ac",
  "task_id": "1.2",
  "status": "in_progress",
  "started_at": "2026-03-20T14:01:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 2",
  "stage": "implementing",
  "message": "Writing API endpoints -- 2/4 done",
  "milestones": [
    { "at": "2026-03-20T14:01:10Z", "msg": "Read existing patterns" },
    { "at": "2026-03-20T14:02:00Z", "msg": "Created GET /users endpoint" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-03-20T14:01:00Z", "level": "info", "msg": "Starting task" }
  ]
}
```

**Validation:** Must pass `isValidProgress()`:
- `task_id` must be a non-empty string
- `status` must be one of: `"in_progress"`, `"completed"`, `"failed"`
- `stage` (if present) must be one of: `"reading_context"`, `"planning"`, `"implementing"`, `"testing"`, `"finalizing"`, `"completed"`, `"failed"`
- `started_at` and `completed_at` (if present) must be strings or null
- `completed_at` must be null when `status` is `"in_progress"`
- `milestones`, `deviations`, `logs` (if present) must be arrays

**Read strategy:** Progress files are read with a delay (`PROGRESS_READ_DELAY_MS`, default 30ms) followed by a retry (`PROGRESS_RETRY_MS`, default 80ms) if the first read produces invalid JSON. This handles the race condition where `fs.watch` fires before the write is complete.

---

### `logs`

Updated log entries from a dashboard's `logs.json`.

**Trigger:** `fs.watchFile` detects a change in `logs.json`

**Data:**
```json
{
  "dashboardId": "2d84ac",
  "entries": [
    {
      "timestamp": "2026-03-20T14:05:00Z",
      "task_id": "1.1",
      "agent": "Agent 1",
      "level": "info",
      "message": "Agent dispatched",
      "task_name": "Create User Model"
    }
  ]
}
```

**Validation:** Must pass `isValidLogs()`:
- Must be an object with an `entries` field that is an array

---

### `tasks_unblocked`

Sent when a task completion unblocks downstream tasks. The WatcherService automatically checks dependencies when a progress file transitions to `status: "completed"`.

**Trigger:** A task completes and at least one downstream task becomes dispatchable (all its dependencies are now complete)

**Delay:** `DEPENDENCY_CHECK_DELAY_MS` (default 100ms) after the progress file change is detected

**Data:**
```json
{
  "dashboardId": "2d84ac",
  "completedTaskId": "1.1",
  "unblocked": [
    {
      "id": "2.1",
      "title": "Create API endpoints",
      "wave": 2,
      "depends_on": ["1.1"],
      "dependency_status": {
        "1.1": "completed"
      }
    },
    {
      "id": "2.2",
      "title": "Create middleware",
      "wave": 2,
      "depends_on": ["1.1"],
      "dependency_status": {
        "1.1": "completed"
      }
    }
  ]
}
```

This event enables the dashboard to highlight newly dispatchable tasks and potentially trigger automated dispatch in the master agent.

---

### `dashboards_changed`

Sent when the set of dashboards changes (new dashboard created or existing one removed).

**Trigger:** `fs.watch` on the `dashboards/` directory detects a change (debounced by `RECONCILE_DEBOUNCE_MS`, default 300ms)

**Data:**
```json
{
  "dashboards": ["2d84ac", "356dc5", "71894a"]
}
```

The server also starts/stops per-dashboard watchers as needed when this event fires.

---

### `queue_changed`

Sent when the queue state changes (new item added or item removed).

**Trigger:** `fs.watch` on the `queue/` directory detects a change (debounced by `RECONCILE_DEBOUNCE_MS`, default 300ms)

**Data:**
```json
{
  "queue": [
    {
      "id": "queue1",
      "task": {
        "name": "feature-xyz",
        "type": "Waves",
        "directory": "/path/to/project",
        "total_tasks": 5,
        "created": "2026-03-20T14:00:00Z"
      },
      "agentCount": 5,
      "status": "pending"
    }
  ]
}
```

---

### `write_rejected`

Sent when a progress file write is rejected by the WatcherService's validation guards. This event alerts the dashboard that a worker attempted to write invalid data (e.g., wrong `task_id` for the filename or wrong `dashboard_id` for the directory).

**Trigger:** WatcherService `validateAndBroadcast()` detects a mismatch between the progress file contents and its expected location

**Data (task_id mismatch):**
```json
{
  "dashboardId": "2d84ac",
  "filename": "1.1.json",
  "task_id": "2.3",
  "reason": "task_id_mismatch",
  "details": "File contains task_id \"2.3\" but filename is \"1.1.json\" (expected task_id \"1.1\")",
  "expected_task_id": "1.1",
  "timestamp": "2026-03-20T14:05:00.000Z"
}
```

**Data (dashboard_id mismatch):**
```json
{
  "dashboardId": "2d84ac",
  "filename": "1.1.json",
  "task_id": "1.1",
  "reason": "dashboard_id_mismatch",
  "details": "File contains dashboard_id \"dashboard2\" but is in dashboard \"dashboard1\"",
  "file_dashboard_id": "356dc5",
  "expected_dashboard_id": "2d84ac",
  "timestamp": "2026-03-20T14:05:00.000Z"
}
```

**Rejection reasons:**

| Reason | Description |
|--------|-------------|
| `task_id_mismatch` | The `task_id` field inside the progress file does not match the filename (e.g., file `1.1.json` contains `task_id: "2.3"`) |
| `dashboard_id_mismatch` | The `dashboard_id` field inside the progress file does not match the dashboard directory it was written to |

---

## Heartbeat

The server sends a comment-based heartbeat ping to all connected clients at regular intervals to prevent connection timeouts.

**Format:**
```
: ping

```

**Interval:** `HEARTBEAT_MS` (default 15000ms / 15 seconds)

Heartbeat pings are SSE comments (lines starting with `:`) and are ignored by the browser's `EventSource` API. They serve solely to keep the TCP connection alive.

During each heartbeat cycle, the server also cleans up dead connections (destroyed or ended response objects).

---

## Event Wire Format

All events follow the standard SSE wire format:

```
event: {eventName}
data: {JSON stringified payload}

```

Each event consists of:
1. An `event:` line with the event name
2. A `data:` line with the JSON-serialized payload
3. Two newlines (`\n\n`) to terminate the event

**Example on the wire:**
```
event: agent_progress
data: {"dashboardId":"2d84ac","task_id":"1.1","status":"completed","stage":"completed"}

```

---

## Client-Side Usage

### Connecting with EventSource

```javascript
const evtSource = new EventSource('http://localhost:3456/events');

// Listen for specific events
evtSource.addEventListener('agent_progress', (event) => {
  const data = JSON.parse(event.data);
  console.log(`Task ${data.task_id} is now ${data.status}`);
});

evtSource.addEventListener('initialization', (event) => {
  const data = JSON.parse(event.data);
  console.log(`Dashboard ${data.dashboardId} plan loaded`);
});

// Filter to single dashboard
const filtered = new EventSource('http://localhost:3456/events?dashboard=2d84ac');
```

### Reconnection

The browser's `EventSource` API automatically reconnects if the connection drops. On reconnection, the server sends the full initial data burst again, ensuring the client has complete state.

---

## Event Summary Table

| Event Name | Trigger | Frequency | Data Shape |
|------------|---------|-----------|------------|
| `dashboards_list` | Connection | Once per connection | `{ dashboards: string[] }` |
| `initialization` | Connection + file change | Per dashboard + on change | `{ dashboardId, task, agents, waves, chains, history }` |
| `all_progress` | Connection | Once per dashboard (if non-empty) | `{ dashboardId, [task_id]: progressData }` |
| `init_state` | Connection | Once per dashboard | `{ dashboardId, initialization, progress, logs }` |
| `agent_progress` | Progress file change | Per file change | `{ dashboardId, task_id, status, stage, ... }` |
| `logs` | logs.json change | On change | `{ dashboardId, entries }` |
| `tasks_unblocked` | Task completion | When dependencies resolve | `{ dashboardId, completedTaskId, unblocked }` |
| `dashboards_changed` | Dashboard dir change | On change (debounced) | `{ dashboards: string[] }` |
| `queue_changed` | Queue dir change | On change (debounced) | `{ queue: QueueSummary[] }` |
| `write_rejected` | Invalid progress write | On validation failure | `{ dashboardId, filename, task_id, reason, details, timestamp }` |
