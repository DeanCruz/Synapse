# Synapse

## What It Is

Synapse is a native desktop application for orchestrating parallel AI agent swarms. It decomposes complex software engineering tasks into independent units, dispatches multiple AI agents simultaneously (Claude Code and Codex), tracks every dependency between them, and gives the developer a live dashboard, chat interface, code explorer, git manager, and live preview to watch, intervene, and steer the entire operation in real time.

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
Electron Main Process (17 files, ~7000 lines)
├── SwarmOrchestrator       — Self-managing dispatch engine with circuit breaker and replanning
├── ClaudeCodeService       — Spawns Claude Code CLI workers (NDJSON streaming)
├── CodexService            — Spawns Codex CLI workers (parallel provider support)
├── PromptBuilder           — Constructs self-contained worker prompts with upstream injection
├── TaskEditorService       — Swarm builder backend (CRUD for task graphs)
├── ConversationService     — Chat history persistence per dashboard
├── ProjectService          — Workspace/project detection, language/CLI detection
├── CommandsService         — Command CRUD, AI-powered command generation
├── TerminalService         — PTY terminal sessions (node-pty)
├── DebugService            — Node.js debugger via Chrome DevTools Protocol
├── InstrumentService       — Live Preview: data-synapse-label instrumentation
├── PreviewService          — Live Preview: label-to-source mapping with caching
├── PreviewTextWriter       — Live Preview: text editing and dev server detection
├── settings.js             — Settings persistence (JSON, write-through cache)
├── ipc-handlers.js         — Central IPC registration (~140 methods, 33 push channels)
└── preload.js              — Context bridge (window.electronAPI)

React Frontend (Vite, 25+ files, ~6000 lines)
├── DashboardContent        — Swarm pipeline with progress bar, stat cards, log panel
├── WavePipeline            — Vertical wave visualization with SVG dependency lines
├── ChainPipeline           — Horizontal chain visualization
├── ClaudeView              — Streaming chat interface (~1500 lines)
├── SwarmBuilder            — Visual task graph editor
├── IDEView                 — Code Explorer (Monaco editor, file tree, search, debug)
├── GitManagerView          — Git manager (status, branches, diff, commit, push/pull)
├── PreviewView             — Live Preview (embedded webview with inline editing)
├── HomeView                — Overview: active dashboards, archives, history
├── Sidebar                 — Dashboard selector with status dots, drag-reorder, navigation
├── Header                  — Task badge, archive dropdown, commands button
├── BottomPanel             — Terminal, Output, Problems, Debug Console tabs
└── Modals (14)             — Planning, agent details, commands, project, settings, etc.

