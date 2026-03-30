# Creating Custom Commands

Synapse's command system is extensible. You can create project-specific commands that are automatically discovered and available alongside Synapse's built-in commands.

---

## Command Hierarchy

Commands are resolved from four locations, listed in priority order:

| Priority | Location | Category | Description |
|---|---|---|---|
| 1 (highest) | `{tracker_root}/_commands/Synapse/` | Swarm commands | Orchestration, dispatch, monitoring, lifecycle |
| 2 | `{tracker_root}/_commands/project/` | Project commands | Analysis, context, scaffolding, TOC, PKI |
| 3 | `{tracker_root}/_commands/profiles/` | Agent profiles | Persona-based behavioral presets (analyst, architect, etc.) |
| 4 (lowest) | `{project_root}/_commands/` | Custom commands | **Your project-specific commands** |

If your custom command has the same name as a built-in Synapse command, the built-in command takes precedence.

---

## Command File Structure

A command file is a Markdown document that serves as a complete specification. The agent reads the entire file and follows it step by step. There is no special schema or parser -- the agent interprets natural language instructions.

### Standard Command Template

Most commands follow this pattern. Simple commands (like `!start`, `!stop`) use it closely; complex commands extend it with additional sections.

```markdown
# `!{command_name} [arguments]` -- Short Description

**Purpose:** One or two sentences explaining what this command does.

**Syntax:**
- `!{command_name}` -- Default invocation
- `!{command_name} --flag` -- With optional flag
- `!{command_name} {argument}` -- With required argument

---

## Steps

### Step 1: {First action}

{Detailed instructions for what the agent should do.}

### Step 2: {Second action}

{More instructions. Be specific -- the agent follows these literally.}

### Step 3: {Output}

{Define the exact output format.}

---

## Rules

- {Constraint 1 -- e.g., "Do not modify any files"}
- {Constraint 2}
- {Constraint 3}
```

### Overview-Style Template

Many project commands (like `!context`, `!create_claude`) use an `## Overview` section instead of `**Purpose:**`, and a `## Usage` block for examples:

```markdown
# !{command_name} -- Short Description

## Overview

{One paragraph describing the command's purpose, context, and when to use it.}

---

## Usage

\`\`\`
!{command_name} arg1
!{command_name} arg2 --flag
\`\`\`

---

## Execution Steps

### Step 1: {Action}

{Instructions...}

---

## Rules

- {Constraint 1}
```

Both styles work. Use whichever fits the complexity of the command.

---

## Common Structural Patterns

Real Synapse commands use several patterns beyond the basic template. These are not mandatory for custom commands, but they demonstrate what works well:

### Flags and Arguments

Commands often accept flags and optional arguments. Document each variant in the **Syntax** section:

```markdown
**Syntax:**
- `!{command_name}` -- Default behavior
- `!{command_name} --force` -- Skip confirmation prompts
- `!{command_name} --update` -- Merge with existing output
- `!{command_name} --dashboard {id}` -- Target a specific dashboard
```

### When to Use Tables

Complex commands include a comparison table showing when to use this command versus related alternatives:

```markdown
## When to Use

| Scenario | Command | Why |
|---|---|---|
| Swarm stalled, master died | `!eager_dispatch` | One-shot dispatch of all ready tasks |
| Full lifecycle recovery | `!p_track_resume` | Includes completion monitoring |
| Single task dispatch | `!dispatch {id}` | For one specific task |
```

### Phased Commands

Large commands (like `!p_track`, `!learn`) are broken into numbered phases, each with multiple steps. Very large commands split phases into separate sub-command files:

```markdown
## Phase 1: Planning

**Steps 1-5:** {Summary of what this phase does.}

> **Read `{tracker_root}/agent/_commands/{command}_planning.md` for the full protocol.**

## Phase 2: Execution

**Steps 6-10:** {Summary of what this phase does.}

> **Read `{tracker_root}/agent/_commands/{command}_execution.md` for the full protocol.**
```

### Output Files

Commands that produce files should document their output paths:

```markdown
**Output files:**
\`\`\`
{tracker_root}/tasks/{date}/{filename}.json      <- Description
{tracker_root}/dashboards/{id}/logs.json          <- Description
\`\`\`
```

