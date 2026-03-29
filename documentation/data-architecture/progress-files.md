# Progress Files -- Schema Reference

Progress files are the **dynamic lifecycle store** for individual worker agents in a Synapse swarm. Each worker owns exactly one progress file and writes it exclusively -- no other process modifies it. The dashboard watches the `progress/` directory and merges progress data with static plan data from `initialization.json` to render live agent cards, derive stats, and display real-time stage/milestone updates.

**Location:** `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`

**Owner:** The individual worker agent assigned to that task (sole writer)

---

## Write Rules

### Sole Writer, Full File Overwrite

Each worker is the **sole writer** of its progress file. No read-modify-write is needed because there are no other writers. On every update, the worker constructs the complete JSON object in memory and writes the entire file.

The Write tool provides atomic writes (write to temp file, then rename). This ensures the server never reads a partially-written file.

### Mandatory Write Points

Workers **must** write their progress file at these moments (skipping any is a failure):

| Moment | What to Set |
|---|---|
| **Before starting work** | `status: "in_progress"`, `started_at`, `assigned_agent`, `stage: "reading_context"`, initial log entry |
| **After reading upstream dependencies** (if any) | Log what was found; adapt approach if upstream deviated |
| **On every stage transition** | Update `stage`, `message`, add log entry |
| **On any deviation from the plan** | Add to `deviations[]`, add log entry at `level: "deviation"` |
| **On any error** | Add log entry at `level: "error"` |
| **On task completion** | `status: "completed"`, `stage: "completed"`, `completed_at`, `summary`, final log entry |
| **On task failure** | `status: "failed"`, `stage: "failed"`, `completed_at`, `summary` (error description), error log entry |

### Recommended Write Points

| Moment | What to Update |
|---|---|
| Significant milestones within a stage | Append to `milestones[]` and `logs[]` |
| Unexpected findings | Log entry at `level: "warn"` |
| Starting a new sub-operation | Update `message`, add log entry |

### Timestamps

Always capture live timestamps:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Never guess or construct timestamps from memory. The dashboard derives elapsed time from these values -- a bad timestamp shows wildly wrong durations.

---

## Complete Schema

```json
{
  "task_id": "string",
  "dashboard_id": "string",
  "status": "string",
  "started_at": "ISO 8601 string | null",
  "completed_at": "ISO 8601 string | null",
  "summary": "string | null",
  "assigned_agent": "string",
  "template_version": "string | null",
  "stage": "string",
  "message": "string",
  "milestones": [
    { "at": "ISO 8601 string", "msg": "string" }
  ],
  "deviations": [
    { "at": "ISO 8601 string", "severity": "string", "description": "string" }
  ],
  "logs": [
    { "at": "ISO 8601 string", "level": "string", "msg": "string" }
  ],
  "files_changed": [
    { "action": "created | modified | deleted", "path": "string (relative to project root)" }
  ],
  "prompt_size": {
    "total_chars": "number",
    "estimated_tokens": "number"
  },
  "shared_context": {
    "exports": ["string"],
    "interfaces": ["string"],
    "patterns": ["string"],
    "notes": "string"
  },
  "sibling_reads": ["string (task ID)"],
  "annotations": {
    "{relative_file_path}": {
      "gotchas": ["string"],
      "patterns": ["string"],
      "conventions": ["string"]
    }
  }
}
```

---

## Field Definitions

### Core Fields

