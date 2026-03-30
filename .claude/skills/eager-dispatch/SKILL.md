---
name: eager-dispatch
description: >
  Run a standalone eager dispatch round on an active Synapse swarm. Reads current
  dashboard state, identifies all tasks whose dependencies are satisfied but haven't
  been dispatched, and dispatches them ALL immediately with full worker prompts.
  Use for recovering from stalls, manual intervention after pauses, or ensuring
  no dispatchable tasks are sitting idle.
argument-hint: "[--dashboard <id>]"
user-invocable: true
context: fork
model: opus
---

# Eager Dispatch — !eager_dispatch

## Purpose

Run a single, comprehensive eager dispatch round on an active swarm. This skill reads the current dashboard state, reconstructs the dependency graph, identifies every task that is ready to dispatch, builds complete worker prompts (with upstream results, conventions, and reference code), and dispatches them all immediately.

**Use cases:**
- Recovering from a stalled swarm where the master died mid-execution
- Manual intervention after a circuit breaker pause
- Ensuring nothing is sitting idle when you suspect tasks were missed
- Kicking off dispatch after a plan has been approved but execution never started

**This is NOT a replacement for the `!p_track` execution loop.** It runs a single dispatch pass and exits. It does not monitor completions, handle failures, or run the circuit breaker. For full lifecycle management, use `!p_track_resume`.

## NON-NEGOTIABLE RULES

The master-protocol skill provides your core identity and constraints. Follow them absolutely.

## Dynamic Context

!`echo "PROJECT_ROOT: $(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null || echo 'UNSET — resolve before dispatch')"`
!`echo "TRACKER_ROOT: $(pwd)"`
!`echo "DATE: $(date -u +%Y-%m-%dT%H:%M:%SZ)"`
!`echo "AVAILABLE_DASHBOARDS: $(ls dashboards/ 2>/dev/null | grep -v ide | tr '\n' ' ')"`
!`echo "DASHBOARD_STATES: $(for d in $(ls dashboards/ 2>/dev/null | grep -v ide); do init=$(cat dashboards/$d/initialization.json 2>/dev/null | jq -r '.task.name // empty' 2>/dev/null); prog=$(ls dashboards/$d/progress/ 2>/dev/null | wc -l | tr -d ' '); echo \"$d:task=${init:-empty},progress=$prog\"; done | tr '\n' ' ')"`

## Project Context

!`cat "$(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null)/CLAUDE.md" 2>/dev/null | head -100 || echo "No project CLAUDE.md found — scan the project structure to understand the codebase layout."`

---

## Phase 1: State Reconstruction (Steps 1-5)

### Step 1: Resolve the Dashboard

**If your system prompt contains a `DASHBOARD ID:` directive:** Use it unconditionally. You have no access to any other dashboard.

**If `--dashboard {id}` was specified:** Use it directly.

**If none of the above apply:** Ask the user which dashboard to target. Do not scan or select one yourself.

### Step 2: Read Full Dashboard State

Read in parallel:
1. **`initialization.json`** — Full plan: task metadata, agents array, waves, chains, `task.project_root`.
2. **All progress files** from `progress/` — Build status map: `{ task_id -> { status, summary, deviations, started_at, completed_at } }`.
3. **`logs.json`** — Scan for highest `Agent {N}` reference to determine `next_agent_number`.
4. **`master_state.json`** (if exists) — Previous master cache: upstream results, `next_agent_number`.

### Step 3: Locate and Read Master Task File

