# Dashboard Writes — Master Agent Data Protocol

This document defines every file the master agent writes to the dashboard, the exact schema for each, when writes happen, and the rules governing those writes.

---

## How the Dashboard Works

The server (`server.js`) watches three data sources per dashboard:

- **`dashboards/{id}/initialization.json`** — Static plan data, watched via `fs.watchFile`
- **`dashboards/{id}/logs.json`** — Event log, watched via `fs.watchFile`
- **`dashboards/{id}/progress/`** — Worker progress files, watched via `fs.watch` on the directory

Where `{id}` is `ide` (reserved), a 6-char hex string (e.g., `a3f7k2`), or a legacy `dashboardN` format.

> **Note:** The `ide` dashboard is reserved and permanent — it is not used for swarm data. Master agents must never write swarm initialization, logs, or progress to the `ide` dashboard.

When any file changes, the server immediately pushes the update to every open browser tab via Server-Sent Events (SSE).

**The dashboard merges data client-side:** It reads `initialization.json` for the static plan (task metadata, agent plan entries, wave structure, chains) and merges it with individual `progress/{task_id}.json` files for all dynamic lifecycle data (agent status, started_at, completed_at, summary, stage, milestones, deviations, logs). Stats like completed count, failed count, in-progress count, and elapsed time are **all derived from progress files** — the master does not maintain counters.

**Every write you make becomes visible within ~100ms.**

Because the server re-reads the full file on every change, **atomic writes are mandatory.** Always read the full file -> parse -> modify in memory -> stringify with 2-space indent -> write the whole file back. Never write partial JSON; an invalid file silently stops all updates until corrected.

**Do not modify or remove the `_instructions` key** present in data files. It is metadata for the master agent and does not affect rendering.

**IDE Dashboard (`ide`):** The `ide` dashboard exists permanently and is reserved for the IDE/Code Explorer agent. It is auto-created on Electron startup and cannot be deleted. Master agents must NEVER claim `ide` for swarm dispatch — always use other dashboards. Do not overwrite `ide`'s `initialization.json` with swarm plan data.

---

## initialization.json — Static Plan Data

**Location:** `{tracker_root}/dashboards/{id}/initialization.json`

### Write-Once Rule — NON-NEGOTIABLE

`initialization.json` is written **once** during the planning phase. After the plan is written, the master **never updates it** — with exactly two exceptions:

1. **Repair task creation** — when a worker fails, the master appends a repair agent to `agents[]`, increments `task.total_tasks` and the relevant `waves[].total`, and rewires `depends_on` references.
2. **Circuit breaker replanning** — when cascading failures trigger automatic replanning, the master applies the revision plan (modified, added, removed, retry categories).

Outside of these two exception cases, the master does not touch `initialization.json` again.

### Schema

#### `task` object

| Field | Type | Set when | Notes |
|---|---|---|---|
| `name` | string | Plan creation | Kebab-case slug. Short. |
| `type` | string | Plan creation | `"Waves"` (default) or `"Chains"`. Controls layout mode. |
| `directory` | string | Plan creation | Master task directory displayed in header. Optional. |
| `prompt` | string | Plan creation | Full verbatim user prompt. |
| `project` | string | Plan creation | Affected directory/project name(s). |
| `project_root` | string | Plan creation | Absolute path to the target project (`{project_root}`). Identifies which project this swarm serves. |
| `created` | ISO 8601 | Plan creation — **never overwrite** | Immutable creation timestamp. |
| `total_tasks` | number | Plan creation | Total agent count across all waves. |
| `total_waves` | number | Plan creation | Wave count. |

> **Removed fields:** `started_at`, `completed_at`, `overall_status`, `completed_tasks`, `failed_tasks` — all derived by the dashboard from progress files.

#### `agents[]` entries

| Field | Type | Set when | Notes |
|---|---|---|---|
| `id` | string | Plan creation | `"{wave}.{index}"` e.g. `"2.3"` |
| `title` | string | Plan creation | Short verb phrase. ~40 chars max. |
| `wave` | number | Plan creation | Must match a `waves[].id` exactly. |
| `layer` | string | Plan creation (optional) | Category badge. Good values: `"frontend"`, `"backend"`, `"documentation"`, `"migration"`, `"types"`, `"tests"`, `"config"`. Omit if not useful. |
| `directory` | string | Plan creation (optional) | Blue-tinted badge showing target directory. Omit if not useful. |
| `depends_on` | string[] | Plan creation | Array of task ID strings. Drives dependency lines. Empty array for root tasks. |

