# !context {topic} — Deep Project Context Gathering

## Overview

Performs a comprehensive context gather for a specific topic, feature, or domain within the project. Finds every related file using Grep, Glob, TOC tags, and import tracing — then produces a concise summary the user (or a follow-up task) can act on.

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

From the user's `{topic}`, generate a list of search terms — synonyms, related technical terms, and likely code identifiers:

- `auth` → `auth`, `login`, `signin`, `signIn`, `signup`, `signUp`, `session`, `token`, `jwt`, `credential`, `password`, `onAuthStateChanged`
- `payments` → `payment`, `pay`, `charge`, `billing`, `invoice`, `stripe`, `subscription`, `price`, `checkout`

Cast a wide net. It's better to find too many files and filter than to miss a critical one.

### Step 2: Search Across the Project

Run these searches **in parallel**:

1. **Grep for each search term** across the project (filenames and content)
2. **Check `{project_root}/.synapse/toc.md`** tags and descriptions for matching entries
3. **Glob for likely file patterns** (e.g., for `auth` → `**/auth/**`, `**/login/**`, `**/*auth*`)

Deduplicate results into a single list of relevant files, grouped by directory/module.

### Step 3: Read Key Files

From the search results, identify the **key files** — the ones that are architectural anchors, entry points, type definitions, or central logic for this topic. Read them (in parallel where possible).

Do NOT read every matching file. Use judgment:
- A file that imports an auth utility but isn't about auth → skip
- A file that defines the auth middleware → read
- A type definition for User → read
- A component that just has a login button → skip (unless the topic is specifically about the login UI)

### Step 4: Trace Connections

For the topic, map how it flows through the project:
- Which frontend components call which backend endpoints?
- Which types are shared or mirrored across layers?
- Which config values are related?
- What's the data flow from user action to database?

### Step 5: Produce the Summary

Output a structured summary:

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
```

---

## Rules

- **Do not modify any files.** This command is read-only.
- **Be concise.** The summary should fit in ~50-100 lines. Extract facts, don't dump file contents.
- **Prioritize cross-layer insight.** Single-file context is easy to get with Grep. The value here is tracing connections across layers (frontend, backend, database, config, etc.).
- **Run in serial mode.** This is a context-gathering command, not a code-modification command. No swarm needed.
