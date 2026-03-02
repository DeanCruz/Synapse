# `!toc_generate`

**Purpose:** Generate a complete `TableOfContentsMaster.md` from scratch by dispatching parallel agents to scan every directory across all child repos. Use this after major restructuring, new repos being added, or when the TOC is severely out of date. This is the slow, thorough option — for incremental updates, use `!toc_update` instead.

**Syntax:** `!toc_generate`

**Produces:** A fully rebuilt `{parent_directory}/TableOfContentsMaster.md`

---

## Phase 1: Discovery

### Step 1: Scan workspace structure

List the parent directory to discover all child repos and top-level directories:

```
ls {parent_directory}/
```

Identify:
- **Child repos** — directories with source code, `CLAUDE.md`, `package.json`, etc.
- **Workspace-level directories** — `_commands/`, `agent/`, `archive/`, `TableOfContents/`, etc.
- **Workspace-level files** — `CLAUDE.md`, `TableOfContentsMaster.md`, etc.

### Step 2: Map directories per repo

For each child repo, list all top-level subdirectories that contain meaningful content:

```
ls {parent_directory}/{child_repo}/
```

Build a directory map. Each directory becomes one agent task in the next phase. For large repos, list subdirectories recursively to a reasonable depth (2-3 levels) so agents know their scope.

### Step 3: Read all CLAUDE.md files

Read every child repo's `CLAUDE.md` in parallel. Extract:
- **Tech stack** — language, framework, key libraries
- **Architecture** — patterns, layers, structure conventions
- **Repo purpose** — what this repo does and how it fits into the workspace
- **Key relationships** — which other repos it interacts with (API contracts, shared types, etc.)

This context is used for the repo header section of the TOC and is included in agent prompts so they understand the broader context.

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
You are scanning directory: {repo}/{directory}/

## Your Task
Read every file in this directory (and subdirectories up to 2 levels deep). For each file, report back:

1. **File path** — relative to the workspace root (e.g., `my-backend/src/services/ProductService.ts`)
2. **Summary** — 1-3 sentences describing what this file does, what it exports, and its role in the codebase. Be specific: "Provides paginated browsing, category filtering, and featured sorting for the simulation gallery" is useful. "A service file" is not.
3. **Tags** — 3-8 lowercase tags for searchability. Include: technology (typescript, react, firestore), domain (auth, simulations, generation), role (service, hook, component, config, trigger, middleware), and any other relevant descriptors.
4. **Related files** — Other files this file imports from, depends on, or is consumed by. List paths relative to workspace root. Only include direct, meaningful relationships — not every transitive import.
5. **Exports** — Key exported symbols (functions, classes, types, constants) that other files consume. Only list the important ones, not every helper.

