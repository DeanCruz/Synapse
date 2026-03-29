---
name: p
description: >
  Run a lightweight Synapse parallel dispatch without full dashboard tracking.
  Use when the user invokes !p or when a task needs quick parallel execution
  without live progress files, metrics, or master state checkpoints.
argument-hint: <prompt>
user-invocable: true
context: fork
model: opus
---

# Lightweight Parallel Dispatch (`!p`)

Fast parallel swarm with minimal dashboard overhead. The master plans, decomposes, and dispatches workers with rich prompts — but skips progress files, master_state, and metrics.

## `!p` vs `!p_track` Decision Matrix

| Condition | Command | Why |
|---|---|---|
| <3 tasks, single wave, focused scope | `!p` | Speed over visualization — lightweight writes |
| 3+ tasks OR >1 wave | `!p_track` (recommended) | Full live tracking, progress files, metrics |
| 5+ tasks, long-running | `!p_track` | Full planning, dependency tracking, live dashboard |
| Need live dashboard monitoring | `!p_track` | Progress files drive the dashboard |
| Quick parallel burst (<3 tasks, 1 wave) | `!p` | Minimal overhead, plan snapshot only |

**Key differences from `!p_track`:**
- No worker progress files — no live task tracking
- No `master_state.json` — no compaction recovery checkpoint
- No `metrics.json` — no post-swarm performance data
- Dashboard receives `initialization.json` (plan snapshot) + bookend `logs.json` entries only

**Escalation recommendation:** If the plan has **3+ agents** or **more than 1 wave**, the master SHOULD recommend `!p_track` to the user before proceeding. The user can override and stay in `!p` mode — they explicitly chose speed over visibility.

## Dynamic Context

!`echo "PROJECT_ROOT: $(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null || echo 'UNSET')"`
!`echo "TRACKER_ROOT: $(pwd)"`

## NON-NEGOTIABLE Rules

1. **The master NEVER writes code** — not a single line, not a quick fix
2. **Read `{project_root}/CLAUDE.md` before planning** — every time, no exceptions
3. **Workers get self-contained prompts** — they cannot ask follow-up questions
4. **Always parallelize independent work** — sequential execution of independent tasks is a failure mode
5. **Archive before clear** — never discard previous swarm data

## Dashboard Writes (Lightweight)

The master writes only two files during a `!p` swarm:
- `dashboards/{id}/initialization.json` — Plan snapshot (written once before dispatch)
- `dashboards/{id}/logs.json` — Bookend entries: swarm start + swarm completion

Workers write nothing to the dashboard. All coordination happens through conversation context.

## Protocol Reference

Read these files in order before executing:
1. `_commands/Synapse/p.md` — Complete `!p` protocol (NON-NEGOTIABLE)
2. `agent/instructions/tracker_master_instructions.md` — Master agent hub
3. `{project_root}/CLAUDE.md` — Target project conventions

## Execute

Execute the lightweight swarm for: $ARGUMENTS
