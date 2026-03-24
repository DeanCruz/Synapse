# !context {topic} — Deep Project Context Gathering

## Overview

Performs a comprehensive context gather for a specific topic, feature, or domain within the project. When a Project Knowledge Index (PKI) exists, queries it for instant file routing and deep annotations, then supplements with grep/glob for files not covered by the PKI. Produces a concise, enriched summary the user (or a follow-up task) can act on.

---

## Usage

```
!context auth
!context payments
!context user onboarding flow
!context Firebase security rules
!context the dashboard SSE connection
```

The `{topic}` can be a single keyword, a feature name, a technical term, or a natural language description.

---

## Execution Steps

### Step 1: Expand the Topic into Search Terms

From the user's `{topic}`, generate a list of search terms -- synonyms, related technical terms, and likely code identifiers:

- `auth` → `auth`, `login`, `signin`, `signIn`, `signup`, `signUp`, `session`, `token`, `jwt`, `credential`, `password`, `onAuthStateChanged`
- `payments` → `payment`, `pay`, `charge`, `billing`, `invoice`, `stripe`, `subscription`, `price`, `checkout`

Cast a wide net. It is better to find too many files and filter than to miss a critical one.

---

### Step 1.5: PKI Query (if available)

Check whether the Project Knowledge Index exists:

```
{project_root}/.synapse/knowledge/manifest.json
```

**If the PKI does NOT exist:** Skip to Step 2. Append a note at the end of the output:

> **Tip:** Run `!learn` to build the Project Knowledge Index. Future `!context` queries will be faster and richer with PKI data -- including gotchas, patterns, conventions, and architectural relationships.

**If the PKI exists:** Read `manifest.json` and query the indexes using the expanded search terms from Step 1.

#### 1.5a. Query `domain_index`

Check if the `{topic}` or any expanded search term from Step 1 matches a key in `domain_index`. Domain keys are lowercase-hyphenated identifiers (e.g., `"authentication"`, `"file-watching"`, `"ui-components"`).

```
manifest.domain_index["auth"]           → ["src/auth/login.ts", "src/auth/middleware.ts", ...]
manifest.domain_index["authentication"] → ["src/auth/login.ts", ...]
```

Try the topic as-is, common hyphenated forms, and plurals/singulars. Collect all matched file paths.

#### 1.5b. Query `tag_index`

Check if the `{topic}` or its expanded search terms match keys in `tag_index`. Tags are freeform lowercase strings (e.g., `"jwt"`, `"express"`, `"react"`, `"validation"`).

```
manifest.tag_index["jwt"]     → ["src/auth/login.ts", "src/auth/token.ts"]
manifest.tag_index["session"] → ["src/auth/session.ts"]
```

Collect all matched file paths. Deduplicate against domain_index results.

#### 1.5c. Query `concept_map`

Check if the `{topic}` matches or partially matches any key in `concept_map`. Concept keys are natural-language phrases (e.g., `"real-time dashboard updates"`, `"progress file lifecycle"`).

```
manifest.concept_map["real-time dashboard updates"] → {
  "files": ["src/server/index.js", "src/server/services/WatcherService.js", ...],
  "description": "SSE-based push from server file watchers to React dashboard components..."
}
```

For partial matches, check if the topic appears as a substring of any concept key, or if any concept key's `description` contains the topic terms. Collect matched file paths.

#### 1.5d. Read Annotations for Matched Files

For each file found via the PKI indexes, look up its `hash` in `manifest.files[path].hash` and read the annotation file:

```
{project_root}/.synapse/knowledge/annotations/{hash}.json
```

From each annotation, extract:
- **purpose** -- detailed description of what the file does
- **gotchas** -- operational warnings (non-obvious behaviors, foot-guns, edge cases)
- **patterns** -- design patterns used in this file
- **conventions** -- project conventions this file follows
- **relationships** -- architectural relationships (serves, consumes, mirrors, extends, etc.)
- **domains** and **tags** -- for cross-referencing and informing Step 2

Also note the `stale` flag from the manifest entry. If a file is stale, its annotation may be outdated -- flag it in the output and still read the actual file in Step 3.

#### 1.5e. Feed PKI Data Back into Search

Use the annotation `tags` and `domains` from matched files to expand the search term list for Step 2. PKI data may reveal related terms you would not have guessed from the original topic alone.

The PKI results are a **head start**, not a replacement. Always proceed to Step 2.

---

### Step 2: Search Across the Project

Run these searches **in parallel**:

1. **Grep for each search term** across the project (filenames and content)
2. **Check `{project_root}/.synapse/toc.md`** tags and descriptions for matching entries
3. **Glob for likely file patterns** (e.g., for `auth` → `**/auth/**`, `**/login/**`, `**/*auth*`)

Deduplicate results into a single list of relevant files, grouped by directory/module. Merge with any files already found by the PKI in Step 1.5.

#### Identify PKI Coverage Gaps

If PKI data was queried in Step 1.5, compare the grep/glob results against the PKI-matched files. Files found by grep/glob but NOT in the PKI are coverage gaps -- they are new, unannotated, or recently added files. These still need the traditional grep-based analysis and should be noted in the output.

---

### Step 3: Read Key Files

From the combined results (PKI + search), identify the **key files** -- the ones that are architectural anchors, entry points, type definitions, or central logic for this topic. Read them (in parallel where possible).

