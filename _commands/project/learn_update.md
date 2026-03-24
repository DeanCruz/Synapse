# `!learn_update`

**Purpose:** Incrementally refresh the Project Knowledge Index (PKI) by detecting stale annotations and re-scanning only changed files. This is the fast-path complement to `!learn` (full cold-start generation). It detects staleness via content hashes, the `stale` flag set by the PostToolUse hook, and new/deleted file discovery — then dispatches parallel agents only for files that actually need re-annotation.

**Syntax:** `!learn_update`

**Produces:** An updated `{project_root}/.synapse/knowledge/` directory with refreshed annotations for changed files, updated manifest.json stats and hashes, rebuilt domain and pattern indexes, and cleaned-up entries for deleted files.

**When to use:**
- After a swarm completes (files were modified, PostToolUse hook marked them stale)
- Before starting a new swarm (auto-trigger: check if `stats.stale > 0` in manifest.json)
- After manual edits to the project (user modified files outside of Synapse)
- Periodically during long development sessions

**When to use `!learn` instead:**
- First-time PKI generation (no manifest.json exists)
- After major refactors that touched 50%+ of the codebase
- When the PKI feels fundamentally out of sync (many missing annotations, broken indexes)
- If `!learn_update` reports more than 50 stale/new files, suggest `!learn` for a cleaner result

---

## Phase 1: Load Existing PKI

### Step 1: Read the manifest

Read `{project_root}/.synapse/knowledge/manifest.json` in full.

If the file does not exist, abort with:

```
No PKI manifest found. Run `!learn` first to generate the initial Project Knowledge Index.
```

Parse the manifest to extract:
- `version` — confirm it is a supported version
- `stats` — current counts (`total_files`, `annotated`, `stale`)
- `files` — the full file-to-annotation mapping

### Step 2: Identify pre-flagged stale entries

Scan the `files` object for entries where `stale: true`. These were marked by the PostToolUse hook when agents wrote to them during a swarm. Build a **stale set** of file paths.

### Step 3: Identify deleted files

For every file path in the manifest's `files` object, check whether the file still exists on disk. Build a **deleted set** of file paths that are in the manifest but no longer on disk.

### Step 4: Identify new files

Scan the project file tree using Glob patterns appropriate to the project's tech stack:

```
Glob: {project_root}/src/**/*.ts
Glob: {project_root}/src/**/*.tsx
Glob: {project_root}/src/**/*.js
Glob: {project_root}/src/**/*.jsx
Glob: {project_root}/lib/**/*.ts
Glob: {project_root}/**/*.py
... (adapt patterns per project's tech stack from CLAUDE.md)
```

**Skip:** `node_modules/`, `.next/`, `dist/`, `.git/`, `*.lock`, build artifacts, auto-generated files, and anything in `.synapse/` itself.

Compare the filesystem set against the manifest's `files` keys. Files on disk but NOT in the manifest are **new files**. Build a **new set** of file paths.

---

## Phase 2: Detect Changes

### Step 5: Compute content hashes for non-stale files

For every file that exists in both the manifest and on disk (and is NOT already in the stale set), compute its current content hash:

```bash
shasum -a 256 {file_path} | cut -c1-8
```

Compare against the stored `content_hash` in the manifest entry. If the hashes differ, the file has been modified outside of agent workflows (no PostToolUse hook fired). Add it to the **stale set**.

This catches:
- Manual edits by the user
- Changes made by tools that bypass the PostToolUse hook
- Files modified by non-Synapse processes

### Step 6: Build the change summary

Combine all detected changes into a unified diff report:

```markdown
## PKI Change Summary

**Stale annotations (hook-flagged):** {N}
**Stale annotations (hash mismatch):** {N}
**New files (no annotation):** {N}
**Deleted files (annotation orphaned):** {N}
**Unchanged:** {N}

### Stale Files (need re-annotation)
- `src/services/UserService.ts` (flagged by hook)
- `src/utils/helpers.js` (hash: `a1b2c3d4` -> `e5f6g7h8`)
- ...

### New Files (need initial annotation)
- `src/services/NewService.ts`
- `src/hooks/useNewFeature.ts`
- ...

### Deleted Files (will be removed)
- `src/lib/oldService.ts`
- ...
```

If there are **zero changes** (no stale, no new, no deleted files), report "PKI is up to date" and exit immediately. Do not dispatch agents or rewrite any files.

