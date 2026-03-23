# initialization.json -- Schema Reference

`initialization.json` is the **static plan store** for each dashboard. It is written once during the planning phase and contains all the structural data needed to render the dashboard: task metadata, agent definitions, wave groupings, and chain layout. All lifecycle data (status, timing, summaries) lives exclusively in worker progress files.

**Location:** `{tracker_root}/dashboards/{dashboardId}/initialization.json`

**Owner:** Master agent (orchestrator)

---

## Write Rules

### Write-Once Principle

`initialization.json` is written **once** during the planning phase and **never updated after**, with two exceptions:

1. **Repair task creation** -- When a worker fails, the master appends a repair agent to `agents[]`, increments `task.total_tasks` and the relevant `waves[].total`, and rewires `depends_on` references from the failed task ID to the repair task ID. This is the only routine exception.

2. **Circuit breaker replanning** -- When the circuit breaker triggers (3+ failures in one wave, a single failure blocking 3+ downstream tasks, or a single failure blocking more than half of remaining tasks), the orchestrator updates `initialization.json` with modified, added, or removed tasks from the replanner output.

### Atomic Writes

All writes must be atomic: read the full file, modify in memory, stringify with 2-space indent, and write the complete file. Never write partial JSON. An invalid file silently stops all dashboard updates until corrected.

### The `_instructions` Key

The file may contain a `_instructions` key with metadata for the master agent. This key does not affect rendering and must not be modified or removed.

---

## Complete Schema

```json
{
  "_instructions": "Static plan data -- written once during planning phase, never updated after.",
  "task": {
    "name": "string",
    "type": "string",
    "directory": "string",
    "prompt": "string",
    "project": "string",
    "project_root": "string",
    "created": "ISO 8601 string",
    "total_tasks": "number",
    "total_waves": "number"
  },
  "agents": [
    {
      "id": "string",
      "title": "string",
      "wave": "number",
      "layer": "string (optional)",
      "directory": "string (optional)",
      "depends_on": ["string"]
    }
  ],
  "waves": [
    {
      "id": "number",
      "name": "string",
      "total": "number"
    }
  ],
  "chains": [
    {
      "id": "number",
      "name": "string",
      "tasks": ["string"]
    }
  ],
  "history": []
}
```

---

## Field Definitions

### `task` Object

The top-level task metadata for the swarm. When `task` is `null`, the dashboard shows the empty state ("No active agents / Waiting for dispatch...").

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Kebab-case slug identifying the swarm (e.g., `"synapse-backlog-phase1"`). Displayed in the header bar at ~0.88rem, no wrap. Keep short. |
| `type` | string | Yes | Layout mode: `"Waves"` (default) or `"Chains"`. Controls how agent cards are arranged on the dashboard. |
| `directory` | string | No | Master task working directory. Shown as a dim pill badge next to the task name in the header. Hidden if null or empty. |
| `prompt` | string | Yes | Full verbatim user prompt that initiated the swarm. Stored for reference and history. |
| `project` | string | Yes | Affected project name(s). Used for identification and multi-project support. |
| `project_root` | string | Yes | Absolute path to the target project (`{project_root}`). Identifies which project this swarm serves. Critical for multi-project support where different dashboards serve different projects. |
| `created` | ISO 8601 | Yes | Immutable creation timestamp. Set once during planning, never overwritten. Captured via `date -u +"%Y-%m-%dT%H:%M:%SZ"`. |
| `total_tasks` | number | Yes | Total agent count across all waves. Used by the progress bar: `(completed / total_tasks) * 100`. Server validation accepts both number and string types. |
| `total_waves` | number | Yes | Total wave count. Server validation accepts both number and string types. |

**Removed fields** (previously existed in older versions, now derived from progress files):
- `started_at` -- derived from the earliest worker `started_at` across progress files
- `completed_at` -- derived from the latest worker `completed_at` across progress files
- `overall_status` -- derived from the combination of all agent statuses
- `completed_tasks` -- count of progress files with `status === "completed"`
- `failed_tasks` -- count of progress files with `status === "failed"`

