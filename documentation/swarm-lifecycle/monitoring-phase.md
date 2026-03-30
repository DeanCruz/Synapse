# Monitoring Phase

The monitoring phase runs throughout swarm execution, from the moment the first worker is dispatched until the last worker completes or fails. During this phase, workers report live progress via individual progress files, the server broadcasts updates via SSE, the dashboard renders real-time status, the master logs events and processes completions, and the eager dispatch loop keeps the pipeline maximally saturated.

This is not a discrete phase that happens after dispatch -- it runs concurrently with dispatch and continues until the swarm reaches its terminal state.

---

## Phase Overview

```
Workers execute tasks in {project_root}
    |
    v
Workers write progress files to {tracker_root}/dashboards/{dashboardId}/progress/
    |
    v
server.js detects file changes (fs.watch on progress/ directory)
    |
    v
SSE pushes updates to browser in real-time (~30-110ms latency)
    |
    v
Dashboard merges initialization.json + progress files -> renders live status
    |
    v
Master processes worker returns -> logs events -> triggers eager dispatch
    |
    v
Repeat until all tasks reach terminal state
```

---

## Worker Progress Reporting

### Progress File Ownership

Each worker owns exactly one file:

```
{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

The worker writes the **full file** on every update (overwrite, not append). Since each worker is the sole writer of its file, no read-modify-write is needed -- the worker constructs the entire JSON object in memory and writes it all at once.

The Write tool is always used for progress file updates because it writes atomically (write to temp file, rename into place). Shell commands like `echo` or `cat` do not guarantee atomicity and can produce truncated files if interrupted.

### Progress File Schema

```json
{
  "task_id": "2.1",
  "status": "in_progress",
  "started_at": "2026-03-22T14:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 4",
  "stage": "implementing",
  "message": "Creating rate limiter middleware -- 3/4 methods done",
  "milestones": [
    { "at": "2026-03-22T14:05:10Z", "msg": "Read CLAUDE.md and task file" },
    { "at": "2026-03-22T14:05:35Z", "msg": "Read existing middleware for patterns" },
    { "at": "2026-03-22T14:06:01Z", "msg": "Created rate limiter with sliding window" }
  ],
  "deviations": [
    { "at": "2026-03-22T14:06:30Z", "severity": "MODERATE", "description": "Used sliding window instead of fixed window -- matches existing patterns" }
  ],
  "logs": [
    { "at": "2026-03-22T14:05:00Z", "level": "info", "msg": "Starting task -- reading context files" },
    { "at": "2026-03-22T14:05:10Z", "level": "info", "msg": "Read CLAUDE.md -- found middleware patterns" },
    { "at": "2026-03-22T14:06:01Z", "level": "info", "msg": "Rate limiter created with sliding window" },
    { "at": "2026-03-22T14:06:30Z", "level": "deviation", "msg": "Used sliding window instead of fixed window -- matches existing codebase pattern" }
  ]
}
```

### Field Definitions

| Field | Type | Description |
|---|---|---|
| `task_id` | string | The task ID (e.g., `"2.1"`, `"3.4r"` for repair tasks) |
| `status` | string | `"in_progress"`, `"completed"`, or `"failed"` |
| `started_at` | ISO 8601 | Timestamp when work began. Set on first write. Drives the elapsed timer. |
| `completed_at` | ISO 8601 or null | Timestamp when work ended. Set only on terminal status. |
| `summary` | string or null | One-line result summary. Set on completion/failure. Displayed on the card. |
| `assigned_agent` | string | Agent label (e.g., `"Agent 4"`). Displayed on the card. |
| `stage` | string | Current fixed stage. Drives the stage badge color. |
| `message` | string | Current activity description. Displayed on in-progress cards. |
| `milestones` | array | Significant accomplishments. Displayed in the agent detail popup. |
| `deviations` | array | Plan divergences. Drives the yellow deviation badge. |
| `logs` | array | Detailed log entries. Feeds the popup log box in the agent detail modal. |

### Fixed Stages

Workers progress through these stages in order:

```
reading_context -> planning -> implementing -> testing -> finalizing -> completed
                                                                     -> failed
