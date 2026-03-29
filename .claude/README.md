# .claude/ Directory Structure

This directory contains the Claude Code architecture enforcement layer for Synapse.

## Contents

| Directory | Purpose |
|---|---|
| `hooks/` | Shell scripts that run automatically on tool invocations (PreToolUse, PostToolUse, Stop). These enforce deterministic rules: master write restrictions, write-once semantics, progress file validation, archive-before-clear, and final report verification. |
| `agents/` | Agent definition files with YAML frontmatter. Define the master-orchestrator and swarm-worker roles, their skills, and role-specific hooks. |
| `skills/` | Skill definitions with YAML frontmatter and shell preprocessing. Each skill is a directory containing a `SKILL.md` that loads structured instructions and injects runtime context when invoked. |
| `settings.json` | Hook wiring configuration. Maps tool events to hook scripts. |

## Relationship to Other Directories

- `_commands/` — Detailed command specs referenced by skills as protocol libraries (not replaced)
- `agent/` — Instruction hubs and master/worker protocol docs referenced by skills
- `CLAUDE.md` — Advisory layer providing orientation, document map, and decision flowcharts

## See Also

- `MIGRATION.md` — Documents what changed and why