> **Removed fields:** `status`, `assigned_agent`, `started_at`, `completed_at`, `summary` — all come from worker progress files now.

#### `waves[]` entries

| Field | Type | Set when | Notes |
|---|---|---|---|
| `id` | number | Plan creation | Must match `agents[].wave`. |
| `name` | string | Plan creation | Descriptive, not just `"Wave 1"`. The dashboard prepends `"Wave {id}: "` automatically. |
| `total` | number | Plan creation | Count of agents in this wave. |

> **Removed fields:** `status`, `completed` — derived by the dashboard from progress files of agents in each wave.

#### `chains[]` entries (required when `task.type` is `"Chains"`)

| Field | Type | Set when | Notes |
|---|---|---|---|
| `id` | number | Plan creation | Integer starting at 1. Determines row order. |
| `name` | string | Plan creation | Descriptive chain name. |
| `tasks` | string[] | Plan creation | Ordered array of agent IDs left to right. Each task appears in exactly one chain. Every agent in `agents[]` should appear in exactly one chain. |

#### `history[]` entries

Previous swarm records. Populated when the master moves a completed swarm to history.

### Write Rules

- Write the full `task` object, all `agents[]`, all `waves[]`, and all `chains[]` (if applicable) in a single atomic write
- Clear `dashboards/{id}/progress/` directory before writing
- **This is the ONLY write to initialization.json** — it is write-once after the planning phase
- Never write partial JSON — an invalid file silently stops all dashboard updates
- Always use 2-space indent when stringifying

### Repair Task Exception

When a worker fails, the master appends a repair task to `initialization.json`:

- **New agent entry:** ID format `"{failed_task_wave}.{next_available_index}r"` (the `r` suffix marks it as a repair task)
- **Title:** `"REPAIR: {original task title}"`
- **Wave, layer, directory:** Same as the failed task
- **`depends_on`:** Identical to the failed task's (already satisfied since the original was dispatched)
- **Increment:** `task.total_tasks` and the relevant `waves[].total`
- **Rewire:** Every task whose `depends_on` contains the failed task's ID gets updated to reference the repair task's ID instead
- **Chains mode:** If applicable, insert the repair task ID immediately after the failed task's ID in the chain's `tasks[]` array

---

## logs.json — Event Log

**Location:** `{tracker_root}/dashboards/{id}/logs.json`

The log panel reads entirely from this file. Each entry in `entries[]` becomes one row in the dashboard log panel.

### Entry Schema

| Field | Type | Notes |
|---|---|---|
| `timestamp` | ISO 8601 | Displayed as `HH:MM:SS`. Use real ISO 8601 — the UI parses it with `new Date()`. |
| `task_id` | string | `"0.0"` for orchestrator events. `"{wave}.{index}"` for per-agent events. |
| `agent` | string | `"Orchestrator"` for top-level events. `"Agent N"` for workers. Must match `agents[].assigned_agent`. |
| `level` | string | `"info"` (purple), `"warn"` (lime), `"error"` (red), `"debug"` (gray/dim), `"permission"` (amber — triggers popup), `"deviation"` (yellow — plan divergence). |
| `message` | string | Full message text. Action verb first. Include result metadata. No length limit in the UI. |
| `task_name` | string | Copy from `task.name`. |

### Write Timing

| Moment | `task_id` | `agent` | `level` | Message pattern |
|---|---|---|---|---|
| Task initialized | `"0.0"` | `"Orchestrator"` | `"info"` | `"Task initialized: {N} tasks across {W} waves — {brief plan}"` |
| Tasks dispatched | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dispatching {M} tasks ({task IDs}) — dependencies satisfied (Wave {N}: {wave name})"` |
| Agent starts | `"{wave}.{idx}"` | `"Agent N"` | `"info"` | `"Starting: {task title}"` |
| Agent completes | `"{wave}.{idx}"` | `"Agent N"` | `"info"` | `"Completed: {task title} — {result detail}"` |
| Agent warns | `"{wave}.{idx}"` | `"Agent N"` | `"warn"` | `"WARN: {what was unexpected}"` |
| Agent deviates | `"{wave}.{idx}"` | `"Agent N"` | `"deviation"` | `"DEVIATION: {what changed and why}"` — logged by master when worker reports deviation |
| Agent fails | `"{wave}.{idx}"` | `"Agent N"` | `"error"` | `"FAILED: {task title} — {error reason}"` |
| Repair task created | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dispatching repair task {repair_id} for failed task {failed_id} — {brief reason}"` |
| Eager dispatch | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dependency scan: dispatching {N} newly available tasks — {task IDs}"` |
| Permission request | `"0.0"` | `"Orchestrator"` | `"permission"` | `"{What you need and why}"` — triggers popup |
| All complete | `"0.0"` | `"Orchestrator"` | `"info"` | `"Swarm complete: {completed}/{total} tasks succeeded in {duration}"` |

