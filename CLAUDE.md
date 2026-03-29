# Synapse — Distributed Agent Swarm Control System

Synapse coordinates autonomous agent swarms for parallel software development. It operates on a **target project** at `{project_root}` — separate from Synapse's own location at `{tracker_root}`. A master agent plans and dispatches; worker agents execute in the target project and report progress back to Synapse.

## Quick Start

```bash
!project set /path/to/your/project    # Point Synapse at your project
node {tracker_root}/src/server/index.js # Start the dashboard server
npm start                               # Launch the Electron app
!p_track {your prompt here}             # Run a parallel swarm
```

## Path Convention

| Placeholder | Meaning |
|---|---|
| `{tracker_root}` | Absolute path to the Synapse repository |
| `{project_root}` | Absolute path to the target project |

Workers write code in `{project_root}` and report progress to `{tracker_root}`. Resolved via: (1) `--project /path` flag, (2) `{tracker_root}/.synapse/project.json`, (3) Agent's CWD.

## How It Works

```
Master plans --> writes initialization.json
       |
       v
Workers execute in {project_root} --> write progress files to {tracker_root}
       |
       v
server.js watches files --> SSE pushes to browser --> Dashboard renders live
```

## Execution Mode

**Serial:** Task touches 1-2 files, quick fixes, no independent subtasks. Execute directly.

**Parallel (`!p_track`):** 3+ independent subtasks across multiple files. Use when the work decomposes naturally. This is the primary swarm command with full dashboard tracking.

**Lightweight Parallel (`!p`):** Same as parallel but without dashboard overhead. Good for simpler multi-task dispatches (<3 tasks, single wave only).

**Auto-escalation:** If a task clearly decomposes into 3+ independent subtasks, proactively suggest parallel mode to the user rather than executing serially.

### Full Dashboard Tracking — Mandatory Thresholds

When a swarm has **3+ parallel agents** or **more than 1 wave**, the master MUST populate its designated dashboard with full tracking. This is non-negotiable for multi-wave swarms. Workers must be instructed to read `tracker_worker_instructions.md` and write progress files to the dashboard. The only exception is explicit `!p` invocation (lightweight by design, though escalation is recommended at these thresholds).

## Planning Guidance

### Layout: Waves vs Chains

- **Waves** — Use when tasks group into clear phases (e.g., "foundation first, then features, then integration"). Tasks within a wave are independent; waves execute sequentially.
- **Chains** — Use when tasks form linear dependency sequences (e.g., "A feeds B feeds C"). Multiple chains can run in parallel.
- **Hybrid** — Most real swarms mix both. Default to waves unless the dependency graph is clearly chain-shaped.

### Decomposition

- **Sweet spot:** 4-8 tasks for most swarms. Fewer than 3 doesn't justify orchestration overhead. More than 12 risks coordination complexity.
- **Right-size tasks:** Each task should be self-contained, completable in 1-5 minutes, and independently verifiable. If a task description needs more than 2-3 sentences, it's probably too big.
- **One concern per task:** A task that says "implement X and also update Y" should usually be two tasks.
- **Invest in planning:** Spend proportionally more time planning than executing. A well-decomposed plan with clear dependencies prevents most swarm failures.

### Shared File Conflicts

When multiple tasks need the same file, choose a pattern:

- **Pattern A (Owner):** One task owns the file; others depend on it. Best when one task does most of the work.
- **Pattern B (Integration):** Tasks write to separate files; a later integration task merges them. Best for config files, route registrations, barrel exports.
- **Pattern C (Separate):** Restructure so each task writes its own file. Best option when possible — eliminates conflicts entirely.

Prefer C > B > A. Pattern A creates bottlenecks. Pattern C enables maximum parallelism.

### Circuit Breaker

Pause the swarm and reassess the plan when:
- 3+ tasks in the same wave fail for related reasons (likely a planning error)
- A failed task blocks the majority of downstream work (cascading failure)
- Workers report deviations that invalidate the original plan assumptions

