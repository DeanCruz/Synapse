# !initialize — First-Time Workspace Setup

## Overview

Sets up a new workspace for first-time use with the Synapse multi-repo orchestration system. Verifies prerequisites, discovers child repositories, audits CLAUDE.md coverage, generates the workspace index, initializes the dashboard, and validates the workspace.

Run this **once** after cloning Synapse into a parent directory and moving the `parent/` contents up one level.

---

## Usage

```
!initialize              ← Full first-time setup
!initialize --skip-toc   ← Skip TOC generation (useful if you want to do that separately)
```

---

## Prerequisites

Before running `!initialize`, the user must have:

1. **Cloned/copied Synapse/** into their parent directory
2. **Moved `Synapse/parent/*` up one level** so the parent directory now contains:
   - `CLAUDE.md` (master agent instructions)
   - `_commands/` (workspace-level commands, including this file)

If these files haven't been moved yet, the command will detect this and provide instructions.

---

## Execution Steps

### Step 1: Verify Workspace Prerequisites

Check that the required workspace structure is in place. Run these checks in order:

#### 1a. Check for Synapse

```
{parent_directory}/Synapse/CLAUDE.md
```

If missing, abort:

```
✗ Synapse not found.

The Synapse directory must exist at:
  {parent_directory}/Synapse/

Clone or copy it into this directory and try again.
```

#### 1b. Check for parent CLAUDE.md

```
{parent_directory}/CLAUDE.md
```

If missing, check if `{parent_directory}/Synapse/parent/CLAUDE.md` exists:
- **If parent/ exists:** Offer to move the contents automatically:
  ```
  ⚠ Parent CLAUDE.md not found at workspace root.

  Found: Synapse/parent/CLAUDE.md

  Moving parent files to workspace root...
    → CLAUDE.md
    → _commands/
  ```
  Copy `Synapse/parent/CLAUDE.md` → `{parent_directory}/CLAUDE.md`
  Copy `Synapse/parent/_commands/` → `{parent_directory}/_commands/`

- **If parent/ also missing:** Abort with instructions:
  ```
  ✗ Parent CLAUDE.md not found.

  Expected at: {parent_directory}/CLAUDE.md

  This file should have been moved from Synapse/parent/CLAUDE.md.
  If you don't have Synapse/parent/, your Synapse installation
  may be incomplete. Re-download and try again.
  ```

#### 1c. Check for parent _commands/

```
{parent_directory}/_commands/
```

Apply the same logic as 1b — check, offer to move from `Synapse/parent/_commands/`, or abort.

#### 1d. Verify initialize command is present

Confirm `{parent_directory}/_commands/initialize.md` exists (this file). If the user is running `!initialize` successfully, this is already true — but verify as a sanity check.

**Output on success:**

```
✓ Prerequisites verified
  ✓ Synapse/CLAUDE.md found
  ✓ Parent CLAUDE.md found
  ✓ Parent _commands/ found ({N} commands)
```

---

### Step 2: Discover Child Repositories

Scan `{parent_directory}` for all directories that could be child repositories.

**Skip these directories** (not child repos):
- `Synapse/`
- `_commands/`
- `agent/`
- `archive/`
- `node_modules/`
- `.git/`
- Any directory starting with `.`

**For each potential child repo, detect:**
- Directory name
- Has `.git/` → is a git repo
- Has `CLAUDE.md` → has agent instructions
- Has `_commands/` → has repo-specific commands
- Has `package.json` → Node.js project (read name and description)
- Has `tsconfig.json` → TypeScript project
- Has `requirements.txt` or `pyproject.toml` → Python project
- Has `go.mod` → Go project
- Has `Cargo.toml` → Rust project

**Output:**

```
## Discovered Repositories

Found {N} child repositories:

| Repo | Git | CLAUDE.md | Commands | Stack |
|---|---|---|---|---|
| my-frontend | ✓ | ✓ | 3 commands | TypeScript, Next.js |
| my-backend | ✓ | ✓ | 2 commands | TypeScript, Express |
| my-new-repo | ✓ | ✗ MISSING | — | Python |
```

---

### Step 3: Audit and Scaffold CLAUDE.md Files

For every child repo that **does NOT** have a `CLAUDE.md`, the master agent should:

1. **Flag it clearly** in the output
2. **Offer to scaffold a starter CLAUDE.md** by running `!scaffold {repo_name}` for each

If `!scaffold` command is available, delegate to it. If not, generate a minimal template inline:

```markdown
# {repo_name}

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
{List from _commands/ if present, otherwise "No repo-specific commands"}
```

**Important:** These are starter templates. They give the master agent *something* to work with but should be fleshed out by the user or by running `!scaffold` later.

**Output:**

```
### CLAUDE.md Coverage

✓ {N} repos have CLAUDE.md
✗ {M} repos are missing CLAUDE.md

{For each missing:}
  ✗ {repo_name} — Created starter CLAUDE.md (review and expand)
```

If all repos already have `CLAUDE.md`:

```
### CLAUDE.md Coverage

✓ All {N} repos have CLAUDE.md — no scaffolding needed
```

---

### Step 4: Generate Table of Contents

Check for `{parent_directory}/TableOfContentsMaster.md`:

- **If it doesn't exist and `--skip-toc` is NOT set:**
  ```
  No TableOfContentsMaster.md found. Generating workspace index...
  ```
  Execute `!toc_generate` (this dispatches a parallel agent swarm — it is the most time-consuming step).

- **If it doesn't exist and `--skip-toc` IS set:**
  ```
  ⚠ No TableOfContentsMaster.md found. Skipping generation (--skip-toc).
    Run !toc_generate later to create the workspace index.
  ```

- **If it already exists:**
  ```
  ✓ TableOfContentsMaster.md exists (last updated: {date from file})
    Run !toc_generate to rebuild, or !toc_update for incremental updates.
  ```

---

### Step 5: Initialize Dashboard Infrastructure

Verify and create the Synapse dashboard directory structure. The dashboard needs 5 dashboard slots, each with its own `initialization.json`, `logs.json`, and `progress/` directory.

**Check and create if missing:**

```
Synapse/dashboards/
├── dashboard1/
│   ├── initialization.json    ← { "task": null, "agents": [], "waves": [], "chains": [], "history": [] }
│   ├── logs.json              ← { "entries": [] }
│   └── progress/              ← empty directory
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

✓ All 5 dashboard slots initialized
✓ tasks/ directory ready
✓ history/ directory ready
```

---

### Step 6: Start Dashboard Server

Execute `!start` to launch the Synapse dashboard:

1. Check if already running on port 3456
2. If not, start with `node {tracker_root}/src/server/index.js &`
3. Open in browser

**Output:**

```
### Dashboard

✓ Dashboard server running at http://localhost:3456
```

If the server fails to start, report the error but don't abort — the rest of the workspace is still usable without the dashboard.

---

### Step 7: Quick Health Check

Run `!health --quick` to validate the workspace. This checks:
- Documentation health (CLAUDE.md coverage, TOC consistency)
- Dependency health (node_modules, lock files)
- Git status across repos

Report any issues found, but don't block on warnings — they're informational for the user.

---

### Step 8: Final Report

Compile and present a summary of everything that was done:

```
## Initialization Complete

### Workspace: {parent_directory_name}

| Check | Status |
|---|---|
| Synapse | ✓ Ready |
| Parent CLAUDE.md | ✓ Found |
| Parent Commands | ✓ {N} commands |
| Child Repos | ✓ {N} discovered |
| CLAUDE.md Coverage | {✓ All covered / ⚠ {M} scaffolded} |
| Table of Contents | {✓ Generated / ⚠ Skipped / ✓ Exists} |
| Dashboard (5 slots) | ✓ Initialized |
| Dashboard Server | {✓ Running / ⚠ Not started} |
| Health Check | {✓ Healthy / ⚠ Warnings} |

### Repositories

| Repo | CLAUDE.md | Stack | Status |
|---|---|---|---|
| {repo} | ✓ | {stack} | Ready |
| {repo} | ⚠ scaffolded | {stack} | Needs review |

### Next Steps

1. **Review scaffolded CLAUDE.md files** — Starter templates were created for
   repos that didn't have one. Open each and fill in the TODO sections.
2. **Run `!onboard`** — Get a full walkthrough of the workspace.
3. **Run `!commands`** — See all available commands.
4. **Try `!p_track {task}`** — Dispatch your first parallel agent swarm.
5. **Run `!toc_generate`** — {Only if --skip-toc was used: "Generate the workspace index."}

### Quick Reference

| Command | What It Does |
|---|---|
| `!p_track {task}` | Dispatch a parallel agent swarm with live dashboard |
| `!context {topic}` | Gather cross-repo context on a topic |
| `!plan {task}` | Plan an implementation before coding |
| `!health` | Full workspace health check |
| `!onboard` | Workspace walkthrough |
| `!toc_update` | Update the workspace index incrementally |
| `!commands` | List all available commands |
```

---

## Error Handling

| Error | Action |
|---|---|
| Synapse not found | Abort with instructions to install |
| Parent CLAUDE.md missing + no parent/ | Abort with instructions |
| Parent CLAUDE.md missing + parent/ exists | Auto-move and continue |
| Child repo scan finds 0 repos | Warn but continue (workspace may be empty) |
| !toc_generate fails | Log warning, continue without TOC |
| Dashboard server fails to start | Log warning, continue |
| !health finds critical issues | Report but don't block |

The initialization should complete even if individual steps have warnings. Only abort for prerequisites failures (Steps 1a-1c).

---

## Rules

- **This command modifies the filesystem.** It creates directories, scaffolds files, and starts services. Every modification is reported to the user.
- **Idempotent where possible.** Running `!initialize` twice should not break anything — it should detect existing state and skip already-completed steps.
- **Never overwrite existing CLAUDE.md files.** Scaffolding only creates new files for repos that have none.
- **Never overwrite existing TableOfContentsMaster.md.** If it exists, skip TOC generation unless the user explicitly asks.
- **Run in serial mode** except for Step 4 (TOC generation), which delegates to `!toc_generate` and its swarm.
- **Be transparent.** Every action taken (file created, directory made, service started) must be reported.
