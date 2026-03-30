# `!add_task [--dashboard {id}] {prompt}`

**Purpose:** Inject new tasks into an active swarm mid-flight. The master deeply analyzes the prompt, decomposes it into subtasks, resolves dependencies against all existing tasks (both directions), updates the dashboard, and dispatches any tasks whose dependencies are already satisfied.

**Syntax:**
- `!add_task {prompt}` — Add tasks to the active swarm (uses your assigned dashboard)
- `!add_task --dashboard a3f7k2 {prompt}` — Add tasks to a specific dashboard's swarm

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Prerequisites

- An active swarm must exist on the target dashboard — `initialization.json` must have a valid `task` object with at least one agent in `agents[]`.
- If no active swarm exists, report: "No active swarm on dashboard `{dashboardId}`. Use `!p_track` to start a new swarm."
- The `ide` dashboard is never valid for this command — it is reserved for the IDE agent.

---

## Steps

### Step 1 — Parse Arguments

Parse the optional `--dashboard {id}` flag. If present, use the specified dashboard ID. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

Extract `{prompt}` as everything after the dashboard flag (or everything after `!add_task` if no flag).

### Step 2 — Read Current Swarm State

Read these files from `{tracker_root}/dashboards/{dashboardId}/`:

1. **`initialization.json`** — The full plan. Validate that `task` is not null and `agents[]` is non-empty. If invalid, report the prerequisite error and stop.
2. **All progress files** from `progress/` — Build three sets:
   - **Completed set:** All `task_id` where `status === "completed"`
   - **In-progress set:** All `task_id` where `status === "in_progress"`
   - **Pending set:** All agent IDs from `initialization.json` that have no progress file or `status === "pending"`
3. **`master_state.json`** — Read the current checkpoint for `next_agent_number` and `upstream_results`.

### Step 3 — Read Master Task File

Read the master task file at `{tracker_root}/tasks/{date}/parallel_{task_name}.json` to get full task context (descriptions, file lists, critical details) for all existing tasks. This is needed for dependency analysis.

### Step 4 — Read Project Context

1. Read `{project_root}/CLAUDE.md` for project conventions (if not already cached from the swarm).
2. Read any files referenced in `{prompt}` or that are clearly relevant to the new work.
3. If the prompt references areas of the codebase the master hasn't seen, read those files now — **understand before planning.**

### Step 5 — Deep Analysis of the Prompt

Analyze the prompt thoroughly. Determine:

- **Scope:** What does this work actually entail? What files will be touched?
- **Relationship to existing work:** Does this extend, modify, or depend on any existing tasks in the swarm?
- **Granularity:** Can this be a single task, or does it need decomposition into multiple subtasks?
- **Risk:** Does any new task conflict with an in-progress task's files?

**Do not rush this step.** The quality of the decomposition determines the success of the injected tasks. Read any additional files needed to fully understand the scope.

### Step 6 — Decompose into Subtasks

Break the prompt into **1 or more** right-sized subtasks (1-5 minutes each per worker). For each new task, define:

| Field | Required | Notes |
|---|---|---|
| `title` | Yes | Short verb phrase, ~40 chars max |
| `description` | Yes | Detailed description of what the worker must do |
| `context` | Yes | Architectural context, current file state, patterns to follow |
| `critical` | If applicable | Gotchas, edge cases, non-obvious constraints |
| `files` | Yes | List of files with actions (read, modify, create) |
| `tags` | Recommended | Domain labels: frontend, backend, types, tests, config, etc. |
| `layer` | Recommended | Category badge for the dashboard card |
| `directory` | Recommended | Target directory for the dashboard card |

Follow the same task quality standards as `p_track` planning — each task must be self-contained, verifiable, and have clear success criteria.

### Step 7 — Dependency Resolution

This is the most critical step. Resolve dependencies in **both directions:**

#### 7A — Forward Dependencies (new tasks depend on existing tasks)

For each new task, determine which existing tasks it depends on:
- If it needs code that an existing completed task produced → add that task ID to `depends_on`
- If it needs code that an existing in-progress or pending task will produce → add that task ID to `depends_on`
- If it needs code from another new task being added in this batch → add that new task's ID to `depends_on`

#### 7B — Reverse Dependencies (existing tasks should depend on new tasks)

Check all existing **pending** tasks (not yet dispatched, not in-progress, not completed):
- If an existing pending task would benefit from or requires the output of a new task → add the new task's ID to that existing task's `depends_on` array
- **NEVER modify `depends_on` for completed or in-progress tasks** — only pending tasks can have their dependencies updated

#### 7C — Inter-Task Dependencies (between new tasks)

If multiple new tasks are being added, resolve dependencies among them using the same rules as standard planning.

#### 7D — Validation

Before proceeding, validate:
1. **No circular dependencies** — Run a topological sort on the full dependency graph (existing + new). If a cycle is detected, report it and stop.
2. **No file conflicts with in-progress tasks** — If a new task modifies a file that an in-progress worker is currently modifying, **warn the user** and ask for confirmation. The risk of merge conflicts is high.
3. **All `depends_on` references exist** — Every task ID referenced in any `depends_on` array must exist in `agents[]` (including the new agents about to be added).

### Step 8 — Assign Wave and ID

For each new task:

1. **Determine wave number** based on dependency depth:
   - If all dependencies are completed → assign to the lowest existing wave that makes visual sense, or create a new wave
   - If dependencies include pending/in-progress tasks → assign to a wave >= the highest dependency's wave + 1
   - If no dependencies → assign to wave 1 (or the lowest appropriate wave)

2. **Generate task ID** using the format `"{wave}.{next_index}"`:
   - Find the highest existing index in the target wave
   - Increment by 1
   - Example: if wave 3 has tasks 3.1, 3.2, 3.3, the next task is 3.4

