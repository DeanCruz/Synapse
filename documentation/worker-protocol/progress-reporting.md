# Progress Reporting

Workers report their own live progress directly to the dashboard via individual progress files. This document is the complete reference for the progress file schema, write triggers, stages, and log formats.

---

## How It Works

```
Worker starts  ->  writes progress file to {tracker_root}/dashboards/{dashboardId}/progress/{id}.json
      |
Worker progresses  ->  overwrites progress file with new stage/status/logs
      |
server.js detects file change  ->  broadcasts SSE "agent_progress" event
      |
Dashboard merges initialization.json + progress files  ->  renders live status
      |
Worker completes  ->  writes final progress file with status "completed"
      |
Master processes return  ->  updates logs.json + task file only (NOT initialization.json)
```

The dashboard server watches the `progress/` directory via `fs.watch` and broadcasts changes to the browser within approximately 50ms. Every progress file write becomes visible on the dashboard almost immediately.

---

## Progress File Location

Each worker owns exactly one file:

```
{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

- `{tracker_root}` — Absolute path to the Synapse repository
- `{dashboardId}` — The dashboard slot (e.g., `dashboard1` through `dashboard5`)
- `{task_id}` — The task identifier (e.g., `1.1`, `2.3`)

All three values are provided in the worker's dispatch prompt.

---

## Progress File Schema

```json
{
  "task_id": "1.1",
  "dashboard_id": "{dashboardId}",
  "status": "in_progress",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "template_version": "p_track_v2",
  "stage": "implementing",
  "message": "Creating auth middleware — 2/3 endpoints done",
  "milestones": [
    { "at": "2026-02-25T14:05:10Z", "msg": "Read CLAUDE.md and task file" },
    { "at": "2026-02-25T14:05:35Z", "msg": "Read existing middleware for patterns" },
    { "at": "2026-02-25T14:06:01Z", "msg": "Created rate limiter for /api/auth" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task — reading context" },
    { "at": "2026-02-25T14:05:10Z", "level": "info", "msg": "Read CLAUDE.md — found auth patterns" },
    { "at": "2026-02-25T14:06:01Z", "level": "info", "msg": "Rate limiter created for /api/auth endpoint" }
  ],
  "files_changed": [
    { "path": "src/middleware/rateLimit.ts", "action": "created" }
  ],
  "prompt_size": {
    "total_chars": 12500,
    "estimated_tokens": 3571
  },
  "shared_context": {
    "exports": [],
    "interfaces": [],
    "patterns": [],
    "notes": ""
  },
  "sibling_reads": [],
  "annotations": {
    "src/middleware/cors.ts": {
      "gotchas": ["CORS middleware must be registered before auth middleware — order matters"],
      "patterns": ["Uses express-cors with allowlist from env variable"]
    }
  }
}
```

### Field Definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `task_id` | `string` | Yes | The task identifier (e.g., `"1.1"`, `"2.3"`). Provided in the dispatch prompt. Never changes after the initial write. |
| `dashboard_id` | `string` | Yes | The dashboard ID (e.g., `"a3f2c1"`). Provided in the dispatch context. Include in every write. The server rejects progress files where `dashboard_id` does not match the dashboard directory. |
| `status` | `string` | Yes | Current lifecycle status. One of: `"in_progress"`, `"completed"`, `"failed"`. See [Status Values](#status-values). |
| `started_at` | `ISO 8601 string \| null` | Yes | Timestamp when the worker began work. Set on the first write. Never changes after being set. |
| `completed_at` | `ISO 8601 string \| null` | Yes | Timestamp when the worker finished. Set only when `status` transitions to `"completed"` or `"failed"`. |
| `summary` | `string \| null` | Yes | One-line summary of what was accomplished. Set on completion. Must be descriptive, not just `"Done"`. |
| `assigned_agent` | `string` | Yes | The worker's agent label (e.g., `"Agent 1"`, `"Agent 5"`). Provided in the dispatch prompt. Never changes. |
| `template_version` | `string \| null` | No | The version identifier from the TEMPLATE_VERSION field in the dispatch prompt. Set on first write. Helps the master identify which prompt template was used. |
| `stage` | `string` | Yes | Current execution stage. One of the fixed stages listed in [Fixed Stages](#fixed-stages). |
| `message` | `string` | Yes | What the worker is doing right now. One line, specific and actionable. Updated frequently. |
| `milestones` | `array` | Yes | Significant accomplishments during execution. Append-only — never remove previous entries. |
| `deviations` | `array` | Yes | Any divergences from the original plan. Append-only — never remove previous entries. See [Deviations](deviations.md). |
| `logs` | `array` | Yes | Detailed log entries for the popup log box in the agent details modal. Append-only. |
| `files_changed` | `array` | Yes (from `implementing` stage onward) | Every file the worker creates, modifies, or deletes. Each entry: `{ "path": "relative/path", "action": "created\|modified\|deleted" }`. Paths are relative to `{project_root}`. Updated incrementally as changes are made. The dashboard renders this as a clickable file list in the task popup. |
| `prompt_size` | `object \| null` | No | Size metrics of the dispatch prompt. Contains `total_chars` (integer) and `estimated_tokens` (integer, calculated as `Math.ceil(totalChars / 3.5)`). |
| `shared_context` | `object \| null` | No | Info this worker makes available to same-wave siblings. Sub-fields: `exports` (array), `interfaces` (array), `patterns` (array), `notes` (string). |
| `sibling_reads` | `array` | No | Array of task ID strings of sibling progress files read. Used by the dashboard for sibling communication lines. |
| `annotations` | `object \| null` | No | Operational knowledge about files the worker read deeply. Keys are relative file paths; values have optional `gotchas`, `patterns`, and `conventions` arrays. See [Annotations](#annotations). |

---

## Status Values

| Status | When to Set | Meaning |
|---|---|---|
| `"in_progress"` | On the first write (when reading context begins) | The worker is actively executing |
| `"completed"` | When the task is done successfully, or when 80%+ of the work is done but a blocker prevents full completion | The task produced useful output |
| `"failed"` | When the task produced zero useful output and cannot be recovered | The task failed entirely |

### Status Transition Rules

- A worker starts as `"in_progress"` and transitions exactly once to either `"completed"` or `"failed"`
- There is no `"pending"` status for workers — pending is represented by the absence of a progress file
- There is no `"blocked"` or `"paused"` status — if a worker cannot proceed, it either adapts or fails

---

## Fixed Stages

Workers progress through these stages in order. Every stage transition requires a progress file write.

| Stage | Description | Typical Activities |
|---|---|---|
| `reading_context` | Reading project files, CLAUDE.md, documentation, task file | Reading dispatch prompt, CLAUDE.md, source files, upstream progress files |
| `planning` | Assessing readiness, planning approach | Verifying all required files exist, planning implementation steps, identifying potential issues |
| `implementing` | Writing code, creating/modifying files | Creating new files, editing existing files, writing functions, components, tests |
| `testing` | Running tests, validating changes | Running unit tests, integration tests, type checking, build validation |
| `finalizing` | Final cleanup, preparing summary report | Reviewing changes, writing final summary, preparing return format |
| `completed` | Task completed successfully | Terminal stage — no further progress writes expected |
| `failed` | Task failed | Terminal stage — no further progress writes expected |

### Stage Progression Rules

- Stages must be traversed **in order** — a worker cannot skip from `reading_context` to `implementing`
- Not every stage needs to be long — `planning` might be a quick assessment, `testing` might be skipped if the task does not involve testable code
- The worker must write the progress file on every stage transition, even if the stage is brief
- `completed` and `failed` are terminal stages — once set, no further stage changes occur

---

## Mandatory Writes

These writes are NON-NEGOTIABLE. Skipping any of them is a failure of the worker protocol.

### 1. Before Starting Work

Write the initial progress file with:
- `status`: `"in_progress"`
- `stage`: `"reading_context"`
- `started_at`: current timestamp
- A log entry saying the task is starting

This must be the **very first action** the worker takes, before reading any project files.

### 2. After Initial Write, If Dependencies Exist

If the task has upstream dependencies:
- Read all upstream dependency progress files (see [Upstream Results](upstream-results.md))
- Log what was found in each upstream file
- If any upstream task failed or has `CRITICAL` deviations, adapt the approach before proceeding

### 3. On Every Stage Transition

When moving to a new stage:
- Update the `stage` field
- Update the `message` field to describe what the worker is now doing
- Add a log entry noting the transition

### 4. On Any Deviation from the Plan

When the worker does anything not specified in the dispatch prompt:
- Add an entry to the `deviations[]` array immediately
- Add a log entry at `level: "deviation"`
- Do not wait until the end of the task to report deviations

See [Deviations](deviations.md) for the full protocol.

### 5. On Any Error

When an error occurs:
- Add a log entry at `level: "error"` with details about what failed and why

### 6. On Every File Change

When creating, modifying, or deleting a project file:
- Add it to `files_changed[]` with `{ "path": "relative/path", "action": "created|modified|deleted" }`
- Add a log entry describing the change
- Do this incrementally as you work -- do NOT wait until finalization
- The dashboard renders this as a clickable file list in the task popup

### 7. On Task Completion

When the task finishes successfully:
- Set `status` to `"completed"`
- Set `stage` to `"completed"`
- Set `completed_at` to the current timestamp
- Write a descriptive `summary` (not just "Done")
- Add a final log entry

### 8. On Task Failure

When the task fails:
- Set `status` to `"failed"`
- Set `stage` to `"failed"`
- Set `completed_at` to the current timestamp
- Write a `summary` describing what went wrong
- Add a log entry at `level: "error"`

---

## Recommended Writes

These are not mandatory but strongly encouraged:

### On Significant Milestones

When the worker accomplishes something notable within a stage:
- Add an entry to the `milestones[]` array
- Add a corresponding log entry

### On Unexpected Findings

When the worker discovers something surprising:
- Add a log entry at `level: "warn"`

### On Starting a New Sub-Operation

When beginning a new piece of work within a stage:
- Update the `message` field to reflect the new sub-operation
- Add a log entry

---

## Writing Progress Files

### Getting Timestamps

Always capture live timestamps using:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Use the output directly. **Never guess, estimate, or construct timestamps from memory.** The dashboard elapsed timer calculates durations from these values — a bad timestamp produces wildly wrong elapsed times.

### Atomic Writes

Write the **full file** every time. The worker is the sole owner of its progress file, so there is no need for read-modify-write. Construct the entire JSON object in memory and write it all at once.

**Always use the Write tool.** The Write tool writes to a temporary file and renames it into place, so the target file is never in a partially-written state. This guarantees atomic writes.

**Do not use shell commands** (`echo`, `cat`, `printf`) to write JSON files. Shell commands do not guarantee atomicity and can produce truncated files if interrupted.

If shell writes are absolutely necessary (e.g., inside a script), use the write-then-rename pattern:

1. Write to `{filePath}.tmp`
2. Rename `{filePath}.tmp` to `{filePath}` (rename is atomic on POSIX and NTFS)

---

## Log Entry Format

Each entry in the `logs[]` array follows this format:

```json
{ "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "What happened" }
```

### Log Levels

| Level | When to Use | Dashboard Display |
|---|---|---|
| `info` | Normal progress, milestones, stage transitions | Purple badge |
| `warn` | Unexpected findings, non-blocking issues | Lime/yellow badge |
| `error` | Failures, blocking issues | Red badge |
| `deviation` | Any divergence from the planned approach | Yellow badge |

### Writing Good Logs

The popup log box is the user's deep-dive view into a worker's task. Logs should tell a clear narrative:

- What the worker read and what it learned from it
- What the worker decided to do and why
- What the worker created or modified
- Any issues encountered and how they were resolved

**Good log examples:**
```json
{ "at": "...", "level": "info", "msg": "Read CLAUDE.md — found JWT auth pattern with express-rate-limit" }
{ "at": "...", "level": "info", "msg": "Created rate limiter — 100 req/15min for /api/auth" }
{ "at": "...", "level": "warn", "msg": "Existing test file uses deprecated assert syntax — adapting new tests to match" }
{ "at": "...", "level": "error", "msg": "Build failed — missing type export from @/types/user" }
```

**Bad log examples:**
```json
{ "at": "...", "level": "info", "msg": "Starting..." }
{ "at": "...", "level": "info", "msg": "Done." }
{ "at": "...", "level": "info", "msg": "Working on it" }
```

---

## Milestone Entry Format

Each entry in the `milestones[]` array:

```json
{ "at": "2026-02-25T14:06:01Z", "msg": "Created rate limiter for /api/auth" }
```

| Field | Type | Description |
|---|---|---|
| `at` | `ISO 8601 string` | Timestamp when the milestone was reached |
| `msg` | `string` | Brief description of what was accomplished |

Milestones are append-only. Never remove or modify previous milestones. They represent a chronological record of the worker's accomplishments.

---

## Dashboard Rendering

The dashboard uses the progress file to render the worker's task card in real-time:

| UI Element | Source Field | Description |
|---|---|---|
| Stage badge | `stage` | Color-coded badge showing the current stage |
| Elapsed time | `started_at` | Live timer counting from when the worker started |
| Current message | `message` | Displayed below the stage badge on the card |
| Deviation badge | `deviations[]` | Yellow "N deviation(s)" badge if deviations exist |
| Popup log box | `logs[]` | Scrollable log box shown when the user clicks the card, with colored level badges |
| Milestone timeline | `milestones[]` | Chronological list of accomplishments in the agent details modal |

---

## Full Lifecycle Example

### Initial Write (before starting work)

```json
{
  "task_id": "1.1",
  "status": "in_progress",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "reading_context",
  "message": "Reading CLAUDE.md and task file",
  "milestones": [],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task — reading context files" }
  ]
}
```

### Mid-Task (during implementation)

```json
{
  "task_id": "1.1",
  "status": "in_progress",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "implementing",
  "message": "Creating auth middleware — rate limiter for /api/auth",
  "milestones": [
    { "at": "2026-02-25T14:05:10Z", "msg": "Read CLAUDE.md — found auth patterns" },
    { "at": "2026-02-25T14:05:35Z", "msg": "Read existing middleware for patterns" },
    { "at": "2026-02-25T14:06:01Z", "msg": "Created rate limiter for /api/auth" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task — reading context files" },
    { "at": "2026-02-25T14:05:10Z", "level": "info", "msg": "Read CLAUDE.md — JWT auth pattern with rate limiting" },
    { "at": "2026-02-25T14:05:35Z", "level": "info", "msg": "Existing middleware uses express-rate-limit pattern" },
    { "at": "2026-02-25T14:06:01Z", "level": "info", "msg": "Created rate limiter — 100 req/15min for /api/auth" }
  ]
}
```

### Final Write (task complete)

```json
{
  "task_id": "1.1",
  "status": "completed",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": "2026-02-25T14:08:30Z",
  "summary": "Created auth middleware with rate limiting — 3 endpoints protected, tests added",
  "assigned_agent": "Agent 1",
  "stage": "completed",
  "message": "Task complete — auth middleware with rate limiting",
  "milestones": [
    { "at": "2026-02-25T14:05:10Z", "msg": "Read CLAUDE.md — found auth patterns" },
    { "at": "2026-02-25T14:05:35Z", "msg": "Read existing middleware for patterns" },
    { "at": "2026-02-25T14:06:01Z", "msg": "Created rate limiter for /api/auth" },
    { "at": "2026-02-25T14:07:15Z", "msg": "Added JWT validation to all protected routes" },
    { "at": "2026-02-25T14:08:00Z", "msg": "Tests passing — 12/12" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task — reading context files" },
    { "at": "2026-02-25T14:05:10Z", "level": "info", "msg": "Read CLAUDE.md — JWT auth pattern with rate limiting" },
    { "at": "2026-02-25T14:05:35Z", "level": "info", "msg": "Existing middleware uses express-rate-limit pattern" },
    { "at": "2026-02-25T14:06:01Z", "level": "info", "msg": "Created rate limiter — 100 req/15min for /api/auth" },
    { "at": "2026-02-25T14:07:15Z", "level": "info", "msg": "JWT validation middleware added to 3 protected routes" },
    { "at": "2026-02-25T14:08:00Z", "level": "info", "msg": "All tests passing — 12/12" },
    { "at": "2026-02-25T14:08:30Z", "level": "info", "msg": "Task complete — auth middleware with rate limiting for 3 endpoints" }
  ]
}
```
