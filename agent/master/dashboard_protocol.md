# Dashboard Protocol — `!p` vs `!p_track` Modes

This document defines when and how the master agent interacts with dashboard files for each execution mode. Both `!p` and `!p_track` populate the dashboard — the difference is granularity.

---

## Mode Overview

| Mode | Dashboard Interaction | Summary |
|---|---|---|
| **`!p_track`** | Continuous real-time tracking | Plan + live progress + final results |
| **`!p`** | Bookend snapshots (before + after) | Plan + final results (no live progress) |

Both modes ensure the dashboard always has a visual record of what was planned and what happened. The user sees the plan structure on the dashboard regardless of which mode is used.

---

## `!p_track` Mode — Full Tracking

Full real-time dashboard tracking with live worker progress, continuous event logging, state checkpoints, and post-completion metrics.

### Files Written

| File | Who Writes | When | Frequency |
|---|---|---|---|
| `initialization.json` | Master | Planning phase | **Write-once** (exceptions: repair tasks, circuit breaker replanning) |
| `logs.json` | Master | Every event | Continuous — dispatch, completion, failure, deviation, permission |
| `progress/{task_id}.json` | Workers | Throughout execution | Every stage transition, milestone, deviation, completion |
| `master_state.json` | Master | After every dispatch event | Continuous — checkpoint for context compaction recovery |
| `metrics.json` | Master | After swarm completes | **Write-once** — post-hoc performance analysis |

### Write Timeline

```
Planning Phase
  1. Archive previous dashboard data (if any) -> Archive/{date}_{name}/
  2. Clear progress/ directory
  3. Write initialization.json with full plan (task, agents[], waves[], chains[])
  4. Write init log entry to logs.json
  5. Present plan to user on dashboard

Dispatch Phase
  6. Dispatch workers -> log each dispatch to logs.json
  7. Workers write progress files on start, stage transitions, milestones, deviations
  8. Master writes master_state.json after each dispatch/completion/failure
  9. On worker completion -> master logs to logs.json, scans for newly unblocked tasks
  10. On worker failure -> master logs to logs.json, creates repair task if appropriate
  11. On worker deviation -> master logs deviation to logs.json

Completion Phase
  12. All workers done -> master logs completion summary to logs.json
  13. Master computes and writes metrics.json
  14. Dashboard shows full history: plan + live progress trail + final results
```

### Dashboard Behavior

- Real-time updates via SSE for all data changes
- Stat cards derive counts from progress files (completed, in-progress, failed, pending)
- Elapsed timer derives from earliest worker `started_at` to latest `completed_at`
- Agent cards show live stage badges, milestone messages, and deviation counts
- Log panel shows all `logs.json` entries with level filtering
- Agent detail modals show per-worker `logs[]` from progress files

**IDE exclusion:** The `ide` dashboard is reserved for the IDE agent. Swarm agents use only their assigned dashboard.

---

## `!p` Mode — Lightweight Dashboard

Snapshot-based dashboard interaction: one write before dispatch (plan), one write after completion (results). No live tracking during execution.

### Files Written

| File | Who Writes | When | Frequency |
|---|---|---|---|
| `initialization.json` | Master | Once before dispatch | **Write-once** — plan snapshot |
| `logs.json` | Master | Before dispatch + after completion | **Two write windows** — init entry, then final batch |
| `progress/{task_id}.json` | -- | -- | **Not written** — workers do NOT write progress files in `!p` mode |
| `master_state.json` | -- | -- | **Not written** |
| `metrics.json` | -- | -- | **Not written** |

### Write Timeline

