# `!toc {query}`

**Purpose:** Search the project Table of Contents to quickly locate files by topic, keyword, or object name. Returns the most relevant file(s) with their paths and context — faster than blind Glob/Grep searching.

**Syntax:** `!toc {search_object}` or `!toc {search_parameters}`

- `{search_object}` — A specific thing to find (e.g., `SimulationService`, `useExplore`, `auth middleware`, `landing page gallery`)
- `{search_parameters}` — Descriptive search (e.g., `rate limiting`, `styling colors`, `how generations work`)

**Examples:**
```
!toc SimulationService
!toc explore page hooks
!toc auth middleware
!toc how the generation flow works
!toc firebase config
```

**Tag-based filtering:**

- `!toc #tag` — Search only entries tagged with `{tag}`. The `#` prefix triggers tag-only mode.
- `!toc #tag1 #tag2` — Search entries tagged with ALL specified tags (AND logic).
- `!toc #tag query` — Search entries tagged with `{tag}` AND matching `{query}` in name/summary.

---

## Execution Steps

### Step 1: Read the Table of Contents

Read `{project_root}/.synapse/toc.md` in full. This is the project's semantic index — it contains summaries, tags, related files, and context for every indexed file.

### Step 2: Identify candidate files

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

#### General Text Matching

Search the TOC for entries matching the user's query. Match against:

- **File names and paths** — direct match on the filename or path segments
- **Summaries** — semantic match on the description text
- **Tags** — match on any tagged keywords
- **Related files** — match on cross-references

Rank candidates by relevance:
1. **Exact name match** — query matches a filename or export name directly
2. **Summary match** — query terms appear in the file's summary/description
3. **Tag match** — query terms appear in tags
4. **Related file match** — query matches a file referenced by another entry

Select the top 1-5 most relevant candidates.

### Step 3: Verify candidates

For each candidate, **read the actual file** (or the first ~50 lines) to confirm it is genuinely what the user is looking for. This prevents false positives from stale or misleading TOC entries.

If a candidate is NOT what the user wants, drop it and note why.

### Step 4: Report results

When presenting results, also show related files for each match to provide contextual discovery:

#### Related File Traversal

After identifying the top candidates, check their `Related:` entries in the TOC. For each related file:
1. Look up its TOC entry.
2. If it exists, include its path and summary in the result's "Related Context" section.
3. Do NOT recurse further — only show direct (1-hop) related files to avoid information overload.

Only include related files that are themselves documented in the TOC (so their summaries are available). Limit to 3 related files per result to keep output concise. Prioritize related files that are most likely useful — types/interfaces over tests, services over utilities.

Present the results in this format:

```markdown
## TOC Search: "{query}"

### Results

**1. {File name}**
- **Path:** `{path_relative_to_project_root}`
- **Summary:** {1-2 sentence description from TOC + verification}
- **Tags:** {relevant tags}
- **Related Context:**
  - `{related_path_1}` — {summary of that related file, from the TOC}
  - `{related_path_2}` — {summary of that related file, from the TOC}

**2. {File name}**
- ...

### Tag Matches (if tag search)
Found {N} files tagged with #{tag}.

### Not Found (if applicable)
If no relevant files were found, suggest:
- Alternative search terms the user could try
- Which directory might contain what they're looking for
- Whether the file might not be indexed yet (suggest `!toc_update`)
```

---

## Rules

- **Do not modify any files.** This is a read-only search command.
- **Always verify candidates.** Never report a file based solely on the TOC entry — confirm it by reading the file.
- **Be concise.** The user wants to find files fast, not read an essay. Keep summaries to 1-2 sentences.
- **If the TOC is stale or missing entries**, tell the user and suggest running `!toc_update` or `!toc_generate`.
- **If the query is ambiguous**, return multiple candidates and let the user decide which is relevant.
- **Prefer precision over recall.** It's better to return 2 correct results than 10 results where 8 are noise.
