# Master Agent — Statusing Protocol

Status reporting is how the user and the system maintain visibility into an active swarm. This document covers the complete statusing protocol: what the master writes and when, what workers handle themselves, dashboard file management, logs.json patterns, XML updates, terminal output rules, and the permission request flow.

---

## Responsibility Split: Master vs. Workers

Status reporting is split between the master agent and worker agents. Understanding this boundary is essential.

### What Workers Handle

Workers handle ALL live progress and lifecycle data. Each worker owns a single progress file at `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` and writes the full file on every update.

Workers write:

- **Lifecycle fields** -- `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`.
- **Live progress** -- `stage`, `message`, `milestones[]`.
- **Deviation reports** -- `deviations[]` array (triggers a yellow badge on the dashboard card).
- **Detailed logs** -- `logs[]` array (feeds the popup log box in the agent details modal).

The dashboard derives ALL stats from worker progress files:

| Stat | Source |
|---|---|
| Total | `task.total_tasks` from `initialization.json` |
| Completed | Count of progress files with `status === "completed"` |
| In Progress | Count of progress files with `status === "in_progress"` |
| Failed | Count of progress files with `status === "failed"` |
| Pending | `total_tasks - completed - in_progress - failed` |
| Elapsed | Ticks from earliest worker `started_at` until all workers have `completed_at` |

The master does not maintain counters. There are no `completed_tasks`, `failed_tasks`, or `overall_status` fields in `initialization.json`. The dashboard computes everything.

### What the Master Handles

The master handles event logging and XML updates only:

- Agent dispatched -- Append to `logs.json`.
- Agent completed -- Append to `logs.json` + update XML.
- Agent failed -- Append to `logs.json` + update XML.
- Agent deviated -- Append to `logs.json` at level `"deviation"`.
- Swarm initialized -- Append to `logs.json`.
- Swarm completed -- Append to `logs.json`.
- Permission request -- Append to `logs.json` at level `"permission"`.
- Dependency scan results -- Append to `logs.json`.

The master does NOT write progress files. The master does NOT update `initialization.json` after the planning phase (except for repair task creation on failure).

---

## Dashboard Files

### initialization.json

**Written once during planning.** Contains the static plan: task metadata, agent plan entries, wave structure, and chains. The master writes this file during the planning phase and never updates it again, with one exception:

- **Repair task creation on failure** -- When a worker fails, the master appends a new repair agent to agents[], increments `total_tasks` and the relevant `waves[].total`, and rewires `depends_on` references. This is the only permitted post-planning modification.

No lifecycle fields exist in `initialization.json`:

- No `status` on agents (derived from progress files).
- No `started_at` or `completed_at` on agents (written by workers to progress files).
- No `summary` on agents (written by workers to progress files).
- No `assigned_agent` on agents (written by workers to progress files).
- No `completed_tasks` or `failed_tasks` on the task object (derived from progress file counts).
- No `overall_status` on the task object (derived from aggregate of progress files).
- No `status` or `completed` on waves (derived from progress files of agents in each wave).

### logs.json

The timestamped event log. Every entry becomes a row in the dashboard log panel.

**Entry schema:**

```json
{
  "timestamp": "ISO 8601",
  "task_id": "0.0 for orchestrator | {wave}.{index} for agents",
  "agent": "Orchestrator | Agent N",
  "level": "info | warn | error | debug | permission | deviation",
  "message": "Action verb first. Include result metadata.",
  "task_name": "task-slug"
}
```

**Write rules:**

- Always read the full file, parse, modify in memory, stringify with 2-space indent, and write the full file back. Never write partial JSON.
- Always capture a live timestamp via `date -u +"%Y-%m-%dT%H:%M:%SZ"` at the exact moment of writing. Never guess or construct timestamps from memory.

**Log levels and their dashboard display:**

| Level | Color | When to Use |
|---|---|---|
| `info` | Purple badge | Normal events: initialization, dispatch, completion, dependency scans |
| `warn` | Lime/yellow badge | Unexpected findings, non-blocking issues, circuit breaker triggers |
| `error` | Red badge | Failures, blocking issues |
| `debug` | Gray/dim badge | Verbose diagnostic information (use sparingly) |
| `permission` | Amber badge (triggers popup) | Master needs user input before continuing |
| `deviation` | Yellow badge | Plan divergence reported by a worker |

### progress/ Directory

Worker-owned. Each worker writes to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` exclusively. The server watches this directory via `fs.watch` and broadcasts `agent_progress` SSE events to the dashboard.

The master reads progress files after every worker completion to build the completed and in-progress sets for eager dispatch. The master never writes progress files.

Progress files are ephemeral -- they exist only during the active swarm. The master clears this directory when initializing a new swarm (after archiving).

---

## logs.json Write Points

The master writes to `logs.json` at these specific moments:

### Swarm Initialization

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Task initialized: {task-slug} -- {N} tasks across {W} waves -- Type: {Waves|Chains} -- Dir: {directory} -- {brief description}",
  "task_name": "{task-slug}"
}
```

