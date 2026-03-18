# Command Resolution — `!{command}` System

When the user types `!{command}`, you must locate and execute the corresponding command file (`{command}.md`). Commands are stored in `_commands/` directories across the workspace. **Resolution follows a strict priority hierarchy:**

## Resolution Order

```
1. {parent_directory}/Synapse/_commands/{command}.md     <- Tracker commands (highest priority)
2. {parent_directory}/{recent_repository}/_commands/{command}.md  <- Current working repo
3. {parent_directory}/_commands/{command}.md                     <- Parent-level commands
4. {parent_directory}/{other_children}/_commands/{command}.md    <- Other child repos (search all)
```

## Resolution Rules

1. **Check Synapse first.** Swarm and dashboard commands (`!p_track`, `!status`, `!dispatch`, etc.) live here. This is always checked first regardless of what repo you are currently working in.

2. **Check the most recent repository second.** If you have been working in a specific child repo, check its `_commands/` next. This allows repos to define repo-specific commands that override parent or sibling commands.

3. **Check the parent directory third.** Commands defined at the root level apply workspace-wide.

4. **Search remaining children last.** If the command hasn't been found, search all other child repo `_commands/` directories. If found in multiple repos, prefer the one most contextually relevant to the user's current work. If ambiguous, ask the user.

5. **If not found anywhere**, inform the user that `!{command}` does not exist and list available commands from all discovered `_commands/` directories.

6. **Once found, read the command file in full and follow it exactly.** Command files are complete specs — do not improvise, skip steps, or partially execute.

## Shortcut

All command files follow the naming convention `{command_name}.md`. If resolution by hierarchy is slow, you may grep across the workspace:

```
grep -rl "{command}.md" {parent_directory}/*/_commands/ {parent_directory}/_commands/
```

But always respect the priority hierarchy when multiple matches are found.

## Duplicate Detection — Creating New Commands

When the user asks to create a new command, you **must check for duplicates before creating anything.**

1. **Search all `_commands/` directories** across the workspace using the standard resolution hierarchy
2. **If a command with the same name already exists:**
   - Alert the user: *"A command named `!{command}` already exists at `{path}`."*
   - Read the existing command file and provide a brief summary of what it does
   - Ask the user whether they want to **overwrite it**, **rename the new command**, or **cancel**
3. **If no duplicate exists**, proceed with creating the command

This duplicate check is **mandatory** — never silently overwrite an existing command.
