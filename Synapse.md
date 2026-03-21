# Synapse

## What It Is

Synapse is a native desktop application for orchestrating parallel AI agent swarms. It decomposes complex software engineering tasks into independent units, dispatches multiple Claude Code agents simultaneously, tracks every dependency between them, and gives the developer a live dashboard to watch, intervene, and steer the entire operation in real time.

It is not a wrapper around a single agent. It is not a prompt chaining tool. It is a distributed control plane for autonomous agent execution — designed so the developer stays in command of every process running in the background, without having to babysit any of them.

---

## The Problem Synapse Solves

AI agents are powerful. A single Claude Code instance can read a codebase, plan an approach, write code, and run tests. But every agent has the same fundamental constraint: a finite context window. Feed it a large enough task and it starts forgetting its own decisions. It re-reads files it already analyzed. It loses track of conventions it understood ten minutes ago. The work degrades.

The obvious solution — "just give it a bigger task and let it run" — fails predictably on anything beyond a few files. The less obvious solution — manually splitting work across multiple terminals — works but doesn't scale. You end up context-switching between agents, copying results from one into another, resolving conflicts when two agents edit the same file, and losing track of what's finished and what's blocked.

Synapse eliminates all of this. One command decomposes the work, dispatches agents in parallel, feeds upstream results into downstream prompts automatically, tracks dependencies so nothing launches before its prerequisites are done, and surfaces everything on a live dashboard where you can see exactly what every agent is doing at any moment.

---

## Why the Developer Must Stay in the Loop

There is a temptation in the AI tooling space to remove the developer from the process entirely. "Just describe what you want and let the agents handle it." This sounds appealing until you realize that autonomous agents operating without oversight produce autonomous failures — and those failures compound.

An agent that silently deviates from your architecture creates technical debt that nobody asked for. An agent that makes assumptions about your API contracts introduces bugs that pass unit tests but fail in integration. An agent that "improves" code outside its scope creates merge conflicts with the three other agents running in parallel.

Synapse takes the opposite position: **the developer is the most important part of the system.** The agents are execution capacity. The developer is judgment, context, and decision-making. Synapse amplifies the developer's output by parallelizing the execution, but it never removes the developer from the decision chain.

This manifests in concrete design choices:

**Plan review before dispatch.** When you run `!p_track`, the master agent reads your codebase deeply, plans every task, maps every dependency, and populates the dashboard with the full plan — all tasks visible as pending cards with dependency lines drawn between them. Nothing executes until you review the plan and approve it. You see what will happen before it happens.

**Live visibility during execution.** Every agent card on the dashboard shows its current stage (reading context, planning, implementing, testing, finalizing), elapsed time, latest milestone, and any deviations from the plan. Yellow badges appear instantly when a worker diverges from what was planned. You don't have to wait for completion to know something went sideways.

**Intervention at any point.** You can dispatch pending tasks manually (`!dispatch`), retry failed tasks with context about why they failed (`!retry`), cancel a swarm gracefully (`!cancel-safe`) or immediately (`!cancel`), and inspect any individual task in depth (`!inspect`). The system never locks you out.

**Deviation transparency.** When a worker does something different from what the master planned — a different implementation approach, additional files modified, skipped steps, changed scope — it reports the deviation immediately. The dashboard shows it. The master logs it. You decide whether it's acceptable or needs correction.

This is not hand-holding. This is how complex distributed systems should be managed. Air traffic controllers don't fly the planes, but they see every aircraft, every trajectory, every potential conflict. Synapse gives the developer that same elevated perspective over their agent swarm.

---

## Architecture

Synapse runs as an Electron desktop application with three interconnected layers:

```
Electron Main Process
├── SwarmOrchestrator    — Self-managing dispatch engine
├── ClaudeCodeService    — Spawns Claude Code CLI workers
├── PromptBuilder        — Constructs self-contained worker prompts
├── TaskEditorService    — Swarm builder backend (CRUD for task graphs)
├── ConversationService  — Chat history persistence per dashboard
└── ProjectService       — Workspace/project detection

React Frontend (Vite)
├── WavePipeline         — Vertical wave visualization with dependency lines
├── ChainPipeline        — Horizontal chain visualization
├── ClaudeView           — Streaming chat interface to Claude Code CLI
├── SwarmBuilder         — Visual task graph editor
├── Sidebar              — 5-dashboard selector with project context
└── Modals               — Planning, agent details, worker terminal, settings

Node.js SSE Server
├── WatcherService       — fs.watch on progress files, fs.watchFile on init/logs
├── DashboardService     — File I/O for reading/writing dashboard state
├── SSEManager           — Persistent connections for real-time push
└── ArchiveService       — Historical swarm snapshots
```

