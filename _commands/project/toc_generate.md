# `!toc_generate`

**Purpose:** Generate a complete `toc.md` from scratch by dispatching parallel agents to scan every directory across the project. Use this after major restructuring or when the TOC is severely out of date. This is the slow, thorough option — for incremental updates, use `!toc_update` instead.

**Syntax:** `!toc_generate`

**Produces:** A fully rebuilt `{project_root}/.synapse/toc.md`, plus sidecar files `{project_root}/.synapse/fingerprints.json` (semantic fingerprints per file) and `{project_root}/.synapse/dep_graph.json` (file-level dependency graph)

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
7. **Semantic fingerprint** — For each file, provide all four fingerprint fields:
   a. **Purpose** — Classify the file as exactly one of: `component`, `service`, `utility`, `config`, `test`, `type-definition`, `route`, `middleware`, `hook`, `model`, `migration`, `script`, `documentation`, `command`, `style`, `entry-point`, `factory`, `context-provider`, or `other(description)`. Use `other(description)` only when none of the named categories fit, replacing `description` with a concise label.
   b. **Key exports** — Array of the top 5-10 exported symbols with structured metadata: name, kind (`function`, `class`, `type`, `interface`, `constant`, or `enum`), and params (number of parameters for functions/methods, `0` for non-callables). Example: `startServer (function, 1)`, `UserSchema (constant, 0)`.
   c. **Key imports** — Array of relative paths (from project root) for project-internal imports only. Exclude external/npm packages. Example: `src/utils/logger.js`, `src/config/db.js`.
   d. **Complexity** — Classify as one of: `simple` (under 100 lines, linear flow), `moderate` (100-300 lines or significant branching/async), `complex` (300+ lines or deeply nested logic).

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
- **Fingerprint:**
  - **Purpose:** {purpose_category}
  - **Key Exports:** {name} ({kind}, {params}), {name} ({kind}, {params}), ...
  - **Key Imports:** `{relative_path}`, `{relative_path}`, ...
  - **Complexity:** {simple|moderate|complex}

