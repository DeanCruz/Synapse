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

### Synapse Commands
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

### Project Commands
| Command | Description |
|---|---|
| `!toc {query}` | Search the project Table of Contents |
| `!toc_generate` | Full rebuild of project TOC via agent swarm |
| `!toc_update` | Incremental update of project TOC |
| `!env_check` | Environment variable consistency audit |
| `!initialize` | Initialize Synapse for a project |
| `!commands` | This list |
| `!help` | Tips on using Synapse effectively |
| `!profiles` | List available agent profiles |

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
