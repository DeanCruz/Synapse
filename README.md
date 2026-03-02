# Synapse

Synapse is a distributed control system for coordinating autonomous agent swarms. It optimizes context usage, parallelizes execution, and provides a centralized control plane for complex software development tasks.

Instead of one agent working through tasks sequentially, Synapse decomposes your prompt into independent units, dispatches multiple agents in parallel, tracks dependencies between them, and gives you a live dashboard to watch it all happen in real-time.

---

## First-Time Setup

### Requirements

- **Node.js** (any recent version)
- **Claude Code** CLI

No `npm install` needed. The server uses only Node.js built-ins.

### 1. Place Synapse in Your Project

Copy or symlink the `Synapse/` directory into your project root. Synapse is project-agnostic — it works with monorepos, single repos, or any directory layout.

### 2. Add the Parent CLAUDE.md

Place the parent `CLAUDE.md` (the master agent instructions) one level above your project repositories. This tells Claude Code how to orchestrate across your workspace.

```
your-workspace/
├── CLAUDE.md              ← Master agent instructions
├── Synapse/               ← This tool
├── your-project-1/
├── your-project-2/
└── ...
```

### 3. Start the Dashboard

```bash
./Synapse/start.sh
```

Or manually:

```bash
node Synapse/src/server/index.js
```

Open **http://localhost:3456** in your browser. You'll see the dashboard in its empty state, waiting for a swarm.

### 4. Run Your First Swarm

In Claude Code, type:

```
!p_track Build a REST API with user authentication and product CRUD endpoints
```

The master agent will read your codebase, plan the work, populate the dashboard with the task graph, and ask for your approval before dispatching workers.

---

## Usage

### Two Ways to Parallelize

| Command | When to Use |
|---|---|
| `!p_track {prompt}` | Full orchestration with live dashboard, dependency tracking, XML records, and history. Use for anything non-trivial — 5+ tasks, cross-repo work, or tasks with complex dependencies. |
| `!p {prompt}` | Lightweight parallel dispatch. Same planning quality, but no dashboard writes or tracking artifacts. Use for quick focused jobs under 5 tasks. |

Both commands trigger the same planning process — deep context gathering, dependency mapping, and self-contained worker prompts. The difference is whether the dashboard tracks it.

### Monitoring a Running Swarm

The dashboard is your primary view. But you can also check from the terminal:

| Command | What It Shows |
|---|---|
| `!status` | Progress summary — completed/total, failures, elapsed time, per-agent status table |
| `!logs` | Event log with filters: `--level error`, `--task 2.3`, `--last 20`, `--since 14:30` |
| `!inspect {id}` | Deep-dive into a task — timeline, milestones, deviations, dependencies, worker logs |
| `!deps` | Dependency graph. `!deps --critical` for the critical path. `!deps --blocked` for stuck chains |

### Intervening in a Swarm

| Command | What It Does |
|---|---|
| `!dispatch {id}` | Manually dispatch a specific task. `!dispatch --ready` dispatches all unblocked tasks |
| `!retry {id}` | Re-run a failed task with a fresh agent that knows why the first attempt failed |
| `!cancel` | Immediately cancel the swarm. `--force` skips confirmation |
| `!cancel-safe` | Graceful shutdown — waits for in-progress agents to finish, then stops |

### After a Swarm

| Command | What It Does |
|---|---|
| `!history` | Browse past completed swarms. `!history --last 5` for recent only |
| `!reset` | Clear the active dashboard and save a history summary. `!reset --all` clears all 5 dashboards |

### Server Control

| Command | What It Does |
|---|---|
| `!start` | Start the dashboard server and open the browser |
| `!stop` | Stop the dashboard server |

### Quick Reference

If you forget any of this, type `!guide` for an interactive command decision tree.

---

## How It Works

```
You type: !p_track {your task}
        │
Master agent reads your codebase deeply
        │
Plans atomic tasks with dependency mapping
        │
Writes the plan to the dashboard (you see it immediately)
        │
You approve → workers are dispatched in parallel
        │
Workers report live progress → dashboard updates in real-time
        │
As tasks complete, blocked tasks are dispatched immediately
        │
All done → master compiles a summary report
```

**Key design decisions:**

- **The master agent never writes code.** It reads, plans, dispatches, and reports. Workers do all implementation. This separation keeps the orchestrator focused on the big picture.
- **Workers are self-contained.** Each worker gets a complete prompt with everything it needs — files to modify, conventions to follow, code context, and success criteria. No back-and-forth.
- **Dependencies drive dispatch, not waves.** Waves are a visual grouping. The moment a task's dependencies are satisfied, it gets dispatched — even if other tasks in the same wave are still running.
- **Failures don't stop the swarm.** A failed task blocks only its direct dependents. Everything else continues. The master can dispatch repair tasks automatically.

