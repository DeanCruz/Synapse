# Swarm Commands

All swarm commands are located at `{tracker_root}/_commands/Synapse/`. They manage the lifecycle of parallel agent swarms, provide monitoring and visibility, and control the dashboard server.

---

## Swarm Lifecycle Commands

### `!p_track`

**Purpose:** The primary command for parallel agent swarms. Plans, dispatches, tracks, and reports a full swarm with live dashboard updates.

**Syntax:**
```
!p_track [--dashboard dashboardN] {prompt}
```

**Arguments:**
- `{prompt}` -- Natural-language description of the work to be done
- `--dashboard dashboardN` -- (Optional) Force a specific dashboard slot. If omitted, auto-selects the first available dashboard.

**Key Behavior:**
- The invoking agent becomes the **master agent** and enters orchestrator mode
- The master reads project context, decomposes the task into atomic subtasks, maps dependencies, and presents a plan for user approval
- After approval, the master writes `initialization.json` to populate the dashboard, then dispatches worker agents via the Task tool
- Workers write progress files to `{tracker_root}/dashboards/{dashboardId}/progress/` for live dashboard updates
- Tasks are dispatched the instant their dependencies are satisfied, not when a wave completes
- The master never writes code -- it only plans, dispatches, monitors, and reports
- Includes circuit breaker logic: if 3+ tasks fail in the same wave or a failure blocks half of remaining tasks, automatic replanning is triggered

**Produces:**
- `{tracker_root}/tasks/{date}/parallel_{name}.json` -- Master task record
- `{tracker_root}/tasks/{date}/parallel_plan_{name}.md` -- Strategy rationale
- `{tracker_root}/dashboards/{dashboardId}/initialization.json` -- Dashboard plan data
- `{tracker_root}/dashboards/{dashboardId}/logs.json` -- Event log
- `{tracker_root}/dashboards/{dashboardId}/progress/*.json` -- Worker progress files

**Phases:**
1. Context and Planning (gather context, decompose tasks, present plan)
2. Execution (dispatch workers, process completions, handle failures)
3. Report (compile final summary)

---

### `!p`

**Purpose:** Lightweight parallel dispatch. Deep planning and high-quality worker prompts without any dashboard tracking overhead.

**Syntax:**
```
!p {prompt}
```

**Key Behavior:**
- Same deep planning and prompt quality as `!p_track`
- No task files, no dashboard writes, no progress files
- All plan data lives in conversation context
- Workers execute and return directly
- Best for focused tasks with fewer than 5 subtasks where live visualization is not needed

**When to use `!p` vs `!p_track`:**
- `!p` -- Fast, context-efficient. Best for quick parallel jobs without live monitoring.
- `!p_track` -- Full tracking with live dashboard. Best for large, long-running swarms.

---

### `!master_plan_track`

**Purpose:** Multi-stream orchestration. Decomposes a large body of work into multiple independent swarms, each running on its own dashboard with its own child master agent.

**Syntax:**
```
!master_plan_track {prompt}
```

**Key Behavior:**
- The invoking agent becomes the **meta-planner** -- it dispatches planner agents and child master agents, never workers directly
- Decomposes work into 2-8 independent planning streams
- Dispatches planner agents in parallel to create plans for each stream
- After user approval, dispatches child master agents to execute each stream's swarm on its own dashboard
- Manages dashboard slot allocation (up to 5 dashboards) with overflow into queue slots
- Handles queue-to-dashboard promotion as dashboards free up
- Supports cross-stream dependencies (planning is parallel, only execution dispatch is sequenced)

**Agent Hierarchy:**
```
META-PLANNER (you)
  dispatches: planner agents + child master agents

CHILD MASTER AGENTS (one per stream)
  own: one dashboard each
  dispatch: worker agents

WORKER AGENTS (many per stream)
  own: one progress file each
```

**When to use:**
- Work naturally splits into 2+ independent swarms (each with its own dependency graph)
- Tasks that would require sequential `!p_track` runs can be parallelized across dashboards

---

### `!dispatch`

**Purpose:** Manually dispatch a specific pending task or all tasks whose dependencies are satisfied.

**Syntax:**
```
!dispatch [dashboardId] {task_id}        -- Dispatch a specific task
!dispatch [dashboardId] --ready          -- Dispatch all unblocked tasks
```

**Key Behavior:**
- Validates that the task exists, is pending, and all dependencies are completed
- Reads the master task file to extract full task context for the worker prompt
- Dispatches a worker agent with a complete, self-contained prompt
- Logs the dispatch to `logs.json`
- Does not create a progress file -- the worker creates its own when it starts