### Write Rules

- Append new entries to the `entries[]` array — never overwrite existing entries
- Atomic write: read full file -> parse -> append -> stringify -> write full file
- Log events (dispatch, complete, warn, error, deviation) — not tool calls
- Too much `info` buries warnings — use the right level
- Use `"deviation"` level for plan divergences reported by workers, not `"warn"`

---

## master_state.json — State Checkpoint

**Location:** `{tracker_root}/dashboards/{id}/master_state.json`

The master's state checkpoint, written after every dispatch event (worker dispatched, completed, or failed) to enable recovery after context compaction.

### Schema

```json
{
  "last_updated": "2026-03-21T15:30:00Z",
  "completed": [
    { "id": "1.1", "summary": "Created auth middleware — 3 endpoints protected" }
  ],
  "in_progress": ["2.1", "2.3"],
  "failed": [
    { "id": "2.2", "summary": "Failed: missing dependency", "repair_id": "2.4r" }
  ],
  "ready_to_dispatch": ["3.1"],
  "upstream_results": {
    "1.1": "Created auth middleware with rate limiting. Exports: authMiddleware, rateLimiter."
  },
  "next_agent_number": 5,
  "permanently_failed": []
}
```

| Field | Type | Description |
|---|---|---|
| `last_updated` | ISO 8601 | When the checkpoint was last written |
| `completed` | array | Task IDs and one-line summaries for completed tasks |
| `in_progress` | string[] | Task IDs currently being executed |
| `failed` | array | Failed task IDs, summaries, and repair task IDs (if created) |
| `ready_to_dispatch` | string[] | Task IDs whose dependencies are satisfied but not yet dispatched |
| `upstream_results` | object | Map of task IDs to result summaries for downstream injection |
| `next_agent_number` | number | Next available agent number for dispatch |
| `permanently_failed` | string[] | Task IDs that failed twice (original + repair) — no further retries |

### Write Rules

- Write the full file atomically after every dispatch, completion, or failure event
- This file is NOT watched by the server and NOT broadcast via SSE — purely for master self-recovery
- Workers never read or write this file

### Recovery Procedure

When context compaction causes the master to lose track of state:

1. Read `master_state.json` for the cached state
2. Read `initialization.json` for the full plan
3. Read all progress files for ground truth
4. Cross-reference: **progress files are authoritative** if they conflict with the checkpoint
5. Resume the eager dispatch loop

---

## metrics.json — Swarm Performance Metrics

**Location:** `{tracker_root}/dashboards/{id}/metrics.json`

Swarm performance metrics — written **once** after all tasks complete. Contains elapsed time, efficiency ratios, duration distribution, and parallelism statistics. This file enables historical performance comparison across swarms and helps calibrate future task decomposition.

### Schema

```json
{
  "swarm_name": "{task-slug}",
  "computed_at": "{ISO 8601 timestamp}",
  "elapsed_seconds": 187,
  "serial_estimate_seconds": 612,
  "parallel_efficiency": 3.27,
  "duration_distribution": {
    "min": 28,
    "avg": 76.5,
    "max": 142,
    "median": 71
  },
  "failure_rate": 0.0,
  "max_concurrent": 5,
  "deviation_count": 2,
  "total_tasks": 8,
  "completed_tasks": 8,
  "failed_tasks": 0
}
```

