# PKI Pre-Planning Integration

> **Self-contained module for the master agent's use of the Project Knowledge Index (PKI) during task planning.** This document covers how to read the manifest, extract relevant domains and tags from the user's prompt, look up files via the manifest's reverse indexes, read per-file annotations for gotchas/patterns/conventions, and inject that knowledge into worker dispatch prompts. It also defines fallback behavior when no PKI exists and rules for context budgeting.

---

## Overview

The PKI is a persistent knowledge layer at `{project_root}/.synapse/knowledge/` that gives the master agent deep codebase understanding without redundant file exploration. It is populated by the `!learn` command and maintained by `!learn_update`. The master uses it during the **planning phase** — after reading the user's prompt and before decomposing tasks — to front-load relevant knowledge into worker prompts.

### The Pre-Planning Flow

```
User prompt arrives
       |
       v
1. Check if PKI exists (manifest.json)
       |
       v
2. Extract domains, tags, concepts from prompt
       |
       v
3. Look up files via domain_index, tag_index, concept_map
       |
       v
4. Read annotations for matched files
       |
       v
5. Extract gotchas, patterns, conventions from annotations
       |
       v
6. Inject knowledge into worker prompts (CONVENTIONS section)
       |
       v
Proceed to normal task decomposition and dispatch
```

This flow adds **one manifest read and a handful of annotation reads** to the planning phase. It should take under 30 seconds for a typical project. The payoff is workers that avoid known foot-guns, follow established patterns, and produce code consistent with the existing codebase — without each worker needing to independently discover these things.

---

## Step 1 — Check for PKI Existence

Before any PKI lookup, verify the manifest exists:

```
Read: {project_root}/.synapse/knowledge/manifest.json
```

**If the file does not exist or is empty:**
- Log an info-level note: "No PKI found — skipping knowledge-augmented planning"
- Proceed with standard planning (convention map from CLAUDE.md only)
- Do NOT treat this as an error — many projects will not have a PKI yet

**If the file exists but fails to parse (malformed JSON):**
- Log a warn-level note: "PKI manifest is malformed — skipping"
- Proceed with standard planning

**If the file exists and parses successfully:**
- Continue to Step 2
- Log an info-level note with stats: "PKI loaded — {stats.annotated_files} annotated files across {stats.domains_count} domains"

---

## Step 2 — Extract Domains, Tags, and Concepts from the User's Prompt

Read the user's prompt and identify which parts of the codebase it likely touches. Use the manifest's indexes as a vocabulary — you are matching the user's natural language against the PKI's structured taxonomy.

### Extraction Procedure

1. **Scan `domain_index` keys.** For each domain name in the manifest, check if the user's prompt mentions that domain or a closely related term. Example: if the user says "fix the login flow," match against domains like `authentication`, `user-management`, `session-handling`.

2. **Scan `tag_index` keys.** For each tag, check for direct mentions or synonyms. Example: if the user says "update the Express routes," match tags like `express`, `router`, `endpoint`, `api`.

3. **Scan `concept_map` keys.** Concepts are higher-level than domains — they describe cross-cutting behaviors. Example: if the user says "improve real-time updates," match concepts like `real-time dashboard updates`, `sse-streaming`, `event-driven`.

4. **Combine results.** Collect all file paths from matched domains, tags, and concepts into a single deduplicated set — the **relevant file set**.

### Example

Given a user prompt: "Add rate limiting to the API endpoints"

```
Manifest domain_index keys: ["server", "ui", "dashboard", "file-watching", "entry-points", "authentication"]
  -> Match: "server" (API endpoints live in server domain)

Manifest tag_index keys: ["express", "sse", "react", "component", "fs-watch", "jwt", "middleware"]
  -> Match: "express" (API framework), "middleware" (rate limiting is middleware)

Manifest concept_map keys: ["real-time dashboard updates", "progress file lifecycle", "request pipeline"]
  -> Match: "request pipeline" (rate limiting is part of the request pipeline)

Relevant file set (deduplicated):
  - src/server/index.js (from "server" domain + "express" tag)
  - src/server/middleware/auth.js (from "middleware" tag)
  - src/server/routes/api.js (from "server" domain + "express" tag)
```

### Guidance for Ambiguous Prompts

- **Broad prompts** (e.g., "refactor the backend"): Match entire domains rather than individual tags. Pull annotations for the highest-complexity files in those domains first.
- **Narrow prompts** (e.g., "fix the JWT validation bug"): Match specific tags (`jwt`, `validation`, `auth`). The relevant file set should be small and focused.
- **Cross-cutting prompts** (e.g., "add logging everywhere"): Start with the `concept_map` — it captures cross-cutting concerns better than individual domains. If no matching concept exists, fall back to a broader domain scan.

