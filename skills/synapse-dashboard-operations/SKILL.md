---
name: synapse-dashboard-operations
description: Inspect, monitor, and operate existing Synapse swarms. Use when a request maps to Synapse operational commands like `!status`, `!logs`, `!inspect`, `!deps`, `!history`, `!cancel`, `!cancel-safe`, `!reset`, `!start`, `!stop`, or `!guide`, or when Codex needs to read dashboard state, analyze dependencies, inspect a task, control the server, or safely intervene in an active swarm.
---

# Synapse Dashboard Operations

Operate on already planned or already running swarms. This skill is for reading dashboard state, inspecting task details, controlling the dashboard server, and intervening in swarm execution without re-planning the work.

## Quick Start

1. Resolve the target dashboard using the explicit dashboard argument or the dashboard resolution rules.
2. Read `initialization.json`, `logs.json`, and any progress files needed for the requested view or operation.
3. Derive swarm state from worker progress files rather than inventing counters.
4. Follow the corresponding command spec for any mutating action.

## Core Capabilities

### Monitor Swarms

- Show current overall status and task state with `!status`.
- Read filtered event history with `!logs`.
- Inspect one task deeply with `!inspect`.
- Analyze dependency structure or blockers with `!deps`.
- Browse prior completed swarms with `!history`.

### Intervene Safely

- Use `!cancel` for immediate cancellation.
- Use `!cancel-safe` for graceful shutdown that preserves running work.
- Use `!reset` to clear dashboard state after preserving history.

### Control the Dashboard

- Use `!start` and `!stop` for the Synapse web server.
- Use `!guide` to surface the command decision tree.

Read [references/command-map.md](references/command-map.md) for exact source files.

## Operating Rules

- Treat `initialization.json` as the static plan.
- Treat `progress/*.json` as the live task state.
- For cancel flows, master-written progress files are an explicit exception, not the norm.
- Keep user-facing responses concise and grounded in the actual dashboard files.

## Decision Hints

- If the user asks “what is happening now?”, start with `status`, `logs`, or `inspect`.
- If the user asks “what blocks this?”, use `deps`.
- If the user asks to stop work, choose between `cancel` and `cancel-safe` based on whether running work should be preserved.
- If the user asks to browse completed runs, use `history`.

## References

- Read [references/command-map.md](references/command-map.md) for operational command behavior and source files.