| Field | Type | Description |
|---|---|---|
| `swarm_name` | string | Task slug from `initialization.json` -> `task.name` |
| `computed_at` | ISO 8601 | When the metrics were computed |
| `elapsed_seconds` | number | Wall-clock time from first worker start to last worker completion |
| `serial_estimate_seconds` | number | Sum of all individual task durations (sequential estimate) |
| `parallel_efficiency` | number | `serial_estimate / elapsed` — higher means better parallelism |
| `duration_distribution` | object | `{ min, avg, max, median }` of task durations in seconds |
| `failure_rate` | number | `failed_tasks / total_tasks` (0.0 = no failures) |
| `max_concurrent` | number | Peak number of simultaneously in-progress tasks |
| `deviation_count` | number | Total deviations across all tasks |
| `total_tasks` | number | Total number of tasks in the swarm |
| `completed_tasks` | number | Tasks with `status === "completed"` |
| `failed_tasks` | number | Tasks with `status === "failed"` |

### Write Rules

- Written **once** during Step 17 finalization, after all tasks complete and after verification (if run)
- Compute metrics from all progress files
- This file is NOT watched by the server for live updates — it is a post-hoc analysis artifact
- Workers never read or write this file

---

## Archive Before Clear — NON-NEGOTIABLE

**The master agent must ALWAYS archive a dashboard before clearing it.** Previous swarm data is never discarded — it is moved to the Archive for future reference.

### Procedure

1. **Check if the dashboard has data** — read `initialization.json`. If `task` is not `null`, the dashboard has a previous swarm.
2. **Archive the dashboard** — copy the entire dashboard directory (`initialization.json`, `logs.json`, `progress/`) to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`.
3. **Then clear** — delete progress files, reset `initialization.json` and `logs.json` to empty state.

### Where This Applies

This applies everywhere a dashboard is cleared:

- `!p_track` initialization
- `!reset`
- `!master_plan_track` slot clearing
- Queue-to-dashboard promotion
- Any other operation that overwrites dashboard state

**No exceptions.** Never clear a dashboard without archiving first — previous swarm data must always be preserved.

---

## When to Update What — Summary

### initialization.json write points

| Moment | What to write |
|---|---|
| **Plan finalized, before user approval** | Full `task` object (static data only), full `agents[]` (id, title, wave, layer, directory, depends_on), full `waves[]` (id, name, total), full `chains[]` if applicable. Clear `progress/` directory. **This is the ONLY write.** |
| **Worker fails (repair task creation)** | **EXCEPTION to write-once rule.** Append repair agent to `agents[]`, increment `task.total_tasks` and `waves[].total`, rewire `depends_on`. |
| **Circuit breaker replanning** | **EXCEPTION to write-once rule.** Apply revision plan: modify, add, remove, retry. |

### logs.json write points

Every event listed in the Write Timing table above.

### master_state.json write points

After every dispatch, completion, or failure event.

### metrics.json write point

Once, after all tasks complete (during Step 17 finalization).

### progress files (written by workers, NOT by master)

The master **reads** progress files for eager dispatch scanning but **never writes** them. Workers own their progress files exclusively.

---

## Compaction Recovery

During long-running swarms, context compaction may discard the master's cached upstream results. This causes downstream tasks to receive incomplete `UPSTREAM RESULTS` sections.

**Detection:** Before constructing any downstream worker prompt, verify cached results exist for all completed upstream tasks. If a task has a progress file with `status: "completed"` but the master has no cached result for it, compaction has occurred.

**Recovery:**

1. Read all progress files in `{tracker_root}/dashboards/{id}/progress/` where `status === "completed"`.
2. For each, extract `task_id`, `summary`, `milestones[]`, `deviations[]`, and scan `logs[]` for `"warn"`/`"error"` entries.
3. Rebuild the upstream result cache from these fields. Note: `FILES CHANGED` data (from the worker's return) is lost after compaction — recover what you can from summaries and milestones.
4. Log a `"warn"` entry to `logs.json`: `"Context compaction detected — rebuilt upstream cache from {N} progress files. File change data may be incomplete."`
5. Resume dispatch. If file change data is missing for an upstream result, include this note in the downstream prompt's `UPSTREAM RESULTS`: "Note: File change details unavailable due to context compaction — check milestones for partial file information."

**Limitation:** Progress files do not contain `FILES CHANGED` data (that comes from the worker's return to the master). After compaction, file change data may be incomplete unless the worker's summary or milestones mention specific files.

**Prevention:** Keep terminal output minimal and avoid re-reading large files during dispatch loops to reduce compaction frequency.