### Non-Negotiable Rules

Critical commands (like `!p_track`) front-load mandatory constraints in a blockquote before the main content:

```markdown
> ## NON-NEGOTIABLE RULES -- READ BEFORE ANYTHING ELSE
>
> **1. You are now the MASTER AGENT. You do NOT write code.**
> **2. You MUST read the master instructions before proceeding.**
```

### Dashboard Resolution Notes

Commands that interact with dashboards include a resolution note:

```markdown
> **Dashboard resolution:** Uses your assigned dashboard from the `DASHBOARD ID:` directive.
> Override with `--dashboard {id}`. If neither, ask the user.
> See `{tracker_root}/agent/instructions/dashboard_resolution.md` for the full protocol.
```

---

## Naming Conventions

- **Use underscores** for multi-word command names: `p_track`, `eager_dispatch`, `learn_update`, `toc_generate`
- **Hyphens** are rare and reserved for variants: `cancel-safe` (a variant of `cancel`)
- **Keep names short and descriptive:** `!audit_api` is better than `!check`. Names should hint at what the command does
- **File name matches command name:** The command `!eager_dispatch` lives in `eager_dispatch.md`

---

## Agent Profiles

Profile commands in `{tracker_root}/_commands/profiles/` use a different structure than standard commands. Profiles are persona-based behavioral presets that shape how an agent thinks, prioritizes, and communicates.

### Profile Template

```markdown
# Profile: {Role Name}

## Role

{One paragraph describing the persona, expertise, and thinking style.}

---

## Priorities (Ranked)

1. **{Priority 1}** -- {Description of what this persona values most}
2. **{Priority 2}** -- {Description}
3. **{Priority 3}** -- {Description}

---

## Constraints

- Do NOT {anti-pattern 1}
- Do NOT {anti-pattern 2}
- Do NOT {anti-pattern 3}

---

## Output Style

- **Tone:** {Description of communication style}
- **Format:** {Description of preferred output structures}
- **Length:** {Guidance on output length by deliverable type}

---

## Success Criteria

- {Criterion 1}
- {Criterion 2}

---

## Context Gathering

1. {What to read first}
2. {What to look for}
3. {What background to gather}
```

Profiles are invoked via `!profiles` to list them, and the agent adopts the persona when instructed by the user or master agent.

---

## Writing Effective Commands

### Be Specific

The agent follows instructions literally. Vague instructions produce inconsistent results.

**Too vague:**
> Check the tests and report issues.

**Specific:**
> Run `npm test` in `{project_root}`. Parse the output. Report: total tests, passed, failed, and skipped counts. For each failing test, report the test name, file path, and the assertion error message.

### Define the Output Format

The agent needs to know exactly what to display. Include template output in your command file:

```markdown
### Output Format

\`\`\`
## {Command Name} Results

| Check | Status |
|-------|--------|
| {item} | {pass/fail} |

### Issues Found
- **{file}:{line}** -- {description}
\`\`\`
```

### Use Path Placeholders

Commands should use `{project_root}` and `{tracker_root}` instead of hardcoded paths. These are resolved at runtime:

- `{project_root}` -- The target project directory
- `{tracker_root}` -- The Synapse installation directory

### Specify Execution Mode

Indicate whether the command should run in serial or parallel mode:

- **Serial mode** -- The agent executes steps sequentially. Best for read-only analysis, quick checks, and simple operations. Most custom commands run in serial mode.
- **Parallel mode** -- The agent enters swarm dispatch mode (via `!p` or `!p_track`). Best for operations that decompose into independent subtasks across many files.

### Include Rules

Rules define constraints the agent must follow. Common rules:

- "Do not modify any files" -- for read-only commands
- "Run in serial mode" -- no swarm dispatch needed
- "Do not output actual secret values" -- for security-sensitive commands
- "Make concrete decisions" -- for opinionated generators
- "Scan dynamically" -- for discovery commands that must not use cached data

---

## Examples

### Simple Serial Command