### Agent Dispatch

One entry per dispatched task:

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "{wave}.{index}",
  "agent": "Agent {N}",
  "level": "info",
  "message": "Dispatched: {task title}",
  "task_name": "{task-slug}"
}
```

Written AFTER the agent is actually dispatched, never before.

### Batch Dispatch Notification

When dispatching a batch of agents:

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Dispatching Wave {N}: {M} agents -- {wave name}",
  "task_name": "{task-slug}"
}
```

### Agent Completion

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "{wave}.{index}",
  "agent": "Agent {N}",
  "level": "info",
  "message": "Completed: {task title} -- {SUMMARY}",
  "task_name": "{task-slug}"
}
```

### Agent Warning

One entry per warning reported by a worker:

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "{wave}.{index}",
  "agent": "Agent {N}",
  "level": "warn",
  "message": "WARN: {what was unexpected}",
  "task_name": "{task-slug}"
}
```

### Agent Deviation

When a worker reports plan divergence:

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "{wave}.{index}",
  "agent": "Agent {N}",
  "level": "deviation",
  "message": "DEVIATION: {what changed and why}",
  "task_name": "{task-slug}"
}
```

The yellow badge on the agent's dashboard card is driven by the progress file's `deviations[]` array -- no master action needed for that. The deviation log entry makes the deviation visible in the log panel's "Deviation" filter.

### Agent Failure

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "{wave}.{index}",
  "agent": "Agent {N}",
  "level": "error",
  "message": "FAILED: {task title} -- {error reason}",
  "task_name": "{task-slug}"
}
```

### Repair Task Dispatch

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Dispatching repair task {repair_id} for failed task {failed_id} -- {brief reason}",
  "task_name": "{task-slug}"
}
```

### Eager Dispatch Scan Results

After each worker completion, when new tasks become available:

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Dependency scan: dispatching {N} newly available tasks -- {task IDs}",
  "task_name": "{task-slug}"
}
```

### Circuit Breaker Trigger

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "warn",
  "message": "Circuit breaker triggered: {reason}. Pausing dispatch for reassessment.",
  "task_name": "{task-slug}"
}
```

### Swarm Completion

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Swarm complete: {completed}/{total} tasks succeeded, {failed} failed",
  "task_name": "{task-slug}"
}
```

### Verification Result

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "{info if passed, warn if issues found}",
  "message": "Verification: {result summary}",
  "task_name": "{task-slug}"
}
```

---

## XML Updates

The master XML at `{tracker_root}/tasks/{date}/parallel_{name}.xml` is the authoritative task record. The master updates it on every worker completion.

### On Agent Completion

Read the XML. Find the task by ID:

- Set `<status>` to `completed` or `failed`.
- Set `<completed_at>` to current ISO timestamp.
- Write `<summary>` with the agent's SUMMARY line.
- Append any logs, warnings, or divergent actions to `<logs>`.
- Write back.

### On Agent Failure

Same as completion, but:

- Set `<status>` to `failed`.
- Mark any directly dependent tasks as `"blocked"`.
- Include the error details in `<summary>` and `<logs>`.

### On Overall Completion

Set `<overall_status>` to `completed` (or `failed` if any tasks failed without recovery).

---

## Terminal Output Rules

The dashboard is the primary reporting channel. The master agent does NOT display full status tables during execution. This is a firm rule designed to save context tokens and keep the master agent focused.

### What the Master Outputs to Terminal

- **On dispatch:** `"Dispatched Wave {N}: {M} agents -- {wave name}"`
- **On completion:** `"Agent {N} completed: {summary}"` (one line)
- **On failure:** `"Agent {N} FAILED: {error}"` (one line)
- **On deviation:** `"Agent {N} DEVIATED: {description}"` (one line)

### What the Master Never Outputs to Terminal During Execution

- Full status tables with all tasks listed.
- Progress bars or detailed status grids.
- Redundant information that is already visible on the dashboard.

Full terminal status tables are only displayed when the user explicitly runs `!status`.

---

## The Permission Request Flow

When the master agent needs to ask the user for confirmation before proceeding (e.g., the circuit breaker triggers, or a task requires a decision the master cannot make autonomously), it must notify the dashboard BEFORE pausing to ask in the terminal.

### The Two-Step Process (Non-Negotiable)

**Step 1 -- Write the permission log entry.** Write a log entry with `level: "permission"` to `logs.json`. The dashboard immediately shows a modal popup that says "Agent is requesting your permission" with the message, and instructs the user to respond in their terminal.

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "permission",
  "message": "{Clear, one-sentence description of what you need and why}",
  "task_name": "{task-slug}"
}
```

