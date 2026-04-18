# Synapse — Distributed Agent Swarm Control System

Synapse coordinates autonomous agent swarms for parallel software development. It operates on a **target project** at `{project_root}` — separate from Synapse's own location at `{tracker_root}`. A master agent plans and dispatches; worker agents execute in the target project and report progress back to Synapse.

## Quick Start

```bash
# Electron app (recommended — embeds server + dashboard + chat)
!project set /path/to/your/project    # Point Synapse at your project
npm start                              # Launch the Electron app (server starts automatically)
!p_track {your prompt here}            # Run a parallel swarm


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
WatcherService detects file changes --> broadcast bridge
       |
       +--> IPC push to Electron renderer --> React dashboard renders live
       +--> SSE push to browser clients (standalone mode)
       +--> SwarmOrchestrator intercepts progress --> dispatches next tasks
```

## Execution Mode

**Serial:** Task touches 1-2 files, quick fixes, no independent subtasks. Execute directly.

**Parallel (`!p_track`):** 3+ independent subtasks across multiple files. Use when the work decomposes naturally. This is the primary swarm command with full dashboard tracking. Workers write progress files; master writes initialization.json, logs.json, master_state.json, and metrics.json.

**Lightweight Parallel (`!p`):** Same as parallel but without dashboard overhead. Workers do NOT write progress files. Master writes minimal progress files from worker returns for file tracking. Good for simpler multi-task dispatches (<3 tasks, single wave only).


**Auto-escalation:** If a task clearly decomposes into 3+ independent subtasks, proactively suggest parallel mode to the user rather than executing serially.

### Full Dashboard Tracking — Mandatory Thresholds

When a swarm has **3+ parallel agents** or **more than 1 wave**, the master MUST populate its designated dashboard with full tracking. This is non-negotiable for multi-wave swarms. Workers must be instructed to read `tracker_worker_instructions.md` and write progress files to the dashboard. The only exception is explicit `!p` invocation (lightweight by design, though escalation is recommended at these thresholds).

## Planning Guidance

### Layout: Waves vs Chains

- **Waves** — Use when tasks group into clear phases (e.g., "foundation first, then features, then integration"). Tasks within a wave are independent; waves execute sequentially.
- **Chains** — Use when tasks form linear dependency sequences (e.g., "A feeds B feeds C"). Multiple chains can run in parallel.
- **Hybrid** — Most real swarms mix both. Default to waves unless the dependency graph is clearly chain-shaped.