## Context
This directory belongs to the `{repo}` repo.
{Relevant excerpt from the repo's CLAUDE.md — architecture, conventions, file structure rules}

## Output Format
Return a structured list, one entry per file:

### {filename}
- **Path:** `{relative_path}`
- **Summary:** {description}
- **Tags:** {tag1}, {tag2}, {tag3}, ...
- **Related:** `{path1}`, `{path2}`, ...
- **Exports:** `{Symbol1}`, `{Symbol2}`, ...

Skip files that are purely auto-generated, lock files, or build artifacts.
```

### Step 5: Dispatch agents (NON-NEGOTIABLE: parallel batches)

Dispatch all directory-scan agents **in parallel batches** using `!p` dispatch mode. This is non-negotiable:

- **The master NEVER reads source files.** Not one. Zero. Agents do ALL file reading. The master exists only to dispatch and assemble. Reading source files as the master wastes context tokens and defeats the purpose of the swarm.
- **Dispatch agents in parallel batches.** Launch all independent agents simultaneously — do NOT dispatch them one at a time sequentially. Use the maximum parallelism available (multiple `Task` tool calls in a single message).
- **Process returns as they come in.** Do not wait for all agents to finish before starting assembly. As each agent returns, immediately incorporate its results into the TOC draft (see Phase 3).

---

## Phase 3: Streaming Assembly

> **NON-NEGOTIABLE:** The master updates `TableOfContentsMaster.md` incrementally as agents report back. Do NOT wait for all agents to finish before writing. Each time an agent returns, integrate its results into the TOC immediately. This keeps the file progressively up-to-date and ensures no context is lost if the session is interrupted.

### Step 6: Compile the TOC

As agents return, the master incrementally assembles `TableOfContentsMaster.md`. The file has two main sections:

#### Section 1: Workspace Overview (TOP of file)

This section provides high-level context about the entire workspace. It goes **at the very top** of the TOC, before any per-repo entries.

```markdown
# Table of Contents — Workspace Index

> Last updated: {YYYY-MM-DD}

## Workspace Overview

### Repos
| Repo | Purpose | Tech Stack |
|---|---|---|
| my-frontend | Next.js App Router frontend — user-facing web app | TypeScript, Next.js, React |
| my-backend | Express API — all server-side logic | TypeScript, Express, PostgreSQL |
| docs | Structured knowledge base — engineering, product, and API docs | Markdown |
| Synapse | Swarm orchestration system — parallel agent dispatch and monitoring | Node.js, vanilla JS, SSE |

### Relationships
- **my-frontend ↔ my-backend** — Frontend calls backend API endpoints via `apiClient`. Shared types: `User`, `Product`, `Order`, etc.
- **my-frontend ↔ docs** — Docs contain product specs consumed during feature development.
- **Synapse** — Independent orchestration tool. Used by the master agent for parallel task execution. No runtime dependency on other repos.

### Workspace-Level Files
- `CLAUDE.md` — Master agent governing document — multi-repo orchestration rules, command resolution, swarm protocols
- `TableOfContentsMaster.md` — This file — workspace semantic index
- `_commands/` — Workspace-level commands (health, toc, onboard, etc.)

---
```

#### Section 2: Per-Repo File Index

For each repo, list every significant file with its context. Group files by directory. Use this format:

```markdown
## {repo_name}
{1-2 sentence repo summary}
`CLAUDE.md: {yes|no}` | Tags: {repo-level tags}

### {directory_path}/
{Brief directory description}

- **`{filename}`** — {summary} [tags: {tag1}, {tag2}]
  - Related: `{path1}`, `{path2}`
  - Exports: `Symbol1`, `Symbol2`

- **`{filename}`** — {summary} [tags: {tag1}, {tag2}]
  - Related: `{path1}`, `{path2}`
```

**Formatting rules:**
- **Bold the filename** in each entry
- **Summary is inline** after the em-dash — concise, specific, searchable
- **Tags in brackets** after the summary — lowercase, comma-separated
- **Related/Exports on indented sub-lines** — only when they add meaningful cross-reference value. Omit if the file is self-contained or the relationships are obvious from context.
- **Group by directory** with a `###` heading per directory
- **Order directories logically** — source code first, then config, then docs, then commands

### Step 7: Write the file

Write the assembled TOC to `{parent_directory}/TableOfContentsMaster.md`, replacing the existing file entirely.

### Step 8: Report

Print a summary:

```markdown
## TOC Generated

- **Repos scanned:** {N}
- **Directories scanned:** {N}
- **Files indexed:** {N}
- **Agents dispatched:** {N}

The Table of Contents has been written to `TableOfContentsMaster.md`.
```

---

## Rules

### Non-Negotiable — Master Agent Role Restrictions

These rules are absolute. Violating any of them is a failure.

1. **The master agent NEVER reads source files.** Zero exceptions. The master reads ONLY: `CLAUDE.md` files, directory listings (`ls`), and agent return values. All source file reading is delegated to swarm agents. This is a hard performance constraint — every source file the master reads wastes context tokens that should be reserved for orchestration and TOC assembly.

2. **Agent dispatch MUST be parallelized.** The master dispatches agents in parallel batches — multiple `Task` tool calls in a single message. Sequential one-at-a-time dispatch is forbidden. The whole point of the swarm is parallel execution.

3. **TOC updates are streaming, not batched.** The master writes to `TableOfContentsMaster.md` incrementally as agents return results. Do NOT accumulate all results in memory and write once at the end. This protects against context loss from session interruption and keeps the TOC progressively current.

4. **The master's only jobs are: discover, dispatch, assemble, report.** It gathers workspace structure (Phase 1), dispatches agents (Phase 2), assembles their returns into the TOC (Phase 3), and reports completion. It does not read, analyze, or summarize source files — that is the agents' job.

### General Rules

- **Skip build artifacts and dependencies.** Never index `node_modules/`, `.next/`, `dist/`, `.git/`, `*.lock`, or auto-generated files.
- **Summaries must be useful.** "A TypeScript file" is worthless. "Rate limiter middleware — limits each IP to N requests per window, returns 429 with Retry-After header" is useful. Every summary should let a reader determine relevance without opening the file.
- **Tags must be searchable.** Use consistent lowercase tags. Include technology, domain, role, and feature tags.
- **Related files enable cross-repo discovery.** When a frontend service calls a backend endpoint, link them. When a type is shared, link the source and all consumers.
- **The workspace overview section is mandatory.** It goes at the top and provides the high-level context that individual file entries cannot convey — repo purposes, inter-repo relationships, and the overall architecture.
- **Update the date.** Set "Last updated" to today's date.
