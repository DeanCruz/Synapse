# Synapse — Distributed Agent Swarm Control System

Synapse is a distributed control system for coordinating autonomous agent swarms. It optimizes context usage, parallelizes execution, and provides a centralized control plane for complex software development tasks.

---

## Quick Start

```bash
# 1. Start the dashboard
node Synapse/src/server/index.js

# 2. Open in browser
open http://localhost:3456

# 3. Run a parallel task
!p_track {your prompt here}
```

No `npm install` required. The server uses only Node.js built-ins.

---

## How It Works

```
Master Agent plans → writes initialization.json once
        │
        ▼
Workers execute tasks → write progress files with full lifecycle + logs
        │
        ▼
server.js detects file changes (fs.watch on progress/, fs.watchFile on init/logs)
        │
        ▼
SSE pushes updates to browser in real-time
        │
        ▼
Dashboard merges initialization.json + progress files → renders live status
```

The master agent (you, when running `!p_track`) is the orchestrator. Worker agents are spawned via the Task tool. The dashboard merges static plan data from `initialization.json` with dynamic lifecycle data from worker progress files to produce the combined view. All orchestration logic lives in the master agent's instructions.

---

## The Master Agent Role — NON-NEGOTIABLE

When a swarm is active, you are the **master agent**. This is not a suggestion — it is an absolute, inviolable constraint on your behavior. The master agent is the **orchestrator**. It is not a worker. It does not write code. It does not implement features. It does not fix bugs. It does not edit application files. It does not create components, functions, services, tests, or any artifact that belongs to the codebase being worked on.

### What the Master Agent Does

The master agent has exactly **five responsibilities** during a swarm. Nothing more.

#### 1. Gather Context

- Read `TableOfContentsMaster.xml` to identify relevant repos and directories, then drill into `TableOfContents/{repo}/{path}/index.xml` for file-level detail
- Read the `CLAUDE.md` of every child repo that will be touched
- Read source files, documentation, types, schemas, and configs needed to understand the task
- Read the Synapse `CLAUDE.md` (this file) for swarm protocols
- Read relevant command files from `_commands/` directories
- Build a complete mental model of the codebase, dependencies, and constraints

The master agent reads **extensively**. It reads more than any worker will. It reads across repo boundaries. It reads documentation, code, types, and tests. This deep context gathering is what makes the plan accurate and the agent prompts self-contained. Skimping here causes cascading failures downstream.

#### 2. Plan

- Decompose the task into atomic, self-contained units
- Map every dependency between tasks (what blocks what)
- Determine wave groupings for visual organization
- Write each agent's prompt with **complete, self-contained context** — the agent must be able to execute without reading additional files or asking questions
- Include in every agent prompt: the specific files to modify, the conventions from the relevant repo's `CLAUDE.md`, any cross-repo context, code snippets the agent needs to see, and clear success criteria
- Create the master XML task file documenting the full plan
- Write the strategy rationale plan file
- **Populate the dashboard before presenting the plan to the user** — clear the progress directory, write the full plan to `initialization.json` (all tasks, all waves, all dependencies — static plan data only), and write an initialization entry to `logs.json`. This gives the user a live visual representation of the plan on the dashboard while they review and approve it. **`initialization.json` is write-once — the master never updates it after planning.**

Planning is where the master agent earns its value. A well-planned swarm executes fast with zero confusion. A poorly-planned swarm produces broken code, conflicting edits, and wasted cycles. **Invest heavily in planning. Never rush it.**

#### 3. Dispatch

- The dashboard is already populated with the full plan from the planning phase — all tasks visible as pending cards with dependency lines
- Spawn worker agents via the Task tool with their complete prompts (the elapsed timer starts automatically when the first worker writes its progress file with a `started_at` value)
- Dispatch all independent tasks in parallel — no artificial sequencing
- As workers complete, immediately scan for newly unblocked tasks and dispatch them
- Never let the pipeline stall waiting for a batch or wave to finish

#### 4. Status

