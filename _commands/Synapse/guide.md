# `!guide`

**Purpose:** Interactive command decision tree that helps users pick the right Synapse command for their situation. Displays a flowchart of decisions plus a complete command reference.

**Syntax:** `!guide`

---

## Steps

1. **Display the decision tree flowchart:**

```markdown
## What do you want to do?

### Set up a project
  ├─ Point Synapse at a project ─────────── !project set /path/to/repo
  ├─ Show current project ───────────────── !project
  ├─ Initialize Synapse for a project ───── !initialize
  ├─ Get oriented in a new project ──────── !onboard
  └─ Generate CLAUDE.md for a project ───── !scaffold
  │
### Start parallel work
  ├─ How many tasks?
  │   ├─ < 5 tasks, quick job ────────────── !p {prompt}
  │   └─ 5+ tasks, need tracking ─────────── !p_track {prompt}
  │   └─ Multiple independent swarms ─────── !master_plan_track {prompt}
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
  ├─ Add tasks to a running swarm ─────────── !add_task {prompt}
  ├─ Run eager dispatch round ─────────────── !eager_dispatch
  ├─ Retry a failed task ──────────────────── !retry {id}
  ├─ Cancel the swarm (immediate) ─────────── !cancel
  └─ Cancel the swarm (graceful) ──────────── !cancel-safe
  │
### Resume & recovery
  ├─ Resume a chat session ────────────────── !resume
  ├─ Resume a stalled !p_track swarm ──────── !p_track_resume
  └─ Resume a stalled swarm ───────────────── !track_resume
  │
### Monitor a running swarm
  ├─ Quick status overview ────────────────── !status
  ├─ View event logs ──────────────────────── !logs
  ├─ Deep-dive into a specific task ───────── !inspect {id}
  ├─ See dependency graph ─────────────────── !deps
  └─ Generate visual progress report ──────── !update_dashboard
  │
### View & export history
  ├─ View past swarms ─────────────────────── !history
  │   └─ Last N only ─────────────────────── !history --last 5
  └─ Export swarm state ───────────────────── !export
  │
### Server control
  ├─ Launch the Electron app ──────────────── !start
  └─ Stop the dashboard server ────────────── !stop
  │
### Project analysis
  ├─ Deep context search ────────────────── !context {query}
  ├─ Code review ────────────────────────── !review
  ├─ Project health check ───────────────── !health
  ├─ Blast radius analysis ──────────────── !scope {change}
  ├─ End-to-end tracing ─────────────────── !trace {endpoint}
  ├─ API contract audit ─────────────────── !contracts
  ├─ Environment variable audit ─────────── !env_check
  ├─ Implementation planning ────────────── !plan {task}
  ├─ Post-swarm prompt audit ────────────── !prompt_audit
  └─ Generate opinionated CLAUDE.md ─────── !create_claude
  │
### Project Knowledge Index (PKI)
  ├─ Bootstrap PKI from scratch ─────────── !learn
  └─ Incrementally refresh PKI ──────────── !learn_update
  │
### Instrumentation
  └─ Add Live Preview labels ────────────── !instrument
  │
### Table of Contents
  ├─ Search project TOC ─────────────────── !toc {query}
  ├─ Generate full TOC ──────────────────── !toc_generate
  └─ Update TOC incrementally ───────────── !toc_update
  │
### Profiles & discovery
  ├─ List available profiles ────────────── !profiles
  ├─ List all commands ──────────────────── !commands
  └─ Show help guide ────────────────────── !help
  │
### Housekeeping
  ├─ Clear a dashboard ────────────────────── !reset
  ├─ Clear all dashboards ─────────────────── !reset --all
  └─ See this guide ───────────────────────── !guide
```

2. **Display the complete command reference table:**

