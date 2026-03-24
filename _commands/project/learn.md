# `!learn`

**Purpose:** Bootstrap the Project Knowledge Index (PKI) from scratch by dispatching a parallel swarm to deeply annotate every significant file in the project. Unlike `!toc_generate` which produces a searchable metadata index, `!learn` produces deep operational knowledge — gotchas, patterns, conventions, relationships, and domain taxonomy that agents can query to understand how the project actually works.

**Syntax:** `!learn`

**Produces:**
- `{project_root}/.synapse/knowledge/manifest.json` — Master routing index with per-file summaries, domains, tags, and cross-references
- `{project_root}/.synapse/knowledge/annotations/{hash}.json` — Per-file deep annotation files (flat, hash-keyed)
- `{project_root}/.synapse/knowledge/domains.json` — Auto-discovered domain taxonomy
- `{project_root}/.synapse/knowledge/patterns.json` — Cross-cutting patterns and conventions observed across the codebase
- `{project_root}/.synapse/knowledge/queries/` — Directory for pre-computed domain bundles (created empty, populated by `!context` queries)

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
- **Naming conventions** — any naming rules or file organization patterns
- **Key relationships** — how different parts of the codebase interact

This context is included in every agent prompt so they understand the broader project context when annotating files.

### Step 4: Ensure PKI directory structure

Create the knowledge directory tree if it does not exist:

```
mkdir -p {project_root}/.synapse/knowledge/annotations
mkdir -p {project_root}/.synapse/knowledge/queries
```

---

## Phase 2: Parallel Scan (`!p` dispatch)

> **NON-NEGOTIABLE:** This phase MUST be parallelized. The master agent enters dispatch mode and sends batches of agents simultaneously. The master NEVER reads source files — agents do ALL file reading. The master's only jobs are: dispatch agents, receive results, and assemble the PKI. This is a hard constraint for both performance and context maximization.

### Step 5: Decompose into agent tasks

Create one task per directory (or group of small directories). Each agent deeply reads the files in its assigned directory and produces annotations.

**Agent scope sizing:**
- **One directory = one agent** for directories with 3+ files
- **Group small directories** (1-2 files each) into a single agent task to avoid overhead
- **Skip `node_modules/`, `.next/`, `dist/`, `.git/`, and other build/dependency directories**
- **Include `_commands/` directories** — command files contain operational knowledge

### Step 6: Worker agent prompt template

**Each agent receives a prompt like:**

