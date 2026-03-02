# `!guide`

**Purpose:** Interactive command decision tree that helps users pick the right Synapse command for their situation. Displays a flowchart of decisions plus a complete command reference.

**Syntax:** `!guide`

---

## Steps

1. **Display the decision tree flowchart:**

```markdown
## What do you want to do?

### Start parallel work
  ├─ How many tasks?
  │   ├─ < 5 tasks, quick job ────────────── !p {prompt}
  │   └─ 5+ tasks, need tracking ─────────── !p_track {prompt}
  │
### Monitor a running swarm
  ├─ Quick status overview ────────────────── !status
  ├─ View event logs ──────────────────────── !logs
  ├─ Filter logs by level/task/agent ──────── !logs --level error | --task 2.3 | --agent "Agent 1"
  ├─ Deep-dive into a specific task ───────── !inspect {id}
  └─ See dependency graph ─────────────────── !deps
      └─ Critical path only ───────────────── !deps --critical
  │
### Take action on tasks
  ├─ Dispatch a pending task manually ─────── !dispatch {id}
  ├─ Dispatch all unblocked tasks ─────────── !dispatch --ready
  ├─ Retry a failed task ──────────────────── !retry {id}
  ├─ Cancel the swarm (immediate) ─────────── !cancel
  └─ Cancel the swarm (graceful) ──────────── !cancel-safe
  │
### View history
  └─ View past swarms ─────────────────────── !history
      └─ Last N only ─────────────────────── !history --last 5
  │
### Server control
  ├─ Start the dashboard server ───────────── !start
  └─ Stop the dashboard server ────────────── !stop
  │
### Housekeeping
  ├─ Clear dashboard data ─────────────────── !reset
  ├─ Clear all dashboards ─────────────────── !reset --all
  └─ See this guide ───────────────────────── !guide
```

2. **Display the complete command reference table:**

```markdown
## Command Reference

### Swarm Lifecycle

| Command | Description |
|---|---|
| `!p_track {prompt}` | Full swarm: deep planning, dependency-aware parallel dispatch, live dashboard tracking, and detailed statusing. The primary command for complex parallel work. |
| `!p {prompt}` | Lightweight parallel dispatch: deep planning and high-quality worker prompts without dashboard tracking overhead. No XML, no dashboard writes, no progress files. |
| `!dispatch {id}` | Manually dispatch a specific pending task. Use `!dispatch --ready` to dispatch all tasks whose dependencies are satisfied. |
| `!retry {id}` | Re-dispatch a failed or blocked task with a fresh agent. Deletes the old progress file and launches a new worker. |
| `!cancel` | Cancel the active swarm immediately. Marks all non-completed tasks as failed. Running agents may continue in the background. Use `--force` to skip confirmation. |
| `!cancel-safe` | Graceful shutdown: stops new dispatches but lets in-progress agents finish. Pending tasks are marked cancelled. Running agents complete naturally. |

### Monitoring

| Command | Description |
|---|---|
| `!status` | Quick terminal summary of current swarm state — progress counts, agent table, wave overview. |
| `!logs` | View event log entries. Supports `--level`, `--task`, `--agent`, `--last`, `--since` filters. |
| `!inspect {id}` | Deep-dive into a specific task — full context, dependencies, status timeline, milestones, deviations, and worker logs. |
| `!deps` | Visualize the dependency graph. Use `!deps {id}` for a single task, `!deps --critical` for critical path, `!deps --blocked` for blocked tasks. |
| `!history` | View past swarm history summaries. Use `!history --last N` for recent only. |

### Server Control

| Command | Description |
|---|---|
| `!start` | Start the Synapse dashboard server and open it in the browser. |
| `!stop` | Stop the Synapse dashboard server. |

### Housekeeping

| Command | Description |
|---|---|
| `!reset` | Clear a dashboard and reset it to empty state. Saves a history summary before clearing. Use `--all` to reset all 5 dashboards. Use `--keep-history` to preserve past task records. |
| `!guide` | Show this command decision tree and reference. |
```

3. **Display the quick-pick tips:**

```markdown
## Quick Tips

- **Most users start with `!p_track`** — it handles everything: planning, dispatch, tracking, and reporting.
- **Use `!p` for quick jobs** — fewer than 5 tasks where you don't need a live dashboard.
- **All dashboard commands auto-detect** — you don't need to specify `dashboardN` unless you're running multiple swarms.
- **`!cancel-safe` over `!cancel`** — prefer graceful shutdown to avoid losing in-progress work.
- **Combine `!logs` filters** — e.g., `!logs --level error --last 10` for recent errors only.
```
