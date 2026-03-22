# Project Integration Overview

Synapse is a **standalone, project-agnostic** distributed control system. It does not need to live inside any target project. It coordinates agent swarms from its own location (`{tracker_root}`) while workers do their code work in the target project (`{project_root}`). This separation means Synapse can manage any project regardless of language, framework, or directory structure.

---

## Core Architecture

### Two-Path System

Every operation in Synapse revolves around two distinct paths:

| Placeholder | Meaning | Example |
|---|---|---|
| `{tracker_root}` | Absolute path to the Synapse repository | `/Users/dean/tools/Synapse` |
| `{project_root}` | Absolute path to the target project being worked on | `/Users/dean/repos/my-app` |

These paths are always absolute. Workers receive **both** in their dispatch prompts:
- Workers write code in `{project_root}`
- Workers report progress to `{tracker_root}/dashboards/{dashboardId}/progress/`

### What Lives Where

**At `{tracker_root}` (Synapse's home):**
- Dashboard data (`dashboards/`, `queue/`, `Archive/`, `history/`)
- Task records (`tasks/`)
- Agent instructions (`agent/instructions/`)
- Commands (`_commands/`)
- Server and UI (`src/`)
- Synapse configuration (`.synapse/project.json`)

**At `{project_root}` (the target project):**
- The project's own source code
- `.synapse/` metadata directory (TOC, config)
- `CLAUDE.md` (project conventions)
- `_commands/` (optional project-specific commands)

### No Hardcoded Paths

Synapse contains zero hardcoded paths. Every path reference uses the `{tracker_root}` and `{project_root}` placeholders, which are resolved at runtime. This makes Synapse fully portable -- it works from any location on any machine.

---

## How Integration Works

### Step 1: Point Synapse at Your Project

Tell Synapse which project to work on using one of three methods:

```bash
# Method 1: Store a persistent project path
!project set /path/to/your/project

# Method 2: Pass --project to individual commands
!p_track --project /path/to/your/project "Implement auth flow"

# Method 3: Run from within the project directory (auto-detected as CWD)
cd /path/to/your/project
# Synapse uses CWD as {project_root}
```

### Step 2: Synapse Reads Project Context

When a swarm starts, the master agent reads:
1. `{project_root}/CLAUDE.md` for conventions, architecture, and patterns
2. `{project_root}/.synapse/toc.md` (if it exists) for file discovery
3. Source files via Glob/Grep for task-specific context

### Step 3: Workers Execute in the Project

Each worker receives both paths in its dispatch prompt and knows to:
- Read and write code in `{project_root}`
- Report progress to `{tracker_root}/dashboards/{dashboardId}/progress/`

### Step 4: All Synapse Data Stays at `{tracker_root}`

Nothing except the `.synapse/` metadata directory is written to `{project_root}`. Dashboards, task records, logs, archives, and history all live at `{tracker_root}`.

---

## Project Root Resolution

When any Synapse command needs `{project_root}`, it resolves in this priority order:

```
1. Explicit --project /path flag     ← Highest priority
2. Stored config (.synapse/project.json at {tracker_root})
3. Current working directory (CWD)   ← Fallback
```

### Priority 1: Explicit Flag

Any command can accept a `--project` flag:

```
!p_track --project /Users/dean/repos/api-server "Add pagination"
!context --project /Users/dean/repos/frontend "Explore auth flow"
```

This is useful for one-off commands targeting a different project than the stored default.

### Priority 2: Stored Config

The `!project set` command writes the target path to `{tracker_root}/.synapse/project.json`:

```json
{
  "current_project": "/Users/dean/repos/my-app",
  "set_at": "2026-03-22T10:00:00Z"
}
```

This persists across sessions. Use `!project clear` to remove it.

### Priority 3: Current Working Directory

If no explicit flag or stored config exists, Synapse uses the agent's current working directory as `{project_root}`. This is convenient when running Synapse commands from within the project directory.

### Validation

When resolving `{project_root}`, Synapse warns (but does not block) if:
- The directory has no `.git/` directory
- The directory has no recognizable project markers (`package.json`, `CLAUDE.md`, `src/`, etc.)
- The directory appears to be empty or a home directory

---

## What Synapse Creates in Your Project

Synapse writes only one directory into your project:

```
{project_root}/
└── .synapse/              # Add to .gitignore
    ├── toc.md             # Project Table of Contents (semantic file index)
    └── config.json        # Project-Synapse configuration
```

### `.synapse/config.json`

Links the project to Synapse with detected metadata:

```json
{
  "project_name": "my-app",
  "project_root": "/Users/dean/repos/my-app",
  "tracker_root": "/Users/dean/tools/Synapse",
  "tech_stack": ["typescript", "next.js", "postgresql"],
  "initialized_at": "2026-03-22T10:00:00Z",
  "toc_path": ".synapse/toc.md",
  "monorepo": null
}
```

### `.synapse/toc.md`

A semantic index of every significant file in the project. Generated by `!toc_generate` and incrementally updated by `!toc_update`. See [TOC System](./toc-system.md) for details.

### Recommendation: Add to `.gitignore`

The `.synapse/` directory is Synapse-specific metadata that should not be committed to version control:

```gitignore
# Synapse metadata
.synapse/
```

---

## Multi-Project Support

Synapse supports working on multiple projects simultaneously through its multi-dashboard system. Each of the 5 dashboard slots can serve a different project.

When a swarm starts, the resolved `{project_root}` is stored in `initialization.json` at `task.project_root`. This field tells the dashboard and commands which project each swarm belongs to.

**Example: Three swarms across two projects**

| Dashboard | Project | Task |
|---|---|---|
| dashboard1 | `/Users/dean/repos/frontend` | Refactor components |
| dashboard2 | `/Users/dean/repos/frontend` | Add dark mode |
| dashboard3 | `/Users/dean/repos/api` | Database migration |

To switch between projects:
- Use `!project set` to change the default
- Use `--project` flags for one-off commands
- Each swarm's dashboard shows which project it targets

---

## Portability

Synapse is designed to be fully portable:

- **Zero npm dependencies** for the server -- works with any Node.js installation
- **No hardcoded paths** -- all paths use `{tracker_root}` and `{project_root}` placeholders
- **No project-specific assumptions** -- works with monorepos, single projects, or any layout
- **Works offline** -- no external API calls, no CDN dependencies
- **Self-contained commands** -- each `_commands/*.md` file is a complete spec

---

## Related Documentation

- [Project Setup](./project-setup.md) -- Step-by-step initialization guide
- [TOC System](./toc-system.md) -- Table of Contents generation and management
- [Conventions](./conventions.md) -- CLAUDE.md and .synapse/ directory conventions
- [Multi-Dashboard Overview](../multi-dashboard/overview.md) -- Running multiple concurrent swarms

---

## Key Source Files

| File | Purpose |
|---|---|
| `_commands/Synapse/project.md` | `!project` command specification |
| `_commands/project/initialize.md` | `!initialize` command specification |
| `.synapse/project.json` (at `{tracker_root}`) | Stored project configuration |