| Field | Type | Set When | Description |
|---|---|---|---|
| `task_id` | string | First write | Task identifier matching `agents[].id` in `initialization.json` (e.g., `"1.1"`, `"2.3"`). |
| `dashboard_id` | string | First write | Dashboard identifier this task belongs to (e.g., `"a3f2c1"`). Must match the dashboard directory the progress file resides in. The server rejects progress files where `dashboard_id` does not match the directory — this enforces dashboard-agent binding. Optional for backwards compatibility (old files without it are accepted with a warning). |
| `status` | string | Updated throughout | Current lifecycle status. See **Status Values** below. |
| `started_at` | ISO 8601 or null | First write | Timestamp when work began. Drives the per-card elapsed timer and the swarm-level elapsed stat (earliest across all workers). |
| `completed_at` | ISO 8601 or null | Completion/failure | Timestamp when work finished. Must be `null` when `status` is `"in_progress"`. Freezes the per-card timer. The swarm elapsed timer freezes when all workers have `completed_at` set. |
| `summary` | string or null | Completion/failure | One-line summary of what was accomplished. Shown directly on the completed/failed card. Must be descriptive -- `"Created auth middleware with rate limiting -- 3 endpoints"`, not `"Done"`. |
| `assigned_agent` | string | First write | Agent label (e.g., `"Agent 1"`, `"Agent 8"`). Shown as dim text on the card's meta row. |
| `template_version` | string or null | First write | The TEMPLATE_VERSION value from the worker's dispatch prompt (e.g., `"p_track_v2"`, `"2.0"`). Helps the master agent identify which prompt template was used. |
| `stage` | string | Updated throughout | Current execution stage. See **Fixed Stages** below. |
| `message` | string | Updated throughout | What the worker is doing right now -- one line, specific and actionable. Shown on in-progress cards below the stage badge. |

### Array Fields

| Field | Type | Description |
|---|---|---|
| `milestones` | array of `{ at, msg }` | Significant accomplishments during execution. Append-only. Shown in the agent details popup timeline. |
| `deviations` | array of `{ at, severity, description }` | Any divergences from the original plan. Append-only. Drives the yellow deviation badge on the card. |
| `logs` | array of `{ at, level, msg }` | Detailed log entries. Append-only. Feeds the popup log box in the agent details modal. |
| `files_changed` | array of `{ action, path }` | Files created, modified, or deleted during the task. Required from `implementing` stage onward. Workers should populate this incrementally as they work -- add each file as it is changed, not just at the end. The dashboard renders this as a clickable file list in the task popup. |
| `prompt_size` | object or null | Optional. Size metrics of the dispatch prompt received. Contains `total_chars` (integer) and `estimated_tokens` (integer, calculated as `Math.ceil(total_chars / 3.5)`). Helps the master agent calibrate future prompt budgets. |
| `shared_context` | object or null | Optional. Information this worker makes available to same-wave siblings. Sub-fields: `exports` (array of export names), `interfaces` (array of interface signatures), `patterns` (array of pattern descriptions), `notes` (free-form string). Should be populated early when creating exports or interfaces siblings might use. |
| `sibling_reads` | array of strings | Optional. Array of task ID strings of sibling progress files the worker has read. Used by the dashboard for sibling communication visualization. |
| `annotations` | object or null | Operational knowledge about files the worker READ during execution. Optional. Keys are relative file paths; values are objects with optional `gotchas`, `patterns`, and `conventions` arrays (all arrays of strings). Workers populate this during `reading_context` and `implementing` stages as they gain deep understanding of source files. The master merges these into the PKI after task completion. |

---

## Status Values

| Status | When to Set | Dashboard Effect |
|---|---|---|
| `"in_progress"` | First write (when starting to read context) | Purple dot, pulsing border, stage badge + elapsed timer shown |
| `"completed"` | Task finished successfully | Green dot, green border, summary + duration shown |
| `"failed"` | Task failed and cannot be recovered | Red dot, red border, summary shown in red |

**Note on partial completion:** If a worker completes 80%+ of the task but hits a blocker on the remaining work, it should set `status: "completed"` (not `"failed"`), write a clear summary stating what was accomplished and what remains blocked, and add a deviation entry describing the blocker. Reserve `"failed"` for cases where the task produced **zero useful output**.

---

## Fixed Stages

Workers progress through these stages in order:

| Stage | Description | Dashboard Badge Color |
|---|---|---|
| `reading_context` | Reading project files, CLAUDE.md, documentation, task file, upstream progress files | -- |
| `planning` | Assessing readiness, planning approach, analyzing upstream deviations | -- |
| `implementing` | Writing code, creating/modifying files | -- |
| `testing` | Running tests, validating changes | -- |
| `finalizing` | Final cleanup, preparing summary report | -- |
| `completed` | Task completed successfully | Green |
| `failed` | Task failed | Red |

The dashboard renders a color-coded stage badge on in-progress cards, showing the current stage name.

---

## Milestone Entry Format

```json
{ "at": "2026-03-22T07:03:27Z", "msg": "Located all 4 context_cache references in CLAUDE.md and AGENTS.md" }
```

| Field | Type | Description |
|---|---|---|
| `at` | ISO 8601 string | When the milestone was reached. Live timestamp. |
| `msg` | string | What was accomplished. Be specific: include counts, file names, and outcomes. |

Milestones are shown in the agent details popup as a timeline of accomplishments.

---

## Deviation Entry Format

```json
{ "at": "2026-03-22T07:13:20Z", "severity": "MINOR", "description": "Also updated Step 15A in p_track.md to reference EXPORTS -- not in original task but necessary for consistency" }
```

| Field | Type | Description |
|---|---|---|
| `at` | ISO 8601 string | When the deviation occurred. Live timestamp. |
| `severity` | string | Impact level: `"CRITICAL"`, `"MODERATE"`, or `"MINOR"`. See table below. |
| `description` | string | What changed from the plan and why. |

### Deviation Severity Levels

| Severity | Meaning | Impact | Example |
|---|---|---|---|
| `CRITICAL` | Changes an API, interface, or contract that downstream tasks depend on | May block other agents; master may re-plan downstream | Changed a function signature that other tasks import |
| `MODERATE` | Different approach or implementation than planned, but same outcome | Does not affect downstream tasks; noted for review | Used a different library method to achieve the same result |
| `MINOR` | Cosmetic or naming differences with no functional impact | No impact | Renamed a variable for clarity |

The master uses severity to decide how to proceed:
- `CRITICAL` -- may trigger re-planning of downstream tasks
- `MODERATE` -- noted in the master's log for review
- `MINOR` -- acknowledged and ignored

### What Counts as a Deviation

A deviation is **anything the worker did that was not explicitly specified in the dispatch prompt**. Common examples:

| What Happened | Typical Severity |
|---|---|
| Modified a file not listed in the task's FILES section | MODERATE |
| Used a different API/library method than suggested | MODERATE |
| Added error handling or validation not specified | MINOR |
| Changed a function signature (parameters, return type) | CRITICAL |
| Created a helper function or utility not in the plan | MODERATE |
| Skipped a step from the task description | MODERATE |
| Discovered and fixed a pre-existing bug while implementing | MINOR |

**The rule:** If someone diffed the worker's changes against the task description, would they find anything not mentioned? If yes, it is a deviation. Report it.

---

## Log Entry Format

```json
{ "at": "2026-03-22T07:03:04Z", "level": "info", "msg": "Starting task -- reading context files to locate all context_cache.json references" }
```

| Field | Type | Description |
|---|---|---|
| `at` | ISO 8601 string | When the event occurred. Live timestamp. |
| `level` | string | Event severity. See table below. |
| `msg` | string | What happened. Tell a clear story. |

### Worker Log Levels

| Level | When to Use | Badge Color in Popup |
|---|---|---|
| `"info"` | Normal progress, milestones, stage transitions | Purple |
| `"warn"` | Unexpected findings, non-blocking issues | Lime/yellow |
| `"error"` | Failures, blocking issues | Red |
| `"deviation"` | Any divergence from planned approach | Yellow |

Worker logs feed the popup log box in the agent details modal. They should tell a coherent narrative: what the worker read, what it learned, what it decided, what it built, and any issues encountered.

**Good logs tell a narrative. Bad logs are just "Starting..." / "Done."**

---

## files_changed Entry Format

```json
{ "action": "modified", "path": "src/models/User.ts" }
```

| Field | Type | Description |
|---|---|---|
| `action` | string | One of: `"created"`, `"modified"`, `"deleted"`. |
| `path` | string | File path relative to the project root. |