```markdown
# `!check_deps` -- Dependency Freshness Check

**Purpose:** Check for outdated npm dependencies in the project.

**Syntax:** `!check_deps`

---

## Steps

### Step 1: Find package.json

Read `{project_root}/package.json`. If it does not exist, report
"No package.json found" and stop.

### Step 2: Check for outdated packages

Run:
\`\`\`bash
cd {project_root} && npm outdated --json 2>/dev/null
\`\`\`

### Step 3: Report

Display a table of outdated packages with current version, wanted
version, and latest version. Highlight major version jumps.

---

## Rules

- Do not modify any files.
- Do not run `npm update` or `npm install`.
- Run in serial mode.
```

### Command with Arguments and Flags

```markdown
# `!find_usage {symbol}` -- Find All Usages of a Symbol

**Purpose:** Find every file that imports or references a specific
symbol (function, type, constant, etc.) across the project.

**Syntax:**
- `!find_usage {symbol}` -- Search all source files
- `!find_usage {symbol} --imports-only` -- Only show import statements

---

## Steps

### Step 1: Search for the symbol

Use Grep to search for `{symbol}` across all source files in
`{project_root}`. Include both import statements and direct references.

### Step 2: Categorize results

Group results by:
- **Definitions** -- Where the symbol is defined/exported
- **Imports** -- Where the symbol is imported
- **References** -- Where the symbol is used (not import statements)

### Step 3: Report

Display results grouped by category with file paths and line numbers.

---

## Rules

- Do not modify any files.
- Exclude node_modules/, dist/, and .git/ from search.
- Run in serial mode.
```

### Overview-Style Analysis Command

```markdown
# !audit_api -- API Endpoint Audit

## Overview

Scans the project for all HTTP endpoint definitions and reports
inconsistencies in naming, response shapes, error handling, and
authentication requirements. Produces a structured audit report.

---

## Usage

\`\`\`
!audit_api
!audit_api --focus auth
\`\`\`

---

## Execution Steps

### Step 1: Discover endpoints

Grep for route definitions (`app.get`, `router.post`, `@Get`,
`@Post`, etc.) across `{project_root}/src/`.

### Step 2: Analyze consistency

For each endpoint, check:
- Naming convention (RESTful? consistent pluralization?)
- Response shape (consistent `{ success, data, error }` pattern?)
- Error handling (centralized or ad-hoc?)
- Auth middleware applied?

### Step 3: Report

Output a table of all endpoints with consistency scores and
specific issues flagged.

---

## Rules

- Do not modify any files.
- Run in serial mode.
```

---

## Duplicate Detection

When creating a new command, Synapse automatically checks for duplicates before creating the file:

1. Searches all command locations: `{tracker_root}/_commands/Synapse/`, `{tracker_root}/_commands/project/`, `{tracker_root}/_commands/profiles/`, and `{project_root}/_commands/`
2. If a command with the same name exists, alerts you with a summary of the existing command
3. Asks whether to overwrite, rename, or cancel

This prevents accidentally overwriting existing commands.

---

## Best Practices

1. **One command, one purpose.** Keep commands focused on a single operation. If a command does too many things, split it into multiple commands. Large commands can reference sub-command files for individual phases.

2. **Read-only by default.** Most commands should not modify files. If a command does modify files, make this explicit in the purpose and rules.

3. **Include examples.** Show the user what the command looks like in practice with example invocations and sample output.

4. **Handle edge cases.** What happens if the target file does not exist? If there are no results? If the project has no tests? Define behavior for common failure cases.

5. **Test your command.** Run it a few times after creating it. Iterate on the instructions until the output is consistently what you expect.

6. **Use descriptive names.** `!audit_api` is better than `!check`. Use underscores for multi-word names.

7. **Document arguments and flags.** If your command accepts arguments or flags, list every variant in the Syntax section with descriptions.

8. **Include "When to Use" guidance.** For commands that overlap with others, add a comparison table so users pick the right one.

9. **Front-load critical constraints.** If the command has rules that must not be violated (e.g., "the master never reads source files"), put them in a prominent blockquote at the top.

---

## Command Discovery

Custom commands are automatically discoverable. Running `!commands` scans all `_commands/` directories and lists every available command, including your custom ones, grouped by source location. New commands added to any `_commands/` directory appear automatically without registration.