---

## Step 3 — Look Up Files via Indexes

Using the relevant domains, tags, and concepts identified in Step 2, collect file paths from the manifest's reverse indexes.

### Lookup Queries

**By domain:**
```json
// manifest.domain_index["server"]
// Returns: ["src/server/index.js", "src/server/services/WatcherService.js", ...]
```

**By tag:**
```json
// manifest.tag_index["express"]
// Returns: ["src/server/index.js", ...]
```

**By concept:**
```json
// manifest.concept_map["request pipeline"].files
// Returns: ["src/server/index.js", "src/server/middleware/auth.js"]
```

### Ranking the Relevant File Set

Not all matched files are equally important. Rank them using these signals from the manifest's per-file entries:

| Signal | How to Use |
|---|---|
| `complexity: "high"` | Prioritize — these files have the most gotchas and patterns that workers need to know |
| `stale: true` | Deprioritize — annotations may be outdated. Include with a warning if no fresh alternatives exist |
| `domains` array length | Files in multiple matched domains are more central to the user's request |
| Appears in multiple indexes | A file matched by domain AND tag AND concept is almost certainly relevant |

### Budget: File Selection Cap

- **Read annotations for at most 8-10 files.** Even in large projects, the worker prompt has a limited context budget (~200 lines for conventions). More than 10 annotation reads will produce more knowledge than can be injected.
- **Prioritize by rank.** Read the top-ranked files first. If you hit the budget before reading all matched files, stop — the top files will contain the most critical knowledge.
- **For very broad prompts** that match 20+ files: select the 3-4 files per affected domain with the highest complexity rating.

---

## Step 4 — Read Annotations for Matched Files

For each file in the relevant file set (up to the budget cap), read its annotation file.

### Locating Annotation Files

The annotation filename is the `hash` field from the manifest's per-file entry:

```
Manifest entry for "src/server/index.js":
  hash: "a1b2c3d4"

Annotation path: {project_root}/.synapse/knowledge/annotations/a1b2c3d4.json
```

### What to Extract from Each Annotation

| Annotation Field | Use in Planning |
|---|---|
| `gotchas` | **Critical.** Include in worker prompts to prevent known foot-guns. These are the highest-value PKI output. |
| `patterns` | Include when the worker needs to follow an existing pattern (e.g., "this file uses the singleton pattern — follow it"). Cross-reference with `patterns.json` for full pattern descriptions. |
| `conventions` | Include when the worker is creating new code in the same area — ensures consistency with existing conventions. |
| `exports` | Use during task decomposition to understand what interfaces exist. Helps define task boundaries. |
| `imports_from` | Use to identify dependency chains. If a worker modifies a file, its importers may need updates too. |
| `relationships` | Use to identify blast radius. A file that "serves" data to 5 consumers is riskier to modify than a leaf file. |
| `purpose` | Use to validate that the file is actually relevant to the user's request (sanity check on the index lookup). |

### Handling Stale Annotations

If a file's manifest entry has `stale: true`:

1. Still read the annotation — stale knowledge is better than no knowledge
2. Mark the extracted knowledge with a staleness warning in the worker prompt
3. Tell the worker: "This file has been modified since its last annotation. The following gotchas/patterns may be outdated — verify before relying on them."
4. Log a warn-level note: "Using stale annotation for {file} — content changed since last annotation"

---

## Step 5 — Build the PKI Knowledge Block

Aggregate the extracted knowledge from all annotations into a structured block for injection into worker prompts. This block supplements (not replaces) the convention map from CLAUDE.md.

### Knowledge Block Format

```
PKI KNOWLEDGE (from project annotations):

GOTCHAS (verified from PKI — respect these):
- [src/server/index.js] SSE connections are not authenticated — any client on the network can subscribe
- [src/server/index.js] Port defaults to 4000 but Electron app hardcodes 4000
- [src/server/services/WatcherService.js] Reconciliation interval (5s) means brief delay between file write and dashboard update

PATTERNS (follow these established patterns):
- [event-driven-architecture] Components communicate through events rather than direct calls. The server uses SSE to push file change notifications to the browser.
- [singleton-service] Service classes are instantiated once and shared across the application.

CONVENTIONS (maintain consistency with existing code):
- [src/server/index.js] All routes registered in a single setup function rather than separate route files
- [src/server/index.js] Error responses use { error: string } shape consistently

STALE (annotations outdated — verify before relying):
- [src/ui/components/AgentCard.jsx] File modified since last annotation — gotchas and patterns may have changed
```

