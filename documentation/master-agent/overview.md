# Master Agent — Overview

The master agent is the orchestrator at the heart of every Synapse swarm. When a swarm is active, one agent assumes the master role and becomes responsible for planning, dispatching, monitoring, and reporting on all work performed by worker agents. The master agent never writes application code itself. Its value comes from maintaining an elevated perspective over the entire dependency graph, the full project context, and the state of every worker simultaneously.

This document covers the master agent's role definition, its five core responsibilities, the absolute constraints on its behavior, and the files it is permitted to write.

---

## The Conductor Analogy

A conductor does not pick up a violin mid-symphony. The master agent does not pick up an editor mid-swarm.

The master agent's power comes from its elevated perspective. It sees the full dependency graph. It holds context from the entire project. It knows what every worker is doing and what comes next. The moment it starts writing code, it loses this perspective. It gets tunnel-visioned into implementation details. It forgets to dispatch the next wave. It misses a dependency. It writes code that conflicts with what a worker is simultaneously producing.

---

## When Does an Agent Become the Master?

An agent enters master dispatch mode under any of these conditions:

1. **Forced parallel mode** -- Any command prefixed with `!p` (such as `!p_track` or `!p`) forces the agent into master dispatch mode unconditionally. This is absolute and non-negotiable.

2. **Automatic parallel mode** -- Even without an explicit `!p` command, the agent must escalate to parallel mode when it recognizes that the task naturally decomposes into 3 or more independent subtasks. In this case, the agent informs the user, reads the Synapse `CLAUDE.md`, and follows the full swarm protocol.

3. **Multi-stream orchestration** -- The `!master_plan_track` command creates a higher-level orchestrator that manages multiple independent swarms across different dashboards.

Once in master dispatch mode, the agent remains the orchestrator for the duration of the swarm. Only after all workers have finished and the final report has been delivered does the master agent resume normal agent behavior.

---

## The Five Responsibilities

The master agent has exactly five responsibilities during a swarm. Nothing more.

### 1. Gather Context

The master agent reads extensively -- more than any worker will. It reads documentation, code, types, tests, and configuration files. This deep context gathering is what makes the plan accurate and the agent prompts self-contained. Skimping here causes cascading failures downstream.

Specific context-gathering actions:

- Read the Synapse `CLAUDE.md` for swarm protocols (non-negotiable on every invocation).
- Read `{project_root}/CLAUDE.md` for target project conventions, architecture, and constraints.
- If a project TOC exists at `{project_root}/.synapse/toc.md`, read it for semantic orientation.
- Use Glob and Grep within `{project_root}` for targeted file discovery.
- Read source files, documentation, types, schemas, and configs needed to understand the task.
- Read relevant command files from `_commands/` directories.
- Build a complete mental model of the codebase, dependencies, and constraints.

**Context efficiency principles apply.** The master should Glob/Grep first for targeted searches (zero context cost), read with purpose (know what you expect to find before opening a file), parallelize all reads, and use targeted line ranges for large files.

### 2. Plan

Planning is where the master agent earns its value. A well-planned swarm executes fast with zero confusion. A poorly-planned swarm produces broken code, conflicting edits, and wasted cycles. The master must invest heavily in planning and never rush it.

Planning involves:

- Decomposing the task into atomic, self-contained units.
- Mapping every dependency between tasks (what blocks what).
- Determining wave groupings for visual organization.
- Writing each agent's prompt with complete, self-contained context so the agent can execute without reading additional files or asking questions.
- Creating the master task file documenting the full plan.
- Writing the strategy rationale plan file.
- Populating the dashboard before presenting the plan to the user.

See [planning.md](./planning.md) for the complete planning protocol.

### 3. Dispatch

Dispatch is the execution phase. The master spawns worker agents via the Task tool with their complete prompts. All independent tasks are dispatched in parallel. As workers complete, the master immediately scans for newly unblocked tasks and dispatches them. The pipeline must never stall waiting for a batch or wave to finish.

See [dispatch-protocol.md](./dispatch-protocol.md) for the complete dispatch protocol.

### 4. Status

The master maintains visibility into the swarm through logging and dashboard updates. It appends to `logs.json` on dispatches, completions, failures, and deviations. It updates the master task file with completion summaries, error details, and timing. Workers handle their own live progress reporting via progress files -- the master does not relay progress updates.

See [statusing.md](./statusing.md) for the complete statusing protocol.

### 5. Report

When all agents have completed (or failed), the master compiles a final summary. It reports what was accomplished, what failed, and what needs follow-up. If the swarm created, moved, or restructured files, the master updates the project TOC at `{project_root}/.synapse/toc.md` (if one exists).

The final report includes:

- Task counts (completed, failed, total) and timing.
- A narrative summary of what was accomplished.
- A complete list of files changed across all workers.
- Important log entries and observations.
- Any divergent actions taken by workers.
- Warnings and failures with context.
- Verification results (if a post-swarm verification agent was dispatched).
- Recommendations and next steps.
- Links to all artifacts (task file, plan document, dashboard, logs).

---

## Absolute Constraints -- What the Master Agent NEVER Does

This list is exhaustive and absolute. There are no exceptions during an active swarm.

### Never Writes Code

Not a single line. Not a "quick fix." Not a "small tweak." Not "just this one file." If code needs to be written, it is a task for a worker agent. This applies to all application source files: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.css`, `.html`, `.json` (except dashboard JSON files), and any other file that belongs to the codebase being worked on.

### Dashboard Tracking Is Mandatory (Thresholds)

When a swarm has **3 or more parallel agents** OR **more than 1 wave** (multi-wave is non-negotiable), the master MUST use full dashboard tracking -- workers write progress files, the master writes `master_state.json`, and `metrics.json` is computed at completion. The only exception is when the user explicitly invoked `!p` (lightweight mode). For auto-parallel and all other swarm modes, these thresholds trigger automatic escalation to `!p_track`-level tracking.

### Master Writes Progress in Lightweight Mode

When workers do NOT write their own progress files (`!p` mode, sub-threshold auto-parallel, or serial dispatch), the master MUST create a minimal progress file for each completed worker using the worker's return data -- including `files_changed`, `summary`, and completion logs. This ensures the dashboard always shows per-task file changes and status.

### Never Creates Application Files

No new components, services, utilities, tests, configs, or any other artifact that a worker should create.

### Never Runs Application Commands

No `npm run build`, no `npm test`, no `python manage.py`, no application-specific CLI tools. If testing or building is needed, it is a task for a worker agent.

### Never Helps a Worker by Doing Part of Its Task

If a task is too large for one agent, decompose it into smaller tasks. Do not do half the work yourself and dispatch the other half.

### Never Implements "Just One Thing" Directly

It is never faster. The moment the master starts coding, it loses its orchestrator perspective. It becomes a worker with half-attention on orchestration. Both suffer.

### Long or Complex Prompts Are Not an Excuse

When the user's prompt is long, that means MORE planning and MORE agents are needed -- not that the master should "just do the work directly." The longer the prompt, the more important it is to decompose, plan, and dispatch.

---

## The Only Files the Master Agent Writes

During a swarm, the master agent writes to exactly these files and no others:

| File | Purpose |
|---|---|
| `dashboards/{dashboardId}/initialization.json` | Static plan data (written ONCE during planning, with one exception for repair tasks) |
| `dashboards/{dashboardId}/logs.json` | Timestamped event log for the dashboard |
| `dashboards/{dashboardId}/master_state.json` | State checkpoint for context compaction recovery |
| `dashboards/{dashboardId}/metrics.json` | Post-swarm performance metrics (written once after completion) |
| `tasks/{date}/parallel_{name}.json` | Master task record (plan, status, summaries) |
| `tasks/{date}/parallel_plan_{name}.md` | Strategy rationale document |

Everything else is a worker's job. The master agent writes **nothing** into `{project_root}` during an active swarm.

---

## After a Swarm Completes

Once all workers have finished and the master has compiled its final report, the swarm is over. At this point -- and only at this point -- the master agent may resume normal agent behavior (including direct code edits) if the user requests non-parallel work. The no-code restriction applies exclusively during active swarm orchestration.

---

## Non-Negotiable Pre-Flight Reads

Every time a swarm is initiated, the master must read these files before doing anything else:

1. **`{tracker_root}/CLAUDE.md`** -- The Synapse system instructions. Must be read on every invocation, not recalled from memory.

2. **The command file** -- For `!p_track`, read `{tracker_root}/_commands/Synapse/p_track.md`. For `!p`, read `{tracker_root}/_commands/Synapse/p.md`. Read the file every time. Do not "remember" what the command does.

3. **`{tracker_root}/agent/instructions/tracker_master_instructions.md`** -- The master agent hub reference. Links to all module files (role, dashboard writes, UI map, eager dispatch, failure recovery, worker prompts, compaction recovery, dashboard protocol). Must be read before writing any dashboard files. Do not skip this. Do not summarize from memory.

4. **`{project_root}/CLAUDE.md`** -- Project conventions for the target project. Must be read before any planning begins.

---

## Related Documentation

- [Planning Protocol](./planning.md) -- Task decomposition, dependency mapping, wave grouping, and prompt writing.
- [Dispatch Protocol](./dispatch-protocol.md) -- Eager dispatch, dependency-driven dispatch, pipeline flow, and error handling.
- [Statusing Protocol](./statusing.md) -- Dashboard updates, logs.json, task file updates, and terminal output rules.
