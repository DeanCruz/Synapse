# Dashboard Features

The Synapse dashboard provides real-time visibility into swarm execution. It merges static plan data from `initialization.json` with dynamic lifecycle data from worker progress files to produce the combined view.

---

## Layout Modes

### Waves

Vertical columns per dependency level. Cards within a column are independent peers. Best for broad, parallel workloads.

### Chains

Horizontal rows per dependency chain. Cards flow left to right through dependency levels. Best for narrow, deep pipelines.

### Choosing a Layout

Choose based on the shape of your dependency graph. Set via `task.type` in `initialization.json` (`"Waves"` or `"Chains"`).

---

## Dependency Lines

In Wave mode, dependency lines are drawn between cards using BFS pathfinding through corridor gaps. Lines never cross through cards or title headers.

### Interaction

- **Hover a line** → highlights blue with glow
- **Hover a card** → its needs highlight blue, tasks it blocks highlight red, unrelated lines dim

---

## Multi-Dashboard Sidebar

The dashboard supports unlimited concurrent swarms via a sidebar that lists all dashboard instances by their unique ID (e.g., `a3f7k2`). Each dashboard directory is an independent swarm with its own `initialization.json`, `logs.json`, and `progress/` directory. Different dashboards can serve different projects — the `task.project_root` field identifies which project each swarm belongs to.

### Dashboard Selection Priority Chain

1. **Chat-spawned directive (MANDATORY ISOLATION)** — When an agent is spawned from the Synapse chat view, its system prompt contains a `DASHBOARD ID:` directive binding it to that chat's dashboard. This is always authoritative — the agent uses it unconditionally and has NO access to any other dashboard. If the dashboard has previous data, the agent asks the user if they want to archive it and set up the new dashboard before proceeding.
2. **Explicit flag** — `--dashboard {id}` can force a specific dashboard if no pre-assigned dashboard exists.
3. **No dashboard?** Ask the user which dashboard to use. Never scan or auto-select.

All commands use the agent's assigned dashboard. See `agent/instructions/dashboard_resolution.md` for the full protocol.

### Every Agent Knows Its Dashboard

Chat-spawned agents receive their dashboard ID via the system prompt. The master includes `{dashboardId}` in every worker dispatch prompt. Workers write progress files to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` — they never auto-detect.

### Dashboard IDs

Dashboard IDs are 6-character hex strings (e.g., `a3f7k2`) generated when a new dashboard is created. Legacy `dashboardN` IDs (e.g., `dashboard1`) are still supported for backward compatibility. The sidebar displays each dashboard by its ID.

### Reserved Dashboard: `ide`

The `ide` dashboard is permanently reserved for the IDE agent. It always exists and is exclusively bound to IDE chat views. Swarm agents use only their own assigned dashboard.

---

## Stat Cards

Six stat cards show real-time swarm metrics:

| Card | Description |
|---|---|
| **Total** | Total number of tasks in the swarm |
| **Completed** | Tasks with `status: "completed"` in progress files |
| **In Progress** | Tasks with `status: "in_progress"` in progress files |
| **Failed** | Tasks with `status: "failed"` in progress files |
| **Pending** | Tasks without a progress file (not yet started) |
| **Elapsed** | Wall-clock time from earliest `started_at` to latest `completed_at` |

All stats are derived from progress files — the dashboard counts progress files by status. The elapsed timer starts from the earliest worker `started_at` and freezes when all workers have `completed_at` set.

---

## Log Panel

Collapsible bottom drawer showing all log entries from `logs.json`. Features:

- **Level filtering** — All, Info, Warn, Error, Deviation filter buttons
- **Auto-scroll** — Automatically scrolls to newest entries
- **Deviation filter** — Dedicated button for deviation-level entries (displayed with yellow badge)

---

## Popup Log Box

Agent detail modals include a popup log box showing the worker's `logs[]` array from its progress file. This provides detailed, per-agent logging independent of the main event log panel.

---

## Permission Popup

When the master writes a `"permission"` level log entry, the dashboard shows an amber popup alerting the user to check their terminal. This bridges the gap between the dashboard (visual) and terminal (interactive).

---

## Worker Progress Protocol

Workers report their own live progress directly to the dashboard via individual progress files. This replaces the old model where only the master could update the dashboard.

### How It Works

```
Worker starts → writes {tracker_root}/dashboards/{dashboardId}/progress/{id}.json
       |
Worker progresses → overwrites progress file with new stage/status/logs
       |
server.js detects file change → broadcasts SSE "agent_progress"
       |
Dashboard merges init + progress → renders live status, stage, logs
       |
Worker completes → writes final progress file with status "completed"
       |