```
Planning Phase
  1. Archive previous dashboard data (if any) -> Archive/{date}_{name}/
  2. Clear progress/ directory
  3. Write initialization.json with plan snapshot:
     - task: { name, type, directory, prompt, project, project_root, created, total_tasks, total_waves }
     - agents[]: { id, title, wave, depends_on } for each task
     - waves[]: { id, name, total } for each wave
     - chains[]: (if applicable)
  4. Write ONE init log entry to logs.json:
     "Task initialized: {name} -- {N} tasks across {W} waves"
  5. Present plan to user (inline + visible on dashboard)

Dispatch Phase
  6. Dispatch workers -- NO dashboard writes during execution
  7. Workers execute in {project_root} -- NO progress files written
  8. Master processes returns in memory -- NO logs.json updates during execution
  9. Standard eager dispatch loop continues (dependency-driven)

Completion Phase
  10. All workers done -> master appends final log entries to logs.json:
      - One entry per completed task: level "info", message "Completed: {title} -- {summary}"
      - One entry per failed task: level "error", message "FAILED: {title} -- {error}"
      - One summary entry: level "info", message "Swarm complete: {completed}/{total} tasks succeeded in {duration}"
  11. Dashboard shows: plan structure + final result log entries
```

### initialization.json Content

The `!p` mode writes the **same schema** as `!p_track`. The dashboard renders the same plan view regardless of mode.

```json
{
  "task": {
    "name": "{task-slug}",
    "type": "Waves",
    "directory": "{affected directory}",
    "prompt": "{user prompt}",
    "project": "{project name}",
    "project_root": "{project_root}",
    "created": "{ISO 8601}",
    "total_tasks": 4,
    "total_waves": 2
  },
  "agents": [
    { "id": "1.1", "title": "...", "wave": 1, "layer": "backend", "directory": "src/api", "depends_on": [] },
    { "id": "1.2", "title": "...", "wave": 1, "depends_on": [] },
    { "id": "2.1", "title": "...", "wave": 2, "depends_on": ["1.1"] }
  ],
  "waves": [
    { "id": 1, "name": "Independent setup", "total": 2 },
    { "id": 2, "name": "Integration", "total": 1 }
  ],
  "chains": [],
  "history": []
}
```

### logs.json Entries

Only three write moments:

| Moment | `task_id` | `agent` | `level` | Message Pattern |
|---|---|---|---|---|
| Plan written | `"0.0"` | `"Orchestrator"` | `"info"` | `"Task initialized: {name} -- {N} tasks across {W} waves"` |
| Worker completes | `"{wave}.{idx}"` | `"Agent N"` | `"info"` | `"Completed: {title} -- {summary}"` |
| Worker fails | `"{wave}.{idx}"` | `"Agent N"` | `"error"` | `"FAILED: {title} -- {error}"` |
| All done | `"0.0"` | `"Orchestrator"` | `"info"` | `"Swarm complete: {completed}/{total} tasks succeeded in {duration}"` |

### Dashboard Behavior

- Dashboard shows the plan layout (waves, agent cards, dependency lines) immediately after initialization.json is written
- All agent cards remain in "pending" state during execution (no progress files to derive status from)
- Log panel shows the initialization entry during execution
- After completion, log panel shows per-task results and the final summary
- No live stage badges, no milestone messages, no elapsed timers on individual cards
- Stat cards show Total and Pending only during execution (no progress files = no Completed/In Progress/Failed counts)

**IDE exclusion:** The `ide` dashboard is reserved for the IDE agent. Swarm agents use only their assigned dashboard.

### Worker Prompt Differences

Workers dispatched via `!p` do NOT receive progress file instructions. Their prompts use `TEMPLATE_VERSION: p_v2` and omit:
- `tracker_root` path (not needed — no progress files to write)
- Dashboard ID
- Progress file path
- Any reference to `tracker_worker_instructions.md`

Workers still return structured results (STATUS, SUMMARY, FILES CHANGED, etc.) to the master via the Task tool return value.

---

## Automatic Parallel Mode

When the master agent decides to parallelize automatically (without the user invoking `!p` or `!p_track`), it evaluates the **full tracking thresholds** to determine which dashboard mode to use:

### Full Tracking Thresholds (auto-escalation to `!p_track` mode)

| Condition | Tracking Level | Non-Negotiable? |
|---|---|---|
| **3+ parallel agents** | Full `!p_track` tracking | Yes |
| **More than 1 wave** | Full `!p_track` tracking | **Absolutely non-negotiable** |
| <3 agents AND 1 wave | Lightweight `!p` tracking | — |