### `agents[]` Array

One entry per task in the swarm. Each entry defines the static plan for a single agent -- identity, grouping, and dependency relationships. All lifecycle data comes from the corresponding `progress/{id}.json` file.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Task identifier in `"{wave}.{index}"` format (e.g., `"2.3"`). Must be unique across all agents. Repair tasks use an `"r"` suffix (e.g., `"2.4r"`). |
| `title` | string | Yes | Short verb phrase describing the task. Keep under ~40 characters to avoid ellipsis on dashboard cards. Repair tasks are prefixed with `"REPAIR: "`. |
| `wave` | number | Yes | Wave assignment. Must match a `waves[].id` value exactly. Agents with the same wave appear in the same column (Waves mode) or at the same depth level (Chains mode). |
| `layer` | string | No | Optional category badge displayed on the agent card. Common values: `"frontend"`, `"backend"`, `"documentation"`, `"migration"`, `"types"`, `"tests"`, `"config"`. Rendered as a tinted badge. |
| `directory` | string | No | Optional blue-tinted badge showing the task's target directory within the project. |
| `depends_on` | string[] | Yes | Array of task ID strings that must complete before this task can be dispatched. Empty array `[]` for root tasks (no dependencies). Drives dependency line rendering and the eager dispatch algorithm. |

**Removed fields** (previously in agents[], now exclusively in progress files):
- `status` -- from `progress/{id}.json`
- `assigned_agent` -- from `progress/{id}.json`
- `started_at` -- from `progress/{id}.json`
- `completed_at` -- from `progress/{id}.json`
- `summary` -- from `progress/{id}.json`

### `waves[]` Array

One entry per wave (dependency level). Defines the column structure of the dashboard.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes | Wave identifier. Integer starting at 1. Must match `agents[].wave` values. Determines column order left to right. |
| `name` | string | Yes | Descriptive name for the wave. Displayed as `"Wave {id}: {name}"` in column headers. Use descriptive phrases like `"Foundation"`, `"Auth Layer"`, `"Integration Tests"` -- the "Wave N:" prefix is added automatically. |
| `total` | number | Yes | Count of agents in this wave. Must match the actual count of agents where `agent.wave === wave.id`. Incremented when repair tasks are added. |

**Removed fields** (previously existed, now derived from progress files):
- `status` -- derived from statuses of agents within the wave
- `completed` -- count derived from completed agents within the wave

### `chains[]` Array

Required when `task.type` is `"Chains"`. Can be an empty array `[]` when type is `"Waves"`.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes (Chains mode) | Chain identifier. Integer starting at 1. Determines row order on the dashboard. |
| `name` | string | Yes (Chains mode) | Descriptive chain name (e.g., `"Auth Flow"`, `"User Service"`). |
| `tasks` | string[] | Yes (Chains mode) | Ordered array of agent IDs tracing the dependency path left to right. Each task must appear in exactly one chain, and every agent in `agents[]` should appear in exactly one chain. |

**Chains mode example:**

```json
"chains": [
  { "id": 1, "name": "Auth Flow", "tasks": ["1.1", "2.1", "3.1"] },
  { "id": 2, "name": "User Service", "tasks": ["1.2", "2.2"] },
  { "id": 3, "name": "Config Setup", "tasks": ["1.3"] }
]
```

In Chains mode, tasks are displayed as horizontal rows flowing left to right. SVG lines connect dependent tasks, and lines light up green when the dependency task completes.

### `history[]` Array

Array of previous swarm records. Typically empty `[]` for the current swarm. Previous swarm summaries may be stored here when the dashboard is reused.

---

## Field-to-UI Mapping

### Header Bar

| UI Element | Source Field | Notes |
|---|---|---|
| Task name (bold center text) | `task.name` | Kebab-case slug, ~0.88rem font, no wrap |
| Directory badge (dim pill next to name) | `task.directory` | Hidden if null/empty |
| Active count (purple pill, top-right) | Derived: count of progress files with `status === "in_progress"` | Not from initialization.json |
| Connection dot (green/red) | Server-side SSE health | Not from initialization.json |

