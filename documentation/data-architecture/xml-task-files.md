# Task Files -- Reference

> **Note on filename:** This file is named `xml-task-files.md` for historical reasons. Task files are **JSON**, not XML. The filename has been retained to avoid breaking internal documentation links.

Task files are the **authoritative master record** for each swarm. They contain the complete plan -- task descriptions, context, critical instructions, file lists, dependencies, statuses, and completion summaries. Every worker reads the task file for context about the overall swarm and its specific task. The master updates it on every agent completion.

**Location:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{name}.json`

**Companion file:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{name}.md` (strategy rationale document)

**Owner:** Master agent (orchestrator)

---

## Purpose and Relationship to Other Data

The task file serves a different purpose from the dashboard data files:

| File | Purpose | Audience |
|---|---|---|
| `initialization.json` | Drive the dashboard UI (static plan) | Dashboard rendering engine |
| `progress/{id}.json` | Live worker lifecycle data | Dashboard rendering engine, master dispatch scans |
| `logs.json` | Timestamped event log | Dashboard log panel |
| **`parallel_{name}.json`** | **Authoritative task record with full context** | **Workers (for context), master (for tracking), future reference** |

The task file contains richer information than `initialization.json`: full task descriptions, context paragraphs, critical instructions, file lists, and completion summaries. Workers can read the task file to understand the broader swarm and their specific task in detail. The master updates the task file with completion summaries after each agent returns.

---

## File Naming Convention

| Component | Format | Example |
|---|---|---|
| Directory | `tasks/{MM_DD_YY}/` | `tasks/03_22_26/` |
| Task file | `parallel_{name}.json` | `parallel_synapse_backlog_phase1.json` |
| Plan file | `parallel_plan_{name}.md` | `parallel_plan_synapse_backlog_phase1.md` |

The `{name}` is derived from `task.name` in `initialization.json`, typically using underscores instead of hyphens. The date directory uses the swarm creation date.

---

## JSON Schema

### Root Object

```json
{
  "name": "{task-slug}",
  "created": "{ISO 8601 timestamp}",
  "metadata": {
    "prompt": "{Full verbatim user prompt}",
    "type": "{Waves|Chains}",
    "project": "{Project name}",
    "project_root": "{Absolute path to target project}",
    "directories": ["{target directories}"],
    "affected_projects": "{Affected project names}",
    "total_tasks": 0,
    "total_waves": 0,
    "dashboard": "{dashboardId}",
    "overall_status": "pending"
  },
  "waves": [
    {
      "id": 1,
      "name": "{wave name}",
      "status": "pending",
      "tasks": [...]
    }
  ],
  "dependency_chains": [
    { "id": 1, "tasks": ["1.1", "2.1", "3.1"] }
  ]
}
```

| Field | Description |
|---|---|
| `name` | Kebab-case or underscore-case task name (matches `task.name` in `initialization.json`) |
| `created` | ISO 8601 timestamp of swarm creation |

### Metadata Object

```json
{
  "metadata": {
    "prompt": "{Full verbatim user prompt}",
    "type": "{Waves|Chains}",
    "project": "{Project name}",
    "project_root": "{Absolute path to target project}",
    "directories": ["{target directories}"],
    "affected_projects": "{Affected project names}",
    "total_tasks": 0,
    "total_waves": 0,
    "dashboard": "{dashboardId}",
    "overall_status": "pending"
  }
}
```

| Field | Description |
|---|---|
| `prompt` | The full user prompt that initiated the swarm. Stored as a plain string. |
| `type` | Parallelization type: `"Waves"` or `"Chains"`. |
| `project` | Project name, matching `task.project` in initialization.json. |
| `project_root` | Absolute path to the target project. |
| `directories` | Optional. Array of target directory paths relevant to this swarm. |
| `affected_projects` | Optional. Comma-separated string of affected project areas. |
| `total_tasks` | Total task count across all waves. |
| `total_waves` | Total wave count. |
| `dashboard` | Which dashboard this swarm is running on (e.g., `"71894a"`). Dashboard IDs are 6-character hex strings. |
| `overall_status` | Current swarm status: `"pending"`, `"in_progress"`, or `"completed"`. Updated by the master. |

