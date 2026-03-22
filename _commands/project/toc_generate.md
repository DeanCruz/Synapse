# `!toc_generate`

**Purpose:** Generate a complete `toc.md` from scratch by dispatching parallel agents to scan every directory across the project. Use this after major restructuring or when the TOC is severely out of date. This is the slow, thorough option — for incremental updates, use `!toc_update` instead.

**Syntax:** `!toc_generate`

**Produces:** A fully rebuilt `{project_root}/.synapse/toc.md`

---

## Phase 1: Discovery

### Step 1: Scan project structure

List the project root to discover all top-level directories:

```
ls {project_root}/
```

Identify:
- **Source directories** — `src/`, `lib/`, `app/`, `pages/`, `components/`, etc.
- **Configuration directories** — `config/`, `.github/`, etc.
- **Documentation directories** — `docs/`, etc.
- **Command directories** — `_commands/`, etc.
- **Project-level files** — `CLAUDE.md`, `package.json`, `tsconfig.json`, etc.

### Step 2: Map directories

For each top-level directory, list all subdirectories that contain meaningful content:

```
ls {project_root}/{directory}/
```

Build a directory map. Each directory becomes one agent task in the next phase. For large directories, list subdirectories recursively to a reasonable depth (2-3 levels) so agents know their scope.

### Step 3: Read project CLAUDE.md

Read `{project_root}/CLAUDE.md` if it exists. Extract:
- **Tech stack** — language, framework, key libraries
- **Architecture** — patterns, layers, structure conventions
- **Project purpose** — what this project does
- **Key relationships** — how different parts of the codebase interact

This context is used for the project overview section of the TOC and is included in agent prompts so they understand the broader context.

---

## Phase 2: Parallel Scan (`!p` dispatch)

> **NON-NEGOTIABLE:** This phase MUST be parallelized. The master agent enters dispatch mode and sends batches of agents simultaneously. The master NEVER reads source files — agents do ALL file reading. The master's only jobs are: dispatch agents, receive results, and write the TOC. This is a hard constraint for both performance and context maximization.

### Step 4: Decompose into agent tasks

Create one task per directory (or group of small directories). Each agent scans the files in its assigned directory and reports back context.

**Agent scope sizing:**
- **One directory = one agent** for directories with 3+ files
- **Group small directories** (1-2 files each) into a single agent task to avoid overhead
- **Skip `node_modules/`, `.next/`, `dist/`, `.git/`, and other build/dependency directories**
- **Include `_commands/` directories** — command files are important context

**Each agent receives a prompt like:**

```
You are scanning directory: {directory}/

## Your Task
Read every file in this directory (and subdirectories up to 2 levels deep). For each file, report back:

1. **File path** — relative to the project root (e.g., `src/services/ProductService.ts`)
2. **Summary** — 1-3 sentences describing what this file does, what it exports, and its role in the codebase. Be specific: "Provides paginated browsing, category filtering, and featured sorting for the simulation gallery" is useful. "A service file" is not.
3. **Tags** — 3-8 lowercase tags for searchability. Include: technology (typescript, react, firestore), domain (auth, simulations, generation), role (service, hook, component, config, trigger, middleware), and any other relevant descriptors.
4. **Related files** — Other files this file imports from, depends on, or is consumed by. List paths relative to project root. Only include direct, meaningful relationships — not every transitive import.
5. **Exports** — Key exported symbols (functions, classes, types, constants) that other files consume. Only list the important ones, not every helper.
6. **Content hash** — Run `shasum -a 256 {file_path} | cut -c1-8` (or equivalent) to get the first 8 characters of the file's SHA-256 hash. Report this value exactly.

## Context
This directory belongs to the project at `{project_root}`.
{Relevant excerpt from the project's CLAUDE.md — architecture, conventions, file structure rules}

## Output Format
Return a structured list, one entry per file:

### {filename}
- **Path:** `{relative_path}`
- **Summary:** {description}
- **Tags:** {tag1}, {tag2}, {tag3}, ...
- **Related:** `{path1}`, `{path2}`, ...
- **Exports:** `{Symbol1}`, `{Symbol2}`, ...
- **Hash:** `{first 8 chars of SHA-256}`

Skip files that are purely auto-generated, lock files, or build artifacts.
```

### Step 5: Dispatch agents (NON-NEGOTIABLE: parallel batches)

Dispatch all directory-scan agents **in parallel batches** using `!p` dispatch mode. This is non-negotiable:

- **The master NEVER reads source files.** Not one. Zero. Agents do ALL file reading. The master exists only to dispatch and assemble. Reading source files as the master wastes context tokens and defeats the purpose of the swarm.
- **Dispatch agents in parallel batches.** Launch all independent agents simultaneously — do NOT dispatch them one at a time sequentially. Use the maximum parallelism available (multiple `Task` tool calls in a single message).
- **Process returns as they come in.** Do not wait for all agents to finish before starting assembly. As each agent returns, immediately incorporate its results into the TOC draft (see Phase 3).