- Append to `logs.json` on dispatches, completions, failures, and deviations
- Update the master XML with completion summaries, error details, and timing
- **The master does NOT update `initialization.json` after planning** — workers own all lifecycle data in their progress files. The dashboard derives all stats (completed count, failed count, wave progress, overall status, elapsed time) from progress files.
- **Do NOT output terminal status tables during execution** — the dashboard is the primary reporting channel. Output only brief one-line terminal confirmations per event.
- Workers handle their own live progress reporting via `dashboards/{dashboardId}/progress/{id}.json` files — the master does not need to relay progress updates
- The dashboard is the user's primary visibility into swarm progress — **stale data is a failure**

#### 5. Report

- When all agents have completed (or failed), compile a final summary
- Report what was accomplished, what failed, and what needs follow-up
- Update `TableOfContentsMaster.xml` and relevant `TableOfContents/*/index.xml` files if the swarm created, moved, or restructured files
- Move the completed swarm to history if a new swarm will start

### What the Master Agent NEVER Does During a Swarm

This list is exhaustive and absolute. There are **no exceptions**.

- **NEVER write code.** Not a single line. Not a "quick fix." Not a "small tweak." Not "just this one file." If code needs to be written, it is a task for a worker agent.
- **NEVER edit application source files.** No `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.css`, `.html`, `.json` (except `initialization.json` and `logs.json` in the dashboard directory), or any other file that belongs to the codebase being worked on.
- **NEVER create application files.** No new components, services, utilities, tests, configs, or any other artifact that a worker should create.
- **NEVER run application commands.** No `npm run build`, no `npm test`, no `python manage.py`, no application-specific CLI tools. If testing or building is needed, it is a task for a worker agent.
- **NEVER "help" a worker by doing part of its task.** If a task is too large for one agent, decompose it into smaller tasks. Do not do half the work yourself and dispatch the other half.
- **NEVER implement "just one thing" directly because "it's faster."** It is never faster. The moment you start coding, you lose your orchestrator perspective. You become a worker with half-attention on orchestration. Both suffer.

### Why This Matters

The master agent's power comes from its **elevated perspective**. It sees the full dependency graph. It holds context from every repo. It knows what every worker is doing and what comes next. The moment it starts writing code, it loses this perspective. It gets tunnel-visioned into implementation details. It forgets to dispatch the next wave. It misses a dependency. It writes code that conflicts with what a worker is simultaneously producing.

A conductor does not pick up a violin mid-symphony. The master agent does not pick up an editor mid-swarm.

### The Only Files the Master Agent Writes

During a swarm, the master agent writes to exactly these files and **no others**:

| File | Purpose |
|---|---|
| `dashboards/{dashboardId}/initialization.json` | Static plan data (written ONCE during planning) |
| `dashboards/{dashboardId}/logs.json` | Timestamped event log for the dashboard |
| `tasks/{date}/parallel_{name}.xml` | Master task record (plan, status, summaries) |
| `tasks/{date}/parallel_plan_{name}.md` | Strategy rationale document |

Everything else is a worker's job.

### After a Swarm Completes

Once all workers have finished and the master has compiled its final report, the swarm is over. At this point — and **only** at this point — the master agent may resume normal agent behavior (including direct code edits) if the user requests non-parallel work. The no-code restriction applies **exclusively during active swarm orchestration.**

---

## Worker Progress Protocol

Workers report their own live progress directly to the dashboard via individual progress files. This replaces the old model where only the master could update the dashboard.

### How It Works

```
Worker starts → writes dashboards/{dashboardId}/progress/{id}.json with full lifecycle
       │
Worker progresses → overwrites progress file with new stage/status/logs
       │
server.js detects file change → broadcasts SSE "agent_progress"
       │
Dashboard merges init + progress → renders live status, stage, logs
       │
Worker completes → writes final progress file with status "completed"
       │
Master processes return → updates logs.json + XML only (NOT initialization.json)
```

Workers **MUST read `{tracker_root}/agent/instructions/tracker_worker_instructions.md`** before starting work. This contains the full progress reporting protocol.

### Progress File Location