```
You are a PKI annotation agent scanning directory: {directory}/

## Your Task

Read every file in this directory (and subdirectories up to 2 levels deep). For each significant file, produce a deep annotation. You are not just cataloging — you are building operational knowledge that other agents will use to understand how this project works, what to watch out for, and how the pieces fit together.

## Context

This directory belongs to the project at `{project_root}`.
{Relevant excerpt from the project's CLAUDE.md — architecture, conventions, file structure rules}

## For Each File, Report:

### 1. Identity
- **file**: Relative path from project root (e.g., `src/services/AuthService.ts`)
- **content_hash**: Run `shasum -a 256 {file_path} | cut -c1-8` to get the first 8 characters of the file's SHA-256 hash

### 2. Purpose
One paragraph describing what this file does, why it exists, and its role in the broader system. Be specific and operational: "Handles user authentication via Firebase Auth, manages session tokens, and provides middleware for protecting API routes" — not "An auth file."

### 3. Exports
For each meaningful export:
- **name**: The exported symbol name
- **kind**: `function`, `class`, `type`, `interface`, `constant`, `enum`, `component`, `hook`, `middleware`, `route`
- **signature**: Brief signature or shape (e.g., `(userId: string, options?: AuthOptions) => Promise<User>`)

Only list exports that other files actually consume or that define the file's public API. Skip internal helpers.

### 4. Imports
Map of module paths to imported names:
```json
{ "src/utils/logger": ["logger"], "src/config/db": ["db", "getConnection"] }
```
Include only project-internal imports. Exclude external/npm packages.

### 5. Gotchas
Operational warnings that an agent working in this area MUST know. These are things that would cause bugs, confusion, or wasted time if not known upfront:
- Race conditions or timing dependencies
- Non-obvious side effects
- Configuration that must be set before this code works
- Implicit coupling with other files
- "Looks like X but is actually Y" traps
- Known fragile areas or tech debt

If there are no gotchas, report an empty array. Do not invent problems.

### 6. Patterns
Coding patterns used in this file that represent how this project does things:
- Error handling pattern (e.g., "wraps all async handlers in try/catch with centralized error response")
- Data access pattern (e.g., "uses repository pattern with Firestore, all queries go through service layer")
- State management pattern (e.g., "uses React context with useReducer, actions dispatched via custom hooks")
- Testing pattern (e.g., "co-located test files with .test.ts suffix, uses jest mocks for external services")

### 7. Conventions
Project conventions observed in this file:
- Naming conventions (e.g., "services are PascalCase with Service suffix", "hooks are camelCase with use prefix")
- File organization (e.g., "one component per file, styles co-located as .module.css")
- API conventions (e.g., "REST endpoints return { success: boolean, data?: T, error?: string }")
- Comment/documentation conventions

### 8. Relationships
- **depends_on**: Files this file directly imports from or critically depends on
- **depended_by**: Files known to import from this file (best effort — check for import statements referencing this file's path)
- **related**: Files that are conceptually related but not directly linked by imports (e.g., a frontend component and its corresponding API endpoint)

### 9. Domain Classification
Assign 1-3 domain labels from the project's natural domain areas. Use descriptive, project-specific domains — not generic labels:
- Good: `authentication`, `simulation-engine`, `billing`, `admin-dashboard`, `file-processing`
- Bad: `utility`, `misc`, `other`, `general`

If a file genuinely spans multiple domains, list them all. If a file is truly a shared utility, use a domain like `shared-infrastructure` or `cross-cutting`.

### 10. Tags
3-8 lowercase tags for searchability. Include:
- Technology tags: `typescript`, `react`, `firestore`, `express`
- Domain tags: same as domain classification
- Role tags: `service`, `hook`, `component`, `config`, `middleware`, `route`, `model`, `test`
- Feature tags: specific features this file supports

### 11. Complexity
Classify as: `simple` (under 100 lines, linear flow), `moderate` (100-300 lines or significant branching/async), `complex` (300+ lines or deeply nested logic).

## Output Format

Return a structured list, one entry per file:

### {filename}
- **File:** `{relative_path}`
- **Content Hash:** `{first 8 chars of SHA-256}`
- **Purpose:** {detailed purpose description}
- **Exports:**
  - `{name}` ({kind}) — `{signature}`
- **Imports:** `{module}`: [{names}], ...
- **Gotchas:**
  - {gotcha 1}
  - {gotcha 2}
- **Patterns:**
  - {pattern 1}
- **Conventions:**
  - {convention 1}
- **Relationships:**
  - Depends on: `{path}`, `{path}`
  - Depended by: `{path}`
  - Related: `{path}`
- **Domains:** {domain1}, {domain2}
- **Tags:** {tag1}, {tag2}, {tag3}
- **Complexity:** {simple|moderate|complex}

Skip files that are purely auto-generated, lock files, or build artifacts.
```

### Step 7: Dispatch agents (NON-NEGOTIABLE: parallel batches)

Dispatch all directory-scan agents **in parallel batches** using `!p` dispatch mode. This is non-negotiable:

- **The master NEVER reads source files.** Not one. Zero. Agents do ALL file reading. The master exists only to dispatch and assemble. Reading source files as the master wastes context tokens and defeats the purpose of the swarm.
- **Dispatch agents in parallel batches.** Launch all independent agents simultaneously — do NOT dispatch them one at a time sequentially. Use the maximum parallelism available (multiple `Task` tool calls in a single message).
- **Process returns as they come in.** Do not wait for all agents to finish before starting assembly. As each agent returns, immediately incorporate its results into the PKI data files (see Phase 3).

---

## Phase 3: Assembly

> **NON-NEGOTIABLE:** The master writes PKI files incrementally as agents report back. Do NOT wait for all agents to finish before writing. Each time an agent returns, integrate its annotations immediately. This keeps the index progressively up-to-date and ensures no data is lost if the session is interrupted.

### Step 8: Generate per-file annotation files

For each file reported by an agent, create an annotation file at `{project_root}/.synapse/knowledge/annotations/{hash}.json`.

