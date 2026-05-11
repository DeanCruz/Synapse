# Project Setup

This guide walks through connecting Synapse to a new project, from initial pointing to full initialization with knowledge graph generation.

---

## Quick Start

For users who want to get started immediately in the Electron app:

1. Start Synapse with `npm start` or open the packaged app.
2. Switch to **Code** mode.
3. Click the sidebar **+** button and choose the project folder. Synapse creates a new hex-ID dashboard and binds it to that folder.
4. Use the dashboard action bar **Project** button to adjust the project path, add context directories, pick the agent provider, set the default model, and configure permission behavior.
5. Launch a swarm from the UI or run `!p_track "Implement feature X"` in the connected agent session.

CLI fallback:

```bash
!project set /path/to/your/project
!initialize --skip-learn   # optional if you want project metadata without a full PKI scan
!p_track "Implement feature X"
```

For a more detailed setup, follow the sections below.

---

## Step 1: Bind a Dashboard to a Project

In the current Electron-first workflow, project selection is per dashboard:

- **Code sidebar + button:** creates a new dashboard after a folder picker selection, then stores that project path for the dashboard.
- **Dashboard action bar Project button:** opens `ProjectModal` for the active dashboard. Use it to change the project path, add additional context directories, select Claude Code or Codex as the worker provider, set a default model, choose a CLI path, and configure interactive/bypass permissions.
- **Chat projects:** creating a Chat project opens project setup before the chat project tab is created.

Dashboard IDs are dynamically generated 6-character hex strings. Synapse no longer pre-creates fixed numbered dashboard slots for normal Electron use.

The selected dashboard's project path drives:

- Code Explorer file tree, editor, search, debug, and problems panels
- Git Manager repository discovery and active repo tabs
- Preview dev-server detection and inline edit mapping
- Worker `{project_root}` in swarm dispatch prompts

## CLI Fallback: Set the Target Project

Tell Synapse which project you want to work on.

### Option A: Store a Persistent Path

```bash
!project set /Users/dean/repos/my-app
```

This writes to `{tracker_root}/.synapse/project.json`:

```json
{
  "current_project": "/Users/dean/repos/my-app",
  "set_at": "2026-03-22T10:00:00Z"
}
```

The stored path persists across sessions. All subsequent commands will use this project unless overridden.

### Option B: Use the Current Directory

If you are already working inside the project directory, Synapse auto-detects it as `{project_root}`. No `!project set` needed.

### Option C: Per-Command Override

Pass `--project` to any command for a one-off target:

```bash
!p_track --project /Users/dean/repos/other-app "Add search feature"
```

### Verifying the Project

Run `!project` (with no arguments) to see the current configuration:

```
!project
```

Output:

```
## Current Project

| Property        | Value                              |
|-----------------|-------------------------------------|
| Path            | /Users/dean/repos/my-app           |
| Resolved via    | Stored config (.synapse/project.json) |
| CLAUDE.md       | Found                              |
| .synapse/       | Not found (run !initialize)        |
| Tech Stack      | TypeScript, Next.js, PostgreSQL    |
```

### Clearing the Stored Project

```bash
!project clear
```

After clearing, `{project_root}` will resolve from CWD.

---

## Step 2: Initialize Project Metadata

The `!initialize` command remains useful for CLI workflows and for bootstrapping project metadata:

```bash
!initialize
```

### What `!initialize` Does

The initialization runs through 8 steps:

#### 1. Verify Prerequisites
- Confirms Synapse installation exists at `{tracker_root}`
- Confirms the project root exists and is a valid directory

#### 2. Detect Tech Stack
Scans the project for technology indicators:

| File / Directory | Indicates |
|---|---|
| `package.json` | Node.js project |
| `tsconfig.json` | TypeScript |
| `next.config.*` | Next.js |
| `vite.config.*` | Vite |
| `requirements.txt` / `pyproject.toml` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pubspec.yaml` | Dart/Flutter |
| `.git/` | Git repository |
| `Dockerfile` | Docker |

Also detects monorepo patterns (npm workspaces, pnpm, Lerna, Nx, Turborepo, Cargo workspaces, Go workspaces).

#### 3. Create `.synapse/` Directory

Creates the metadata directory inside the project:

```
{project_root}/.synapse/
├── config.json     # Project-Synapse configuration
└── knowledge/      # Project knowledge graph (created by !learn)
```

The `config.json` file links the project to Synapse:

```json
{
  "project_name": "my-app",
  "project_root": "/Users/dean/repos/my-app",
  "tracker_root": "/Users/dean/tools/Synapse",
  "tech_stack": ["typescript", "next.js", "postgresql"],
  "initialized_at": "2026-03-22T10:00:00Z",
  "knowledge_path": ".synapse/knowledge/",
  "monorepo": null
}
```

For monorepo projects, the `monorepo` field contains workspace details:

```json
{
  "monorepo": {
    "type": "pnpm",
    "packages": [
      { "name": "@myorg/api", "path": "packages/api", "description": "REST API server" },
      { "name": "@myorg/web", "path": "packages/web", "description": "Next.js frontend" },
      { "name": "@myorg/shared", "path": "packages/shared", "description": "Shared types" }
    ]
  }
}
```

#### 4. Scaffold CLAUDE.md (if missing)

If the project does not have a `CLAUDE.md`, a starter template is created based on the detected tech stack. This includes sections for Purpose, Tech Stack, Architecture, Conventions, File Structure, and Commands.

**Synapse never overwrites an existing `CLAUDE.md`.**

Use `--skip-claude` to skip this step.

#### 5. Generate Project Knowledge Graph

Dispatches a parallel agent swarm to scan every significant file and produce a comprehensive `.synapse/knowledge/` graph. This is the most time-consuming step.

Use `--skip-learn` to skip this step and run `!learn` later.

#### 6. Verify Synapse Data Directories

Ensures `{tracker_root}/dashboards/`, `{tracker_root}/tasks/`, `{tracker_root}/history/`, and related data directories exist. Dashboard directories are created dynamically as hex-ID dashboards in the Electron app or by commands that need a dashboard.

#### 7. Report Next Steps

Reports what was initialized and how to continue. In the Electron-first workflow, open the app and bind a dashboard to the project through the Code sidebar or Project modal. The browser/server path via `!start` is available as an advanced standalone mode.

#### 8. Final Report

Displays a summary of everything that was done.

### Initialization Flags

```bash
!initialize                  # Full initialization
!initialize --skip-learn     # Skip knowledge graph generation
!initialize --skip-claude    # Skip CLAUDE.md scaffolding
```

### Re-running `!initialize`

The command is idempotent. Running it again will:
- Skip creating directories and files that already exist
- Warn that `.synapse/` is already present
- Never overwrite existing `CLAUDE.md` or populated `.synapse/knowledge/` content

---

## Step 3: Review and Expand CLAUDE.md

If `!initialize` scaffolded a `CLAUDE.md`, review it and fill in the TODO sections:

- **Purpose** -- What the project does and who it serves
- **Architecture** -- Patterns, layers, data flow, key design decisions
- **Conventions** -- Naming conventions, file organization, coding standards

A thorough `CLAUDE.md` directly improves swarm quality. The master agent reads it before planning, and relevant excerpts are included in every worker's prompt.

See [Conventions](./conventions.md) for detailed guidance on writing effective project documentation.

---

## Step 4: Generate the Project Knowledge Graph

If you skipped knowledge graph generation during initialization:

```bash
!learn
```

This dispatches a parallel agent swarm to scan significant files in the project and produce a semantic graph at `{project_root}/.synapse/knowledge/`.

See [Project Knowledge Graph](./toc-system.md) for details on generation, searching, and maintenance.

---

## Step 5: Bootstrap the Project Knowledge Index (Optional)

For deep codebase understanding, bootstrap the PKI:

```bash
!learn
```

This dispatches a parallel swarm that reads every source file and produces structured annotations (gotchas, patterns, conventions) at `{project_root}/.synapse/knowledge/`. The PKI enables the master agent to inject relevant knowledge into worker prompts during planning.

After bootstrapping, the PKI auto-maintains itself:
- Workers mark annotations stale when they modify annotated files
- Run `!learn_update` periodically to re-scan stale and new files

See [PKI Overview](./pki-overview.md) for full details.

---

## Step 6: Start Using Synapse

With the project connected, you can now use any Synapse command:

```bash
# Start a parallel agent swarm
!p_track "Implement user authentication with JWT"

# Analyze the project
!context "How does the auth flow work?"
!health
!scope "What would be affected by changing the User model?"

# Query the knowledge graph
!context "auth middleware"

# Review code
!review src/services/AuthService.ts
```

---

## Project-Specific Commands

Projects can define their own commands at `{project_root}/_commands/`. These are checked after Synapse's own commands in the resolution hierarchy:

```
1. {tracker_root}/_commands/Synapse/{command}.md     ← Synapse commands (highest)
2. {tracker_root}/_commands/project/{command}.md     ← Synapse project commands
3. {project_root}/_commands/{command}.md             ← Project-specific commands
```

To create a project command, add a markdown file to `{project_root}/_commands/`:

```bash
mkdir -p {project_root}/_commands
# Create {project_root}/_commands/deploy.md
# Create {project_root}/_commands/test.md
```

Each command file is a complete specification that Synapse follows exactly when the user types `!{command}`.

---

## Disconnecting a Project

To stop working on a project and switch to another:

```bash
# Clear the stored project path
!project clear

# Set a new project
!project set /path/to/other/project
```

The `.synapse/` directory remains in the previous project and can be reused if you return to it later.

---

## Troubleshooting

### "Project root not found"

The resolved `{project_root}` does not exist. Check:
- Is the path spelled correctly?
- Is the drive/volume mounted?

### "No CLAUDE.md found"

Not an error -- Synapse works without it. But having one significantly improves swarm quality. Run `!initialize` or `!scaffold` to create a starter template.

### ".synapse/ already exists"

Previous initialization detected. This is safe -- `!initialize` skips existing files. Use `--force` to reinitialize from scratch.

### Dashboard shows empty after project change

Dashboards have their own project binding. Changing the CLI fallback path with `!project set` does not automatically rebind existing Electron dashboards. Use the active dashboard's Project button to update that dashboard's project path.

---

## Key Source Files

| File | Purpose |
|---|---|
| `_commands/Synapse/project.md` | `!project` command specification |
| `_commands/project/initialize.md` | `!initialize` command specification |
| `_commands/project/scaffold.md` | `!scaffold` command specification |