Master processes return → updates logs.json + task file only (NOT initialization.json)
```

Workers do their code work in `{project_root}` but write progress files to `{tracker_root}`. These are different locations.

### Fixed Stages

Workers progress through these stages in order:

| Stage | Description |
|---|---|
| `reading_context` | Reading project files, CLAUDE.md, documentation, task file |
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
- **On populating shared_context** — recommended when worker creates exports, interfaces, or patterns that same-wave siblings may find useful

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
- **In-progress cards with sibling tasks** show dashed connection lines between same-wave peers. Hover highlights sibling group.
- **Multi-dashboard sidebar** allows switching between different dashboard instances

---

## Context Savings

This architecture dramatically reduces master agent context consumption compared to the old model:

| Old Model | New Model |
|---|---|
| Single root-level `status.json` for all data | Per-dashboard `initialization.json` + `progress/` files |
| Master reads/writes full status file on every progress update | Master writes `initialization.json` once; workers own all lifecycle data in progress files |
| Master maintains counters (completed_tasks, failed_tasks) | Dashboard derives all stats from progress files — zero counter maintenance |
| Master outputs full terminal status table on every event | Master outputs one-line confirmations only |
| No visibility into worker progress during execution | Live stage + milestone + log updates on dashboard |
| Deviations only visible after completion | Deviations visible immediately |
| Single swarm at a time | Unlimited concurrent swarms (each chat bound to its own dashboard) |
| Cascading failures require manual intervention | Circuit breaker triggers automatic replanning via CLI |
| No sibling awareness between workers | shared_context + sibling_reads enable optional cross-worker data sharing |

---

## Directory Structure

### Synapse Repository Structure

```
Synapse/                            <- {tracker_root}
├── CLAUDE.md                       <- You are here
├── package.json                    <- Metadata + start script
├── .synapse/                       <- Synapse config
│   └── project.json                <- Current target project (set via !project)
├── _commands/                      <- All commands organized by folder
│   ├── Synapse/                    <- Synapse swarm commands
│   │   ├── p_track.md              <- Core: plan + dispatch + track a full swarm
│   │   ├── p.md                    <- Lightweight parallel dispatch (no tracking)
│   │   ├── master_plan_track.md    <- Multi-stream orchestration
│   │   ├── project.md              <- Set/show/clear target project
│   │   ├── start.md                <- Start the dashboard server
│   │   ├── stop.md                 <- Stop the dashboard server
│   │   ├── status.md               <- Terminal status summary
│   │   ├── reset.md                <- Clear dashboard data
│   │   ├── dispatch.md             <- Manually dispatch tasks
│   │   ├── retry.md                <- Re-run failed tasks
│   │   ├── resume.md               <- Resume a stalled/interrupted swarm
│   │   ├── cancel.md               <- Cancel the active swarm
│   │   ├── cancel-safe.md          <- Graceful shutdown
│   │   ├── logs.md                 <- View/filter log entries
│   │   ├── inspect.md              <- Deep-dive into a specific task
│   │   ├── history.md              <- View past swarm history
│   │   ├── deps.md                 <- Visualize dependency graph
│   │   ├── guide.md                <- Command decision tree
│   │   └── update_dashboard.md     <- Update dashboard config
│   ├── project/                    <- Project analysis & management commands
│   │   ├── initialize.md           <- Initialize Synapse for a project
│   │   ├── onboard.md              <- Project walkthrough
│   │   ├── context.md              <- Deep context gathering
│   │   ├── review.md               <- Code review
│   │   ├── health.md               <- Project health check
│   │   ├── scaffold.md             <- Generate CLAUDE.md for a project
│   │   ├── plan.md                 <- Implementation planning
│   │   ├── scope.md                <- Blast radius analysis
│   │   ├── trace.md                <- End-to-end code tracing
│   │   ├── contracts.md            <- API contract audit
│   │   ├── env_check.md            <- Environment variable audit
│   │   ├── toc.md                  <- Search project TOC
│   │   ├── toc_generate.md         <- Generate project TOC
│   │   ├── toc_update.md           <- Update project TOC
│   │   ├── commands.md             <- List all available commands
│   │   ├── help.md                 <- Master agent guide
│   │   └── profiles.md             <- List available profiles
│   └── profiles/                   <- Agent role profiles
│       ├── analyst.md
│       ├── architect.md
│       ├── copywriter.md
│       ├── customer-success.md
│       ├── devops.md
│       ├── founder.md
│       ├── growth.md
│       ├── legal.md
│       ├── marketing.md
│       ├── pricing.md
│       ├── product.md
│       ├── qa.md
│       ├── sales.md
│       ├── security.md
│       └── technical-writer.md
├── agent/                          <- Agent instruction files
│   └── instructions/
│       ├── dashboard_resolution.md
│       ├── tracker_master_instructions.md
│       ├── tracker_multi_plan_instructions.md
│       ├── tracker_worker_instructions.md
│       ├── failed_task.md
│       └── common_pitfalls.md
├── dashboards/                     <- Multi-dashboard support (unlimited)
│   ├── {id}/
│   │   ├── initialization.json
│   │   ├── logs.json
│   │   ├── master_state.json          <- Master state checkpoint (context recovery)
│   │   └── progress/
│   └── ide/                        <- Reserved for IDE agent
├── queue/                          <- Overflow queue slots
├── history/                        <- History summary JSON files
├── Archive/                        <- Full archived dashboard snapshots
├── tasks/                          <- Generated per swarm
│   └── {MM_DD_YY}/
│       ├── parallel_{name}.json
│       └── parallel_plan_{name}.md
├── src/
│   ├── server/index.js             <- Node.js SSE server (zero deps)
│   └── ui/                         <- React dashboard frontend
├── electron/                       <- Desktop app (Electron)
└── public/
    └── styles.css
```

### Target Project Structure

Created by Synapse at `{project_root}`:

```
{project_root}/
├── .synapse/                       <- Synapse project metadata (add to .gitignore)
│   ├── toc.md                      <- Project Table of Contents (opt-in)
│   └── config.json                 <- Project-Synapse configuration
├── CLAUDE.md                       <- Project conventions (may already exist)
├── _commands/                      <- Project-specific commands (optional)
└── ... (project files)
```