If there are **more than 50 files** needing re-annotation (stale + new), warn the user and suggest running `!learn` instead for a full rebuild.

---

## Phase 3: Re-scan (`!p` dispatch)

**This phase is parallelized.** The master dispatches agents only for stale and new files. Unchanged files are never re-read.

### Step 7: Group files into agent tasks

Group stale and new files by directory. Each agent handles one directory's worth of files.

**Agent sizing:**
- **One directory with 3+ files** -> one agent
- **Multiple directories with 1-2 files each** -> group into a single agent (up to ~10 files per agent)

### Step 8: Dispatch annotation agents

Each agent receives a prompt:

```
You are re-scanning files for the Project Knowledge Index (PKI).

## Project Context
{Relevant CLAUDE.md excerpt — architecture, conventions, tech stack, domain language}

## Existing Domain Taxonomy
{Contents of domains.json — so the agent uses consistent domain labels}

## Files to Annotate
{list of file paths with annotation type: "stale" or "new"}

## For Stale Files — Previous Annotation
{For each stale file, include the existing annotation content so the agent
can compare and produce a focused diff rather than starting from scratch}

## Your Task
For each file, read it and produce a complete annotation in this format:

### {filename}
- **Path:** `{relative_path}`
- **Purpose:** 1-2 sentences — what this file does and its architectural role
- **Domain:** Primary domain from the taxonomy (e.g., "auth", "api", "ui")
- **Layer:** architectural layer (e.g., "service", "controller", "utility", "component", "hook", "config")
- **Exports:** Key exported symbols with types — `functionName(params): returnType`
- **Dependencies:** Internal imports (project files only, not node_modules)
- **Consumers:** Files that import from this file (check via grep if possible)
- **Tags:** 3-8 lowercase tags for cross-cutting concerns
- **Patterns:** Any notable patterns used (e.g., "singleton", "factory", "observer", "middleware chain")
- **Complexity:** simple | moderate | complex
- **Content Hash:** Run `shasum -a 256 {file_path} | cut -c1-8`

For stale files: compare against the previous annotation. If changes are minor
(bug fixes, formatting), preserve the existing annotation with only the content
hash updated. If changes are significant (new exports, changed purpose, different
dependencies), produce a fully updated annotation.
```

### Step 9: Process returns

As agents return, collect all annotation data. Validate that:
- Every requested file has an annotation
- Annotations are specific and useful (not generic filler)
- Content hashes are present and correctly formatted (8 hex chars)

---

## Phase 4: Merge

### Step 10: Update manifest.json

Read `{project_root}/.synapse/knowledge/manifest.json` (re-read in case of context compaction).

Apply the following changes:

#### Stale files (re-annotated)
For each stale file with a successful agent return:
1. Update `content_hash` to the new hash from the agent
2. Set `stale` to `false`
3. Update `last_annotated` to the current ISO timestamp
4. Keep the existing `hash` (annotation file hash) — it will be updated after writing the annotation file

#### New files
For each new file with a successful agent return:
1. Add a new entry to `files` with:
   - `hash`: computed after writing the annotation file
   - `content_hash`: from the agent return
   - `stale`: `false`
   - `last_annotated`: current ISO timestamp

#### Deleted files
For each deleted file:
1. Remove the entry from `files`
2. Delete the corresponding annotation file from `{project_root}/.synapse/knowledge/annotations/`

#### Update stats
Recompute:
- `total_files`: count of entries in `files`
- `annotated`: count of entries where an annotation file exists
- `stale`: count of entries where `stale: true` (should be 0 after a successful update)

Write the updated manifest back to `{project_root}/.synapse/knowledge/manifest.json`.

### Step 11: Write annotation files

For each stale or new file with agent-returned annotation data:

1. Format the annotation as a JSON file matching the annotation schema
2. Compute the annotation file hash: `shasum -a 256 <annotation_content> | cut -c1-8`
3. Write to `{project_root}/.synapse/knowledge/annotations/{hash}.json`
4. If this is a stale file and the new annotation hash differs from the old one, delete the old annotation file
5. Update the `hash` field in manifest.json to point to the new annotation file

### Step 12: Rebuild domains.json

Read the current `{project_root}/.synapse/knowledge/domains.json`.