---

## Phase 3: Streaming Assembly

> **NON-NEGOTIABLE:** The master updates `toc.md` incrementally as agents report back. Do NOT wait for all agents to finish before writing. Each time an agent returns, integrate its results into the TOC immediately. This keeps the file progressively up-to-date and ensures no context is lost if the session is interrupted.

### Step 6: Compile the TOC

As agents return, the master incrementally assembles `{project_root}/.synapse/toc.md`. The file has two main sections:

#### Section 1: Project Overview (TOP of file)

This section provides high-level context about the project. It goes **at the very top** of the TOC, before any per-directory entries.

```markdown
# Table of Contents — Project Index

> Last updated: {YYYY-MM-DD}

## Project Overview

### Summary
{Brief description of the project — what it does, who it serves}

### Tech Stack
| Technology | Usage |
|---|---|
| TypeScript | Primary language |
| Next.js | Frontend framework |
| Express | API server |
| PostgreSQL | Database |

### Architecture
{Brief description of the architecture — patterns, layers, how the codebase is organized}

### Key Directories
| Directory | Purpose |
|---|---|
| src/components/ | React UI components |
| src/services/ | Business logic services |
| src/api/ | API route handlers |
| config/ | Configuration files |

---
```

#### Section 2: File Index

List every significant file with its context. Group files by directory. Use this format:

```markdown
## {directory_path}/
{Brief directory description}

- **`{filename}`** — {summary} [tags: {tag1}, {tag2}] <!-- hash:{8-char-hash} -->
  - Related: `{path1}`, `{path2}`
  - Exports: `Symbol1`, `Symbol2`

- **`{filename}`** — {summary} [tags: {tag1}, {tag2}] <!-- hash:{8-char-hash} -->
  - Related: `{path1}`, `{path2}`
```

**Formatting rules:**
- **Bold the filename** in each entry
- **Summary is inline** after the em-dash — concise, specific, searchable
- **Tags in brackets** after the summary — lowercase, comma-separated
- **Related/Exports on indented sub-lines** — only when they add meaningful cross-reference value. Omit if the file is self-contained or the relationships are obvious from context.
- **Group by directory** with a `##` heading per directory
- **Order directories logically** — source code first, then config, then docs, then commands

### Step 7: Write the file

Ensure `{project_root}/.synapse/` directory exists (create if needed). Write the assembled TOC to `{project_root}/.synapse/toc.md`, replacing the existing file entirely.

### Step 8: Report

Print a summary:

```markdown
## TOC Generated

- **Directories scanned:** {N}
- **Files indexed:** {N}
- **Agents dispatched:** {N}

The Table of Contents has been written to `.synapse/toc.md`.
```

---

## Rules

### Non-Negotiable — Master Agent Role Restrictions

These rules are absolute. Violating any of them is a failure.

1. **The master agent NEVER reads source files.** Zero exceptions. The master reads ONLY: `CLAUDE.md`, directory listings (`ls`), and agent return values. All source file reading is delegated to swarm agents. This is a hard performance constraint — every source file the master reads wastes context tokens that should be reserved for orchestration and TOC assembly.

2. **Agent dispatch MUST be parallelized.** The master dispatches agents in parallel batches — multiple `Task` tool calls in a single message. Sequential one-at-a-time dispatch is forbidden. The whole point of the swarm is parallel execution.

3. **TOC updates are streaming, not batched.** The master writes to `toc.md` incrementally as agents return results. Do NOT accumulate all results in memory and write once at the end. This protects against context loss from session interruption and keeps the TOC progressively current.

4. **The master's only jobs are: discover, dispatch, assemble, report.** It gathers project structure (Phase 1), dispatches agents (Phase 2), assembles their returns into the TOC (Phase 3), and reports completion. It does not read, analyze, or summarize source files — that is the agents' job.

### General Rules

- **Skip build artifacts and dependencies.** Never index `node_modules/`, `.next/`, `dist/`, `.git/`, `*.lock`, or auto-generated files.
- **Summaries must be useful.** "A TypeScript file" is worthless. "Rate limiter middleware — limits each IP to N requests per window, returns 429 with Retry-After header" is useful. Every summary should let a reader determine relevance without opening the file.
- **Tags must be searchable.** Use consistent lowercase tags. Include technology, domain, role, and feature tags.
- **Related files enable discovery.** When a service calls an API endpoint, link them. When a type is shared, link the source and all consumers.
- **The project overview section is mandatory.** It goes at the top and provides the high-level context that individual file entries cannot convey — purpose, tech stack, architecture, and the overall structure.
- **Content hashes are mandatory.** Every file entry must include a `<!-- hash:{8chars} -->` comment. This enables `!toc_update` to detect content changes without re-reading every file. If an agent fails to report a hash, use `00000000` as a placeholder.
- **Update the date.** Set "Last updated" to today's date.
