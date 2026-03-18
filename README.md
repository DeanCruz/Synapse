<div align="center">

# ⚡ Synapse

### AI Agent Swarm Control — Desktop App

[![Electron](https://img.shields.io/badge/Electron-desktop%20app-47848F?logo=electron&logoColor=white)]()
[![React](https://img.shields.io/badge/React%2019-UI-61DAFB?logo=react&logoColor=black)]()
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blueviolet?logo=anthropic&logoColor=white)]()
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Plan, dispatch, and monitor parallel AI agent swarms from a native desktop app.**

Synapse decomposes complex tasks into independent units, dispatches multiple agents simultaneously,<br>tracks dependencies between them, and gives you a live dashboard to watch it all happen in real-time.

[Getting Started](#getting-started) · [Features](#features) · [Commands](#commands) · [How It Works](#how-it-works)

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
| Terminal-only interaction | Native desktop GUI with built-in chat |

</div>

---

## Getting Started

> **Prerequisites:** Node.js (any recent version) + Claude Code CLI.

### Install & Run

```bash
npm install
npm start
```

`npm start` builds the React UI with Vite, then launches the Electron app — no separate server needed.

### Other Scripts

| Command | What It Does |
|---|---|
| `npm start` | Build UI + launch the desktop app |
| `npm run dev` | Vite watch mode (rebuilds UI on change) |
| `npm run dist` | Package a signed `.dmg` for macOS distribution |
| `npm run server` | Web server mode only — dashboard at http://localhost:3456 |

### Project Setup

Synapse is fully standalone — it can live anywhere and work with any project. No special directory structure required.

```bash
# Point Synapse at your project (or just run from within the project directory)
!project set /path/to/your/project

# Or auto-detect from current working directory — no setup needed
!p_track {your prompt here}
```

Your target project should have its own `CLAUDE.md` describing its tech stack and conventions. Run `!scaffold` to generate one if missing, or `!initialize` for full project setup (creates `.synapse/` directory for TOC, context cache, etc.).

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

## Architecture

```
Electron Main Process
├── main.js                  ← Window management, app lifecycle
├── preload.js               ← IPC bridge (electronAPI)
├── ipc-handlers.js          ← IPC handler registration
└── services/
    ├── ClaudeCodeService.js     ← Claude Code CLI integration
    ├── SwarmOrchestrator.js     ← Self-managing dispatch engine
    ├── ConversationService.js   ← Chat history persistence
    ├── ProjectService.js        ← Workspace/project detection
    ├── CommandsService.js       ← !command discovery and execution
    ├── TaskEditorService.js     ← Swarm builder backend
    └── PromptBuilder.js         ← Worker prompt construction

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

`SwarmOrchestrator.js` is the desktop app's dispatch engine — it reads `initialization.json`, dispatches unblocked tasks via the Claude Code CLI, handles completions and failures, and updates dashboard files. This replaces the terminal-based master agent, so the app can run a full swarm without any terminal interaction.

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

### Housekeeping

| Command | What It Does |
|---|---|
| `!history` | Browse past swarms. `--last 5` for recent only |
| `!reset` | Clear dashboard + save history. `--all` clears all 5 dashboards |
| `!start` / `!stop` | Start or stop the web dashboard server |
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

---

## Configuration

| Setting | Default | Override |
|---|---|---|
| Port (web server mode) | `3456` | `PORT=8080 node src/server/index.js` |

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

**MIT License** · Built with Electron + React + Vite

</div>