Workers should populate `files_changed` during their **final progress write** -- when `status` transitions to `"completed"`. This field provides a machine-readable record of every file the worker touched, complementing the human-readable `FILES CHANGED` section in the worker's return format.

### Example

```json
"files_changed": [
  { "action": "created", "path": "src/models/User.ts" },
  { "action": "modified", "path": "src/models/index.ts" },
  { "action": "deleted", "path": "src/old/Legacy.ts" }
]
```

---

## Annotations Entry Format

```json
"annotations": {
  "src/auth/login.ts": {
    "gotchas": ["Refresh token rotation: old token must be invalidated before issuing new one"],
    "patterns": ["Uses asyncHandler wrapper for all async routes"],
    "conventions": ["Error shape: { error: string, code: number }"]
  },
  "src/models/User.ts": {
    "gotchas": ["findByEmail returns null not undefined when not found"]
  }
}
```

The `annotations` field is an object keyed by relative file path. Each entry can contain any combination of the following sub-fields:

| Sub-field | Type | Description |
|---|---|---|
| `gotchas` | array of strings | Non-obvious behaviors, edge cases, or foot-guns a developer should know before modifying this file. |
| `patterns` | array of strings | Design or coding patterns used in this file (e.g., "singleton service", "async handler wrapper"). |
| `conventions` | array of strings | Project-specific conventions this file follows (e.g., "error shape: { error: string, code: number }"). |

All sub-fields are optional -- include only what was discovered. An entry with just `gotchas` is valid.

### What to Annotate

Workers annotate files they **read and understood deeply** during task execution -- not files they changed (those are tracked in `files_changed`). Good candidates are files studied to understand an API or data flow, files with non-obvious edge cases, or files whose patterns the worker followed in its own implementation.

### When to Annotate

Workers should populate `annotations` during the **`reading_context`** and **`implementing`** stages as they gain operational understanding of source files. The field can be updated incrementally across progress writes.

### Alignment with PKI

The `gotchas`, `patterns`, and `conventions` sub-fields match the corresponding fields in the PKI per-file annotation schema (see `documentation/data-architecture/pki-schemas.md`). The progress file `annotations` field is a lightweight subset -- the master merges these into the full per-file annotation structure after task completion.

---

## Dashboard Rendering

### Agent Card (In-Progress State)

When a worker is active, the card shows:

- **Stage badge**: Color-coded badge with the current stage name
- **Elapsed time**: Live timer calculated from `started_at`
- **Message**: The worker's current `message` field (below the stage badge)
- **Left border**: Purple, pulsing animation

### Agent Card (Completed State)

- **Summary text**: Gray text showing the `summary` field
- **Duration badge**: Calculated as `completed_at - started_at` (e.g., `"1m 3s"`)
- **Left border**: Green

### Agent Card (Failed State)

- **Summary text**: Red text showing the `summary` field (with error description)
- **Left border**: Red

### Deviation Badge

If `deviations[]` is non-empty, a yellow "N deviation(s)" badge appears on the card regardless of status. This is driven entirely by the progress file data.

### Agent Details Popup

When the user clicks an agent card, a modal shows:

- **Full milestone timeline**: All entries from `milestones[]` in chronological order
- **Full deviation list**: All entries from `deviations[]` with severity badges
- **Popup log box**: Scrollable log showing all entries from `logs[]` with color-coded level badges

### Stats Derivation

The dashboard derives all stat card values from progress files:

| Stat | How Derived |
|---|---|
| Completed | Count of progress files where `status === "completed"` |
| In Progress | Count of progress files where `status === "in_progress"` |
| Failed | Count of progress files where `status === "failed"` |
| Pending | `total_tasks - completed - in_progress - failed` |
| Elapsed start | `Math.min(...)` of all worker `started_at` values |
| Elapsed end | `Math.max(...)` of all worker `completed_at` values (freezes when all done) |

### Overall Status Derivation

