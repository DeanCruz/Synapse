# logs.json -- Schema Reference

`logs.json` is the **timestamped event log** for each dashboard. It records orchestration events: task initialization, dispatches, completions, failures, deviations, and permission requests. Every entry becomes a row in the dashboard's log panel.

**Location:** `{tracker_root}/dashboards/{dashboardId}/logs.json`

**Owner:** Master agent (orchestrator). Workers do not write to this file -- they write to their own `progress/{task_id}.json` `logs[]` array instead.

---

## Write Rules

### Append-Only via Read-Modify-Write

The master appends entries to `logs.json` by reading the full file, parsing it, pushing new entries to the `entries[]` array, and writing the entire file back. This is a read-modify-write pattern, not a raw file append.

**Atomic writes are mandatory.** Always:
1. Read the full file
2. Parse JSON
3. Push new entry/entries to the `entries[]` array in memory
4. Stringify with 2-space indent
5. Write the complete file

Never write partial JSON. An invalid file silently stops log panel updates.

### Timestamps

Every entry must have a real timestamp captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Never guess, estimate, or hardcode timestamps. The log panel displays timestamps as `HH:MM:SS` using JavaScript's `new Date()` parsing.

---

## Complete Schema

```json
{
  "entries": [
    {
      "timestamp": "ISO 8601 string",
      "task_id": "string",
      "agent": "string",
      "level": "string",
      "message": "string",
      "task_name": "string"
    }
  ]
}
```

---

## Field Definitions

### Entry Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `timestamp` | ISO 8601 string | Yes | When the event occurred. Displayed as `HH:MM:SS` in the log panel. Must be captured live via `date -u +"%Y-%m-%dT%H:%M:%SZ"`. |
| `task_id` | string | Yes | Which task this event relates to. Use `"0.0"` for orchestrator-level events. Use `"{wave}.{index}"` (e.g., `"2.3"`) for per-agent events. For agent chat events, use a unique identifier like `"_claude_{timestamp}"`. |
| `agent` | string | Yes | Who triggered the event. Use `"Orchestrator"` for master agent events. Use `"Agent N"` (e.g., `"Agent 1"`) for worker events. Use `"agent-chat"` for Synapse chat-initiated events. |
| `level` | string | Yes | Event severity/category. See **Event Levels** below. |
| `message` | string | Yes | Full message text describing the event. Begin with an action verb. Include result metadata for completions. No length limit in the UI. |
| `task_name` | string | Yes | Copy from `task.name` in `initialization.json`. Ties the log entry to the active swarm. Use `"Agent Chat"` for chat-initiated events. |

---

## Event Levels

| Level | Badge Color | Purpose | When to Use |
|---|---|---|---|
| `"info"` | Purple | Normal orchestration events | Initialization, dispatches, completions, dependency scans |
| `"warn"` | Lime/yellow | Unexpected but non-blocking | Unexpected findings, partial completions, non-critical issues |
| `"error"` | Red | Failures and blocking issues | Task failures, critical errors |
| `"debug"` | Gray/dim | Verbose diagnostic | Rarely used in production; detailed internal state |
| `"permission"` | Amber | User interaction required | Triggers a popup modal on the dashboard instructing the user to check their terminal |
| `"deviation"` | Yellow | Plan divergence | When a worker reports doing something different from the planned approach |

### Level Selection Guidelines

- **`"info"`** for the normal flow: init, dispatch, complete, dependency scan results
- **`"deviation"`** (not `"warn"`) when a worker diverges from the plan -- this is filterable in the log panel
- **`"error"`** only for actual failures (task failed, critical errors), not just unexpected findings
- **`"permission"`** sparingly -- every `"permission"` entry triggers a modal popup on the dashboard
- **`"warn"`** for non-blocking issues that aren't deviations (e.g., a worker discovered a pre-existing issue)
- **`"debug"`** only if explicitly needed for troubleshooting; not for normal operation

The log panel provides filter buttons (All, Info, Warn, Error, Deviation) so users can isolate events by level. Too many `"info"` entries bury important warnings. Log at the right level.

---

## Standard Event Patterns

The master writes log entries at these specific moments during a swarm:

### Swarm Lifecycle Events

