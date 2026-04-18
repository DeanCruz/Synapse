# Project Commands

All project commands are located at `{tracker_root}/_commands/project/`. They analyze, audit, index, and manage the target project. Most project commands are **read-only** -- they do not modify project files unless explicitly stated. All run in serial mode unless noted otherwise.

---

## Project Setup Commands

### `!initialize`

**Purpose:** Initialize Synapse for a target project. Detects the tech stack, creates the `.synapse/` metadata directory, optionally scaffolds a `CLAUDE.md`, sets up dashboard infrastructure, and validates the setup.

**Syntax:**
```
!initialize                      -- Full initialization
!initialize --skip-toc           -- Skip TOC generation
!initialize --skip-claude        -- Skip CLAUDE.md scaffolding
```

**Key Behavior:**
- Run once when connecting Synapse to a new project
- Scans for tech stack indicators: `package.json`, `tsconfig.json`, `next.config.*`, `requirements.txt`, `go.mod`, `Cargo.toml`, and more
- Detects monorepo patterns: npm/Yarn workspaces, pnpm, Lerna, Nx, Turborepo, Cargo workspaces, Go workspaces
- Creates `{project_root}/.synapse/` with `config.json` and `toc.md`
- Scaffolds a starter `CLAUDE.md` if none exists (unless `--skip-claude`)
- Generates the project Table of Contents via `!toc_generate` (unless `--skip-toc`)
- Ensures all 5 dashboard slots are initialized with proper directory structure
- Starts the dashboard server
- Idempotent -- running twice does not break anything

---

### `!onboard`

**Purpose:** Project walkthrough. Reads `CLAUDE.md`, TOC, and key files, then presents a structured orientation of the project.

**Syntax:**
```
!onboard                         -- Full project walkthrough
!onboard {area}                  -- Deep-dive into a specific area
```

**Key Behavior:**
- Read-only -- does not modify any files
- For full walkthrough: provides project structure, architecture description, component connections, quick start instructions, key conventions, available commands, environment setup, and a "where to find things" reference
- For a specific area: provides detailed purpose, tech stack, internal architecture, directory structure, key files, conventions, and cross-area connections
- Designed for the start of a new session or onboarding a new contributor

---

### `!scaffold`

**Purpose:** Generate a `CLAUDE.md` for a project that does not have one.

**Syntax:**
```
!scaffold                        -- Generate CLAUDE.md
!scaffold --force                -- Overwrite existing CLAUDE.md
```

**Key Behavior:**
- Scans project structure, detects tech stack, reads existing documentation
- Generates a comprehensive `CLAUDE.md` with: purpose, tech stack, architecture, file structure, conventions, commands, and environment sections
- Marks unknowns as TODO -- does not guess at architecture or conventions that cannot be inferred
- Never overwrites an existing `CLAUDE.md` without `--force`
- Only reads config files, READMEs, and directory listings -- does not deep-read source code

---

### `!create_claude`

**Purpose:** Create or update an opinionated `CLAUDE.md` for the target project that establishes coding standards, architectural patterns, documentation requirements, and styling guidelines. Unlike `!scaffold` (which documents what exists), `!create_claude` sets the rules for how the project **should** be built.

**Syntax:**
```
!create_claude                               -- Interactive: asks for architecture directions
!create_claude {prompt}                      -- Uses the prompt as architecture directions
!create_claude --update                      -- Updates existing CLAUDE.md preserving user sections
!create_claude --force                       -- Overwrites existing CLAUDE.md (requires confirmation)
```

