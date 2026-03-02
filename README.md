<div align="center">

# ⚡ Synapse

### Distributed Agent Swarm Control System

[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)]()
[![Node.js](https://img.shields.io/badge/node.js-built--ins%20only-339933?logo=node.js&logoColor=white)]()
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blueviolet?logo=anthropic&logoColor=white)]()
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Parallelize your AI agents. Visualize the swarm. Ship faster.**

Synapse decomposes complex tasks into independent units, dispatches multiple agents simultaneously,<br>tracks dependencies between them, and gives you a live dashboard to watch it all happen in real-time.

[Getting Started](#setup) · [Commands](#commands) · [Dashboard](#dashboard) · [How It Works](#how-it-works)

</div>

---

<div align="center">

### What changes with Synapse

| Without | With Synapse |
|:---:|:---:|
| 1 agent, sequential tasks | N agents, parallel execution |
| Context exhaustion on large tasks | Context distributed across workers |
| No visibility into progress | Live dashboard with dependency graph |
| Manual retry on failure | Automatic repair task dispatch |

</div>

---

## Setup

> **Prerequisites:** Node.js (any recent version) + Claude Code CLI. No `npm install` needed.

### 1. Clone Synapse into Your Workspace

Your workspace is the parent directory that contains your project repos.

```bash
cd your-workspace/
git clone <synapse-repo-url> Synapse
```

### 2. Move Parent Files to the Workspace Root

`Synapse/_parent/` contains files that **must** live at the workspace root — one level above Synapse:

```bash
cp Synapse/_parent/CLAUDE.md ./CLAUDE.md
cp -r Synapse/_parent/_commands ./_commands
```

| File | Purpose |
|---|---|
| `CLAUDE.md` | Master agent instructions — orchestration rules, `!command` resolution, multi-repo coordination |
| `_commands/` | Workspace-level commands — `!review`, `!trace`, `!initialize`, and more |

<details>
<summary><b>Resulting workspace structure</b></summary>

```
your-workspace/
├── CLAUDE.md              ← Master agent instructions (from _parent/)
├── _commands/             ← Workspace commands (from _parent/)
├── Synapse/               ← This tool
├── your-project-1/
├── your-project-2/
└── ...
```

</details>

### 3. Add CLAUDE.md Files to Your Repos

Each repo should have its own `CLAUDE.md` describing its tech stack, architecture, and conventions. Workers read these before implementing — better docs mean better output.

> **Don't have them yet?** Run `!initialize` after setup — it detects missing files and scaffolds templates.

### 4. Start the Dashboard

```bash
./Synapse/start.sh
```

Open **http://localhost:3456** — you'll see the dashboard waiting for a swarm.

### 5. Run Your First Swarm

```
!p_track Build a REST API with user authentication and product CRUD endpoints
```

The master agent reads your codebase, plans the work, populates the dashboard, and asks for your approval before dispatching workers.

---

## Commands

### ⚡ Dispatching Work

| Command | When to Use |
|---|---|
| **`!p_track {prompt}`** | Full orchestration — live dashboard, dependency tracking, history. Use for 5+ tasks, cross-repo work, or complex dependencies. |
| **`!p {prompt}`** | Lightweight parallel dispatch — same planning, no dashboard overhead. Use for quick jobs under 5 tasks. |

Both trigger the same deep planning process. The difference is whether the dashboard tracks it.

### 📊 Monitoring

| Command | What It Shows |
|---|---|
| `!status` | Progress summary — completed/total, failures, elapsed time, per-agent table |
| `!logs` | Event log — `--level error`, `--task 2.3`, `--last 20`, `--since 14:30` |
| `!inspect {id}` | Deep-dive — timeline, milestones, deviations, dependencies, worker logs |
| `!deps` | Dependency graph — `--critical` for critical path, `--blocked` for stuck chains |

### 🔧 Intervening

| Command | What It Does |
|---|---|
| `!dispatch {id}` | Manually dispatch a task. `--ready` dispatches all unblocked tasks |
| `!retry {id}` | Re-run a failed task — the new agent gets the failure context |
| `!cancel` | Immediately cancel. `--force` skips confirmation |
| `!cancel-safe` | Graceful shutdown — waits for in-progress agents to finish |

### 📁 Housekeeping

| Command | What It Does |
|---|---|
| `!history` | Browse past swarms. `--last 5` for recent only |
| `!reset` | Clear dashboard + save history. `--all` clears all 5 dashboards |
| `!start` / `!stop` | Start or stop the dashboard server |
| `!guide` | Interactive command decision tree |

---

## How It Works

```
  !p_track {your task}
         │
         ▼
  ┌─────────────────────┐
  │  Master reads your   │
  │  codebase deeply     │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  Plans atomic tasks  │
  │  with dependencies   │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  Dashboard shows the │
  │  plan — you approve  │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  Workers dispatched  │◄──── parallel execution
  │  in parallel         │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  Live progress on    │◄──── real-time SSE updates
  │  dashboard           │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  Summary report      │
  └─────────────────────┘
```

<details>
<summary><b>Key design decisions</b></summary>

- **The master agent never writes code.** It reads, plans, dispatches, and reports. Workers do all implementation.
- **Workers are self-contained.** Each gets a complete prompt — files to modify, conventions, code context, success criteria. No back-and-forth.
- **Dependencies drive dispatch, not waves.** The moment a task's dependencies are satisfied, it launches — even if sibling tasks are still running.
- **Failures don't stop the swarm.** A failed task blocks only its direct dependents. The master dispatches repair tasks automatically.

</details>

### Context & Token Optimization

> *Why not just use one agent?*

A single agent on a large task will exhaust its context window — it forgets early decisions, re-reads files, and loses coherence. Synapse solves this through architectural separation:

| Strategy | How It Works |
|---|---|
| **Read once, distill many** | Master reads your entire codebase during planning, then distills targeted prompts per worker. Each worker's context is small, focused, and complete. |
| **Workers never search** | No wasted context on exploration. The master already embedded the patterns, conventions, and file contents directly in the prompt. |
| **Upstream results flow downstream** | When Wave 1 completes, the master injects its outputs (files created, types exported, deviations) into Wave 2 prompts. No re-reading upstream work. |
| **Write-once plan** | `initialization.json` written once. Workers own their progress files. Dashboard derives stats client-side. Zero status bookkeeping overhead. |

```
Wave 1: Create database schema ──────┐    Create auth middleware ──────┐
                                      │                                │
                                      ▼                                ▼
Wave 2: Build User service ──────────┐│   Build Auth service ─────────┐│
        (gets schema output)         ││   (gets middleware output)    ││
                                     ▼▼                               ▼▼
Wave 3:          Integration task (gets ALL upstream outputs)
```

> **The net effect:** instead of one 200K-token context window trying to hold everything, you get a master spending context on planning + N workers each with focused execution windows. Total effective context scales linearly with workers.

---

## Dashboard

<table>
<tr>
<td width="50%">

### Wave Mode
Vertical columns per dependency level. Independent tasks side-by-side. Best for broad, parallel workloads.

### Chain Mode
Horizontal rows per dependency chain. Tasks flow left-to-right. Best for narrow, deep pipelines.

</td>
<td width="50%">

### What You'll See
- **Stat cards** — Total, Completed, In Progress, Failed, Pending, Elapsed
- **Agent cards** — Stage, elapsed time, latest milestone
- **Dependency lines** — Hover for needs (blue) and blocks (red)
- **Deviation badges** — Yellow when workers diverge from plan
- **Log panel** — Filterable event log
- **Agent popups** — Full timeline, deviations, worker logs

</td>
</tr>
</table>

**Multi-Dashboard** — Up to 5 simultaneous swarms. Synapse auto-selects the first available slot and never overwrites an in-progress swarm.

---

## Configuration

| Setting | Default | Override |
|---|---|---|
| Port | `3456` | `PORT=8080 node Synapse/src/server/index.js` |

---

## Tips

> [!TIP]
> **Write detailed prompts.** The more context you give `!p_track`, the better the master decomposes work. Vague prompts produce vague plans.

> [!TIP]
> **Let the master read.** The planning phase reads extensively. This is intentional — well-informed plans produce well-informed workers.

> [!TIP]
> **Review the plan before approving.** The dashboard shows the full task graph before dispatch. Check that decomposition and dependencies look right.

> [!TIP]
> **Use `!p` for small jobs, `!p_track` for anything complex.** The split is roughly at 5 tasks — below that, skip the dashboard overhead.

> [!TIP]
> **Check deviations.** Yellow badges mean a worker diverged from the plan. Not necessarily bad, but worth reviewing.

> [!TIP]
> **Retry before giving up.** `!retry {id}` passes the failure context to a fresh agent. It often succeeds where a blind retry would fail.

---

<div align="center">

**MIT License** · Zero dependencies · Works offline

</div>
