# Synapse Dashboard Operations Command Map

These commands operate on existing dashboards, progress files, or server state.

| Command | Use When | Source File |
|---|---|---|
| `!status [dashboardId]` | Show current swarm summary and task states | `/_commands/status.md` |
| `!logs [dashboardId] {filter}` | Inspect event logs with filtering | `/_commands/logs.md` |
| `!inspect [dashboardId] {task_id}` | Deep-dive into one task | `/_commands/inspect.md` |
| `!deps [dashboardId] [task_id] [--critical] [--blocked]` | Analyze dependencies, blockers, and critical path | `/_commands/deps.md` |
| `!history [--last N]` | Browse past swarms | `/_commands/history.md` |
| `!cancel [dashboardId] [--force]` | Immediately cancel a swarm | `/_commands/cancel.md` |
| `!cancel-safe [dashboardId]` | Gracefully stop dispatching and wait for running tasks | `/_commands/cancel-safe.md` |
| `!reset [dashboardId] [--all]` | Clear dashboard state and preserve history | `/_commands/reset.md` |
| `!start` | Start the dashboard server | `/_commands/start.md` |
| `!stop` | Stop the dashboard server | `/_commands/stop.md` |
| `!guide` | Show the command decision tree | `/_commands/guide.md` |

## Files Commonly Read

- `/dashboards/{dashboardId}/initialization.json`
- `/dashboards/{dashboardId}/logs.json`
- `/dashboards/{dashboardId}/progress/*.json`
- `/history/*.json`

## Key Interpretation Rules

- Completed and failed counts should be derived from progress files.
- A task with no progress file is pending unless the command spec says otherwise.
- The dashboard resolver in `/agent/instructions/dashboard_resolution.md` controls auto-selection.