**Key Behavior:**
- Accepts an optional prompt with architecture directions; if none given, asks the user interactively; if the user declines, auto-detects the stack and applies best-practice defaults
- Scans the project for tech stack indicators, directory structure, existing patterns, linter configs, and README
- Makes concrete, opinionated decisions for architecture pattern, naming conventions, import rules, type safety, error handling, testing, styling, and documentation standards
- Generates a comprehensive CLAUDE.md with sections for: tech stack, architecture (pattern, file structure, layer rules), coding standards (naming, imports, types, errors, functions), styling guidelines, documentation standards, testing standards, git workflow, commands, and environment
- Respects existing files: requires `--update` to merge or `--force` to overwrite an existing CLAUDE.md
- Differentiates from `!scaffold`: scaffold documents what IS, `!create_claude` prescribes what SHOULD BE
- Serial mode, does not modify source code

---

## Analysis Commands

### `!context`

**Purpose:** Deep context gathering for a specific topic, feature, or domain within the project.

**Syntax:**
```
!context {topic}
```

**Examples:**
```
!context auth
!context payments
!context the dashboard SSE connection
```

**Key Behavior:**
- Expands the topic into multiple search terms (synonyms, technical terms, code identifiers)
- Searches in parallel: Grep for content, Glob for file patterns, TOC for semantic matches
- Reads key architectural files (not every matching file)
- Traces connections across layers: frontend to backend, shared types, config values, data flows
- Produces a structured summary: files by area, architecture description, connections, and key observations
- Read-only, serial mode

---

### `!review`

**Purpose:** Code review of recent changes with full project context. Catches cross-layer breakage that simple linters miss.

**Syntax:**
```
!review                          -- Review all uncommitted changes
!review staged                   -- Review only staged changes
!review HEAD~3..HEAD             -- Review the last 3 commits
!review src/api                  -- Review changes in a specific directory
```

**Key Behavior:**
- Identifies changed files and reads full file context (not just diffs)
- Checks convention compliance against `{project_root}/CLAUDE.md`
- For shared types and API endpoints, traces all consumers to check for breakage
- Reviews code quality, cross-layer impact, and completeness
- Categorizes issues as Critical, Warning, or Suggestion
- Reports missing changes (files that should have been updated but were not)
- Read-only, serial mode

---

### `!health`

**Purpose:** Comprehensive project health audit.

**Syntax:**
```
!health                          -- Full health check
!health --quick                  -- Fast check (skip deep analysis)
```

**Key Behavior:**
- Documentation health: checks CLAUDE.md, TOC existence and freshness, commands directory
- Dependency health: checks `node_modules/`, lock files, dependency manifests
- Cross-layer health (unless `--quick`): API endpoint consistency, `.env.example` completeness, type consistency
- Git status: branch, uncommitted changes, unpushed commits, conflicts
- Produces a health report with status table, cross-layer issues, and prioritized recommendations
- Read-only, serial mode

---

### `!plan`

**Purpose:** Produce a detailed implementation plan for a task without writing any code.

**Syntax:**
```
!plan {task description}
```

**Examples:**
```
!plan add user profile picture upload
!plan migrate from REST to tRPC
```

**Key Behavior:**
- Gathers context: TOC, CLAUDE.md, relevant source files, cross-layer contracts
- For each required change: identifies the file, what changes, why, dependencies, and risks
- Determines execution mode: serial (3 or fewer sequential changes) or parallel (3+ independent changes)
- Presents the plan with dependency ordering, cross-layer impact, risks and mitigations, testing strategy, and estimated scope
- Waits for user approval before any execution begins
- Read-only, serial mode

---

### `!scope`

**Purpose:** Blast radius analysis for a proposed change. Shows what files, directories, and contracts would be affected.

**Syntax:**
```
!scope {task description}
```

**Examples:**
```
!scope rename the User type to Account
!scope migrate from Firebase Auth to Clerk
```

**Key Behavior:**
- Identifies directly related files, indirect dependencies via imports/exports, shared type consumers, and config/deployment impacts
- Produces an impact summary: affected areas, file counts, cross-layer contract impacts
- Lists affected files by area with explanations of what changes and why
- Provides dependency ordering, risks with mitigations, and a recommendation (proceed, break into phases, simplify, or investigate further)
- Read-only, serial mode

---

### `!trace`

**Purpose:** End-to-end code tracing of an API endpoint, function, type, or data flow across the project.