All state lives in JSON files on disk. No database. No external service. The server watches files with `fs.watch`, detects changes within milliseconds, and pushes updates to the frontend via Server-Sent Events. The frontend merges static plan data from `initialization.json` with dynamic lifecycle data from worker progress files to render the live dashboard.

This file-based architecture makes every piece of state inspectable, debuggable, and portable. You can read any dashboard's state by opening JSON files. You can move Synapse between machines by copying the directory. You can audit every decision the system made by reading the logs.

---

## How Context is Preserved and Optimized

Context management is the single most important factor in agent swarm performance. An agent that runs out of context produces garbage. An agent with irrelevant context wastes tokens on noise. An agent missing upstream results makes decisions based on stale assumptions. Synapse addresses all three failure modes through a deliberate context architecture.

### The Master Reads Everything, Workers Read Almost Nothing

During the planning phase, the master agent reads extensively — your project's `CLAUDE.md`, source files across directories, type definitions, configs, documentation, test files. It builds a complete mental model of the codebase, then distills that model into targeted, self-contained prompts for each worker.

Each worker receives a prompt that contains everything it needs to execute its task without reading additional files or asking questions:

- **Exact file paths** to read and modify — no searching or guessing
- **Code snippets** showing the patterns and conventions from relevant files — quoted directly, not paraphrased
- **CLAUDE.md excerpts** with the project's tech stack, naming conventions, and architectural constraints
- **Dependency context** explaining what upstream tasks accomplished and what interfaces they introduced
- **Critical details** — gotchas, edge cases, security boundaries, performance constraints
- **Clear success criteria** — specific, verifiable conditions for "done"

This means workers spend their context budget on implementation, not exploration. A worker that receives its full context upfront runs faster, produces more consistent code, and almost never needs to backtrack because it "discovered" something mid-task that changes its approach.

### Upstream Results Flow Downstream Automatically

When task 1.1 completes and task 2.1 depends on it, Synapse doesn't just mark the dependency as satisfied and dispatch 2.1 with its original planning-phase prompt. It injects the actual results from 1.1 into 2.1's prompt:

- What 1.1 actually accomplished (its completion summary)
- What files it created or modified
- Any new interfaces, types, exports, or APIs it introduced
- Any deviations from the original plan that affect downstream work

This is critical because the downstream worker's prompt was written during planning — before the upstream work existed. Without upstream injection, the downstream worker operates on stale assumptions. It might import from the wrong path, use an old function signature, or duplicate work that was already done.

With upstream injection, every downstream worker sees the actual state of the codebase at the moment it starts, not the predicted state from the planning phase. This eliminates an entire class of integration failures that plague naive parallel execution.

### Right-Sized Tasks Prevent Context Exhaustion

Synapse decomposes work into tasks that take a single agent 1-5 minutes to complete. This isn't arbitrary — it's the sweet spot where parallelism benefits outweigh orchestration overhead, and where each agent's context stays focused and fresh.

A task that reads 2-3 files and modifies 1-2 files is typical. A task that would require reading 10+ files or modifying 5+ gets decomposed further. The goal is that every agent's context budget goes to actually building the thing, with minimal overhead spent on understanding the surroundings.

This also means each agent operates in a small, well-defined scope where it can hold the complete picture in its working context. It doesn't forget earlier decisions because it hasn't made that many. It doesn't lose track of conventions because the prompt told it exactly which conventions apply. It doesn't drift from the architecture because the architecture was embedded in its instructions.

### The Tiered Context Strategy

Not every piece of context is equally expensive to produce or equally useful to consume. Synapse uses a four-tier strategy:

1. **Glob/Grep** — Zero-token, always current. The primary tool for finding files and patterns. Used extensively during planning.
2. **Project CLAUDE.md** — Architecture overview, conventions, constraints. Read once, excerpted into worker prompts.
3. **Project profile** — Auto-generated quick facts (tech stack, key directories, git info). Instant orientation on revisits.
4. **Table of Contents** — Opt-in semantic map for large projects. Only generated when the project is too large for Glob/Grep to navigate efficiently.

Each tier is used only when the previous tier is insufficient. A 50-file project never needs a TOC. A 5,000-file monorepo does. The system adapts to the scale of the project without imposing overhead on smaller ones.

---

## The Dashboard: Real-Time Swarm Visibility

The dashboard is not a nice-to-have. It is the primary interface for understanding what your swarm is doing.

### Visualization Modes

**Wave mode** arranges tasks in vertical columns by dependency level. Each column represents a wave — tasks within it are independent peers that can all execute simultaneously. Dependency lines connect cards across waves, showing exactly what feeds into what. Hover a card and its upstream dependencies highlight blue while downstream tasks it blocks highlight red.

