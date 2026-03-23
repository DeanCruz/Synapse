<div align="center">

# ⚡ Synapse

### AI Agent Swarm Control — Desktop App

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
| Terminal-only interaction | Native desktop GUI with built-in chat |

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

The app opens with the Claude Chat view ready for input. No separate server process needed — everything runs inside Electron.

### Step 3: Connect Your Project

Synapse is fully standalone — it works with any project, no special directory structure required.

**Option A: Quick start (no setup)**
```
# Just tell Synapse where your project is
!project set /path/to/your/project

# Start working immediately
!p_track Implement user authentication with JWT tokens
```

**Option B: Full initialization (recommended for new projects)**
```
# Point at your project
!project set /path/to/your/project

# Run full setup — detects tech stack, creates .synapse/ directory, scaffolds CLAUDE.md, generates TOC
!initialize

# Verify everything is connected
!project
```

`!initialize` does the following automatically:
1. Detects your tech stack (package.json, tsconfig.json, go.mod, Cargo.toml, pyproject.toml, etc.)
2. Creates a `.synapse/` directory in your project with configuration and a semantic table of contents
3. Scaffolds a `CLAUDE.md` in your project root if one doesn't exist (tech-stack-aware template)
4. Generates a full TOC index of your codebase for faster agent context gathering
5. Initializes 5 dashboard slots for concurrent swarms

**Option C: Just scaffold a CLAUDE.md**
```
# If you only need agent instructions for your project
!scaffold
```

Your project's `CLAUDE.md` tells agents about your tech stack, conventions, file structure, and coding standards. The better this file, the better your swarm results.

### Scripts Reference

| Command | What It Does |
|---|---|
| `npm start` | Build UI + launch the desktop app |
| `npm run dev` | Vite watch mode (rebuilds UI on file change — useful for Synapse development) |
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

Synapse reads your project's `CLAUDE.md`, scans relevant files, and builds a deep understanding of your codebase. This takes a minute or two — it's intentional. Well-informed plans produce well-informed workers.

**3. Review the plan**

The dashboard displays a task graph showing:
- Each task with its title, assigned wave, and dependencies
- Dependency arrows between tasks
- Wave groupings (tasks in the same wave run in parallel)

Review the breakdown. Check that dependencies make sense and no tasks overlap on the same files within a wave. You'll be asked to approve before dispatch begins.

**4. Watch parallel execution**

Once approved, workers dispatch immediately — all independent tasks launch at once. The dashboard updates in real-time:
- **Stage badges** show each agent's current phase (reading context → planning → implementing → testing → finalizing)
- **Milestone markers** appear as agents complete subtasks
- **Deviation badges** (yellow) appear if a worker diverges from the plan
- **Dependency lines** highlight on hover — blue for upstream needs, red for downstream blocks

**5. Get the summary**

When all tasks complete, you get a summary report with what was accomplished, any deviations, and metrics (elapsed time, parallel efficiency).

### Choosing `!p` vs `!p_track`

| | `!p_track` | `!p` |
|---|---|---|
| **Dashboard** | Full live dashboard with dependency graph | No dashboard tracking |
| **Progress files** | Workers write real-time progress to dashboard | Workers report only on completion |
| **History** | Saved to archive for future reference | No persistent history |
| **Best for** | 5+ tasks, complex dependencies, cross-file work | Quick jobs under 5 tasks |
| **Overhead** | More setup, richer monitoring | Minimal, faster startup |

**Rule of thumb:** Use `!p_track` for anything you'd want to monitor or review later. Use `!p` for quick parallel jobs where you just want results.

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

**Yellow deviation badge** — A worker diverged from the original plan. This isn't necessarily a failure — workers sometimes find a better approach. Review the deviation to decide if it's acceptable.

**Red failed card** — A task failed. What to do:

1. **Inspect the failure:** `!inspect {id}` shows what happened, where it failed, and the worker's error logs
2. **Retry with context:** `!retry {id}` dispatches a fresh agent that receives the previous failure's error output, so it can avoid the same mistake
3. **Manual dispatch:** `!dispatch {id}` to manually trigger a pending task if auto-dispatch didn't pick it up

**Automatic circuit breaker** — If 3+ tasks fail in the same wave, or a single failure blocks 3+ downstream tasks, Synapse automatically enters replanning mode. It analyzes the root cause, rewires dependencies, creates repair tasks if needed, and resumes dispatch — no manual intervention required.

### After a Swarm Completes

