# `!toc_update`

**Purpose:** Incrementally update `toc.md` by detecting new, deleted, moved, and semantically changed files since the last TOC generation. Dispatches parallel agents only for directories with changes — much faster than a full `!toc_generate`. When `fingerprints.json` exists, also detects and reports semantic shifts in modified files: purpose changes, API changes, signature changes, and dependency changes. Use this for routine maintenance after adding features, creating files, or making structural changes.

**Syntax:** `!toc_update`

**Produces:** An updated `{project_root}/.synapse/toc.md` with new files added, deleted files removed, modified files re-scanned, and stale entries corrected. When semantic fingerprints exist, also updates `fingerprints.json` and `dep_graph.json`, and reports semantic changes prominently.

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

### Step 2c: Detect modified files via semantic fingerprints

If `{project_root}/.synapse/fingerprints.json` exists, use it to identify files that have been modified since the last TOC generation and need semantic re-analysis.

1. Read `{project_root}/.synapse/fingerprints.json`. Extract the `generated_at` date.
2. Identify files modified since `generated_at` using one of:
   - `git -C {project_root} diff --name-only --since="{generated_at}"` (preferred — uses git history)
   - `find {project_root}/src -newer {project_root}/.synapse/fingerprints.json -type f` (fallback — uses filesystem modification times)
3. Cross-reference the modified file list with `fingerprints.json`:
   - Only files that **have an existing fingerprint** AND **appear in the modified list** need semantic re-scanning
   - Files without fingerprints are either new (handled in Step 3) or were never fingerprinted — skip them here
4. Build a **semantically modified files** set — these files will be dispatched alongside new files in Phase 2, with their old fingerprint data included in the agent prompt for comparison

If `fingerprints.json` does not exist, skip this step entirely. The existing content-hash-based detection in Step 3b still applies independently.

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
**Modified files:** {N} (content hash changed)
**Semantically modified files:** {N} (fingerprint changed — from Step 2c)
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

### Semantically Modified Files (from fingerprints.json)
- `src/utils/auth.js` (modified since {generated_at})
- `src/api/users.js` (modified since {generated_at})
- ...
(Omit this section if fingerprints.json does not exist or no fingerprinted files were modified.)

### Renamed Files
- `src/lib/oldName.ts` -> `src/lib/newName.ts`
- ...

### New Directories
- `src/newModule/` (not in TOC at all)
- ...
```

**Note:** Files detected via content hash (Step 3b) and files detected via fingerprint modification date (Step 2c) may overlap. Deduplicate: if a file appears in both sets, it only needs one scan agent dispatch. The union of both sets forms the complete "modified files" set for Phase 2.

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
7. **Fingerprint** (if fingerprints.json exists for this project):
   - Purpose: one of `component`, `service`, `utility`, `config`, `test`, `type-definition`, `route`, `middleware`, `hook`, `model`, `migration`, `script`, `documentation`, `command`, `style`, `entry-point`, `factory`, `context-provider`, or `other (description)`
   - Key Exports: `name(kind, params)`, ... — top 5-10 most important exports
   - Key Imports: project-internal import paths only (exclude node_modules)
   - Complexity: `simple` | `moderate` | `complex`

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
- **Fingerprint:**
  - Purpose: {purpose}
  - Key Exports: {name}({kind}, {params}), ...
  - Key Imports: `{path1}`, `{path2}`, ...
  - Complexity: {simple|moderate|complex}
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

For modified files that have existing fingerprints (from Step 2c), also include:

```
## Previous Semantic Fingerprint
- **Purpose:** {old purpose from fingerprints.json}
- **Key Exports:** {old key_exports — name(kind, params) for each}
- **Key Imports:** {old key_imports paths}
- **Complexity:** {old complexity}