Header center is hidden when `task === null`. It appears as soon as a valid `task` object is written.

### Progress Bar

| UI Element | Source | Notes |
|---|---|---|
| Fill percentage | `(completed progress files / task.total_tasks) * 100` | `total_tasks` from init, completed count from progress files |

### Stat Cards (6 cards below the progress bar)

| Card | Source | Color |
|---|---|---|
| **Total** | `task.total_tasks` | White |
| **Completed** | Count of progress files with `status === "completed"` | Green (`#34d399`) |
| **In Progress** | Count of progress files with `status === "in_progress"` | Purple (`#9b7cf0`) |
| **Failed** | Count of progress files with `status === "failed"` | Red (`#ef4444`) when > 0 |
| **Pending** | `total_tasks - completed - in_progress - failed` | Dim gray |
| **Elapsed** | Earliest worker `started_at` to latest worker `completed_at` | Purple while running |

All stats except Total are derived from progress files. The master maintains no counters.

### Wave Columns

| UI Element | Source | Notes |
|---|---|---|
| Column title | `"Wave {waves[].id}: {waves[].name}"` | From initialization.json |
| Column order | `waves[].id` | Left to right, ascending |
| Cards in column | `agents[]` where `agent.wave === wave.id` | Matched by wave ID |
| Wave status badge | Derived from agent statuses within wave | Not stored in init |

### Agent Cards (top row)

| UI Element | Source | Notes |
|---|---|---|
| Task ID (dim label) | `agents[].id` | From initialization.json |
| Title | `agents[].title` | From initialization.json, truncated at ~40 chars |
| Status dot color | `progress/{id}.json` -> `status` | green/purple/red/gray/lime |

### Agent Cards (meta row)

| UI Element | Source | Notes |
|---|---|---|
| Layer badge | `agents[].layer` | From initialization.json (optional, tinted) |
| Directory badge | `agents[].directory` | From initialization.json (optional, blue-tinted) |
| Agent label | `progress/{id}.json` -> `assigned_agent` | From progress file (dim text) |

### Agent Cards (bottom row)

| Status | What's Shown | Source |
|---|---|---|
| `"pending"` | `"Waiting..."` in italic gray | Default when no progress file exists |
| `"in_progress"` | Stage badge + elapsed time + milestone message | `progress/{id}.json` -> `stage`, `message`, `started_at` |
| `"completed"` | Summary text (gray) + duration badge | `progress/{id}.json` -> `summary`, `started_at`, `completed_at` |
| `"failed"` | Summary text in red | `progress/{id}.json` -> `summary` |

### Dependency Lines (Wave mode)

Dependency lines are drawn between cards based on `agents[].depends_on`. Lines use BFS pathfinding through corridor gaps between columns and card gaps. Interaction:
- **Line hover**: Highlights blue with glow
- **Card hover**: Needs (incoming) highlight blue, blocks (outgoing) highlight red, unrelated lines dim

No additional data beyond `depends_on` is needed for line rendering.

### Left Border Accent

| Status | Border Color |
|---|---|
| `"completed"` | Green `#34d399` |
| `"in_progress"` | Purple `#9b7cf0` (animating pulse) |
| `"failed"` | Red `#ef4444` |
| `"pending"` | Gray |
| `"claimed"` | Lime |

---

## Real Example

From a completed swarm on `dashboard1`:

```json
{
  "_instructions": "Static plan data -- written once during planning phase, never updated after. All lifecycle data (status, timing, summaries) lives in progress/ files.",
  "task": {
    "name": "synapse-backlog-phase1",
    "type": "Waves",
    "directory": ".",
    "prompt": "Complete phase1a (dead features & docs cleanup), phase1b (prompt template upgrades), and phase1c (server validation hardening) from the Synapse backlog.",
    "project": "Synapse",
    "project_root": "/Users/dean/Desktop/Working/Repos/Synapse",
    "created": "2026-03-22T06:54:18Z",
    "total_tasks": 12,
    "total_waves": 3
  },
  "agents": [
    {
      "id": "1.1",
      "title": "Remove context_cache.json references",
      "wave": 1,
      "layer": "documentation",
      "directory": ".",
      "depends_on": []
    },
    {
      "id": "1.2",
      "title": "Add retry vs repair decision tree",
      "wave": 1,
      "layer": "documentation",
      "directory": "agent/instructions",
      "depends_on": []
    },
    {
      "id": "2.1",
      "title": "Fix profile.json to config.json refs",
      "wave": 2,
      "layer": "documentation",
      "directory": ".",
      "depends_on": ["1.1"]
    },
    {
      "id": "3.1",
      "title": "Add EXPORTS to worker return format",
      "wave": 3,
      "layer": "documentation",
      "directory": "_commands/Synapse",
      "depends_on": ["2.2", "1.6"]
    }
  ],
  "waves": [
    { "id": 1, "name": "Foundation -- Independent edits", "total": 6 },
    { "id": 2, "name": "Sequential deps -- File overlap guards", "total": 3 },
    { "id": 3, "name": "Integration -- Multi-file & audit", "total": 3 }
  ],
  "chains": [],
  "history": []
}
```

Key observations:
- No lifecycle fields (`status`, `started_at`, `completed_at`, `summary`, `assigned_agent`) in agent entries
- `depends_on` arrays drive both dependency line rendering and dispatch logic
- Wave names are descriptive, not just "Wave 1"
- `total_tasks` (12) matches the sum of all `waves[].total` values (6 + 3 + 3)

---

## Empty State

When no swarm is active:

```json
{
  "task": null,
  "agents": [],
  "waves": [],
  "chains": [],
  "history": []
}
```

The dashboard shows "No active agents / Waiting for dispatch..." when `task === null`. This default is defined in `src/server/utils/constants.js`:

```javascript
const DEFAULT_INITIALIZATION = { task: null, agents: [], waves: [], chains: [], history: [] };
```

---

## Validation

The server validates `initialization.json` on every read using `isValidInitialization()` in `src/server/utils/json.js`. The validation rules:

| Rule | Detail |
|---|---|
| `task` must exist | Can be `null` (empty state) or a valid object |
| `task.name` | Required when task is not null |
| `task.type` | Required when task is not null; must be `"Waves"` or `"Chains"` |
| `task.total_tasks` | Accepts both number and string types |
| `task.total_waves` | Accepts both number and string types |
| `agents` | Must be an array |
| `agents[].id` | Required, must be a string |
| `agents[].title` | Required, must be a string |
| `waves` | Optional but if present must be an array |
| `waves[].id` | Required when present |
| `waves[].name` | Required when present |
| `chains` | Not validated beyond being an array |

Invalid files are silently rejected -- the server does not broadcast corrupted data.

---

## Common Mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Writing to initialization.json after planning | Dashboard derives stats from progress; stale init data causes confusion | initialization.json is write-once (except repair tasks) |
| `agents[].wave` doesn't match any `waves[].id` | Agent cards don't appear in any column | Ensure every agent's wave has a corresponding wave entry |
| `waves[].total` set incorrectly | Dashboard can't determine wave completion | Count agents per wave carefully |
| Including lifecycle fields in agents[] | Dashboard ignores them (uses progress files), wastes space | Only include: id, title, wave, layer, directory, depends_on |
| Partial JSON write (crash mid-write) | Dashboard freezes until corrected | Always read -> modify in memory -> write full file |
| Not clearing progress/ before new swarm | Stale progress from previous swarm appears on cards | Archive first, then clear progress files |
| Forgetting `project_root` in task | Multi-project support breaks; commands can't find the project | Always include the resolved `{project_root}` path |

---

## Related Documentation

- [Data Architecture Overview](./overview.md) -- High-level data model and ownership
- [Progress Files Schema](./progress-files.md) -- Dynamic lifecycle data (the other half of the merge)
- [logs.json Schema](./logs-json.md) -- Event log format
- [Task Files](./xml-task-files.md) -- Authoritative task record
