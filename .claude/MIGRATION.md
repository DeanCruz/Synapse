# Synapse Architecture Migration — 2026-03-24

This document records the migration from the prose-only `CLAUDE.md` enforcement model to the three-layer `.claude/` architecture.

## What Changed

### From `_commands/` prose to `.claude/skills/` (structural enforcement)

The `_commands/Synapse/` directory contained command specifications (e.g., `p_track.md`, `p.md`, `master_plan_track.md`) that agents were instructed to read via prose rules in `CLAUDE.md`. These specs still exist in `_commands/` and are referenced as detailed libraries, but each major command now has a corresponding **skill** in `.claude/skills/` that provides:

- YAML frontmatter declaring the skill's name, description, and trigger patterns
- Shell preprocessing blocks (`!` backtick syntax) that inject live runtime context (project root, available dashboards, project CLAUDE.md)
- Structured instructions that load automatically when the skill is invoked

| Old location | New location | What it provides |
|---|---|---|
| `_commands/Synapse/p_track.md` (read via prose rule) | `.claude/skills/p-track/SKILL.md` | Skill with preprocessing + references `_commands/` spec |
| `_commands/Synapse/p.md` | `.claude/skills/p/SKILL.md` | Lightweight parallel dispatch skill |
| `_commands/Synapse/master_plan_track.md` | `.claude/skills/master-plan-track/SKILL.md` | Multi-stream orchestration skill |
| Various `_commands/` analysis commands | `.claude/skills/project-workflow/SKILL.md` | Consolidated project analysis skill |
| Various `_commands/` dashboard commands | `.claude/skills/dashboard-ops/SKILL.md` | Consolidated dashboard operations skill |
| `agent/instructions/tracker_worker_instructions.md` | `.claude/skills/worker-protocol/SKILL.md` | Worker reporting protocol skill |

### From `CLAUDE.md` prose to `.claude/hooks/` (deterministic enforcement)

Critical invariants that were previously expressed as "NON-NEGOTIABLE" prose rules in `CLAUDE.md` are now enforced by shell script hooks that run automatically on tool invocations:

| Rule | Hook | Trigger |
|---|---|---|
| Master never writes project code | `validate-master-write.sh` | PreToolUse on Edit/Write |
| initialization.json is write-once | `validate-init-write-once.sh` | PreToolUse on Edit/Write |
| Progress files have required fields | `validate-progress-file.sh` | PostToolUse on Write |
| Archive before clearing dashboards | `validate-archive-before-clear.sh` | PreToolUse on Bash |
| Final report is present on stop | `verify-final-report.sh` | Stop |

### From implicit roles to `.claude/agents/` (structural definitions)

Agent roles that were described in prose within `CLAUDE.md` and `agent/instructions/` now have formal agent definition files:

| Agent | File | Skills loaded |
|---|---|---|
| Master Orchestrator | `.claude/agents/master-orchestrator.md` | p-track, worker-protocol |
| Swarm Worker | `.claude/agents/swarm-worker.md` | worker-protocol |

### From root `skills/` to `.claude/skills/` (relocated)

The old `skills/` directory at the repository root contained three Codex-oriented skills (`synapse-swarm-orchestrator`, `synapse-dashboard-operations`, `synapse-project-workflow`). These have been superseded by the new `.claude/skills/` structure and archived to `Archive/pre-migration-skills/`.

## What `_commands/` Still Contains

The `_commands/` directory is NOT deprecated. It remains the **detailed specification library** that skills reference for deep protocol details:

- `_commands/Synapse/` — Full command specs (p_track.md, p.md, master_plan_track.md, etc.)
- `_commands/project/` — Project analysis command specs
- `_commands/profiles/` — Profile definitions

Skills provide the structural entry point and shell preprocessing; `_commands/` provides the deep protocol documentation that gets loaded during execution.

## The Three-Layer Architecture

```
Layer 1: Hooks (deterministic)
  .claude/hooks/*.sh + .claude/settings.json
  Runs automatically on tool invocations. Cannot be bypassed.
  Enforces: write permissions, schema validation, archive-before-clear.

Layer 2: Skills + Agents (structural)
  .claude/skills/*/SKILL.md + .claude/agents/*.md
  Loaded when invoked. Provides structured instructions with runtime context.
  Enforces: command protocols, agent roles, dispatch patterns.

Layer 3: CLAUDE.md (advisory)
  CLAUDE.md at repository root
  Read by agents for orientation, document reference map, and decision flowcharts.
  Enforces: conventions, best practices, planning guidelines.
```

## How to Add New Commands

1. Create a directory: `.claude/skills/{skill-name}/`
2. Create `SKILL.md` with YAML frontmatter (`name`, `description`, optional `trigger`)
3. Add shell preprocessing blocks for runtime context injection
4. Reference any detailed specs in `_commands/` as needed
5. If the skill should be auto-loaded for an agent role, add it to the agent's `skills:` list in `.claude/agents/`

## How to Add New Enforcement Rules

1. Create a shell script in `.claude/hooks/{hook-name}.sh`
2. Make it executable: `chmod +x .claude/hooks/{hook-name}.sh`
3. Wire it in `.claude/settings.json` under the appropriate event (`PreToolUse`, `PostToolUse`, or `Stop`)
4. The script receives tool invocation context via environment variables and must exit 0 to allow, non-zero to block
5. If the hook is role-specific, also add it to the relevant agent definition in `.claude/agents/`
