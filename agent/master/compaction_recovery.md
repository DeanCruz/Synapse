# Context Compaction Recovery, Master State Checkpoint & Swarm Metrics

This module covers the master agent's state persistence, context compaction recovery procedures, and post-swarm metrics computation. These systems work together to ensure swarm continuity after context compaction events and provide performance analysis after completion.

---

## Master State Checkpoint

The master writes a state checkpoint after every dispatch event (worker dispatched, completed, or failed) to enable recovery after context compaction.

### File Path

```
{tracker_root}/dashboards/{dashboardId}/master_state.json
```

### Schema

```json
{
  "last_updated": "2026-03-21T15:30:00Z",
  "completed": [
    { "id": "1.1", "summary": "Created auth middleware — 3 endpoints protected" },
    { "id": "1.2", "summary": "Set up database schema — 4 tables created" }
  ],
  "in_progress": ["2.1", "2.3"],
  "failed": [
    { "id": "2.2", "summary": "Failed: missing dependency express-rate-limit", "repair_id": "2.4r" }
  ],
  "ready_to_dispatch": ["3.1"],
  "upstream_results": {
    "1.1": "Created auth middleware with rate limiting for /api/auth, /api/users, /api/admin. Exports: authMiddleware, rateLimiter.",
    "1.2": "Created User, Session, Permission, AuditLog tables. Migration file: 001_initial_schema.sql."
  },
  "next_agent_number": 5,
  "permanently_failed": []
}
```

### Field Descriptions

| Field | Type | Description |
|---|---|---|
| `last_updated` | ISO 8601 | Timestamp of the last checkpoint write |
| `completed` | array | Array of objects with `id` and `summary` for each completed task |
| `in_progress` | array | Array of task ID strings currently being worked on by agents |
| `failed` | array | Array of objects with `id`, `summary`, and optional `repair_id` for each failed task |
| `ready_to_dispatch` | array | Array of task ID strings whose dependencies are satisfied but not yet dispatched |
| `upstream_results` | object | Map of task ID to one-line summary string — used for injecting into downstream worker prompts |
| `next_agent_number` | number | Tracks the agent numbering counter so re-dispatch after compaction uses the right numbers |
| `permanently_failed` | array | Array of task IDs that have failed twice (original + repair) and will not be retried |

### When to Write

After every dispatch, completion, or failure event. Write the full file atomically (like progress files — read-modify-write is unnecessary since the master is the sole writer).

### When to Read

On context compaction recovery — when the master loses track of which tasks are dispatched or completed.

### Write Rules

- Write the full file on every update (atomic, like progress files)
- This is the master's own state file — workers never read or write it
- `upstream_results` stores one-line summaries per completed task, used for injecting into downstream worker prompts
- `next_agent_number` tracks the agent numbering counter so re-dispatch after compaction uses the right numbers
- Keep summaries short (one line each) — this file should stay under 2000 tokens

### Notes

- This file is NOT watched by the server and NOT broadcast via SSE. It is purely for master self-recovery.
- Workers never read or write it.

---

## Compaction Recovery

During long-running swarms, context compaction may discard the master's cached upstream results. When this happens, downstream tasks receive incomplete `UPSTREAM RESULTS` sections — the #1 cause of downstream worker confusion.

### Detection

Before constructing any downstream worker prompt, verify that cached results exist for all completed upstream tasks. If a task has a progress file with `status: "completed"` but the master has no cached result for it, compaction has occurred.

### Recovery Procedure (5 Steps)

**Step 1 — Read the master state checkpoint.**

Read `dashboards/{dashboardId}/master_state.json` for the cached state. This provides the last known snapshot of completed tasks, in-progress tasks, failed tasks, and upstream result summaries.

**Step 2 — Read the full plan.**

Read `dashboards/{dashboardId}/initialization.json` for the complete plan — all tasks, waves, dependencies.

**Step 3 — Read all progress files for ground truth.**

List all files in `{tracker_root}/dashboards/{dashboardId}/progress/`. Read every progress file where `status === "completed"`. For each completed progress file, extract:
- `task_id`, `summary` — what the task accomplished
- `milestones[]` — what was built, in order (look for file creation/modification milestones)
- `deviations[]` — any plan divergences that affect downstream work
- `logs[]` — scan for `"warn"` and `"error"` entries that may indicate partial issues

**Step 4 — Cross-reference and rebuild.**

Cross-reference: progress files are authoritative if they conflict with the checkpoint. Rebuild the upstream result cache from progress file fields. For each completed task, reconstruct the cache entry with `task_id`, `summary`, and `deviations`.

