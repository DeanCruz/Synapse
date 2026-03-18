---
name: synapse-project-workflow
description: Run Synapse project setup, discovery, auditing, and analysis workflows. Use when a request maps to Synapse project commands like `!project`, `!initialize`, `!onboard`, `!context`, `!review`, `!health`, `!scaffold`, `!plan`, `!scope`, `!trace`, `!contracts`, `!env_check`, `!toc`, `!toc_generate`, `!toc_update`, `!commands`, `!profiles`, or `!help`, or when Codex needs to orient itself in a target repo managed by Synapse.
---

# Synapse Project Workflow

Use Synapse’s project-side command library to discover a target codebase, initialize project metadata, audit for problems, and produce implementation analysis before coding. This skill covers the project-management layer, not active dashboard operations.

## Quick Start

1. Resolve `{project_root}` with Synapse’s standard order:
   - explicit project flag
   - `/Users/andrewdimarogonas/Desktop/Huxli-parent/Synapse/.synapse/project.json`
   - current working directory
2. Read the target project’s `AGENTS.md` or `CLAUDE.md` first.
3. Use `.synapse/toc.md` when it exists and improves discovery speed.
4. Read the specific command spec before performing the task.

## Capability Areas

### Project Resolution and Setup

- `!project`
- `!initialize`
- `!onboard`
- `!scaffold`

### Discovery and Analysis

- `!context`
- `!plan`
- `!scope`
- `!trace`
- `!toc`
- `!toc_generate`
- `!toc_update`

### Review and Auditing

- `!review`
- `!health`
- `!contracts`
- `!env_check`

### Discovery of Synapse Itself

- `!commands`
- `!profiles`
- `!help`

Read [references/command-map.md](references/command-map.md) for the mapping.

## Working Rules

- Prefer targeted grep/glob discovery before broad reads.
- Verify TOC hits against the actual file before reporting them.
- For audit and review commands, prioritize findings, breakage risk, and missing follow-up work.
- For `toc_generate` and `toc_update`, parallelism is part of the design; if you execute them as true swarms, switch into master mode and follow Synapse orchestration rules.

## Output Expectations

- `plan` should stay implementation-free and focus on scope, files, risks, and sequencing.
- `review` should lead with concrete findings, not summaries.
- `scope` and `trace` should explain cross-layer impact clearly enough for a user to decide what to do next.
- `commands` and `profiles` should be generated from the filesystem, not a hardcoded list.

## References

- Read [references/command-map.md](references/command-map.md) for project command behavior and source files.

