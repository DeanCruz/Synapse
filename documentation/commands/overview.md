# Command System

Synapse uses a `!{command}` invocation system to expose a rich set of operations for swarm orchestration, project management, monitoring, and analysis. Commands are defined as Markdown specification files stored in `_commands/` directories. When a user types `!{command}`, Synapse locates the corresponding `.md` file, reads it in full, and follows its instructions exactly.

---

## Command Resolution Hierarchy

Commands are resolved in a strict priority order. The first match wins:

| Priority | Location | Scope |
|----------|----------|-------|
| 1 (highest) | `{tracker_root}/_commands/Synapse/{command}.md` | Synapse swarm and orchestration commands |
| 2 | `{tracker_root}/_commands/project/{command}.md` | Project analysis and management commands |
| 3 (lowest) | `{project_root}/_commands/{command}.md` | Project-specific custom commands |

**Resolution rules:**

1. Check Synapse swarm commands first. These handle core orchestration (`!p_track`, `!status`, `!dispatch`, etc.) and always take precedence.
2. Check Synapse project commands second. These handle project analysis and management (`!context`, `!review`, `!health`, etc.).
3. Check the target project last. Projects may define their own commands at `{project_root}/_commands/` for project-specific workflows.
4. If a command is not found in any location, the agent reports that `!{command}` does not exist and lists available commands from all discovered locations.
5. Once found, the command file is read in full and followed exactly. Command files are complete specifications -- the agent does not improvise, skip steps, or partially execute.

---

## Path Placeholders

Two path placeholders appear throughout command files:

| Placeholder | Meaning |
|-------------|---------|
| `{tracker_root}` | Absolute path to the Synapse repository |
| `{project_root}` | Absolute path to the target project being worked on |

These are always absolute paths. Workers receive both in their dispatch prompts so they can write code in `{project_root}` and report progress to `{tracker_root}`.

### Resolving `{project_root}`

When any command needs the target project path, it is resolved in this order:

1. **Explicit `--project /path` flag** on the command
2. **Stored config** at `{tracker_root}/.synapse/project.json` (set via `!project set /path`)
3. **Current working directory** of the agent

---

## Command Categories

Synapse commands are organized into several functional groups:

### Swarm Lifecycle Commands

Located at `{tracker_root}/_commands/Synapse/`. These commands manage the full lifecycle of parallel agent swarms -- from planning and dispatch through monitoring and completion. See [Swarm Commands](swarm-commands.md) for full documentation.

Key commands: `!p_track`, `!p`, `!master_plan_track`, `!dispatch`, `!eager_dispatch`, `!add_task`, `!retry`, `!resume`, `!track_resume`, `!p_track_resume`, `!cancel`, `!cancel-safe`

### Monitoring Commands

Also located at `{tracker_root}/_commands/Synapse/`. These commands provide visibility into active and past swarms. See [Swarm Commands](swarm-commands.md) for full documentation.

Key commands: `!status`, `!logs`, `!inspect`, `!deps`, `!history`, `!update_dashboard`, `!export`

### Server Control Commands

Located at `{tracker_root}/_commands/Synapse/`. Control the dashboard server and Electron app.

Key commands: `!start`, `!stop`, `!reset`

### Project Management Commands

Located at `{tracker_root}/_commands/Synapse/`. Manage the target project that Synapse operates on.

Key commands: `!project`

### Project Analysis Commands

Located at `{tracker_root}/_commands/project/`. These commands analyze, audit, and index the target project without modifying any files. See [Project Commands](project-commands.md) for full documentation.

Key commands: `!context`, `!review`, `!health`, `!scope`, `!trace`, `!contracts`, `!env_check`, `!plan`

### Project Setup Commands

Also located at `{tracker_root}/_commands/project/`. Initialize and configure Synapse for a project.

Key commands: `!initialize`, `!onboard`, `!scaffold`, `!create_claude`

### Table of Contents Commands

Located at `{tracker_root}/_commands/project/`. Manage the project's semantic file index.

Key commands: `!toc`, `!toc_generate`, `!toc_update`

### Project Knowledge Index (PKI) Commands

Located at `{tracker_root}/_commands/project/`. Bootstrap and maintain the deep operational knowledge layer for the target project.

Key commands: `!learn`, `!learn_update`

### Audit Commands

Located at `{tracker_root}/_commands/project/`. Post-swarm analysis and quality assessment.

Key commands: `!prompt_audit`

### Discovery Commands

Located at `{tracker_root}/_commands/project/`. Help users find commands, profiles, and guidance.

Key commands: `!commands`, `!profiles`, `!help`, `!guide`

---

## How Command Files Work

Each command file is a self-contained Markdown specification. It typically includes:

- **Purpose** -- what the command does
- **Syntax** -- how to invoke it, including any flags and arguments
- **Execution Steps** -- a numbered sequence of actions the agent must follow
- **Output Format** -- the exact structure of what the command should display
- **Rules** -- constraints on behavior (e.g., "do not modify any files")

When the agent encounters a `!{command}` invocation, it:

1. Resolves the command file using the hierarchy above
2. Reads the command file in full
3. Follows every step exactly as specified
4. Produces output in the format defined by the command file

Command files are the single source of truth for command behavior. The agent never "remembers" what a command does from a previous invocation -- it reads the file fresh every time.

---

## Dashboard Resolution

Many commands accept an optional `[dashboardId]` argument (e.g., `!status dashboard3`). When no dashboard is specified, commands auto-detect the active dashboard by scanning `dashboard1` through `dashboard5` for one that has an active swarm. The full detection protocol is documented at `{tracker_root}/agent/instructions/dashboard_resolution.md`.

---

## Creating Custom Commands

Projects can define their own commands at `{project_root}/_commands/`. These follow the same Markdown specification format as Synapse's built-in commands and are resolved at the lowest priority in the hierarchy. See [Creating Commands](creating-commands.md) for a guide on writing custom commands.

---

## Quick Reference

| Category | Commands |
|----------|----------|
| **Swarm Lifecycle** | `!p_track`, `!p`, `!master_plan_track`, `!dispatch`, `!eager_dispatch`, `!add_task`, `!retry`, `!resume`, `!track_resume`, `!p_track_resume`, `!cancel`, `!cancel-safe` |
| **Monitoring** | `!status`, `!logs`, `!inspect`, `!deps`, `!history`, `!update_dashboard`, `!export` |
| **Server** | `!start`, `!stop`, `!reset` |
| **Project Mgmt** | `!project` |
| **Setup** | `!initialize`, `!onboard`, `!scaffold`, `!create_claude` |
| **Analysis** | `!context`, `!review`, `!health`, `!scope`, `!trace`, `!contracts`, `!env_check`, `!plan` |
| **PKI** | `!learn`, `!learn_update` |
| **TOC** | `!toc`, `!toc_generate`, `!toc_update` |
| **Audit** | `!prompt_audit` |
| **Discovery** | `!commands`, `!profiles`, `!help`, `!guide` |