```

| Stage | Description | When |
|---|---|---|
| `reading_context` | Reading project files, documentation, task file | First stage on task start |
| `planning` | Assessing readiness, planning approach | After initial context reads |
| `implementing` | Writing code, creating/modifying files | The main work phase |
| `testing` | Running tests, validating changes | After implementation |
| `finalizing` | Final cleanup, preparing summary report | Before marking complete |
| `completed` | Task completed successfully | Terminal state |
| `failed` | Task failed | Terminal state |

### Mandatory Write Points

Workers must write their progress file at these moments. Skipping any of these is a failure:

1. **Before starting work** -- Initial file with `status: "in_progress"`, `stage: "reading_context"`, initial log entry
2. **After reading upstream dependencies** -- If the task has dependencies, read upstream progress files first; log what was found
3. **On every stage transition** -- Update `stage`, `message`, add a log entry
4. **On any deviation from the plan** -- Add to `deviations[]` and add a log entry at `level: "deviation"` immediately
5. **On any error** -- Add a log entry at `level: "error"` with details
6. **On task completion** -- Set `status: "completed"`, `completed_at`, `summary`, `stage: "completed"`, final log entry
7. **On task failure** -- Set `status: "failed"`, `completed_at`, `summary` (with error description), `stage: "failed"`, error log entry

### Recommended Write Points

- On significant milestones within a stage (add to `milestones[]` and `logs[]`)
- On unexpected findings (log at `level: "warn"`)
- On starting a new sub-operation (update `message` and add a log entry)

### Timestamp Protocol

Every timestamp must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Workers must never guess, estimate, or construct timestamps from memory. The elapsed timer calculates durations from these values -- a bad timestamp shows wildly wrong elapsed times.

---

## Reading Upstream Results (Dependent Workers)

When a worker has upstream dependencies, it must read the progress files of completed dependencies **before** starting implementation. This is mandatory because the dispatch prompt was written during planning, before upstream work was done. The progress files contain the ground truth of what actually happened.

### The Protocol

```
For each dependency listed in the dispatch prompt:
    |
    v
Read {tracker_root}/dashboards/{dashboardId}/progress/{dep_id}.json
    |
    v
Extract: status, summary, deviations[], milestones[], logs[]
    |
    v
Adapt approach based on actual upstream results:
  - If upstream FAILED: assess whether this task can proceed
  - If upstream has CRITICAL deviations: adapt to actual state, not planned state
  - If upstream has MODERATE deviations: note and proceed
  - If upstream logs contain errors: review for downstream impact
    |
    v
Log what was learned:
  "Read upstream dependencies: 1.1 (completed, no deviations),
   1.3 (completed, 1 MODERATE deviation -- used alternative API pattern)"
