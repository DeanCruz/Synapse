# !commands — List All Available Commands

## Overview

Discovers and lists every `!` command available across the entire workspace, grouped by source location, with one-line descriptions.

---

## Execution Steps

### Step 1: Scan All Command Directories

Search for all `_commands/` directories across the workspace:

1. `{parent_directory}/Synapse/_commands/`
2. `{parent_directory}/_commands/`
3. `{parent_directory}/{each_child_repo}/_commands/`

List all `.md` files in each directory.

### Step 2: Extract Descriptions

For each command file, read the first few lines to extract:
- The command name (from filename, strip `.md`)
- The one-line description (from the `# !{name}` heading or first sentence of Overview)

### Step 3: Output

```
## Available Commands

### 🔧 Synapse Commands
| Command | Description |
|---|---|
| `!p_track {prompt}` | Plan, dispatch, track, and report a full parallel agent swarm |
| `!status` | Terminal summary of current swarm state |
| `!dispatch` | Manually dispatch pending or unblocked tasks |
| `!retry` | Re-dispatch a failed task |
| `!cancel` | Cancel the active swarm |
| `!start` | Start the dashboard server |
| `!stop` | Stop the dashboard server |
| `!reset` | Clear all tracker data |
| `!logs` | View and filter log entries |
| `!inspect` | Deep-dive into a specific task |
| `!history` | View past swarm history |
| `!deps` | Visualize dependency graph |

### 🌐 Workspace Commands (parent _commands/)
| Command | Description |
|---|---|
| `!generate_toc` | Full rebuild of TableOfContentsMaster.md via agent swarm |
| `!update_toc` | Incremental update of TableOfContentsMaster.md |
| `!context {topic}` | Deep cross-repo context gathering |
| `!trace {target}` | End-to-end trace of endpoint/type/function |
| `!scope {task}` | Blast radius analysis before coding |
| `!plan {task}` | Implementation plan without execution |
| `!review` | Cross-repo code review of recent changes |
| `!migrate {desc}` | Cross-repo migration checklist |
| `!sync_types` | Shared type consistency audit |
| `!env_check` | Environment variable consistency audit |
| `!contracts` | API contract audit |
| `!health` | Workspace health check |
| `!onboard` | Workspace walkthrough for new sessions |
| `!commands` | This list |
| `!help` | Tips on using the master agent effectively |

### 📁 {child_repo} Commands
| Command | Description |
|---|---|
| `!{cmd}` | {description} |
{...for each child repo with _commands/...}
```

**Note:** The table above is a template. The actual output must be generated dynamically by scanning the filesystem — do not hardcode. New commands added to any `_commands/` directory should appear automatically.

---

## Rules

- **Scan dynamically.** Do not rely on a cached list. Always check the filesystem.
- **Group by source.** The user needs to know where commands live for context.
- **One line per command.** Keep descriptions concise.
- **Run in serial mode.** This is instant.