**Note:** Progress files do not contain `FILES CHANGED` data (that comes from the worker's return to the master). After compaction, file change data is lost unless the summary or milestones mention specific files. Include what can be recovered and note the gap.

Log a `"warn"` entry to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "warn",
  "message": "Context compaction detected — rebuilt upstream cache from {N} progress files. File change data may be incomplete.",
  "task_name": "{task-slug}"
}
```

**Step 5 — Resume dispatch.**

Resume normal dispatch with the rebuilt cache. Resume the eager dispatch loop. Downstream prompts will include recovered summaries and deviations. If file change data is missing for an upstream result, include this note in the downstream prompt's `UPSTREAM RESULTS`: "Note: File change details unavailable due to context compaction — check milestones for partial file information."

### Limitation — FILES CHANGED Data

Progress files do not contain `FILES CHANGED` data (that comes from the worker's return to the master). After compaction, file change data may be incomplete unless the worker's summary or milestones mention specific files. This is the primary data loss vector during compaction recovery.

### Cache Awareness (Context Efficiency Principle #7)

After context compaction, you lose file contents from earlier reads. Re-read critical files rather than working from stale memory. This principle is the foundation of the recovery procedure above — never assume cached data survived compaction.

### Prevention Tips

- Keep terminal output minimal during dispatch loops — avoid re-reading large files unnecessarily
- Avoid printing full status tables during execution (the dashboard is the primary reporting channel)
- Terminal output is limited to one-line confirmations per event
- These practices reduce the rate at which context is consumed, delaying compaction
- Re-read critical files after compaction rather than working from stale memory

---

## Swarm Metrics

### File Path

```
{tracker_root}/dashboards/{dashboardId}/metrics.json
```

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

### Field Descriptions

| Field | Type | Description |
|---|---|---|
| `swarm_name` | string | Task slug from `initialization.json` → `task.name` |
| `computed_at` | ISO 8601 | When the metrics were computed |
| `elapsed_seconds` | number | Wall-clock time from first worker start to last worker completion |
| `serial_estimate_seconds` | number | Sum of all individual task durations (sequential estimate) |
| `parallel_efficiency` | number | `serial_estimate / elapsed` — higher means better parallelism. 1.0 = no benefit; >1.0 = parallel speedup |
| `duration_distribution` | object | `{ min, avg, max, median }` of task durations in seconds |
| `failure_rate` | number | `failed_tasks / total_tasks` (0.0 = no failures) |
| `max_concurrent` | number | Peak number of simultaneously in-progress tasks |
| `deviation_count` | number | Total deviations across all tasks |
| `total_tasks` | number | Total number of tasks in the swarm |
| `completed_tasks` | number | Tasks with `status === "completed"` |
| `failed_tasks` | number | Tasks with `status === "failed"` |

### When to Write

Once, during finalization (Step 17), after all tasks complete and after verification (if run).

### Computation Procedure

1. Read all progress files in `{tracker_root}/dashboards/{dashboardId}/progress/`.
2. For each completed task, compute its duration: `completed_at - started_at` (in seconds).
3. Compute the following metrics:

| Metric | How to compute |
|---|---|
| `elapsed_seconds` | Latest `completed_at` across all workers minus earliest `started_at` across all workers |
| `serial_estimate_seconds` | Sum of all individual task durations (what it would take if tasks ran sequentially) |
| `parallel_efficiency` | `serial_estimate_seconds / elapsed_seconds` (higher = better parallelism; 1.0 = no benefit; >1.0 = parallel speedup) |
| `duration_distribution` | `{ min, avg, max, median }` of individual task durations in seconds |
| `failure_rate` | `failed_tasks / total_tasks` (0.0 = no failures) |
| `max_concurrent` | Peak number of simultaneously in-progress tasks (compute from overlapping `started_at`/`completed_at` windows) |
| `deviation_count` | Total deviations across all tasks (sum of all `deviations[]` array lengths) |
| `total_tasks` | Total number of tasks in the swarm |
| `completed_tasks` | Count of tasks with `status === "completed"` |
| `failed_tasks` | Count of tasks with `status === "failed"` |

4. Write the metrics file atomically.
5. Log the metrics summary to `dashboards/{dashboardId}/logs.json`:

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Metrics: {elapsed_seconds}s elapsed, {parallel_efficiency}x efficiency, {max_concurrent} max concurrent, {failure_rate} failure rate",
  "task_name": "{task-slug}"
}
```

### Notes

- This file is NOT watched by the server for live updates. It is a post-hoc analysis artifact.
- Workers never read or write it.
- The dashboard may optionally read it for a metrics summary panel in future versions.