Don't pause for isolated failures — retry or route around them.

## Directory Structure

```
Synapse/                         <-- {tracker_root}
|-- CLAUDE.md                    <-- You are here
|-- .synapse/project.json        <-- Target project config
|-- _commands/                   <-- Synapse/ (swarm), project/ (analysis), profiles/
|-- agent/                       <-- Instructions, master/worker protocols, core docs
|-- dashboards/{id}/             <-- Live dashboard data (progress files, logs, state)
|-- documentation/               <-- Deep-dive reference by topic
|-- tasks/{date}/                <-- Per-swarm task + plan files
|-- Archive/                     <-- Archived swarm snapshots
|-- src/server/ + src/ui/        <-- SSE server + React dashboard
|-- src/ui/components/preview/  <-- Live Preview tab (PreviewView)
|-- src/ui/preview/             <-- Webview injection script (inject-overlay.js)
+-- electron/                    <-- Desktop app
    |-- services/PreviewService.js     <-- Label-to-source mapper
    |-- services/PreviewTextWriter.js  <-- Text update writer
    +-- services/InstrumentService.js  <-- Project instrumentation
```

## Project Knowledge Index (PKI)

The PKI is a persistent knowledge layer at `{project_root}/.synapse/knowledge/` that accumulates deep operational understanding of the target project -- gotchas, patterns, conventions, domain taxonomy, and file relationships. It is populated by four mechanisms: `!learn` (cold-start bootstrap), worker annotations (swarm-time discovery), a PostToolUse staleness hook (automatic change detection), and `!learn_update` (incremental refresh). Masters use the PKI during pre-planning to inject relevant knowledge into worker prompts. The `!context` command queries it for enriched output. See [`documentation/project-integration/pki-overview.md`](documentation/project-integration/pki-overview.md) for full details.

## Commands

| Category | Command | Description |
|---|---|---|
| **Project** | `!project` | Show, set, or clear the target project path |
| | `!initialize` | Initialize Synapse for a target project |
| | `!onboard` | Project walkthrough |
| | `!scaffold` | Generate a CLAUDE.md for a project |
| | `!create_claude` | Create or update an opinionated CLAUDE.md |
| | `!learn` | Bootstrap the Project Knowledge Index (PKI) from scratch |
| | `!learn_update` | Incrementally refresh the PKI (stale/new files only) |
| | `!instrument` | Add `data-synapse-label` attributes to project files for Live Preview |
| **Swarm** | `!p_track {prompt}` | **Primary.** Full parallel swarm with live dashboard |
| | `!p {prompt}` | Lightweight parallel dispatch |
| | `!master_plan_track` | Multi-stream orchestration across dashboards |
| | `!add_task {prompt}` | Add tasks to an active swarm mid-flight |
| | `!dispatch {id}` | Manually dispatch pending tasks |
| | `!eager_dispatch` | Full eager dispatch round with complete worker prompts |
| | `!retry {id}` | Re-dispatch a failed task |
| | `!resume` | Resume a chat session after interruption |
| | `!p_track_resume` | Resume a stalled/interrupted `!p_track` swarm |
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

## Live Preview

Synapse includes a Live Preview tab that embeds your running web app and enables inline text editing. Double-click any labeled text element to edit it directly — changes are written back to your source code automatically.

### Setup
1. Run `!instrument` on your project to add `data-synapse-label` attributes to text elements
2. Start your dev server (`npm run dev`, `vite`, etc.)
3. Click the Preview tab in the sidebar and enter your dev server URL
4. Double-click any text to edit it inline

### How It Works
- `!instrument` scans JSX/TSX/HTML files and adds `data-synapse-label` attributes to headings, paragraphs, buttons, links, and other text-bearing elements
- The Preview tab loads your app in an embedded webview with an overlay script that detects labeled elements
- When you double-click and edit text, the change is mapped back to the source file and written automatically
- Supports React, Next.js, Vite, and any HTML/JS project
