# !scaffold — Generate CLAUDE.md for a Child Repository

## Overview

Scans a child repository's structure, detects its tech stack, reads its documentation, and generates a comprehensive `CLAUDE.md` file tailored to that repo. Designed to bootstrap repos that lack agent instructions so the master agent and worker agents can operate effectively.

---

## Usage

```
!scaffold {repo_name}           ← Generate CLAUDE.md for a specific repo
!scaffold {repo_name} --force   ← Overwrite existing CLAUDE.md (requires confirmation)
!scaffold --all                 ← Scaffold all repos missing CLAUDE.md
```

---

## Execution Steps

### Step 1: Validate Target

1. Resolve `{repo_name}` to `{parent_directory}/{repo_name}/`
2. Confirm the directory exists
3. If a `CLAUDE.md` already exists and `--force` is not set, abort:
   ```
   ✓ {repo_name}/CLAUDE.md already exists. Use --force to overwrite.
   ```
4. If `--force` is set and a `CLAUDE.md` exists, confirm with the user before proceeding

### Step 2: Detect Tech Stack

Scan the repo root for configuration files and infer the stack:

| File | Inference |
|---|---|
| `package.json` | Node.js — read `name`, `description`, `dependencies`, `devDependencies`, `scripts` |
| `tsconfig.json` | TypeScript — read `compilerOptions` for target/module |
| `next.config.js` or `next.config.ts` | Next.js |
| `firebase.json` or `firebaserc` | Firebase |
| `requirements.txt` or `pyproject.toml` | Python — read for key packages |
| `go.mod` | Go — read module name |
| `Cargo.toml` | Rust — read package info |
| `pom.xml` or `build.gradle` | Java/Kotlin |
| `Dockerfile` | Containerized |
| `.env.example` | Has environment configuration |

Read the most relevant config file(s) to extract: project name, description, key dependencies, and scripts.

### Step 3: Scan Directory Structure

List all top-level directories and key files:

```bash
ls -la {parent_directory}/{repo_name}/
```

For source directories (commonly `src/`, `app/`, `lib/`, `functions/`), scan one level deeper to understand the internal organization:

```bash
ls {parent_directory}/{repo_name}/src/
```

Build a directory map with brief inferences about each directory's purpose based on naming conventions.

### Step 4: Read Existing Documentation

Check for and read (if present):
- `README.md` — project overview, setup instructions
- `CONTRIBUTING.md` — conventions, workflow
- `docs/` directory — any architectural docs
- `.env.example` — required configuration
- Any `_commands/` directory — repo-specific commands

Extract key facts: purpose, setup steps, important conventions, architecture patterns.

### Step 5: Generate CLAUDE.md

Assemble the CLAUDE.md from everything discovered. The file must follow this structure:

```markdown
# {repo_name}

> {One-line purpose — from package.json description, README first line, or inferred from structure}

## Tech Stack

{Bulleted list of technologies detected, with versions where available}
- **Language:** {TypeScript/Python/Go/etc.}
- **Framework:** {Next.js/Express/Django/etc.}
- **Database:** {Firestore/PostgreSQL/etc. — inferred from dependencies}
- **Key Libraries:** {3-5 most important dependencies}

## Architecture

{2-4 paragraphs describing the architecture. Inferred from:}
- Directory structure patterns (e.g., "follows feature-based organization")
- Framework conventions (e.g., "Next.js App Router with server components")
- Key abstractions visible from directory names (e.g., services/, hooks/, components/)
- Data flow patterns (e.g., "API routes in src/app/api/ call services in src/services/")

## File Structure

```
{repo_name}/
├── src/                    ← {description}
│   ├── components/         ← {description}
│   ├── services/           ← {description}
│   └── ...
├── package.json
└── ...
```

## Conventions

{Inferred from existing code patterns, or marked as TODO:}
- **Naming:** {file naming conventions observed}
- **Imports:** {import patterns, path aliases}
- **State Management:** {if detectable}
- **Error Handling:** {if detectable}
- **Testing:** {test framework and patterns if tests exist}

## Commands

{From _commands/ directory if present:}
| Command | Description |
|---|---|
| `!{cmd}` | {description} |

{Or: "No repo-specific commands defined."}

## Cross-Repo Relationships

{Inferred from imports, API calls, shared types — or marked as TODO:}
- TODO: Document how this repo interacts with sibling repos

## Environment

{From .env.example if present:}
Required environment variables:
- `{VAR_NAME}` — {purpose if inferable}

{Or: "No .env.example found. TODO: Document required environment variables."}
```

### Step 6: Write and Report

1. Write the generated file to `{parent_directory}/{repo_name}/CLAUDE.md`
2. Report what was generated:

```
## Scaffolded: {repo_name}/CLAUDE.md

- **Stack detected:** {technologies}
- **Directories scanned:** {N}
- **Docs found:** {README.md, .env.example, etc.}
- **TODO sections:** {N} (need manual review)

Review the generated file and fill in TODO sections with
repo-specific knowledge that can't be auto-detected.
```

---

## For `--all` Mode

1. Scan `{parent_directory}` for all child repos (same discovery logic as `!initialize` Step 2)
2. Filter to repos WITHOUT a `CLAUDE.md`
3. Run Steps 2-6 for each, in sequence (scaffolding is fast enough that parallel dispatch is unnecessary)
4. Report a summary table:

```
## Scaffold Summary

| Repo | Stack | TODOs | Status |
|---|---|---|---|
| {repo} | TypeScript, Next.js | 3 | ✓ Created |
| {repo} | Python, Flask | 4 | ✓ Created |

Created CLAUDE.md for {N} repos. Review TODO sections in each.
```

---

## Rules

- **Never overwrite an existing CLAUDE.md without --force.** Existing files represent manual work by the user. Respect it.
- **Mark unknowns as TODO.** Don't guess at architecture or conventions that can't be inferred from the filesystem. A TODO is better than a wrong assumption.
- **Read only structure and config files.** Don't deep-read source code — that's what `!toc_generate` is for. Scaffold reads: config files, READMEs, directory listings, and command files. Nothing else.
- **Generated files are starting points.** Make this clear in the output. The user must review and expand them.
- **Run in serial mode.**