1. Extract `task.name` (slug) and `task.created` (date) from `initialization.json`.
2. Look for: `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
   - Fallback: `{tracker_root}/tasks/*/parallel_{task_name}.json`
3. **Read the full master task file** — you need every task's `description`, `context`, `critical`, `files`, `tags`, `depends_on`.

### Step 4: Read Project Context

1. **Resolve `{project_root}`** from `task.project_root` in `initialization.json`. Fallback: `.synapse/project.json` -> CWD.
2. **Read `{project_root}/CLAUDE.md`** if it exists.
3. **Build convention_map** from CLAUDE.md — categorize by: `naming`, `file_structure`, `imports`, `frontend_styling`, `backend_api`, `error_handling`, `testing`, `types`.

### Step 5: Build Upstream Result Cache

1. **Start with `master_state.json`** (if exists) — its `upstream_results` has one-line summaries per completed task.
2. **Cross-reference against progress files** (progress files are authoritative):
   - For each `status: "completed"` progress file, verify cache has an entry.
   - If missing, reconstruct from `summary`, `milestones[]`, and `deviations[]`.
3. If no `master_state.json`, build entire cache from completed progress files.
4. **Determine `next_agent_number`:**
   - From `master_state.json` if available.
   - Otherwise, scan `logs.json` for highest `Agent {N}` reference, set to N+1.

---

## Phase 2: Identify Dispatchable Tasks (Step 6)

### Step 6: Run the Eager Dispatch Scan

Follow the protocol from `{tracker_root}/agent/master/eager_dispatch.md`:

**6A — Build the completed set.** From progress files, collect every `task_id` where `status === "completed"`.

**6B — Build the in-progress set.** From progress files, collect every `task_id` where `status === "in_progress"`.

**6C — Build the failed set.** From progress files, collect every `task_id` where `status === "failed"`.

**6D — Find all dispatchable tasks.** Iterate `agents[]` in `initialization.json`. A task is dispatchable if and only if:
- Its `id` is NOT in the completed set
- Its `id` is NOT in the in-progress set
- Its `id` is NOT in the failed set (failed tasks need `!retry`, not fresh dispatch)
- EVERY ID in its `depends_on` array IS in the completed set
- It has no progress file, OR its progress file has `status: "pending"`

**6E — Present the dispatch summary:**

```markdown
## Eager Dispatch Assessment: {task-slug}

**Dashboard:** {dashboardId}
**Project:** {project_root}

### Swarm State
| Status | Count | Tasks |
|---|---|---|
| Completed | {N} | {task_ids} |
| In Progress | {N} | {task_ids} |
| Failed | {N} | {task_ids} |
| Dispatchable NOW | {N} | {task_ids} |
| Blocked (deps not met) | {N} | {task_ids} |

### Will Dispatch: {N} tasks
{For each dispatchable task:}
- **{id}**: {title} — deps satisfied: [{dep_ids}]

### Blocked: {N} tasks
{For each blocked task:}
- **{id}**: {title} — waiting on: [{unsatisfied_dep_ids}]

### Failed (not auto-retried): {N} tasks
{For each failed task:}
- **{id}**: {title} — use `!retry {id}` to re-dispatch
```

If no tasks are dispatchable, report: "No tasks ready for dispatch. {N} in progress, {M} blocked, {F} failed." and exit.

If tasks are dispatchable, output: `Ready to dispatch {N} tasks. Proceed?`

**Wait for user approval before dispatching.**

---

## Phase 3: Dispatch (Steps 7-9)

### Step 7: Read Worker Prompt Resources

Read in parallel:
1. `{tracker_root}/agent/master/worker_prompts.md` — full prompt template
2. `{tracker_root}/agent/instructions/tracker_master_instructions.md` — master reference

### Step 8: Build and Dispatch Worker Prompts

Build worker prompts using the standard `p_track_v2` template. See the p-track skill for the full worker prompt template, or read `agent/master/worker_prompts.md`. The `validate-worker-prompt.sh` hook enforces prompt completeness at dispatch time.

### Dispatch Execution

**A. Launch agents FIRST** — dispatch via Task tool with the full prompt. Dispatch ALL dispatchable tasks simultaneously.

**B. Update tracker AFTER dispatch (NON-NEGOTIABLE):**

For each dispatched task, append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{ISO 8601 via date -u}",
  "task_id": "{id}",
  "agent": "Agent {N}",
  "level": "info",
  "message": "Eager dispatch: {task title}",
  "task_name": "{task-slug}"
}
```

**C. Write master state checkpoint:**

Write `{tracker_root}/dashboards/{dashboardId}/master_state.json`:
```json
{
  "last_updated": "{ISO 8601}",
  "completed": [{"id": "...", "summary": "..."}],
  "in_progress": ["{all in-progress + newly dispatched task IDs}"],
  "failed": [{"id": "...", "summary": "..."}],
  "ready_to_dispatch": [],
  "upstream_results": {rebuilt cache},
  "next_agent_number": {N},
  "permanently_failed": []
}
```

### Step 9: Report

Output a summary:

```markdown
## Eager Dispatch Complete

Dispatched {N} tasks: {task_ids with titles}
Next agent number: {N}

**Note:** This was a single dispatch pass. Workers are now running independently.
- To monitor: check the dashboard or run `!status`
- To process completions and dispatch downstream tasks: use `!p_track_resume` or run `!eager_dispatch` again after workers complete
- To retry failed tasks: use `!retry {id}`
```

---

## Dispatch & Tracking Rules

See master-protocol skill for the complete dispatch and tracking rules.

## Module References

- Eager dispatch protocol: `agent/master/eager_dispatch.md`
- Worker prompt template: `agent/master/worker_prompts.md`
- Master instructions: `agent/instructions/tracker_master_instructions.md`
- Worker instructions: `agent/instructions/tracker_worker_instructions.md`
- Failure recovery: `agent/master/failure_recovery.md`
- Dashboard writes: `agent/master/dashboard_writes.md`

---

Execute eager dispatch for: $ARGUMENTS