**Syntax:**
```
!trace {target}
```

**Examples:**
```
!trace POST /api/users
!trace getUserProfile
!trace UserProfile type
!trace "user submits signup form"
```

**Key Behavior:**
- Identifies the target type (API endpoint, function, type/interface, or data flow) and chooses the appropriate tracing strategy
- Walks the chain from origin through every step: file-by-file, following imports, function calls, API requests, and event emissions
- Crosses layer boundaries (frontend, backend, database, triggers)
- Documents every transformation, validation, and side effect
- Reports type flow with drift detection (e.g., frontend type differs from backend type)
- Read-only, serial mode

---

### `!contracts`

**Purpose:** API contract audit. Checks consistency between frontend API calls and backend route handlers.

**Syntax:**
```
!contracts                       -- Full audit of all API contracts
!contracts /api/users            -- Audit a specific endpoint group
```

**Key Behavior:**
- Finds all frontend API calls (fetch, axios, useSWR, etc.) with method, path, request/response shapes
- Finds all backend route handlers with method, path, expected request, response, auth requirements, validation
- Matches frontend calls to backend handlers and compares shapes
- Identifies: matched contracts, mismatched contracts (field drift, key casing), orphaned backend endpoints, broken frontend calls
- Reports detailed mismatches with specific field-level differences
- Read-only, serial mode

---

### `!env_check`

**Purpose:** Environment variable consistency audit across the project.

**Syntax:**
```
!env_check                       -- Full audit
!env_check {topic}               -- Check only topic-related env vars
```

**Key Behavior:**
- Searches code for all environment variable access patterns: `process.env`, `import.meta.env`, `NEXT_PUBLIC_*`, `os.environ`, etc.
- Locates all `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.example` files
- Cross-references variables referenced in code against env files
- Reports: missing variables, cross-context inconsistencies, undocumented variables
- Never outputs actual env var values -- only checks key existence and consistency
- Read-only, serial mode

---

## Table of Contents Commands

### `!toc`

**Purpose:** Search the project's semantic Table of Contents to quickly locate files by topic, keyword, or object name.

**Syntax:**
```
!toc {search_query}              -- Text search
!toc #{tag}                      -- Tag-only search
!toc #{tag1} #{tag2}             -- Multi-tag AND search
!toc #{tag} {query}              -- Tag + text search
```

**Examples:**
```
!toc SimulationService
!toc auth middleware
!toc #api #backend
!toc #hook explore
```

**Key Behavior:**
- Reads `{project_root}/.synapse/toc.md` and searches entries by filename, summary, tags, and related files
- Ranks results: exact name match > summary match > tag match > related file match
- Verifies candidates by reading actual files (prevents false positives from stale TOC entries)
- Shows related files for each match (one-hop traversal of `Related:` entries)
- Returns 1-5 most relevant results with path, summary, tags, and related context
- Read-only, serial mode

---

### `!toc_generate`

**Purpose:** Generate a complete Table of Contents from scratch by dispatching parallel agents to scan every directory.

**Syntax:**
```
!toc_generate
```

**Key Behavior:**
- Scans project structure and creates one agent task per directory (or groups of small directories)
- Dispatches all agents in parallel -- the master never reads source files directly
- Each agent reads files in its directory and reports: path, summary, tags, related files, exports, and content hash
- The master assembles results incrementally into `{project_root}/.synapse/toc.md` as agents return
- TOC includes a Project Overview section (summary, tech stack, architecture, key directories) and a per-directory File Index
- Uses content hashes (`<!-- hash:xxxxxxxx -->`) to enable future incremental updates
- Parallelized via `!p` dispatch mode

---

### `!toc_update`

**Purpose:** Incrementally update the Table of Contents for changed files. Much faster than a full `!toc_generate`.

**Syntax:**
```
!toc_update
```