| Condition | Derived Status |
|---|---|
| All agents completed or failed, with failures | `"completed_with_errors"` |
| All agents completed, no failures | `"completed"` |
| Any agent in_progress or completed (not all done) | `"in_progress"` |
| No agents started | `"pending"` |

---

## Server Handling

### File Watching

The server watches the `progress/` directory using `fs.watch` (OS-level events). When a file changes:

1. Wait `PROGRESS_READ_DELAY_MS` (30ms) to let the write settle
2. Read and parse the file
3. If parse fails (file mid-write), retry after `PROGRESS_RETRY_MS` (80ms)
4. Validate schema using `isValidProgress()` in `src/server/utils/json.js`
5. Check `task_id` matches filename — reject with `write_rejected` SSE event if mismatch
6. Check `dashboard_id` matches directory — reject with `write_rejected` SSE event if mismatch
7. Warn if `dashboard_id` is missing (backwards compatibility — file still accepted)
8. Broadcast `agent_progress` SSE event to all connected clients

### Validation (isValidProgress)

The server validates every progress file read:

| Rule | Detail |
|---|---|
| `task_id` | Required, must be a string. Must match the filename (e.g., `task_id: "1.1"` in `1.1.json`). Mismatches are rejected with a `write_rejected` SSE event. |
| `dashboard_id` | Optional, but if present must be a non-empty string matching the dashboard directory. Mismatches trigger hard rejection + `write_rejected` SSE event. Missing values are accepted with a warning (backwards compatibility). |
| `status` | Required, must be one of: `"in_progress"`, `"completed"`, `"failed"` |
| `stage` | Optional, but if present must be one of: `"reading_context"`, `"planning"`, `"implementing"`, `"testing"`, `"finalizing"`, `"completed"`, `"failed"` |
| `started_at` | Optional, but if present must be a string |
| `completed_at` | Must be null/undefined when `status` is `"in_progress"` |
| `milestones` | Optional, but if present must be an array |
| `deviations` | Optional, but if present must be an array |
| `logs` | Optional, but if present must be an array |

Fields like `stage`, `started_at`, `milestones`, etc. are validated **if present** but not required to exist. This handles initial writes where the worker may not have all fields populated yet.

**Note:** Fields such as `files_changed`, `annotations`, `template_version`, `prompt_size`, `shared_context`, and `sibling_reads` are not validated by `isValidProgress()` -- they are passed through to the dashboard without server-side schema checks. Workers are responsible for populating them correctly per the worker protocol.

### Reconciliation

A periodic reconciliation scan (every `RECONCILE_INTERVAL_MS` = 5000ms, debounced at `RECONCILE_DEBOUNCE_MS` = 300ms) re-reads all progress files to catch any changes that OS-level watchers might miss.

### Dependency Tracking

When a progress file changes to `status: "completed"`, the server runs a dependency check (after `DEPENDENCY_CHECK_DELAY_MS` = 100ms):

1. Identifies tasks that depend on the completed task
2. Checks if all dependencies for those tasks are now satisfied
3. Broadcasts a `tasks_unblocked` SSE event listing newly dispatchable tasks
4. The dashboard shows a green toast notification for unblocked tasks

---

## Progress File Lifecycle Example

### 1. Initial Write (Before Starting Work)

```json
{
  "task_id": "1.1",
  "dashboard_id": "{dashboardId}",
  "status": "in_progress",
  "started_at": "2026-03-22T07:03:04Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "reading_context",
  "message": "Reading CLAUDE.md and task file",
  "milestones": [],
  "deviations": [],
  "logs": [
    { "at": "2026-03-22T07:03:04Z", "level": "info", "msg": "Starting task -- reading context files to locate all context_cache.json references" }
  ]
}
```

### 2. Mid-Task (During Implementation)