### Context & Token Optimization

A single agent working on a large task will eventually exhaust its context window — it forgets early decisions, re-reads files it already processed, and loses coherence. Synapse solves this through architectural separation.

**Read once, distill many.** The master agent reads your entire codebase during planning — every file, every convention, every type definition it needs. It then distills that knowledge into compact, targeted prompts for each worker. A worker building a User model gets only the database patterns, the existing model files, and the relevant CLAUDE.md conventions — not the entire codebase. Each worker's context is small, focused, and complete.

**Workers never search.** Traditional agents spend significant context on exploration — reading files to find patterns, searching for conventions, figuring out project structure. Synapse workers skip all of this. The master has already done it and embedded the answers directly in the prompt. Workers start implementing immediately.

**Upstream results flow downstream.** When a task completes, the master captures its output — what files were created, what interfaces were exported, what deviated from the plan. When dispatching dependent tasks, the master injects these upstream results into the downstream worker's prompt. The downstream worker knows exactly what was built before it, without needing to read those files itself. This is how dependency chains preserve context without each worker re-discovering what the previous one did.

For example, in a three-wave swarm:

```
Wave 1: Create database schema + Create auth middleware
            │                          │
            ▼                          ▼
Wave 2: Build User service (gets schema output) + Build Auth service (gets middleware output)
            │                          │
            ▼                          ▼
Wave 3: Integration task (gets both service outputs, wires everything together)
```

Each worker in Wave 2 receives the exact types, file paths, and export signatures from Wave 1 — injected into its prompt by the master. The Wave 3 worker gets the combined outputs from both Wave 2 tasks. No worker wastes context re-reading upstream work.

**Write-once plan, zero status overhead.** The master writes `initialization.json` once during planning and never reads it back. Workers own their own progress files and write them independently. The dashboard derives all stats client-side. This means the master's context isn't consumed by status bookkeeping — no reading and rewriting a growing status file on every event.

**The net effect:** instead of one agent with a 200K-token context window trying to hold an entire project in its head, you get a master agent spending its context on planning and a pool of workers each spending their small context windows on focused execution. Total effective context across the swarm scales linearly with the number of workers.

---

## Dashboard

### Layout Modes

- **Waves** — Vertical columns per dependency level. Independent tasks sit side-by-side. Best for broad, parallel workloads.
- **Chains** — Horizontal rows per dependency chain. Tasks flow left-to-right. Best for narrow, deep pipelines.

### What You'll See

- **Stat cards** — Total, Completed, In Progress, Failed, Pending, Elapsed time
- **Agent cards** — Each task shows its current stage, elapsed time, and latest milestone
- **Dependency lines** — Hover a card to see what it needs (blue) and what it blocks (red)
- **Deviation badges** — Yellow badges appear when a worker diverges from the plan
- **Log panel** — Collapsible bottom drawer with filterable event log
- **Agent detail popups** — Click any card for full milestone timeline, deviations, and worker logs

### Multi-Dashboard

Up to 5 simultaneous swarms. The sidebar shows all dashboard slots with status indicators. Synapse automatically picks the first available slot when you start a new swarm — it will never overwrite an in-progress swarm.

---

## Configuration

| Setting | Default | Override |
|---|---|---|
| Port | `3456` | `PORT=8080 node Synapse/src/server/index.js` |

---

## Tips for Best Results

1. **Write detailed prompts.** The more context you give in your `!p_track` prompt, the better the master agent can decompose the work. Vague prompts produce vague plans.

2. **Let the master read.** The planning phase involves extensive codebase reading. This is intentional — well-informed plans produce well-informed workers. Don't rush it.

3. **Review the plan before approving.** The dashboard populates with the full task graph before dispatch begins. Check that the decomposition makes sense and dependencies are correct.

4. **Use `!p` for small jobs.** If your task is 2-4 independent changes, `!p` gets you parallelism without the overhead of dashboard tracking.

5. **Use `!p_track` for anything complex.** Cross-repo changes, shared-file conflicts, deep dependency chains — these need the full orchestration and visibility.

6. **Check deviations.** Yellow badges on agent cards mean a worker did something different from the plan. This isn't necessarily bad, but you should review what changed.

7. **Retry before giving up.** `!retry {id}` gives a fresh agent the failure context from the first attempt. It often succeeds where a blind retry would fail.

8. **Add CLAUDE.md files to your repos.** Workers follow the conventions in each repo's `CLAUDE.md`. The better your conventions are documented, the better the workers' output.