**Key Behavior:**
- Reads the current TOC and scans the filesystem to compute a diff: new files, deleted files, modified files (via content hash comparison), and renamed files (via git history)
- Only dispatches agents for directories with new or modified files
- Preserves unchanged entries verbatim -- does not rewrite or "improve" existing entries
- For renames: carries over existing metadata to the new path and updates cross-references
- Reports the diff before dispatching agents
- If no changes are detected, exits immediately with "TOC is up to date"
- Backward compatible with legacy TOCs that lack hash comments

---

## Project Knowledge Index (PKI) Commands

### `!learn`

**Purpose:** Bootstrap the Project Knowledge Index (PKI) from scratch by dispatching a parallel swarm to deeply annotate every significant file in the project. Produces deep operational knowledge -- gotchas, patterns, conventions, relationships, and domain taxonomy -- that agents can query to understand how the project actually works.

**Syntax:**
```
!learn
```

**Produces:**
- `{project_root}/.synapse/knowledge/manifest.json` -- Master routing index with per-file summaries, domains, tags, and cross-references
- `{project_root}/.synapse/knowledge/annotations/{hash}.json` -- Per-file deep annotation files (flat, hash-keyed)
- `{project_root}/.synapse/knowledge/domains.json` -- Auto-discovered domain taxonomy
- `{project_root}/.synapse/knowledge/patterns.json` -- Cross-cutting patterns and conventions observed across the codebase
- `{project_root}/.synapse/knowledge/queries/` -- Directory for pre-computed domain bundles (created empty, populated by `!context` queries)

**Key Behavior:**
- The master agent never reads source files -- agents do all file reading
- Phase 1 (Discovery): Scans project structure, maps directories, reads CLAUDE.md, creates PKI directory tree
- Phase 2 (Parallel Scan): Decomposes directories into agent tasks, dispatches agents in parallel batches via `!p` dispatch mode. Each agent deeply reads files in its directory and produces annotations covering: purpose, exports (with signatures), imports, gotchas, patterns, conventions, relationships, domain classification, tags, and complexity
- Phase 3 (Assembly): Master assembles annotations incrementally as agents return -- writes per-file annotation files, builds manifest.json with domain/tag indexes and concept map, generates domains.json and patterns.json
- Phase 4 (Report): Prints summary with domain/pattern statistics
- Annotations are operationally deeper than TOC entries -- they include gotchas, patterns, conventions, and bidirectional relationships
- Uses content hashes for staleness detection, enabling future incremental updates via `!learn_update`

---

### `!learn_update`

**Purpose:** Incrementally refresh the Project Knowledge Index (PKI) by detecting stale annotations and re-scanning only changed files. The fast-path complement to `!learn`.

**Syntax:**
```
!learn_update
```

**Key Behavior:**
- Requires an existing PKI (manifest.json must exist; if not, suggests `!learn` instead)
- Detects staleness via three mechanisms: the `stale` flag set by the PostToolUse hook, content hash comparison against stored hashes, and new/deleted file discovery
- Only dispatches agents for files that actually need re-annotation -- unchanged files keep their existing annotations verbatim
- For stale files, includes the previous annotation in the agent prompt so the agent can compare and produce a focused diff
- Updates manifest.json (stats, hashes, stale flags), writes new/updated annotation files, rebuilds domains.json and patterns.json, and clears the query cache
- If zero changes are detected, reports "PKI is up to date" and exits immediately
- If more than 50 files need re-annotation, warns the user and suggests `!learn` for a full rebuild
- Can be auto-triggered at swarm start when `stats.stale > 0` in manifest.json

**When to use `!learn_update` vs `!learn`:**
- `!learn_update` -- After a swarm completes, after manual edits, periodic refreshes. Fast incremental scan.
- `!learn` -- First-time PKI generation, after major refactors (50%+ of codebase), when PKI feels fundamentally out of sync.

---

## Instrumentation Commands

### `!instrument`

**Purpose:** Add `data-synapse-label` attributes to text-bearing JSX/TSX/HTML elements in the target project, making them compatible with Synapse's Live Preview inline editing.