1. **Review the summary** — Check total tasks, elapsed time, and parallel efficiency
2. **Check deviations** — Yellow badges mean workers diverged. Review each one
3. **Test the output** — Run your project's test suite to validate changes
4. **Browse history** — `!history` shows past swarms for reference
5. **Archive happens automatically** — Swarm data is preserved and can be reviewed later

---

## Features

### Live Swarm Dashboard

Full dependency graph visualization with Wave and Chain layout modes. Real-time agent cards show stage, elapsed time, and latest milestone. Dependency lines highlight on hover — blue for upstream needs, red for downstream blocks. Yellow deviation badges appear instantly when workers diverge from the plan.

### Claude Chat

Built-in chat interface to the Claude Code CLI. Streams output live inside the app — no terminal switching required. Start swarms, ask questions, or run commands directly from the chat view.

### Swarm Builder

GUI for planning swarms: task form, dependency editor, and wave preview. Build a full task graph visually without editing JSON.

### AI Planner

AI-assisted planning wizard that accepts a plain-language prompt and automatically decomposes it into a complete task graph with dependencies.

### Commands Browser

Browse and execute all `!commands` from the UI. See available commands, their descriptions, and run them without touching the terminal.

### Worker Terminal

Live terminal output per worker process. See exactly what each agent is doing as it runs.

### Multi-Dashboard

Up to 5 simultaneous swarms. Synapse auto-selects the first available slot and never overwrites an in-progress swarm. Switch between them from the sidebar.

---

## Commands

Commands work in both the built-in chat and the terminal Claude Code CLI.

### Dispatching Work

| Command | When to Use |
|---|---|
| **`!p_track {prompt}`** | Full orchestration — live dashboard, dependency tracking, history. Use for 5+ tasks, cross-repo work, or complex dependencies. |
| **`!p {prompt}`** | Lightweight parallel dispatch — same planning, no dashboard overhead. Use for quick jobs under 5 tasks. |

### Monitoring

| Command | What It Shows |
|---|---|
| `!status` | Progress summary — completed/total, failures, elapsed time, per-agent table |
| `!logs` | Event log — `--level error`, `--task 2.3`, `--last 20`, `--since 14:30` |
| `!inspect {id}` | Deep-dive — timeline, milestones, deviations, dependencies, worker logs |
| `!deps` | Dependency graph — `--critical` for critical path, `--blocked` for stuck chains |

### Intervening

| Command | What It Does |
|---|---|
| `!dispatch {id}` | Manually dispatch a task. `--ready` dispatches all unblocked tasks |
| `!retry {id}` | Re-run a failed task — the new agent gets the failure context |
| `!cancel` | Immediately cancel. `--force` skips confirmation |
| `!cancel-safe` | Graceful shutdown — waits for in-progress agents to finish |

### Project Setup

| Command | What It Does |
|---|---|
| `!project set {path}` | Point Synapse at a target project |
| `!project` | Show current project path and status |
| `!initialize` | Full setup — tech stack detection, `.synapse/` creation, CLAUDE.md scaffold, TOC generation |
| `!scaffold` | Generate a `CLAUDE.md` for your project from its structure and tech stack |
| `!onboard` | Guided walkthrough of your project's structure, architecture, and conventions |

### Analysis (no swarm needed)

| Command | What It Does |
|---|---|
| `!context {query}` | Deep context gathering on a specific topic |
| `!review` | Code review of recent changes |
| `!health` | Project health check — dependencies, patterns, issues |
| `!scope {change}` | Blast radius analysis — what does this change affect? |
| `!trace {endpoint}` | End-to-end code tracing through your codebase |
| `!contracts` | API contract audit |
| `!env_check` | Environment variable audit |
| `!plan {task}` | Implementation planning without executing |

### Housekeeping

| Command | What It Does |
|---|---|
| `!history` | Browse past swarms. `--last 5` for recent only |
| `!reset` | Clear dashboard + save history. `--all` clears all 5 dashboards |
| `!start` / `!stop` | Start or stop the web dashboard server |
| `!guide` | Interactive command decision tree — helps you pick the right command |
| `!commands` | List all available commands |

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

The more specific you are — file paths, API shapes, UI behavior, constraints — the better the master decomposes the work and the more effective each worker becomes.

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

### Index Your Codebase with the TOC System

For large codebases, generate a semantic table of contents so agents can find relevant code faster:

```
!toc_generate              # Full TOC generation (runs as a parallel swarm)
!toc {query}               # Search the TOC — e.g., !toc "authentication middleware"
!toc_update                # Incremental update after code changes
```

The TOC is stored in `{project_root}/.synapse/toc.md` and is automatically included in agent context during planning.

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

These commands run as a single agent — fast and focused, no swarm overhead.

### Run Multiple Swarms in Parallel

