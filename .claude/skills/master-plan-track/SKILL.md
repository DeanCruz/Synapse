---
name: master-plan-track
description: >
  Multi-stream orchestration across multiple Synapse dashboards. Use when the user
  invokes !master_plan_track for coordinating multiple independent swarms that each
  need their own dashboard, dependency graph, and worker pool.
argument-hint: <prompt>
user-invocable: true
context: fork
model: opus
---

# Multi-Stream Orchestration (`!master_plan_track`)

The invoking agent becomes the **meta-planner** — decomposing large work into multiple independent planning streams, dispatching planner agents to create plans in parallel, then dispatching child master agents to execute each stream on its own dashboard.

## When to Use

| Condition | Command | Why |
|---|---|---|
| <5 tasks, <5 min total work | `!p` | Lightweight — planning overhead not justified |
| 5+ tasks, single logical swarm | `!p_track` | Full planning with one dashboard |
| Multiple independent swarms | `!master_plan_track` | Parallelizes planning AND execution across dashboards |
| Work requiring 2+ sequential `!p_track` runs | `!master_plan_track` | Plans all streams at once |

**Rule of thumb:** If the work splits into 2+ independent swarms (each with its own dependency graph), use `!master_plan_track`. If it is one swarm, use `!p_track`.

## Dynamic Context

!`echo "PROJECT_ROOT: $(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null || echo 'UNSET')"`
!`echo "TRACKER_ROOT: $(pwd)"`
!`echo "AVAILABLE DASHBOARDS:" && ls -d dashboards/*/ 2>/dev/null | while read d; do basename "$d"; done`

## NON-NEGOTIABLE Rules

1. **The meta-planner NEVER writes code** — it plans, dispatches planner agents, then dispatches child masters
2. **The meta-planner never manages workers directly** — child master agents handle their own swarms
3. **Read `{project_root}/CLAUDE.md` before planning** — every time, no exceptions
4. **Each stream gets its own dashboard** — never multiplex streams onto one dashboard
5. **Archive before clear** — never discard previous swarm data

## Agent Hierarchy

```
Meta-Planner (you)
  |-- Planner Agent 1 --> Plan for Stream A
  |-- Planner Agent 2 --> Plan for Stream B
  |-- ...
  v (after plans approved)
  |-- Child Master A --> Swarm on Dashboard X
  |-- Child Master B --> Swarm on Dashboard Y
```

## Execute

Read `_commands/Synapse/master_plan_track.md` for the complete protocol, then execute multi-stream orchestration for: $ARGUMENTS
