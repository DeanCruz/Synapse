# Synapse — Distributed Agent Swarm Control System

Synapse is a standalone distributed control system for coordinating autonomous agent swarms. It optimizes context usage, parallelizes execution, and provides a centralized control plane for complex software development tasks. Synapse operates on a **target project** at `{project_root}` — completely separate from Synapse's own location at `{tracker_root}`.

---

## Quick Start

```bash
# 1. Point Synapse at your project (or just run from within the project directory)
!project set /path/to/your/project

# 2. Start the dashboard
node {tracker_root}/src/server/index.js

# 3. Launch the Electron app
npm start

# 4. Run a parallel task
!p_track {your prompt here}
```

---

## Path Convention

| Placeholder | Meaning | Example |
|---|---|---|
| `{tracker_root}` | Absolute path to the Synapse repository | `/Users/dean/tools/Synapse` |
| `{project_root}` | Absolute path to the target project | `/Users/dean/repos/my-app` |

Workers write code in `{project_root}` and report progress to `{tracker_root}`.

**Resolving `{project_root}`:** (1) Explicit `--project /path` flag, (2) Stored config at `{tracker_root}/.synapse/project.json`, (3) Agent's CWD.

--> Full details: `agent/core/path_convention.md`

---

## How It Works

```
Master Agent plans --> writes initialization.json once
        |
        v
Workers execute tasks in {project_root} --> write progress files to {tracker_root}
        |
        v
server.js detects file changes (fs.watch + fs.watchFile)
        |
        v
SSE pushes updates to browser in real-time
        |
        v
Dashboard merges initialization.json + progress files --> renders live status
```

---

## Execution Mode — Serial vs Parallel

### Decision Flowchart

```
User gives task
       |
       v
Is it a !p command? --YES--> FORCED PARALLEL MODE
       |                      Read {tracker_root}/CLAUDE.md
       NO                     Enter master dispatch mode
       |                      Do NOT write code
       v
Can it decompose into 3+ independent subtasks? --YES--> AUTOMATIC PARALLEL MODE
       |                                                  Notify user
       NO                                                 Read {tracker_root}/CLAUDE.md
       |                                                  Enter master dispatch mode
       v                                                  Do NOT write code
SERIAL MODE
Execute directly
```

**Serial:** Task touches 1-2 files, quick fixes, no independent subtasks. Execute directly.

**Parallel:** 3+ independent subtasks, multiple files editable simultaneously. The master agent proactively escalates when it recognizes the opportunity.

**Forced Parallel (`!p` commands) — NON-NEGOTIABLE:** Any command prefixed with `!p` forces master dispatch mode. The agent becomes the orchestrator. It does NOT write code. It plans, dispatches worker agents, monitors, and reports. The longer the user prompt, the more agents are needed — not an excuse for direct implementation.

---

## Document Reference Map — NON-NEGOTIABLE

**The agent MUST read the correct documents at the right moments. This is absolute and inviolable. Do not work from memory — read the file every time.**

### Before Any Work

| Trigger | Read |
|---|---|
| Any work in `{project_root}` | `{project_root}/CLAUDE.md` + any subdirectory CLAUDE.md files **(NON-NEGOTIABLE)** |
| Project has `.synapse/` | `{project_root}/.synapse/toc.md` for semantic orientation |

### Entering Swarm Mode

**Read ALL of these before any planning or dispatch:**

| Trigger | Read |
|---|---|
| `!p_track` invoked | `{tracker_root}/_commands/Synapse/p_track.md` **(NON-NEGOTIABLE)** |
| `!p` invoked | `{tracker_root}/_commands/Synapse/p.md` **(NON-NEGOTIABLE)** |
| `!master_plan_track` invoked | `{tracker_root}/_commands/Synapse/master_plan_track.md` **(NON-NEGOTIABLE)** |
| Any swarm dispatch | `{tracker_root}/agent/instructions/tracker_master_instructions.md` **(NON-NEGOTIABLE)** |
| Any swarm dispatch | `{tracker_root}/agent/master/dashboard_protocol.md` |
| Any swarm dispatch | `{project_root}/CLAUDE.md` for target project conventions |

### During Planning

