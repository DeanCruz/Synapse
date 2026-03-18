# !scaffold — Generate CLAUDE.md for a Project

## Overview

Scans the project's structure, detects its tech stack, reads its documentation, and generates a comprehensive `CLAUDE.md` file. Designed to bootstrap projects that lack agent instructions so the master agent and worker agents can operate effectively.

---

## Usage

```
!scaffold                  <- Generate CLAUDE.md for the project at {project_root}
!scaffold --force          <- Overwrite existing CLAUDE.md (requires confirmation)
```

---

## Execution Steps

### Step 1: Validate Target

1. Resolve the project directory to `{project_root}/`
2. Confirm the directory exists
3. If a `CLAUDE.md` already exists and `--force` is not set, abort:
   ```
   CLAUDE.md already exists at {project_root}/CLAUDE.md. Use --force to overwrite.
   ```
4. If `--force` is set and a `CLAUDE.md` exists, confirm with the user before proceeding

### Step 2: Detect Tech Stack

Scan the project root for configuration files and infer the stack:

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
ls -la {project_root}/
```

For source directories (commonly `src/`, `app/`, `lib/`, `functions/`), scan one level deeper to understand the internal organization:

```bash
ls {project_root}/src/
```

Build a directory map with brief inferences about each directory's purpose based on naming conventions.

### Step 4: Read Existing Documentation

Check for and read (if present):
- `README.md` — project overview, setup instructions
- `CONTRIBUTING.md` — conventions, workflow
- `docs/` directory — any architectural docs
- `.env.example` — required configuration
- Any `_commands/` directory — project-specific commands

Extract key facts: purpose, setup steps, important conventions, architecture patterns.

### Step 5: Generate CLAUDE.md

Assemble the CLAUDE.md from everything discovered. The file must follow this structure:

```markdown
# {project_name}

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
{project_name}/
├── src/                    <- {description}
│   ├── components/         <- {description}
│   ├── services/           <- {description}
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

{Or: "No project-specific commands defined."}

## Environment

{From .env.example if present:}
Required environment variables:
- `{VAR_NAME}` — {purpose if inferable}

{Or: "No .env.example found. TODO: Document required environment variables."}
```

### Step 6: Write and Report

1. Write the generated file to `{project_root}/CLAUDE.md`
2. Report what was generated:

```
## Scaffolded: CLAUDE.md

- **Stack detected:** {technologies}
- **Directories scanned:** {N}
- **Docs found:** {README.md, .env.example, etc.}
- **TODO sections:** {N} (need manual review)

Review the generated file and fill in TODO sections with
project-specific knowledge that can't be auto-detected.
```

---

## Rules

- **Never overwrite an existing CLAUDE.md without --force.** Existing files represent manual work by the user. Respect it.
- **Mark unknowns as TODO.** Don't guess at architecture or conventions that can't be inferred from the filesystem. A TODO is better than a wrong assumption.
- **Read only structure and config files.** Don't deep-read source code. Scaffold reads: config files, READMEs, directory listings, and command files. Nothing else.
- **Generated files are starting points.** Make this clear in the output. The user must review and expand them.
- **Run in serial mode.**
