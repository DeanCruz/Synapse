# Settings Reference

Synapse's Claude Code agent behavior is configured through `.claude/settings.json`, agent definitions in `.claude/agents/`, and skill definitions in `.claude/skills/`. This document covers the structure and configuration model.

---

## .claude/settings.json

The settings file at `{tracker_root}/.claude/settings.json` is the central configuration for Claude Code hooks. It defines validation hooks that fire on specific tool invocations across all agent types.

### Top-Level Structure

```json
{
  "hooks": {
    "PreToolUse": [...],
    "PostToolUse": [...],
    "Notification": [...],
    "Stop": [...]
  }
}
```

### Hook Event Types

| Event | Description | Response Format |
|---|---|---|
| `PreToolUse` | Fires before a tool executes | `{"decision":"allow"}` or `{"decision":"block","reason":"..."}` |
| `PostToolUse` | Fires after a tool executes | `{"message":"..."}` or silent |
| `Notification` | Fires on background agent notifications | `{"message":"..."}` or silent |
| `Stop` | Fires when the agent session ends | `{"message":"..."}` or silent |

### Hook Entry Format

Each event contains an array of hook groups. Each group has an optional `matcher` and a `hooks` array:

```json
{
  "matcher": "Edit|Write",
  "hooks": [
    {
      "type": "command",
      "command": ".claude/hooks/script-name.sh"
    }
  ]
}
```

**Matcher syntax:**
- Single tool: `"Bash"` -- matches only the Bash tool.
- Multiple tools: `"Edit|Write"` -- matches Edit OR Write tool calls.
- Omitted: matches all tool calls for that event (used by Notification and Stop hooks).

**Hook types:**
- `command` -- Runs a shell script. The script receives tool input as JSON on stdin.

### Current Hook Configuration

The complete settings.json defines 21 hooks across 4 events:

**PreToolUse (11 hooks):**
- Edit|Write: 6 hooks (dashboard isolation, tracker root enforcement, master write blocking, plan requirement, immutability, schema validation)
- Task: 2 hooks (worker prompt validation, approval gate)
- Bash: 3 hooks (dashboard isolation for bash, tracker root enforcement for bash, archive-before-clear)

**PostToolUse (8 hooks):**
- Write: 6 hooks (progress file validation, progress log detail, PKI staleness marking, log entry validation, master state validation, chat dashboard validation)
- Edit|Write: 1 hook (progress update nudge)
- Agent: 1 hook (worker status on dispatch)

**Notification (1 hook):**
- (all): 1 hook (worker status on notify)

**Stop (1 hook):**
- (all): 1 hook (verify final report)

See [hooks.md](hooks.md) for detailed documentation of each hook.

---

## Agent Definitions

Agent definitions live in `.claude/agents/` as Markdown files with YAML frontmatter. They define specialized agent types with specific skills, hooks, and behavioral constraints.

### File Location

```
.claude/agents/
  master-orchestrator.md
  swarm-worker.md
```

### Frontmatter Schema

```yaml
---
name: agent-name
description: >
  Multi-line description of the agent's role and when to use it.
skills:
  - skill-name-1
  - skill-name-2
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: ".claude/hooks/some-hook.sh"
  Stop:
    - hooks:
        - type: command
          command: ".claude/hooks/another-hook.sh"
---
```

| Field | Type | Description |
|---|---|---|
| `name` | string | Unique identifier for the agent |
| `description` | string | Role description and usage context |
| `skills` | string[] | Skills to auto-load when this agent activates |
| `hooks` | object | Agent-scoped hooks (same format as settings.json, but only apply to this agent type) |

### Agent: master-orchestrator

**File:** `.claude/agents/master-orchestrator.md`

**Role:** Swarm master agent that plans task decomposition, dispatches worker agents, monitors progress through dashboard files, and compiles final reports. The master NEVER writes project source code.

**Skills loaded:**
- `p-track` -- Full swarm orchestration protocol
- `worker-protocol` -- Worker progress schema (for understanding worker reports)
- `master-protocol` -- Core master identity and constraints
- `failure-protocol` -- Failure recovery and repair task protocol

**Agent-specific hooks:**
- PreToolUse on Edit|Write: `validate-master-write.sh` -- Blocks project file writes
- Stop: `verify-final-report.sh` -- Warns if swarm has no completion report

**Five responsibilities:**
1. Gather Context -- Read project CLAUDE.md, conventions, source files
2. Plan -- Decompose into atomic tasks with dependencies and wave assignments
3. Dispatch -- Send workers via Task tool with self-contained prompts
4. Status -- Monitor via dashboard files, maintain logs and master state
5. Report -- Compile final summary of all changes, metrics, outcomes

