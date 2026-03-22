Harden Synapse's Node.js server against invalid data and path traversal attacks. The target project is Synapse itself at {tracker_root} = /Users/dean/Desktop/Working/Repos/Synapse (also {project_root} for this swarm).

The server at `src/server/` currently has minimal input validation. The `dashboardId` parameter is used directly in `path.join()` without sanitization, the `isValidProgress()` and `isValidInitialization()` validators only check that a couple of fields exist, and the SSE watcher broadcasts data without validating it against the full schema. This swarm adds defense-in-depth validation at three layers: route input, data parsing, and SSE broadcast.

IMPORTANT: This is a zero-dependency Node.js server. Do NOT introduce any npm packages. All validation must be implemented with plain JavaScript.

---

TASK 1: Add path parameter sanitization to apiRoutes.js

The `parseDashboardRoute()` function at `src/server/routes/apiRoutes.js` (line 34) extracts the `dashboardId` from URL paths like `/api/dashboards/:dashboardId/initialization`. This `id` value is passed directly to `getDashboardDir(id)` which calls `path.join(DASHBOARDS_DIR, id)` (in `src/server/services/DashboardService.js` line 13). A malicious `dashboardId` like `../../../etc` would resolve outside the dashboards directory.

Similarly, the archive route (line 194) extracts an archive name from the URL path and joins it to `ARCHIVE_DIR`, and the queue route (line 378) extracts a queue ID.

Fix: Create a validation function and apply it to all routes that use path parameters.

Add a `sanitizePathParam(param)` function near the top of `apiRoutes.js` (after the imports, before `sendJSON`):

```javascript
/**
 * Validate a path parameter (dashboard ID, archive name, queue ID).
 * Rejects values containing path traversal sequences or disallowed characters.
 * Returns the sanitized value, or null if invalid.
 */
function sanitizePathParam(param) {
  if (typeof param !== 'string' || param.length === 0 || param.length > 100) return null;
  // Reject path traversal and disallowed characters
  if (/[.]{2}|[/\\]/.test(param)) return null;
  // Allow only alphanumeric, hyphens, underscores, and single dots
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.\-]*$/.test(param)) return null;
  return param;
}
```

Apply this validation to:

1. **Dashboard routes** — In the `parseDashboardRoute()` function (line 34), after extracting `match[1]`, validate it with `sanitizePathParam()`. If it fails, return `null` (which causes the caller to fall through as "not handled," resulting in a 404). Alternatively, add an explicit 400 response in `handleApiRoute()` where `route` is checked (line 235) — if `route.id` fails sanitization, respond with `sendJSON(res, 400, { error: 'Invalid dashboard ID' })`.

2. **Archive routes** — The archive name extracted at line 194 (`archiveRoute[1]`). Validate before using in `path.join(ARCHIVE_DIR, name)`. Return 400 if invalid.

3. **Queue routes** — The queue ID extracted at line 378 (`queueRoute[1]`). Validate before passing to `getQueueDir(queueId)`. Return 400 if invalid.

File to modify: `/Users/dean/Desktop/Working/Repos/Synapse/src/server/routes/apiRoutes.js`