### Wave Objects

Each wave groups related tasks:

```json
{
  "id": 1,
  "name": "{wave name}",
  "status": "pending",
  "tasks": [...]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | number | Wave identifier. Integer starting at 1. |
| `name` | string | Descriptive name for the wave. |
| `status` | string | Wave status: `"pending"`, `"in_progress"`, `"completed"`, or `"failed"`. Updated by the master as tasks within the wave progress. |
| `tasks` | array | Array of task objects belonging to this wave. |

### Task Objects

Each task in the swarm gets its own object within a wave's `tasks` array:

```json
{
  "id": "1.1",
  "title": "{short title}",
  "description": "{Detailed task description}",
  "directory": "{target directory}",
  "context": "{Additional context}",
  "critical": "{Critical instructions}",
  "tags": ["{category}"],
  "files": [
    { "action": "modify", "path": "{file path}" },
    { "action": "create", "path": "{file path}" },
    { "action": "read", "path": "{file path}" }
  ],
  "depends_on": [],
  "status": "pending",
  "assigned_agent": null,
  "started_at": null,
  "completed_at": null,
  "summary": null,
  "logs": []
}
```

### Task Object Fields

| Field | Type | Set When | Description |
|---|---|---|---|
| `id` | string | Planning | Task identifier (e.g., `"1.1"`, `"2.3"`). Matches `agents[].id` in initialization.json. |
| `title` | string | Planning | Short verb phrase describing the task. |
| `description` | string | Planning | Detailed description of what the worker must do. Can be multiple sentences. Should be self-contained -- a worker should understand the full scope from this field alone. |
| `directory` | string | Planning | Optional. Target directory within the project for this task. |
| `context` | string | Planning | Background information the worker needs. File locations, line numbers, patterns to follow, related code sections. |
| `critical` | string | Planning | Non-negotiable constraints and gotchas. Things the worker must NOT do, edge cases to handle, compatibility requirements. |
| `tags` | string[] | Planning | Optional. Category tags for the task (e.g., `["backend"]`, `["config", "documentation"]`). Used for filtering and identification. |
| `files` | array | Planning | Array of file objects the worker will read, modify, or create. Each entry has `action` (`"modify"`, `"create"`, or `"read"`) and `path` (relative to project root). |
| `depends_on` | string[] | Planning | Array of task IDs that must complete first. Empty array `[]` for root tasks. |
| `status` | string | Updated by master | Current status: `"pending"`, `"in_progress"`, `"completed"`, or `"failed"`. Updated by the master as workers start and finish. |
| `assigned_agent` | string or null | On dispatch | Agent label assigned to this task (e.g., `"Agent 1"`). `null` until dispatched. |
| `started_at` | ISO 8601 or null | On dispatch | Timestamp when the task was dispatched. `null` until dispatched. |
| `completed_at` | ISO 8601 or null | After completion | Timestamp when the task finished. `null` until complete. |
| `summary` | string or null | After completion | One-line summary of what was accomplished. Added by the master when the worker returns. `null` until the task completes. |
| `logs` | array | Updated by master | Array of log entries recorded by the master for this task. Initially empty `[]`. |

### Wave Separators

Waves provide logical grouping via the `waves` array structure. Each wave object has a `name` field that provides a descriptive label:

```json
{
  "waves": [
    {
      "id": 1,
      "name": "Foundation -- Independent edits",
      "status": "pending",
      "tasks": [...]
    },
    {
      "id": 2,
      "name": "Sequential deps -- File overlap guards",
      "status": "pending",
      "tasks": [...]
    }
  ]
}
```

These names aid human readability when reviewing the task file.

---

## Write Timing

### During Planning (Write-Once for Structure)

The master creates the task file with the full task structure during the planning phase:
- All task objects with description, context, critical, files, depends_on
- All `status` fields set to `"pending"`
- All `summary` fields set to `null`
- `metadata` fully populated

### During Execution (Updated Per Completion)

| Moment | What the Master Updates |
|---|---|
| Worker dispatched | `status` changed from `"pending"` to `"in_progress"` |
| Worker completes | `status` changed to `"completed"`, `summary` added with result detail |
| Worker fails | `status` changed to `"failed"`, `summary` added with error description |
| Repair task created | New task object appended to the relevant wave's `tasks` array (with `id` suffix `"r"`) |

Unlike `initialization.json` (which is write-once except for repairs), the task file is updated on every agent return to maintain a complete record with results.

---

## Real Example

From `tasks/03_22_26/parallel_synapse_backlog_phase1.json`:

```json
{
  "name": "synapse-backlog-phase1",
  "created": "2026-03-22T06:54:18Z",
  "metadata": {
    "prompt": "Complete phase1a (dead features & docs cleanup), phase1b (prompt template upgrades), and phase1c (server validation hardening) from the Synapse backlog.",
    "type": "Waves",
    "project": "Synapse",
    "project_root": "/Users/dean/Desktop/Working/Repos/Synapse",
    "total_tasks": 12,
    "total_waves": 3,
    "dashboard": "71894a"
  },
  "waves": [
    {
      "id": 1,
      "name": "Foundation -- Independent edits",
      "status": "pending",
      "tasks": [
        {
          "id": "1.1",
          "title": "Remove context_cache.json references",
          "description": "Remove all references to .synapse/context_cache.json from CLAUDE.md and AGENTS.md. This is a dead feature -- no command creates, reads, or writes this file. Remove from: (1) the .synapse/ directory table in each file, (2) the target project directory tree in each file. Verify tables and trees render correctly after removal.",
          "context": "CLAUDE.md line 208 has the table row, line 604 has the tree entry. AGENTS.md line 196 has the table row, line 585 has the tree entry.",
          "critical": "Do NOT remove the .synapse/ directory itself or toc.md or profile.json entries. Only remove context_cache.json rows/lines. Verify markdown renders correctly (no trailing pipes, no blank rows).",
          "files": [
            { "action": "modify", "path": "CLAUDE.md" },
            { "action": "modify", "path": "AGENTS.md" }
          ],
          "depends_on": [],
          "status": "pending",
          "summary": null
        },
        {
          "id": "1.4",
          "title": "Add path parameter sanitization",
          "description": "Add a sanitizePathParam() function to src/server/routes/apiRoutes.js and apply it to all routes that extract path parameters (dashboard ID, archive name, queue ID). Reject path traversal attempts with HTTP 400.",
          "context": "parseDashboardRoute() at line 36 extracts dashboardId without validation. Archive route at line 217 extracts archive name. Queue route at line 401 extracts queue ID. All pass directly to path.join() calls.",
          "critical": "The sanitizePathParam function must: reject strings with \"..\", \"/\" or \"\\\"; allow alphanumeric, hyphens, underscores, and single dots; enforce max 100 chars. Return 400 with descriptive error for invalid inputs.",
          "files": [
            { "action": "modify", "path": "src/server/routes/apiRoutes.js" }
          ],
          "depends_on": [],
          "status": "pending",
          "summary": null
        }
      ]
    },
    {
      "id": 2,
      "name": "Sequential deps -- File overlap guards",
      "status": "pending",
      "tasks": [
        {
          "id": "2.1",
          "title": "Fix profile.json to config.json refs",
          "description": "Update CLAUDE.md and AGENTS.md to reference .synapse/config.json instead of .synapse/profile.json.",
          "context": "The !initialize command creates .synapse/config.json (not profile.json). Task 1.1 will have already removed context_cache.json from these same sections.",
          "critical": "Do NOT modify _commands/project/initialize.md -- it is already correct. After 1.1's edits, the table will have 2 rows.",
          "files": [
            { "action": "modify", "path": "CLAUDE.md" },
            { "action": "modify", "path": "AGENTS.md" }
          ],
          "depends_on": ["1.1"],
          "status": "pending",
          "summary": null
        }
      ]
    },
    {
      "id": 3,
      "name": "Integration -- Multi-file & audit",
      "status": "pending",
      "tasks": [
        {
          "id": "3.1",
          "title": "Add EXPORTS to worker return format",
          "description": "Add an EXPORTS: section to the worker return format in both p_track.md and p.md, placed between FILES CHANGED and DIVERGENT ACTIONS. Also add a \"Return Format -- EXPORTS Field\" subsection to tracker_worker_instructions.md.",
          "context": "When workers create new functions, types, endpoints, the master must manually extract this from summaries. An explicit EXPORTS field automates this.",
          "critical": "EXPORTS should include type, name, and brief description. Workers omit the section if no new exports. Include 3 concrete examples.",
          "files": [
            { "action": "modify", "path": "_commands/Synapse/p_track.md" },
            { "action": "modify", "path": "_commands/Synapse/p.md" },
            { "action": "modify", "path": "agent/instructions/tracker_worker_instructions.md" }
          ],
          "depends_on": ["2.2", "1.6"],
          "status": "pending",
          "summary": null
        }
      ]
    }
  ],
  "dependency_chains": [
    { "id": 1, "tasks": ["1.1", "2.1", "3.1"] }
  ]
}
```

Key observations:
- Prompts are stored as plain JSON strings (no special escaping needed beyond standard JSON)
- `description` provides enough detail for a worker to execute independently
- `context` includes specific line numbers and file locations
- `critical` states constraints and "do NOT" instructions
- `depends_on` uses a JSON array of task ID strings
- Wave structure provides logical grouping via the `waves` array

---

## Task File vs initialization.json

The task file and initialization.json serve complementary purposes:

| Aspect | Task File | initialization.json |
|---|---|---|
| **Primary audience** | Workers (context), master (record), humans (review) | Dashboard rendering engine |
| **Detail level** | Full descriptions, context, critical instructions, file lists | Minimal: id, title, wave, layer, directory, depends_on |
| **Updated after planning** | Yes -- status and summary on every completion | No (write-once, except repair tasks) |
| **Lifecycle data** | `status` and `summary` updated by master | None -- all lifecycle in progress files |
| **File lists** | Yes (`files` array with action/path objects) | No |
| **Context/critical** | Yes (detailed paragraphs) | No |
| **Layout data** | No (no layer, directory badges, chain definitions) | Yes (layer, directory, chains[]) |

---

## Plan Rationale Document

Every swarm also produces a strategy document:

**Location:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{name}.md`

