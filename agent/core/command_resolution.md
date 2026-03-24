# Command Resolution — `!{command}` System

This module defines how Synapse resolves and executes commands typed by the user with the `!` prefix, including the resolution hierarchy across multiple command directories, duplicate detection rules for creating new commands and profiles, and the full command reference table.

---

## Command Resolution

When the user types `!{command}`, locate and execute the corresponding command file. Commands are resolved in this priority order:

### Resolution Order

```
1. {tracker_root}/_commands/Synapse/{command}.md       ← Synapse swarm commands (highest priority)
2. {tracker_root}/_commands/project/{command}.md       ← Synapse project commands
3. {tracker_root}/_commands/user/{command}.md           ← User-created commands (git-ignored, local only)
4. {project_root}/_commands/{command}.md               ← Project-specific commands
```

### Resolution Rules

1. **Check Synapse swarm commands first.** Swarm and dashboard commands (`!p_track`, `!status`, `!dispatch`, etc.) live at `{tracker_root}/_commands/Synapse/`. Always checked first.

2. **Check Synapse project commands second.** Project analysis and management commands (`!context`, `!review`, `!health`, `!toc`, etc.) live at `{tracker_root}/_commands/project/`.

3. **Check user commands third.** User-created commands live at `{tracker_root}/_commands/user/` (and subfolders). This directory is git-ignored so user commands persist locally without interfering with repo updates.

4. **Check the target project last.** Projects may define their own commands at `{project_root}/_commands/`. These allow project-specific workflows and overrides.

5. **If not found anywhere**, inform the user that `!{command}` does not exist and list available commands from all discovered locations.

5. **Once found, read the command file in full and follow it exactly.** Command files are complete specs — do not improvise, skip steps, or partially execute.

---

## Creating New Commands and Profiles — Duplicate Detection

When the user asks to create a new command or profile, the agent **must check for duplicates before creating anything.**

### For Commands

1. Search all command locations: `{tracker_root}/_commands/Synapse/`, `{tracker_root}/_commands/project/`, `{tracker_root}/_commands/user/`, `{project_root}/_commands/`
2. If a command with the same name exists, alert the user, summarize the existing command, and ask whether to overwrite, rename, or cancel
3. If no duplicate exists, proceed with creation

### For Profiles

1. Check `{tracker_root}/_commands/profiles/` for the profile name
2. Same duplicate handling as commands

This duplicate check is **mandatory** — never silently overwrite an existing command or profile.

---

## Commands

When the user types a command prefixed with `!`, resolve it using the command resolution hierarchy and follow it exactly.

### Project Management

| Command | Description |
|---|---|
| `!project` | Show, set, or clear the target project path. |
| `!initialize` | Initialize Synapse for a target project — create `.synapse/`, detect tech stack, optionally scaffold `CLAUDE.md`. |
| `!onboard` | Project walkthrough — read CLAUDE.md, TOC, key files and present a structured orientation. |
| `!scaffold` | Generate a `CLAUDE.md` for a project that doesn't have one. |
| `!create_claude` | Create or update an opinionated `CLAUDE.md` with coding standards, architecture, and styling guidelines. |

### Swarm Lifecycle

| Command | Description |
|---|---|
| `!p_track {prompt}` | **Primary command.** Plan, dispatch, track, and report a full parallel agent swarm with live dashboard updates. |
| `!p {prompt}` | Lightweight parallel dispatch (no dashboard tracking). |
| `!master_plan_track {prompt}` | Multi-stream orchestration — decompose into independent swarms across dashboards. |
| `!dispatch {id}` | Manually dispatch a specific pending task. `!dispatch --ready` dispatches all unblocked tasks. |
| `!retry {id}` | Re-dispatch a failed task with a fresh agent. |
| `!resume` | Resume a chat session after interruption — reviews history and continues where it left off. |
| `!track_resume` | Resume a stalled/interrupted swarm — re-dispatch all incomplete tasks with full context. |
| `!cancel` | Cancel the active swarm. `!cancel --force` skips confirmation. |
| `!cancel-safe` | Graceful shutdown — let running tasks finish, cancel pending. |

### Monitoring

| Command | Description |
|---|---|
| `!status` | Quick terminal summary of current swarm state. |
| `!logs` | View log entries. Supports `--level`, `--task`, `--agent`, `--last`, `--since` filters. |
| `!inspect {id}` | Deep-dive into a specific task — context, dependencies, timeline, logs. |
| `!deps` | Visualize the full dependency graph. `!deps {id}` for a single task. `!deps --critical` for critical path. |
| `!history` | View past swarm history. `!history --last 5` for recent only. |

### Project Analysis

| Command | Description |
|---|---|
| `!context {query}` | Deep context gathering within `{project_root}`. |
| `!review` | Code review of recent changes or specified files. |
| `!health` | Project health check — CLAUDE.md quality, dependency health, TOC consistency. |
| `!scope {change}` | Blast radius analysis — what would be affected by a proposed change. |
| `!trace {endpoint}` | End-to-end code tracing of an endpoint, function, or data flow. |
| `!contracts` | API contract audit — consistency between interfaces and implementations. |
| `!env_check` | Environment variable audit — consistency across configs. |
| `!plan {task}` | Implementation planning based on project context. |

### Table of Contents

| Command | Description |
|---|---|
| `!toc {query}` | Search the project TOC at `{project_root}/.synapse/toc.md`. Supports sub-commands: `depends-on`, `depended-by`, `cluster`, and `changes-since`. |
| `!toc_generate` | Generate a full project TOC via parallel agent swarm. |
| `!toc_update` | Incrementally update the TOC for changed files. |

### Profiles & Discovery

| Command | Description |
|---|---|
| `!profiles` | List all available agent role profiles. |
| `!commands` | List all available commands from all locations. |
| `!help` | Master agent guide — when to use each command. |
| `!guide` | Interactive command decision tree. |

### Server Control

| Command | Description |
|---|---|
| `!start` | Start the dashboard server and open the browser. |
| `!stop` | Stop the dashboard server. |
| `!reset` | Clear all tracker data. `!reset --keep-history` preserves past tasks. |