Scan all annotation files (not just the updated ones) to rebuild the domain taxonomy:
- Collect all unique `domain` values across annotations
- For each domain, list the files that belong to it
- Update file counts per domain
- Add any new domains discovered in the updated annotations
- Remove domains that no longer have any files (all their files were deleted)

Write the updated `domains.json` back.

### Step 13: Rebuild patterns.json

Read the current `{project_root}/.synapse/knowledge/patterns.json`.

Scan all annotation files to rebuild the cross-cutting patterns index:
- Collect all unique `patterns` values across annotations
- For each pattern, list the files that use it
- Update file counts per pattern
- Add any new patterns discovered in the updated annotations
- Remove patterns that no longer have any files

Write the updated `patterns.json` back.

### Step 14: Clear query cache

Delete all files in `{project_root}/.synapse/knowledge/queries/`. These are pre-computed domain bundles that are now potentially stale. They will be regenerated on demand by future `!context` or swarm queries.

---

## Phase 5: Report

### Step 15: Output the summary

```markdown
## PKI Updated

- **Files re-annotated (stale):** {N}
- **Files annotated (new):** {N}
- **Files removed (deleted):** {N}
- **Unchanged:** {N}
- **Agents dispatched:** {N}
- **Query cache cleared:** yes/no

### Re-annotated
- `{path}` (hash: `{old}` -> `{new}`)
- ...

### Newly Annotated
- `{path}` — {purpose summary}
- ...

### Removed
- `{path}`
- ...

### Domain Changes
- New domains: {list or "none"}
- Removed domains: {list or "none"}

### Pattern Changes
- New patterns: {list or "none"}
- Removed patterns: {list or "none"}

The Project Knowledge Index has been updated.
```

---

## Auto-trigger at Swarm Start

When starting a new swarm (via `!p_track` or `!p`), the master agent should check:

1. Does `{project_root}/.synapse/knowledge/manifest.json` exist?
2. If yes, read `stats.stale` — is it greater than 0?
3. If stale count > 0, run `!learn_update` automatically before planning the swarm.

This ensures the PKI is fresh before agents use it for context gathering. The auto-trigger should be silent (no user confirmation needed) unless:
- The stale count exceeds 50 files (suggest `!learn` instead)
- The manifest is missing (suggest `!learn` for initial generation)

---

## Rules

- **Only re-scan changed files.** The entire point of `!learn_update` is speed. Never re-read or re-annotate files whose content hash matches and whose `stale` flag is `false`. Unchanged files keep their existing annotations verbatim.
- **Preserve existing annotations for unchanged files.** Do not rewrite, rephrase, or "improve" annotations that have not changed. Only touch stale, new, and deleted entries.
- **Handle deleted files cleanly.** Remove the file's entry from manifest.json AND delete its annotation file from `annotations/`. Do not leave orphaned annotation files.
- **Rebuild indexes after merge.** Always rebuild `domains.json` and `patterns.json` after updating annotations, even if only one file changed. Index consistency is more important than speed here.
- **Clear the query cache.** Always delete files in `queries/` after any update. Stale cached bundles are worse than no cache.
- **Respect the PostToolUse hook.** The `stale` flag in manifest.json is the primary staleness signal. Content hash comparison is the secondary fallback for changes that bypass the hook. Both are checked.
- **Annotations must be useful.** Same quality standard as `!learn` — every annotation should let an agent or developer understand the file's purpose, role, and connections without opening it.
- **If the diff is large (50+ files), suggest `!learn`.** Incremental updates work best for small-to-medium changes. A full rebuild produces cleaner, more consistent results for large drifts.
- **If no changes are detected, exit immediately.** Report "PKI is up to date" and do not dispatch agents or rewrite any files.
- **Update atomically.** When modifying manifest.json, domains.json, or patterns.json, read the full file, apply all changes in memory, and write the complete file. Never do partial writes or incremental appends.
- **Include previous annotations in agent prompts for stale files.** When dispatching scan agents for stale files, the old annotation data must be included so the agent can compare and produce a minimal diff rather than regenerating from scratch.
- **Do not modify files outside the PKI directory.** This command only writes to `{project_root}/.synapse/knowledge/`. It never modifies source code, TOC files, or other Synapse artifacts.
- **Log the auto-trigger decision.** When running as an auto-trigger at swarm start, log whether the update was triggered and how many files were refreshed, so the user has visibility into background PKI maintenance.
