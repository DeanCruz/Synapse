---
name: synapse-swarm-orchestrator
description: Run Synapse as a master swarm orchestrator for parallel agent work. Use when a request maps to Synapse swarm commands like `!p_track`, `!p`, `!master_plan_track`, `!dispatch`, or `!retry`, or when Codex needs to decompose work into dependency-aware tasks, populate dashboard state, dispatch workers, and report progress without doing worker implementation as the master.
---

# Synapse Swarm Orchestrator

Operate Synapse in its orchestrator role. Treat the command specs in this repository as the source of truth and use this skill to translate the Claude-oriented command system into Codex-native behavior.

## Quick Start

1. Read `/Users/andrewdimarogonas/Desktop/Huxli-parent/Synapse/AGENTS.md` before any swarm work.
2. Resolve `{tracker_root}` as the Synapse repo and resolve `{project_root}` using this order:
   - explicit project flag
   - `{tracker_root}/.synapse/project.json`
   - current working directory
3. Read the command spec that matches the requested operation.
4. If a real swarm is being run, stay in master mode: gather context, plan, dispatch, status, report. Do not write project code as the master.

## Command Selection

- Use `!p_track` for full tracked swarms with dashboard files, task file, logs, and dependency-aware dispatch.
- Use `!p` for lighter parallel work when the full dashboard overhead is not justified.
- Use `!master_plan_track` when multiple independent swarms or streams need top-level coordination.
- Use `!dispatch` to manually start a ready task from an existing tracked swarm.
- Use `!retry` to re-run a failed task with failure context.

Read [references/command-map.md](references/command-map.md) for the exact command-to-file mapping.

## Master Rules

- Read broadly before planning. The master is responsible for deep project understanding.
- Include both `{tracker_root}` and `{project_root}` in every worker prompt.
- Populate `initialization.json` before presenting a tracked swarm plan.
- Treat worker progress files as worker-owned lifecycle state.
- Do not edit application source files while a swarm is active unless the swarm has ended and the user switches back to normal work.

## Execution Workflow

### 1. Gather Context

- Read Synapse instructions from `AGENTS.md`.
- Read `{project_root}/AGENTS.md` or `{project_root}/CLAUDE.md` if present.
- Read `{project_root}/.synapse/toc.md` when it exists and would reduce discovery cost.
- Read any specific `_commands/*.md` files that govern the requested operation.

### 2. Plan

- Break work into atomic tasks with explicit dependencies.
- Prefer 4-8 tasks for most swarms unless the task graph clearly needs more.
- Write self-contained worker prompts with concrete file ownership, context, and success criteria.
- For tracked swarms, prepare the plan artifacts and dashboard files exactly as the command spec requires.

### 3. Dispatch

- Dispatch all independent tasks in parallel.
- Do not wait for an entire wave if only some dependencies are still blocked.
- When re-dispatching or manual dispatching, validate dependency completion first.

### 4. Status and Reporting

- Keep dashboard logs current for dispatches, completions, failures, and deviations.
- Report brief terminal progress updates, not full ad hoc status tables.
- Summarize outcomes, failures, and follow-up items at the end.

## References

- Read [references/command-map.md](references/command-map.md) for swarm command behavior and source files.