**Hash generation:** The hash is the first 8 characters of the SHA-256 of the file's relative path (from project root). Compute it as:

```bash
echo -n "relative/path/to/file.ts" | shasum -a 256 | cut -c1-8
```

**Annotation file schema:**

```json
{
  "file": "relative/path/to/file.ts",
  "content_hash": "{first 8 chars of SHA-256 of file content, as reported by agent}",
  "annotated_at": "{ISO 8601 timestamp}",
  "annotated_by": "learn-bootstrap",
  "purpose": "{detailed purpose description from agent}",
  "exports": [
    { "name": "functionName", "kind": "function", "signature": "(param: Type) => ReturnType" }
  ],
  "imports_from": {
    "src/utils/logger": ["logger"],
    "src/config/db": ["db", "getConnection"]
  },
  "gotchas": [
    "Race condition when called concurrently — uses no locking",
    "Depends on ENV_VAR being set before import"
  ],
  "patterns": [
    "Async/await with centralized error handler",
    "Repository pattern for data access"
  ],
  "conventions": [
    "PascalCase service naming with Service suffix",
    "All public methods have JSDoc comments"
  ],
  "relationships": {
    "depends_on": ["src/utils/logger.ts", "src/config/db.ts"],
    "depended_by": ["src/routes/auth.ts"],
    "related": ["src/middleware/authMiddleware.ts"]
  },
  "domains": ["authentication", "user-management"],
  "tags": ["typescript", "service", "auth", "firebase"]
}
```

### Step 9: Build manifest.json

Incrementally build `{project_root}/.synapse/knowledge/manifest.json` as agents return. On each agent return, add entries to the `files` map and update the indexes.

**Assembly rules for manifest.json:**

1. **`files` map:** For each annotated file, create an entry keyed by relative path:
   ```json
   {
     "hash": "{first 8 chars of SHA-256 of relative path — same hash used for annotation filename}",
     "content_hash": "{first 8 chars of SHA-256 of file content — from agent report}",
     "domains": ["{domains from annotation}"],
     "tags": ["{tags from annotation}"],
     "summary": "{first sentence of the purpose field from annotation}",
     "complexity": "{simple|moderate|complex}",
     "last_annotated": "{ISO 8601 timestamp}",
     "stale": false
   }
   ```

2. **`domain_index`:** After all files are added, build a reverse index from domain name to list of file paths. For each file entry, iterate its `domains` array and append the file path to `domain_index[domain]`. Sort file lists alphabetically.
   ```json
   {
     "authentication": ["src/middleware/auth.ts", "src/services/AuthService.ts"],
     "billing": ["src/services/BillingService.ts", "src/routes/billing.ts"]
   }
   ```

3. **`tag_index`:** Same pattern as `domain_index` but for tags. For each file entry, iterate its `tags` array and append the file path to `tag_index[tag]`. Sort file lists alphabetically.
   ```json
   {
     "typescript": ["src/services/AuthService.ts", "src/services/BillingService.ts"],
     "react": ["src/components/LoginForm.tsx", "src/components/Dashboard.tsx"]
   }
   ```

4. **`concept_map`:** After all annotations are assembled, scan the `patterns` arrays across all files to identify cross-cutting patterns that appear in 2+ files. For each recurring pattern, create a concept entry:
   ```json
   {
     "repository-pattern": {
       "pattern": "Data access through repository abstraction layer",
       "files": ["src/services/UserService.ts", "src/services/ProductService.ts"]
     },
     "centralized-error-handling": {
       "pattern": "All async handlers wrapped in try/catch with error response middleware",
       "files": ["src/routes/auth.ts", "src/routes/api.ts", "src/middleware/errorHandler.ts"]
     }
   }
   ```
   To build this: normalize pattern strings to kebab-case keys, group files that share similar patterns (fuzzy match on pattern descriptions), and write a concise `pattern` description summarizing the concept.

5. **`stats`:** Compute after all agents return:
   ```json
   {
     "total_files": "{total files discovered during scan}",
     "annotated": "{number of files with annotation files}",
     "stale": 0
   }
   ```

6. **`version`:** Always `1`.

7. **`last_updated`:** ISO 8601 timestamp of when the manifest was last written.

**Full manifest.json structure:**