**Allowed write targets:**
- `dashboards/{id}/plan.json` -- Planning artifact (must be written BEFORE initialization.json)
- `dashboards/{id}/initialization.json` -- Static plan data (written once)
- `dashboards/{id}/logs.json` -- Event log
- `dashboards/{id}/master_state.json` -- State checkpoint
- `dashboards/{id}/metrics.json` -- Post-swarm metrics
- `Archive/` -- Archived swarm data

---

### Agent: swarm-worker

**File:** `.claude/agents/swarm-worker.md`

**Role:** Implements a single task from a parallel swarm and reports progress via progress files.

**Skills loaded:**
- `worker-protocol` -- Progress reporting, deviation tracking, return format

**Agent-specific hooks:**
- PostToolUse on Write: `validate-progress-file.sh` -- Validates progress file schema

**Dual-path convention:**
- Code work happens in `{project_root}` (the target project)
- Progress reporting happens in `{tracker_root}/dashboards/{id}/progress/{task_id}.json`

**Stage progression:**
1. `reading_context` -- Reading task description and source files
2. `planning` -- Assessing approach, identifying files
3. `implementing` -- Writing code, creating/modifying files
4. `testing` -- Running tests, validating changes
5. `finalizing` -- Final cleanup, preparing summary
6. `completed` / `failed` -- Terminal states

**Mandatory progress writes (8 minimum):**
1. Before starting work (set `in_progress` status)
2. On `reading_context` start
3. On `planning` complete
4. On `implementing` start
5. On each milestone
6. On any deviation (immediately)
7. On every file change (update `files_changed`)
8. On completion/failure (final status and summary)

**Return format to master:**
```
STATUS: completed | failed
SUMMARY: {one-sentence description}
FILES CHANGED:
  - {path} ({created | modified | deleted})
EXPORTS: (omit if no new exports)
DIVERGENT ACTIONS: (omit if none)
WARNINGS: (omit if none)
ERRORS: (omit if none)
```

---

## Hook Layering

Hooks from `settings.json` (global) and agent definitions (agent-scoped) combine at runtime. The effective hook set for any agent invocation is:

1. **Global hooks** from `.claude/settings.json` -- Apply to all agents.
2. **Agent hooks** from `.claude/agents/{agent}.md` frontmatter -- Apply only when that agent type is active.

Both sets fire for their respective events and matchers. There is no override or precedence -- they are additive.

---

## Environment Variables

Several environment variables affect hook behavior:

| Variable | Set By | Purpose |
|---|---|---|
| `SYNAPSE_DASHBOARD_ID` | Electron (when spawning CLI) | Assigned dashboard for isolation enforcement |
| `SYNAPSE_SKIP_SCHEMA` | User (manual) | Set to `1` to bypass `validate-initialization-schema.sh` |

---

## Permission Model

The hook system enforces a strict permission model:

### Master Agent Constraints
- Cannot write to `{project_root}` during an active swarm (enforced by `validate-master-write.sh`)
- Must create `plan.json` before `initialization.json` (enforced by `validate-plan-required.sh`)
- Cannot mutate `task.name` in `initialization.json` after creation (enforced by `validate-initialization-immutable.sh`)
- Must pass full schema validation for `initialization.json` (enforced by `validate-initialization-schema.sh`)
- Must obtain user approval before dispatching workers (enforced by `validate-approval-gate.sh`)
- Worker prompts must include all required metadata sections (enforced by `validate-worker-prompt.sh`)

### All Agent Constraints
- Cannot write to dashboards other than their assigned one (enforced by `enforce-dashboard-isolation.sh` and `enforce-dashboard-isolation-bash.sh`)
- Cannot write dashboard files outside `{tracker_root}` (enforced by `enforce-tracker-root-writes.sh` and `enforce-tracker-root-writes-bash.sh`)
- Cannot `rm` dashboard data without archiving first (enforced by `validate-archive-before-clear.sh`)

### Worker Agent Quality Gates (warnings, not blocks)
- Progress files must have required fields and valid status values
- Progress logs must be detailed and narrative (not vague placeholders)
- Files changed must be tracked during implementation stages
- Milestones must be recorded for later stages

---

## Related Documentation

- [hooks.md](hooks.md) -- Complete reference for all 21 hooks
- [skills.md](skills.md) -- Reference for the skills system
- [overview.md](overview.md) -- Configuration layers overview