Produce an updated fingerprint based on the file's current content. Report the new fingerprint even if nothing changed — the master will compare old vs new to detect semantic shifts.
```

### Step 6: Process returns

As agents return, collect all new and updated file entries. Validate that summaries are specific and useful (not generic filler).

### Step 6b: Compare semantic fingerprints (modified files only)

**Skip this step if `fingerprints.json` does not exist or no modified files had existing fingerprints.**

For each modified file that had a previous fingerprint (from Step 2c), compare the old fingerprint against the new fingerprint returned by the scan agent. Detect and flag the following semantic changes:

#### Purpose Change Detection

Compare the old `purpose` value against the new `purpose` value. If they differ, flag:

```
PURPOSE CHANGE: {path} changed from {old_purpose} to {new_purpose}
```

A purpose change is a significant semantic shift — it means the file's role in the architecture has changed (e.g., a `utility` became a `service`, or a `component` became a `context-provider`). Always report these prominently.

#### API Change Detection

Compare the old `key_exports` array against the new `key_exports` array by export name.

- **Removed exports:** names present in old but absent in new
- **Added exports:** names present in new but absent in old
- **Unchanged exports:** names present in both

If more than **50% of export names differ** (by name), flag:

```
API CHANGE: {path} — {N} of {M} exports changed (removed: {removed_names}, added: {added_names})
```

Where `N` is the count of changed (removed + added) names and `M` is the total unique export names across both old and new.

#### Signature Change Detection

For exports that exist in both old and new (same name), compare `kind` and `params`:

- If `kind` changed (e.g., `function` to `class`), flag:
  ```
  SIGNATURE CHANGE: {path} — {name} changed kind from {old_kind} to {new_kind}
  ```
- If `params` changed significantly (difference of 2+), flag:
  ```
  SIGNATURE CHANGE: {path} — {name} changed params from {old_params} to {new_params}
  ```

#### Dependency Change Detection

Compare the old `key_imports` array against the new `key_imports` array:

- **Added imports:** paths in new but not in old
- **Removed imports:** paths in old but not in new

If any imports were added or removed, flag:

```
DEPENDENCY CHANGE: {path} — added imports from {added_paths}, removed imports from {removed_paths}
```

If only imports were added: `DEPENDENCY CHANGE: {path} — added imports from {added_paths}`
If only imports were removed: `DEPENDENCY CHANGE: {path} — removed imports from {removed_paths}`

#### Collect all semantic changes

Build a list of all detected semantic changes. These will be reported in the diff output and included in the final report.

If no semantic changes are detected for any modified file (all fingerprints are identical), skip the semantic changes section in the report.

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

### Step 9: Write the TOC file

Write the updated TOC to `{project_root}/.synapse/toc.md`.

### Step 9b: Update fingerprints.json (if it exists)

**Skip this step if `{project_root}/.synapse/fingerprints.json` does not exist.**

Read the current `fingerprints.json`. For each modified file that had a scan agent return with updated fingerprint data:

1. Replace the file's entry in `files` with the new fingerprint (`purpose`, `key_exports`, `key_imports`, `complexity`)
2. Update `generated_at` to today's date

For new files that also returned fingerprint data, add their entries to `files`.

For deleted files, remove their entries from `files`.

Write the updated `fingerprints.json` back to `{project_root}/.synapse/fingerprints.json`.

### Step 9c: Update dep_graph.json (if it exists)

**Skip this step if `{project_root}/.synapse/dep_graph.json` does not exist.**

Read the current `dep_graph.json`. For each modified file with updated `key_imports`:

1. **Update forward edges (`imports`):** Replace the file's `imports` array with the new `key_imports` from the updated fingerprint.
2. **Update reverse edges (`imported_by`):** For every file that was in the old `imports` but not in the new, remove the modified file from that target's `imported_by`. For every file in the new `imports` but not in the old, add the modified file to that target's `imported_by`.

For new files with fingerprint data:
1. Add the file's `imports` from its `key_imports`.
2. For each import target, add the new file to that target's `imported_by`.

For deleted files:
1. For each file in the deleted file's `imports`, remove the deleted file from that target's `imported_by`.
2. Remove the deleted file's entry from the graph entirely.

Update `generated_at` to today's date. Write the updated `dep_graph.json` back to `{project_root}/.synapse/dep_graph.json`.

### Step 10: Report

```markdown
## TOC Updated

- **Files added:** {N}
- **Files removed:** {N}
- **Files modified:** {N} (content hash changed, re-scanned)
- **Semantic changes detected:** {N}
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

### Modified Files (Semantic Changes)
- `src/utils/auth.js` — PURPOSE CHANGE: utility -> service
- `src/api/users.js` — API CHANGE: 3 of 5 exports changed (removed: getUser, listUsers; added: fetchUser, searchUsers, getUserById)
- `src/api/users.js` — SIGNATURE CHANGE: updateUser changed params from 2 to 3
- `src/services/db.js` — DEPENDENCY CHANGE: added imports from `src/utils/cache.js`
- ...

(Omit this section if no semantic changes were detected.)

### Renamed
- `{old_path}` -> `{new_path}`
- ...

The Table of Contents has been updated.
{If fingerprints.json was updated: "Semantic fingerprints updated for {N} files."}
{If dep_graph.json was updated: "Dependency graph updated — {N} edges added, {M} edges removed."}
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
- **Fingerprint comparison is additive.** If `fingerprints.json` does not exist, all fingerprint-related steps (2c, 6b, 9b, 9c) are skipped. The command works identically to before. Fingerprint features only activate when `!toc_generate` has previously produced a `fingerprints.json`.
- **Always include old fingerprints in agent prompts for modified files.** When dispatching scan agents for files that have existing fingerprints, the old fingerprint data must be included so the agent can produce comparable output.
- **Semantic change flags are informational.** PURPOSE CHANGE, API CHANGE, SIGNATURE CHANGE, and DEPENDENCY CHANGE flags are reported to the user but do not block the update. They exist to surface important architectural shifts that might otherwise go unnoticed.
- **Update both fingerprints.json and dep_graph.json atomically.** When modifying these files, read the full file, apply all changes in memory, and write the complete file. Never do partial writes or incremental appends.
