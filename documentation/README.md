# Synapse Documentation

Synapse is a standalone distributed control system for coordinating autonomous agent swarms. It optimizes context usage, parallelizes execution across multiple AI agents, and provides a centralized control plane with a real-time dashboard for complex software development tasks. Synapse operates on a target project that lives at a separate location -- it does not need to be inside the project it manages.

This documentation covers every aspect of Synapse: its architecture, the server and dashboard UI, the Electron desktop app, the swarm lifecycle, the master/worker agent protocols, the command system, configuration, and more.

---

## Quick Start

New to Synapse? Start here:

- [Architecture Overview](architecture/overview.md) -- Understand how the system is structured
- [Project Setup](project-integration/project-setup.md) -- Point Synapse at your project and get running
- [Swarm Lifecycle Overview](swarm-lifecycle/overview.md) -- Learn the end-to-end flow of a parallel swarm
- [Server Configuration](configuration/server-config.md) -- Configure and start the dashboard server
- [Commands Overview](commands/overview.md) -- Browse all available commands

---

## Suggested Reading Order

For someone new to Synapse, the following order provides a logical progression from high-level concepts to implementation details:

1. **Foundations** -- Start with the system architecture to understand the big picture.
   - [Architecture Overview](architecture/overview.md)
   - [Data Flow](architecture/data-flow.md)
   - [Directory Structure](architecture/directory-structure.md)

2. **Swarm Lifecycle** -- Understand how a parallel swarm runs from start to finish.
   - [Swarm Lifecycle Overview](swarm-lifecycle/overview.md)
   - [Planning Phase](swarm-lifecycle/planning-phase.md)
   - [Dispatch Phase](swarm-lifecycle/dispatch-phase.md)
   - [Monitoring Phase](swarm-lifecycle/monitoring-phase.md)
   - [Completion Phase](swarm-lifecycle/completion-phase.md)
   - [Circuit Breaker](swarm-lifecycle/circuit-breaker.md)

3. **Agent Protocols** -- Learn the rules that govern master and worker agents.
   - [Master Agent Overview](master-agent/overview.md)
   - [Worker Protocol Overview](worker-protocol/overview.md)

4. **Data Architecture** -- Understand the data files that drive the system.
   - [Data Architecture Overview](data-architecture/overview.md)
   - [initialization.json](data-architecture/initialization-json.md)
   - [Progress Files](data-architecture/progress-files.md)

5. **Dashboard and Server** -- Explore the UI and backend that present swarm status.
   - [Dashboard Overview](dashboard/overview.md)
   - [Server Overview](server/overview.md)

6. **Commands and Configuration** -- Master the command system and configuration options.
   - [Commands Overview](commands/overview.md)
   - [Configuration Overview](configuration/overview.md)

7. **Advanced Topics** -- Multi-dashboard orchestration, Electron desktop app, git manager, project integration.
   - [Multi-Dashboard Overview](multi-dashboard/overview.md)
   - [Electron Overview](electron/overview.md)
   - [Git Manager Overview](git-manager/overview.md)
   - [Project Integration Overview](project-integration/overview.md)

---

## Documentation Map

### Architecture

How Synapse is structured, how data flows through the system, and what lives where on disk.

| Document | Description |
|---|---|
| [Overview](architecture/overview.md) | High-level system architecture, component relationships, and design principles |
| [Data Flow](architecture/data-flow.md) | How data moves between master agent, workers, server, and dashboard |
| [Directory Structure](architecture/directory-structure.md) | Complete directory layout of both the Synapse repository and target projects |

### Commands

The `!command` system that drives all Synapse operations, from swarm dispatch to project analysis.

| Document | Description |
|---|---|
| [Overview](commands/overview.md) | Command resolution hierarchy, syntax, and how commands are discovered |
| [Swarm Commands](commands/swarm-commands.md) | All swarm lifecycle commands: `!p_track`, `!p`, `!dispatch`, `!retry`, `!resume`, `!cancel`, and more |
| [Project Commands](commands/project-commands.md) | Project analysis commands: `!context`, `!review`, `!health`, `!scope`, `!trace`, `!contracts`, `!env_check` |
| [Creating Commands](commands/creating-commands.md) | How to create custom commands and profiles, including duplicate detection and file structure |

### Configuration

Server, Electron, and theming configuration options that control Synapse's behavior and appearance.

| Document | Description |
|---|---|
| [Overview](configuration/overview.md) | Configuration layers, precedence rules, and file locations |
| [Server Config](configuration/server-config.md) | PORT, timing constants, MIME types, and server default shapes |
| [Electron Config](configuration/electron-config.md) | Settings API, window persistence, build/packaging, and custom protocol handler |
| [Theming](configuration/theming.md) | CSS design tokens, fonts, glassmorphism patterns, JS color sync, and customization guide |

