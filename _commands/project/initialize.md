# !initialize — Initialize Synapse for a Project

## Overview

Sets up Synapse for use with a target project. Detects the project's tech stack, creates the `.synapse/` metadata directory in the project root, optionally scaffolds a `CLAUDE.md`, initializes the dashboard infrastructure, and validates the setup.

Run this **once** when connecting Synapse to a new project.

---

## Usage

```
!initialize                  <- Full initialization
!initialize --skip-toc       <- Skip TOC generation (useful if you want to do that separately)
!initialize --skip-claude    <- Skip CLAUDE.md scaffolding even if missing
```

---

## Execution Steps

### Step 1: Verify Prerequisites

Check that the required structure is in place.

#### 1a. Confirm Synapse exists

Verify `{tracker_root}/CLAUDE.md` exists (the Synapse installation).

If missing, abort:

```
X Synapse installation not found.

Expected Synapse at: {tracker_root}/
Ensure Synapse is properly installed and try again.
```

#### 1b. Confirm project root

Verify `{project_root}` exists and is a valid directory.

If missing, abort:

```
X Project root not found at: {project_root}

Provide a valid project directory and try again.
```

**Output on success:**

```
OK Prerequisites verified
  OK Synapse installation found
  OK Project root found: {project_root}
```

---

### Step 2: Detect Project Tech Stack

Scan `{project_root}` for indicators of the project's technology:

| File/Directory | Indicates |
|---|---|
| `package.json` | Node.js project (read `name`, `description`, `dependencies`) |
| `tsconfig.json` | TypeScript |
| `next.config.*` | Next.js |
| `vite.config.*` | Vite |
| `requirements.txt` / `pyproject.toml` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pubspec.yaml` | Dart/Flutter |
| `.git/` | Git repository |
| `Dockerfile` / `docker-compose.*` | Docker |
| `firebase.json` | Firebase |

Also scan for:
- Has `CLAUDE.md` already
- Has `_commands/` directory
- Has `.synapse/` directory (already initialized)

If `.synapse/` already exists, warn:

```
Warning: This project has already been initialized (.synapse/ exists).
Re-running will not overwrite existing files. Use --force to reinitialize.
```

**Output:**

```
## Project Detection

| Property | Value |
|---|---|
| Name | {from package.json or directory name} |
| Path | {project_root} |
| Git | Yes/No |
| CLAUDE.md | Found / Missing |
| Tech Stack | {detected technologies} |
| Framework | {detected framework} |
```

---

### Step 3: Create `.synapse/` Directory

Create the Synapse metadata directory inside the project:

```
{project_root}/.synapse/
├── toc.md              <- Table of Contents (created empty or via !toc_generate)
└── config.json         <- Project-Synapse configuration
```

#### config.json

Write the configuration file linking this project to Synapse:

```json
{
  "project_name": "{detected_name}",
  "project_root": "{project_root}",
  "tracker_root": "{tracker_root}",
  "tech_stack": ["{detected_tech1}", "{detected_tech2}"],
  "initialized_at": "{ISO_timestamp}",
  "toc_path": ".synapse/toc.md"
}
```

**Output:**

```
OK Created .synapse/ directory
  OK config.json written
  OK toc.md placeholder created
```

---

### Step 4: Audit and Scaffold CLAUDE.md

Check if `{project_root}/CLAUDE.md` exists.

- **If it exists:** Report it and move on.
- **If it does NOT exist and `--skip-claude` is NOT set:** Scaffold a starter `CLAUDE.md` based on the detected tech stack:

```markdown
# {project_name}

## Purpose
{Brief description — sourced from package.json description, README.md first paragraph, or "TODO: Add purpose"}

## Tech Stack
{Detected from package.json/tsconfig/requirements.txt/go.mod}

## Architecture
TODO: Describe the architecture, patterns, and layers

## Conventions
TODO: Define naming conventions, file organization rules, and coding standards

## File Structure
{Auto-generated from `ls` of top-level directories}

## Commands
{List from _commands/ if present, otherwise "No project-specific commands"}
```

- **If it does NOT exist and `--skip-claude` IS set:**
  ```
  Warning: No CLAUDE.md found. Skipping scaffolding (--skip-claude).
  Run `!initialize` without --skip-claude later to create one.
  ```

**Important:** Never overwrite an existing CLAUDE.md. Scaffolding only creates new files.

**Output:**

```
### CLAUDE.md

