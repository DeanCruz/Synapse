# !commands — List All Available Commands

## Overview

Discovers and lists every `!` command available for the project and Synapse, grouped by source location, with one-line descriptions.

---

## Execution Steps

### Step 1: Scan All Command Directories

Search for all `_commands/` directories:

1. `{tracker_root}/_commands/` — Synapse core commands
2. `{tracker_root}/_commands/project/` — Project-level commands
3. `{project_root}/_commands/` — Project-specific commands (if any)

List all `.md` files in each directory.

### Step 2: Extract Descriptions

For each command file, read the first few lines to extract:
- The command name (from filename, strip `.md`)
- The one-line description (from the `# !{name}` heading or first sentence of Overview)

### Step 3: Output

```
## Available Commands

### Synapse Commands ({N} commands)
| Command | Description |
|---|---|
| `!p_track {prompt}` | Plan, dispatch, track, and report a full parallel agent swarm |
| `!p {prompt}` | Lightweight parallel dispatch |
| `!master_plan_track {prompt}` | Multi-stream orchestration across dashboards |
| `!add_task {prompt}` | Add tasks to an active swarm mid-flight |
| `!dispatch` | Manually dispatch pending or unblocked tasks |
| `!eager_dispatch` | Full eager dispatch round with complete worker prompts |
| `!retry` | Re-dispatch a failed task |
| `!resume` | Resume a chat session after interruption |
| `!p_track_resume` | Resume a stalled !p_track swarm |
| `!track_resume` | Resume a stalled swarm |
| `!status` | Terminal summary of current swarm state |
| `!logs` | View and filter log entries |
| `!inspect` | Deep-dive into a specific task |
| `!deps` | Visualize dependency graph |
| `!history` | View past swarm history |
| `!update_dashboard` | Generate a visual progress report |
| `!export` | Export swarm state as markdown or JSON |
| `!cancel` | Cancel the active swarm |
| `!cancel-safe` | Graceful shutdown |
| `!start` | Launch the Synapse Electron app |
| `!stop` | Stop the dashboard server |
| `!reset` | Clear dashboard data |
| `!guide` | Command decision tree |
| `!project` | Show, set, or clear target project path |

### Project Commands ({N} commands)
| Command | Description |
|---|---|
| `!initialize` | Initialize Synapse for a project |
| `!onboard` | Project walkthrough |
| `!scaffold` | Generate a CLAUDE.md for a project |
| `!create_claude` | Create or update an opinionated CLAUDE.md |
| `!context {query}` | Deep context gathering |
| `!review` | Code review |
| `!health` | Project health check |
| `!scope {change}` | Blast radius analysis |
| `!trace {endpoint}` | End-to-end code tracing |
| `!contracts` | API contract audit |
| `!env_check` | Environment variable consistency audit |
| `!plan {task}` | Implementation planning |
| `!prompt_audit` | Post-swarm prompt quality audit |
| `!learn` | Bootstrap the Project Knowledge Index |
| `!learn_update` | Incrementally refresh the PKI |
| `!instrument` | Add data-synapse-label attributes for Live Preview |
| `!toc {query}` | Search the project Table of Contents |
| `!toc_generate` | Full rebuild of project TOC via agent swarm |
| `!toc_update` | Incremental update of project TOC |
| `!commands` | This list |
| `!profiles` | List available agent profiles |
| `!help` | Tips on using Synapse effectively |

### Project-Specific Commands ({project_root}/_commands/)
| Command | Description |
|---|---|
| `!{cmd}` | {description} |
{...for each project-specific command found...}
```

**Note:** The table above is a template. The actual output must be generated dynamically by scanning the filesystem — do not hardcode. New commands added to any `_commands/` directory should appear automatically.

---

## Rules

- **Scan dynamically.** Do not rely on a cached list. Always check the filesystem.
- **Group by source.** The user needs to know where commands live for context.
- **One line per command.** Keep descriptions concise.
- **Run in serial mode.** This is instant.