Skip files that are purely auto-generated, lock files, or build artifacts.
```

### Step 5: Dispatch agents (NON-NEGOTIABLE: parallel batches)

Dispatch all directory-scan agents **in parallel batches** using `!p` dispatch mode. This is non-negotiable:

- **The master NEVER reads source files.** Not one. Zero. Agents do ALL file reading. The master exists only to dispatch and assemble. Reading source files as the master wastes context tokens and defeats the purpose of the swarm.
- **Dispatch agents in parallel batches.** Launch all independent agents simultaneously — do NOT dispatch them one at a time sequentially. Use the maximum parallelism available (multiple `Task` tool calls in a single message).
- **Process returns as they come in.** Do not wait for all agents to finish before starting assembly. As each agent returns, immediately incorporate its results into the TOC draft (see Phase 3).

---

## Phase 3: Streaming Assembly

> **NON-NEGOTIABLE:** The master updates `toc.md` incrementally as agents report back. Do NOT wait for all agents to finish before writing. Each time an agent returns, integrate its results into the TOC immediately. This keeps the file progressively up-to-date and ensures no context is lost if the session is interrupted. Additionally, the master accumulates fingerprint data from every agent return and, once all agents have reported, writes `fingerprints.json` and `dep_graph.json` as sidecar files.

### Step 6: Compile the TOC and accumulate fingerprints

As agents return, the master incrementally assembles `{project_root}/.synapse/toc.md` and accumulates fingerprint data in memory. For each file reported by an agent, extract the **Fingerprint** section (purpose, key exports, key imports, complexity) and store it keyed by relative file path. This fingerprint data is NOT embedded in `toc.md` — it is written to a separate `fingerprints.json` sidecar in Step 7a.

The TOC file has two main sections:

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

### Step 7: Write the TOC file

Ensure `{project_root}/.synapse/` directory exists (create if needed). Write the assembled TOC to `{project_root}/.synapse/toc.md`, replacing the existing file entirely.

### Step 7a: Write fingerprints.json

After all agents have returned (or after the final incremental TOC write), write the accumulated fingerprint data to `{project_root}/.synapse/fingerprints.json`. This file is a sidecar to `toc.md` — it is NOT embedded in the TOC itself.

**Schema:**

```json
{
  "generated_at": "ISO 8601 date (same timestamp as toc.md 'Last updated')",
  "project_root": "{project_root}",
  "files": {
    "src/server/index.js": {
      "purpose": "entry-point",
      "key_exports": [
        { "name": "startServer", "kind": "function", "params": 1 },
        { "name": "DEFAULT_PORT", "kind": "constant", "params": 0 }
      ],
      "key_imports": [
        "src/server/services/WatcherService.js",
        "src/server/utils/logger.js"
      ],
      "complexity": "moderate"
    }
  }
}
```

**Field definitions:**

| Field | Type | Description |
|---|---|---|
| `generated_at` | ISO 8601 string | When the fingerprints were generated |
| `project_root` | string | Absolute path to the project root |
| `files` | object | Map of relative file path to fingerprint object |
| `files.*.purpose` | string | One of the predefined purpose categories (see agent prompt) |
| `files.*.key_exports` | array | Top 5-10 exports. Each: `{ "name": string, "kind": "function"\|"class"\|"type"\|"interface"\|"constant"\|"enum", "params": number }` |
| `files.*.key_imports` | array | Relative paths to project-internal imports only (no external packages) |
| `files.*.complexity` | string | One of: `"simple"`, `"moderate"`, `"complex"` |

**Assembly rules:**
- Parse each agent's Fingerprint section per file and convert to the JSON structure above
- If an agent fails to report a fingerprint for a file, omit that file from `fingerprints.json` (do not use placeholders)
- `key_exports` entries must have all three fields (`name`, `kind`, `params`). If an agent reports an export without `params`, default to `0`.
- `key_imports` must contain only project-relative paths — strip any leading `./` or `../` and normalize to project-root-relative. Exclude npm/external imports entirely.

### Step 7b: Build and write dep_graph.json

After `fingerprints.json` is assembled, build the file-level dependency graph from the `key_imports` data. Write to `{project_root}/.synapse/dep_graph.json`.

**Schema:**

```json
{
  "generated_at": "ISO 8601 date (same as fingerprints.json)",
  "project_root": "{project_root}",
  "graph": {
    "src/server/index.js": {
      "imports": ["src/server/services/WatcherService.js", "src/server/utils/logger.js"],
      "imported_by": ["electron/main.js"]
    },
    "src/server/services/WatcherService.js": {
      "imports": ["src/server/utils/logger.js"],
      "imported_by": ["src/server/index.js"]
    }
  }
}
```

**Assembly algorithm:**

1. **Forward pass (imports):** For each file in `fingerprints.json`, copy its `key_imports` array directly into `graph[file].imports`.

2. **Reverse pass (imported_by):** Iterate over every file in the graph. For each entry in its `imports` array, add the current file to `graph[imported_file].imported_by`. This builds the reverse dependency mapping.

3. **Ensure completeness:** If a file appears in an `imports` array but has no entry in the graph (i.e., the file was not scanned — perhaps it was excluded or in a skipped directory), create a stub entry: `{ "imports": [], "imported_by": [...] }`.

4. **Sort arrays:** Sort both `imports` and `imported_by` arrays alphabetically for deterministic output.

5. **Write the file** to `{project_root}/.synapse/dep_graph.json`, replacing any existing file entirely.

### Step 8: Report

Print a summary:

```markdown
## TOC Generated

- **Directories scanned:** {N}
- **Files indexed:** {N}
- **Files fingerprinted:** {N}
- **Agents dispatched:** {N}

The Table of Contents has been written to `.synapse/toc.md`.
Semantic fingerprints have been written to `.synapse/fingerprints.json`.
Dependency graph has been written to `.synapse/dep_graph.json`.
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
- **Fingerprints are sidecar data, not inline.** Semantic fingerprints are stored in `fingerprints.json`, NOT in `toc.md`. The TOC remains a human-readable markdown index. Fingerprints and the dependency graph are structured JSON for programmatic consumption.
- **Dependency graph is derived, not hand-authored.** `dep_graph.json` is built entirely from the `key_imports` data in `fingerprints.json`. The master computes the reverse `imported_by` mapping — agents do not report it.
- **Update the date.** Set "Last updated" to today's date.