**When thresholds are met (3+ agents OR >1 wave):**
- Master writes `initialization.json`, continuous `logs.json`, `master_state.json`, and `metrics.json`
- Workers write progress files to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`
- Worker prompts include `INSTRUCTION MODE: FULL | LITE` and the path to `tracker_worker_instructions.md` or `tracker_worker_instructions_lite.md`
- Full live dashboard with real-time stage badges, milestones, elapsed timers
- Master informs the user: "Swarm has {N} agents across {W} waves — using full dashboard tracking."

**When thresholds are NOT met (<3 agents AND 1 wave):**
- Same data writes as `!p` mode (lightweight)
- Master writes `initialization.json` before dispatch and `logs.json` entries at init + completion
- Workers do NOT write progress files
- No `master_state.json` or `metrics.json`
- Master informs the user before entering parallel mode

> **The >1 wave threshold is absolutely non-negotiable.** Multi-wave swarms have dependency chains, sequential phases, and longer execution times — the user MUST have full dashboard visibility. Even a 2-task swarm with 2 waves gets full tracking.

---

## Comparison Table

| Feature | `!p` | `!p_track` |
|---|---|---|
| initialization.json | Write once before dispatch | Write once during planning |
| logs.json | Init entry + final entries | Continuous event logging |
| Worker progress files | **No** | **Yes** — workers write throughout |
| master_state.json | **No** | **Yes** — checkpoint after every event |
| metrics.json | **No** | **Yes** — computed after completion |
| Master task file | **No** | **Yes** — written + updated throughout |
| Plan rationale (.md) | **No** | **Yes** — written during planning |
| Live dashboard updates | **No** (static during execution) | **Yes** (real-time) |
| Live stage badges | **No** | **Yes** |
| Live milestones | **No** | **Yes** |
| Deviation tracking | Return-only (master logs at end) | Real-time (worker + master) |
| Elapsed timer | Not available (no progress data) | Per-agent + overall |
| State recovery | Not available | Via master_state.json |
| Post-swarm metrics | Not available | Computed and stored |
| Repair tasks | Not supported | Supported (appended to initialization.json) |
| Circuit breaker | Manual only (pause + assess) | Automatic replanning |
| Archive on clear | **Required** | **Required** |
| Dashboard selection | Same priority chain | Same priority chain |
| Overhead | Minimal — 2 write windows | Full — continuous writes by master + workers |
| Best for | Focused tasks, speed over visualization | Large swarms, live monitoring matters |

---

## Dashboard Selection — Both Modes

Both `!p` and `!p_track` follow the same dashboard selection priority chain:

1. **Assigned dashboard (NON-NEGOTIABLE)** — Your system prompt contains a `DASHBOARD ID:` directive. Use it unconditionally. **You have no read or write access to any other dashboard.** If it contains previous data, **ask the user** if they want to archive it and set up the new dashboard — do not proceed without approval.
2. **Explicit flag** — `--dashboard {id}` forces a specific dashboard.
3. **No dashboard?** Ask the user. Never scan or select one yourself.

See `agent/instructions/dashboard_resolution.md` for the full protocol.

---

## Archive Before Clear — Both Modes

Both modes **must** archive before clearing a dashboard that has previous data. This is non-negotiable regardless of execution mode.

1. Read `initialization.json`. If `task` is not `null`, the dashboard has previous data.
2. Copy the full dashboard directory to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`.
3. Clear: delete progress files, reset `initialization.json` and `logs.json` to empty state.

---

## Decision Flowchart

```
User gives task
       |
       v
Is it !p_track? ----YES----> FULL TRACKING MODE
       |                      - Write initialization.json (full plan)
       NO                     - Workers write progress files
       |                      - Master writes logs, state, metrics
       v                      - Full live dashboard
Is it !p? ----------YES----> LIGHTWEIGHT MODE
       |                      - Write initialization.json (plan snapshot)
       NO                     - Workers do NOT write progress files
       |                      - Master writes init + final log entries only
       v                      - Dashboard shows plan + final results
Does master decide
to parallelize? ----YES----> CHECK THRESHOLDS
       |                      |
       NO                     v
       |              3+ agents OR >1 wave?
       v                |             |
SERIAL MODE            YES            NO
No dashboard writes     |             |
Execute directly        v             v
                  FULL TRACKING    LIGHTWEIGHT
                  (same as         (same as !p)
                   !p_track)       - Plan snapshot
                  - Workers write  - No progress files
                    progress files
                  - Full live
                    dashboard
```