---

### `!retry`

**Purpose:** Re-dispatch a failed or blocked task with a fresh agent. Includes root cause analysis from the previous attempt.

**Syntax:**
```
!retry [dashboardId] {task_id}
```

**Key Behavior:**
- Validates the task exists and has a progress file with `status: "failed"`
- If the task is `"in_progress"`, warns and asks for confirmation
- If the task is `"completed"`, warns and asks for confirmation before re-running
- Saves the previous failure summary and logs for context
- Analyzes the failure root cause by reading previous logs and relevant project files
- Deletes the old progress file so the new worker starts fresh
- Dispatches a new agent with the original task context plus retry-specific sections: previous failure summary, root cause analysis, and remediation guidance

---

### `!resume`

**Purpose:** Resume a chat session after the agent process was interrupted, crashed, or the connection was lost. Reviews conversation history, reconstructs context, and picks up where the agent left off.

**Syntax:**
```
!resume
```

**Key Behavior:**
- Reviews full conversation history to understand the original task and progress made
- Checks current file state and git status to verify what was actually completed
- Presents a status summary before continuing work
- Picks up exactly where the agent left off

---

### `!track_resume`

**Purpose:** Resume a stalled or interrupted swarm. Inspects dashboard state, identifies all incomplete tasks, and re-dispatches them with full context.

**Syntax:**
```
!track_resume [dashboardId]
```

**Key Behavior:**
- Assesses the full swarm state by reading `initialization.json`, all progress files, and `logs.json`
- Classifies every task: completed (skip), failed (retry with failure context), stale in-progress (re-dispatch with partial progress context), pending ready (dispatch), pending blocked (wait)
- Treats all `in_progress` tasks as stale (if the master is running `!track_resume`, the previous session is dead)
- Presents a resume plan for user approval
- Cleans up stale progress files and dispatches all ready tasks simultaneously
- Continues the standard execution loop: process completions, dispatch newly unblocked tasks
- Includes full resume context in worker prompts so workers know they are in a resumed swarm

**Comparison:**
| Command | Scope |
|---------|-------|
| `!track_resume` | Entire swarm -- full assessment + re-dispatch ALL incomplete tasks |
| `!dispatch --ready` | Pending only -- dispatches unblocked tasks, does not retry failed |
| `!retry {id}` | Single task -- re-dispatches one specific failed task |

---

### `!cancel`

**Purpose:** Cancel the active swarm immediately. Marks all non-completed tasks as failed.

**Syntax:**
```
!cancel [dashboardId] [--force]
```

**Key Behavior:**
- Without `--force`: writes a `"permission"` log entry (triggers dashboard popup) and asks for terminal confirmation
- With `--force`: skips confirmation
- Completed tasks are preserved -- only in-progress and pending tasks are marked as `"failed"`
- Running agents may continue in the background; their progress file writes will still succeed
- This is the one exception where the master writes progress files directly

---

### `!cancel-safe`

**Purpose:** Graceful shutdown. Stops dispatching new tasks but lets all in-progress agents finish their work naturally.

**Syntax:**
```
!cancel-safe [dashboardId]
```

**Key Behavior:**
- Sets an internal flag that prevents any new task dispatches
- Running agents continue and complete (or fail) on their own
- Polls progress files every 10 seconds until all in-progress agents finish
- After 10 minutes, warns the user and offers to force-cancel
- Once all running agents finish, marks remaining pending tasks as cancelled
- Preserves all completed and naturally-finished work intact

**Contrast with `!cancel`:** `!cancel` immediately marks in-progress agents as failed (though they may still be running). `!cancel-safe` waits for running work to finish, preserving results.

---

## Monitoring Commands

### `!status`

**Purpose:** Quick terminal summary of the current swarm state.

**Syntax:**
```
!status [dashboardId]
```

**Key Behavior:**
- Reads `initialization.json` and all progress files
- Derives all stats: completed, failed, in_progress, pending counts, overall status, elapsed time
- Displays a formatted agent table with status, wave, and summary for each task
- Includes wave summary table

---

### `!logs`

**Purpose:** View and filter event log entries from the dashboard's `logs.json`.

**Syntax:**
```
!logs [dashboardId] [--level {level}] [--task {id}] [--agent {name}] [--last {N}] [--since {HH:MM}]
```

**Filters (can be combined):**
- `--level error` -- Show only error entries (also: `info`, `warn`, `deviation`)
- `--task 2.3` -- Show logs for a specific task
- `--agent "Agent 5"` -- Show logs for a specific agent
- `--last 20` -- Show only the last 20 entries
- `--since 14:30` -- Show entries after a specific time