Node.js SSE Server (12 files, ~2300 lines)
├── WatcherService          — fs.watch on progress dirs, fs.watchFile on init/logs, reconciliation
├── DashboardService        — Dashboard CRUD, file I/O, atomic writes
├── DependencyService       — Dependency resolution, dispatch readiness detection
├── SSEManager              — Per-client dashboard filtering, heartbeat, broadcast
├── ArchiveService          — Historical swarm snapshots
├── HistoryService          — History summary building and persistence
└── QueueService            — Queue read operations for multi-stream overflow
```

All state lives in JSON files on disk. No database. No external service. The server watches files with `fs.watch`, detects changes within milliseconds, and pushes updates to the frontend via Server-Sent Events. The frontend merges static plan data from `initialization.json` with dynamic lifecycle data from worker progress files to render the live dashboard.

The IPC bridge connects the Electron main process to the React renderer with ~140 pull request methods and 33 whitelisted push channels. All renderer-to-main communication flows through `window.electronAPI` with full context isolation and channel whitelisting.

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

### Bottom Panel

A VS Code-style bottom panel is always available on the dashboard view, with tabs for Terminal, Output, Problems, Debug Console, and Ports. The Terminal tab connects to real PTY sessions via node-pty.

### Multi-Dashboard

Synapse supports multiple simultaneous swarms. The sidebar shows all dashboards with status indicator dots (idle, in progress, completed, error) and per-dashboard project names. Each chat is bound to exactly one dashboard — agents always use their assigned dashboard and archive/clear it if it has previous data. Switch between dashboards with a click.

The sidebar supports drag-and-drop reorder, inline rename (double-click), per-dashboard chat buttons with unread badges, delete confirmation with active-agent detection, and a collapsible design (52px collapsed, 220px expanded). Chat previews show the last agent message per dashboard.

Dashboards use dynamic 6-character hex IDs (e.g., `a3f7k2`). IDE workspaces automatically get dedicated dashboards, pinned at the top of the sidebar. The `ide` dashboard is a special permanent reservation.

This means you can run a frontend swarm on one dashboard, a backend swarm on another, and a documentation swarm on a third — all in parallel, all visible, all independent.

---

## The Dispatch Engine

The SwarmOrchestrator is the heart of Synapse's execution model. It replaces the need for a terminal-based master agent to sit in a loop dispatching work. Instead, the Electron app itself manages the full dispatch lifecycle.

The orchestrator operates as a state machine with five states: `running`, `paused`, `cancelled`, `completed`, and `replanning`. Each dashboard can have its own independent swarm running simultaneously.

### Dependency-Driven, Not Wave-Driven

Waves are a visual grouping for humans. The dispatch engine ignores them entirely. It looks only at individual task dependencies. The moment a task's dependencies are all satisfied, it launches — even if sibling tasks in the same wave are still running, even if an earlier wave isn't fully complete.

This means the pipeline flows continuously. There is never a moment where the system is waiting for a batch to finish before checking if anything else is ready. Every completion triggers an immediate scan of all pending tasks.

The dispatch loop is triggered automatically through the broadcast bridge: when a worker writes a progress file with `status: "completed"`, the WatcherService detects the change, broadcasts an `agent_progress` event, the bridge intercepts it and calls `SwarmOrchestrator.handleProgressUpdate()`, which scans for newly unblocked tasks and dispatches them immediately.

### Multi-Provider Worker Dispatch

Synapse supports multiple AI providers for worker agents. The `agentProvider` setting selects the default, but each swarm can override it. Both `ClaudeCodeService` and `CodexService` implement the same spawn/kill/list interface, with provider-specific CLI argument construction.

Workers are spawned as child processes with isolated environments. Each receives a system prompt (containing worker instructions and dispatch context) and a task prompt (containing the task description, project context, and upstream results). The PromptBuilder service constructs both, injecting CLAUDE.md excerpts, upstream task summaries, and PKI knowledge blocks as needed.

### Failure Isolation and Automatic Repair

When a task fails, it blocks only its direct dependents. Everything else keeps running. The orchestrator creates a repair task — a fresh agent with the original task's context plus the failure details — and wires all downstream dependencies to the repair task instead. If the repair succeeds, the pipeline continues as if nothing went wrong.

If a repair task itself fails (double failure), the system stops creating repair tasks for that branch and writes a `permission` log entry that triggers a dashboard popup, routing the developer to their terminal for manual intervention.

### Circuit Breaker and Replanning

Two triggers cause the circuit breaker to fire:
1. **3+ failures in the same wave** — likely indicates a shared root cause
2. **Blast radius > 50%** — a single failure blocks 3+ remaining tasks or >50% of undispatched work

When triggered, the orchestrator transitions to `replanning` state and spawns a replanner agent. The replanner receives the full context: completed tasks with summaries, failed tasks with error details and last 10 log entries, pending tasks, and the original plan. It produces a structured revision with four categories: `modified`, `added`, `removed`, and `retry`. The revision is applied to `initialization.json` and dispatch resumes.

### No Artificial Concurrency Cap

The system dispatches as many agents as there are ready tasks. If 8 tasks are unblocked, 8 agents launch simultaneously. The only bottleneck is the dependency graph itself. In practice, the first wave of any swarm sees maximum parallelism, and subsequent waves gradually narrow as dependencies converge.

---

## The Swarm Builder

Beyond command-line orchestration, Synapse includes a visual swarm builder — a GUI for constructing task graphs without writing JSON manually.

The builder provides a task form where you define each unit of work, a dependency editor where you wire tasks together, and a wave preview that shows the resulting parallel structure. You can drag tasks between waves, add or remove dependencies, and see how changes affect the execution order.

This is particularly useful for recurring workflows. Build a task template once — say, your standard feature implementation pattern (API endpoint, database migration, service layer, frontend component, tests, integration) — and reuse it with different specifics each time.

### AI-Assisted Planning

The PlanningModal accepts a plain-language prompt ("add user authentication with OAuth2 and email/password") and decomposes it into a complete task graph with dependencies. It spawns an agent that reads your project context, understands your architecture, and streams the plan as it generates. The resulting plan can be reviewed in a preview panel, then edited in the SwarmBuilder before dispatch.

The SwarmBuilder itself provides task management (add, edit, delete), auto-wave management (new waves created automatically, empty waves removed), task ID generation in `{wave}.{index}` format, and dependency validation using Kahn's algorithm for cycle detection.

This combines the speed of automated decomposition with the judgment of manual review. The AI proposes; you validate and adjust.

### Swarm Control

Once a swarm is launched from the builder, the SwarmOrchestrator takes over with full lifecycle management:

- **Pause/Resume:** Stop dispatching new tasks while in-flight tasks continue. Resume to pick up where you left off.
- **Cancel:** Kill all dashboard workers and mark the swarm as cancelled.
- **Retry:** Clear a failed task's state, delete its old progress file, and re-dispatch with fresh context.
- **Get States:** Query all active swarm states across dashboards with task counts.

---

## Built-In Chat Interface

Synapse embeds a full Claude Code chat interface directly in the app. You can ask questions about your codebase, run individual tasks, or issue swarm commands without leaving the window or switching to a terminal.

The chat is implemented as a floating panel that is always mounted in the component tree — IPC listeners and streaming state survive view transitions. It has four view modes: minimized (pill button), collapsed (header only), expanded (resizable floating panel), and maximized (full-width). The panel supports multiple chat tabs per dashboard, with messages and processing state stashed and restored when switching between dashboards.

The chat streams output live — content block accumulation handles `content_block_start`, `content_block_delta`, and `content_block_stop` events in real-time. Tool calls appear as collapsible blocks with rich formatting per tool type: file reads show clickable paths (which open in the Code Explorer), edits show diff views with +/- markers, bash commands show with `$` prompts, and Task tool calls show agent descriptions. Extended thinking blocks are collapsible with animated dots.

**Multi-provider support:** The chat supports both Claude (Opus 4.6, Sonnet 4.6, Haiku 4.5) and Codex (GPT-5.4, GPT-5.4-Mini, and other models) providers. Provider and model selection is persisted via settings. The pill button dynamically shows "Claude" or "Codex" based on the active provider.

**Conversation persistence:** Messages are saved to localStorage per dashboard:tab key, with conversation history stored as JSON files in `{tracker_root}/conversations/`. The ConversationService provides full CRUD operations — list, load, save, create, delete, and rename conversations. Session resumption uses the CLI's `--resume` flag for continuing conversations across app restarts. Messages are capped at 200 per tab with automatic trimming.

**Permission handling:** When a worker requests permission for a tool call, an interactive modal appears with approve/deny buttons and an "always allow" checkbox. Informational permission requests show the message without interactive controls.

This means you have a single pane of glass for everything: swarm orchestration on the dashboard, direct agent interaction in the chat, and task management in the swarm builder. No terminal windows to manage, no context lost switching between tools.

---

## Code Explorer (IDE)

Synapse includes a VS Code-inspired code editor built into the app. The Code Explorer provides a complete development environment without leaving Synapse.

**Workspace management:** Open multiple project folders simultaneously, each with its own file tree and dedicated dashboard. Workspaces are persisted to localStorage and automatically linked to dashboards for chat context.

**Monaco editor:** Full code editor with syntax highlighting, supporting all major file types. Open multiple files in tabs with dirty indicators for unsaved changes.

**File explorer:** Lazy-loaded directory tree with expand/collapse, supporting recursive directory scanning. Skip hidden directories, `node_modules`, and `dist` by default.

**Project-wide search:** Search across all files in a workspace with regex, case sensitivity, whole-word matching, and include/exclude globs. Uses ripgrep (`rg --json`) for performance with a Node.js fallback. Search and replace is supported.

**Node.js debugger:** Full debugging support using Chrome DevTools Protocol. Set breakpoints (including conditional), step through code (over, into, out), inspect variables and call stack, evaluate expressions, and view scopes. The debug toolbar provides play, pause, step, and stop controls. Debug panels show variables, call stack, breakpoints, and watch expressions.

**Bottom panel:** A VS Code-style bottom panel with five tabs: Terminal (PTY-backed via node-pty), Output, Problems (syntax diagnostics for JSON, JS/JSX, TS, CSS), Debug Console, and Ports.

**IDE diagnostics:** Syntax checking for JSON (via `JSON.parse`), JavaScript/JSX (via `vm.compileFunction`), TypeScript, and CSS (bracket/string matching). Diagnostics display in the Problems panel.

---

## Git Manager

Synapse includes a built-in Git client for version control operations without leaving the app.

**Multi-repo support:** Open multiple repositories and switch between them. Repositories are persisted to localStorage. Non-git directories are detected with an option to run `git init`.

**Changes panel:** View staged, unstaged, and untracked files. Stage, unstage, and discard individual files. Status is polled every 3 seconds while the view is active.

**Diff viewer:** Side-by-side diff display for any changed file, showing additions and deletions with syntax highlighting.

**Commit panel:** Write commit messages and commit staged changes. Ctrl+Enter shortcut for quick access.

**History:** Browse the commit log with hash, author, date, and message for each entry.

**Branch management:** List all branches, create new branches, switch between branches, and delete branches.

**Remote operations:** Push, pull, and fetch with remote selection. View ahead/behind counts for remote tracking branches.

**Integration:** File paths in agent detail views are clickable and navigate directly to the Git view for that file, connecting swarm output to version control.

All git operations use `execFile('git', args)` for injection safety — no shell execution.

---

## Live Preview

Synapse includes a Live Preview tab that embeds your running web app and enables inline text editing. Double-click any labeled text element to edit it directly — changes are written back to your source code automatically.

### Setup and Prerequisites

1. Run `!instrument` on your project to add `data-synapse-label` UUID attributes to text-bearing elements (headings, paragraphs, buttons, links, labels, and other elements in JSX/TSX/HTML files)
2. Start your dev server (`npm run dev`, `vite`, etc.)
3. Click the Preview tab in the sidebar and enter your dev server URL (or click "Detect" to auto-find a running server)
4. Double-click any text to edit it inline

### How It Works

The Preview tab loads your app in an Electron `<webview>` tag and injects two scripts after the page loads:

1. **inject-overlay.js** scans for elements with `data-synapse-label` attributes and adds double-click handlers for inline editing
2. A bridge script forwards edit events via `console.log` with a `__SYNAPSE_EDIT__` prefix

When you edit text inline, the change is routed through the IPC bridge to `PreviewTextWriter`, which:
1. Searches all project files for the specific UUID label (globally unique, so unambiguous)
2. Locates the labeled element's opening and closing tags
3. Performs a surgical text replacement — pure text content is replaced entirely; mixed content (text + child tags) replaces only the first text segment
4. Writes the modified file back to disk

**Dev server detection:** The system checks for framework config files (`vite.config.*`, `next.config.*`, `nuxt.config.*`, etc.) and probes common ports (3000, 3001, 5173, 5174, 8080) to auto-detect running servers. Framework-specific port ordering prioritizes the most likely matches.

**Label caching:** The `PreviewService` builds a reverse map from label UUIDs to source file locations and caches it with staleness detection based on file modification times.

Supports React, Next.js, Vite, Nuxt, Angular, Svelte, and any HTML/JS project.

---

## Project Knowledge Index (PKI)

The PKI is a persistent knowledge layer that accumulates deep operational understanding of a target project. It lives at `{project_root}/.synapse/knowledge/` and stores gotchas, patterns, conventions, domain taxonomy, and file relationships.

### Why It Exists

When the master agent plans a swarm, it needs to inject relevant project-specific knowledge into each worker's prompt. Without the PKI, the master relies entirely on CLAUDE.md and whatever it can read in its context window. For large projects, this misses critical nuances — the gotcha in the auth middleware that breaks if you don't call `next()`, the naming convention that changed after v3, the implicit dependency between the billing service and the user model.

The PKI captures this operational knowledge and makes it queryable, so the master can inject exactly the right context into each worker's prompt.

### Population

Four mechanisms populate the PKI:

1. **`!learn`** — Cold-start bootstrap. Dispatches a parallel swarm to deeply annotate every significant file in the project.
2. **Worker annotations** — Workers optionally populate an `annotations` field in their progress files during swarm execution. The master merges these into the PKI post-swarm.
3. **PostToolUse staleness hook** — Automatic change detection marks annotations as stale when source files are modified.
4. **`!learn_update`** — Incremental refresh. Detects stale and new files, re-scans only what changed.

### Consumption

During swarm planning, the master runs a 6-step PKI pre-planning flow:

1. Check if PKI exists (look for `manifest.json`)
2. Extract domains, tags, and concepts from the user's prompt
3. Look up files via `domain_index`, `tag_index`, and `concept_map`
4. Read annotations for matched files (capped at 8-10 files)
5. Build a PKI knowledge block (max ~100 lines)
6. Inject into worker prompts under the `[PKI]` label in the CONVENTIONS section

The system degrades gracefully — no PKI, empty PKI, partial PKI, fully stale PKI, and PKI with no matches for the current task all produce functional plans.

---

## Table of Contents (TOC) System

For large projects (500+ files) where file names alone do not reveal purpose, Synapse can generate a semantic Table of Contents.

The TOC system produces three artifacts at `{project_root}/.synapse/`:

- **`toc.md`** — The semantic index itself, organized by directory with file purpose annotations
- **`fingerprints.json`** — File content fingerprints for detecting semantic shifts (not just modification times)
- **`dep_graph.json`** — File-level dependency graph from import analysis

### Commands

| Command | Purpose |
|---|---|
| `!toc {query}` | Search the TOC by topic, keyword, or object name. Sub-commands: `depends-on`, `depended-by`, `cluster`, `changes-since`. |
| `!toc_generate` | Full generation via parallel agent swarm. Scans every directory. |
| `!toc_update` | Incremental update. Detects new/deleted/moved/changed files using fingerprints. |

The TOC is opt-in — Synapse works without it. For smaller projects, Glob and Grep provide sufficient file discovery.

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
| Master task file | Task record with status updates |
| Plan document | Strategy rationale |

Everything else — every line of application code, every new file, every test — is a worker's job.

---

## What This Enables

A developer using Synapse can take a task like "add a complete user authentication system with OAuth2, email/password, session management, rate limiting, and admin panel" and decompose it into 12 parallel tasks across 3 waves, dispatch 5 agents simultaneously in the first wave, watch all of them progress on a live dashboard, see upstream results automatically flow into downstream prompts, handle a failure in the OAuth integration with an automatic repair task, and have the entire system built, tested, and integrated in the time it would take a single agent to finish the first three tasks sequentially.

Beyond swarm orchestration, the developer never leaves the app. They review code changes in the Code Explorer with syntax highlighting and debugging. They commit and push from the Git Manager. They edit live text in the running app through Live Preview. They chat with agents about their codebase in the built-in chat. They browse commands and generate new ones from the Commands modal. All from a single window.

This is not theoretical. This is what the system does. The developer's output multiplies by the degree of parallelism the task graph supports. A task with 8 independent subtasks runs roughly 8x faster than sequential execution, with the developer maintaining full visibility and control throughout.

The compound effect is that projects that would take days of sequential agent work can complete in hours. Not because any individual agent works faster, but because many agents work simultaneously with minimal overhead, maximal context efficiency, and continuous dependency-driven dispatch that never lets the pipeline stall.

---

## Command System

Synapse provides 46 commands across four categories, resolved through a priority hierarchy:

1. **Synapse swarm commands** (24) — `_commands/Synapse/` — Swarm orchestration, dispatch, monitoring, and control
2. **Project commands** (22) — `_commands/project/` — Project analysis, knowledge management, code review, and setup
3. **User commands** — `_commands/user/` — User-local custom commands (git-ignored)
4. **Project commands** — `{project_root}/_commands/` — Target project-specific commands

Commands are invoked with `!{command}` syntax. 15 agent role profiles (`_commands/profiles/`) layer personas on top of any command, adjusting priorities, tone, and output style for roles like architect, product manager, security engineer, and copywriter.

The `CommandsService` also supports AI-powered command generation — describe what you want, and Synapse spawns a Claude agent that reads existing commands as examples, then generates a new command file following the established structure.

---

## Agent System

Synapse's agent system consists of two defined agents (`.claude/agents/`), 10 skills (`.claude/skills/`), and a comprehensive instruction hierarchy (`agent/`).

**Master orchestrator:** Plans task decomposition, dispatches workers, monitors progress, compiles reports. Enforced constraint: never writes project source code (validated by a PreToolUse hook that checks every Edit/Write call). Skills: p-track, worker-protocol, master-protocol, failure-protocol.

**Swarm worker:** Implements a single task and reports progress through dashboard files. Validated by a PostToolUse hook on Write calls. Skills: worker-protocol.

**Worker instruction modes:** Two modes — FULL (8 mandatory writes, 15+ fields, deviation tracking, PKI annotations, sibling communication) and LITE (5 mandatory writes, streamlined schema). The master selects the mode per-task based on complexity.

**Skills that spawn orchestrators** (p-track, p, master-plan-track, p-track-resume, eager-dispatch) use `context: fork` and `model: opus` — they need their own agent thread and the strongest model. Protocol skills (master-protocol, worker-protocol, failure-protocol) are auto-loaded when agents operate in their respective roles.

---

## Summary

Synapse is a native desktop control plane for AI agent swarms. It gives the developer the ability to decompose, parallelize, monitor, and steer complex multi-agent execution from a single application that includes a live swarm dashboard, streaming chat interface, code explorer, git manager, live preview, and visual swarm builder.

It preserves and optimizes context through a tiered strategy — Glob/Grep for discovery, CLAUDE.md for conventions, PKI for deep operational knowledge, and right-sized task decomposition that keeps every agent focused. It recovers from failures automatically through repair tasks, circuit breaker replanning, and double-failure escalation. It keeps the developer in the loop at every decision point while automating everything that doesn't require human judgment.

The core thesis is simple: the future of AI-assisted development is not one agent doing everything. It is many agents doing focused things in parallel, coordinated by a system that understands dependencies, manages context, recovers from failures, and keeps the human in control. Synapse is that system.