**Chain mode** arranges tasks in horizontal rows by dependency chain. Each row traces one path from a root task (no dependencies) to a terminal task (no dependents). This is better for narrow, deep pipelines where you want to see the critical path.

Both modes show the same data — they're different views optimized for different dependency graph shapes. You set the mode during planning based on whether your work is broad (many independent tasks) or deep (long sequential chains).

### Agent Cards

Every task appears as a card showing:

- **Status** — pending (gray), in progress (animated), completed (green), failed (red)
- **Stage** — which phase the worker is in (reading context, planning, implementing, testing, finalizing)
- **Elapsed time** — live timer from when the worker started
- **Current milestone** — the latest thing the worker reported doing
- **Deviation badge** — yellow indicator if the worker diverged from the plan

Click any card to open a detail modal with the full milestone timeline, complete deviation list, and a per-agent log viewer showing every event the worker reported.

### Stat Cards

Six stat cards across the top show Total, Completed, In Progress, Failed, Pending, and Elapsed time. All derived from progress files in real time — no manual counting, no stale data.

### Log Panel

A collapsible drawer at the bottom shows every event across all agents. Filter by level: All, Info, Warn, Error, Deviation. The log panel is the swarm's flight recorder — every dispatch, completion, failure, and deviation is timestamped and attributed.

### Multi-Dashboard

Synapse supports up to five simultaneous swarms. The sidebar shows all five dashboards with status indicators and project names. Starting a new swarm auto-selects the first available slot and never overwrites an in-progress swarm. Switch between dashboards with a click.

This means you can run a frontend swarm on dashboard 1, a backend swarm on dashboard 2, and a documentation swarm on dashboard 3 — all in parallel, all visible, all independent.

---

## The Dispatch Engine

The SwarmOrchestrator is the heart of Synapse's execution model. It replaces the need for a terminal-based master agent to sit in a loop dispatching work. Instead, the Electron app itself manages the full dispatch lifecycle.

### Dependency-Driven, Not Wave-Driven

Waves are a visual grouping for humans. The dispatch engine ignores them entirely. It looks only at individual task dependencies. The moment a task's dependencies are all satisfied, it launches — even if sibling tasks in the same wave are still running, even if an earlier wave isn't fully complete.

This means the pipeline flows continuously. There is never a moment where the system is waiting for a batch to finish before checking if anything else is ready. Every completion triggers an immediate scan of all pending tasks.

### Failure Isolation and Automatic Repair

When a task fails, it blocks only its direct dependents. Everything else keeps running. The orchestrator creates a repair task — a fresh agent with the original task's context plus the failure details — and wires all downstream dependencies to the repair task instead. If the repair succeeds, the pipeline continues as if nothing went wrong.

If failures cascade (3+ in the same wave, or a failure that blocks more than half the remaining work), the system pauses and presents an assessment. Is there a shared root cause? Does the plan need revision? Should the swarm be cancelled? The developer decides.

### No Artificial Concurrency Cap

The system dispatches as many agents as there are ready tasks. If 8 tasks are unblocked, 8 agents launch simultaneously. The only bottleneck is the dependency graph itself. In practice, the first wave of any swarm sees maximum parallelism, and subsequent waves gradually narrow as dependencies converge.

---

## The Swarm Builder

Beyond command-line orchestration, Synapse includes a visual swarm builder — a GUI for constructing task graphs without writing JSON or XML.

The builder provides a task form where you define each unit of work, a dependency editor where you wire tasks together, and a wave preview that shows the resulting parallel structure. You can drag tasks between waves, add or remove dependencies, and see how changes affect the execution order.

This is particularly useful for recurring workflows. Build a task template once — say, your standard feature implementation pattern (API endpoint, database migration, service layer, frontend component, tests, integration) — and reuse it with different specifics each time.

### AI-Assisted Planning

The planning modal accepts a plain-language prompt ("add user authentication with OAuth2 and email/password") and decomposes it into a complete task graph with dependencies. It reads your project context, understands your architecture, and produces a plan you can review and edit in the swarm builder before dispatch.

This combines the speed of automated decomposition with the judgment of manual review. The AI proposes; you validate and adjust.

---

## Built-In Chat Interface

Synapse embeds a full Claude Code chat interface directly in the app. You can ask questions about your codebase, run individual tasks, or issue swarm commands without leaving the window or switching to a terminal.

The chat streams output live — tool calls appear as collapsible blocks showing what the agent read, wrote, or executed. Conversation history persists per dashboard, so switching between dashboards preserves your chat context for each.

This means you have a single pane of glass for everything: swarm orchestration on the dashboard, direct agent interaction in the chat, and task management in the swarm builder. No terminal windows to manage, no context lost switching between tools.

