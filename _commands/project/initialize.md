# !initialize — Initialize Synapse for a Project

## Overview

Sets up Synapse for use with a target project. Detects the project's tech stack, creates the `.synapse/` metadata directory (including the PKI `knowledge/` directory) in the project root, optionally scaffolds a `CLAUDE.md`, initializes the dashboard infrastructure, and validates the setup.

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

#### Monorepo Detection

After detecting the base tech stack, check for monorepo/workspace patterns:

| File/Pattern | Indicates | Workspace root field |
|---|---|---|
| `package.json` with `"workspaces"` field | npm/Yarn workspaces | `workspaces` array (glob patterns) |
| `pnpm-workspace.yaml` | pnpm workspaces | `packages` array (glob patterns) |
| `lerna.json` | Lerna monorepo | `packages` array |
| `nx.json` | Nx monorepo | Detect via `workspace.json` or `project.json` files |
| `turbo.json` | Turborepo | Uses npm/pnpm/yarn workspaces underneath |
| `Cargo.toml` with `[workspace]` | Cargo workspace | `members` array |
| `go.work` | Go workspace | `use` directives |

For each detected pattern:
1. Read the config file to extract the workspace/package list.
2. Resolve glob patterns (e.g., `"packages/*"`) against the filesystem to get actual package directories.
3. For each discovered package/workspace, read its own `package.json` (or `Cargo.toml`, `go.mod`) to get its name and description.

Report in the detection output:

| Property | Value |
|---|---|
| Monorepo | Yes — {type} (e.g., "npm workspaces", "pnpm", "Cargo workspace") |
| Packages | {N} packages detected |

List each package:
| Package | Path | Description |
|---|---|---|
| @myorg/api | packages/api | REST API server |
| @myorg/web | packages/web | Next.js frontend |
| @myorg/shared | packages/shared | Shared types and utilities |

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
├── config.json         <- Project-Synapse configuration
└── knowledge/          <- PKI directory (populated by !learn)
    ├── annotations/    <- Per-file deep knowledge (created empty)
    └── queries/        <- Pre-computed domain bundles (created empty)
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
  "toc_path": ".synapse/toc.md",
  "pki_path": ".synapse/knowledge/",
  "monorepo": {
    "type": "npm_workspaces | pnpm | lerna | nx | turbo | cargo | go",
    "packages": [
      {
        "name": "@myorg/api",
        "path": "packages/api",
        "description": "REST API server"
      }
    ]
  }
}
```

If the project is NOT a monorepo, the `monorepo` field should be `null` (not omitted, explicitly `null`).

**Output:**

```
OK Created .synapse/ directory
  OK config.json written
  OK toc.md placeholder created
  OK knowledge/ directory created (run !learn to populate)
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

If a monorepo was detected in Step 2, pass the workspace information to `!toc_generate` via the `.synapse/config.json` file. The TOC generation agents should organize file entries by package:

```markdown
## @myorg/api (packages/api/)
{files in this package}

## @myorg/web (packages/web/)
{files in this package}

## @myorg/shared (packages/shared/)
{files in this package}

## Root-level files
{files not in any package}
```

This organization makes it much easier to navigate large monorepos compared to a flat directory listing.

---

### Step 6: Initialize Dashboard Infrastructure

Verify and create the Synapse directory structure. Dashboards are created **dynamically on demand** — they use 6-character hex IDs generated by `nextDashboardId()` (e.g., `a3f7k2`, `0a0ae5`). There are no fixed "slots." The Electron app and server create dashboards as needed when chat views open or swarms start.

**Check and create if missing:**

```
{tracker_root}/dashboards/          <- Created if missing; dashboards added dynamically
{tracker_root}/Archive/             <- Archived dashboard snapshots
{tracker_root}/history/             <- History summary JSON files
{tracker_root}/queue/               <- Overflow queue for master_plan_track
{tracker_root}/tasks/               <- Per-swarm task + plan files
{tracker_root}/conversations/       <- Chat conversation JSON files
```

Each dashboard directory (created on demand) follows this structure:

```
{tracker_root}/dashboards/{hex_id}/
├── initialization.json    <- { "task": null, "agents": [], "waves": [], "chains": [], "history": [] }
├── logs.json              <- { "entries": [] }
└── progress/              <- Worker progress files ({task_id}.json)
```

If no dashboards exist at all, a single fallback `dashboard1` is created by the server/Electron startup to ensure the system is functional. All subsequent dashboards are created dynamically with hex IDs.

The reserved `ide` dashboard is auto-created by the Electron app for IDE chat views — it cannot be deleted and is never used by swarm agents.

**Initialization steps:**
1. Create `{tracker_root}/dashboards/` directory if it doesn't exist
2. Create `{tracker_root}/Archive/` directory if it doesn't exist
3. Create `{tracker_root}/history/` directory if it doesn't exist
4. Create `{tracker_root}/queue/` directory if it doesn't exist
5. Create `{tracker_root}/tasks/` directory if it doesn't exist
6. Create `{tracker_root}/conversations/` directory if it doesn't exist

**Output:**

```
### Dashboard Infrastructure

OK dashboards/ directory ready (dashboards created dynamically)
OK Archive/ directory ready
OK tasks/ directory ready
OK history/ directory ready
OK queue/ directory ready
OK conversations/ directory ready
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

OK Dashboard server running (Synapse Electron app)
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
| .synapse/knowledge/ | OK Created (empty — run !learn to populate) |
| CLAUDE.md | {OK Found / OK Scaffolded / Warning Skipped} |
| Table of Contents | {OK Generated / Warning Skipped} |
| Dashboard Infrastructure | OK Ready (dashboards created dynamically) |
| Dashboard Server | {OK Running / Warning Not started} |

### Next Steps

1. **Review CLAUDE.md** — {If scaffolded: "A starter template was created. Open it and fill in the TODO sections."}
2. **Run `!learn`** — Bootstrap the Project Knowledge Index (PKI). This gives Synapse deep understanding of your codebase for better planning and worker prompts.
3. **Run `!commands`** — See all available commands.
4. **Try `!p_track {task}`** — Dispatch your first parallel agent swarm.
5. **Run `!toc_generate`** — {Only if --skip-toc was used: "Generate the project index."}

### Quick Reference

| Command | What It Does |
|---|---|
| `!p_track {task}` | Dispatch a parallel agent swarm with live dashboard |
| `!learn` | Bootstrap the PKI (deep codebase knowledge) |
| `!learn_update` | Incrementally refresh the PKI (stale/new files) |
| `!toc {query}` | Search the project index |
| `!toc_update` | Update the project index incrementally |
| `!context {query}` | Deep context gathering (uses PKI) |
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