> **Critical:** The `>1 wave` threshold is non-negotiable. Multi-wave swarms ALWAYS get full dashboard tracking regardless of agent count. The `3+ agents` threshold applies even for single-wave swarms.

---

## Key Rules

1. **Always write initialization.json before dispatching** — in all parallel modes. The dashboard must show the plan before workers start.
2. **Always archive before clearing** — if a dashboard has previous data, archive it before writing new plan data. This applies to all modes.
3. **Workers write progress files in full tracking mode** — in `!p_track` and in auto-parallel that meets the full tracking thresholds (3+ agents OR >1 wave), workers write progress files. In `!p` mode and sub-threshold auto-parallel, workers do NOT write progress files.
4. **logs.json is always written** — even in lightweight mode, initialization and completion entries are logged so the dashboard has a record.
5. **initialization.json is write-once** — the only exceptions are repair task creation and circuit breaker replanning (both only in `!p_track` mode).
6. **Clear progress/ before writing initialization.json** — in all modes, ensure the progress directory is empty before writing the new plan.
7. **Use the correct worker template** — `p_track_v2` for full tracking (includes progress instructions), `p_v2` for lightweight (omits progress instructions).
8. **Master writes progress files in lightweight/serial mode** — When workers do NOT write their own progress files (`!p` mode, sub-threshold auto-parallel, or serial dispatch), the master MUST create a minimal progress file for each completed task using the worker's return data. This ensures the dashboard always shows file changes, summaries, and completion status. See **Master-Written Progress Files** below.

---

## Master-Written Progress Files (Lightweight/Serial Mode)

When workers don't write their own progress files, the master bridges the gap by creating a progress file from each worker's return. This is **mandatory** — without it, the dashboard has no file change tracking or per-task detail for lightweight dispatches.

### When This Applies

- `!p` mode (all workers)
- Sub-threshold auto-parallel (<3 agents AND single wave)
- Serial dispatch (single worker, no dashboard) — skip if no dashboard is active

### What to Write

After each worker returns, the master writes:

```
{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

### Minimal Progress File Schema

```json
{
  "task_id": "{task_id}",
  "dashboard_id": "{dashboardId}",
  "status": "completed",
  "started_at": "{dispatch_timestamp}",
  "completed_at": "{completion_timestamp}",
  "summary": "{from worker STATUS/SUMMARY return}",
  "assigned_agent": "Agent {N}",
  "stage": "completed",
  "message": "Task complete",
  "milestones": [],
  "deviations": [],
  "logs": [
    { "at": "{dispatch_timestamp}", "level": "info", "msg": "Task dispatched in lightweight mode" },
    { "at": "{completion_timestamp}", "level": "info", "msg": "{worker summary}" }
  ],
  "files_changed": [
    { "path": "relative/path/to/file", "action": "created|modified|deleted" }
  ]
}
```

### How to Populate `files_changed`

Parse the worker's `FILES CHANGED:` return section. Each line has a prefix (`created`, `modified`, `deleted`) and a path. Convert to the JSON format:

```
Worker returns:         →  files_changed entry:
created src/auth.ts     →  { "path": "src/auth.ts", "action": "created" }
modified src/index.ts   →  { "path": "src/index.ts", "action": "modified" }
deleted src/old.ts      →  { "path": "src/old.ts", "action": "deleted" }
```

### For Failed Workers

If a worker returns `STATUS: failed`, write the progress file with `status: "failed"`, `stage: "failed"`, and extract the ERRORS section into a log entry at level `"error"`.

---

## References

- `agent/master/dashboard_writes.md` — Full initialization.json, logs.json, master_state.json, metrics.json schemas and write rules
- `agent/core/dashboard_features.md` — Dashboard UI features, layout modes, stat cards, log panel
- `agent/instructions/dashboard_resolution.md` — Dashboard selection and detection protocol
- `_commands/Synapse/p.md` — `!p` command specification
- `_commands/Synapse/p_track.md` — `!p_track` command specification