```

Workers must read upstream progress files in parallel (they have no dependency on each other).

---

## Dashboard Rendering

The dashboard merges two data sources to render the complete UI:

```
initialization.json              progress/*.json
(static plan data)         +     (dynamic lifecycle data)
                           =
                    Live Dashboard View
```

### What Comes from Where

| Data | Source |
|---|---|
| Task ID, title, wave, layer, directory, depends_on | `initialization.json` (agents[]) |
| Status, started_at, completed_at, summary, assigned_agent | `progress/{id}.json` |
| Stage, message, milestones, deviations, logs | `progress/{id}.json` |
| Total tasks, total waves, wave names | `initialization.json` |
| Completed count, failed count, in-progress count | Derived from progress files |
| Pending count | `total_tasks - completed - in_progress - failed` |
| Elapsed time | Derived: earliest `started_at` to latest `completed_at` across all progress files |

### Agent Card Visual States

Each agent card displays differently based on status:

**Pending** (no progress file exists):
- Gray status dot
- "Waiting..." in italic gray
- No elapsed timer

**In Progress** (progress file with `status: "in_progress"`):
- Purple status dot (pulsing animation)
- Stage badge (color-coded)
- Live elapsed timer counting up from `started_at`
- Current `message` displayed below the stage
- Agent label in dim text

**Completed** (progress file with `status: "completed"`):
- Green status dot
- Green left border accent
- Summary text in gray
- Duration badge showing elapsed time (frozen)

**Failed** (progress file with `status: "failed"`):
- Red status dot
- Red left border accent
- Summary text in red

**Deviation badge** (any status): If the progress file contains a non-empty `deviations[]` array, a yellow "N deviation(s)" badge appears on the card. This is driven entirely by the progress file -- the master does not set anything for this to appear.

### Stat Cards

Six stat cards update in real-time:

| Card | Source | Color | Notes |
|---|---|---|---|
| **Total** | `task.total_tasks` from initialization.json | White | Static |
| **Completed** | Count of progress files with `status === "completed"` | Green (#34d399) | Live |
| **In Progress** | Count of progress files with `status === "in_progress"` | Purple (#9b7cf0) | Live |
| **Failed** | Count of progress files with `status === "failed"` | Red (#ef4444) when > 0 | Live |
| **Pending** | `total - completed - in_progress - failed` | Dim gray | Derived |
| **Elapsed** | Earliest worker `started_at` to latest worker `completed_at` | Purple while running | Ticking live |

The elapsed timer starts automatically when the first worker writes a progress file with a `started_at` value. It freezes when every worker has a `completed_at` set. The master does not set these values -- workers write them in their progress files.

### Progress Bar

```
Fill width = (count of progress files with status "completed") / task.total_tasks * 100%
```

The progress bar shows overall swarm completion as a percentage. Set `total_tasks` accurately in `initialization.json` -- the dashboard uses it as the denominator.

---

## SSE Event Flow

The server watches dashboard files and broadcasts changes via Server-Sent Events (SSE). The broadcast mechanism (`SSEManager.js`) maintains a map of connected SSE clients, each optionally filtered to a specific dashboard ID. When a file change is detected, the server reads the file, validates it, and pushes the update to all applicable clients as a JSON payload.

### Timing Constants

All timing values are defined in `src/server/utils/constants.js`:

| Constant | Value | Purpose |
|---|---|---|
| `INIT_POLL_MS` | 100ms | `fs.watchFile` polling interval for `initialization.json` and `logs.json` |
| `PROGRESS_READ_DELAY_MS` | 30ms | Initial delay before reading a changed progress file (lets the write settle) |
| `PROGRESS_RETRY_MS` | 80ms | Retry delay if the progress file JSON is malformed on first read (mid-write) |
| `RECONCILE_DEBOUNCE_MS` | 300ms | Debounce interval for the dashboards directory watcher |
| `RECONCILE_INTERVAL_MS` | 5000ms | Periodic reconciliation scan interval (catches missed `fs.watch` events) |
| `HEARTBEAT_MS` | 15000ms | SSE heartbeat ping interval to keep connections alive |
| `DEPENDENCY_CHECK_DELAY_MS` | 100ms | Delay after task completion before checking for newly unblocked tasks |

### How File Watching Works

The server uses two different file watching strategies depending on the file type:

- **`initialization.json` and `logs.json`** -- Watched via `fs.watchFile` with a polling interval of `INIT_POLL_MS` (100ms). The callback fires when `mtimeMs` changes. The file is read synchronously via `readJSON()` and validated against its schema (`isValidInitialization` or `isValidLogs`). If valid, the data is broadcast as an `initialization` or `logs` SSE event.

- **`progress/` directory** -- Watched via `fs.watch` (OS-level event notification, not polling). When a `.json` file changes, the server waits `PROGRESS_READ_DELAY_MS` (30ms) for the write to settle, then reads the file using `readJSONWithRetry()` which retries after `PROGRESS_RETRY_MS` (80ms) if the JSON is malformed. This means progress updates reach the browser within approximately 30--110ms depending on whether a retry is needed. Before broadcast, the file is validated by `isValidProgress()` which checks that `task_id` matches the filename.

### Progress File Validation (validateAndBroadcast)

The `WatcherService.js` `validateAndBroadcast` function enforces two hard guards before broadcasting any progress update:

1. **task_id must match filename** -- A progress file at `progress/2.1.json` must contain `"task_id": "2.1"`. Mismatches are hard-rejected and a `write_rejected` SSE event is broadcast with `reason: "task_id_mismatch"`.

2. **dashboard_id must match directory** -- If the progress file contains a `dashboard_id` field, it must match the dashboard directory the file is in. Mismatches are hard-rejected with `reason: "dashboard_id_mismatch"`.

Files missing the `dashboard_id` field are accepted with a console warning (backwards compatibility with older format files). Only after passing both guards is the data broadcast as an `agent_progress` SSE event.

### SSE Event Types

```
File System                    Server                    Browser
===========                    ======                    =======

progress/1.1.json changes  -> fs.watch triggers       -> SSE: agent_progress
                               30ms delay + read          dashboard re-renders
                               validate + broadcast       card 1.1 updates

initialization.json changes -> fs.watchFile triggers   -> SSE: initialization
                               (100ms polling)            full re-render
                               read + broadcast

logs.json changes           -> fs.watchFile triggers   -> SSE: logs
                               (100ms polling)            log panel updates
                               read + broadcast
```

Additional SSE events:

| Event | Trigger | Payload |
|---|---|---|
| `dashboards_list` | Client connects | List of all dashboard IDs |
| `dashboards_changed` | Dashboard directory changes (debounced 300ms) | Updated list of dashboard IDs |
| `all_progress` | Client connects | All progress files for a dashboard |
| `init_state` | Client connects (reconnection catch-up) | Combined initialization + progress + logs |
| `tasks_unblocked` | Task completes and unblocks dependents | Completed task ID + list of newly dispatchable tasks |
| `write_rejected` | Progress file fails validation | Rejection reason, expected vs actual values |
| `queue_changed` | Queue directory changes (debounced 300ms) | Updated queue summaries |

### SSE Heartbeat

The server sends a `: ping\n\n` comment to all connected SSE clients every `HEARTBEAT_MS` (15 seconds) to keep connections alive. Destroyed or ended connections are automatically cleaned up during heartbeat iteration.

### Periodic Reconciliation

OS-level `fs.watch` can occasionally miss events (especially under high write load or on certain platforms). To guarantee eventual consistency, the server runs a periodic reconciliation scan every `RECONCILE_INTERVAL_MS` (5 seconds).

The reconciliation (`reconcileProgressFiles`) works by:
1. Listing all `.json` files in each watched dashboard's `progress/` directory
2. Comparing each file's `mtimeMs` against the last known value
3. If the mtime is newer (or the file is new), reading and broadcasting the progress data
4. Cleaning up stale entries for deleted progress files

This ensures that even if `fs.watch` drops an event, the dashboard will be up to date within at most 5 seconds.

### Dashboard Directory Reconciliation

The server also watches the top-level `dashboards/` directory via `fs.watch`. When new dashboard subdirectories appear or existing ones are removed, the change is debounced with `RECONCILE_DEBOUNCE_MS` (300ms), then `reconcileDashboards()` starts watchers for new dashboards and stops watchers for removed ones. A `dashboards_changed` SSE event is broadcast with the updated list.

### Queue Directory Watcher

The `queue/` directory is watched with `fs.watch` (recursive mode). Changes are debounced with `RECONCILE_DEBOUNCE_MS` (300ms), after which the server reads all queue summaries and broadcasts a `queue_changed` SSE event.

### Automatic Dependency Alerts

When a progress file changes to `status: "completed"`, the server provides proactive dependency tracking:

1. `fs.watch` detects the completion via the progress directory watcher
2. After `DEPENDENCY_CHECK_DELAY_MS` (100ms) -- to let file writes settle -- the server calls `DependencyService.computeNewlyUnblocked(dashboardId, completedTaskId)`
3. `computeNewlyUnblocked` performs a targeted scan: it only examines tasks whose `depends_on` array includes the completed task ID (not a full scan of all tasks)
4. For each candidate, it checks whether ALL dependencies are now completed and the task has no progress file yet (still pending)
5. If any tasks become newly dispatchable, the server broadcasts a `tasks_unblocked` SSE event:

```json
{
  "dashboardId": "540931",
  "completedTaskId": "1.1",
  "unblocked": [
    {
      "id": "2.1",
      "title": "Add auth middleware",
      "wave": 2,
      "depends_on": ["1.1"],
      "dependency_status": { "1.1": "completed" }
    }
  ]
}
```

The dashboard displays a green toast notification showing which tasks are ready for dispatch. This server-side dependency tracking is a complement to the master's manual eager dispatch scan, not a replacement -- both mechanisms operate independently to maximize responsiveness.

### SSE Client Connection

When a client connects to `/events`, the server sends an initial burst of data:
1. `dashboards_list` -- All known dashboard IDs
2. `initialization` -- Plan data for each dashboard (or the filtered dashboard)
3. `all_progress` -- All existing progress files per dashboard
4. `init_state` -- Combined initialization + progress + logs for reconnection catch-up
5. `queue_changed` -- Current queue state (if non-empty)

Clients can optionally filter to a single dashboard by passing `?dashboard={id}` as a query parameter. Filtered clients only receive events with a matching `dashboardId` (plus global events like `dashboards_list` and `queue_changed`).

---

## Deviation Handling

Deviations are plan divergences -- any case where a worker does something different from what the master planned. They are expected in complex tasks, but they must be visible so the master and user can assess impact.

### What Counts as a Deviation

The rule is simple: if someone diffed the worker's changes against the task description, would they find anything not mentioned? If yes, it is a deviation.

| Situation | Severity | Example |
|---|---|---|
| Modified a file not in the FILES list | MODERATE | Modified helpers.ts to add a missing export required for compilation |
| Used a different API/library method | MODERATE | Used `fs.promises.readFile` instead of `fs.readFileSync` to match codebase patterns |
| Added validation not specified in the task | MINOR | Added input validation for empty strings to prevent runtime errors |
| Changed a function signature | CRITICAL | Changed `createUser(name, email)` to `createUser(userData: CreateUserInput)` |
| Created a helper file not in the plan | MODERATE | Created `src/utils/sanitize.ts` to extract shared logic |
| Skipped a planned step | MODERATE | Skipped migration -- schema already had the required column |
| Fixed a pre-existing bug while implementing | MINOR | Fixed off-by-one error in existing pagination logic |

### Deviation Severity Levels

| Severity | Meaning | Master Action |
|---|---|---|
| **CRITICAL** | Changes an API, interface, or contract that downstream tasks depend on. May block other agents. | Re-plan downstream tasks; inject actual state into UPSTREAM RESULTS |
| **MODERATE** | Different approach or implementation than planned, but produces the same outcome. Does not affect downstream. | Note for review; log at `"deviation"` level |
| **MINOR** | Cosmetic or naming differences with no functional impact. | Ignore |

### Deviation Reporting Flow

```
Worker discovers deviation during implementation
    |
    v
Worker writes to progress file IMMEDIATELY:
  deviations[]: { at, severity, description }
  logs[]: { at, level: "deviation", msg }
    |
    v
Dashboard detects progress file change via fs.watch
  -> Yellow "N deviation(s)" badge appears on agent card
    |
    v
Worker includes deviation in final return to master
  (DIVERGENT ACTIONS section of return format)
    |
    v
Master processes return, logs deviation to logs.json at level "deviation"
    |
    v
Log panel shows deviation entry with yellow badge
  -> User can filter to see only deviations via the Deviation filter button
```

### CRITICAL Deviation Impact

When a worker reports a CRITICAL deviation, the master must assess downstream impact before dispatching dependent tasks:

1. Identify all tasks that depend on the deviating task
2. Check whether the deviation changes any interface, export, function signature, or file path that downstream tasks expect
3. If downstream tasks need to adapt, update their prompts at dispatch time via the UPSTREAM RESULTS section to reflect the actual state (not the planned state)

---

## Master Event Logging

The master logs events to `{tracker_root}/dashboards/{dashboardId}/logs.json` throughout execution. Each entry becomes a row in the dashboard log panel.

### Log Entry Schema

```json
{
  "timestamp": "2026-03-22T14:33:05Z",
  "task_id": "1.1",
  "agent": "Agent 1",
  "level": "info",
  "message": "Completed: Create rate limiter middleware -- 4 endpoints protected",
  "task_name": "add-rate-limiting"
}
```

### Log Levels

| Level | When Used | Dashboard Display | Purpose |
|---|---|---|---|
| `info` | Normal events (dispatch, completion, milestones) | Purple badge | Routine progress |
| `warn` | Unexpected findings, non-blocking issues | Lime/yellow badge | Attention needed |
| `error` | Failures, blocking issues | Red badge | Action required |
| `debug` | Verbose details (rarely used) | Gray/dim badge | Deep troubleshooting |
| `permission` | Master needs user input | Amber badge + modal popup | Bridges dashboard to terminal |
| `deviation` | Plan divergence reported by worker | Yellow badge | Visibility into plan changes |

### Standard Event Log Patterns

| Event | task_id | agent | level | Message Pattern |
|---|---|---|---|---|
| Task initialized | `"0.0"` | `"Orchestrator"` | `info` | "Task initialized: N tasks across W waves -- Type: Waves" |
| Wave dispatched | `"0.0"` | `"Orchestrator"` | `info` | "Dispatching Wave N: M agents -- {wave name}" |
| Agent dispatched | `"{id}"` | `"Agent N"` | `info` | "Dispatched: {task title}" |
| Agent completed | `"{id}"` | `"Agent N"` | `info` | "Completed: {title} -- {summary}" |
| Agent warned | `"{id}"` | `"Agent N"` | `warn` | "WARN: {unexpected finding}" |
| Agent deviated | `"{id}"` | `"Agent N"` | `deviation` | "DEVIATION: {what changed and why}" |
| Agent failed | `"{id}"` | `"Agent N"` | `error` | "FAILED: {title} -- {error reason}" |
| Repair dispatched | `"0.0"` | `"Orchestrator"` | `info` | "Dispatching repair task {id} for failed {id} -- {reason}" |
| Eager dispatch | `"0.0"` | `"Orchestrator"` | `info` | "Dependency scan: dispatching N newly available tasks -- {task IDs}" |
| Permission request | `"0.0"` | `"Orchestrator"` | `permission` | "{What you need and why}" |
| Swarm complete | `"0.0"` | `"Orchestrator"` | `info` | "Swarm complete: N/M tasks succeeded in {duration}" |

### The Permission Request Popup

When the master needs user input (e.g., circuit breaker triggered, major deviation requires guidance), it must write a `"permission"` log entry **before** asking in the terminal. This two-step protocol ensures the user never misses a permission request:

1. Write the log entry to `logs.json` (triggers the dashboard popup)
2. Only then ask in the terminal

```json
{
  "timestamp": "2026-03-22T14:45:00Z",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "permission",
  "message": "Need permission to delete 3 files in src/old/. Respond in terminal.",
  "task_name": "add-rate-limiting"
}
```

The dashboard immediately shows an amber modal popup with the message. The user sees it and responds in their terminal. After the user responds and the master resumes, it writes a normal `"info"` log entry confirming what was decided.

---

## Worker Popup Log Box

When a user clicks an agent card on the dashboard, a detail modal opens. This modal includes a **popup log box** that renders the worker's `logs[]` array from its progress file.

Good worker logs tell a narrative -- what was read, what was learned, what was decided, what was created, and what issues were encountered. Bad worker logs are just "Starting..." / "Done." and provide no insight.

### Example Worker Log Timeline

```
14:05:00  [info]       Starting task -- reading context files
14:05:10  [info]       Read CLAUDE.md -- found middleware pattern with express-rate-limit
14:05:35  [info]       Existing middleware uses factory function pattern
14:06:01  [info]       Created rate limiter with sliding window algorithm
14:06:30  [deviation]  Used sliding window instead of fixed window -- matches existing codebase
14:07:15  [info]       Registered middleware in src/app.ts before route handlers
14:07:45  [warn]       Found hardcoded rate limit in legacy endpoint -- left unchanged per scope
14:08:00  [info]       All tests passing -- 12/12
14:08:30  [info]       Task complete -- rate limiter middleware with 4 endpoints protected
```

The log box renders each entry with a colored level badge and chronological ordering. Users can scroll through the full narrative of the worker's execution.

---

## What the Master Does NOT Do During Monitoring

To preserve context and maintain its orchestrator perspective, the master avoids certain activities:

- **Does NOT output terminal status tables.** The dashboard is the primary channel. Terminal output is limited to one-line confirmations per event (e.g., "Agent 5 completed: {summary}").
- **Does NOT update `initialization.json`.** Workers handle all lifecycle data in their progress files. The dashboard derives stats from progress files.
- **Does NOT write to progress files.** Workers own their progress files exclusively. The master reads them for the eager dispatch scan.
- **Does NOT maintain counters.** No `completed_tasks`, `failed_tasks`, or `overall_status` fields to update. The dashboard derives everything.
- **Does NOT write code.** If something needs fixing, it creates a repair task and dispatches a worker.

---

## Monitoring Handoff to Completion

The monitoring phase transitions to the completion phase when one of these conditions is met:

1. **All tasks have terminal status** -- Every progress file shows `"completed"` or `"failed"`
2. **All remaining tasks are blocked** -- Some tasks failed, and every remaining pending task depends (directly or transitively) on a failed task
3. **Circuit breaker triggered** -- Cascading failures pause the swarm for replanning (see [Circuit Breaker](./circuit-breaker.md))

At this point, the master proceeds to compile the final report.

---

## Related Documentation

- [Overview](./overview.md) -- End-to-end swarm lifecycle summary
- [Planning Phase](./planning-phase.md) -- Context gathering and task decomposition
- [Dispatch Phase](./dispatch-phase.md) -- Worker dispatch mechanics and eager dispatch protocol
- [Completion Phase](./completion-phase.md) -- Final report, verification, and archiving
- [Circuit Breaker](./circuit-breaker.md) -- Automatic replanning on cascading failures