This Markdown file documents:
- The master's analysis of the task
- Why tasks were decomposed the way they were
- Dependency reasoning (why task A must precede task B)
- Risk assessment and mitigation strategies
- Wave grouping rationale

It is a human-readable companion to the task file that explains the "why" behind the plan structure.

---

## Directory Organization

Task files are organized by date:

```
tasks/
  03_01_26/
    parallel_frontend-core-fixes.json
    parallel_frontend-core-pages.json
    parallel_frontend-marketing-components.json
    parallel_frontend-page-subdirs.json
  03_02_26/
    parallel_frontend-api-layer.json
    parallel_ui-modernization.json
  03_21_26/
    parallel_synapse-weakness-analysis.json
  03_22_26/
    parallel_synapse_backlog_phase1.json
    parallel_synapse_backlog_phase2.json
    parallel_dependency-tracker.json
    parallel_synapse_documentation.json
```

Each date directory contains all swarms created on that date. Multiple swarms on the same day each get their own task file and plan file.

---

## Relationship to History and Archive

| Storage | What It Contains | When Created |
|---|---|---|
| **Task file** | Full task record with descriptions, context, statuses, summaries | During planning, updated throughout execution |
| **History file** | Lightweight summary: task metadata, agent results (no descriptions/context) | When swarm completes and is moved to history |
| **Archive** | Full copy of dashboard directory (init + logs + progress files) | When dashboard is cleared before a new swarm |

The task file persists indefinitely in `tasks/`. It is the most complete record of what was planned, what happened, and what was accomplished. History files are summaries for quick reference. Archive copies preserve the full dashboard state including real-time progress data.

---

## Related Documentation

- [Data Architecture Overview](./overview.md) -- High-level data model and ownership
- [initialization.json Schema](./initialization-json.md) -- Dashboard plan data
- [logs.json Schema](./logs-json.md) -- Event log format
- [Progress Files Schema](./progress-files.md) -- Worker progress lifecycle