**PKI optimization:** If a file already has a fresh (non-stale) annotation from Step 1.5, you may skip reading it -- the annotation's `purpose`, `exports`, `imports_from`, and `relationships` already provide the context you need. Only read the actual file if:
- The annotation is stale (`stale: true` in the manifest entry)
- You need code-level detail beyond what the annotation provides
- The file was NOT in the PKI (no annotation exists)

Do NOT read every matching file. Use judgment:
- A file that imports an auth utility but is not about auth → skip
- A file that defines the auth middleware → read (or use its annotation)
- A type definition for User → read (or use its annotation)
- A component that just has a login button → skip (unless the topic is specifically about the login UI)

### Step 4: Trace Connections

For the topic, map how it flows through the project:
- Which frontend components call which backend endpoints?
- Which types are shared or mirrored across layers?
- Which config values are related?
- What is the data flow from user action to database?

**PKI enhancement:** Use annotation `relationships` data to trace connections without reading additional files. Each annotation's `relationships` array describes architectural edges (serves, consumes, mirrors, extends, configures, tests, subscribes, publishes) -- follow these edges to build a richer connection map than grep alone can provide.

### Step 5: Produce the Summary

Output a structured summary. When PKI data is available, the summary includes additional sections.

**Without PKI (or PKI has no matches):**

```
## Context: {topic}

### Files by Area

**{area_1} (e.g., API / Backend):**
- `path/to/file.ts` — {what it does for this topic}
- `path/to/other.ts` — {what it does for this topic}

**{area_2} (e.g., Frontend / UI):**
- `path/to/file.ts` — {what it does for this topic}

### Architecture

{2-5 sentences describing how this topic is implemented across the project — the flow, the key decisions, the patterns used}

### Connections

- Frontend `{file}` calls backend `{endpoint}` handled by `{file}`
- Type `{TypeName}` defined in `{path}`, consumed in `{path}`
- Config `{key}` referenced in `{path}` and `{path}`

### Key Observations

- {Anything notable: inconsistencies, tech debt, missing tests, unclear ownership, etc.}

---
> **Tip:** Run `!learn` to build the Project Knowledge Index for faster, richer context queries.
```

**With PKI data:**

```
## Context: {topic}

> PKI coverage: {N} of {M} relevant files have annotations ({percentage}%).
> {S} annotations are stale — flagged below with (stale).

### Files by Area

**{area_1} (e.g., API / Backend):**
- `path/to/file.ts` — {annotation purpose OR grep-based description}
- `path/to/other.ts` (stale) — {description, may be outdated}

**{area_2} (e.g., Frontend / UI):**
- `path/to/file.ts` — {annotation purpose OR grep-based description}

**Unannotated (not in PKI):**
- `path/to/new_file.ts` — {grep-based description}

### Architecture

{2-5 sentences. When PKI data is available, incorporate annotation `purpose` and `relationships` for a richer architectural narrative.}

### Connections

- Frontend `{file}` calls backend `{endpoint}` handled by `{file}`
- `{file}` serves data to `{file}` (from annotation relationship)
- `{file}` subscribes to events from `{file}` (from annotation relationship)

### PKI Context

{Structured summary of PKI-sourced insights for this topic. This section appears only when PKI data contributed to the results.}

**Gotchas:**
- **{file}:** {gotcha description}
- **{file}:** {gotcha description}
- **Cross-cutting:** {gotcha that applies to multiple files}

**Patterns & Conventions:**
- **{pattern_name}:** {description} — seen in `{file}`, `{file}`
- **Convention:** {convention description} — seen in `{file}`, `{file}`

**Relationships:**
- `{file}` {relationship_type} `{file}` — {description}
- `{file}` {relationship_type} `{file}` — {description}

### Key Observations

- {Anything notable: inconsistencies, tech debt, missing tests, unclear ownership, etc.}
- **Gotcha highlights:** {Summarize the most critical gotchas from annotations — non-obvious behaviors, foot-guns, or edge cases that anyone working in this area must know}
- {If stale annotations exist: "N files have stale annotations — run `!learn_update` to refresh."}
- {If PKI coverage is low (<50%): "PKI coverage is low — run `!learn` or `!learn_update` to improve annotation coverage for this area."}
```

---

## Rules

- **Do not modify any files.** This command is read-only.
- **Be concise.** The summary should fit in ~50-150 lines. Extract facts, do not dump file contents. The PKI sections add density, not length -- keep them tight.
- **Prioritize cross-layer insight.** Single-file context is easy to get with Grep. The value here is tracing connections across layers (frontend, backend, database, config, etc.).
- **Run in serial mode.** This is a context-gathering command, not a code-modification command. No swarm needed.
- **PKI is additive, not required.** The command must work identically to its pre-PKI behavior when no PKI exists. The PKI is a fast first pass that enriches the output -- it never replaces the grep/glob search.
- **Flag stale data.** When annotations are stale (`stale: true`), always flag them in the output and treat their content as potentially outdated. Read the actual file for stale entries.
- **Suggest `!learn` when appropriate.** If the PKI does not exist, include the tip at the bottom. If the PKI exists but has low coverage (<50% of relevant files annotated), suggest `!learn_update` to improve coverage.