### Injection Point

The PKI knowledge block is injected into the worker prompt's **CONVENTIONS** section, after any CLAUDE.md-derived conventions:

```
CONVENTIONS:
{Convention map content from CLAUDE.md — existing behavior, unchanged}

{PKI knowledge block — appended after CLAUDE.md conventions}
```

This keeps the CONVENTIONS section as the single source of "what the worker needs to know about the codebase" — both project-wide rules (from CLAUDE.md) and file-specific knowledge (from the PKI).

### Context Budget for PKI Knowledge

The CONVENTIONS section has an overall budget of ~200 lines in the worker prompt (see `worker_prompts.md`). The PKI knowledge block should consume **at most half** of this budget (~100 lines). If the PKI knowledge exceeds 100 lines:

1. **Prioritize gotchas** — they prevent errors. Never cut gotchas for space.
2. **Summarize patterns** — instead of full descriptions, use one-line references: "Follows event-driven-architecture pattern (see patterns.json)"
3. **Trim conventions** — conventions are the least critical. Include only those directly relevant to the worker's specific task.
4. **Drop stale entries** — if budget is tight, stale annotations are the first to cut.

---

## Step 6 — Use PKI Knowledge in Task Decomposition

Beyond injecting knowledge into worker prompts, the PKI informs how the master decomposes the user's request into tasks.

### Decomposition Signals from PKI

| PKI Signal | Decomposition Impact |
|---|---|
| File has `complexity: "high"` | Dedicate a full task to this file — do not bundle it with other files |
| File has 3+ gotchas | Worker prompt for this task needs more context budget — keep the task scope narrow |
| Two files have a `"serves"` / `"consumes"` relationship | These files likely need coordinated changes — assign to the same wave or create an explicit dependency |
| A file's `exports` are imported by files in the relevant set | Modify the exporter first (upstream task), then the importers (downstream tasks) |
| A concept spans 5+ files | Consider a dedicated integration task after individual file tasks |
| Multiple files share the same `patterns` | Include the pattern description once in a shared context note, rather than repeating it per-worker |
| File has `stale: true` | The worker should read the file fresh — do not rely solely on the annotation. Increase the READ list for this task. |

### Example: PKI-Informed Decomposition

User prompt: "Add rate limiting to all API endpoints"

Without PKI, the master might create one task: "Add rate limiting middleware."

With PKI, the master reads annotations and discovers:
- `src/server/index.js` has gotcha: "All routes registered in a single setup function"
- `src/server/middleware/auth.js` has convention: "Middleware follows before/after pattern with next() calls"
- `src/server/index.js` has relationship: "serves" data to `src/ui/hooks/useDashboardData.js`
- Rate limiting affects SSE endpoints (long-lived connections) differently than REST endpoints

The master now decomposes into:
1. Task 1: Create rate limiter middleware (following the existing middleware pattern)
2. Task 2: Apply rate limiter to REST endpoints (depends on 1)
3. Task 3: Apply rate limiter to SSE endpoints with connection-aware logic (depends on 1)
4. Task 4: Update dashboard hook to handle 429 responses gracefully (depends on 2, 3)

Each worker prompt includes the relevant gotchas and patterns from the PKI annotations.

---

## Fallback Behavior

The PKI is an enhancement, not a requirement. The master must function correctly when the PKI is absent, empty, or partially populated.

### Decision Matrix

| PKI State | Master Behavior |
|---|---|
| **No PKI** (manifest.json does not exist) | Use standard planning: CLAUDE.md convention map only. No PKI-related sections in worker prompts. |
| **Empty PKI** (manifest exists but `stats.annotated_files === 0`) | Same as no PKI. Log: "PKI exists but has no annotations — run !learn to populate." |
| **Partial PKI** (some files annotated, many missing) | Use available annotations. Do not assume unannotated files are irrelevant — they may simply not have been scanned yet. |
| **Fully stale PKI** (`stats.stale_files === stats.annotated_files`) | Use annotations with staleness warnings on all entries. Suggest the user run `!learn_update` before the next swarm. |
| **PKI exists, no matches** (no domains/tags match the prompt) | Log: "PKI found but no domains/tags match the current request." Proceed with standard planning. This is normal for prompts targeting areas not yet annotated. |
| **Manifest parses but annotations missing** (hash exists in manifest but annotation file is missing) | Log a warning per missing annotation. Use the manifest's `summary` field as a lightweight substitute (it provides a one-line file description). |

### Graceful Degradation Principle