Each worker owns exactly one file: `dashboards/{dashboardId}/progress/{task_id}.json` (e.g., `dashboards/dashboard1/progress/2.1.json`).

The worker writes the **full file** on every update (no read-modify-write needed — the worker is the sole writer). The server watches the `progress/` directory via `fs.watch` and broadcasts changes immediately.

### Progress File Schema

```json
{
  "task_id": "2.1",
  "status": "in_progress",
  "started_at": "2026-02-24T15:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "implementing",
  "message": "Creating User model — 3/4 CRUD methods done",
  "milestones": [
    { "at": "2026-02-24T15:05:35Z", "msg": "Reading CLAUDE.md and task XML" },
    { "at": "2026-02-24T15:06:01Z", "msg": "Reading existing model files for patterns" },
    { "at": "2026-02-24T15:06:45Z", "msg": "Creating User model with CRUD operations" }
  ],
  "deviations": [
    { "at": "2026-02-24T15:07:00Z", "description": "Added soft-delete — not in plan but required by existing model pattern" }
  ],
  "logs": [
    { "at": "2026-02-24T15:05:00Z", "level": "info", "msg": "Starting task" },
    { "at": "2026-02-24T15:06:01Z", "level": "info", "msg": "Created User model" }
  ]
}
```

### Fixed Stages

Workers progress through these stages in order:

| Stage | Description |
|---|---|
| `reading_context` | Reading project files, CLAUDE.md, documentation, task XML |
| `planning` | Assessing readiness, planning approach |
| `implementing` | Writing code, creating/modifying files |
| `testing` | Running tests, validating changes |
| `finalizing` | Final cleanup, preparing summary report |
| `completed` | Task completed successfully |
| `failed` | Task failed |

### When Workers Must Write

- **On task start** — mandatory (set `status`, `started_at`, `assigned_agent`, initial `stage`)
- **On every stage transition** — mandatory
- **On significant milestones** within a stage — freeform, as often as useful
- **On any deviation from the plan** — mandatory, immediately
- **On unexpected findings** — recommended
- **On log-worthy events** — append to `logs[]` array (feeds the popup log box in agent details modal)
- **On task completion/failure** — mandatory (set `status`, `completed_at`, `summary`)

### Deviation Reporting

Deviations are plan divergences — any case where the worker does something different from what the master planned. This includes: different implementation approach, additional files modified, skipped steps, changed scope, etc.

When a worker deviates:

1. **Worker writes to progress file immediately** — adds to `deviations[]` array. The dashboard shows a yellow badge on the agent card in real-time.
2. **Worker includes deviations in final return** — the `DIVERGENT ACTIONS` section of the return format.
3. **Master logs deviations to `dashboards/{dashboardId}/logs.json`** — at level `"deviation"` (displayed with yellow badge in log panel).

Deviations are not failures — they are expected in complex tasks. But they must be visible so the master and user can assess impact.

### Dashboard Rendering

The dashboard merges `initialization.json` (static plan) with progress files (dynamic lifecycle) to render agent cards:

- **In-progress cards** show: stage badge (color-coded) + elapsed time + current milestone message
- **Any card with deviations** shows: yellow "deviation(s)" badge
- **Agent details popup** shows: full milestone timeline + full deviation list + **popup log box** (fed by `logs[]` array in progress file)
- **Log panel** has a "Deviation" filter button for deviation-level entries
- **Multi-dashboard sidebar** allows switching between different dashboard instances

### Context Savings

This architecture dramatically reduces master agent context consumption:

| Old Model | New Model |
|---|---|
| Single root-level `status.json` for all data | Per-dashboard `initialization.json` + `progress/` files |
| Master reads/writes full status file on every progress update | Master writes `initialization.json` once; workers own all lifecycle data in progress files |
| Master maintains counters (completed_tasks, failed_tasks) | Dashboard derives all stats from progress files — zero counter maintenance |
| Master outputs full terminal status table on every event | Master outputs one-line confirmations only |
| No visibility into worker progress during execution | Live stage + milestone + log updates on dashboard |
| Deviations only visible after completion | Deviations visible immediately |
| Single swarm at a time | Up to 5 concurrent swarms across dashboards with auto-selection |

