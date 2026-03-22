# Table of Contents System

The Table of Contents (TOC) is a **semantic index** of every significant file in the target project. It provides structured summaries, tags, cross-references, and content hashes that enable fast file discovery without blind searching. The TOC lives at `{project_root}/.synapse/toc.md`.

---

## Why the TOC Exists

In large codebases, finding the right file is half the battle. Glob and Grep are powerful but limited -- they search by filename patterns and content, not by purpose or role. The TOC fills this gap:

- **What does `src/services/ProductService.ts` do?** The TOC summary tells you without opening the file.
- **Which files handle authentication?** Search the TOC by tag `#auth` or keyword "authentication."
- **What depends on `UserModel`?** Check the Related entries in the TOC.
- **Has this file changed since the TOC was generated?** Compare the content hash.

The master agent uses the TOC during planning to understand the codebase structure and identify which files need to be modified. Workers can reference it for context. Users can search it with `!toc` to navigate the project.

---

## TOC Structure

The TOC has two main sections:

### Section 1: Project Overview

A high-level summary at the top of the file:

```markdown
# Table of Contents -- Project Index

> Last updated: 2026-03-22

## Project Overview

### Summary
A full-stack e-commerce platform serving B2B wholesale buyers with
real-time inventory, tiered pricing, and order management.

### Tech Stack
| Technology | Usage |
|---|---|
| TypeScript | Primary language |
| Next.js | Frontend framework |
| Express | API server |
| PostgreSQL | Database |

### Architecture
Monolithic API server with Next.js frontend. Services layer handles
business logic, repositories handle data access. Shared types package
for frontend-backend type safety.

### Key Directories
| Directory | Purpose |
|---|---|
| src/components/ | React UI components |
| src/services/ | Business logic services |
| src/api/ | API route handlers |
| config/ | Configuration files |
```

### Section 2: File Index

Every significant file, grouped by directory:

```markdown
## src/services/

Business logic layer. Each service encapsulates domain operations.

- **`ProductService.ts`** -- Provides paginated browsing, category filtering,
  and featured sorting for the product catalog [tags: service, product, api, typescript]
  <!-- hash:a1b2c3d4 -->
  - Related: `src/models/Product.ts`, `src/api/products.ts`
  - Exports: `ProductService`, `ProductFilters`

- **`OrderService.ts`** -- Handles order creation, status updates, and
  fulfillment tracking with webhook notifications [tags: service, order, webhook, typescript]
  <!-- hash:e5f6g7h8 -->
  - Related: `src/models/Order.ts`, `src/api/orders.ts`, `src/services/NotificationService.ts`
  - Exports: `OrderService`, `OrderStatus`
```

### Entry Format

Each file entry includes:

| Component | Format | Purpose |
|---|---|---|
| **Filename** | Bold text | Quick identification |
| **Summary** | Inline after em-dash | 1-3 sentences describing purpose, role, key behavior |
| **Tags** | `[tags: tag1, tag2]` | Lowercase, comma-separated for search |
| **Content hash** | `<!-- hash:xxxxxxxx -->` | First 8 chars of SHA-256 for change detection |
| **Related** | Indented sub-line | Direct dependencies and consumers |
| **Exports** | Indented sub-line | Key public symbols |

---

## Generating the TOC

### Full Generation: `!toc_generate`

Builds the entire TOC from scratch by dispatching a parallel agent swarm to scan every directory in the project.

```bash
!toc_generate
```

#### How It Works

**Phase 1: Discovery**

The master agent:
1. Scans the project structure (`ls` of top-level directories)
2. Maps each directory's subdirectories to determine scope
3. Reads `{project_root}/CLAUDE.md` for project context

**Phase 2: Parallel Scan**

The master dispatches agents (one per directory or group of small directories) to read every file and report back structured metadata. The master never reads source files directly -- agents do all file reading.

Each agent receives a prompt specifying:
- Which directory to scan
- What to report for each file (path, summary, tags, related, exports, hash)
- Project context from `CLAUDE.md`

Agents are dispatched in parallel batches for maximum throughput.

**Phase 3: Streaming Assembly**

As agents return, the master incrementally assembles the TOC. It does not wait for all agents to finish. Each return is integrated immediately. This protects against context loss from session interruption.

#### Sizing and Exclusions

- Directories with 3+ files get their own agent
- Small directories (1-2 files) are grouped into a single agent
- Skipped: `node_modules/`, `.next/`, `dist/`, `.git/`, `*.lock`, auto-generated files

#### Output

```
## TOC Generated

- Directories scanned: 24
- Files indexed: 187
- Agents dispatched: 18

The Table of Contents has been written to .synapse/toc.md.
```

---

## Updating the TOC

### Incremental Update: `!toc_update`

Updates the TOC by detecting changes since the last generation. Only scans new and modified files -- much faster than a full regeneration.

```bash
!toc_update
```

#### How It Works

**Phase 1: Diff Detection**

1. **Read the current TOC** -- parse all documented file paths into an indexed set.
2. **Scan the filesystem** -- build a set of all significant files on disk.
3. **Detect renames** -- check `git diff --name-status -M` for recent renames.
4. **Compute the diff:**
   - **New files** -- on disk but not in the TOC
   - **Deleted files** -- in the TOC but not on disk
   - **Renamed files** -- old path in TOC, new path on disk (confirmed via git)
   - **Modified files** -- content hash changed (hash in TOC vs. current `shasum`)