```markdown
## Command Reference

### Project Management

| Command | Description |
|---|---|
| `!project` | Show, set, or clear the target project path. |
| `!initialize` | Initialize Synapse for a target project — create `.synapse/`, detect tech stack, optionally scaffold `CLAUDE.md`. |
| `!onboard` | Project walkthrough — read CLAUDE.md, TOC, key files and present a structured orientation. |
| `!scaffold` | Generate a `CLAUDE.md` for a project that doesn't have one. |

### Swarm Lifecycle

| Command | Description |
|---|---|
| `!p_track {prompt}` | Full swarm: deep planning, dependency-aware parallel dispatch, live dashboard tracking, and detailed statusing. The primary command for complex parallel work. |
| `!p {prompt}` | Lightweight parallel dispatch: deep planning and high-quality worker prompts without full dashboard tracking. Workers do NOT write progress files; master writes minimal progress from worker returns. |
| `!master_plan_track {prompt}` | Multi-stream orchestration: decompose large work into independent swarms across multiple dashboards. |
| `!add_task {prompt}` | Add tasks to an active swarm mid-flight. |
| `!dispatch {id}` | Manually dispatch a specific pending task. Use `!dispatch --ready` to dispatch all tasks whose dependencies are satisfied. |
| `!eager_dispatch` | Run a full eager dispatch round with complete worker prompts — dispatches all tasks with satisfied deps. |
| `!retry {id}` | Re-dispatch a failed or blocked task with a fresh agent. Deletes the old progress file and launches a new worker. |
| `!cancel` | Cancel the active swarm immediately. Marks all non-completed tasks as failed. Running agents may continue in the background. Use `--force` to skip confirmation. |
| `!cancel-safe` | Graceful shutdown: stops new dispatches but lets in-progress agents finish. Pending tasks are marked cancelled. Running agents complete naturally. |

### Resume & Recovery

| Command | Description |
|---|---|
| `!resume` | Resume a chat session after interruption — reviews history and continues where it left off. |
| `!p_track_resume` | Resume a stalled/interrupted `!p_track` swarm with full state reconstruction. |
| `!track_resume` | Resume a stalled/interrupted swarm — re-dispatch all incomplete tasks with full context. |

### Monitoring

| Command | Description |
|---|---|
| `!status` | Quick terminal summary of current swarm state — progress counts, agent table, wave overview. |
| `!logs` | View event log entries. Supports `--level`, `--task`, `--agent`, `--last`, `--since` filters. |
| `!inspect {id}` | Deep-dive into a specific task — full context, dependencies, status timeline, milestones, deviations, and worker logs. |
| `!deps` | Visualize the dependency graph. Use `!deps {id}` for a single task, `!deps --critical` for critical path, `!deps --blocked` for blocked tasks. |
| `!history` | View past swarm history summaries. Use `!history --last N` for recent only. |
| `!update_dashboard` | Generate a visual progress report of the current swarm. |
| `!export` | Export a dashboard's swarm state as markdown or JSON. |

### Server Control

| Command | Description |
|---|---|
| `!start` | Launch the Synapse Electron app (which embeds the dashboard server). |
| `!stop` | Stop the Synapse dashboard server. |

### Housekeeping

| Command | Description |
|---|---|
| `!reset` | Clear a dashboard and reset it to empty state. Archives the dashboard first, then saves a history summary before clearing. Use `--all` to reset all dashboards. |
| `!guide` | Show this command decision tree and reference. |

### Project Analysis

| Command | Description |
|---|---|
| `!context {query}` | Deep context gathering within the target project. |
| `!review` | Code review of recent changes or specified files. |
| `!health` | Project health check — CLAUDE.md quality, dependency health, TOC consistency. |
| `!scope {change}` | Blast radius analysis — what would be affected by a proposed change. |
| `!trace {endpoint}` | End-to-end code tracing of an endpoint, function, or data flow. |
| `!contracts` | API contract audit — consistency between interfaces and implementations. |
| `!env_check` | Environment variable audit — consistency across configs. |
| `!plan {task}` | Implementation planning based on project context. |
| `!prompt_audit` | Post-swarm prompt quality audit — analyzes worker performance and prompt effectiveness. |
| `!create_claude` | Create or update an opinionated CLAUDE.md for a project. |

### Project Knowledge Index (PKI)

| Command | Description |
|---|---|
| `!learn` | Bootstrap the Project Knowledge Index from scratch. |
| `!learn_update` | Incrementally refresh the PKI (stale/new files only). |
| `!instrument` | Add `data-synapse-label` attributes to project files for Live Preview. |

### Table of Contents

| Command | Description |
|---|---|
| `!toc {query}` | Search the project Table of Contents. |
| `!toc_generate` | Generate a full project TOC via parallel agent swarm. |
| `!toc_update` | Incrementally update the TOC for changed files. |

### Profiles & Discovery

| Command | Description |
|---|---|
| `!profiles` | List all available agent role profiles. |
| `!commands` | List all available commands from all locations. |
| `!help` | Master agent guide — when to use each command. |
```

3. **Display the quick-pick tips:**

```markdown
## Quick Tips

- **Most users start with `!p_track`** — it handles everything: planning, dispatch, tracking, and reporting.
- **Use `!p` for quick jobs** — fewer than 3 tasks where you don't need live progress tracking.
- **Each chat uses its assigned dashboard** — commands automatically use the dashboard bound to your chat view.
- **`!cancel-safe` over `!cancel`** — prefer graceful shutdown to avoid losing in-progress work.
- **Combine `!logs` filters** — e.g., `!logs --level error --last 10` for recent errors only.
- **Bootstrap project knowledge with `!learn`** — run once per project to build the PKI, then `!learn_update` to keep it current.
```