3. **If a new wave is needed** (wave number exceeds `total_waves`):
   - Create a new `waves[]` entry with the next sequential ID
   - Give it a descriptive name reflecting the new tasks
   - Set `total` to the count of new tasks in this wave

### Step 9 — Update initialization.json

**Atomic write — read → parse → modify → stringify → write.**

1. Append each new task to `agents[]`:
   ```json
   {
     "id": "{wave}.{index}",
     "title": "{title}",
     "wave": {wave_number},
     "layer": "{layer}",
     "directory": "{directory}",
     "depends_on": ["{dep_id_1}", "{dep_id_2}"]
   }
   ```

2. If any existing pending task's `depends_on` was modified (Step 7B), update those entries in `agents[]`.

3. Add new `waves[]` entries if new waves were created. Update existing `waves[].total` if tasks were added to existing waves.

4. Update `task.total_tasks` to reflect the new total.

5. Update `task.total_waves` if new waves were added.

6. If using Chains mode (`task.type === "Chains"`):
   - Add new tasks to existing chains if they extend an existing dependency path
   - Create new `chains[]` entries if the tasks represent a new independent path
   - Every new agent must appear in exactly one chain

### Step 10 — Update Master Task File

Read `{tracker_root}/tasks/{date}/parallel_{task_name}.json`, then append new tasks to the appropriate waves:

```json
{
  "id": "{wave}.{index}",
  "title": "{title}",
  "description": "{full description}",
  "directory": "{directory}",
  "depends_on": ["{dep_ids}"],
  "context": "{architectural context}",
  "critical": "{gotchas and constraints}",
  "tags": ["{tag1}", "{tag2}"],
  "files": [
    { "action": "modify", "path": "{file_path}" }
  ],
  "status": "pending",
  "assigned_agent": null,
  "started_at": null,
  "completed_at": null,
  "summary": null,
  "logs": []
}
```

If the task was added to an existing wave, insert it into that wave's `tasks[]` array. If a new wave was created, append the wave object.

Update `metadata.total_tasks` and `metadata.total_waves` to match.

If any existing pending task's `depends_on` was rewired (Step 7B), update those entries in the task file too.

### Step 11 — Update logs.json

Append log entries for the task addition event. Use atomic append (read → parse → append → stringify → write).

**First, log the addition event:**
```json
{
  "timestamp": "{live timestamp via date -u}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Added {N} new task(s) via !add_task: {task_ids} — {brief summary of what was added}",
  "task_name": "{task.name}"
}
```

**If any existing task's dependencies were rewired (Step 7B), log that too:**
```json
{
  "timestamp": "{live timestamp via date -u}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Rewired dependencies: task {existing_id} now depends on [{new_dep_ids}] (added via !add_task)",
  "task_name": "{task.name}"
}
```

### Step 12 — Update master_state.json

Write a full checkpoint reflecting the new state:

- Add new task IDs to `ready_to_dispatch` (if their dependencies are all satisfied) or leave them out (blocked)
- Preserve all existing fields (`completed`, `in_progress`, `failed`, `upstream_results`, `permanently_failed`)
- Update `last_updated` with a live timestamp

### Step 13 — Eager Dispatch

Run the standard eager dispatch protocol from `agent/master/eager_dispatch.md`:

1. **Build completed set** from progress files
2. **Build in-progress set** from progress files
3. **Find dispatchable tasks** among the new tasks — any new task whose `depends_on` entries are ALL in the completed set
4. **Dispatch all dispatchable tasks** using the full worker prompt template from `agent/master/worker_prompts.md`
   - Include `UPSTREAM RESULTS` for each completed dependency
   - Include `SIBLING TASKS` if relevant
   - Include `{dashboardId}`, `{tracker_root}`, and `{project_root}` in every worker prompt
5. **Log each dispatch** to `logs.json`
6. **Update `master_state.json`** with the dispatch results

**Display a summary** to the user:
```
Added {N} task(s) to swarm "{task_name}" on dashboard {dashboardId}:
  - {id}: {title} [dispatched | pending — waiting on {dep_ids}]
  - {id}: {title} [dispatched | pending — waiting on {dep_ids}]
{M} task(s) dispatched immediately, {K} task(s) waiting on dependencies.
```

---

## Edge Cases

### No active swarm
Report: "No active swarm on dashboard `{dashboardId}`. Use `!p_track` to start a new swarm." Stop.

### All existing tasks completed
Valid scenario. New tasks with no dependencies or dependencies on completed tasks are dispatched immediately. Useful for adding follow-up work after a swarm finishes but before archiving.

### File conflict with in-progress task
Warn the user: "New task `{new_id}` modifies `{file_path}`, which is currently being modified by in-progress task `{existing_id}`. This may cause merge conflicts." Ask for confirmation before proceeding.

### Circular dependency detected
Report: "Circular dependency detected: {cycle_path}. Cannot add these tasks." Stop. Show the cycle so the user can restructure.

### Single task (no decomposition needed)
Valid. Not every prompt needs multiple subtasks. If the work is atomic and right-sized, create a single task.

### Prompt references work not in the current swarm
The new tasks may be unrelated to the existing swarm's original goal. This is fine — the command adds tasks to the existing swarm infrastructure regardless of thematic alignment. The master should still analyze dependencies accurately.

---

## What This Command Does NOT Do

- **Does not archive or reset the dashboard** — it appends to the active swarm
- **Does not re-plan existing tasks** — only adds new ones and optionally rewires pending task dependencies
- **Does not modify completed or in-progress tasks** — those are immutable
- **Does not write code** — the master remains an orchestrator; workers do the implementation
- **Does not start a new swarm** — use `!p_track` for that
