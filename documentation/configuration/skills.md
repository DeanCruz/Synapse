# Skills Reference

Skills are modular capability definitions that extend Claude Code agents with specialized behavior. They live in `.claude/skills/` as directories, each containing a `SKILL.md` file with YAML frontmatter and markdown instructions.

---

## How Skills Work

### Definition

Each skill is a directory under `.claude/skills/` containing a `SKILL.md` file:

```
.claude/skills/
  p-track/SKILL.md
  p/SKILL.md
  master-protocol/SKILL.md
  worker-protocol/SKILL.md
  failure-protocol/SKILL.md
  dashboard-ops/SKILL.md
  project-workflow/SKILL.md
  eager-dispatch/SKILL.md
  p-track-resume/SKILL.md
  master-plan-track/SKILL.md
```

### SKILL.md Structure

Each `SKILL.md` uses YAML frontmatter followed by markdown body content:

```markdown
---
name: skill-name
description: >
  Multi-line description of what this skill does and when to use it.
argument-hint: "[--flag <value>] <required-arg>"
user-invocable: true
context: fork
model: opus
---

# Skill Title

Markdown instructions loaded when the skill activates...
```

### Frontmatter Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Unique identifier for the skill (kebab-case) |
| `description` | string | Yes | When and why to invoke this skill. Used by Claude to match user requests to skills. |
| `argument-hint` | string | No | Shows the user what arguments the skill accepts |
| `user-invocable` | boolean | No | Whether users can invoke this skill directly (default: false) |
| `context` | string | No | Execution context. `fork` means the skill runs in a separate agent process. Omit for inline execution. |
| `model` | string | No | Preferred model for the skill (e.g., `opus` for complex orchestration tasks) |

### Loading and Invocation

Skills are loaded in several ways:

1. **Explicit user invocation** -- User types a `!command` that maps to a skill (e.g., `!p_track` loads `p-track`).
2. **Skill tool** -- Claude Code's built-in Skill tool matches user intent to skill descriptions and invokes the matching skill.
3. **Agent definitions** -- Agent YAML frontmatter lists skills to auto-load (e.g., the master-orchestrator agent loads `p-track`, `worker-protocol`, `master-protocol`, and `failure-protocol`).
4. **Auto-loading** -- Some skills are marked as auto-loaded for specific agent roles (protocols).

### Dynamic Context

Skills can embed shell commands that execute at load time using the `!` directive:

```markdown
!`echo "PROJECT_ROOT: $(cat .synapse/project.json 2>/dev/null | jq -r '.project_root')"`
!`echo "TRACKER_ROOT: $(pwd)"`
!`cat "$(cat .synapse/project.json | jq -r '.project_root')/CLAUDE.md" 2>/dev/null | head -100`
```

These are evaluated when the skill loads, providing fresh context (project paths, dashboard state, timestamps) to the agent.

---

## Skill Catalog

### Swarm Orchestration Skills

#### p-track

**Invoked by:** `!p_track`
**Context:** fork | **Model:** opus | **User-invocable:** yes

The primary swarm orchestration skill. Runs a full parallel swarm with live dashboard tracking. Three phases:

1. **Planning (Steps 1-11):** Resolve project root, read master instructions, parse the prompt, deep analysis, decompose into tasks, group into waves, write `plan.json`, write `initialization.json`, write initial logs, present plan for approval.
2. **Execution (Steps 12-15):** Dispatch Wave 1 workers, run eager dispatch loop (on every completion, scan for newly unblocked tasks), handle failures via failure-protocol, maintain master_state.json checkpoint.
3. **Completion (Steps 16-18):** Compile final report, write metrics.json, update project TOC if files were created.

**Dependencies:** Loads `master-protocol`, `worker-protocol`, and `failure-protocol` skills.

---

#### p

**Invoked by:** `!p`
**Context:** fork | **Model:** opus | **User-invocable:** yes

Lightweight parallel dispatch. Same planning quality as `!p_track` but without live progress files, `master_state.json`, or `metrics.json`. Workers do NOT write progress files. Dashboard receives only `initialization.json` and bookend `logs.json` entries.

**When to use:** <3 tasks, single wave, focused scope. If the plan grows to 3+ agents or >1 wave, the master recommends escalating to `!p_track`.

---

#### master-plan-track

**Invoked by:** `!master_plan_track`
**Context:** fork | **Model:** opus | **User-invocable:** yes

Multi-stream orchestration across multiple dashboards. The invoking agent becomes a meta-planner that:
1. Decomposes work into independent planning streams.
2. Dispatches planner agents to create plans in parallel.
3. After plan approval, dispatches child master agents to execute each stream on its own dashboard.

**When to use:** Work that splits into 2+ independent swarms, each needing its own dependency graph and worker pool.

---

