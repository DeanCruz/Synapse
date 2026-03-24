---
name: dashboard-ops
description: >
  Monitor, inspect, and operate Synapse swarms. Handles status checks, log viewing,
  task inspection, dependency analysis, history browsing, cancellation, resets, and
  server control. Use when the user invokes !status, !logs, !inspect, !deps, !history,
  !cancel, !cancel-safe, !reset, !start, !stop, !guide, or !update_dashboard.
argument-hint: <command> [args]
user-invocable: true
---

# Dashboard Operations

Route to the correct Synapse command for monitoring, inspecting, and operating swarms.

## Command Routing Table

| Command | File | Description |
|---|---|---|
| `!status` | `_commands/Synapse/status.md` | Terminal status summary |
| `!logs` | `_commands/Synapse/logs.md` | View/filter log entries |
| `!inspect {id}` | `_commands/Synapse/inspect.md` | Deep-dive into a specific task |
| `!deps` | `_commands/Synapse/deps.md` | Dependency graph visualization |
| `!history` | `_commands/Synapse/history.md` | Past swarm history |
| `!cancel` | `_commands/Synapse/cancel.md` | Immediate cancellation |
| `!cancel-safe` | `_commands/Synapse/cancel-safe.md` | Graceful shutdown |
| `!reset` | `_commands/Synapse/reset.md` | Clear dashboard state |
| `!start` | `_commands/Synapse/start.md` | Start dashboard server |
| `!stop` | `_commands/Synapse/stop.md` | Stop dashboard server |
| `!guide` | `_commands/Synapse/guide.md` | Command decision tree |
| `!update_dashboard` | `_commands/Synapse/update_dashboard.md` | Update dashboard data |

## Dashboard Resolution

Resolve target dashboard: `--dashboard {id}` flag if provided, otherwise auto-select first available dashboard (excluding `ide`). The `ide` dashboard is reserved for the IDE agent.

Dashboard ID formats:
- `ide` — Reserved, always exists, auto-created on startup
- 6-char hex (e.g., `a3f7k2`) — Regular dashboards
- `dashboardN` (e.g., `dashboard1`) — Legacy format, still functional

## Key Principles

- All dashboard stats are **derived from progress files** — the master does not maintain counters
- Progress files are the single source of truth for task state
- **Archive before clear** — always archive to `Archive/{YYYY-MM-DD}_{task_name}/` before resetting

## Dynamic Context

!`echo "TRACKER_ROOT: $(pwd)"`
!`echo "DASHBOARDS:" && ls -d dashboards/*/ 2>/dev/null | while read d; do basename "$d"; done`

## Execute

Read the command file for `$ARGUMENTS` from the routing table above and follow it exactly.