| Trigger | Read |
|---|---|
| Writing dashboard files | `agent/master/dashboard_writes.md` + `agent/master/ui_map.md` |
| Constructing worker prompts | `agent/master/worker_prompts.md` |

### During Execution

| Trigger | Read |
|---|---|
| Worker completes (EVERY time) | `agent/master/eager_dispatch.md` |
| Worker fails | `agent/master/failure_recovery.md` |
| After context compaction | `agent/master/compaction_recovery.md` |
| Swarm finishes (metrics) | `agent/master/compaction_recovery.md` (metrics section) |

### As a Worker

| Trigger | Read |
|---|---|
| Dispatched as worker agent | `{tracker_root}/agent/instructions/tracker_worker_instructions.md` **(NON-NEGOTIABLE)** |

### Commands & Profiles

| Trigger | Read |
|---|---|
| `!{command}` invoked | Resolve: `_commands/Synapse/` --> `_commands/project/` --> `{project_root}/_commands/` |
| `!{profile}` modifier used | `{tracker_root}/_commands/profiles/{profile}.md` |

### Domain Knowledge (Synapse Internals)

| Topic | Read |
|---|---|
| Architecture & data flow | `documentation/architecture/` |
| Swarm lifecycle phases | `documentation/swarm-lifecycle/` |
| Dashboard components & styling | `documentation/dashboard/` |
| Multi-dashboard & archive | `documentation/multi-dashboard/` |
| Worker protocol | `documentation/worker-protocol/` |
| Data schemas | `documentation/data-architecture/` |
| Server & SSE | `documentation/server/` |
| Electron app | `documentation/electron/` |
| Commands reference | `documentation/commands/` |
| Project integration & TOC | `documentation/project-integration/` |
| Profiles | `documentation/profiles/` |
| Configuration & theming | `documentation/configuration/` |
| Master agent protocols | `documentation/master-agent/` |
| Reports & analysis | `documentation/reports/` |

---

## The Master Agent Role

> **The master NEVER writes code during a swarm.** Not a single line. Not a "quick fix." Not "just this one file." If you find yourself about to edit an application file, STOP — create a task for a worker agent instead.

**Five responsibilities:** Gather Context, Plan, Dispatch, Status, Report — nothing more.

**Only files the master writes during a swarm:**

| File | Purpose |
|---|---|
| `dashboards/{id}/initialization.json` | Static plan data (written ONCE) |
| `dashboards/{id}/logs.json` | Timestamped event log |
| `dashboards/{id}/master_state.json` | State checkpoint for context recovery |
| `dashboards/{id}/metrics.json` | Post-swarm performance metrics |
| `tasks/{date}/parallel_{name}.json` | Master task record |
| `tasks/{date}/parallel_plan_{name}.md` | Strategy rationale document |

The master writes **nothing** into `{project_root}`. After a swarm completes, the master may resume normal agent behavior.

