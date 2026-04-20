<div align="center">

# Synapse

### Distributed Agent Swarm Control System

[![Electron](https://img.shields.io/badge/Electron-desktop%20app-47848F?logo=electron&logoColor=white)]()
[![React](https://img.shields.io/badge/React%2019-UI-61DAFB?logo=react&logoColor=black)]()
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blueviolet?logo=anthropic&logoColor=white)]()
[![License: Source Available](https://img.shields.io/badge/license-Source%20Available-orange.svg)](LICENSE)

**Plan, dispatch, and monitor parallel AI agent swarms from a native desktop app.**

Synapse decomposes complex tasks into independent units, dispatches multiple agents simultaneously,<br>tracks dependencies between them, and gives you a live dashboard to watch it all happen in real-time.

[Getting Started](#getting-started) · [Usage Guide](#usage-guide) · [Features](#features) · [Commands](#commands) · [Best Practices](#getting-the-most-out-of-synapse) · [How It Works](#how-it-works)

</div>

---

<div align="center">

### What changes with Synapse

| Without | With Synapse |
|:---:|:---:|
| 1 agent, sequential tasks | N agents, parallel execution |
| Context exhaustion on large tasks | Context distributed across workers |
| No visibility into progress | Live dashboard with dependency graph |
| Manual retry on failure | Circuit breaker with automatic replanning |
| Terminal-only interaction | Native desktop GUI with built-in chat, code editor, git UI, and live preview |

</div>

---

## Getting Started

### Prerequisites

Before installing Synapse, make sure you have:

| Requirement | Details |
|---|---|
| **Node.js 18+** | Required for Electron and native module compilation. Check with `node --version` |
| **npm** | Comes with Node.js. Check with `npm --version` |
| **Claude Code CLI** | Must be installed and authenticated. The `claude` command should be available on your PATH. [Install Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| **macOS** | Synapse is an Electron desktop app currently targeting macOS |

### Step 1: Clone and Install

```bash
git clone https://github.com/DeanCruz/Synapse.git
cd Synapse
npm install
```

> The `postinstall` script automatically runs `electron-rebuild` to compile `node-pty` (the native terminal emulator) for your Electron version. If this fails, ensure you have Xcode Command Line Tools installed: `xcode-select --install`.

### Step 2: Launch the App

```bash
npm start
```

This does two things:
1. **Builds the React UI** with Vite into `dist/`
2. **Launches the Electron app** which loads the built UI

The app opens with the Claude Chat view ready for input. No separate server process needed -- everything runs inside Electron.

### Step 3: Connect Your Project

Synapse is fully standalone -- it works with any project, no special directory structure required. Each dashboard has its own project configuration, so you can work on multiple projects simultaneously.

**Setting a project directory**

When you create a new dashboard, click the **Project** button in the sidebar to open the project selector. Choose a directory -- this becomes the dashboard's **project root**, where agents will read and write code.

Each dashboard remembers its own project independently. You can have five dashboards open, each pointing at a different repo.

**Adding additional context directories**

In the same project selector, you can add **additional context directories** -- read-only reference paths that agents can read for context but will never modify. Use these for:

- **Shared libraries** or monorepo packages your project depends on
- **Documentation repos** with specs, designs, or API references
- **Other related projects** agents should understand but not touch

Additional context is injected into worker prompts as clearly marked READ-ONLY material. Agents can reference files from these directories to inform their work, but all code changes go exclusively to the project root.

**Quick start**
```
1. Click "+" in the sidebar to create a dashboard
2. Click the Project button → select your project directory
3. (Optional) Add additional context directories for reference material
4. Start working: !p_track Implement user authentication with JWT tokens
```

**Full initialization (recommended for new projects)**
```
# After selecting your project directory, run full setup in chat
!initialize

# This detects your tech stack, creates .synapse/, scaffolds CLAUDE.md, generates TOC
```

`!initialize` does the following automatically:
1. Detects your tech stack (package.json, tsconfig.json, go.mod, Cargo.toml, pyproject.toml, etc.)
2. Creates a `.synapse/` directory in your project with configuration and a semantic table of contents
3. Scaffolds a `CLAUDE.md` in your project root if one doesn't exist (tech-stack-aware template)
4. Generates a full TOC index of your codebase for faster agent context gathering

**Just scaffold a CLAUDE.md**
```
# If you only need agent instructions for your project
!scaffold
```

Your project's `CLAUDE.md` tells agents about your tech stack, conventions, file structure, and coding standards. The better this file, the better your swarm results.

### Scripts Reference

| Command | What It Does |
|---|---|
| `npm start` | Build UI + launch the desktop app |
| `npm run dev` | Vite watch mode + Electron (concurrent -- useful for Synapse development) |
| `npm run dist` | Package a signed `.dmg` for macOS distribution |

---

## Usage Guide

### Running Your First Swarm

**1. Enter your task in Claude Chat**

Type a `!p_track` command with a detailed description of what you want done:

```
!p_track Add a complete user settings page with profile editing,
password change, notification preferences, and account deletion.
Use the existing auth system and follow the project's component patterns.
```

**2. The master agent reads your codebase**

Synapse reads your project's `CLAUDE.md`, scans relevant files, and builds a deep understanding of your codebase. This takes a minute or two -- it's intentional. Well-informed plans produce well-informed workers.

**3. Review the plan**

The dashboard displays a task graph showing:
- Each task with its title, assigned wave, and dependencies
- Dependency arrows between tasks
- Wave groupings (tasks in the same wave run in parallel)

Review the breakdown. Check that dependencies make sense and no tasks overlap on the same files within a wave. You'll be asked to approve before dispatch begins.

**4. Watch parallel execution**

Once approved, workers dispatch immediately -- all independent tasks launch at once. The dashboard updates in real-time:
- **Stage badges** show each agent's current phase (reading context -> planning -> implementing -> testing -> finalizing)
- **Milestone markers** appear as agents complete subtasks
- **Deviation badges** (yellow) appear if a worker diverges from the plan
- **Dependency lines** highlight on hover -- blue for upstream needs, red for downstream blocks

**5. Get the summary**

When all tasks complete, you get a summary report with what was accomplished, any deviations, and metrics (elapsed time, parallel efficiency).

### Choosing the Right Execution Mode

| | `!p_track` | `!p` | `!master_plan_track` |
|---|---|---|---|
| **Dashboard** | Full live dashboard with dependency graph | Minimal -- plan snapshot + final results | Multi-stream across multiple dashboards |
| **Progress files** | Workers write real-time progress | Workers report only on completion | Child masters run full `!p_track` per stream |
| **History** | Saved to archive for future reference | No persistent history | Per-stream archives |
| **Best for** | 3+ tasks, complex dependencies, cross-file work | Quick jobs under 3 tasks, single wave | Large bodies of work (multiple independent swarms) |
| **Overhead** | More setup, richer monitoring | Minimal, faster startup | Meta-planner + child masters |

**Rule of thumb:** Use `!p_track` for anything you'd want to monitor or review later. Use `!p` for quick parallel jobs where you just want results. Use `!master_plan_track` when work decomposes into multiple independent swarms.

### Monitoring a Running Swarm

**From the dashboard (visual):**
- Agent cards show live stage, elapsed time, and current milestone
- Click any agent card to see full details: timeline, milestones, deviations, logs
- Dependency lines highlight upstream/downstream relationships on hover
- Stats bar shows completed/total, failures, and elapsed time

**From the chat or terminal (commands):**

```
!status                    # Progress summary with per-agent table
!logs                      # Full event log
!logs --level error        # Only errors
!logs --task 2.3           # Logs for a specific task
!logs --last 10            # Most recent 10 entries
!inspect 2.3               # Deep-dive on task 2.3: timeline, deps, deviations, worker logs
!deps                      # Dependency graph overview
!deps --blocked            # Show only blocked chains
```

### Handling Failures

**Yellow deviation badge** -- A worker diverged from the original plan. This isn't necessarily a failure -- workers sometimes find a better approach. Review the deviation to decide if it's acceptable.

**Red failed card** -- A task failed. What to do:

1. **Inspect the failure:** `!inspect {id}` shows what happened, where it failed, and the worker's error logs
2. **Retry with context:** `!retry {id}` dispatches a fresh agent that receives the previous failure's error output, so it can avoid the same mistake
3. **Manual dispatch:** `!dispatch {id}` to manually trigger a pending task if auto-dispatch didn't pick it up

**Automatic circuit breaker** -- If 3+ tasks fail in the same wave, or a single failure blocks 3+ downstream tasks (or >50% of remaining tasks), Synapse automatically enters replanning mode. It analyzes the root cause, rewires dependencies, creates repair tasks if needed, and resumes dispatch -- no manual intervention required.

**Repair task protocol** -- When the circuit breaker triggers, a repair worker is dispatched with a 5-phase process: Diagnose, Plan, Implement, Verify, Complete. Repair tasks get IDs with an `r` suffix (e.g., `2.4r`). If a repair task itself fails (double failure), no further auto-repair is attempted -- a permission popup appears for manual intervention.

### After a Swarm Completes

1. **Review the summary** -- Check total tasks, elapsed time, and parallel efficiency
2. **Check deviations** -- Yellow badges mean workers diverged. Review each one
3. **Test the output** -- Run your project's test suite to validate changes
4. **Browse history** -- `!history` shows past swarms for reference
5. **Archive happens automatically** -- Swarm data is preserved and can be reviewed later

---

## Features

### Live Swarm Dashboard

Full dependency graph visualization with Wave and Chain layout modes. Real-time agent cards show stage, elapsed time, and latest milestone. Dependency lines highlight on hover -- blue for upstream needs, red for downstream blocks. Yellow deviation badges appear instantly when workers diverge from the plan. Stats bar tracks completed/total, failures, and elapsed time. Wave pipeline shows sequential wave progression with per-wave task counts.

### Claude Chat

Built-in chat interface to the Claude Code CLI. Streams output live inside the app -- no terminal switching required. Start swarms, ask questions, or run commands directly from the chat view. Supports multiple chat tabs per dashboard, conversation persistence across sessions, file attachments (images and documents), and permission relay for tool approvals. The chat panel floats above all views -- minimized, expanded, or maximized -- so it never loses state when switching between dashboard, IDE, or git views.

### Multi-Provider Support

Synapse supports both **Claude Code** and **OpenAI Codex** as agent backends. Switch between providers in settings -- each provider has its own CLI integration with appropriate argument mapping. Workers can be dispatched with either provider on a per-swarm basis.

### Swarm Builder

GUI for planning swarms visually. Add tasks with titles and descriptions, define dependencies between them via a drag-and-drop dependency editor, organize tasks into waves, and preview the full task graph before dispatch. Build a complete swarm plan without writing JSON.

### AI Planner

AI-assisted planning wizard that accepts a plain-language prompt and automatically decomposes it into a complete task graph with dependencies. Integrated into the Swarm Builder for one-click plan generation.

### Commands Browser

Browse and execute all Synapse commands from a searchable modal UI. See available commands organized by category (Synapse, Project, User), read their descriptions, and run them directly. Supports creating, editing, and deleting custom user commands.

### Worker Terminal

Live terminal output per worker process. See exactly what each agent is doing as it runs. Powered by `node-pty` for full terminal emulation with resize support.

### Multi-Dashboard

Multiple simultaneous swarms across independent dashboards. Each chat is bound to its own dashboard -- agents use their assigned dashboard exclusively and archive/clear it if it has previous data. Switch between dashboards from the sidebar. Dashboards can be renamed, reordered, created, and deleted. A dedicated `ide` dashboard auto-links Code Explorer workspaces to their own chat context.

### Git Manager

Full-featured git UI built into the app. Open any repository (or multiple at once via tabs), stage and unstage files, view unified diffs, compose commits with subject-line guidelines, manage branches with a visual SVG graph, browse commit history with infinite scroll and filters, and push/pull/fetch with ahead-behind badges. Protected branch warnings and tiered confirmation dialogs keep destructive operations safe. A **Quick Actions** bar provides one-click workflows like "Save My Work" and "Update from Remote" for users who don't want to think in git commands.

Key capabilities:
- **Multi-repo tabs** -- Open several repositories side by side, each with independent state
- **Staging and diffs** -- File-level staging controls with a unified diff viewer showing line-by-line changes
- **Branch management** -- Create, switch, merge, and delete branches with an SVG branch graph
- **Commit history** -- Searchable log with author/date/branch filters and infinite scroll
- **Remote operations** -- Push, pull, and fetch with automatic upstream tracking and protected branch warnings
- **Quick Actions** -- One-click operations ("Save My Work", "Discard All Changes") with appropriate safety dialogs
- **Auto-refresh** -- Working tree status polls every 3 seconds so changes from external editors appear automatically

### Code Explorer (IDE)

Built-in code editor powered by Monaco (the same engine as VS Code). Open any folder as a workspace, browse its file tree, and edit files with syntax highlighting for 25+ languages, bracket matching, minimap, multi-cursor, and all the editing features you'd expect from a modern editor. Each workspace automatically links to its own Synapse dashboard, so Claude chat context stays associated with the project you're working on.

Key capabilities:
- **Monaco Editor** -- VS Code-grade editing with IntelliSense, syntax highlighting, minimap, and multi-cursor
- **Workspace tabs** -- Open multiple project folders simultaneously, each with its own file tree and open files
- **Lazy-loaded file tree** -- Directories load children on demand, keeping large projects responsive
- **Workspace-dashboard bridge** -- Each workspace auto-links to a Synapse dashboard for persistent Claude chat context
- **Dirty file tracking** -- Unsaved changes are indicated on editor tabs with a visual marker
- **Search and replace** -- Project-wide search powered by ripgrep (with Node.js fallback), with regex, case-sensitive, whole-word, and glob filter support
- **Syntax checking** -- Real-time diagnostics for JSON, JavaScript, TypeScript, and CSS files
- **Draggable split panel** -- Resize the file explorer and editor panes to your preference
- **Bottom panel** -- VS Code-style panel with Terminal, Output, Problems, Debug Console, and Ports tabs

### Live Preview

Inline visual editing for your running web app. Synapse embeds your dev server in a webview, detects labeled text elements, and lets you double-click to edit text directly -- changes are written back to your source code automatically.

Setup:
1. Run `!instrument` on your project to add `data-synapse-label` attributes to text elements
2. Start your dev server (`npm run dev`, `vite`, etc.)
3. Click the Preview tab in the sidebar and enter your dev server URL
4. Double-click any text to edit it inline

How it works:
- `!instrument` scans JSX/TSX/HTML files and adds `data-synapse-label` attributes to headings, paragraphs, buttons, links, and other text-bearing elements
- The Preview tab loads your app in an embedded webview with an overlay script (`inject-overlay.js`) that detects labeled elements
- When you double-click and edit text, the `PreviewService` maps the label back to the source file and `PreviewTextWriter` writes the change
- Supports React, Next.js, Vite, and any HTML/JS project
- Edit history is tracked and can be reviewed in the UI

### Debug Service

Integrated debugger using the Chrome DevTools Protocol. Launch debug sessions for Node.js applications, set breakpoints, step through code (step over, step into, step out), inspect variables and scopes, and evaluate expressions -- all from within the Synapse UI. Debug state (breakpoints, call stack, variables, scopes) is managed through AppContext and displayed in the IDE's bottom panel.

### Project Knowledge Index (PKI)

A persistent knowledge layer that accumulates deep operational understanding of your project. Stored at `{project_root}/.synapse/knowledge/`, the PKI contains per-file annotations (gotchas, patterns, conventions, exports, relationships), a domain taxonomy, and a pattern catalog. The master agent queries the PKI during planning to inject relevant knowledge into worker prompts, improving task quality without redundant codebase scanning.

Population mechanisms:
- **`!learn`** -- Cold-start bootstrap via parallel swarm to deeply annotate every significant file
- **Worker annotations** -- Workers optionally annotate files they discover during swarm execution
- **Automatic staleness detection** -- A PostToolUse hook marks annotations as stale when source files change
- **`!learn_update`** -- Incremental refresh that re-scans only stale or new files

### Table of Contents (TOC) System

Semantic file discovery stored at `{project_root}/.synapse/toc.md`. The TOC provides agents with a searchable index of your codebase so they can find relevant code faster during planning.

- **`!toc_generate`** -- Full generation via parallel agent swarm
- **`!toc {query}`** -- Search the TOC by topic, keyword, or object name. Sub-commands: `depends-on`, `depended-by`, `cluster`, `changes-since`
- **`!toc_update`** -- Incremental update for changed files only
- Supporting files: `fingerprints.json` (content fingerprints for change detection), `dep_graph.json` (file-level dependency graph)

### Conversation Persistence

Chat conversations are saved as JSON files in `{tracker_root}/conversations/`. Each conversation is associated with a dashboard, supports multiple tabs, and persists across app restarts. Create, rename, delete, and switch between conversations.

### Home View

Overview dashboard showing all dashboards at a glance with status indicators, recent archives (top 10), recent history (top 10), and recent log entries (top 30). Quick access to any dashboard or past swarm.

### Queue System

Overflow mechanism for `!master_plan_track` multi-stream orchestration. When all dashboards are in use, additional swarm streams are queued in `queue/` directories with the same structure as dashboards. Queued items are promoted to dashboards as they free up. The queue is visible from the Home view and via the API.

---

## Commands

Commands work in both the built-in chat and the terminal Claude Code CLI. Synapse has **47 commands** across two categories.

### Dispatching Work

| Command | When to Use |
|---|---|
| **`!p_track {prompt}`** | Full orchestration -- live dashboard, dependency tracking, history. Use for 3+ tasks or complex dependencies. |
| **`!p_track_plan {plan_path}`** | Plan-driven swarm -- reads a `.md` plan file, populates the dashboard, and awaits approval before dispatch. |
| **`!p {prompt}`** | Lightweight parallel dispatch -- same planning, no dashboard overhead. Use for quick jobs under 3 tasks. |
| **`!master_plan_track {prompt}`** | Multi-stream orchestration -- decomposes work into independent swarms across multiple dashboards. Use for large bodies of work. |

### Swarm Management

| Command | What It Does |
|---|---|
| `!add_task {prompt}` | Inject new tasks into an active swarm mid-flight. Resolves dependencies, dispatches if ready. |
| `!dispatch {id}` | Manually dispatch a task. `--ready` dispatches all unblocked tasks. |
| `!eager_dispatch` | Run a standalone eager dispatch round. Identifies and dispatches all tasks with satisfied dependencies. |
| `!retry {id}` | Re-run a failed task -- the new agent gets the failure context. |
| `!cancel` | Immediately cancel the active swarm. `--force` skips confirmation. |
| `!cancel-safe` | Graceful shutdown -- lets in-progress agents finish, cancels pending. |

### Monitoring

| Command | What It Shows |
|---|---|
| `!status` | Progress summary -- completed/total, failures, elapsed time, per-agent table. |
| `!logs` | Event log -- `--level error`, `--task 2.3`, `--last 20`, `--since 14:30`. |
| `!inspect {id}` | Deep-dive -- timeline, milestones, deviations, dependencies, worker logs. |
| `!deps` | Dependency graph -- `--critical` for critical path, `--blocked` for stuck chains. |
| `!update_dashboard` | Generate a visual progress report of the current swarm. |

### Resumption

| Command | What It Does |
|---|---|
| `!resume` | Resume a chat session after interruption. Reviews history, reconstructs context, continues. |
| `!p_track_resume` | Resume a stalled/interrupted `!p_track` swarm. Reconstructs state, re-dispatches incomplete tasks. |
| `!track_resume` | Resume a stalled/interrupted swarm (generic). Analyzes state, dispatches workers. |

### Project Setup

| Command | What It Does |
|---|---|
| `!project` | Show current project path and status. Use the Project button in the sidebar to set a project per-dashboard. |
| `!initialize` | Full setup -- tech stack detection, `.synapse/` creation, CLAUDE.md scaffold, TOC generation. |
| `!scaffold` | Generate a `CLAUDE.md` for your project from its structure and tech stack. |
| `!create_claude` | Create or update an opinionated `CLAUDE.md` with rules for how the project should be built. |
| `!onboard` | Guided walkthrough of your project's structure, architecture, and conventions. |
| `!instrument` | Add `data-synapse-label` attributes to your project for Live Preview inline editing. |

### Knowledge and Indexing

| Command | What It Does |
|---|---|
| `!learn` | Bootstrap the Project Knowledge Index (PKI) from scratch via parallel swarm. |
| `!learn_update` | Incrementally refresh the PKI -- re-scans only stale/new files. |
| `!toc {query}` | Search the project TOC. Sub-commands: `depends-on`, `depended-by`, `cluster`, `changes-since`. |
| `!toc_generate` | Generate a full project TOC via parallel agent swarm. |
| `!toc_update` | Incrementally update the TOC for changed files. |

### Analysis (no swarm needed)

| Command | What It Does |
|---|---|
| `!context {query}` | Deep context gathering on a specific topic. Queries PKI if available. |
| `!review` | Code review of recent changes or specific files. |
| `!health` | Project health check -- dependencies, patterns, issues. |
| `!scope {change}` | Blast radius analysis -- what does this change affect? |
| `!trace {endpoint}` | End-to-end code tracing through your codebase. |
| `!contracts` | API contract audit -- frontend-backend consistency. |
| `!env_check` | Environment variable consistency audit. |
| `!plan {task}` | Implementation planning without executing. |
| `!prompt_audit` | Post-swarm prompt quality audit -- analyzes worker performance and prompt effectiveness. |

### Housekeeping

| Command | What It Does |
|---|---|
| `!history` | Browse past swarms. `--last 5` for recent only, `--analytics` for aggregate stats. |
| `!export` | Export a dashboard's full swarm state as markdown or JSON. |
| `!reset` | Clear dashboard data. `--keep-history` preserves history. |
| `!start` | Start the dashboard server and launch the Electron app. |
| `!stop` | Stop the dashboard server. |

### Discovery

| Command | What It Does |
|---|---|
| `!guide` | Interactive command decision tree -- helps you pick the right command. |
| `!commands` | List all available commands from all locations. |
| `!profiles` | List available agent role profiles with descriptions. |
| `!help` | Synapse guide and tips. |

---

## Getting the Most Out of Synapse

### Write Better Prompts

The quality of your swarm is directly proportional to the quality of your prompt. The master agent uses your prompt to plan the entire task decomposition.

**Good prompt:**
```
!p_track Add a complete notification system: database schema for notifications
table (user_id, type, message, read_status, created_at), REST API endpoints
(GET /notifications, PATCH /notifications/:id/read, DELETE /notifications/:id),
React notification bell component with unread count badge, dropdown panel
showing recent notifications, and mark-all-as-read functionality. Follow the
existing API patterns in src/routes/ and component patterns in src/components/.
```

**Weak prompt:**
```
!p_track Add notifications
```

The more specific you are -- file paths, API shapes, UI behavior, constraints -- the better the master decomposes the work and the more effective each worker becomes.

### Use Profiles for Domain Expertise

Profiles layer role-specific priorities and analysis on top of any command. Prefix your command with `!{profile_name}`:

```
!architect !p_track Redesign the data layer to support real-time sync
!security !p_track Add input validation and rate limiting to all API endpoints
!qa !p_track Add comprehensive test coverage for the auth module
!devops !p_track Set up CI/CD pipeline with staging and production environments
```

**Available profiles:**

| Profile | Focus |
|---|---|
| `architect` | Systems design, tradeoffs, failure modes, simplicity |
| `security` | Threat modeling, input validation, auth hardening |
| `qa` | Test coverage, edge cases, regression prevention |
| `devops` | Infrastructure, deployment, monitoring, reliability |
| `product` | User experience, feature scoping, prioritization |
| `analyst` | Data analysis, metrics, measurement |
| `technical-writer` | Documentation, API docs, guides |
| `founder` | Business context, ROI, strategic alignment |
| `growth` | User acquisition, engagement, conversion |
| `marketing` | Messaging, positioning, content strategy |
| `sales` | Revenue impact, customer objections, competitive positioning |
| `pricing` | Pricing models, value metrics, packaging |
| `legal` | Compliance, licensing, data privacy |
| `customer-success` | Onboarding, adoption, churn prevention |
| `copywriter` | Copy, tone, brand voice |

Run `!profiles` to see the full list with descriptions.

### Index Your Codebase

For large codebases, generate a semantic table of contents and knowledge index so agents can find relevant code faster:

```
# Generate a full TOC (runs as a parallel swarm)
!toc_generate

# Search the TOC
!toc "authentication middleware"

# Incremental update after code changes
!toc_update

# Bootstrap deep project knowledge (runs as a parallel swarm)
!learn

# Incremental PKI refresh (stale/new files only)
!learn_update
```

The TOC is stored in `{project_root}/.synapse/toc.md` and is automatically included in agent context during planning. The PKI provides deeper operational knowledge (gotchas, patterns, conventions) that the master injects into worker prompts.

### Run Analysis Without a Swarm

Not everything needs parallel execution. Use analysis commands for quick, focused work:

```
!context "How does the payment flow work?"     # Deep context gathering
!scope "Adding a new field to the User model"  # What files/tests would this affect?
!trace POST /api/orders                        # Trace an endpoint end-to-end
!review                                        # Code review of recent changes
!health                                        # Project health check
!contracts                                     # API contract audit
!plan "Add WebSocket support for real-time updates"  # Plan without executing
```

These commands run as a single agent -- fast and focused, no swarm overhead.

### Run Multiple Swarms in Parallel

Synapse supports multiple simultaneous swarms on separate dashboards. Use this when you have truly independent workstreams:

```
# Swarm 1: Backend work
!p_track Add REST API endpoints for the new reporting module

# Swarm 2: Frontend work (on a different dashboard)
!p_track Build the reporting dashboard with charts and export functionality
```

Each chat is bound to its own dashboard. Switch between them from the sidebar. Agents always use their assigned dashboard -- if it has previous data, the agent asks before archiving and reusing.

For very large bodies of work, use `!master_plan_track` to automatically decompose into multiple independent swarms across dashboards with a meta-planner managing the overall orchestration.

### Review Before You Approve

The planning phase shows you the full task graph before any code is written. Use this moment to:

- **Check task granularity** -- Tasks should be atomic (1-5 minutes of work each). If a task is too broad, ask the master to split it further.
- **Verify dependencies** -- Ensure downstream tasks actually depend on upstream outputs. Missing dependencies cause conflicts; unnecessary dependencies slow execution.
- **Look for file overlaps** -- Two tasks in the same wave should never modify the same file. If they do, one needs to depend on the other.
- **Count the waves** -- More waves = more sequential bottlenecks. A good plan maximizes parallelism in early waves.

### Shared File Conflict Patterns

When multiple tasks need the same file, the master agent chooses from three patterns:

| Pattern | Approach | Best When |
|---|---|---|
| **A (Owner)** | One task owns the file; others depend on it | One task does most of the work in that file |
| **B (Integration)** | Tasks write to separate files; a later task merges them | Config files, route registrations, barrel exports |
| **C (Separate)** | Restructure so each task writes its own file | Whenever possible -- eliminates conflicts entirely |

Prefer C > B > A. Pattern C enables maximum parallelism.

---

## How It Works

```
  !p_track {your task}
         |
         v
  +---------------------+
  |  Master reads your   |
  |  codebase deeply     |
  +----------+----------+
             |
             v
  +---------------------+
  |  Plans atomic tasks  |
  |  with dependencies   |
  +----------+----------+
             |
             v
  +---------------------+
  |  Dashboard shows the |
  |  plan -- you approve |
  +----------+----------+
             |
             v
  +---------------------+
  |  Workers dispatched  |<---- parallel execution
  |  in parallel         |
  +----------+----------+
             |
             v
  +---------------------+
  |  Live progress on    |<---- real-time updates
  |  dashboard           |
  +----------+----------+
             |
             v
  +---------------------+
  |  Summary report      |
  +---------------------+
```

<details>
<summary><b>Key design decisions</b></summary>

- **The master agent never writes code.** It reads, plans, dispatches, and reports. Workers do all implementation. A PreToolUse hook (`validate-master-write.sh`) enforces this constraint.
- **Workers are self-contained.** Each gets a complete prompt -- files to modify, conventions, code context, success criteria. No back-and-forth. A PostToolUse hook (`validate-progress-file.sh`) validates their progress file writes.
- **Dependencies drive dispatch, not waves.** The moment a task's dependencies are satisfied, it launches -- even if sibling tasks are still running. This is the "eager dispatch" model.
- **Failures trigger automatic replanning.** A failed task blocks only its direct dependents. If failures cascade (3+ in a wave, or a single failure blocking 3+ downstream tasks or >50% of remaining tasks), the circuit breaker spawns a replanner that analyzes root cause, rewires dependencies, adds repair tasks, and resumes dispatch automatically.
- **File-based data, no database.** All state is JSON files on disk -- initialization.json (plan), logs.json (events), progress/*.json (per-worker). Portable, inspectable, and git-friendly.

</details>

### Data Flow

```
Worker writes progress file to dashboards/{id}/progress/{task_id}.json
  |
  v  fs.watch detects change (30ms read delay, 80ms retry for mid-write files)
  |
  v  Validation pipeline: schema check + task_id/dashboard_id match
  |
  v  SSE broadcast / IPC push to renderer
  |
  v  React UI updates agent card in real-time
  |
  v  SwarmOrchestrator.handleProgressUpdate() -- triggers dispatch loop if task completed
  |
  v  Newly unblocked tasks are dispatched immediately (eager dispatch)

Fallback: Periodic reconciliation (every 5s) catches any missed fs.watch events
```

### Context and Token Optimization

> *Why not just use one agent?*

A single agent on a large task will exhaust its context window -- it forgets early decisions, re-reads files, and loses coherence. Synapse solves this through architectural separation:

| Strategy | How It Works |
|---|---|
| **Read once, distill many** | Master reads your entire codebase during planning, then distills targeted prompts per worker. Each worker's context is small, focused, and complete. |
| **Workers never search** | No wasted context on exploration. The master already embedded the patterns, conventions, and file contents directly in the prompt. |
| **Upstream results flow downstream** | When Wave 1 completes, the master injects its outputs (files created, types exported, deviations) into Wave 2 prompts. No re-reading upstream work. |
| **PKI reduces redundancy** | The Project Knowledge Index captures gotchas, patterns, and conventions once. The master injects relevant PKI entries into worker prompts (max ~100 lines) instead of making each worker rediscover them. |
| **Write-once plan** | `initialization.json` written once (updated only if the circuit breaker triggers replanning). Workers own their progress files. Dashboard derives stats client-side. Zero status bookkeeping overhead. |

---

## Architecture

```
Electron Main Process (electron/)
+-- main.js                          <- Window management, app lifecycle, app:// protocol
+-- preload.js                       <- IPC bridge (window.electronAPI) -- ~140 methods, 26 push channels
+-- ipc-handlers.js                  <- IPC handler registration, broadcast bridge, file watchers
+-- settings.js                      <- Persisted settings (JSON in userData)
+-- services/
    +-- ClaudeCodeService.js         <- Claude Code CLI integration (spawn, kill, stream output)
    +-- CodexService.js              <- OpenAI Codex CLI integration (parallel to Claude)
    +-- SwarmOrchestrator.js         <- Self-managing dispatch engine, circuit breaker, replanner
    +-- PromptBuilder.js             <- Worker + replanner prompt construction
    +-- ConversationService.js       <- Chat history persistence (conversations/ directory)
    +-- ProjectService.js            <- Tech stack detection, CLAUDE.md discovery, CLI detection
    +-- CommandsService.js           <- !command discovery, CRUD, AI generation
    +-- TaskEditorService.js         <- Swarm builder backend (task/wave CRUD, validation)
    +-- TerminalService.js           <- PTY terminal sessions (node-pty)
    +-- DebugService.js              <- Chrome DevTools Protocol debugger
    +-- InstrumentService.js         <- Live Preview: add data-synapse-label to project files
    +-- PreviewService.js            <- Live Preview: label-to-source file mapping
    +-- PreviewTextWriter.js         <- Live Preview: write text changes back to source
    +-- AutoUpdateService.js        <- Electron auto-update state machine

React Renderer (src/ui/, Vite build)
+-- main.jsx                         <- Entry point, IPC fetch shim, CSS imports
+-- App.jsx                          <- Root layout: Header + Sidebar + View Router + Claude Float
+-- context/AppContext.jsx           <- Global state (useReducer, ~80 state keys)
+-- components/
|   +-- Header.jsx                   <- Navigation, project selector, controls
|   +-- Sidebar.jsx                  <- Dashboard list with status dots, view switcher
|   +-- HomeView.jsx                 <- Overview: all dashboards, archives, history, logs
|   +-- ClaudeView.jsx               <- Chat interface (streaming, tabs, attachments, permissions)
|   +-- ClaudeFloatingPanel.jsx      <- Always-mounted chat panel (minimized/expanded/maximized)
|   +-- DashboardContent.jsx         <- Swarm visualization container
|   +-- WavePipeline.jsx             <- Wave layout dashboard
|   +-- ChainPipeline.jsx            <- Chain layout dashboard
|   +-- AgentCard.jsx                <- Per-task progress card
|   +-- SwarmBuilder.jsx             <- Visual task graph editor
|   +-- git/                         <- Git Manager (12 components)
|   +-- ide/                         <- Code Explorer (12 components)
|   +-- preview/                     <- Live Preview tab
|   +-- modals/                      <- Commands, Project, Settings, Planning, TaskEditor
+-- hooks/                           <- useElectronData, useSSE, useGitActions, etc.
+-- utils/                           <- Formatting, status derivation, helpers
+-- styles/                          <- Dark theme CSS

SSE Server (src/server/)
+-- index.js                         <- HTTP server (port 3456), SSE endpoint, startup/shutdown
+-- SSEManager.js                    <- Client management, broadcast, heartbeat (15s), dashboard filtering
+-- routes/apiRoutes.js              <- REST API (20+ endpoints: dashboards, archives, history, queue)
+-- services/
|   +-- DashboardService.js          <- Dashboard CRUD, file I/O, atomic writes
|   +-- WatcherService.js            <- File watching (fs.watch + fs.watchFile + reconciliation)
|   +-- DependencyService.js         <- Dependency resolution, dispatch readiness
|   +-- ArchiveService.js            <- Archive CRUD
|   +-- HistoryService.js            <- History summary building and persistence
|   +-- QueueService.js              <- Queue read operations
+-- utils/
    +-- constants.js                 <- Named constants, timing values, defaults
    +-- json.js                      <- JSON I/O, retry logic, schema validators, atomic writes
    +-- validation.js                <- Dependency graph validation (Kahn's algorithm)

Agent System (agent/, _commands/)
+-- agent/instructions/              <- Master, worker, multi-plan, failure protocols (7 files)
+-- agent/master/                    <- Master role, dashboard writes, eager dispatch, failure recovery (10 files)
+-- agent/worker/                    <- Progress reporting, return format, deviations, upstream deps (5 files)
+-- agent/core/                      <- Command resolution, parallel principles, profiles, paths (7 files)
+-- _commands/Synapse/               <- 25 swarm/orchestration command files
+-- _commands/project/               <- 22 project/analysis command files
+-- _commands/profiles/              <- 15 role profiles (architect, security, qa, devops, etc.)
+-- .claude/skills/                  <- 10 skills (7 user-invocable, 3 auto-loaded protocols)
+-- .claude/agents/                  <- 2 agent definitions (master-orchestrator, swarm-worker)

Data Directories
+-- dashboards/{id}/                 <- Live dashboard data (initialization.json, logs.json, progress/)
+-- Archive/                         <- Archived dashboard snapshots
+-- history/                         <- History summary JSON files
+-- queue/                           <- Queue slots for multi-stream orchestration
+-- conversations/                   <- Chat conversation persistence
+-- tasks/{date}/                    <- Per-swarm task files and plan documents
```

### Dual-Use: Electron and Standalone

The SSE server (`src/server/index.js`) runs in two modes:

- **Electron-embedded** (default): The Electron app starts file watchers directly via `ipc-handlers.js`. The React UI communicates through IPC. No separate server process needed.
- **Standalone**: Run `node src/server/index.js` to start the HTTP/SSE server on port 3456. Browser clients connect via `http://localhost:3456/events` for real-time updates and `http://localhost:3456/api/*` for data.

Both modes share the same service layer (`src/server/services/`). The Electron app's broadcast bridge adapts the server's `WatcherService` events into IPC push events.

---

## Configuration

### Settings

Settings are persisted in `{userData}/synapse-settings.json` and configurable from the Settings modal in the app.

| Setting | Default | Description |
|---|---|---|
| `theme` | `original` | UI theme |
| `agentProvider` | `claude` | Active CLI provider (`claude` or `codex`) |
| `defaultModel` | (empty) | Default model name for agent dispatch |
| `claudeCliPath` | (auto-detected) | Path to Claude CLI binary |
| `codexCliPath` | (auto-detected) | Path to Codex CLI binary |
| `dangerouslySkipPermissions` | `false` | Skip permission prompts for all workers |
| `dashboardCount` | `5` | Number of dashboards |
| `initPollMs` | `100` | Polling interval for initialization/logs file changes |
| `progressRetryMs` | `80` | Retry delay for mid-write progress file reads |
| `progressReadDelayMs` | `30` | Delay before reading a changed progress file |
| `reconcileDebounceMs` | `300` | Debounce for dashboard/queue directory changes |

### Project Configuration

Project-specific configuration is stored in `{project_root}/.synapse/` (created by `!initialize`):

| File | Purpose |
|---|---|
| `project.json` | Target project path and metadata |
| `toc.md` | Semantic table of contents |
| `fingerprints.json` | File content fingerprints for TOC change detection |
| `dep_graph.json` | File-level dependency graph |
| `knowledge/manifest.json` | PKI routing index (domains, tags, concept map) |
| `knowledge/annotations/*.json` | Per-file deep knowledge annotations |
| `knowledge/domains.json` | Domain taxonomy |
| `knowledge/patterns.json` | Pattern catalog |

### Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | Override the SSE server port (default: `3456`) |
| `SYNAPSE_DASHBOARD_ID` | Injected into worker processes to identify their dashboard |

---

<div align="center">

**Source-Available License** -- Built with Electron + React + Vite

</div>
