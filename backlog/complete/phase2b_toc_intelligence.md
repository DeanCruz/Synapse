Upgrade Synapse's Table of Contents system to detect content changes via hashing, handle file renames intelligently using git history, support monorepo project structures, and improve TOC search with tag filtering and related-file traversal. The target project is Synapse itself at `/Users/dean/Desktop/Working/Repos/Synapse`.

All changes in this swarm target command files in `_commands/project/` and the project initialization command in `_commands/project/initialize.md`. These are markdown specification files that define agent behavior — they are not executable code. Each file is a complete, self-contained command spec that agents read and follow step by step.

---

## Task 1: Add content-hash change detection to `toc_generate.md`

**File:** `_commands/project/toc_generate.md`

**Problem:** The current `toc_update.md` can only detect added/removed files by comparing filesystem paths against TOC entries. If a file's content changes significantly (e.g., a service is rewritten, an API contract changes), `toc_update` treats it as unchanged because the path still exists. This means the TOC entry's summary, tags, and related files become stale silently.

**Solution:** During TOC generation, compute and embed a content hash for each file entry. During TOC update, recompute hashes and flag files with changed hashes for re-scanning.

**Changes to `toc_generate.md`:**

In **Phase 2, Step 4** (the agent prompt template), add a 6th output field to the agent's reporting format. After the existing "Exports" field, add:

```
6. **Content hash** — Run `shasum -a 256 {file_path} | cut -c1-8` (or equivalent) to get the first 8 characters of the file's SHA-256 hash. Report this value exactly.
```

Update the **Output Format** section of the agent prompt to include the hash:

```
### {filename}
- **Path:** `{relative_path}`
- **Summary:** {description}
- **Tags:** {tag1}, {tag2}, {tag3}, ...
- **Related:** `{path1}`, `{path2}`, ...
- **Exports:** `Symbol1`, `Symbol2`, ...
- **Hash:** `{first 8 chars of SHA-256}`
```

In **Phase 3, Step 6** (TOC assembly), update the file entry format to embed the hash as an HTML comment at the end of the entry's first line. This keeps the hash machine-readable but invisible when the TOC is rendered as markdown:

```markdown
- **`{filename}`** — {summary} [tags: {tag1}, {tag2}] <!-- hash:{8-char-hash} -->
  - Related: `{path1}`, `{path2}`
  - Exports: `Symbol1`, `Symbol2`
```

Add a note in the **Rules** section:

```
- **Content hashes are mandatory.** Every file entry must include a `<!-- hash:{8chars} -->` comment. This enables `!toc_update` to detect content changes without re-reading every file. If an agent fails to report a hash, use `00000000` as a placeholder.
```

**Current state of toc_generate.md:** The file has 3 phases (Discovery, Parallel Scan, Streaming Assembly) with 8 steps. The agent prompt in Step 4 currently asks for 5 fields: File path, Summary, Tags, Related files, Exports. The TOC format in Step 6 uses `- **filename** — summary [tags]` with optional Related/Exports sub-lines. The Rules section has 6 bullet points.

**Success criteria:** Agent prompts request content hashes. TOC file format includes `<!-- hash:xxxxxxxx -->` comments on every entry. Rules section documents the hash requirement. All existing content and formatting in the file is preserved — changes are purely additive.

---

## Task 2: Add content-hash change detection and git-aware rename detection to `toc_update.md`

**File:** `_commands/project/toc_update.md`

**Problem A — Content changes are invisible:** `toc_update` currently only detects added/removed files. Modified files are ignored.

**Problem B — Renames lose metadata:** When a file is renamed (e.g., `UserService.ts` -> `UserManagementService.ts`), the current approach treats it as a deletion + addition. The old entry's carefully written summary, tags, related files, and exports are discarded. The new entry is scanned from scratch by an agent that has no knowledge of the previous metadata.

**Changes to `toc_update.md`:**

### Change A: Add content-hash comparison to Phase 1 (Diff Detection)

After **Step 3** (Compute the diff), add a new **Step 3b: Detect modified files**:

```
### Step 3b: Detect modified files via content hash

For every file that exists both on disk and in the TOC (the "unchanged" set from Step 3), check whether its content has changed:

1. Parse the TOC entry to extract the embedded hash from the `<!-- hash:xxxxxxxx -->` comment.
2. Compute the current hash: `shasum -a 256 {file_path} | cut -c1-8`.
3. If the hashes differ, the file's content has changed since the TOC was last generated. Add it to a new **modified files** set.
4. If the TOC entry has no hash comment (legacy TOC generated before hashing was added), skip it — do not flag as modified.

Report modified files in the diff output:

**Modified files:** {N}

### Modified Files
- `src/services/UserService.ts` (hash: `a1b2c3d4` -> `e5f6g7h8`)
- ...

Modified files are treated the same as new files for agent scanning — they need their summaries, tags, and related files re-generated. However, the old entry's metadata is preserved and passed to the scanning agent as context (see Step 5 changes below).
```

Update **Step 5** (Dispatch scan agents) to include modified files in the agent workload. For modified files, include the old TOC entry in the agent's prompt so the agent can see the previous summary and decide whether to keep, revise, or replace it:

```
For modified files (content hash changed), include in the agent prompt:

## Previously Documented Entry
- **Summary:** {old summary from TOC}
- **Tags:** {old tags}
- **Related:** {old related files}
- **Exports:** {old exports}
- **Previous hash:** {old hash}

Review the file's current content. If the changes are minor (e.g., bug fixes, formatting), keep the existing summary and tags. If the changes are significant (e.g., new API, rewritten logic, different exports), write new summary, tags, related, and exports. Always compute and report the new content hash.
```

### Change B: Add git-aware rename detection

Add a new **Step 2b: Detect renames via git** between Step 2 (Scan the filesystem) and Step 3 (Compute the diff):

```
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

Report renames in the diff output:

**Renamed files:** {N}

### Renamed Files
- `src/services/UserService.ts` -> `src/services/UserManagementService.ts`
- ...
```

Update **Phase 3, Step 7** (Apply changes to the TOC) with rename handling:

```
#### Renames
For each renamed file:
1. Find the old entry in the TOC.
2. Copy its summary, tags, related files, and exports to the new path.
3. Update the path in the entry.
4. If the content hash also changed (file was renamed AND modified), the scanning agent will have provided updated metadata — use the agent's output instead.
5. Update any `Related:` entries in OTHER TOC entries that referenced the old path to point to the new path.
6. Remove the old entry.
```

### Change C: Update the diff report format

Update Step 3's diff report to include modified and renamed files:

```markdown
## TOC Diff

**New files:** {N}
**Deleted files:** {N}
**Modified files:** {N}
**Renamed files:** {N}
**Unchanged:** {N}
```

Update the **Step 10 report** to include modified and renamed counts:

```markdown
## TOC Updated

- **Files added:** {N}
- **Files removed:** {N}
- **Files modified:** {N} (content hash changed, re-scanned)
- **Files renamed:** {N} (metadata preserved)
- **Agents dispatched:** {N}
```

**Current state of toc_update.md:** 3 phases, 10 steps. Phase 1 has Steps 1-3 (read TOC, scan filesystem, compute diff with new/deleted/unchanged). Phase 2 has Steps 4-6 (group new files, dispatch agents, process returns). Phase 3 has Steps 7-10 (apply changes, update date, write file, report). The Rules section has 7 bullets.

**Success criteria:** Modified files are detected via hash comparison and re-scanned with old metadata as context. Renames are detected via git and metadata is preserved. The diff report includes all four categories (new, deleted, modified, renamed). Existing flow for new/deleted files is unchanged. All changes are backward-compatible — TOC files without hashes still work (unhashed entries are simply skipped for modification detection).

---

## Task 3: Add monorepo detection to `initialize.md`

**File:** `_commands/project/initialize.md`

**Problem:** Synapse's initialization currently treats every project as a single-root project. Monorepos with multiple packages/workspaces are not detected, and the TOC generation does not organize by workspace. This means TOC entries for a monorepo are a flat, unorganized dump of all files across all packages.

**Changes to `initialize.md`:**

### Change A: Expand Step 2 (Detect Project Tech Stack)

Add monorepo detection to the existing tech stack scanning table. After the current detection indicators (package.json, tsconfig.json, etc.), add:

```
#### Monorepo Detection

After detecting the base tech stack, check for monorepo/workspace patterns:

| File/Pattern | Indicates | Workspace root field |
|---|---|---|
| `package.json` with `"workspaces"` field | npm/Yarn workspaces | `workspaces` array (glob patterns) |
| `pnpm-workspace.yaml` | pnpm workspaces | `packages` array (glob patterns) |
| `lerna.json` | Lerna monorepo | `packages` array |
| `nx.json` | Nx monorepo | Detect via `workspace.json` or `project.json` files |
| `turbo.json` | Turborepo | Uses npm/pnpm/yarn workspaces underneath |
| `Cargo.toml` with `[workspace]` | Cargo workspace | `members` array |
| `go.work` | Go workspace | `use` directives |

For each detected pattern:
1. Read the config file to extract the workspace/package list.
2. Resolve glob patterns (e.g., `"packages/*"`) against the filesystem to get actual package directories.
3. For each discovered package/workspace, read its own `package.json` (or `Cargo.toml`, `go.mod`) to get its name and description.

Report in the detection output:

| Property | Value |
|---|---|
| Monorepo | Yes — {type} (e.g., "npm workspaces", "pnpm", "Cargo workspace") |
| Packages | {N} packages detected |

List each package:
| Package | Path | Description |
|---|---|---|
| @myorg/api | packages/api | REST API server |
| @myorg/web | packages/web | Next.js frontend |
| @myorg/shared | packages/shared | Shared types and utilities |
```

### Change B: Store workspace info in `.synapse/config.json`

Update **Step 3** (Create `.synapse/` Directory) to extend the `config.json` schema with workspace data when a monorepo is detected:

```json
{
  "project_name": "{detected_name}",
  "project_root": "{project_root}",
  "tracker_root": "{tracker_root}",
  "tech_stack": ["{detected_tech1}", "{detected_tech2}"],
  "initialized_at": "{ISO_timestamp}",
  "toc_path": ".synapse/toc.md",
  "monorepo": {
    "type": "npm_workspaces | pnpm | lerna | nx | turbo | cargo | go",
    "packages": [
      {
        "name": "@myorg/api",
        "path": "packages/api",
        "description": "REST API server"
      },
      {
        "name": "@myorg/web",
        "path": "packages/web",
        "description": "Next.js frontend"
      }
    ]
  }
}
```

If the project is NOT a monorepo, the `monorepo` field should be `null` (not omitted, explicitly `null`).

### Change C: Document TOC implications

Add a note in **Step 5** (Generate Table of Contents) that when a monorepo is detected, `!toc_generate` should organize the TOC by workspace/package:

```
If a monorepo was detected in Step 2, pass the workspace information to `!toc_generate` via the `.synapse/config.json` file. The TOC generation agents should organize file entries by package:

## @myorg/api (packages/api/)
{files in this package}

## @myorg/web (packages/web/)
{files in this package}

## @myorg/shared (packages/shared/)
{files in this package}

## Root-level files
{files not in any package}

This organization makes it much easier to navigate large monorepos compared to a flat directory listing.
```

**Current state of initialize.md:** 8 steps across prerequisites, tech stack detection, .synapse/ creation, CLAUDE.md scaffolding, TOC generation, dashboard infrastructure, server start, and final report. Step 2 has a detection table with 11 file/directory indicators. Step 3 creates `.synapse/config.json` with 6 fields. Step 5 delegates to `!toc_generate`.

**Success criteria:** Monorepo patterns are detected for npm, pnpm, Lerna, Nx, Turbo, Cargo, and Go workspaces. Package lists are resolved from glob patterns. Workspace info is stored in `.synapse/config.json` with the schema above. TOC generation guidance for monorepos is documented. Non-monorepo projects get `"monorepo": null`. All existing initialization steps and behavior are preserved.

---

## Task 4: Improve TOC search with tag filtering and related-file traversal

**File:** `_commands/project/toc.md`

**Problem A — No tag filtering:** The current `!toc` command does text matching against filenames, summaries, tags, and related files. But there is no way to search ONLY by tag. A query like `!toc api` matches everything that mentions "api" anywhere — filenames, summaries, random mentions. Users cannot narrow searches to just files tagged with a specific domain.

**Problem B — No related-file expansion:** When a match is found, the user sees only that entry. But often the most useful context is in the related files — e.g., finding a service also reveals its types, hooks, and tests. The current command does not traverse related files.

**Changes to `toc.md`:**

### Change A: Add tag-based filtering

In the **Syntax** section, add a new syntax option:

```
- `!toc #tag` — Search only entries tagged with `{tag}`. The `#` prefix triggers tag-only mode.
- `!toc #tag1 #tag2` — Search entries tagged with ALL specified tags (AND logic).
- `!toc #tag query` — Search entries tagged with `{tag}` AND matching `{query}` in name/summary.
```

In **Step 2** (Identify candidate files), add tag filtering logic before the general text matching:

```
#### Tag-Only Mode

If the query starts with `#` or contains `#`-prefixed terms, extract all tag terms (strip the `#` prefix).

1. Parse the TOC for all entries and their `[tags: ...]` brackets.
2. Filter to entries where ALL specified tags appear in the entry's tag list (case-insensitive).
3. If the query also contains non-tag terms (e.g., `!toc #api user`), further filter by text-matching those terms against filenames and summaries.
4. Tag-filtered results skip the general relevance ranking — they are already narrowed by explicit tag matching. Sort them by directory grouping instead.

Example:
- `!toc #api` — returns all files tagged with `api`
- `!toc #api #backend` — returns files tagged with BOTH `api` AND `backend`
- `!toc #hook explore` — returns files tagged with `hook` whose name or summary matches "explore"
```

### Change B: Add related-file traversal

In **Step 4** (Report results), add a "Related Context" section after each result:

```
When presenting results, also show related files for each match to provide contextual discovery:

**1. {File name}**
- **Path:** `{path}`
- **Summary:** {summary}
- **Tags:** {tags}
- **Related Context:**
  - `{related_path_1}` — {summary of that related file, from the TOC}
  - `{related_path_2}` — {summary of that related file, from the TOC}

Only include related files that are themselves documented in the TOC (so their summaries are available). Limit to 3 related files per result to keep output concise. Prioritize related files that are most likely useful — types/interfaces over tests, services over utilities.
```

Add traversal guidance:

```
#### Related File Traversal

After identifying the top candidates, check their `Related:` entries in the TOC. For each related file:
1. Look up its TOC entry.
2. If it exists, include its path and summary in the result's "Related Context" section.
3. Do NOT recurse further — only show direct (1-hop) related files to avoid information overload.

This helps users discover the full context around a match. Finding `UserService.ts` also reveals `UserTypes.ts`, `useUser.ts`, and `userApi.test.ts` — all in one search result.
```

### Change C: Update the report format

Update the result template in Step 4 to include the new sections:

```markdown
## TOC Search: "{query}"

### Results

**1. {File name}**
- **Path:** `{path_relative_to_project_root}`
- **Summary:** {1-2 sentence description from TOC + verification}
- **Tags:** {relevant tags}
- **Related Context:**
  - `{path}` — {summary}
  - `{path}` — {summary}

**2. {File name}**
- ...

### Tag Matches (if tag search)
Found {N} files tagged with #{tag}.
```

**Current state of toc.md:** The file has a Syntax section, 4 execution steps (Read TOC, Identify candidates, Verify candidates, Report results), and a Rules section with 6 bullets. Step 2 matches against filenames, summaries, tags, and related files with a 4-tier relevance ranking. Step 4 has a result template with Path, Summary, Tags, and Related fields.

**Success criteria:** `#tag` syntax is documented and triggers tag-only filtering. Multiple tags use AND logic. Tag + text queries combine both filters. Related-file traversal shows 1-hop related entries with their TOC summaries (max 3 per result). Existing text-matching behavior is unchanged when no `#` prefix is used. All changes are additive to the existing command spec.

---

## Dependencies between tasks

- Task 1 (toc_generate.md hashing) has no dependencies — Wave 1
- Task 2 (toc_update.md hash detection + renames) depends on Task 1 (needs to know the hash format embedded by toc_generate)
- Task 3 (initialize.md monorepo) has no dependencies — Wave 1
- Task 4 (toc.md search improvements) has no dependencies — Wave 1

## Success criteria for the swarm

1. `toc_generate.md` agents request and embed content hashes in `<!-- hash:xxxxxxxx -->` comments.
2. `toc_update.md` detects modified files via hash comparison, detects renames via git, and preserves metadata across renames.
3. `initialize.md` detects monorepo patterns for 7 workspace tools and stores workspace info in `.synapse/config.json`.
4. `toc.md` supports `#tag` filtering with AND logic and shows related-file context in search results.
5. All changes are backward-compatible — existing TOC files without hashes still work, non-monorepo projects still initialize normally, non-tag searches still use the existing relevance ranking.
6. No existing command behavior is broken — all changes are additive or extend existing steps.