---

## Directory Structure

```
Synapse/
├── CLAUDE.md                    ← You are here
├── server.js                    ← Node.js SSE server (zero deps)
├── package.json                 ← Metadata + start script
├── dashboards/                  ← Multi-dashboard support
│   ├── dashboard1/
│   │   ├── initialization.json  ← Static plan data (written once by master)
│   │   ├── logs.json            ← Event log (written by master)
│   │   └── progress/            ← Worker progress files
│   │       ├── 1.1.json
│   │       └── 2.1.json
│   └── dashboard2/              ← Additional dashboards
│       └── ...
├── history/                     ← History summary JSON files (created on dashboard clear)
├── Archive/                     ← Full archived dashboard snapshots
├── _commands/                   ← Command specs for controlling swarms
│   ├── p_track.md               ← Core: plan + dispatch + track a full swarm
│   ├── p.md                    ← Lightweight parallel dispatch (no tracking)
│   ├── start.md                 ← Start the dashboard server
│   ├── stop.md                  ← Stop the dashboard server
│   ├── status.md                ← Terminal status summary
│   ├── reset.md                 ← Clear dashboard data
│   ├── dispatch.md              ← Manually dispatch tasks
│   ├── retry.md                 ← Re-run failed tasks
│   ├── cancel.md                ← Cancel the active swarm
│   ├── logs.md                  ← View/filter log entries
│   ├── inspect.md               ← Deep-dive into a specific task
│   ├── history.md               ← View past swarm history
│   └── deps.md                  ← Visualize dependency graph
├── agent/                       ← Agent instruction files
│   └── instructions/
│       ├── dashboard_resolution.md      ← Shared dashboard selection/detection protocol
│       ├── tracker_master_instructions.md ← Dashboard field-to-UI mapping reference
│       └── tracker_worker_instructions.md ← Worker progress reporting protocol
├── tasks/                       ← Generated per swarm (XML + plan files)
│   └── {MM_DD_YY}/
│       ├── parallel_{name}.xml  ← Master task file (single source of truth)
│       └── parallel_plan_{name}.md  ← Strategy rationale
└── public/
    ├── index.html               ← Dashboard HTML
    ├── styles.css               ← Dark theme styling
    └── dashboard.js             ← SSE client + DOM rendering
```

---

## Commands

When the user types a command prefixed with `!`, read the corresponding file in `Synapse/_commands/{command}.md` and follow it exactly.

### Swarm Lifecycle

| Command | Description |
|---|---|
| `!p_track {prompt}` | **Primary command.** Plan, dispatch, track, and report a full parallel agent swarm with live dashboard updates. |
| `!dispatch {id}` | Manually dispatch a specific pending task. `!dispatch --ready` dispatches all unblocked tasks. |
| `!retry {id}` | Re-dispatch a failed task with a fresh agent. |
| `!cancel` | Cancel the active swarm. `!cancel --force` skips confirmation. |

### Monitoring

| Command | Description |
|---|---|
| `!status` | Quick terminal summary of current swarm state. |
| `!logs` | View log entries. Supports `--level`, `--task`, `--agent`, `--last`, `--since` filters. |
| `!inspect {id}` | Deep-dive into a specific task — context, dependencies, timeline, logs. |
| `!deps` | Visualize the full dependency graph. `!deps {id}` for a single task. `!deps --critical` for critical path. |
| `!history` | View past swarm history. `!history --last 5` for recent only. |

### Server Control

| Command | Description |
|---|---|
| `!start` | Start the dashboard server and open the browser. |
| `!stop` | Stop the dashboard server. |
| `!reset` | Clear all tracker data. `!reset --keep-history` preserves past tasks. |

---

## Core Principles for Efficient Parallelization

These principles govern how the master agent should plan and execute parallel work. They apply universally regardless of the project being worked on.

### 1. Always Parallelize Independent Work

If two or more tasks have no dependency between them, they **must** run in parallel. This applies to everything — file reads, file writes, searches, edits, agent dispatches. Sequential execution of independent tasks is a failure mode.