If zero changes are detected, report "TOC is up to date" and exit.

**Phase 2: Parallel Scan**

Agents scan only new and modified files (not the entire project). Modified files receive the old TOC entry as context so agents can decide whether to keep or rewrite the summary.

**Phase 3: TOC Update**

- **Deletions:** Remove entries for deleted files; remove empty directory sections.
- **Additions:** Insert new entries into the correct directory section.
- **Modifications:** Replace entries with updated summaries, tags, and hashes.
- **Renames:** Update the path, preserve metadata, fix cross-references in other entries.
- **Date:** Update "Last updated" to today.

#### Output

```
## TOC Updated

- Files added: 5
- Files removed: 2
- Files modified: 3
- Files renamed: 1
- New directories: 1
- Agents dispatched: 4
```

---

## Searching the TOC

### `!toc {query}`

Fast semantic search across the TOC:

```bash
!toc SimulationService          # Find a specific service
!toc auth middleware             # Search by topic
!toc how generations work       # Descriptive search
!toc #api                       # Tag-based search
!toc #hook explore              # Tag + keyword
!toc #api #backend              # Multiple tags (AND logic)
```

#### Search Modes

**General text search:** Matches against file names, summaries, tags, and related files. Results ranked by relevance (exact name match > summary match > tag match > related file match).

**Tag-based search (prefix `#`):** Filters entries by tag. Multiple tags use AND logic. Can be combined with text keywords.

#### Result Format

```
## TOC Search: "auth middleware"

### Results

**1. authMiddleware.ts**
- Path: src/middleware/authMiddleware.ts
- Summary: JWT validation middleware for protected API routes.
  Extracts token from Authorization header, verifies signature,
  and attaches decoded user to request context.
- Tags: middleware, auth, jwt, typescript
- Related Context:
  - src/services/TokenService.ts -- JWT sign/verify/refresh operations
  - src/config/auth.ts -- Auth configuration constants

**2. rateLimiter.ts**
- Path: src/middleware/rateLimiter.ts
- Summary: Rate limiting middleware for auth endpoints.
  Limits each IP to 100 requests per 15-minute window.
- Tags: middleware, auth, rate-limit, security
```

#### Verification

The `!toc` command verifies each candidate by reading the actual file to confirm it matches what the TOC claims. This prevents false positives from stale entries.

#### Related File Traversal

For each result, `!toc` checks the Related entries and looks up their TOC entries. This provides one-hop discovery -- showing not just the file you searched for, but the files it works with.

---

## Content Hashes

Every TOC entry includes a content hash (`<!-- hash:xxxxxxxx -->`). This is the first 8 characters of the file's SHA-256 hash.

### Purpose

Content hashes enable `!toc_update` to detect which files have changed without re-reading every file. The workflow:

1. Parse the TOC to extract each file's stored hash.
2. Compute the current hash: `shasum -a 256 {file_path} | cut -c1-8`.
3. If hashes differ, the file has been modified and needs re-scanning.
4. If hashes match, the file is unchanged -- skip it.

### Backward Compatibility

TOC entries without hash comments (from older TOC generations) are treated as unchanged. They will gain hashes the next time they are modified and re-scanned.

---

## Monorepo TOC Organization

For monorepo projects, the TOC is organized by package:

```markdown
## @myorg/api (packages/api/)
{files in the API package}

## @myorg/web (packages/web/)
{files in the web frontend}

## @myorg/shared (packages/shared/)
{files in the shared types package}

## Root-level files
{files not in any package}
```

This organization makes large monorepos navigable by scoping file entries to their package context. The monorepo structure is detected from `.synapse/config.json` during `!toc_generate`.

---

## Best Practices

### Summaries

Good summaries let a reader determine relevance without opening the file:

| Quality | Example |
|---|---|
| Bad | "A TypeScript file" |
| Bad | "A service" |
| Good | "Rate limiter middleware -- limits each IP to N requests per window, returns 429 with Retry-After header" |
| Good | "Provides paginated browsing, category filtering, and featured sorting for the product catalog" |

### Tags

Use consistent lowercase tags covering:
- **Technology:** typescript, react, node, postgresql
- **Domain:** auth, product, order, user
- **Role:** service, hook, component, middleware, config, model
- **Feature:** pagination, search, notification, caching

### When to Regenerate vs. Update

| Scenario | Command |
|---|---|
| First-time TOC creation | `!toc_generate` |
| After major restructuring | `!toc_generate` |
| After adding a few files | `!toc_update` |
| After renaming/moving files | `!toc_update` |
| TOC is severely stale (50+ changes) | `!toc_generate` |
| Regular maintenance | `!toc_update` |

---

## Key Source Files

| File | Purpose |
|---|---|
| `_commands/project/toc_generate.md` | Full `!toc_generate` command specification |
| `_commands/project/toc_update.md` | Full `!toc_update` command specification |
| `_commands/project/toc.md` | `!toc` search command specification |