### Decomposition

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
Synapse/                              <-- {tracker_root}
|-- CLAUDE.md                         <-- You are here
|-- .synapse/project.json             <-- Target project config
|
|-- .claude/
|   |-- settings.json                 <-- Claude Code agent settings
|   |-- agents/
|   |   |-- master-orchestrator.md    <-- Master agent definition (hooks: validate-master-write)
|   |   +-- swarm-worker.md           <-- Worker agent definition (hooks: validate-progress-file)
|   |-- hooks/                        <-- Pre/Post tool-use validation hooks
|   |   |-- validate-master-write.sh  <-- Prevents master from writing project files
|   |   |-- validate-progress-file.sh <-- Validates worker progress file writes
|   |   +-- ... (13 hooks total)
|   +-- skills/                       <-- Skill definitions (loaded on demand)
|       |-- p-track/                  <-- Full parallel swarm (fork, opus)
|       |-- p/                        <-- Lightweight parallel (fork, opus)
|       |-- master-plan-track/        <-- Multi-stream orchestration (fork, opus)
|       |-- p-track-resume/           <-- Resume stalled swarm (fork, opus)
|       |-- eager-dispatch/           <-- Standalone eager dispatch (fork, opus)
|       |-- dashboard-ops/            <-- Routes to status/logs/inspect/deps/history/cancel/reset
|       |-- project-workflow/         <-- Routes to project setup/analysis commands
|       |-- master-protocol/          <-- Auto-loaded master orchestration protocol
|       |-- worker-protocol/          <-- Auto-loaded worker progress protocol
|       +-- failure-protocol/         <-- Auto-loaded failure recovery protocol
|
|-- _commands/
|   |-- Synapse/                      <-- 24 swarm orchestration commands
|   |   |-- p_track.md, p.md, master_plan_track.md, add_task.md, dispatch.md,
|   |   |-- eager_dispatch.md, retry.md, resume.md, p_track_resume.md,
|   |   |-- track_resume.md, update_dashboard.md, export.md, cancel.md,
|   |   |-- cancel-safe.md, status.md, logs.md, inspect.md, deps.md,
|   |   |-- history.md, start.md, stop.md, reset.md, guide.md, project.md
|   |-- project/                      <-- 22 project analysis commands
|   |   |-- initialize.md, onboard.md, scaffold.md, create_claude.md,
|   |   |-- context.md, review.md, health.md, scope.md, trace.md,
|   |   |-- contracts.md, env_check.md, plan.md, prompt_audit.md,
|   |   |-- learn.md, learn_update.md, instrument.md, toc.md,
|   |   |-- toc_generate.md, toc_update.md, commands.md, profiles.md, help.md
|   +-- profiles/                     <-- 15 agent role profiles
|       |-- analyst.md, architect.md, copywriter.md, customer-success.md,
|       |-- devops.md, founder.md, growth.md, legal.md, marketing.md,
|       +-- pricing.md, product.md, qa.md, sales.md, security.md, technical-writer.md
|
|-- agent/
|   |-- _commands/                    <-- Internal p_track phase docs (not user-invocable)
|   |   |-- p_track_planning.md, p_track_execution.md, p_track_completion.md
|   |-- instructions/                 <-- Agent instruction files
|   |   |-- tracker_master_instructions.md
|   |   |-- tracker_worker_instructions.md      <-- FULL worker protocol
|   |   |-- tracker_worker_instructions_lite.md  <-- LITE worker protocol
|   |   |-- tracker_multi_plan_instructions.md
|   |   |-- failed_task.md, common_pitfalls.md, dashboard_resolution.md
|   |-- master/                       <-- Master agent reference docs (9 files)
|   |   |-- role.md, dashboard_writes.md, ui_map.md, eager_dispatch.md,
|   |   |-- failure_recovery.md, worker_prompts.md, compaction_recovery.md,
|   |   +-- dashboard_protocol.md, pki_integration.md
|   |-- worker/                       <-- Worker agent reference docs (5 files)
|   |   |-- progress_reporting.md, return_format.md, deviations.md,
|   |   +-- upstream_deps.md, sibling_comms.md
|   |-- core/                         <-- Core principles and conventions (7 files)
|   |   |-- command_resolution.md, parallel_principles.md, profile_system.md,
|   |   |-- project_discovery.md, path_convention.md, dashboard_features.md,
|   |   +-- data_architecture.md
|   +-- utils/
|       +-- token_estimate.js
|
|-- electron/                         <-- Electron desktop app
|   |-- main.js                       <-- App lifecycle, window creation, app:// protocol
|   |-- preload.js                    <-- IPC bridge (33 push channels, ~140 pull methods)
|   |-- ipc-handlers.js              <-- Central IPC registration (~2200 lines)
|   |-- settings.js                   <-- Persistent settings store (JSON file)
|   +-- services/
|       |-- ClaudeCodeService.js      <-- Claude CLI process spawning/management
|       |-- CodexService.js           <-- Codex CLI process spawning/management
|       |-- SwarmOrchestrator.js      <-- GUI swarm dispatch engine + circuit breaker
|       |-- PromptBuilder.js          <-- Worker prompt construction
|       |-- TaskEditorService.js      <-- Swarm builder CRUD operations
|       |-- ConversationService.js    <-- Chat conversation persistence
|       |-- ProjectService.js         <-- Project detection + context loading
|       |-- CommandsService.js        <-- Command discovery + AI generation
|       |-- TerminalService.js        <-- PTY terminal sessions (node-pty)
|       |-- DebugService.js           <-- Node.js debugger (Chrome DevTools Protocol)
|       |-- InstrumentService.js      <-- data-synapse-label instrumentation
|       |-- PreviewService.js         <-- Label-to-source file mapper
|       +-- PreviewTextWriter.js      <-- Text update writer + dev server detection
|
|-- src/server/                       <-- SSE server (no framework, pure http)
|   |-- index.js                      <-- HTTP server, SSE endpoint, startup/shutdown
|   |-- SSEManager.js                 <-- SSE client management, broadcast, heartbeat
|   |-- routes/
|   |   +-- apiRoutes.js              <-- All REST API endpoint handlers (20+ endpoints)
|   |-- services/
|   |   |-- DashboardService.js       <-- Dashboard CRUD, file I/O
|   |   |-- WatcherService.js         <-- File watching, reconciliation, validation
|   |   |-- QueueService.js           <-- Queue read operations
|   |   |-- ArchiveService.js         <-- Archive CRUD
|   |   |-- HistoryService.js         <-- History summary building/persistence
|   |   +-- DependencyService.js      <-- Dependency resolution, dispatch readiness
|   +-- utils/
|       |-- constants.js              <-- Named constants, defaults, timing values
|       |-- json.js                   <-- JSON I/O, retry logic, schema validators
|       +-- validation.js             <-- Dependency graph validation (Kahn's algorithm)
|
|-- src/ui/                           <-- React 18 dashboard (functional components, useReducer)
|   |-- main.jsx                      <-- Entry point, IPC fetch shim, CSS imports
|   |-- App.jsx                       <-- Root component, view router
|   |-- context/
|   |   +-- AppContext.jsx            <-- Global state (AppContext + DispatchContext)
|   |-- hooks/
|   |   |-- useDashboardData.js       <-- Dashboard data fetching/subscriptions
|   |   |-- useElectronAPI.js         <-- Electron IPC bridge hook
|   |   +-- useResize.js              <-- Resize observer hook
|   |-- components/
|   |   |-- Header.jsx, Sidebar.jsx, ProgressBar.jsx, StatsBar.jsx
|   |   |-- HomeView.jsx, SwarmBuilder.jsx, TerminalView.jsx
|   |   |-- AgentCard.jsx, WavePipeline.jsx, ChainPipeline.jsx
|   |   |-- LogPanel.jsx, MetricsPanel.jsx, TimelinePanel.jsx
|   |   |-- BottomPanel.jsx, EmptyState.jsx, ConnectionIndicator.jsx
|   |   |-- ClaudeView.jsx, QueuePopup.jsx
|   |   |-- git/                      <-- Git Manager (12 components)
|   |   |   |-- GitManagerView.jsx, BranchPanel.jsx, ChangesPanel.jsx,
|   |   |   |-- CommitPanel.jsx, DiffViewer.jsx, HistoryPanel.jsx,
|   |   |   +-- RemotePanel.jsx, RepoTabs.jsx, ...
|   |   |-- ide/                      <-- Code Explorer (12 components)
|   |   |   |-- IDEView.jsx, CodeEditor.jsx, FileExplorer.jsx,
|   |   |   |-- EditorTabs.jsx, SearchPanel.jsx, DebugPanels.jsx,
|   |   |   +-- DebugToolbar.jsx, ProblemsPanel.jsx, ...
|   |   |-- preview/
|   |   |   +-- PreviewView.jsx       <-- Live Preview tab
|   |   +-- modals/                   <-- Modal dialogs (14 components)
|   |       |-- CommandsModal.jsx, ProjectModal.jsx, SettingsModal.jsx,
|   |       |-- PlanningModal.jsx, TaskEditorModal.jsx, ArchiveModal.jsx,
|   |       |-- HistoryModal.jsx, PermissionModal.jsx, AgentDetails.jsx,
|   |       +-- TaskDetails.jsx, WorkerTerminal.jsx, ...
|   |-- preview/
|   |   +-- inject-overlay.js        <-- Webview injection script for Live Preview
|   |-- utils/                        <-- Utility modules
|   |   |-- constants.js, format.js, markdown.js, dependencyLines.js,
|   |   +-- ideWorkspaceManager.js, dashboardProjects.js, monacoWorkerSetup.js
|   +-- styles/                       <-- CSS stylesheets
|
|-- dashboards/{id}/                  <-- Live dashboard data (one dir per dashboard)
|   |-- initialization.json           <-- Task plan (agents, waves, chains)
|   |-- logs.json                     <-- Log entries
|   |-- metrics.json                  <-- Post-swarm performance metrics
|   +-- progress/
|       +-- {task_id}.json            <-- Worker progress files
|
|-- Archive/                          <-- Archived dashboard snapshots
|-- history/                          <-- History summary JSON files
|-- queue/                            <-- Overflow queue for master_plan_track
|-- conversations/                    <-- Chat conversation JSON files
|-- tasks/{date}/                     <-- Per-swarm task + plan files
|-- backlog/                          <-- Backlog items (complete/ and todo/)
+-- documentation/                    <-- Deep-dive reference docs by topic
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
| | `!update_dashboard` | Generate a visual progress report of the current swarm |
| | `!export` | Export a dashboard's swarm state as markdown or JSON |
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
| | `!prompt_audit` | Post-swarm prompt quality audit |
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