### 2. Dependency-Driven Dispatch, Not Wave-Driven

Waves are a visual grouping for humans. The dispatch engine looks **only** at individual task dependencies. If task 2.3 depends only on 1.1 and 1.1 is done, dispatch 2.3 immediately — even if tasks 1.2 through 1.8 are still running. Never wait for a full wave to complete.

### 3. Pipeline Must Flow Continuously

When an agent completes:
1. Record the completion
2. Immediately scan ALL pending tasks for newly satisfied dependencies
3. Dispatch every unblocked task in the same update cycle
4. Never let the pipeline stall waiting for a batch

### 4. No Artificial Concurrency Cap

Send as many agents as there are ready tasks. The bottleneck should be dependencies, not artificial limits.

**Practical note:** The Task tool dispatches agents via tool calls. If a wave has more tasks than can be dispatched in a single message (~8-10 simultaneous tool calls), batch them into back-to-back dispatch rounds — but never wait for the first batch to complete before sending the second. Dispatch all ready tasks as fast as the tool allows.

### 5. Errors Don't Stop the Swarm (But Cascading Failures Trigger Reassessment)

A failed task blocks only its direct dependents. Everything else continues. Log the error, mark the task, keep dispatching.

**Circuit breaker:** If 3+ tasks fail within the same wave, or if a failed task blocks more than half of all remaining tasks, the master must **pause dispatching** and assess:
- Is there a shared root cause (bad assumption, missing dependency, environment issue)?
- Does the plan need revision?
- Should the swarm be cancelled?

Present the assessment to the user. Either continue with justification, revise the plan, or cancel. Never blindly push through cascading failures.

### 6. Plan Deep, Execute Fast

Invest time upfront in thorough planning:
- Read all relevant code and documentation before decomposing
- Identify every dependency between tasks
- Give each agent a self-contained prompt with full context
- Verify the dependency graph has no cycles or missing references

This front-loaded investment pays off in execution speed — agents work independently without needing to ask questions or make assumptions.

### 7. Atomic Task Design