Synapse supports up to 5 simultaneous swarms on separate dashboards. Use this when you have truly independent workstreams:

```
# Swarm 1: Backend work
!p_track Add REST API endpoints for the new reporting module

# Swarm 2: Frontend work (on a different dashboard)
!p_track Build the reporting dashboard with charts and export functionality
```

Each swarm gets its own dashboard slot. Switch between them from the sidebar. Synapse auto-selects the first available slot and never overwrites an in-progress swarm.

### Review Before You Approve

The planning phase shows you the full task graph before any code is written. Use this moment to:

- **Check task granularity** — Tasks should be atomic (1-5 minutes of work each). If a task is too broad, ask the master to split it further.
- **Verify dependencies** — Ensure downstream tasks actually depend on upstream outputs. Missing dependencies cause conflicts; unnecessary dependencies slow execution.
- **Look for file overlaps** — Two tasks in the same wave should never modify the same file. If they do, one needs to depend on the other.
- **Count the waves** — More waves = more sequential bottlenecks. A good plan maximizes parallelism in early waves.

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
  │  Live progress on    │◄──── real-time updates
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
- **Failures trigger automatic replanning.** A failed task blocks only its direct dependents. If failures cascade (3+ in a wave, or a single failure blocking 3+ downstream tasks), the circuit breaker spawns a replanner that analyzes root cause, rewires dependencies, adds repair tasks, and resumes dispatch automatically.

</details>

### Context & Token Optimization

> *Why not just use one agent?*

A single agent on a large task will exhaust its context window — it forgets early decisions, re-reads files, and loses coherence. Synapse solves this through architectural separation:

| Strategy | How It Works |
|---|---|
| **Read once, distill many** | Master reads your entire codebase during planning, then distills targeted prompts per worker. Each worker's context is small, focused, and complete. |
| **Workers never search** | No wasted context on exploration. The master already embedded the patterns, conventions, and file contents directly in the prompt. |
| **Upstream results flow downstream** | When Wave 1 completes, the master injects its outputs (files created, types exported, deviations) into Wave 2 prompts. No re-reading upstream work. |
| **Write-once plan** | `initialization.json` written once (updated only if the circuit breaker triggers replanning). Workers own their progress files. Dashboard derives stats client-side. Zero status bookkeeping overhead. |

---

## Architecture

```
Electron Main Process
├── main.js                  ← Window management, app lifecycle
├── preload.js               ← IPC bridge (electronAPI)
├── ipc-handlers.js          ← IPC handler registration
└── services/
    ├── ClaudeCodeService.js     ← Claude Code CLI integration
    ├── SwarmOrchestrator.js     ← Self-managing dispatch engine + circuit breaker + replanner
    ├── ConversationService.js   ← Chat history persistence
    ├── ProjectService.js        ← Workspace/project detection
    ├── CommandsService.js       ← !command discovery and execution
    ├── TaskEditorService.js     ← Swarm builder backend
    └── PromptBuilder.js         ← Worker + replanner prompt construction

React Renderer (Vite)
├── App.jsx                  ← Root with routing
├── components/
│   ├── ClaudeView.jsx       ← Chat interface
│   ├── SwarmBuilder.jsx     ← Visual task graph editor
│   ├── WavePipeline.jsx     ← Wave layout dashboard
│   ├── ChainPipeline.jsx    ← Chain layout dashboard
│   ├── Header.jsx           ← Navigation + controls
│   ├── Sidebar.jsx          ← Dashboard selector
│   └── ...
├── context/                 ← App state (React Context)
├── hooks/                   ← Data fetching, electron API
└── styles/                  ← Dark theme CSS

Server
└── src/server/index.js      ← SSE server for dashboard data
```

The frontend lives in `src/ui/` — a React/Vite app rendered by Electron.

`SwarmOrchestrator.js` is the desktop app's dispatch engine — it reads `initialization.json`, dispatches unblocked tasks via the Claude Code CLI, handles completions and failures, and updates dashboard files. When cascading failures occur (3+ in a wave, or a single failure blocking 3+ downstream tasks), the built-in circuit breaker enters replanning mode: it spawns a Claude CLI process to analyze root cause, then applies the revised plan (modified tasks, new repair tasks, dependency rewiring, or simple retries) and resumes dispatch automatically. This replaces the terminal-based master agent, so the app can run a full swarm without any terminal interaction.

---

## Configuration

| Setting | Default | Override |
|---|---|---|
| Port (web server mode) | `3456` | `PORT=8080 node src/server/index.js` |

---

<div align="center">

**Source-Available License** · Built with Electron + React + Vite

</div>