```json
{
  "version": 1,
  "last_updated": "2026-03-24T14:30:00Z",
  "stats": {
    "total_files": 87,
    "annotated": 82,
    "stale": 0
  },
  "files": {
    "src/services/AuthService.ts": {
      "hash": "a1b2c3d4",
      "content_hash": "e5f6g7h8",
      "domains": ["authentication"],
      "tags": ["typescript", "service", "auth"],
      "summary": "Handles user authentication via Firebase Auth and manages session tokens.",
      "complexity": "moderate",
      "last_annotated": "2026-03-24T14:25:00Z",
      "stale": false
    }
  },
  "domain_index": {},
  "tag_index": {},
  "concept_map": {}
}
```

### Step 10: Generate domains.json

After all agents have returned, build `{project_root}/.synapse/knowledge/domains.json` from the discovered domains.

**Assembly rules:**

1. Collect all unique domain labels from every file annotation's `domains` array.
2. For each domain, determine:
   - **description**: Infer from the purposes of the files in this domain — what does this domain area cover?
   - **files**: List of all file paths that belong to this domain (sorted alphabetically).
   - **file_count**: Number of files in this domain.
   - **key_files**: The 3-5 most important files in this domain (by complexity, number of dependents, or centrality). Use judgment based on annotation data.
   - **related_domains**: Other domains that share files with this domain (a file tagged `authentication` and `user-management` creates a relationship between those two domains).

**Schema:**

```json
{
  "generated_at": "2026-03-24T14:30:00Z",
  "domains": {
    "authentication": {
      "description": "User authentication, session management, and access control",
      "files": ["src/middleware/auth.ts", "src/services/AuthService.ts"],
      "file_count": 2,
      "key_files": ["src/services/AuthService.ts"],
      "related_domains": ["user-management"]
    }
  }
}
```

### Step 11: Generate patterns.json

After all agents have returned, build `{project_root}/.synapse/knowledge/patterns.json` from the cross-cutting patterns and conventions.

**Assembly rules:**

1. **Patterns section:** Collect all `patterns` entries from every annotation. Group similar patterns (fuzzy match on description text). For each group:
   - Assign a kebab-case key (e.g., `repository-pattern`, `error-boundary-pattern`)
   - Write a `description` summarizing the pattern
   - List all `files` where this pattern appears
   - Set `frequency` to the count of files
   - Provide an `example` — pick the best file that demonstrates this pattern

2. **Conventions section:** Collect all `conventions` entries from every annotation. Group and deduplicate:
   - **naming**: Naming conventions (e.g., "Services use PascalCase with Service suffix")
   - **file_organization**: File and directory conventions
   - **api**: API design conventions
   - **error_handling**: Error handling conventions
   - **testing**: Testing conventions
   - **documentation**: Documentation conventions

   For each convention, list the `files` where it was observed and a `description`.

**Schema:**

```json
{
  "generated_at": "2026-03-24T14:30:00Z",
  "patterns": {
    "repository-pattern": {
      "description": "Data access abstracted through repository layer — services never query the database directly",
      "files": ["src/services/UserService.ts", "src/services/ProductService.ts"],
      "frequency": 5,
      "example": "src/services/UserService.ts"
    }
  },
  "conventions": {
    "naming": [
      {
        "description": "Services use PascalCase with Service suffix",
        "files": ["src/services/AuthService.ts", "src/services/UserService.ts"],
        "frequency": 8
      }
    ],
    "file_organization": [],
    "api": [],
    "error_handling": [],
    "testing": [],
    "documentation": []
  }
}
```

---

## Phase 4: Report

### Step 12: Print summary

Print a summary of the learning run:

```markdown
## PKI Bootstrap Complete

- **Directories scanned:** {N}
- **Files discovered:** {N}
- **Files annotated:** {N}
- **Agents dispatched:** {N}
- **Domains discovered:** {N} ({list of domain names})
- **Cross-cutting patterns:** {N}
- **Conventions cataloged:** {N}

### Output Files
- `{project_root}/.synapse/knowledge/manifest.json` — Master index ({N} file entries)
- `{project_root}/.synapse/knowledge/annotations/` — {N} annotation files
- `{project_root}/.synapse/knowledge/domains.json` — Domain taxonomy
- `{project_root}/.synapse/knowledge/patterns.json` — Patterns and conventions
- `{project_root}/.synapse/knowledge/queries/` — Query cache directory (empty, populated by !context)

### Top Domains by File Count
| Domain | Files | Key Files |
|---|---|---|
| {domain} | {count} | `{file}`, `{file}` |

### Most Common Patterns
| Pattern | Frequency | Example File |
|---|---|---|
| {pattern_name} | {count} files | `{file}` |
```