**Archive before clear — NON-NEGOTIABLE:** Always archive a dashboard to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/` before clearing it for a new swarm. Never discard previous swarm data.

--> Full details: `agent/master/role.md`

---

## Command Resolution

```
1. {tracker_root}/_commands/Synapse/{command}.md       <-- Swarm commands (highest priority)
2. {tracker_root}/_commands/project/{command}.md       <-- Project analysis commands
3. {project_root}/_commands/{command}.md               <-- Project-specific commands
```

Once found, **read the command file in full and follow it exactly.** Command files are complete specs.

--> Full details: `agent/core/command_resolution.md`

---

## Profile System

Profiles layer role-specific priorities, tone, and output style on top of any command. Invoked with `!{profile_name}` before commands/prompts (e.g., `!architect !p_track {prompt}`). Resolved from `{tracker_root}/_commands/profiles/`.

--> Full details: `agent/core/profile_system.md`

---

## Project Discovery

Glob/Grep first for targeted searches. Read `{project_root}/CLAUDE.md` for orientation. Check `{project_root}/.synapse/toc.md` for semantic discovery. Read with purpose — never "just in case." Budget worker prompts to ~8000 tokens. Filter conventions by relevance per task.

--> Full details: `agent/core/project_discovery.md`

---

## Core Parallelization Principles

1. **Always parallelize independent work** — sequential execution of independent tasks is a failure mode
2. **Dependency-driven dispatch, not wave-driven** — dispatch the instant deps are satisfied
3. **Pipeline must flow continuously** — scan ALL tasks on every completion
4. **No artificial concurrency cap** — send as many agents as there are ready tasks
5. **Errors don't stop the swarm** — circuit breaker at 3+ same-wave failures or cascading blocks
6. **Plan deep, execute fast** — invest heavily in planning upfront
7. **Atomic, right-sized tasks** — self-contained, 1-5 min, verifiable, non-overlapping
8. **Statusing is non-negotiable** — workers own lifecycle in progress files, master logs to `logs.json`
9. **Shared file patterns** — Pattern C (separate files) > B (integration task) > A (owner task)
10. **Feed upstream results downstream** — include dependency summaries in downstream prompts
11. **Verify after completion** — dispatch verification agent when code modified across multiple files

--> Full details: `agent/core/parallel_principles.md`

---

## Data Architecture

| Store | Location | Who Writes | Purpose |
|---|---|---|---|
| `initialization.json` | `dashboards/{id}/` | Master | Static plan (write-once) |
| `logs.json` | `dashboards/{id}/` | Master | Timestamped event log |
| `progress/{task_id}.json` | `dashboards/{id}/progress/` | Workers | Lifecycle + live progress |
| `master_state.json` | `dashboards/{id}/` | Master | Compaction recovery checkpoint |
| `metrics.json` | `dashboards/{id}/` | Master | Post-swarm performance metrics |
| Master task file | `tasks/{date}/` | Master | Authoritative task record |

Dashboard derives all stats from progress files. The master does not maintain counters.

--> Full details: `agent/core/data_architecture.md`
--> Write rules: `agent/master/dashboard_writes.md`

---

## Dashboard Features

Two layout modes: **Waves** (vertical columns) and **Chains** (horizontal rows). Unlimited concurrent swarms via multi-dashboard sidebar with unique IDs. Dependency lines with hover interaction. Six stat cards derived from progress files. Log panel with level filtering. Per-agent popup log box. Permission popup for terminal bridging.

--> Full details: `agent/core/dashboard_features.md`
--> Selection protocol: `agent/instructions/dashboard_resolution.md`

---

## Dashboard ID System

Dashboard IDs are short, unique identifiers:
- **`ide`** — Reserved for the IDE agent. Always exists, auto-created on startup, cannot be deleted. Never claimed for swarms.
- **6-char hex** (e.g., `a3f7k2`) — Generated for new dashboards via `crypto.randomBytes(3).toString('hex')`.
- **Legacy `dashboardN`** — Existing numbered dashboards continue to work.

Agents receive their dashboard ID in system prompts (`DASHBOARD ID: {id}`). The `--dashboard {id}` flag accepts any valid dashboard ID.

--> Full details: `agent/instructions/dashboard_resolution.md`

---

## Dashboard ID System

Dashboard IDs are short unique identifiers:

| Type | Format | Example | Notes |
|---|---|---|---|
| IDE | `ide` | `ide` | Reserved. Always exists. Auto-created on startup. Cannot be deleted. |
| Regular | 6-char hex | `a3f7k2` | Generated via `crypto.randomBytes(3).toString('hex')` |
| Legacy | `dashboardN` | `dashboard1` | Backwards compatible. Still functional. |

**IDE Dashboard Protocol:**
- The `ide` dashboard is permanently associated with the IDE/Code Explorer view
- It always exists — auto-created on Electron startup if missing
- Agents receive `DASHBOARD ID:` in their system prompt binding them to their dashboard
- Master agents must NEVER claim `ide` for swarms — use other dashboards
- If a master agent needs the IDE dashboard and it was deleted, create it: `mkdir -p {tracker_root}/dashboards/ide/progress`

**Dashboard selection for swarms:** Auto-select first available dashboard (excluding `ide`). Use `--dashboard {id}` to force a specific dashboard.

---

## Directory Structure

```
Synapse/                         <-- {tracker_root}
|-- CLAUDE.md                    <-- You are here
|-- .synapse/project.json        <-- Target project config
|-- _commands/                   <-- Synapse/ (swarm), project/ (analysis), profiles/
|-- agent/                       <-- instructions/ (hubs), master/, worker/, core/, _commands/
|-- dashboards/{id}/             <-- Dynamic dashboards (ide, hex IDs, legacy dashboardN)
|-- documentation/               <-- Deep-dive reference by topic
|-- queue/, history/, Archive/   <-- Overflow, history summaries, archived snapshots
|-- tasks/{date}/                <-- Per-swarm task + plan files
|-- src/server/ + src/ui/        <-- SSE server (zero deps) + React dashboard
+-- electron/                    <-- Desktop app
```

---

## Commands

| Category | Command | Description |
|---|---|---|
| **Project** | `!project` | Show, set, or clear the target project path |
| | `!initialize` | Initialize Synapse for a target project |
| | `!onboard` | Project walkthrough |
| | `!scaffold` | Generate a CLAUDE.md for a project |
| | `!create_claude` | Create or update an opinionated CLAUDE.md with standards and guidelines |
| **Swarm** | `!p_track {prompt}` | **Primary.** Full parallel swarm with live dashboard |
| | `!p {prompt}` | Lightweight parallel dispatch |
| | `!master_plan_track` | Multi-stream orchestration across dashboards |
| | `!dispatch {id}` | Manually dispatch pending tasks |
| | `!retry {id}` | Re-dispatch a failed task |
| | `!resume` | Resume a chat session after interruption |
| | `!track_resume` | Resume a stalled/interrupted swarm |
| | `!cancel` | Cancel the active swarm |
| | `!cancel-safe` | Graceful shutdown |
| **Monitor** | `!status` | Terminal status summary |
| | `!logs` | View/filter log entries |
| | `!inspect {id}` | Deep-dive into a specific task |
| | `!deps` | Visualize dependency graph |
| | `!history` | View past swarm history |
| **Analysis** | `!context {query}` | Deep context gathering |
| | `!review` | Code review |
| | `!health` | Project health check |
| | `!scope {change}` | Blast radius analysis |
| | `!trace {endpoint}` | End-to-end code tracing |
| | `!contracts` | API contract audit |
| | `!env_check` | Environment variable audit |
| | `!plan {task}` | Implementation planning |
| **TOC** | `!toc {query}` | Search the project TOC |
| | `!toc_generate` | Generate a full project TOC |
| | `!toc_update` | Incrementally update the TOC |
| **Discovery** | `!profiles` | List available profiles |
| | `!commands` | List all available commands |
| | `!help` | Master agent guide |
| | `!guide` | Command decision tree |
| **Server** | `!start` | Start the dashboard server |
| | `!stop` | Stop the dashboard server |
| | `!reset` | Clear all tracker data |

---

## Module Map

All detailed instructions live in modular files. The hub files serve as entry points with module indexes.

**Hubs** (`agent/instructions/`): `tracker_master_instructions.md` (master hub), `tracker_worker_instructions.md` (worker hub), `tracker_worker_instructions_lite.md` (LITE worker template, consumed by master), `dashboard_resolution.md`, `failed_task.md`, `common_pitfalls.md`, `tracker_multi_plan_instructions.md`

**Core** (`agent/core/`): `path_convention.md`, `command_resolution.md`, `parallel_principles.md`, `data_architecture.md`, `dashboard_features.md`, `profile_system.md`, `project_discovery.md`

**Master** (`agent/master/`): `role.md`, `dashboard_protocol.md`, `dashboard_writes.md`, `ui_map.md`, `eager_dispatch.md`, `failure_recovery.md`, `worker_prompts.md`, `compaction_recovery.md`

**Worker** (`agent/worker/`): `progress_reporting.md`, `return_format.md`, `deviations.md`, `upstream_deps.md`, `sibling_comms.md`

**Phase Files** (`agent/_commands/`): `p_track_planning.md`, `p_track_execution.md`, `p_track_completion.md`

**Documentation** (`documentation/`): Deep-dive reference by topic — `architecture/`, `commands/`, `configuration/`, `dashboard/`, `data-architecture/`, `electron/`, `master-agent/`, `multi-dashboard/`, `profiles/`, `project-integration/`, `reports/`, `server/`, `swarm-lifecycle/`, `worker-protocol/`

---

## Timestamp Protocol

Every timestamp must be captured live: `date -u +"%Y-%m-%dT%H:%M:%SZ"`. Never guess, estimate, or hardcode.