Every step in the PKI pre-planning flow has a fallback that allows the master to continue. The flow never blocks on a missing or corrupt PKI file. The worst case is equivalent to the pre-PKI behavior — planning from CLAUDE.md and direct file reads only.

---

## Rules

### When to Use PKI Pre-Planning

| Condition | Use PKI? | Reason |
|---|---|---|
| PKI exists and has annotations | **Yes** | Primary use case — inject knowledge into worker prompts |
| User prompt touches multiple domains | **Yes** | PKI cross-referencing finds files the master might miss |
| User prompt is a quick single-file fix | **Maybe** | Read the annotation for that one file if it exists — skip the full domain/tag scan |
| PKI does not exist | **No** | Nothing to read. Use standard planning. |
| User explicitly says "skip PKI" or "ignore knowledge index" | **No** | Respect the user's instruction |

### Staleness Rules

| Rule | Detail |
|---|---|
| Never treat stale annotations as authoritative | Always include a staleness caveat in worker prompts when using stale data |
| If >50% of matched files are stale, suggest `!learn_update` | Log at warn level: "More than half of relevant annotations are stale. Consider running !learn_update." |
| Stale gotchas are still valuable | A gotcha about a file's behavior is worth including even if stale — the worker can verify it quickly |
| Stale exports/imports may be wrong | Do NOT rely on stale export/import data for task decomposition. The worker should read the file to confirm. |

### Context Budget Rules

| Rule | Detail |
|---|---|
| PKI knowledge block: max ~100 lines | Half of the CONVENTIONS section budget. Exceeding this crowds out CLAUDE.md conventions. |
| Per-file annotation extraction: max ~10 lines | Summarize to gotchas + most relevant pattern/convention. Do not dump entire annotations. |
| Total annotation reads: max 8-10 files | Beyond this, the planning phase takes too long and the knowledge exceeds the prompt budget. |
| Gotchas are never cut for budget | They prevent errors. Every other category can be trimmed before gotchas. |
| Worker-specific filtering is mandatory | A worker modifying `server/index.js` does not need gotchas from `ui/components/AgentCard.jsx`. Filter per-worker, not globally. |

### Non-Negotiable Rules

1. **The PKI never blocks planning.** If any PKI operation fails (file missing, parse error, empty result), log and continue. Never stall the swarm waiting for PKI data.
2. **PKI knowledge supplements, never replaces, CLAUDE.md.** The CLAUDE.md convention map is the primary source of project conventions. PKI annotations provide file-specific knowledge that CLAUDE.md cannot capture.
3. **Read the manifest, not the entire knowledge directory.** The manifest is the routing index. Never glob or scan the annotations directory directly — always go through the manifest's indexes.
4. **Filter per-worker.** The master builds a PKI knowledge block for each worker individually, based on that worker's files. Do not inject the same block into every worker prompt.
5. **Log every PKI decision.** Log which domains/tags matched, how many files were found, how many annotations were read, and any staleness warnings. This makes PKI-augmented planning auditable.

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| **Dumping all annotations into every worker prompt** | Context bloat — workers waste tokens reading irrelevant knowledge | Filter annotations per-worker based on the worker's specific files |
| **Skipping PKI when it exists** | Workers independently rediscover gotchas and patterns that were already known — wasted time and inconsistent results | Always check for PKI existence at the start of planning |
| **Treating stale annotations as authoritative** | Worker follows outdated patterns or misses a changed interface | Always include staleness caveat; mark stale entries clearly in the knowledge block |
| **Reading the annotations directory instead of the manifest** | Slow, unstructured, and misses the relationship between files and their annotations | Always go through manifest.json indexes — they are the routing layer |
| **Blocking the swarm on PKI errors** | Entire planning stalls because of a corrupt annotation file | Every PKI step has a fallback — log and continue |
| **Exceeding the annotation read budget** | Planning phase takes too long; extracted knowledge exceeds prompt budget | Cap at 8-10 files. Prioritize by complexity and relevance rank. |
| **Not logging PKI decisions** | Impossible to debug why a worker received (or didn't receive) certain knowledge | Log matched domains/tags, file count, annotation reads, and any skips |
| **Using PKI exports/imports from stale annotations for decomposition** | Task boundaries based on outdated interfaces — workers discover different exports at runtime | Only use export/import data from fresh (non-stale) annotations for decomposition |

---

## Related Documentation

- [PKI Schemas](../../documentation/data-architecture/pki-schemas.md) — Complete JSON schemas for manifest.json, annotation files, domains.json, and patterns.json
- [Worker Prompts](./worker_prompts.md) — Worker dispatch prompt template and convention injection point
- [!learn Command](../../_commands/project/learn.md) — How the PKI is initially populated