---

## Rules

### Non-Negotiable — Master Agent Role Restrictions

These rules are absolute. Violating any of them is a failure.

1. **The master agent NEVER reads source files.** Zero exceptions. The master reads ONLY: `CLAUDE.md`, directory listings (`ls`), and agent return values. All source file reading is delegated to swarm agents. This is a hard performance constraint — every source file the master reads wastes context tokens that should be reserved for orchestration and PKI assembly.

2. **Agent dispatch MUST be parallelized.** The master dispatches agents in parallel batches — multiple `Task` tool calls in a single message. Sequential one-at-a-time dispatch is forbidden. The whole point of the swarm is parallel execution.

3. **PKI updates are streaming, not batched.** The master writes annotation files and updates the manifest incrementally as agents return results. Do NOT accumulate all results in memory and write once at the end. This protects against context loss from session interruption and keeps the PKI progressively current.

4. **The master's only jobs are: discover, dispatch, assemble, report.** It gathers project structure (Phase 1), dispatches agents (Phase 2), assembles their returns into PKI files (Phase 3), and reports completion (Phase 4). It does not read, analyze, or summarize source files — that is the agents' job.

### Annotation Depth — Deeper Than TOC

Annotations produced by `!learn` MUST be operationally deeper than TOC entries. The difference:

| Dimension | TOC (`!toc_generate`) | PKI (`!learn`) |
|---|---|---|
| **Purpose** | 1-3 sentence summary | Full paragraph with role in system |
| **Exports** | Symbol names only | Names + kinds + signatures |
| **Imports** | Not tracked | Full module-to-names mapping |
| **Gotchas** | Not tracked | Operational warnings for agents |
| **Patterns** | Not tracked | Coding patterns used |
| **Conventions** | Not tracked | Project conventions observed |
| **Relationships** | Related files | depends_on + depended_by + related |
| **Domains** | Not tracked | Domain classification |
| **Tags** | Flat tag list | Same (shared with TOC) |

If an annotation reads like a TOC entry — just a short summary and some tags — it has failed. Every annotation should contain knowledge that would save an agent 5-10 minutes of investigation.

### Hash Rules

- **Annotation file hash** (the filename in `annotations/`): First 8 characters of SHA-256 of the file's **relative path** (not content). This is stable across content changes.
  ```bash
  echo -n "src/services/AuthService.ts" | shasum -a 256 | cut -c1-8
  ```
- **Content hash** (stored in annotation and manifest): First 8 characters of SHA-256 of the **file content**. This changes when the file is modified, enabling staleness detection.
  ```bash
  shasum -a 256 src/services/AuthService.ts | cut -c1-8
  ```
- Both hashes are mandatory for every annotated file.

### General Rules

- **Skip build artifacts and dependencies.** Never annotate `node_modules/`, `.next/`, `dist/`, `.git/`, `*.lock`, or auto-generated files.
- **Gotchas must be genuine.** Do not invent problems or pad the gotchas list. An empty gotchas array is valid and preferable to fabricated warnings. Only report things that would actually cause bugs, confusion, or wasted time.
- **Patterns must be specific.** "Uses async/await" is not a pattern worth noting — it is baseline. "Wraps all route handlers in asyncHandler() to centralize error responses" is a pattern worth noting.
- **Conventions must be observed, not assumed.** Report conventions you actually see in the code, not conventions you think the project should follow.
- **Domains must be project-specific.** Use domain names that reflect the project's actual business domains and technical areas. Generic labels like `utility` or `misc` are not domains.
- **The `queries/` directory is created empty.** It is populated lazily by `!context` queries that cache their results. `!learn` only creates the directory.
- **`annotated_by` is always `"learn-bootstrap"`.** This distinguishes full-scan annotations from incremental updates (which use `"learn-update"`).
- **Update the timestamp.** Set `last_updated` in manifest.json and `generated_at` in domains.json and patterns.json to the completion timestamp.
