# !context {topic} — Deep Cross-Repo Context Gathering

## Overview

Performs a comprehensive, cross-repo context gather for a specific topic, feature, or domain. Finds every related file across the entire workspace using Grep, Glob, TOC tags, and import tracing — then produces a concise summary the user (or a follow-up task) can act on.

This is the master agent's core value proposition: **seeing across repo boundaries.**

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

- `auth` → `auth`, `login`, `signin`, `signIn`, `signup`, `signUp`, `session`, `token`, `jwt`, `credential`, `password`, `Firebase Auth`, `onAuthStateChanged`
- `payments` → `payment`, `pay`, `charge`, `billing`, `invoice`, `stripe`, `subscription`, `price`, `checkout`

Cast a wide net. It's better to find too many files and filter than to miss a critical one.

### Step 2: Search Across All Repos

Run these searches **in parallel**:

1. **Grep for each search term** across all repos (filenames and content)
2. **Check `TableOfContentsMaster.md`** tags and descriptions for matching entries
3. **Glob for likely file patterns** (e.g., for `auth` → `**/auth/**`, `**/login/**`, `**/*auth*`)

Deduplicate results into a single list of relevant files, grouped by repo.

### Step 3: Read Key Files

From the search results, identify the **key files** — the ones that are architectural anchors, entry points, type definitions, or central logic for this topic. Read them (in parallel where possible).

Do NOT read every matching file. Use judgment:
- A file that imports an auth utility but isn't about auth → skip
- A file that defines the auth middleware → read
- A type definition for User → read
- A component that just has a login button → skip (unless the topic is specifically about the login UI)

### Step 4: Trace Cross-Repo Connections

For the topic, map how it flows across repos:
- Which frontend components call which backend endpoints?
- Which types are shared or mirrored?
- Which config values are related?
- What's the data flow from user action to database?

### Step 5: Produce the Summary

Output a structured summary:

```
## Context: {topic}

### Files by Repo

**{repo_1}:**
- `path/to/file.ts` — {what it does for this topic}
- `path/to/other.ts` — {what it does for this topic}

**{repo_2}:**
- `path/to/file.ts` — {what it does for this topic}

### Architecture

{2-5 sentences describing how this topic is implemented across the workspace — the flow, the key decisions, the patterns used}

### Cross-Repo Connections

- Frontend `{file}` calls backend `{endpoint}` handled by `{file}`
- Type `{TypeName}` defined in `{repo/path}`, mirrored in `{repo/path}`
- Config `{key}` must match across `{repo1/.env}` and `{repo2/.env}`

### Key Observations

- {Anything notable: inconsistencies, tech debt, missing tests, unclear ownership, etc.}
```

---

## Rules

- **Do not modify any files.** This command is read-only.
- **Be concise.** The summary should fit in ~50-100 lines. Extract facts, don't dump file contents.
- **Prioritize cross-repo insight.** Single-repo context is easy to get with Grep. The value here is the connections between repos.
- **Run in serial mode.** This is a context-gathering command, not a code-modification command. No swarm needed.