Verify by confirming:
- Valid dashboard IDs like `dashboard1`, `dashboard5` still work
- Valid archive names like `2026-03-21_my-task` still work
- IDs containing `..` return 400
- IDs containing `/` or `\` return 400
- Empty IDs return 400

Success criteria: All path parameters are validated before being used in `path.join()`. Path traversal attempts (`../`, `..\\`, `....`) return HTTP 400 with a descriptive error message. All existing valid IDs (alphanumeric with hyphens, underscores, and dots) continue to work. The sanitization function is defined once and reused across all three route groups.

---

TASK 2: Expand `isValidProgress()` in json.js

The current `isValidProgress()` function at `src/server/utils/json.js` (lines 58-63) only checks that `task_id` is a string and `status` is a string. It does not validate the status value, the stage, timestamps, or array fields. This means malformed progress data (wrong status value, invalid stage, non-array milestones) passes validation and gets broadcast to the dashboard.

Fix: Expand `isValidProgress()` to validate the full progress file schema. Replace the function body (lines 58-63) with:

```javascript
function isValidProgress(data) {
  if (!data || typeof data !== 'object') return false;

  // Required string fields
  if (typeof data.task_id !== 'string' || data.task_id.length === 0) return false;
  if (typeof data.status !== 'string') return false;

  // Status must be one of the valid values
  const VALID_STATUSES = ['in_progress', 'completed', 'failed'];
  if (!VALID_STATUSES.includes(data.status)) return false;

  // Stage validation (if present)
  if (data.stage !== undefined && data.stage !== null) {
    const VALID_STAGES = ['reading_context', 'planning', 'implementing', 'testing', 'finalizing', 'completed', 'failed'];
    if (typeof data.stage !== 'string' || !VALID_STAGES.includes(data.stage)) return false;
  }

  // Timestamp validation (if present, must be string or null)
  if (data.started_at !== undefined && data.started_at !== null && typeof data.started_at !== 'string') return false;
  if (data.completed_at !== undefined && data.completed_at !== null && typeof data.completed_at !== 'string') return false;

  // completed_at should be null when status is in_progress
  if (data.status === 'in_progress' && data.completed_at !== undefined && data.completed_at !== null) return false;

  // Array fields (if present, must be arrays)
  if (data.milestones !== undefined && !Array.isArray(data.milestones)) return false;
  if (data.deviations !== undefined && !Array.isArray(data.deviations)) return false;
  if (data.logs !== undefined && !Array.isArray(data.logs)) return false;

  return true;
}
```

Key design decisions:
- Fields like `stage`, `started_at`, `milestones`, etc. are validated IF present, but not required to exist — this handles the initial write where not all fields are set yet.
- `status` and `task_id` are always required (they are the minimum viable progress file).
- `completed_at` must be null/undefined when status is `in_progress` — prevents inconsistent state.
- No ISO 8601 format validation on timestamps — that would be too strict and could reject valid data from different timezone formats.

File to modify: `/Users/dean/Desktop/Working/Repos/Synapse/src/server/utils/json.js`

Test with these scenarios mentally:
- Minimal valid: `{ "task_id": "1.1", "status": "in_progress" }` -> passes
- Full valid: `{ "task_id": "1.1", "status": "completed", "stage": "completed", "started_at": "...", "completed_at": "...", "milestones": [], "deviations": [], "logs": [] }` -> passes
- Bad status: `{ "task_id": "1.1", "status": "running" }` -> fails
- Bad stage: `{ "task_id": "1.1", "status": "in_progress", "stage": "coding" }` -> fails
- in_progress with completed_at: `{ "task_id": "1.1", "status": "in_progress", "completed_at": "2026-..." }` -> fails
- Non-array milestones: `{ "task_id": "1.1", "status": "in_progress", "milestones": "done" }` -> fails

Success criteria: `isValidProgress()` validates status against the 3 allowed values, stage against the 7 allowed values, timestamp types, the in_progress/completed_at constraint, and array field types. All existing valid progress files in any dashboard continue to pass. Invalid data is rejected with the function returning false.

---

TASK 3: Expand `isValidInitialization()` in json.js

The current `isValidInitialization()` at `src/server/utils/json.js` (lines 49-56) only checks that `data.task` exists (or is null) and `data.agents` is an array. It does not validate the shape of `task`, the contents of `agents`, or the `waves` array.

Fix: Expand `isValidInitialization()` to validate the full initialization schema. Replace the function body (lines 49-56) with:

```javascript
function isValidInitialization(data) {
  if (!data || typeof data !== 'object') return false;

  // task must be null (empty dashboard) or an object
  if (!('task' in data)) return false;
  if (data.task !== null && typeof data.task !== 'object') return false;

  // agents must be an array
  if (!Array.isArray(data.agents)) return false;

  // If task is not null, validate required task fields
  if (data.task !== null) {
    if (typeof data.task.name !== 'string' || data.task.name.length === 0) return false;
    if (typeof data.task.type !== 'string') return false;

    // type must be Waves or Chains
    const VALID_TYPES = ['Waves', 'Chains'];
    if (!VALID_TYPES.includes(data.task.type)) return false;

    // total_tasks and total_waves should be numbers if present
    if (data.task.total_tasks !== undefined && typeof data.task.total_tasks !== 'number' && typeof data.task.total_tasks !== 'string') return false;
    if (data.task.total_waves !== undefined && typeof data.task.total_waves !== 'number' && typeof data.task.total_waves !== 'string') return false;
  }

  // Validate agents array entries (if non-empty, each must have id and title)
  for (const agent of data.agents) {
    if (!agent || typeof agent !== 'object') return false;
    if (typeof agent.id !== 'string' || agent.id.length === 0) return false;
    if (typeof agent.title !== 'string' || agent.title.length === 0) return false;
  }

  // Validate waves array (if present)
  if (data.waves !== undefined) {
    if (!Array.isArray(data.waves)) return false;
    for (const wave of data.waves) {
      if (!wave || typeof wave !== 'object') return false;
      // wave.id can be number or string (both are used in practice)
      if (wave.id === undefined || wave.id === null) return false;
      if (typeof wave.name !== 'string' || wave.name.length === 0) return false;
    }
  }

  return true;
}
```

Key design decisions:
- `task: null` remains valid — this is the empty/cleared dashboard state, used by `DEFAULT_INITIALIZATION`.
- `total_tasks` and `total_waves` accept both number and string because the master agent sometimes writes them as strings (e.g., `"6"` instead of `6`).
- Agent entries must have `id` and `title` — these are the minimum fields needed for dashboard rendering.
- Waves are optional (for backwards compatibility) but if present, each must have `id` and `name`.
- The `chains` array is not validated beyond existence — it's optional and only used in Chains mode.

File to modify: `/Users/dean/Desktop/Working/Repos/Synapse/src/server/utils/json.js`

Test scenarios:
- Empty dashboard: `{ "task": null, "agents": [], "waves": [], "chains": [], "history": [] }` -> passes
- Valid full: `{ "task": { "name": "test", "type": "Waves", "total_tasks": 4, "total_waves": 2 }, "agents": [{ "id": "1.1", "title": "Test" }], "waves": [{ "id": 1, "name": "Wave 1", "total": 2 }] }` -> passes
- Missing task.name: `{ "task": { "type": "Waves" }, "agents": [] }` -> fails
- Bad type: `{ "task": { "name": "test", "type": "Grid" }, "agents": [] }` -> fails
- Agent without id: `{ "task": null, "agents": [{ "title": "Test" }] }` -> fails

Success criteria: `isValidInitialization()` validates task field requirements (name, type when non-null), type against allowed values, agent entry structure, and wave entry structure. The empty dashboard state (`task: null`) still passes. All existing valid initialization.json files in any dashboard continue to pass.

---

TASK 4: Add validation to SSE broadcast in WatcherService.js

The `WatcherService.js` at `src/server/services/WatcherService.js` already calls `isValidProgress()` (line 67) and `isValidInitialization()` (line 42) before broadcasting. However, with the expanded validators from Tasks 2 and 3, the error handling should be improved to provide actionable log messages when validation fails.

Currently, when validation fails:
- For initialization (line 44): logs `Invalid initialization.json schema in ${id}` but gives no detail about what failed
- For progress (line 69): logs `Invalid progress schema in ${id}/${filename}` but gives no detail
- For logs.json (line 53): no validation at all — broadcasts raw data without any schema check

Fix:

1. **Add a `isValidLogs()` function** to `src/server/utils/json.js`. It should validate the logs.json schema:

```javascript
function isValidLogs(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.entries)) return false;
  return true;
}
```

Export it alongside the existing functions.

2. **Apply logs validation in WatcherService.js** — In the logs.json watcher callback (around line 53), add validation before broadcasting:

Currently:
```javascript
const data = readJSON(logsFile);
if (data) broadcastFn('logs', { dashboardId: id, ...data });
```

Change to:
```javascript
const data = readJSON(logsFile);
if (data && isValidLogs(data)) {
  broadcastFn('logs', { dashboardId: id, ...data });
} else if (data) {
  console.error(`[watcher] Invalid logs.json schema in ${id}`);
}
```

Update the import at the top of WatcherService.js (line 11) to include `isValidLogs`:
```javascript
const { readJSON, readJSONWithRetry, isValidInitialization, isValidProgress, isValidLogs } = require('../utils/json');
```

3. **Improve error logging for initialization and progress validation failures** — When `isValidInitialization()` or `isValidProgress()` fails, the current error messages don't help diagnose the problem. Add more context:

For initialization (line 44-46):
```javascript
if (data && isValidInitialization(data)) {
  broadcastFn('initialization', { dashboardId: id, ...data });
} else if (data) {
  console.error(`[watcher] Invalid initialization.json schema in ${id} — task: ${typeof data.task}, agents: ${Array.isArray(data.agents) ? data.agents.length + ' items' : typeof data.agents}`);
}
```

For progress (line 67-70):
```javascript
if (data && isValidProgress(data)) {
  broadcastFn('agent_progress', { dashboardId: id, ...data });
} else if (data) {
  console.error(`[watcher] Invalid progress schema in ${id}/${filename} — task_id: ${data.task_id || 'missing'}, status: ${data.status || 'missing'}, stage: ${data.stage || 'missing'}`);
}
```

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/src/server/utils/json.js` — Add `isValidLogs()` function and export it
- `/Users/dean/Desktop/Working/Repos/Synapse/src/server/services/WatcherService.js` — Import `isValidLogs`, add logs validation, improve error logging for all three validation failure paths

Success criteria: SSE never broadcasts invalid JSON data (initialization, progress, or logs). Validation failures produce console error messages that include enough detail to diagnose the problem (field names and types). The `isValidLogs()` function validates the logs.json schema. All existing valid data continues to pass validation and broadcast normally. The WatcherService imports are updated to include the new function.
