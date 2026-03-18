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

---

## Execution Steps

### Step 1: Read the Table of Contents

Read `{project_root}/.synapse/toc.md` in full. This is the project's semantic index — it contains summaries, tags, related files, and context for every indexed file.

### Step 2: Identify candidate files

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

Present the results in this format:

```markdown
## TOC Search: "{query}"

### Results

**1. {File name}**
- **Path:** `{path_relative_to_project_root}`
- **Summary:** {1-2 sentence description from TOC + verification}
- **Tags:** {relevant tags}
- **Related:** {other files this connects to, if any}

**2. {File name}**
- ...

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
