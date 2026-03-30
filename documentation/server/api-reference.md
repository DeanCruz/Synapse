# REST API Reference

All API endpoints are handled by `src/server/routes/apiRoutes.js`. The server applies CORS headers to every response (see [Server Overview](./overview.md) for CORS details).

All responses use `Content-Type: application/json`.

---

## URL Routing

The `handleApiRoute(req, res, url)` function processes all REST API requests. It returns `true` if the route was handled, `false` if not (caller falls through to 404).

### Path Security

All path parameters (dashboard IDs, archive names, queue IDs) are sanitized via `sanitizePathParam()`:

- Rejects empty strings and strings longer than 100 characters
- Rejects path traversal patterns (`..`, `/`, `\`)
- Only allows: alphanumeric characters, underscores, hyphens, dots
- Must start with a letter, digit, or underscore

Invalid parameters return `400 Bad Request` with a descriptive error message.

---

## Dashboard Endpoints

### List Dashboards

```
GET /api/dashboards
```

Returns the list of all valid dashboard IDs.

**Response (200):**
```json
{
  "dashboards": ["2d84ac", "356dc5", "71894a"]
}
```

Dashboard IDs are 6-character hexadecimal strings. There is no fixed upper limit on the number of concurrent dashboards.

---

### Create Dashboard

```
POST /api/dashboards
```

Creates a new dashboard with the next available ID. The new dashboard is initialized with default `initialization.json`, `logs.json`, and an empty `progress/` directory.

**Response (201):**
```json
{
  "success": true,
  "id": "a3f1b2"
}
```

---

### Delete Dashboard

```
DELETE /api/dashboards/:id
```

Deletes a dashboard directory entirely, including all files.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier (e.g., `2d84ac`) |

**Response (200):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400` -- Invalid dashboard ID (failed sanitization)
- `404` -- Dashboard not found

---

### Get Dashboard Statuses

```
GET /api/dashboards/statuses
```

Returns a lightweight status summary for all dashboards. Designed for sidebar status dots -- minimal data, fast response.

**Response (200):**
```json
{
  "statuses": {
    "2d84ac": "in_progress",
    "356dc5": "completed",
    "71894a": "idle"
  }
}
```

**Status values:**

| Status | Condition |
|--------|-----------|
| `idle` | No active task (`task` is null or has no name) |
| `in_progress` | Has active task with workers running or some progress |
| `completed` | All tasks completed (none failed) |
| `error` | All tasks done but at least one failed |

**Status derivation logic:**
1. If no task name exists, status is `idle`
2. If task exists but no progress files, status is `in_progress`
3. If all progress files show `completed` or `failed`, and total matches `total_tasks`: all done
   - If any `failed`, status is `error`
   - Otherwise `completed`
4. If any `in_progress` or some progress exists, status is `in_progress`
5. Fallback: `idle`

---

### Get Dashboard Initialization

```
GET /api/dashboards/:id/initialization
```

Returns the dashboard's `initialization.json` data (the static plan).

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200):**
```json
{
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

If the dashboard has no data, returns the default:
```json
{ "task": null, "agents": [], "waves": [], "chains": [], "history": [] }
```

---

### Get Dashboard Logs

```
GET /api/dashboards/:id/logs
```

Returns the dashboard's `logs.json` data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200):**
```json
{
  "entries": [
    {
      "timestamp": "2026-03-20T14:00:00Z",
      "task_id": "1.1",
      "agent": "Agent 1",
      "level": "info",
      "message": "Agent dispatched",
      "task_name": "Create User Model"
    }
  ]
}
```

If no logs exist, returns: `{ "entries": [] }`

---

### Get Dashboard Progress

```
GET /api/dashboards/:id/progress
```

Returns all progress files from the dashboard's `progress/` directory, keyed by `task_id`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200):**
```json
{
  "1.1": {
    "task_id": "1.1",
    "status": "completed",
    "started_at": "2026-03-20T14:00:00Z",
    "completed_at": "2026-03-20T14:05:00Z",
    "summary": "Created User model with CRUD operations",
    "assigned_agent": "Agent 1",
    "stage": "completed",
    "message": "Task complete",
    "milestones": [],
    "deviations": [],
    "logs": []
  },
  "1.2": {
    "task_id": "1.2",
    "status": "in_progress",
    "started_at": "2026-03-20T14:01:00Z",
    "completed_at": null,
    "summary": null,
    "assigned_agent": "Agent 2",
    "stage": "implementing",
    "message": "Writing API endpoints",
    "milestones": [],
    "deviations": [],
    "logs": []
  }
}
```

---

### Get Dispatchable Tasks

```
GET /api/dashboards/:id/dispatchable
```

Returns all tasks that are ready to be dispatched (all dependencies satisfied, no progress file yet).

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200):**
```json
{
  "dispatchable": [
    {
      "id": "2.1",
      "title": "Create API endpoints",
      "wave": 2,
      "layer": 1,
      "directory": "src/routes",
      "depends_on": ["1.1"],
      "dependency_status": {
        "1.1": "completed"
      }
    }
  ]
}
```

---

### Archive Dashboard

```
POST /api/dashboards/:id/archive
```

Archives a dashboard by copying its full contents to `Archive/{YYYY-MM-DD}_{taskName}/`, then clears the dashboard to default state.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200):**
```json
{
  "success": true,
  "archiveName": "2026-03-20_api-refactor"
}
```

**Error Response (500):**
```json
{
  "error": "Failed to archive: <error message>"
}
```

**Side effects:**
1. Copies dashboard directory to `Archive/{date}_{name}/`
2. Re-initializes the dashboard with default files
3. Clears all progress files
4. Resets `initialization.json` and `logs.json` to defaults

---

### Save History Summary

```
POST /api/dashboards/:id/save-history
```

Saves a history summary for the current swarm without clearing the dashboard. Prevents duplicate saves -- if the history file already exists, returns success with `alreadySaved: true`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200):**
```json
{
  "success": true,
  "task_name": "api-refactor"
}
```

**Response (200, already saved):**
```json
{
  "success": true,
  "alreadySaved": true,
  "task_name": "api-refactor"
}
```

**Error Response (400):**
```json
{
  "error": "No active task to save history for"
}
```

---

### Get Dashboard Metrics

```
GET /api/dashboards/:id/metrics
```

Returns the `metrics.json` data for a dashboard, if it exists. Metrics are written by the master agent and contain timing and performance data for the swarm.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200, metrics exist):**
```json
{
  "total_duration_ms": 180000,
  "wave_durations": [...],
  "...": "..."
}
```

**Response (200, no metrics):**
```json
{
  "metrics": null
}
```

---

### Clear Dashboard

```
POST /api/dashboards/:id/clear
```

Archives the dashboard (if it has an active task), saves a history summary, then clears the dashboard to default state. This is a destructive operation that resets all dashboard data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200):**
```json
{
  "success": true,
  "archived": true,
  "archiveName": "2026-03-20_api-refactor"
}
```

**Response (200, no active task -- nothing to archive):**
```json
{
  "success": true,
  "archived": false,
  "archiveName": null
}
```

**Side effects:**
1. Archives the dashboard directory to `Archive/` (if task exists)
2. Builds and saves a history summary (if task exists)
3. Re-initializes the dashboard directory structure
4. Clears all progress files
5. Resets `initialization.json` and `logs.json` to defaults

---

### Export Dashboard

```
GET /api/dashboards/:id/export
```

Returns a read-only export of all swarm data for the dashboard -- initialization, logs, progress, and a computed summary. Useful for external tools or archival.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Dashboard identifier |

**Response (200):**
```json
{
  "exported_at": "2026-03-20T14:20:00.000Z",
  "summary": {
    "task_name": "api-refactor",
    "overall_status": "completed",
    "total_tasks": 8,
    "completed_tasks": 8,
    "duration": "15m 30s"
  },
  "initialization": { "task": { ... }, "agents": [...], "waves": [...] },
  "logs": { "entries": [...] },
  "progress": { "1.1": { ... }, "1.2": { ... } }
}
```

The `summary` field is the same structure as `buildHistorySummary()` output, but with `cleared_at` removed.

**Error Response (500):**
```json
{
  "error": "Failed to export: <error message>"
}
```

---

## Overview Endpoint

### Get Overview

```
GET /api/overview
```

Returns a high-level overview of all dashboards, recent logs, archives, and history. Designed for the home/overview dashboard page.

**Response (200):**
```json
{
  "dashboards": [
    {
      "id": "2d84ac",
      "status": "in_progress",
      "task": {
        "name": "api-refactor",
        "type": "Waves",
        "directory": "/path/to/project",
        "total_tasks": 8,
        "completed_tasks": 5,
        "failed_tasks": 0,
        "created": "2026-03-20T14:00:00Z"
      }
    },
    {
      "id": "356dc5",
      "status": "idle",
      "task": null
    }
  ],
  "archives": [
    {
      "name": "2026-03-19_previous-task",
      "task": { "name": "previous-task", ... },
      "agentCount": 5
    }
  ],
  "history": [
    {
      "task_name": "previous-task",
      "overall_status": "completed",
      "duration": "12m 30s",
      ...
    }
  ],
  "recentLogs": [
    {
      "dashboardId": "2d84ac",
      "timestamp": "2026-03-20T14:05:00Z",
      "level": "info",
      "message": "Agent completed task 1.1"
    }
  ]
}
```

**Details:**
- `dashboards` -- All dashboards with derived status and task summary
- `archives` -- Up to 10 most recent archives
- `history` -- Up to 10 most recent history summaries
- `recentLogs` -- Up to 30 most recent log entries across all active dashboards, sorted newest-first, with `dashboardId` added to each entry

---

## Archive Endpoints

### List Archives

```
GET /api/archives
```

Returns all archived dashboard snapshots.

**Response (200):**
```json
{
  "archives": [
    {
      "name": "2026-03-20_api-refactor",
      "task": { "name": "api-refactor", "type": "Waves", ... },
      "agentCount": 8
    }
  ]
}
```

Archives are sorted newest-first by name.

---

### Get Single Archive

```
GET /api/archives/:name
```

Returns the full data for a single archive (initialization, logs, and progress).

| Parameter | Type | Description |
|-----------|------|-------------|
| `:name` | `string` | Archive folder name (e.g., `2026-03-20_api-refactor`) |

**Response (200):**
```json
{
  "initialization": { "task": { ... }, "agents": [...], "waves": [...] },
  "logs": { "entries": [...] },
  "progress": { "1.1": { ... }, "1.2": { ... } }
}
```

**Error Responses:**
- `400` -- Invalid archive name (failed sanitization)
- `404` -- Archive not found

---

### Delete Archive

```
DELETE /api/archives/:name
```

Deletes an archived dashboard snapshot.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:name` | `string` | Archive folder name |