**Step 2 -- Ask in the terminal.** Only after the log entry is written, ask the question in the terminal.

The order is critical. Step 1 must complete before Step 2 begins. Skipping Step 1 means the user will never see the dashboard popup. Writing both simultaneously means the popup may arrive late.

### Rules

- The message field is displayed verbatim inside the popup. Write clearly.
- The popup is dismissible. Each new `"permission"` entry triggers a fresh popup.
- After the user responds and the master resumes, write a normal `"info"` log entry confirming what was decided.

---

## The Elapsed Timer

The elapsed timer on the dashboard is derived entirely from worker progress files:

- **Start:** The earliest `started_at` value across all progress files. The timer starts automatically when the first worker writes its progress file.
- **End:** The latest `completed_at` value across all progress files. The timer freezes when every worker has `completed_at` set.

The master does NOT set these values -- workers write them. The master's responsibility is to ensure workers are dispatched promptly (so `started_at` reflects actual start times) and that the worker instruction protocol is included in every dispatch prompt (so workers know to capture accurate timestamps).

Workers capture timestamps via:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

A bad timestamp produces a wildly wrong elapsed time on the dashboard.

---

## Atomic Write Protocol

All writes to `initialization.json` and `logs.json` must be atomic:

1. Read the full file.
2. Parse JSON.
3. Modify in memory.
4. Stringify with 2-space indent.
5. Write the full file back.

Never write partial JSON. An invalid file silently stops all dashboard updates until corrected. The server re-reads the full file on every change, so partial writes cause immediate breakage.

---

## Post-Swarm Verification

Before delivering the final report, the master assesses whether a verification step is needed:

| Condition | Verification |
|---|---|
| Modified existing code across multiple files | Dispatch a verification agent -- run tests, type check, build |
| Purely additive (new files only, no modifications) | Verification optional |
| Any tasks reported deviations | Verification strongly recommended |
| All tasks succeeded with no warnings | May skip verification |

The verification agent receives a complete list of all files changed across the swarm and runs the project's standard validation commands. Its job is to catch integration issues that individual workers cannot see.

For cross-repo swarms, the verification agent also checks:

- Type and interface consistency across repos.
- Import path validity after file moves or renames.
- Contract alignment between backend APIs and frontend consumers.

The verification result is logged to `logs.json` and included in the final report.

---

## The Final Report

The master's last statusing action is the comprehensive swarm report, delivered after all workers have completed and optional verification has run:

```markdown
## Swarm Complete: {task-slug}

**{completed}/{total} tasks** -- **{W} waves** -- **{N} failures** -- **Type: {Waves|Chains}**

### What Was Done
{2-4 sentences summarizing the goal and outcome}

### Files Changed
| File | Action | Task |
|---|---|---|
| {path} | created / modified / deleted | {task id} |

### Important Logs & Observations
{Summary of the most significant log entries}

### Divergent Actions
{Only if workers deviated from the plan}

### Warnings
{Only if agents reported unexpected findings}

### Failures
{Only if tasks failed -- including what was blocked}

### Verification
{Only if a verification step was run}

### Recommendations & Next Steps
{Only if applicable}

### Artifacts
- XML: {path}
- Plan: {path}
- Dashboard: {path}
- Logs: {path}
```

---

## Summary of What Gets Updated and When

| Event | logs.json | XML | initialization.json | progress/ | Terminal |
|---|---|---|---|---|---|
| Swarm initialized | Append | Created | Written (once) | Cleared | Plan table |
| Agent dispatched | Append | Claim task | -- | Worker writes | One line |
| Agent progressing | -- | -- | -- | Worker writes | -- |
| Agent completed | Append | Update task | -- | Worker writes | One line |
| Agent warned | Append | Append to logs | -- | -- | One line |
| Agent deviated | Append | Append to logs | -- | Worker writes | One line |
| Agent failed | Append | Update task | Repair task added | Worker writes | One line |
| Eager dispatch | Append | -- | -- | -- | -- |
| Circuit breaker | Append (warn + permission) | -- | -- | -- | Assessment |
| Swarm complete | Append | Set overall_status | -- | -- | Final report |

---

## Related Documentation

- [Master Agent Overview](./overview.md) -- Role definition, constraints, and responsibilities.
- [Planning Protocol](./planning.md) -- Task decomposition, dependency mapping, wave grouping, and prompt writing.
- [Dispatch Protocol](./dispatch-protocol.md) -- Eager dispatch, dependency-driven dispatch, pipeline flow, and error handling.