---

## How This Differs from Existing Approaches

### vs. Single-Agent IDEs

Tools like Cursor, Windsurf, or a single Claude Code session give you one agent with one context window. Powerful for focused tasks, but fundamentally limited when the work spans multiple files, directories, or concerns simultaneously. You can't parallelize with a single agent. You can't decompose and dispatch. You wait for sequential execution.

Synapse runs N agents in parallel, each with its own focused context, coordinated by a dependency graph that ensures nothing conflicts. A task that takes a single agent 30 minutes to work through sequentially might take 5 minutes with six agents running the independent parts simultaneously.

### vs. Agent Frameworks

Libraries like LangChain, CrewAI, or AutoGen give you building blocks for multi-agent systems. But they're frameworks, not products. You write the orchestration logic, the dispatch loop, the dependency tracking, the visualization. You handle state management, failure recovery, and context passing between agents yourself.

Synapse is the finished system. The orchestration is built. The dispatch loop is dependency-aware. The dashboard is live. The failure recovery is automatic. You describe what you want done, review the plan, and watch it execute.

### vs. Pipeline Tools

CI/CD systems (GitHub Actions, Jenkins) and workflow engines (Temporal, Airflow) orchestrate predefined steps. They don't read your codebase, decompose novel tasks, or construct agent prompts with embedded context. They run scripts you already wrote, not work you're still figuring out.

Synapse starts from a natural-language description of what you want and produces the entire execution plan, including context-rich prompts for each agent, dependency resolution, and live progress tracking. The planning itself is the product, not just the execution.

### vs. "Autonomous" Agents

Systems like Devin or fully autonomous coding agents aim to remove the developer entirely. Give it a ticket, come back later, hope for the best. This works for narrow, well-specified tasks. It fails for anything that requires judgment about architecture, priorities, trade-offs, or scope.

Synapse keeps the developer in the loop at every decision point while automating everything that doesn't require human judgment. You review the plan. You see the execution. You intervene when needed. The agents handle the implementation grunt work. The developer handles the engineering decisions.

---

## The Master Agent Discipline

When a swarm is active, the master agent — the one that planned and dispatched the work — follows an absolute rule: **it never writes code.**

This is not a suggestion. It is a core architectural constraint. The master reads, plans, dispatches, monitors, and reports. Workers write code, create files, run tests. The master does not "help" by writing a quick fix. It does not "speed things up" by implementing one small thing directly. If code needs to be written, it is a task for a worker.

Why? Because the master's value comes from its elevated perspective. It holds context from every file it read during planning. It sees the full dependency graph. It knows what every worker is doing and what comes next. The moment it starts writing code, it loses this perspective. It gets tunnel-visioned into implementation details. It forgets to dispatch the next wave. It misses a dependency. It writes code that conflicts with what a worker is simultaneously producing.

A conductor does not pick up a violin mid-symphony. The master agent does not pick up an editor mid-swarm.

The only files the master writes during a swarm:

| File | Purpose |
|---|---|
| `initialization.json` | Static plan data (written once) |
| `logs.json` | Timestamped event log |
| Master XML | Task record with status updates |
| Plan document | Strategy rationale |

Everything else — every line of application code, every new file, every test — is a worker's job.

---

## What This Enables

A developer using Synapse can take a task like "add a complete user authentication system with OAuth2, email/password, session management, rate limiting, and admin panel" and decompose it into 12 parallel tasks across 3 waves, dispatch 5 agents simultaneously in the first wave, watch all of them progress on a live dashboard, see upstream results automatically flow into downstream prompts, handle a failure in the OAuth integration with an automatic repair task, and have the entire system built, tested, and integrated in the time it would take a single agent to finish the first three tasks sequentially.

This is not theoretical. This is what the system does. The developer's output multiplies by the degree of parallelism the task graph supports. A task with 8 independent subtasks runs roughly 8x faster than sequential execution, with the developer maintaining full visibility and control throughout.

The compound effect is that projects that would take days of sequential agent work can complete in hours. Not because any individual agent works faster, but because many agents work simultaneously with minimal overhead, maximal context efficiency, and continuous dependency-driven dispatch that never lets the pipeline stall.

---

## Summary

Synapse is a control plane for AI agent swarms. It gives the developer the ability to decompose, parallelize, monitor, and steer complex multi-agent execution from a single native application. It preserves and optimizes context so every agent operates at peak capability. It keeps the developer in the loop at every decision point while automating everything that doesn't require human judgment.

The core thesis is simple: the future of AI-assisted development is not one agent doing everything. It is many agents doing focused things in parallel, coordinated by a system that understands dependencies, manages context, recovers from failures, and keeps the human in control. Synapse is that system.