**Response (200):**
```json
{
  "success": true
}
```

**Error Responses:**
- `400` -- Invalid archive name (failed sanitization)
- `404` -- Archive not found

---

## History Endpoints

### List History

```
GET /api/history
```

Returns all history summary files, sorted newest-first.

**Response (200):**
```json
{
  "history": [
    {
      "task_name": "api-refactor",
      "task_type": "Waves",
      "project": "my-app",
      "overall_status": "completed",
      "total_tasks": 8,
      "completed_tasks": 8,
      "failed_tasks": 0,
      "duration": "15m 30s",
      "cleared_at": "2026-03-20T14:16:00Z",
      "dashboard_id": "2d84ac",
      "agents": [...],
      "log_count": 24
    }
  ]
}
```

---

### Get History Analytics

```
GET /api/history/analytics
```

Returns the history analytics data from `history/analytics.json`. This file is generated externally and contains aggregated statistics across all historical swarms.

**Response (200, analytics exist):**
```json
{
  "total_swarms": 15,
  "avg_duration_ms": 120000,
  "...": "..."
}
```

**Response (200, no analytics file):**
```json
{
  "analytics": null
}
```

---

## Queue Endpoints

### List Queue

```
GET /api/queue
```

Returns summary metadata for all queued swarm tasks.

**Response (200):**
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

**Queue item status values:** `"pending"`, `"in_progress"`, `"completed"`, `"error"`

---

### Get Single Queue Item

```
GET /api/queue/:id
```

Returns the full data for a single queue item (initialization, logs, and progress). Same structure as the archive detail endpoint.

| Parameter | Type | Description |
|-----------|------|-------------|
| `:id` | `string` | Queue item identifier |

**Response (200):**
```json
{
  "initialization": { "task": { ... }, "agents": [...], "waves": [...] },
  "logs": { "entries": [...] },
  "progress": { "1.1": { ... }, "1.2": { ... } }
}
```

**Error Responses:**
- `400` -- Invalid queue ID (failed sanitization)
- `404` -- Queue item not found

---

## Error Response Format

All error responses follow this format:

```json
{
  "error": "Human-readable error description"
}
```

Common HTTP status codes:

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created (new dashboard) |
| `204` | No Content (OPTIONS preflight) |
| `400` | Bad Request (invalid parameters) |
| `404` | Not Found (resource doesn't exist) |
| `500` | Internal Server Error (operation failed) |