```json
{
  "task_id": "1.1",
  "dashboard_id": "{dashboardId}",
  "status": "in_progress",
  "started_at": "2026-03-22T07:03:04Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "implementing",
  "message": "Removing all 4 context_cache references from CLAUDE.md and AGENTS.md",
  "milestones": [
    { "at": "2026-03-22T07:03:27Z", "msg": "Located all 4 context_cache.json references: CLAUDE.md lines 208, 604; AGENTS.md lines 196, 585" },
    { "at": "2026-03-22T07:03:49Z", "msg": "Removed all 4 references -- table rows deleted, tree entries updated" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-03-22T07:03:04Z", "level": "info", "msg": "Starting task -- reading context files to locate all context_cache.json references" },
    { "at": "2026-03-22T07:03:27Z", "level": "info", "msg": "Confirmed 4 locations: CLAUDE.md table row (line 208), CLAUDE.md tree entry (line 604), AGENTS.md table row (line 196), AGENTS.md tree entry (line 585)" },
    { "at": "2026-03-22T07:03:27Z", "level": "info", "msg": "Moving to implementing -- removing all 4 references" },
    { "at": "2026-03-22T07:03:49Z", "level": "info", "msg": "All 4 edits complete -- moving to verification" }
  ]
}
```

### 3. Final Write (Task Complete)

```json
{
  "task_id": "1.1",
  "dashboard_id": "{dashboardId}",
  "status": "completed",
  "started_at": "2026-03-22T07:03:04Z",
  "completed_at": "2026-03-22T07:04:19Z",
  "summary": "Removed all 4 context_cache.json references from CLAUDE.md and AGENTS.md -- table rows deleted, directory tree entries removed with correct connectors",
  "assigned_agent": "Agent 1",
  "stage": "completed",
  "message": "Task complete -- zero context_cache references remain in CLAUDE.md and AGENTS.md",
  "milestones": [
    { "at": "2026-03-22T07:03:27Z", "msg": "Located all 4 context_cache.json references: CLAUDE.md lines 208, 604; AGENTS.md lines 196, 585" },
    { "at": "2026-03-22T07:03:49Z", "msg": "Removed all 4 references -- table rows deleted, tree entries updated with correct connector" },
    { "at": "2026-03-22T07:04:19Z", "msg": "Verified: grep returns zero matches for context_cache in CLAUDE.md and AGENTS.md" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-03-22T07:03:04Z", "level": "info", "msg": "Starting task -- reading context files to locate all context_cache.json references" },
    { "at": "2026-03-22T07:03:27Z", "level": "info", "msg": "Confirmed 4 locations: CLAUDE.md table row (line 208), CLAUDE.md tree entry (line 604), AGENTS.md table row (line 196), AGENTS.md tree entry (line 585)" },
    { "at": "2026-03-22T07:03:27Z", "level": "info", "msg": "Moving to implementing -- removing all 4 references" },
    { "at": "2026-03-22T07:03:49Z", "level": "info", "msg": "All 4 edits complete -- moving to verification" },
    { "at": "2026-03-22T07:04:19Z", "level": "info", "msg": "Verification passed: zero context_cache matches; table formatting correct; tree connectors correct" },
    { "at": "2026-03-22T07:04:19Z", "level": "info", "msg": "Task complete" }
  ],
  "files_changed": [
    { "action": "modified", "path": "CLAUDE.md" },
    { "action": "modified", "path": "AGENTS.md" }
  ],
  "annotations": {
    "src/server/services/WatcherService.js": {
      "gotchas": ["fs.watch fires twice on some OS -- debounce with 30ms delay required"],
      "patterns": ["Singleton service instantiated once in index.js and shared across route handlers"]
    }
  }
}
```

### 4. Example with Deviations

From task 3.1 (a real worker that deviated from its plan):