**Syntax:**
```
!instrument                      -- Instrument all JSX/TSX/HTML files
!instrument --dry-run            -- Show what would be changed without modifying files
!instrument --remove             -- Remove all data-synapse-label attributes
```

**Key Behavior:**
- Scans `**/*.{jsx,tsx,html,htm}` files (skipping `node_modules/`, `.next/`, `dist/`, `build/`, `.git/`)
- Finds text-bearing elements: headings (`h1`-`h6`), `p`, `span`, `button`, `a`, `label`, `li`, `td`, `th`, `caption`, `figcaption`, `blockquote`, `dt`, `dd`
- Adds a `data-synapse-label` attribute with a globally unique UUID to each qualifying element
- Already-labeled elements are skipped on re-runs (idempotent)
- `--dry-run` reports what would change without modifying files
- `--remove` strips all `data-synapse-label` attributes from the project
- Reports: files scanned, files modified, labels added/removed, and any errors
- Requires a target project to be set (`!project set`)

---

## Audit Commands

### `!prompt_audit`

**Purpose:** Post-swarm prompt quality audit. Analyzes worker performance and prompt quality indicators by reading progress files to evaluate stage progression, log density, deviation patterns, upstream result completeness, and task outcome correlation.

**Syntax:**
```
!prompt_audit                                -- Audit your assigned dashboard
!prompt_audit dashboard3                     -- Audit a specific dashboard
```

**Key Behavior:**
- Read-only -- does not modify any files
- Reads initialization.json and all progress files to collect per-task metrics: template version, duration, stage progression, deviation count/severity, log density, milestone count, prompt size
- Analyzes upstream result completeness for dependent tasks -- checks whether workers logged evidence of reading upstream progress files
- Checks for convention map presence (optimization indicator)
- Assigns each task a letter grade (A through F) based on collected metrics
- Generates a quality scorecard with per-task grades, summary statistics (average duration, failure rate, deviation rate, upstream gap rate, log density, template version coverage, prompt size), and grade distribution
- Produces 2-5 actionable recommendations based on threshold triggers (high failure rate, upstream gaps, low log density, high deviation rate, missing template versions, CRITICAL deviations, prompt size outliers)
- Serial mode

---

## Discovery Commands

### `!commands`

**Purpose:** List all available commands from all locations.

**Syntax:**
```
!commands
```

**Key Behavior:**
- Scans all `_commands/` directories dynamically: `{tracker_root}/_commands/Synapse/`, `{tracker_root}/_commands/project/`, and `{project_root}/_commands/`
- Extracts command names and one-line descriptions from each file
- Groups commands by source location
- Serial mode, instant output

---

### `!profiles`

**Purpose:** List all available agent role profiles.

**Syntax:**
```
!profiles
```

**Key Behavior:**
- Scans `{tracker_root}/_commands/profiles/` for all `.md` files
- Reads each file to extract the role title and usage summary
- Displays a formatted table with profile name, role, and "best used for" description
- Includes usage syntax reminder showing how profiles compose with commands
- Serial mode

---

### `!help`

**Purpose:** Practical guide to getting the most out of Synapse.

**Syntax:**
```
!help
```

**Key Behavior:**
- Displays command reference organized by category (context/discovery, parallel execution, auditing, project management)
- Includes workflow tips: start with context, let agents go parallel, be specific in prompts, keep CLAUDE.md current
- Shows common workflow patterns for new features, session starts, and periodic maintenance
- Serial mode, instant output

---

### `!guide`

**Purpose:** Interactive command decision tree.

**Syntax:**
```
!guide
```

**Key Behavior:**
- Displays a visual decision tree organized by "what do you want to do?" categories
- Covers: project setup, starting parallel work, monitoring, taking action on tasks, viewing history, server control, project analysis, TOC management, profiles/discovery, and housekeeping
- Includes a full command reference table and quick-pick tips
- Serial mode, instant output
