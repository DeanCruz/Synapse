# Creating Custom Commands

Synapse's command system is extensible. You can create project-specific commands that are automatically discovered and available alongside Synapse's built-in commands.

---

## Where to Put Custom Commands

Custom commands live in the target project's `_commands/` directory:

```
{project_root}/_commands/{command_name}.md
```

These are resolved at the lowest priority in the command hierarchy:

1. `{tracker_root}/_commands/Synapse/` -- Synapse swarm commands (highest priority)
2. `{tracker_root}/_commands/project/` -- Synapse project commands
3. `{project_root}/_commands/` -- **Your custom commands** (lowest priority)

If your custom command has the same name as a built-in Synapse command, the built-in command takes precedence.

---

## Command File Structure

A command file is a Markdown document that serves as a complete specification. The agent reads the entire file and follows it step by step. There is no special schema or parser -- the agent interprets natural language instructions.

### Recommended Structure

```markdown
# `!{command_name}` -- Short Description

**Purpose:** One or two sentences explaining what this command does.

**Syntax:**
\`\`\`
!{command_name} [arguments]
\`\`\`

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

- **Serial mode** -- The agent executes steps sequentially. Best for read-only analysis, quick checks, and simple operations.
- **Parallel mode** -- The agent enters swarm dispatch mode. Best for operations that can be decomposed into independent subtasks.

Most custom commands run in serial mode.

### Include Rules

Rules define constraints the agent must follow. Common rules:

- "Do not modify any files" -- for read-only commands
- "Run in serial mode" -- no swarm dispatch needed
- "Do not output actual secret values" -- for security-sensitive commands

---

## Examples

### Simple Read-Only Command

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

### Command with Arguments

```markdown
# `!find_usage {symbol}` -- Find All Usages of a Symbol

**Purpose:** Find every file that imports or references a specific
symbol (function, type, constant, etc.) across the project.

**Syntax:** `!find_usage {symbol}`

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

---

## Duplicate Detection

When creating a new command, Synapse automatically checks for duplicates before creating the file:

1. Searches all command locations: `{tracker_root}/_commands/Synapse/`, `{tracker_root}/_commands/project/`, and `{project_root}/_commands/`
2. If a command with the same name exists, alerts you with a summary of the existing command
3. Asks whether to overwrite, rename, or cancel

This prevents accidentally overwriting existing commands.

---

## Best Practices

1. **One command, one purpose.** Keep commands focused on a single operation. If a command does too many things, split it into multiple commands.

2. **Read-only by default.** Most commands should not modify files. If a command does modify files, make this explicit in the purpose and rules.

3. **Include examples.** Show the user what the command looks like in practice with example invocations and sample output.

4. **Handle edge cases.** What happens if the target file does not exist? If there are no results? If the project has no tests? Define behavior for common failure cases.

5. **Test your command.** Run it a few times after creating it. Iterate on the instructions until the output is consistently what you expect.

6. **Use descriptive names.** `!audit_api` is better than `!check`. Names should hint at what the command does.

7. **Document arguments.** If your command accepts arguments, list them with descriptions and show examples of each usage pattern.

---

## Command Discovery

Custom commands are automatically discoverable. Running `!commands` scans all `_commands/` directories and lists every available command, including your custom ones, grouped by source location.