```json
{
  "task_id": "3.1",
  "dashboard_id": "{dashboardId}",
  "status": "completed",
  "started_at": "2026-03-22T07:12:11Z",
  "completed_at": "2026-03-22T07:13:32Z",
  "summary": "Added EXPORTS section to worker return format in p_track.md, p.md, and tracker_worker_instructions.md",
  "assigned_agent": "Agent 10",
  "stage": "completed",
  "message": "Task complete -- EXPORTS field added to all three files",
  "milestones": [
    { "at": "2026-03-22T07:12:42Z", "msg": "Read all three target files -- identified exact insertion points" },
    { "at": "2026-03-22T07:13:05Z", "msg": "Added EXPORTS section to p_track.md return format (Step 14) with 3 examples" },
    { "at": "2026-03-22T07:13:10Z", "msg": "Added EXPORTS section to p.md return format (Step 8)" },
    { "at": "2026-03-22T07:13:15Z", "msg": "Added Return Format -- EXPORTS Field section to tracker_worker_instructions.md" },
    { "at": "2026-03-22T07:13:20Z", "msg": "Updated p_track.md Step 15A parse instruction and Step 15D cache to reference EXPORTS" },
    { "at": "2026-03-22T07:13:32Z", "msg": "Verified all edits -- all insertion points correct" }
  ],
  "deviations": [
    { "at": "2026-03-22T07:13:20Z", "severity": "MINOR", "description": "Also updated Step 15A (parse instruction) and Step 15D (cache section) in p_track.md to reference the new EXPORTS field -- not in the original task description but necessary for consistency in the master's processing flow" }
  ],
  "logs": [
    { "at": "2026-03-22T07:12:11Z", "level": "info", "msg": "Starting task -- reading context files" },
    { "at": "2026-03-22T07:12:42Z", "level": "info", "msg": "Read p_track.md, p.md, worker instructions. All insertion points identified." },
    { "at": "2026-03-22T07:13:05Z", "level": "info", "msg": "Inserted EXPORTS section in p_track.md between FILES CHANGED and DIVERGENT ACTIONS" },
    { "at": "2026-03-22T07:13:10Z", "level": "info", "msg": "Inserted EXPORTS section in p.md between FILES CHANGED and WARNINGS" },
    { "at": "2026-03-22T07:13:15Z", "level": "info", "msg": "Added new 'Return Format -- EXPORTS Field' section at end of tracker_worker_instructions.md" },
    { "at": "2026-03-22T07:13:20Z", "level": "deviation", "msg": "Updated Step 15A parse instruction to include EXPORTS -- necessary for end-to-end consistency" },
    { "at": "2026-03-22T07:13:32Z", "level": "info", "msg": "All edits verified -- task complete" }
  ]
}
```

Note the deviation entry at severity `"MINOR"` and the corresponding `"deviation"` level log entry. The dashboard would show a yellow deviation badge on this card.

---

## Reading Upstream Results

When a worker has dependencies (listed in `depends_on`), it **must read the progress files of all upstream dependencies** before starting implementation:

```
{tracker_root}/dashboards/{dashboardId}/progress/{dependency_task_id}.json
```

From each upstream file, the worker extracts:

| Field | What to Look For |
|---|---|
| `status` | Did it complete or fail? If failed, assess whether this task can proceed. |
| `summary` | What was accomplished -- the definitive one-line result. |
| `deviations[]` | Especially `CRITICAL` severity -- these may change assumptions about interfaces or APIs. |
| `milestones[]` | What was actually built. Cross-reference with what the dispatch prompt expects. |
| `logs[]` | Scan for `"error"` and `"warn"` entries that may affect this task. |

After reading, the worker logs a summary of what it found and adapts its approach if upstream tasks deviated.

---

## Clearing Progress Files

When a new swarm starts on a dashboard, the master must:

1. **Archive the existing dashboard** (copy to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`)
2. **Delete all files in `progress/`** to clear stale data
3. Write the new `initialization.json`
4. Workers create fresh progress files as they start

Stale progress files from a previous swarm will cause incorrect stat derivation and confusing card states.

---

## Related Documentation

- [Data Architecture Overview](./overview.md) -- High-level data model and ownership
- [initialization.json Schema](./initialization-json.md) -- Static plan data (the other half of the merge)
- [logs.json Schema](./logs-json.md) -- Event log format
- [Task Files](./xml-task-files.md) -- Authoritative task record