Each task should be:
- **Self-contained** — An agent can complete it with only the context provided
- **Small** — Takes a single agent one focused effort (not hours of work)
- **Verifiable** — The master can confirm success from the summary
- **Non-overlapping** — No two tasks modify the same file (or if they must, they're sequential)

### 8. Statusing Is Non-Negotiable

Status reporting is split between master and workers:

**Workers handle ALL status — lifecycle, live progress, and detailed logs:**
- Write `dashboards/{dashboardId}/progress/{id}.json` with full lifecycle: `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`
- Write live progress: `stage`, `message`, `milestones[]`, `deviations[]`
- Write detailed logs: `logs[]` array (feeds the popup log box in agent details modal)
- Dashboard picks up changes in real-time via `fs.watch` + SSE

**Master handles event logging and XML updates only:**
- Agent dispatched → append to `logs.json`
- Agent completed → append to `logs.json` + update XML
- Agent failed → append to `logs.json` + update XML
- Agent deviated → append to `logs.json` at level `"deviation"`
- Master does NOT update `initialization.json` after planning

**Master does NOT output terminal status tables** during execution. Terminal output is limited to one-line confirmations. The dashboard is the user's primary window into swarm progress.

### 9. Right-Size Tasks

Each task should take a single agent **1-5 minutes** to complete. This range balances parallelism against orchestration overhead.

| Too small (< 1 min) | Right-sized (1-5 min) | Too large (> 5 min) |
|---|---|---|
| Orchestration overhead dominates | Good parallelism/overhead ratio | Risk of context exhaustion |
| Many dispatch cycles for little work | Workers stay focused | Worker may lose track of scope |
| Log noise drowns signal | Each completion is meaningful | Long waits between status updates |

When estimating: a task that reads 2-3 files and modifies 1-2 files is typically right-sized. A task that reads 10+ files or modifies 5+ files should be decomposed further.

### 10. Shared File Accumulation Patterns

When multiple tasks need to add entries to the same file (routes to a router, exports to an index, entries to a config), **two tasks must never modify the same file simultaneously.** Use one of these patterns:

**Pattern A — Owner Task:** One task "owns" the shared file. Other tasks that need it depend on the owner. The owner creates/modifies the file; downstream tasks append to it sequentially.

**Pattern B — Integration Task:** All tasks that produce content for the shared file are independent, but a dedicated "integration task" in a later wave collects their outputs and writes the shared file. This maximizes parallelism.

**Pattern C — Append Protocol:** If a shared file supports independent additions (e.g., adding new route files to a directory that auto-imports), design tasks to create new files rather than modifying an existing one.

Always prefer Pattern C (no shared file at all) > Pattern B (maximize parallelism) > Pattern A (simplest but least parallel).

### 11. Feed Upstream Results to Downstream Tasks

When a task completes and its dependents become dispatchable, the master **must include the upstream task's results** in the downstream worker's prompt:

- What the upstream task accomplished (summary)
- What files it created or modified
- Any new interfaces, types, exports, or APIs it introduced
- Any deviations from the plan that affect downstream work

This is critical because the downstream worker's prompt was written during planning — before the upstream work was done. Without upstream results, the downstream worker operates on stale assumptions.

### 12. Verify After Completion

After all tasks complete (or all remaining are blocked), the master should assess whether a **verification step** is warranted:

- If the swarm modified code across multiple files or repos → dispatch a verification agent to run tests, type checking, or build validation
- If the swarm was purely additive (new files, no modifications to existing code) → verification may be optional
- If any tasks reported deviations → verification is strongly recommended

The verification agent gets a prompt listing ALL files changed across the swarm and runs the project's standard validation commands. Its job is to catch integration issues that individual workers can't see.

---

## Data Architecture

### initialization.json

The static plan store, written once during planning and never updated after. Located at `dashboards/{dashboardId}/initialization.json`. Every field maps to UI elements on the dashboard, combined with progress file data. See `agent/instructions/tracker_master_instructions.md` for the complete field-to-UI mapping.

**Key objects:**
- `task` — The swarm metadata (name, type, directory, prompt, project, created, total_tasks, total_waves)
- `agents[]` — One entry per task (id, title, wave, layer, directory, depends_on — plan data only, no lifecycle fields)
- `waves[]` — One entry per wave (id, name, total — structure only, no status or completed counts)
- `chains[]` — Optional, for chain layout mode
- `history[]` — Previous swarm records

**Write rules:**
- Write-once during planning — **never update after the planning phase**
- Always atomic: read → modify in memory → write full file
- Never write partial JSON
- No lifecycle fields: `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`, `completed_tasks`, `failed_tasks`, `overall_status` are all absent — they are derived from progress files by the dashboard

### logs.json

The timestamped event log, located at `dashboards/{dashboardId}/logs.json`. Every entry becomes a row in the dashboard log panel.

**Entry fields:** `timestamp`, `task_id`, `agent`, `level`, `message`, `task_name`

**Levels:** `info` (general), `warn` (unexpected), `error` (failure), `debug` (verbose), `permission` (triggers popup), `deviation` (plan divergence)

### Master XML

The authoritative task record at `tasks/{date}/parallel_{name}.xml`. Contains everything: task descriptions, context, critical details, file lists, dependencies, status, summaries, and logs. Every agent reads it for context. The master updates it on every completion.

### progress/ Directory

Worker-owned progress files. Each worker writes to `dashboards/{dashboardId}/progress/{task_id}.json` exclusively.

**Key fields:** `task_id`, `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`, `stage`, `message`, `milestones[]`, `deviations[]`, `logs[]`

The progress file now contains the **full lifecycle** for each agent. The `logs[]` array feeds the popup log box in the agent details modal. The `status`, `started_at`, `completed_at`, `summary`, and `assigned_agent` fields live exclusively in progress files — the dashboard derives all stats from these files.

**Stages:** `reading_context` → `planning` → `implementing` → `testing` → `finalizing` → `completed` | `failed`

**Write rules:**
- Workers write the full file on every update (no read-modify-write — sole owner)
- The server watches the directory via `fs.watch` and broadcasts `agent_progress` SSE events
- The master clears this directory when initializing a new swarm
- Progress files are ephemeral — they exist only during the active swarm

---

## Dashboard Features

### Layout Modes

**Waves** — Vertical columns per dependency level. Cards within a column are independent peers. Best for broad, parallel workloads.

**Chains** — Horizontal rows per dependency chain. Cards flow left to right through dependency levels. Best for narrow, deep pipelines.

Choose based on the shape of your dependency graph. Set via `task.type` in `initialization.json` (`"Waves"` or `"Chains"`).

### Dependency Lines

In Wave mode, dependency lines are drawn between cards using BFS pathfinding through corridor gaps. Lines never cross through cards or title headers.

**Interaction:**
- **Hover a line** → highlights blue with glow
- **Hover a card** → its needs highlight blue, tasks it blocks highlight red, unrelated lines dim

### Multi-Dashboard Sidebar

The dashboard supports up to 5 simultaneous swarms via a sidebar that lists all dashboard instances (`dashboard1` through `dashboard5`). Each dashboard directory is an independent swarm with its own `initialization.json`, `logs.json`, and `progress/` directory.

**Dashboard selection is automatic.** When `!p_track` starts, the master scans dashboards 1-5 for the first available slot — it will never overwrite an in-progress swarm. All commands (`!status`, `!logs`, `!inspect`, etc.) auto-detect the active dashboard when no dashboard is specified. See `agent/instructions/dashboard_resolution.md` for the full selection and detection protocol.

**Workers always know their dashboard.** The master includes `{dashboardId}` in every worker dispatch prompt. Workers write progress files to `dashboards/{dashboardId}/progress/{task_id}.json` — they never auto-detect.

### Stat Cards

Six stat cards show Total, Completed, In Progress, Failed, Pending, and Elapsed time. All stats are derived from progress files — the dashboard counts progress files by status. The elapsed timer starts from the earliest worker `started_at` and freezes when all workers have `completed_at` set.

### Log Panel

Collapsible bottom drawer showing all log entries with level filtering (All, Info, Warn, Error, Deviation). Auto-scrolls to newest entries.

### Popup Log Box

Agent detail modals include a popup log box showing the worker's `logs[]` array from its progress file. This provides detailed, per-agent logging independent of the main event log panel.

### Permission Popup

When the master writes a `"permission"` level log entry, the dashboard shows an amber popup alerting the user to check their terminal. This bridges the gap between the dashboard (visual) and terminal (interactive).

---

## Timestamp Protocol

Every timestamp in `initialization.json`, `logs.json`, progress files, and the XML must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

**Never** guess, estimate, or hardcode timestamps. The elapsed timer calculates durations from these values — a bad timestamp shows wildly wrong elapsed times.

---

## Integration with Any Project

Synapse is project-agnostic. To use it in any repository:

1. **Copy or symlink** the `Synapse/` directory into your project (or reference it from a shared location).

2. **Reference the commands** by reading `Synapse/_commands/{command}.md` when the user invokes `!{command}`.

3. **Project-specific context** comes from the project's own `CLAUDE.md` files, documentation, and code — the tracker doesn't assume any specific structure.

4. **All paths in commands use `{tracker_root}`** as a placeholder. Resolve it to wherever Synapse lives relative to your working directory.

5. **The `tasks/` directory** is created automatically when the first swarm runs. XML files and plans accumulate here as a record of past work.

---

## Portability Checklist

- [x] Zero npm dependencies — works with any Node.js installation
- [x] No hardcoded paths — all paths relative to the tracker directory
- [x] No project-specific assumptions — works with monorepos, single projects, or any layout
- [x] Self-contained commands — each `_commands/*.md` file is a complete spec
- [x] Dashboard reads `initialization.json` + `progress/` files, merging them client-side — no filesystem assumptions beyond the dashboard directory
- [x] Server configurable via `PORT` env var
- [x] Works offline — no external API calls, no CDN dependencies