| Moment | `task_id` | `agent` | `level` | Message Pattern |
|---|---|---|---|---|
| Task initialized | `"0.0"` | `"Orchestrator"` | `"info"` | `"Task initialized: {N} tasks across {W} waves -- {brief plan description}"` |
| Swarm complete | `"0.0"` | `"Orchestrator"` | `"info"` | `"Swarm complete: {completed}/{total} tasks succeeded -- {failed} failed, {deviations} deviations"` |

### Dispatch Events

| Moment | `task_id` | `agent` | `level` | Message Pattern |
|---|---|---|---|---|
| Wave dispatched | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dispatching Wave {N}: {M} agents -- {wave name} ({task IDs})"` |
| Eager dispatch (after completion) | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dependency scan: dispatching {N} newly available tasks -- {task IDs}"` |
| Repair task created | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dispatching repair task {repair_id} for failed task {failed_id} -- {brief reason}"` |

### Agent Events

| Moment | `task_id` | `agent` | `level` | Message Pattern |
|---|---|---|---|---|
| Agent starts | `"{wave}.{idx}"` | `"Agent N"` | `"info"` | `"Starting: {task title}"` |
| Agent completes | `"{wave}.{idx}"` | `"Agent N"` | `"info"` | `"Completed: {task title} -- {result detail}"` |
| Agent warns | `"{wave}.{idx}"` | `"Agent N"` | `"warn"` | `"WARN: {what was unexpected}"` |
| Agent deviates | `"{wave}.{idx}"` | `"Agent N"` | `"deviation"` | `"DEVIATION: {what changed and why}"` |
| Agent fails | `"{wave}.{idx}"` | `"Agent N"` | `"error"` | `"FAILED: {task title} -- {error reason}"` |

### User Interaction Events

| Moment | `task_id` | `agent` | `level` | Message Pattern |
|---|---|---|---|---|
| Permission request | `"0.0"` | `"Orchestrator"` | `"permission"` | `"{What you need and why}"` |
| Permission resolved | `"0.0"` | `"Orchestrator"` | `"info"` | `"Permission granted/denied: {what was decided}"` |

---

## Dashboard Rendering

### Log Panel

The log panel is a collapsible bottom drawer showing all log entries:

```
  ^ Logs (47 entries)  [Complete]
  +-----------------------------------------------------------------------+
  | [All] [Info] [Warn] [Error] [Deviation]                               |
  | 06:54:01  0.0  Orchestrator  [info ]      Task initialized: 12 tasks  |
  | 07:02:30  1.1  Agent 1       [info ]      Starting: Remove refs       |
  | 07:06:46  1.1  Agent 1       [info ]      Completed: Remove refs --   |
  | 07:16:28  3.1  Agent 10      [deviation]  DEVIATION: Also updated     |
  +-----------------------------------------------------------------------+
```

| UI Element | Source | Notes |
|---|---|---|
| Toggle button text | `"Logs ({entries.length} entries)"` | Entry count from `entries[]` array |
| Complete badge (green pill) | Appears when progress file terminal count equals `total_tasks` and no in-progress | Derived from progress files, not from logs |
| Timestamp column | `entry.timestamp` | Displayed as `HH:MM:SS` via `new Date()` parsing |
| Task ID badge | `entry.task_id` | Color-coded badge |
| Agent label | `entry.agent` | Text label |
| Level badge | `entry.level` | Color matches event level table above |
| Message text | `entry.message` | Full text, no length limit |
| Level filter buttons | Filters `entries[]` by `level` | All, Info, Warn, Error, Deviation |
| Auto-scroll | Scrolls to bottom on new entries | Disabled if user has manually scrolled up |

### Permission Popup

When a `"permission"` level entry is written to `logs.json`, the dashboard shows an amber modal popup:

- Displays the `message` field verbatim inside the popup
- Instructs the user to respond in their terminal
- Each new `"permission"` entry triggers a fresh popup
- The popup is dismissible

**Mandatory sequence:**
1. Write the `"permission"` entry to `logs.json` first (triggers the dashboard popup)
2. Wait for the write to complete
3. Only then ask the question in the terminal

Skipping step 1 means the user never sees the popup. Writing the log entry and terminal question simultaneously causes the popup to arrive late.