#### p-track-resume

**Invoked by:** `!p_track_resume`
**Context:** fork | **Model:** opus | **User-invocable:** yes

Resumes a stalled, interrupted, or partially completed swarm. Reconstructs state from dashboard files, checks agent health, detects stale workers, re-dispatches stuck/failed tasks, and runs the full execution-to-completion lifecycle.

---

#### eager-dispatch

**Invoked by:** `!eager_dispatch`
**Context:** fork | **Model:** opus | **User-invocable:** yes

Runs a single, standalone eager dispatch round on an active swarm. Reads dashboard state, identifies all tasks whose dependencies are satisfied but have not been dispatched, builds complete worker prompts, and dispatches them all.

**Use cases:** Recovery from stalled swarms, manual intervention after circuit breaker pauses, ensuring no dispatchable tasks are idle.

**Limitation:** Runs one pass and exits. Does not monitor completions or handle failures. For full lifecycle management, use `!p_track_resume`.

---

### Protocol Skills (Auto-Loaded)

These skills are not directly user-invocable. They are loaded automatically when an agent operates in a specific role.

#### master-protocol

**User-invocable:** no

Core identity and constraints for master orchestrator agents. Contains:
- Five non-negotiable rules (master never writes code, all implementation dispatched, dashboard is mandatory, long prompts require more planning, read the command file every time).
- Five responsibilities: Gather Context, Plan, Dispatch, Status, Report.
- Allowed file list (only dashboard files in `{tracker_root}`).
- Dashboard write schemas for `initialization.json`, `logs.json`, `master_state.json`, `plan.json`, and `metrics.json`.

---

#### worker-protocol

**User-invocable:** no

Progress reporting protocol for swarm worker agents. Contains:
- Full progress file JSON schema with all fields.
- Stage progression: `reading_context` -> `planning` -> `implementing` -> `testing` -> `finalizing` -> `completed`/`failed`.
- Mandatory write points (8 minimum per task).
- Deviation tracking format.
- Structured return format for reporting back to the master.

---

#### failure-protocol

**User-invocable:** no

Failure recovery protocol for master agents. Loaded when a worker fails. Contains:
- Worker return validation rules (STATUS, SUMMARY, FILES CHANGED, DIVERGENT ACTIONS).
- 8-step recovery procedure (Steps 0-7): double-failure detection, logging, repair task creation in `initialization.json`, dependency rewiring, repair worker prompt construction, dispatch, and verification.
- Circuit breaker thresholds: pause the swarm when 3+ tasks in the same wave fail.

---

### Operational Skills

#### dashboard-ops

**Invoked by:** `!status`, `!logs`, `!inspect`, `!deps`, `!history`, `!cancel`, `!cancel-safe`, `!reset`, `!start`, `!stop`, `!guide`, `!update_dashboard`, `!export`
**User-invocable:** yes

Routes to the correct Synapse monitoring/operation command. Contains a routing table mapping each `!command` to its implementation file in `_commands/Synapse/`.

**Dashboard resolution:** Uses the `DASHBOARD ID:` directive from the system prompt. Override with `--dashboard {id}` flag. Never auto-detects.

---

#### project-workflow

**Invoked by:** `!project`, `!initialize`, `!onboard`, `!context`, `!review`, `!health`, `!scaffold`, `!plan`, `!scope`, `!trace`, `!contracts`, `!env_check`, `!toc`, `!toc_generate`, `!toc_update`, `!commands`, `!profiles`, `!help`, `!create_claude`, `!learn`, `!learn_update`, `!instrument`, `!prompt_audit`
**User-invocable:** yes

Routes to the correct Synapse project setup, discovery, auditing, and analysis command. Covers project configuration, PKI management, TOC management, code review, health checks, and instrumentation.

---

## Skill-Agent Binding

Agent definitions in `.claude/agents/` specify which skills they load:

### master-orchestrator agent
```yaml
skills:
  - p-track
  - worker-protocol
  - master-protocol
  - failure-protocol
```

### swarm-worker agent
```yaml
skills:
  - worker-protocol
```

This means a master-orchestrator agent automatically has access to all orchestration protocols, while a swarm-worker agent gets only the worker progress reporting protocol.

---

## Creating a New Skill

1. Create a directory under `.claude/skills/` with a kebab-case name.
2. Create `SKILL.md` inside the directory with YAML frontmatter and markdown body.
3. Set `user-invocable: true` if users should be able to invoke it directly.
4. Set `context: fork` if the skill should run in a separate agent process (recommended for long-running orchestration).
5. Set `model: opus` if the skill requires advanced reasoning.
6. Add dynamic context blocks with `!` directives for runtime information.
7. If the skill should auto-load for an agent type, add it to the agent's `skills` list in `.claude/agents/*.md`.
