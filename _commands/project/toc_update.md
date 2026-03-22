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

### Step 2b: Detect renames via git history

Before computing the filesystem diff, check git for recent renames:

1. Run: `git -C {project_root} diff --name-status -M HEAD~10` (or since the TOC's "Last updated" date if available via `git log --since="{date}" --diff-filter=R --name-status -M`).
2. Parse the output for lines starting with `R` (rename). These have the format: `R{similarity}\t{old_path}\t{new_path}`.
3. For each detected rename:
   a. Check if the old path exists in the current TOC.
   b. Check if the new path exists on disk but NOT in the TOC.
   c. If both conditions are met, this is a confirmed rename.

Build a **renames map**: `{ new_path: old_path }`.

In Step 3 (Compute the diff), use the renames map to:
- Remove confirmed renames from the "new files" set (they are not truly new)
- Remove confirmed renames from the "deleted files" set (they are not truly deleted)
- Add confirmed renames to a new **renamed files** set

### Step 3: Compute the diff

Compare the two sets:

- **New files** = files on disk but NOT in the TOC (excluding confirmed renames from Step 2b)
- **Deleted files** = files in the TOC but NOT on disk (excluding confirmed renames from Step 2b)
- **Renamed files** = confirmed renames from Step 2b (old path in TOC, new path on disk)
- **Unchanged files** = files in both (passed to Step 3b for content hash comparison)

Also check for:
- **New directories** — a directory on disk that has no section in the TOC
- **Empty sections** — TOC sections where all files have been deleted

Report the diff to the terminal:

```markdown
## TOC Diff

**New files:** {N}
**Deleted files:** {N}
**Modified files:** {N}
**Renamed files:** {N}
**Unchanged:** {N}

### New Files
- `src/services/NewService.ts`
- `src/hooks/explore/useExploreFilters.ts`
- ...

### Deleted Files
- `src/lib/services/oldService.ts`
- ...

### Modified Files
- `src/services/UserService.ts` (hash: `a1b2c3d4` -> `e5f6g7h8`)
- ...

### Renamed Files
- `src/lib/oldName.ts` -> `src/lib/newName.ts`
- ...

### New Directories
- `src/newModule/` (not in TOC at all)
- ...
```

If there are **zero changes** (no new, deleted, modified, or renamed files), report "TOC is up to date" and exit.

### Step 3b: Detect modified files via content hash

For every file that exists both on disk and in the TOC (the "unchanged" set from Step 3), check whether its content has changed:

1. Parse the TOC entry to extract the embedded hash from the `<!-- hash:xxxxxxxx -->` comment.
2. Compute the current hash: `shasum -a 256 {file_path} | cut -c1-8`.
3. If the hashes differ, the file's content has changed since the TOC was last generated. Add it to a new **modified files** set.
4. If the TOC entry has no hash comment (legacy TOC generated before hashing was added), skip it — do not flag as modified.

Report modified files in the diff output (included in the diff report above under "Modified Files"):

```
- `src/services/UserService.ts` (hash: `a1b2c3d4` -> `e5f6g7h8`)
```

Modified files are treated the same as new files for agent scanning — they need their summaries, tags, and related files re-generated. However, the old entry's metadata is preserved and passed to the scanning agent as context (see Step 5 changes below).

---

## Phase 2: Parallel Scan (`!p` dispatch)

**This phase is parallelized.** The master dispatches agents to read new and modified files and report back context.

### Step 4: Group new and modified files into agent tasks

Group new files and modified files by directory. Each agent handles one directory's worth of files to scan.

**Agent sizing:**
- **One directory with 3+ files (new or modified)** -> one agent
- **Multiple directories with 1-2 files each** -> group into a single agent (up to ~10 files per agent)

### Step 5: Dispatch scan agents

Each agent receives a prompt:

```
You are scanning files that need to be added to or updated in the project Table of Contents.

## New Files to Scan
{list of new file paths}

## Modified Files to Re-scan
{list of modified file paths}

## Your Task
For each file, read it and report:

1. **File path** — relative to project root
2. **Summary** — 1-3 sentences: what this file does, what it exports, its role. Be specific and useful.
3. **Tags** — 3-8 lowercase tags (technology, domain, role, feature)
4. **Related files** — Direct imports/dependencies/consumers (paths relative to project root)
5. **Exports** — Key exported symbols other files consume
6. **Hash** — Run `shasum -a 256 {file_path} | cut -c1-8` and report the 8-char hash

## Context
{Relevant CLAUDE.md excerpt — architecture, conventions, tech stack}

## Output Format
### {filename}
- **Path:** `{relative_path}`
- **Summary:** {description}
- **Tags:** {tag1}, {tag2}, ...
- **Related:** `{path1}`, `{path2}`, ...
- **Exports:** `Symbol1`, `Symbol2`, ...
- **Hash:** `{8-char-hash}`
```

For modified files (content hash changed), include in the agent prompt:

```
## Previously Documented Entry
- **Summary:** {old summary from TOC}
- **Tags:** {old tags}
- **Related:** {old related files}
- **Exports:** {old exports}
- **Previous hash:** {old hash}

Review the file's current content. If the changes are minor (e.g., bug fixes, formatting), keep the existing summary and tags. If the changes are significant (e.g., new API, rewritten logic, different exports), write new summary, tags, related, and exports. Always compute and report the new content hash.
```

### Step 6: Process returns

As agents return, collect all new and updated file entries. Validate that summaries are specific and useful (not generic filler).

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

#### Modifications
- For each modified file (content hash changed), replace the existing TOC entry with the agent's updated entry
- Preserve the entry's position in the TOC — do not move it to a different section
- Update the `<!-- hash:xxxxxxxx -->` comment with the new hash value

#### Renames
For each renamed file:
1. Find the old entry in the TOC.
2. Copy its summary, tags, related files, and exports to the new path.
3. Update the path in the entry.
4. If the content hash also changed (file was renamed AND modified), the scanning agent will have provided updated metadata — use the agent's output instead.
5. Update any `Related:` entries in OTHER TOC entries that referenced the old path to point to the new path.
6. Remove the old entry.

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
- **Files modified:** {N} (content hash changed, re-scanned)
- **Files renamed:** {N} (metadata preserved)
- **New directories:** {N}
- **Agents dispatched:** {N}

### Added
- `{path}` — {summary}
- ...

### Removed
- `{path}`
- ...

### Modified
- `{path}` (hash: `{old}` -> `{new}`)
- ...

### Renamed
- `{old_path}` -> `{new_path}`
- ...

The Table of Contents has been updated.
```

---

## Rules

- **The master agent does NOT read source files.** Agents read new files. The master only reads the TOC, directory listings, CLAUDE.md, and agent returns.
- **Only scan new and modified files.** Do not re-read files that are already documented in the TOC with unchanged content hashes. The point of `!toc_update` is to be fast — only process the diff.
- **Preserve unchanged entries verbatim.** Do not rewrite, rephrase, or "improve" entries for files whose content hash has not changed. Only touch new, deleted, modified, and renamed entries.
- **Backward compatible with legacy TOCs.** TOC entries without `<!-- hash:xxxxxxxx -->` comments are treated as unchanged — never flag unhashed entries as modified. They will gain hashes when they are next modified and re-scanned.
- **Renames preserve metadata.** When a file is renamed but not modified, carry over the existing summary, tags, related files, and exports to the new path. Update cross-references in other entries that pointed to the old path.
- **Summaries must be useful.** Same standard as `!toc_generate` — every summary should let a reader determine relevance without opening the file.
- **If the diff is large (50+ new files),** consider suggesting `!toc_generate` instead for a cleaner result. Incremental updates work best for small-to-medium changes.
- **If no changes are detected,** report "TOC is up to date" and exit immediately. Do not dispatch agents or rewrite the file.
- **Update the date.** Always set "Last updated" to today's date when changes are made.