---

## Real Example

From a completed swarm on dashboard `71894a`:

```json
{
  "entries": [
    {
      "timestamp": "2026-03-22T06:54:18Z",
      "task_id": "0.0",
      "agent": "Orchestrator",
      "level": "info",
      "message": "Task initialized: 12 tasks across 3 waves -- Synapse backlog phase1a (docs cleanup), phase1b (prompt templates), phase1c (server validation)",
      "task_name": "synapse-backlog-phase1"
    },
    {
      "timestamp": "2026-03-22T07:02:30Z",
      "task_id": "0.0",
      "agent": "Orchestrator",
      "level": "info",
      "message": "Dispatching Wave 1: 6 agents -- Foundation (1.1, 1.2, 1.3, 1.4, 1.5, 1.6)",
      "task_name": "synapse-backlog-phase1"
    },
    {
      "timestamp": "2026-03-22T07:06:46Z",
      "task_id": "1.1",
      "agent": "Agent 1",
      "level": "info",
      "message": "Completed: Remove context_cache.json references -- Removed all 4 references from CLAUDE.md and AGENTS.md",
      "task_name": "synapse-backlog-phase1"
    },
    {
      "timestamp": "2026-03-22T07:06:46Z",
      "task_id": "0.0",
      "agent": "Orchestrator",
      "level": "info",
      "message": "Dependency scan: dispatching 3 newly available tasks -- 2.1, 2.2, 2.3",
      "task_name": "synapse-backlog-phase1"
    },
    {
      "timestamp": "2026-03-22T07:16:28Z",
      "task_id": "3.1",
      "agent": "Agent 10",
      "level": "deviation",
      "message": "DEVIATION: Also updated Step 15A and 15D in p_track.md to reference EXPORTS in the parse/cache instructions -- necessary for end-to-end processing of the new field",
      "task_name": "synapse-backlog-phase1"
    },
    {
      "timestamp": "2026-03-22T07:16:28Z",
      "task_id": "0.0",
      "agent": "Orchestrator",
      "level": "info",
      "message": "Swarm complete: 12/12 tasks succeeded -- 0 failed, 2 deviations (both beneficial)",
      "task_name": "synapse-backlog-phase1"
    }
  ]
}
```

---

## Empty State

When no events have been logged:

```json
{
  "entries": []
}
```

This is the default defined in `src/server/utils/constants.js`:

```javascript
const DEFAULT_LOGS = { entries: [] };
```

---

## Validation

The server validates `logs.json` on every read using `isValidLogs()` in `src/server/utils/json.js`:

- Data must be an object
- `data.entries` must be an array

Invalid files are silently rejected and not broadcast to the dashboard.

---

## Distinction: logs.json vs Progress File logs[]

Synapse has two distinct "log" systems that serve different purposes and appear in different UI locations:

| Aspect | `logs.json` (Event Log) | `progress/{id}.json` `logs[]` (Worker Log) |
|---|---|---|
| **Scope** | Entire swarm | Single task |
| **Owner** | Master agent | Worker agent |
| **UI Location** | Log panel (collapsible bottom drawer) | Popup log box (agent detail modal) |
| **Content** | Orchestration events: dispatch, complete, fail, deviate | Worker's internal narrative: what I read, decided, built |
| **Level values** | `info`, `warn`, `error`, `debug`, `permission`, `deviation` | `info`, `warn`, `error`, `deviation` |
| **Write pattern** | Read-modify-write (append to entries[]) | Full file overwrite (worker is sole writer) |
| **Entry format** | `{ timestamp, task_id, agent, level, message, task_name }` | `{ at, level, msg }` |

The master writes to `logs.json`. Workers write to their `progress/{id}.json` `logs[]` array. These are independent data stores that feed different dashboard panels. A single event (like a deviation) may appear in both: the worker logs it in its progress file, and the master also logs it in `logs.json` when processing the worker's return.

---

## Related Documentation

- [Data Architecture Overview](./overview.md) -- High-level data model and ownership
- [initialization.json Schema](./initialization-json.md) -- Static plan data
- [Progress Files Schema](./progress-files.md) -- Worker progress lifecycle including worker logs
- [Task Files](./xml-task-files.md) -- Authoritative task record