---

### `!inspect`

**Purpose:** Deep-dive into a specific task. Shows full context, dependencies, status timeline, milestones, deviations, and worker logs.

**Syntax:**
```
!inspect [dashboardId] {task_id}
```

**Key Behavior:**
- Reads from `initialization.json`, the task's progress file, the master task file, and `logs.json`
- Displays: status, wave, timeline (created/dispatched/completed/duration), agent info, milestones, deviations, upstream dependencies with their statuses, downstream blocks, task context and critical details, file lists, worker logs, and dashboard logs

---

### `!deps`

**Purpose:** Visualize the dependency graph for the entire swarm or a specific task.

**Syntax:**
```
!deps [dashboardId]                  -- Full dependency graph
!deps [dashboardId] {task_id}        -- Dependencies for a specific task
!deps [dashboardId] --critical       -- Highlight the critical path
!deps [dashboardId] --blocked        -- Show only blocked/failing chains
```

**Key Behavior:**
- Builds an ASCII visualization of the dependency graph with status indicators
- Identifies the critical path (longest chain from root to terminal task)
- Identifies bottlenecks (in-progress tasks with the most downstream dependents)
- For a single task, traces both upstream (needs) and downstream (blocks) chains

---

### `!history`

**Purpose:** View past swarm history from saved summary files.

**Syntax:**
```
!history [--last N]
```

**Key Behavior:**
- Reads all `.json` files from `{tracker_root}/history/`
- Displays a table with: name, project, task counts, wave count, status, duration, and cleared date
- Sorted by `cleared_at` descending (newest first)
- History summaries are created automatically when dashboards are cleared

---

### `!update_dashboard`

**Purpose:** Generate a visual progress report of the current swarm showing all completed tasks, milestones, deviations, and remaining work.

**Syntax:**
```
!update_dashboard [dashboardId]
```

**Key Behavior:**
- Read-only -- does not modify any files
- Computes swarm stats from progress files
- Shows a progress bar, wave summary table, details of the most recently completed task, a table of all completed tasks, any deviations across the swarm, and remaining pending/in-progress work
- Useful for getting a quick terminal snapshot of swarm progress

---

## Server Control Commands

### `!start`

**Purpose:** Start the Synapse dashboard server and launch the Electron app.

**Syntax:**
```
!start
```

**Key Behavior:**
- Checks if the server is already running on port 3456
- If not running, starts `node {tracker_root}/src/server/index.js` in the background
- Verifies the server is responding
- Launches the Electron app with `npm start`

---

### `!stop`

**Purpose:** Stop the Synapse dashboard server.

**Syntax:**
```
!stop
```

**Key Behavior:**
- Finds the server process on port 3456
- Kills it and confirms shutdown
- Reports if the server was not running

---

### `!reset`

**Purpose:** Clear a dashboard and reset it to empty state. Archives the previous swarm and saves a history summary.

**Syntax:**
```
!reset [dashboardId]        -- Reset a specific or auto-detected dashboard
!reset --all                -- Reset all 5 dashboards
```

**Key Behavior:**
- Saves a history summary to `{tracker_root}/history/`
- Archives the full dashboard directory to `{tracker_root}/Archive/{date}_{task_name}/` (mandatory -- never clears without archiving)
- Deletes all progress files
- Resets `initialization.json` and `logs.json` to empty state

---

## Project Management Commands

### `!project`

**Purpose:** Show, set, or clear the target project that Synapse operates on.

**Syntax:**
```
!project                        -- Show current project and resolution method
!project set /path/to/repo      -- Store a target project path
!project clear                  -- Clear stored project, revert to CWD detection
```

**Key Behavior:**
- `!project` (no args): displays the resolved `{project_root}`, how it was resolved, whether `CLAUDE.md` exists, whether `.synapse/` exists, and detected tech stack indicators
- `!project set`: validates the path, writes to `{tracker_root}/.synapse/project.json`, creates `{project_root}/.synapse/` if needed
- `!project clear`: removes the stored config so `{project_root}` resolves from CWD

---

## Utility Commands

### `!guide`

**Purpose:** Interactive command decision tree that helps users pick the right Synapse command.

**Syntax:**
```
!guide
```

**Key Behavior:**
- Displays a visual decision tree flowchart organized by task type: project setup, parallel work, monitoring, task actions, history, server control, project analysis, TOC management, and housekeeping
- Includes a complete command reference table grouped by category
- Provides quick-pick tips for common scenarios
