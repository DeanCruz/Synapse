# `!toc_update`

**Purpose:** Incrementally update `toc.md` by detecting new, deleted, and moved files since the last TOC generation. Dispatches parallel agents only for directories with changes — much faster than a full `!toc_generate`. Use this for routine maintenance after adding features, creating files, or making small structural changes.

**Syntax:** `!toc_update`

**Produces:** An updated `{project_root}/.synapse/toc.md` with new files added, deleted files removed, and stale entries corrected.

---

## Phase 1: Diff Detection

### Step 1: Read the current TOC

Read `{project_root}/.synapse/toc.md` in full. Parse every file entry to build an **indexed set** of all currently documented file paths.

### Step 2: Scan the filesystem

Scan the project file tree using Glob patterns appropriate to the project's tech stack:

```
Glob: {project_root}/src/**/*.ts
Glob: {project_root}/src/**/*.tsx
Glob: {project_root}/src/**/*.js
Glob: {project_root}/src/**/*.jsx
Glob: {project_root}/lib/**/*.ts
Glob: {project_root}/_commands/**/*.md
Glob: {project_root}/**/*.md (for docs)
... (adapt patterns per project's tech stack)
```

**Skip:** `node_modules/`, `.next/`, `dist/`, `.git/`, `*.lock`, build artifacts, auto-generated files.

Build a **filesystem set** of all significant file paths.

### Step 3: Compute the diff

Compare the two sets:

- **New files** = files on disk but NOT in the TOC
- **Deleted files** = files in the TOC but NOT on disk
- **Unchanged files** = files in both (no action needed)

Also check for:
- **New directories** — a directory on disk that has no section in the TOC
- **Empty sections** — TOC sections where all files have been deleted

Report the diff to the terminal:

```markdown
## TOC Diff

**New files:** {N}
**Deleted files:** {N}
**Unchanged:** {N}

### New Files
- `src/services/NewService.ts`
- `src/hooks/explore/useExploreFilters.ts`
- ...

### Deleted Files
- `src/lib/services/oldService.ts`
- ...

### New Directories
- `src/newModule/` (not in TOC at all)
- ...
```

If there are **zero changes**, report "TOC is up to date" and exit.

---

## Phase 2: Parallel Scan (`!p` dispatch)

**This phase is parallelized.** The master dispatches agents to read only the NEW files and report back context.

### Step 4: Group new files into agent tasks

Group new files by directory. Each agent handles one directory's worth of new files.

**Agent sizing:**
- **One directory with 3+ new files** -> one agent
- **Multiple directories with 1-2 new files each** -> group into a single agent (up to ~10 files per agent)

### Step 5: Dispatch scan agents

Each agent receives a prompt:

```
You are scanning new files that need to be added to the project Table of Contents.

## Files to Scan
{list of file paths}

## Your Task
For each file, read it and report:

1. **File path** — relative to project root
2. **Summary** — 1-3 sentences: what this file does, what it exports, its role. Be specific and useful.
3. **Tags** — 3-8 lowercase tags (technology, domain, role, feature)
4. **Related files** — Direct imports/dependencies/consumers (paths relative to project root)
5. **Exports** — Key exported symbols other files consume

## Context
{Relevant CLAUDE.md excerpt — architecture, conventions, tech stack}

## Output Format
### {filename}
- **Path:** `{relative_path}`
- **Summary:** {description}
- **Tags:** {tag1}, {tag2}, ...
- **Related:** `{path1}`, `{path2}`, ...
- **Exports:** `Symbol1`, `Symbol2`, ...
```

### Step 6: Process returns

As agents return, collect all new file entries. Validate that summaries are specific and useful (not generic filler).

---

## Phase 3: TOC Update

### Step 7: Apply changes to the TOC

Read `{project_root}/.synapse/toc.md` again (in case of context compaction).

Apply the following changes:

#### Deletions
- Remove every entry for a file that no longer exists on disk
- If removing the last file in a directory section, remove the directory heading too

#### Additions
- Insert new file entries into the correct directory section
- If a directory section doesn't exist yet, create it in the logical position (source code sections first, then config, then docs, then commands)
- Follow the exact formatting of existing entries — bold filenames, inline summaries, bracketed tags, indented related/exports

#### Project Overview
- If major structural changes were detected, update the Project Overview section at the top of the TOC

### Step 8: Update the date

Set the "Last updated" line to today's date.

### Step 9: Write the file

Write the updated TOC to `{project_root}/.synapse/toc.md`.

### Step 10: Report

```markdown
## TOC Updated

- **Files added:** {N}
- **Files removed:** {N}
- **New directories:** {N}
- **Agents dispatched:** {N}

### Added
- `{path}` — {summary}
- ...

### Removed
- `{path}`
- ...

The Table of Contents has been updated.
```

---

## Rules

- **The master agent does NOT read source files.** Agents read new files. The master only reads the TOC, directory listings, CLAUDE.md, and agent returns.
- **Only scan new files.** Do not re-read files that are already documented in the TOC. The point of `!toc_update` is to be fast — only process the diff.
- **Preserve existing entries verbatim.** Do not rewrite, rephrase, or "improve" entries for files that haven't changed. Only touch new and deleted entries.
- **Summaries must be useful.** Same standard as `!toc_generate` — every summary should let a reader determine relevance without opening the file.
- **If the diff is large (50+ new files),** consider suggesting `!toc_generate` instead for a cleaner result. Incremental updates work best for small-to-medium changes.
- **If no changes are detected,** report "TOC is up to date" and exit immediately. Do not dispatch agents or rewrite the file.
- **Update the date.** Always set "Last updated" to today's date when changes are made.
