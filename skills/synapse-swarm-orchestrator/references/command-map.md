# Synapse Swarm Orchestrator Command Map

Use these command specs as the canonical procedures for swarm execution.

| Command | Use When | Source File |
|---|---|---|
| `!p_track {prompt}` | Full tracked swarm with dashboard, XML plan, logs, and dependency-aware dispatch | `/_commands/p_track.md` |
| `!p {prompt}` | Lightweight parallel execution without the full tracking flow | `/_commands/p.md` |
| `!master_plan_track {prompt}` | Higher-level coordination across multiple streams or swarms | `/_commands/master_plan_track.md` |
| `!dispatch [dashboardId] {task_id \| --ready}` | Manually dispatch one pending task or all ready tasks | `/_commands/dispatch.md` |
| `!retry [dashboardId] {task_id}` | Re-run a failed task with prior context | `/_commands/retry.md` |

## Shared Swarm Inputs

- `/Users/andrewdimarogonas/Desktop/Huxli-parent/Synapse/AGENTS.md`
- `/_commands/p_track.md`
- `/agent/instructions/tracker_master_instructions.md`
- `/agent/instructions/tracker_worker_instructions.md`
- `/agent/instructions/dashboard_resolution.md`

## Shared Swarm Outputs

- `/tasks/{MM_DD_YY}/parallel_{task_name}.xml`
- `/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`
- `/dashboards/{dashboardId}/initialization.json`
- `/dashboards/{dashboardId}/logs.json`
- `/dashboards/{dashboardId}/progress/{task_id}.json`

## Non-Negotiables

- The master plans and dispatches; workers implement.
- Worker prompts must include both tracker and project roots.
- For tracked swarms, `initialization.json` is static plan data, written once.

