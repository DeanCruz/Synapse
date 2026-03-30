---
name: project-workflow
description: >
  Run Synapse project setup, discovery, auditing, and analysis workflows.
  Handles project configuration, onboarding, code review, health checks,
  TOC management, scaffolding, implementation planning, PKI management, and
  instrumentation. Use when the user invokes !project, !initialize, !onboard,
  !context, !review, !health, !scaffold, !plan, !scope, !trace, !contracts,
  !env_check, !toc, !toc_generate, !toc_update, !commands, !profiles, !help,
  !create_claude, !learn, !learn_update, !instrument, or !prompt_audit.
argument-hint: <command> [args]
user-invocable: true
---

# Project Workflow Commands

Route to the correct Synapse command for project setup, discovery, auditing, and analysis.

## Dynamic Context

!`echo "PROJECT_ROOT: $(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null || echo 'UNSET')"`

## Command Routing Table

### Project Setup

| Command | File | Description |
|---|---|---|
| `!project` | `_commands/Synapse/project.md` | Show, set, or clear target project path |
| `!initialize` | `_commands/project/initialize.md` | Initialize Synapse for a target project |
| `!onboard` | `_commands/project/onboard.md` | Project walkthrough and orientation |
| `!scaffold` | `_commands/project/scaffold.md` | Generate a CLAUDE.md for a project |
| `!create_claude` | `_commands/project/create_claude.md` | Create/update opinionated CLAUDE.md |

### Analysis & Auditing

| Command | File | Description |
|---|---|---|
| `!context {query}` | `_commands/project/context.md` | Deep context gathering |
| `!review` | `_commands/project/review.md` | Code review |
| `!health` | `_commands/project/health.md` | Project health check |
| `!scope {change}` | `_commands/project/scope.md` | Blast radius analysis |
| `!trace {endpoint}` | `_commands/project/trace.md` | End-to-end code tracing |
| `!contracts` | `_commands/project/contracts.md` | API contract audit |
| `!env_check` | `_commands/project/env_check.md` | Environment variable audit |
| `!plan {task}` | `_commands/project/plan.md` | Implementation planning |
| `!prompt_audit` | `_commands/project/prompt_audit.md` | Post-swarm prompt quality audit |

### PKI & Instrumentation

| Command | File | Description |
|---|---|---|
| `!learn` | `_commands/project/learn.md` | Bootstrap the Project Knowledge Index from scratch |
| `!learn_update` | `_commands/project/learn_update.md` | Incrementally refresh the PKI (stale/new files only) |
| `!instrument` | `_commands/project/instrument.md` | Add `data-synapse-label` attributes for Live Preview |

### TOC Management

| Command | File | Description |
|---|---|---|
| `!toc {query}` | `_commands/project/toc.md` | Search the project TOC |
| `!toc_generate` | `_commands/project/toc_generate.md` | Generate a full project TOC |
| `!toc_update` | `_commands/project/toc_update.md` | Incrementally update the TOC |

### Discovery

| Command | File | Description |
|---|---|---|
| `!commands` | `_commands/project/commands.md` | List all available commands |
| `!profiles` | `_commands/project/profiles.md` | List available profiles |
| `!help` | `_commands/project/help.md` | Master agent guide |

## Execute

Read the command file for `$ARGUMENTS` from the routing table above and follow it exactly.