OK CLAUDE.md found (or: Created starter CLAUDE.md — review and expand)
```

---

### Step 5: Generate Table of Contents

Check for `{project_root}/.synapse/toc.md`:

- **If it's empty/placeholder and `--skip-toc` is NOT set:**
  ```
  Generating project Table of Contents...
  ```
  Execute `!toc_generate` (this dispatches a parallel agent swarm — it is the most time-consuming step).

- **If `--skip-toc` IS set:**
  ```
  Warning: Skipping TOC generation (--skip-toc).
  Run !toc_generate later to create the project index.
  ```

---

### Step 6: Initialize Dashboard Infrastructure

Verify and create the Synapse dashboard directory structure. The dashboard needs 5 dashboard slots, each with its own `initialization.json`, `logs.json`, and `progress/` directory.

**Check and create if missing:**

```
{tracker_root}/dashboards/
├── dashboard1/
│   ├── initialization.json    <- { "task": null, "agents": [], "waves": [], "chains": [], "history": [] }
│   ├── logs.json              <- { "entries": [] }
│   └── progress/              <- empty directory
├── dashboard2/
│   └── ...
├── dashboard3/
│   └── ...
├── dashboard4/
│   └── ...
└── dashboard5/
    └── ...
```

For each dashboard slot (1-5):
1. Create `{tracker_root}/dashboards/dashboard{N}/` if it doesn't exist
2. Create `initialization.json` with empty state if it doesn't exist
3. Create `logs.json` with empty entries if it doesn't exist
4. Create `progress/` directory if it doesn't exist

Also verify:
- `{tracker_root}/tasks/` directory exists (create if not)
- `{tracker_root}/history/` directory exists (create if not)

**Output:**

```
### Dashboard Infrastructure

OK All 5 dashboard slots initialized
OK tasks/ directory ready
OK history/ directory ready
```

---

### Step 7: Start Dashboard Server

Execute `!start` to launch the Synapse dashboard:

1. Check if already running on port 3456
2. If not, start with `node {tracker_root}/src/server/index.js &`
3. Open in browser

**Output:**

```
### Dashboard

OK Dashboard server running at http://localhost:3456
```

If the server fails to start, report the error but don't abort — the rest of the setup is still usable without the dashboard.

---

### Step 8: Final Report

Compile and present a summary of everything that was done:

```
## Initialization Complete

### Project: {project_name}

| Check | Status |
|---|---|
| Synapse | OK Ready |
| Project Root | OK {project_root} |
| Tech Stack | {detected stack} |
| .synapse/ | OK Created |
| CLAUDE.md | {OK Found / OK Scaffolded / Warning Skipped} |
| Table of Contents | {OK Generated / Warning Skipped} |
| Dashboard (5 slots) | OK Initialized |
| Dashboard Server | {OK Running / Warning Not started} |

### Next Steps

1. **Review CLAUDE.md** — {If scaffolded: "A starter template was created. Open it and fill in the TODO sections."}
2. **Run `!commands`** — See all available commands.
3. **Try `!p_track {task}`** — Dispatch your first parallel agent swarm.
4. **Run `!toc_generate`** — {Only if --skip-toc was used: "Generate the project index."}

### Quick Reference

| Command | What It Does |
|---|---|
| `!p_track {task}` | Dispatch a parallel agent swarm with live dashboard |
| `!toc {query}` | Search the project index |
| `!toc_update` | Update the project index incrementally |
| `!env_check` | Environment variable audit |
| `!commands` | List all available commands |
```

---

## Error Handling

| Error | Action |
|---|---|
| Synapse not found | Abort with instructions to install |
| Project root not found | Abort with instructions |
| .synapse/ already exists | Warn but continue (idempotent) |
| !toc_generate fails | Log warning, continue without TOC |
| Dashboard server fails to start | Log warning, continue |

The initialization should complete even if individual steps have warnings. Only abort for prerequisite failures (Steps 1a-1b).

---

## Rules

- **This command modifies the filesystem.** It creates directories, scaffolds files, and starts services. Every modification is reported to the user.
- **Idempotent where possible.** Running `!initialize` twice should not break anything — it should detect existing state and skip already-completed steps.
- **Never overwrite existing CLAUDE.md files.** Scaffolding only creates new files for projects that have none.
- **Never overwrite existing .synapse/toc.md.** If it exists with content, skip TOC generation unless the user explicitly asks.
- **Run in serial mode** except for Step 5 (TOC generation), which delegates to `!toc_generate` and its swarm.
- **Be transparent.** Every action taken (file created, directory made, service started) must be reported.