### Dashboard

The React-based real-time dashboard UI that visualizes swarm progress.

| Document | Description |
|---|---|
| [Overview](dashboard/overview.md) | Dashboard architecture, entry point, component hierarchy, and data flow |
| [Components](dashboard/components.md) | All React components with props, sections, and sub-components |
| [State Management](dashboard/state-management.md) | AppProvider, initial state, all reducer actions, localStorage persistence, and merge cycle |
| [Hooks](dashboard/hooks.md) | useDashboardData, mergeState, useElectronAPI, and utility modules |
| [Styling](dashboard/styling.md) | CSS design system, themes, status colors, animations, layout system, and z-index layers |
| [Layout Modes](dashboard/layout-modes.md) | Waves vs Chains layout, SVG dependency line rendering, BFS pathfinding, and hover interactions |

### Data Architecture

The JSON file formats that store swarm plans, progress, logs, and task records.

| Document | Description |
|---|---|
| [Overview](data-architecture/overview.md) | Design philosophy, data flow model, and how files are merged client-side |
| [initialization.json](data-architecture/initialization-json.md) | Full schema for the static plan store -- task, agents, waves, chains, and history objects |
| [logs.json](data-architecture/logs-json.md) | Log entry schema, log levels, write timing, and dashboard rendering |
| [Progress Files](data-architecture/progress-files.md) | Worker-owned progress file schema, ownership model, stages, lifecycle, and server handling |
| [Task Files](data-architecture/xml-task-files.md) | Task file JSON schema reference, update timing, and real-world examples |

### Electron

The Electron desktop application that wraps the dashboard and provides native OS integration.

| Document | Description |
|---|---|
| [Overview](electron/overview.md) | Electron architecture, process model, data flow, and security model |
| [IPC Reference](electron/ipc-reference.md) | All 12 push channels and 50+ pull request handlers between main and renderer |
| [Services](electron/services.md) | All 8 Electron services with exported methods and responsibilities |
| [Configuration](electron/configuration.md) | Settings system, Vite build config, electron-builder packaging, and `app://` protocol |

### Git Manager

The integrated git UI built into the Synapse Electron app for visual repository management.

| Document | Description |
|---|---|
| [Overview](git-manager/overview.md) | Architecture, component hierarchy, data flow, state management, IPC integration, and security model |
| [Components](git-manager/components.md) | All 12 React components with props, state, key functions, and UI element details |
| [IPC Handlers](git-manager/ipc-handlers.md) | All 28 git-* IPC handlers with channel names, parameters, return values, and security measures |

### Master Agent

The orchestrator role -- how the master agent plans, dispatches, monitors, and reports on swarms.

| Document | Description |
|---|---|
| [Overview](master-agent/overview.md) | Master agent responsibilities, constraints, and the five-phase lifecycle |
| [Planning](master-agent/planning.md) | Deep context gathering, task decomposition, dependency mapping, and prompt construction |
| [Dispatch Protocol](master-agent/dispatch-protocol.md) | Eager dispatch, prompt templates, upstream result feeding, and failure handling |
| [Statusing](master-agent/statusing.md) | Event logging to logs.json, task file updates, terminal output rules, and dashboard coordination |

### Multi-Dashboard

Running up to 5 concurrent swarms across independent dashboard instances.

| Document | Description |
|---|---|
| [Overview](multi-dashboard/overview.md) | Multi-dashboard architecture, slot model, and concurrent swarm support |
| [Dashboard Selection](multi-dashboard/dashboard-selection.md) | Priority chain for selecting a dashboard: system prompt directive, CLI flag, auto-scan |
| [Queue System](multi-dashboard/queue-system.md) | Overflow queue for when all 5 dashboard slots are occupied |
| [Archive & History](multi-dashboard/archive-history.md) | Archiving completed swarms and browsing swarm history |

### Profiles

Agent role profiles that modify the agent's priorities, output style, and persona.

| Document | Description |
|---|---|
| [Overview](profiles/overview.md) | Profile system mechanics, syntax, resolution, and how profiles layer on top of commands |
| [Available Profiles](profiles/available-profiles.md) | All 15 profiles with role descriptions, priorities, output styles, and when to use each |

### Project Integration

How Synapse integrates with any target project -- setup, configuration, TOC system, and conventions.

| Document | Description |
|---|---|
| [Overview](project-integration/overview.md) | Project integration model, path conventions, and the `.synapse/` directory |
| [Project Setup](project-integration/project-setup.md) | Pointing Synapse at a project, initialization, and the `!project` command |
| [TOC System](project-integration/toc-system.md) | Table of Contents generation, search, and incremental updates |
| [Conventions](project-integration/conventions.md) | Writing CLAUDE.md files, project commands, and context gathering priorities |

### Server

The zero-dependency Node.js backend that serves the dashboard and broadcasts real-time updates via SSE.

| Document | Description |
|---|---|
| [Overview](server/overview.md) | Server architecture, startup flow, and zero-dependency design |
| [Services](server/services.md) | All 6 server services with exported methods and responsibilities |
| [API Reference](server/api-reference.md) | All REST endpoints with request/response schemas |
| [SSE Events](server/sse-events.md) | All Server-Sent Events with payloads, triggers, and client handling |
| [Configuration](server/configuration.md) | Port configuration, timing constants, MIME types, and utility functions |

### Swarm Lifecycle

The end-to-end lifecycle of a parallel agent swarm, from planning through completion.

| Document | Description |
|---|---|
| [Overview](swarm-lifecycle/overview.md) | End-to-end lifecycle with flow diagrams and data flow summary |
| [Planning Phase](swarm-lifecycle/planning-phase.md) | Context gathering, task decomposition, shared file patterns, layout selection, and dashboard population |
| [Dispatch Phase](swarm-lifecycle/dispatch-phase.md) | Eager dispatch protocol, prompt construction, failure handling, and upstream results |
| [Monitoring Phase](swarm-lifecycle/monitoring-phase.md) | Progress file watching, SSE broadcasting, deviation handling, and log patterns |
| [Completion Phase](swarm-lifecycle/completion-phase.md) | Final report, verification agents, archiving, and partial completion handling |
| [Circuit Breaker](swarm-lifecycle/circuit-breaker.md) | Trigger conditions, automatic replanning flow, fallback behavior, and worked examples |

### Worker Protocol

How worker agents report progress, handle deviations, and consume upstream results.

| Document | Description |
|---|---|
| [Overview](worker-protocol/overview.md) | Worker lifecycle, responsibilities, rules, return format, and the EXPORTS field |
| [Progress Reporting](worker-protocol/progress-reporting.md) | Full progress file schema, fixed stages, mandatory writes, log formats, and lifecycle examples |
| [Deviations](worker-protocol/deviations.md) | Severity levels (CRITICAL/MODERATE/MINOR), entry format, common scenarios, and ambiguity handling |
| [Upstream Results](worker-protocol/upstream-results.md) | Four-step protocol for reading, extracting, adapting to, and logging upstream dependency results |

---

## Section Summaries

| Section | Summary |
|---|---|
| **Architecture** | System-level overview of how Synapse is structured, how data flows between components, and what the directory layout looks like on disk. |
| **Commands** | The `!command` system including resolution hierarchy, all swarm lifecycle commands, project analysis commands, and how to create custom commands. |
| **Configuration** | All configuration surfaces: server constants, Electron settings and packaging, and the CSS/JS theming system. |
| **Dashboard** | The React dashboard UI covering component architecture, state management with reducers, custom hooks, the CSS design system, and Waves/Chains layout modes. |
| **Data Architecture** | The four data file formats that drive Synapse: `initialization.json` (static plan), `logs.json` (event log), worker progress files (live lifecycle), and task files (authoritative record). |
| **Electron** | The desktop application layer including the main/renderer process model, all IPC channels, the 8 service modules, and build/packaging configuration. |
| **Git Manager** | The integrated git UI for visual repository management, covering 12 React components, 28 IPC handlers, multi-repo support, staging/unstaging, diffs, commits, branches, history with SVG graph, and remote operations. |
| **Master Agent** | The orchestrator role and its five responsibilities: context gathering, planning, dispatch, statusing, and reporting -- plus the constraints that prevent it from writing code. |
| **Multi-Dashboard** | Running up to 5 concurrent swarms across independent dashboard slots, including dashboard selection logic, the overflow queue, and archive/history management. |
| **Profiles** | The profile modifier system that layers role-specific priorities, output styles, and personas on top of any command or prompt. |
| **Project Integration** | How Synapse connects to any target project, including the `!project` command, `.synapse/` directory, TOC generation, and CLAUDE.md conventions. |
| **Server** | The zero-dependency Node.js backend that serves static files, exposes REST endpoints, and broadcasts real-time updates via Server-Sent Events. |
| **Swarm Lifecycle** | The complete journey of a parallel swarm from planning through completion, including eager dispatch, monitoring, circuit breaker automatic replanning, and final reporting. |
| **Worker Protocol** | How worker agents operate: writing progress files, transitioning through stages, reporting deviations with severity levels, and consuming upstream task results. |
