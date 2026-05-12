# `!wiki`

**Purpose:** Build and maintain a living personal knowledge base — an LLM-curated wiki that *compiles* understanding instead of re-deriving it from raw sources every time. Adapted from Karpathy's LLM Wiki + the Wiki v2 production lessons (lifecycle, knowledge graph, hybrid search, automation, crystallization). Synapse-native: ingestion, lint, consolidation, and crystallization all run as parallel swarms with full dashboard tracking, and the wiki integrates with PKI, hooks, and post-swarm extraction.

**Distinct from PKI:** PKI (`!learn`) is *operational* knowledge about THIS codebase — gotchas, file relationships, conventions. The wiki is *durable* knowledge across sessions/projects/topics — claims, entities, decisions, lessons, and the graph that ties them together. The two are siblings: PKI feeds the wiki at swarm-end via crystallization; the wiki feeds back as context at swarm-start.

**Syntax:**

```
!wiki init [--upgrade]                # Bootstrap or upgrade wiki tier        [free]
!wiki status                          # Stats, health, recent activity        [free]
!wiki ingest <source>                 # Ingest one source                     [cheap]
!wiki ingest_batch <dir|glob>         # Parallel ingest swarm                 [swarm]
!wiki plan <plan_file>                # Build a plan-specific wiki capsule    [cheap]
!wiki plan_batch <dir|glob>           # Build capsules for multiple plans     [swarm]
!wiki query <question>                # Hybrid search → answer                [cheap]
!wiki lint                            # Structural quality sweep              [swarm]
!wiki audit                           # Epistemic contradiction sweep         [swarm]
!wiki crystallize [dashboard_id]      # Distill a completed swarm             [swarm]
!wiki consolidate                     # Promote working → ... → procedural    [free]
!wiki decay                           # Apply Ebbinghaus retention decay      [free]
!wiki graph <entity>                  # Walk the knowledge graph              [free]
!wiki schema_propose                  # Generate schema patch from drift      [cheap]
!wiki schema_accept <ver>             # Promote proposed schema to current    [free]
!wiki schema_rollback <ver>           # Roll back schema to a prior version   [free]
!wiki calibrate [--from <date>]       # Learn ranking weights from history    [cheap]
!wiki export <format> [filter]        # Export subset (md/json/csv/slides...) [free]
```

**Cost classes:** `free` = local I/O only · `cheap` = one LLM call · `swarm` = parallel LLM workers · `embed_heavy` = embedding API calls scale with corpus.

**Storage:** `{project_root}/.synapse/wiki/` (project-scoped by default). For a user-scoped wiki across projects, set `WIKI_ROOT` in `.synapse/project.json` to an absolute path.

**Produces:**
- `{wiki_root}/schema/current` — Pointer to active schema version. Versions live at `schema/v{N}.md`. Auto-bootstrapped by `!wiki init`.
- `{wiki_root}/schema/_proposed/` — Pending schema patches awaiting accept/rollback.
- `{wiki_root}/sources/` — Raw ingested sources (immutable originals + provenance).
- `{wiki_root}/plans/{plan_slug}/` — Plan-specific capsule: immutable source copy, manifest, index, and staged proposed pages/edges.
- `{wiki_root}/pages/{slug}.md` — Wiki pages (frontmatter + body, wikilinks); materialized from history.
- `{wiki_root}/pages/{slug}.history.jsonl` — Append-only edit log per page (mesh-safe merge source of truth).
- `{wiki_root}/embeddings/{slug}.bin` + `.meta.json` — Per-page vector + body-hash metadata for skip-re-embed gating.
- `{wiki_root}/graph/entities.json` — Typed entity catalog (people, projects, libraries, concepts, files, decisions).
- `{wiki_root}/graph/edges.json` — Typed relationships (uses, depends_on, contradicts, caused, fixed, supersedes, …).
- `{wiki_root}/graph/entities.history.jsonl` + `edges.history.jsonl` — Collection-level edit logs for graph artifacts.
- `{wiki_root}/findings/{hash}.md` — Audit findings (contradictions, drift, anomalies, gaps).
- `{wiki_root}/findings/{hash}.history.jsonl` — Per-finding append-only history across audit runs.
- `{wiki_root}/findings/_index.md` — Open + recurring findings summary.
- `{wiki_root}/index.json` — Hybrid search index (BM25 postings + embedding refs + entity refs).
- `{wiki_root}/index.md` — Human-readable catalog (auto-regenerated; truncated to 200 entries).
- `{wiki_root}/memory/{tier}.json` — Consolidation tiers: `working.json`, `episodic.json`, `semantic.json`, `procedural.json`.
- `{wiki_root}/audit.jsonl` — Append-only ops log; records active `schema_version` and `run_id` per op.
- `{wiki_root}/quarantine/` — Sources flagged for sensitive content; never indexed without review.
- `{wiki_root}/_attention.md` — Surfaces issues auto-resolution gave up on (recurring findings, no-progress lint, budget exhaustion, hook cycles).

---

## Storage Layout

```
{wiki_root}/
├── schema/
│   ├── current                     # Pointer file → active version (e.g. "v007")
│   ├── v001.md ... v00N.md         # Accepted schema versions (immutable once promoted)
│   └── _proposed/v00X.md           # Pending schema patches
├── sources/{hash}.{ext}            # Immutable raw sources
├── sources/{hash}.meta.json        # Provenance: origin, ingested_at, checksum, redactions
├── plans/
│   └── {plan_slug}/
│       ├── source.md               # Immutable copy of the original plan file
│       ├── manifest.json           # Plan provenance + generated wiki object index
│       ├── index.md                # Human entry point for this plan capsule
│       ├── proposed_pages.json     # Worker-staged page proposals before global merge
│       └── proposed_edges.json     # Worker-staged graph edge proposals before global merge
├── pages/
│   ├── {slug}.md                   # Materialized current state (regenerable from history)
│   └── {slug}.history.jsonl        # Append-only edit log: {ts, actor, op, frontmatter_patch, body_diff}
├── embeddings/
│   ├── {slug}.bin                  # Per-page vector
│   └── {slug}.meta.json            # { body_sha256, embedder, dims, created_at }
├── graph/
│   ├── entities.json               # { id, type, name, attrs, support, last_seen, decay_class }
│   ├── edges.json                  # { from, to, type, support, sources[], created_at, superseded_by? }
│   ├── entities.history.jsonl      # Collection-level edit log
│   └── edges.history.jsonl         # Collection-level edit log
├── findings/
│   ├── {hash}.md                   # One page per finding (contradiction, drift, anomaly, gap)
│   ├── {hash}.history.jsonl        # Per-finding history across audit runs
│   └── _index.md                   # Open + recurring findings summary
├── memory/
│   ├── working.json                # Recent raw observations (TTL: hours-days)
│   ├── episodic.json               # Compressed session/swarm summaries
│   ├── semantic.json               # Cross-session established facts
│   └── procedural.json             # Repeated workflows / patterns
├── index.json                      # Hybrid search index
├── index.md                        # Human catalog
├── audit.jsonl                     # Append-only ops log (schema_version + run_id per op)
├── quarantine/                     # Sensitive sources, manual review required
└── _attention.md                   # Issues auto-resolution couldn't close (surfaced for human)
```

### Page frontmatter schema

Every wiki page MUST start with this frontmatter:

```yaml
---
slug: kebab-case-id
title: Human-readable title
type: concept | decision | person | project | library | file | event | lesson | brief | finding | pattern | audit
domains: [domain1, domain2]
tags: [tag1, tag2, tag3]
entities: [entity_id_1, entity_id_2]            # Strong link into graph
sources: [source_hash_1, source_hash_2]         # Provenance
support:                                         # Components — never collapsed to a scalar at write time
  source_count: integer                          # # independent sources backing the claim
  source_authority_max: 0.0-1.0                  # Highest authority among sources
  contradiction_count: integer                   # # open contradictions against this page
  last_confirmed: ISO-8601                       # Last reinforcement (resets decay)
contradictions: [page_slug or finding_id]        # Open conflicts (resolved at lint/audit time)
supersedes: page_slug | null
superseded_by: page_slug | null
decay_class: fast | medium | slow | permanent
last_accessed: ISO-8601
created_at: ISO-8601
updated_at: ISO-8601
quality_score: 0.0-1.0                           # Set by lint (structural quality only)
pki_drift: false                                 # True if PKI for the same file disagrees with this page
schema_version: v007                             # Schema active when this page was last written
---
```

Body: prose with `[[wikilinks]]` to other slugs and `(@entity_id)` references for graph nodes. **`confidence` and `support_count` are NOT written by workers** — the `support:` block holds the components; the master computes ranking score and display band on the fly. See **Lifecycle Protocol**.

### Plan capsule manifest schema

Each `!wiki plan` / `!wiki plan_batch` run creates one capsule at `{wiki_root}/plans/{plan_slug}/manifest.json`:

```json
{
  "plan_slug": "kebab-case-id",
  "title": "Human-readable plan title",
  "source_path": "{project_root}/documentation/research/plans/candidates/example.md",
  "source_sha256": "...",
  "source_type": "final_plans | final_ratings | candidate | implementation_plan | product_spec | unknown",
  "plan_status": "proposed | selected | rejected | superseded | unknown",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "source_copy": "source.md",
  "generated_pages": ["page-slug-a", "page-slug-b"],
  "generated_entities": ["entity-id-a"],
  "generated_edges": ["edge-id-a"],
  "extracted": {
    "decisions": [],
    "assumptions": [],
    "risks": [],
    "required_evidence": [],
    "next_actions": [],
    "open_questions": []
  },
  "schema_version": "v007"
}
```

`source.md` is immutable once written for a given `source_sha256`. If the source plan changes, re-run `!wiki plan` to create a new capsule version or update `manifest.json` with a new source hash; do not silently overwrite old provenance. The capsule is a curated view and provenance bundle. Global reusable knowledge still lives in `pages/`, `graph/`, `sources/`, and `audit.jsonl`.

---

## Subcommand Phases

The router (`!wiki <subcommand>`) dispatches into one of the phase blocks below. All phases follow the master rules (parallel dispatch, master never reads sources directly, streaming writes, audit every op).

### `!wiki init [--upgrade]` — bootstrap or upgrade tier

Idempotent. Run once on first use; re-run with `--upgrade` to advance to the next tier.

1. **Skeleton.** Create `{wiki_root}/` with subdirs (`schema/`, `sources/`, `pages/`, `embeddings/`, `graph/`, `findings/`, `memory/`, `quarantine/`) and empty `audit.jsonl`. Skip dirs that already exist.
2. **Schema bootstrap.** If `schema/v001.md` is missing, detect project type (`package.json` → node, `pyproject.toml` → python, `Cargo.toml` → rust, etc.) and write a per-type template. Set `schema/current` → `v001`.
3. **Embedder choice.** Prompt: `none` (default — BM25 + graph only, hybrid search degrades gracefully), `local-minilm`, `openai-3-small`, or `custom`. Persist under `embedder:` in schema. Hybrid search refuses to invoke the vector worker until configured.
4. **Hook proposal.** Print proposed `.claude/settings.json` hook entries (see **Hooks Integration**). Apply via the `update-config` skill **only on user confirmation** — never auto-wire.
5. **Decay defaults.** Write per-page-type decay class defaults into schema (`decay_defaults:`).
6. **Tier report.** Print achieved tier (e.g. `Tier: MVW. Next: + Lifecycle. Run !wiki init --upgrade when ready.`). On `--upgrade`, show a diff of what would change to reach the next tier and ask before applying.
7. **Audit.** Log the init/upgrade with `op: init`, `tier_before`, `tier_after`.

**Cost class:** `free`. Re-running is safe; existing files are never overwritten.

### `!wiki ingest <source>` — single source

1. **Resolve & quarantine check.** If source is a URL, fetch with `WebFetch`. If file, read. Run a redaction pass (regex sweep for API keys, tokens, emails, anything matched by the active schema privacy filters). If hits found and not auto-strippable, move to `quarantine/` and stop.
2. **Persist raw.** Compute SHA-256 of content; write `sources/{hash}.{ext}` and `sources/{hash}.meta.json` (origin, ingested_at, redactions applied).
3. **Dispatch single worker.** Worker reads the active schema + the source, then returns: extracted entities, proposed pages, proposed edges, contradiction candidates against existing pages.
4. **Master assembly.** Master applies returns to `entities.json`, `edges.json`, and `pages/`. For each new claim, check existing graph for contradictions — if found, run the supersession protocol (see Lifecycle below).
5. **Index update.** Update `index.json` (BM25 postings + embedding refs) and regenerate `index.md`.
6. **Audit.** Append entry to `audit.jsonl`.

For a single source, `ingest` runs serially (one worker is fine). Use `ingest_batch` for parallel.

### `!wiki ingest_batch <dir|glob>` — parallel swarm

This is the high-leverage path. Use `!p_track` semantics with full dashboard tracking when ≥3 sources or multiple file types.

**Phase 1 — Discovery.** Master globs the path, classifies sources by type (markdown, pdf, code, transcript, html, json), and groups them into ~5–10 sources per worker.

**Phase 2 — Parallel ingest (Wave 1).** One worker per group. Each worker:
- Reads the active schema (cached in prompt)
- Reads its assigned sources
- Performs redaction
- Returns: `{ raw_writes: [...], proposed_entities: [...], proposed_edges: [...], proposed_pages: [...], contradiction_candidates: [...] }`

Workers do NOT write graph/page files — only raw `sources/` artifacts and their progress JSON. This avoids write conflicts on shared graph files.

**Phase 3 — Merge (Wave 2, single integration worker OR master assembly).** A single integration worker (or the master if the volume is small) reads all wave-1 returns and applies them to `entities.json`, `edges.json`, `pages/`. Conflicts resolved per the Supersession protocol. This is Pattern B (Integration) from CLAUDE.md.

**Phase 4 — Index rebuild (Wave 3).** Rebuild `index.json` and `index.md`. Optional parallel re-embedding for changed pages.

**Phase 5 — Auto-lint trigger.** If new contradictions or orphan pages introduced, automatically dispatch `!wiki lint` as a follow-up swarm.

### `!wiki plan <plan_file>` — plan-specific capsule

Build a durable wiki capsule for one plan while reusing the normal wiki source/page/graph/audit machinery. Use this for `documentation/research/plans/final_plans.md`, `final_ratings.md`, `candidates/{plan-slug}.md`, implementation plan documents, or product spec sheets.

1. **Resolve the plan file.** Resolve `{project_root}` and the plan path. Accept absolute paths or paths relative to `{project_root}`. Refuse missing files, directories, or binary files. Read the active wiki schema first.
2. **Compute `plan_slug`.** Prefer frontmatter `plan_slug`, then first H1, then filename. Kebab-case and cap at 80 chars. If the slug already exists with a different source hash, create a versioned slug (`{plan_slug}-{short_hash}`) rather than overwriting old provenance.
3. **Create the capsule.** Create `{wiki_root}/plans/{plan_slug}/`. Copy the plan verbatim to `source.md`. Compute SHA-256 of the source and write `manifest.json` with source path, source hash, inferred source type, `plan_status: unknown`, and empty generated object lists.
4. **Persist raw source.** Also persist the plan under `sources/{hash}.md` with `sources/{hash}.meta.json` (`origin`, `source_type: plan`, `plan_slug`, `ingested_at`, checksum, redactions applied). This lets generated pages cite the plan through normal `sources[]` provenance.
5. **Dispatch one plan-wiki worker.** Worker reads the active schema and `source.md`, then writes only these staging files inside the capsule:
   - `proposed_pages.json`
   - `proposed_edges.json`
   - optional `proposed_entities.json`

   Worker extracts: decisions, assumptions, risks, required evidence, entities, implementation steps, open questions, alternatives, contradictions, and next actions. It must preserve the plan's original wording in quotations where exact wording matters.
6. **Master assembly.** Master applies staged output using the same rules as `ingest`: create/update global pages, update entities and edges, run contradiction/supersession checks, rebuild `index.json` and `index.md`, and append `audit.jsonl` entries. Workers never write global `pages/` or `graph/` directly.
7. **Write capsule index.** Write `{wiki_root}/plans/{plan_slug}/index.md` with:
   - link to `source.md`
   - generated pages and entities
   - extracted decisions, assumptions, risks, required evidence, next actions, and open questions
   - contradictions or supersession notes
   - audit run ID and schema version
8. **Report.** Return the capsule path, generated page count, generated edge count, contradictions found, and most important next action.

**Plan page mapping guidance:**
- Overall plan summary → `type: brief`
- Chosen direction or architectural/product choice → `type: decision`
- Non-obvious lesson from the plan/evaluation → `type: lesson`
- Reusable workflow or implementation pattern → `type: pattern`
- Major unresolved risk or contradiction → `type: finding`

For `final_plans.md`, create one brief for the top-N comparison plus decision/lesson/finding pages for the recommendation, strategic forks, convergent risks, and load-bearing assumptions. For a single `candidates/{plan-slug}.md`, center the capsule on that candidate and cross-link to any alternatives named in the text.

### `!wiki plan_batch <dir|glob>` — parallel plan capsules

Build plan capsules for multiple plan files while serializing global wiki writes.

1. **Discover plan files.** Resolve `<dir|glob>` relative to `{project_root}` unless absolute. Include markdown files only. Ignore generated capsule files under `{wiki_root}/plans/**` to avoid self-ingestion loops.
2. **Preflight.** If zero files match, stop with a clear message. If one file matches, recommend `!wiki plan <file>` but allow continuing. If 3+ files match, use full dashboard tracking.
3. **Create isolated capsules first.** For every plan file, compute `plan_slug`, create `{wiki_root}/plans/{plan_slug}/`, copy `source.md`, and initialize `manifest.json`. This makes partial progress resumable.
4. **Parallel extraction wave.** Dispatch workers in parallel, one plan per worker unless there are many small plans; then group 3-5 related plans per worker. Each worker writes only inside assigned capsule directories (`proposed_pages.json`, `proposed_edges.json`, `proposed_entities.json`). Workers do not write global pages, graph, index, or audit.
5. **Single global merge.** Dispatch one integration worker OR have the master assemble if the volume is small. It reads all capsule staging files and applies global page/entity/edge writes using the same rules as `ingest_batch`: Pattern B, contradiction checks, supersession, index rebuild, audit entries.
6. **Cross-plan linking.** When plans are alternatives, mutually exclusive, or share assumptions, create explicit graph edges (`contradicts`, `supersedes`, `depends_on`, `mentions`, or schema-specific alternatives edges). Do not silently merge conflicting plans into one page.
7. **Finalize capsules.** Update each `manifest.json` with generated pages/entities/edges and write each `index.md`. Print a batch summary sorted by plan slug with generated objects and conflicts.

`plan_batch` is the preferred path for `documentation/research/plans/candidates/*.md` because candidates are independent during extraction but need one serialized merge into the global wiki.

### `!wiki query <question>` — hybrid search + answer

1. **Plan the search.** Decompose the question: keywords for BM25, semantic intent for vectors, named entities for graph traversal.
2. **Three streams in parallel** (single message, three Tasks):
   - **BM25 worker:** stem + synonym-expand the query against `index.json` postings; return top-k pages with scores.
   - **Vector worker:** embed the query, cosine-search against page embeddings; return top-k.
   - **Graph worker:** identify entity mentions in the query, walk `edges.json` outward N hops, return reachable pages weighted by edge confidence × distance decay.
3. **Reciprocal Rank Fusion.** Master fuses the three result lists: `score = Σ 1/(60 + rank_in_stream)`. Take top-K.
4. **Synthesize.** Master reads only the fused top-K page bodies, then writes the answer with `[[wikilink]]` citations and a confidence band.
5. **File-back gate.** Score the answer (structure, citations, novelty vs existing pages). File-back proceeds only if **all** of these hold:
   - `quality_score >= 0.75` (configurable as `file_back_quality_threshold`).
   - **No near-duplicate exists.** A near-duplicate is defined as a page where `cosine_similarity >= 0.85` AND `shared_entity_count >= 3` AND `same_type` (matching the answer's intended `type`). All three must hit; any one alone over-merges.
   - Threshold values live in schema's `dedup:` block.

   If gate passes, propose a new page. Confirm with user unless schema sets `auto_file_back: true`.
6. **Update access timestamps.** Touch `last_accessed` on every page in the top-K; this resets decay (Ebbinghaus reinforcement).

### `!wiki lint` — parallel quality + contradiction sweep

Decomposes naturally into 3+ independent sub-jobs → use `!p_track`.

- **Worker A — Orphans & broken wikilinks.** Walk all pages, find `[[wikilinks]]` to nonexistent slugs and pages with zero inbound links. Auto-fix what's auto-fixable (slug typos via fuzzy match), flag the rest.
- **Worker B — Contradictions.** Compare claims across pages within the same `entity` cluster. Use the LLM to spot conflicts. Output a contradiction set.
- **Worker C — Quality scoring.** For each page, score: has-citations, structure, link density, age vs `last_confirmed`, alignment with the active schema. Update `quality_score` in frontmatter.
- **Worker D — Schema drift.** Compare current page corpus against the active schema. Surface missing rules, new types appearing organically, or rules being violated systematically. Propose schema patches via `!wiki schema_propose`.

After workers return, the master applies auto-fixes, marks contradictions for resolution (proposing the more-supported claim wins by default), and prints a lint report.

**Auto-trigger guards** (applies whenever lint is fired automatically — e.g. post-`ingest_batch`):
- **Cooldown.** Don't auto-fire if lint ran within the past 60 minutes.
- **Threshold.** Only fire when new contradictions ≥ 3 OR new orphans ≥ 5. Single contradictions wait for the daily/weekly cron.
- **Budget.** If `budgets.daily_max_tokens` would be exceeded, defer and append a one-line entry to `_attention.md` instead.
- **No-progress detector.** Lint stores a hash of its proposed-fix set in `audit.jsonl`. After 3 consecutive runs proposing the same fix set without user acceptance, lint stops auto-firing for that fix set and writes to `_attention.md` ("lint has proposed X for 3 runs; manual review needed"). Self-healing should know how to give up.

### `!wiki audit` — epistemic contradiction + uncertainty sweep

**Distinct from lint.** Lint asks "is the wiki *well-formed*?" (orphans, broken wikilinks, missing citations, schema drift). Audit asks "do the *claims hang together*?" (contradictions across sources, temporal drift, confidence anomalies, coverage gaps). Both run; neither replaces the other. Audit is the periodic epistemic layer — runs weekly by default, cheaper than re-ingesting everything, and every finding it produces has its own append-only edit history so recurring problems are visible.

Decomposes into 5 independent workers → use `!p_track` with full dashboard tracking.

**Wave 1 — parallel detection (5 workers, all read schema, none write to `findings/`):**

- **Worker A — Cross-source contradictions.** Sample top-N high-traffic entities (by `last_accessed` count or graph centrality). For each, gather every source excerpt mentioning that entity AND every page claiming things about it. Ask: do these claims agree? Output: `{entity_id, claim_a, source_a, claim_b, source_b, severity}` finding records.
- **Worker B — Temporal drift.** Find pages where `support.last_confirmed` is older than the page's decay-class half-life AND a newer source mentions the same entity (potentially with different attributes). Flag for re-verification.
- **Worker C — Confidence anomaly.** Pages where the rule-based display band disagrees with empirical signals — high `support.source_count` but stale `last_confirmed`; low `source_count` but heavy inbound link density; pages frequently accessed but never reinforced; pages with `support.contradiction_count > 0` that haven't been touched by lint.
- **Worker D — Graph inconsistency.** Detect contradictory edge pairs between the same node pair (e.g., `uses` AND `contradicts` simultaneously). Detect missing transitive edges that schema's `inference_rules:` would predict (A→B + B→C should imply A→C for transitive edge types). Detect edges whose `sources[]` no longer exist in `sources/`.
- **Worker E — Coverage gaps.** Entities mentioned in ≥3 sources with no dedicated page. Pages whose `entities:` aren't reflected in graph edges. Sources never linked to any page. Recently-ingested sources whose claims never made it into a page.

Workers return findings; they do NOT write to `findings/` directly (avoids concurrent writes to `findings/_index.md`).

**Wave 2 — single integration worker:**

1. Read all wave-1 findings. Compute a stable hash per finding: `sha256(entity_id + finding_type + canonical(claim_pair))`. The hash is what makes findings *trackable across runs* — same problem produces same hash.
2. **New finding** (hash unseen): create `findings/{hash}.md` with frontmatter (`type: finding`, `finding_type`, `severity: low|medium|high`, `status: open`, `first_seen`, `entities:`, `sources:`). Append first entry to `findings/{hash}.history.jsonl`.
3. **Recurring finding** (hash seen in prior runs but still detected): append a new history entry with the current run's evidence. If the finding has appeared in **≥3 consecutive audit runs without resolution**, escalate severity to `recurring` and write a one-line entry to `_attention.md` ("finding {hash} recurring 3+ runs — manual review needed").
4. **Resolved finding** (previously open, NOT detected this run): mark `status: resolved` in the page frontmatter and append a final history entry with `resolution_evidence`. Do NOT delete — resolution is itself signal.
5. Regenerate `findings/_index.md` (sorted: `recurring` → `high` → `medium` → `low` → `resolved`, capped to 100 entries with a pointer to the rest).
6. Audit log entry per state change (`op: finding_opened`, `finding_recurring`, `finding_resolved`).

**History entry format** (`findings/{hash}.history.jsonl`, append-only, one line per state change):
```json
{"ts":"2026-05-02T...","audit_run_id":"audit-abc123","status":"open","severity":"high","evidence":[{"page":"...","source":"..."}],"actor":"audit-worker-a"}
```

This is the durable record of every audit run's view of every finding — even resolved findings keep their full history. "Has anyone tried to resolve this contradiction before?" is a one-line `tail` of the history file.

**Schedule:** weekly cron (cost class `swarm` — too expensive for daily). Manual via `!wiki audit`. Subject to the same budget guard as lint: if firing would exceed `budgets.weekly_max_tokens`, defer and write to `_attention.md`.

**Findings feed back into the rest of the system:**
- Worker D output (graph inconsistencies) and recurring contradictions automatically generate `!wiki schema_propose` candidates — proposed schema rules to prevent the class of issue.
- High-severity Worker B findings (temporal drift) trigger a `!wiki ingest` of the suggested fresher source IF schema has `audit.auto_refetch: true` AND the source is referenced. Otherwise they wait for the user.
- Recurring findings reaching the `_attention.md` threshold are surfaced at the next session-start hook.

### `!wiki crystallize [dashboard_id]` — distill a swarm

Triggered automatically post-swarm by the post-swarm extraction hook (see Hooks below), or manually with a dashboard ID.

1. **Read the swarm.** Master reads `dashboards/{id}/initialization.json`, `logs.json`, `metrics.json`, and worker progress files.
2. **Dispatch a single distillation worker.** Prompt: "You are crystallizing this swarm into permanent wiki knowledge. Produce: (a) a `brief` page summarizing question/findings/files-touched, (b) standalone `lesson` pages for each non-obvious insight, (c) entity updates (new files, decisions, libraries discovered), (d) edge updates (caused/fixed/depends_on relationships observed)."
3. **Master applies returns** the same way as `ingest` — graph and page writes, contradiction check, index rebuild.
4. **Link the brief** back to the source dashboard via an edge `(@brief) -[derived_from]-> (@dashboard:{id})`.

### `!wiki consolidate` — tier promotion

Working memory grows fast and decays fast; semantic memory grows slowly and decays slowly. Promotion conditions:

| From | To | Condition |
|---|---|---|
| `working` | `episodic` | Observation appears in ≥2 working entries OR is older than 24h |
| `episodic` | `semantic` | Compressed claim appears in ≥3 episodic entries across sessions |
| `semantic` | `procedural` | Repeated workflow pattern (≥5 occurrences) → extract as procedure page |

A single consolidation worker per tier transition; runs in parallel since the tiers are independent. After promotion, source-tier entries are NOT deleted — they are marked `promoted_to: <tier>` and decay normally.

### `!wiki decay` — Ebbinghaus retention

Apply per-page decay based on `decay_class` and time since `last_accessed` / `last_confirmed`:

- `fast` (transient bugs, ephemeral state): half-life 7 days
- `medium` (project decisions, current people/roles): half-life 60 days
- `slow` (architecture, established conventions): half-life 1 year
- `permanent` (axioms, schema rules): no decay

`confidence` is multiplied by the decay factor. Pages dropping below `confidence < 0.2` are moved to `pages/_archived/` (not deleted — retrievable via `--include-archived`). Each access or new-source confirmation resets the decay clock.

### `!wiki schema_propose / schema_accept / schema_rollback` — versioned schema lifecycle

The schema is the most important file in the system AND is itself versioned, audited, and rollback-able. Pages are NEVER auto-rewritten on schema change — drift surfaces in the next audit.

**`!wiki schema_propose`** *(cost: cheap)*:
1. Reads recent `findings/` (open + recurring) and the latest `!wiki lint` report.
2. Generates a candidate patch — added types, modified rules, new privacy filters, refined decay defaults, glossary additions.
3. Writes `schema/_proposed/v{N+1}.md` (where N is the current version).
4. Prints a unified diff vs `schema/current`.
5. Audits with `op: schema_proposed`.

**`!wiki schema_accept <ver>`** *(cost: free)*:
1. Validates `schema/_proposed/{ver}.md` (required fields present, syntax valid, no removed mandatory rules).
2. Renames `_proposed/{ver}.md` → `schema/{ver}.md` (immutable once promoted).
3. Updates `schema/current` → `{ver}`.
4. Audits with `op: schema_accepted`, `from_version`, `to_version`.

**`!wiki schema_rollback <ver>`** *(cost: free)*:
1. Validates `schema/{ver}.md` exists in accepted versions.
2. Updates `schema/current` → `{ver}`.
3. Audits with `op: schema_rolled_back`. Pages remain on disk as-is; their `schema_version:` frontmatter still records the version they were written under, so the next audit naturally surfaces drift.

The active schema's hash is recorded in every audit log entry, making "what was the schema when X happened?" a one-line `jq` query against `audit.jsonl`.

### `!wiki calibrate [--from <ISO-date>]` — learn ranking weights from history

Reads `audit.jsonl` access patterns and supersession outcomes since `--from` (default: 90 days ago). Fits the `confidence_for_ranking()` weights against an objective: pages that were *accessed and not superseded* should rank above pages that *were* superseded.

1. Single LLM call OR local solver (schema selects via `calibrate.method:`). Outputs proposed weights for `ranking_weights:`.
2. Writes a schema patch to `schema/_proposed/v{N+1}.md`. User accepts via `!wiki schema_accept`.
3. If insufficient history (< 100 events since `--from`), refuses with a count and a recommendation to wait.

**Don't run before there's data.** The default formula in the bootstrapped schema is heuristic and explicitly marked as such. Calibration is opt-in — there's no auto-calibrate hook.

Cost class: `cheap`.

### `!wiki graph <entity>` — graph traversal

Print the local neighborhood of an entity: outbound edges (typed), inbound edges, sibling entities (co-occurring in pages). Useful for impact analysis: `!wiki graph redis` → shows everything that uses, depends_on, or is contradicted_by Redis.

### `!wiki export <format> [filter]` — multi-format output

`format` ∈ {`md`, `json`, `csv`, `slides`, `brief`, `timeline`, `dep-graph`}. `filter` ∈ {domain, tag, entity, page-list}. Reuses Synapse's existing export plumbing (`!export`) for delivery. Output goes to `{wiki_root}/exports/{timestamp}-{format}/`.

---

## Lifecycle Protocol (Wiki v2 core)

### Confidence: components, not a scalar

Workers do NOT write a `confidence` float. The `support:` block stores the components (`source_count`, `source_authority_max`, `contradiction_count`, `last_confirmed`) in frontmatter. Two composers exist in code:

**`confidence_for_ranking(page) -> float [0,1]`** — used internally by search ranking ONLY. Default formula:

```
base = source_authority_max × W_AUTH
     + log(source_count + 1) / log(10) × W_SUPPORT
     + recency_factor(last_confirmed, decay_class) × W_RECENCY
     - W_PENALTY × contradiction_count
score = clip(base, 0, 1)
```

Weights live in schema's `ranking_weights:` block (defaults `W_AUTH=0.5`, `W_SUPPORT=0.3`, `W_RECENCY=0.2`, `W_PENALTY=0.5`) and are tunable via `!wiki calibrate`. The defaults are **explicitly heuristic** — do NOT treat the resulting scalar as a calibrated probability. It exists only to order results.

**`confidence_for_display(page) -> {high, medium, low, disputed}`** — rule-based, used in UI/output:
- `disputed` if `contradiction_count > 0`
- `low` if `source_count == 1` AND `last_confirmed` older than 90 days
- `high` if `source_count >= 3` AND `last_confirmed` within decay-class half-life
- `medium` otherwise

**Surface the band, not the scalar.** The scalar is for ranking, where false precision is harmless because it's only used for ordering. The band is for humans, where a fake `0.85` would be misleading.

### Supersession

When new content contradicts an existing page:

1. Master compares supporting evidence (count + recency + authority of new sources vs old).
2. If new wins decisively (>1.5× support), the old page is marked `superseded_by: <new_slug>` and the new gets `supersedes: <old_slug>`. Old page stays in `pages/` (not deleted) — version history is queryable.
3. If close, both pages stay live with reciprocal `contradictions:` references; surfaced by lint until human resolves.
4. Audit log records the decision with the evidence summary.

### Decay & forgetting

`!wiki decay` is run on a schedule (see Hooks). Forgotten pages are deprioritized in search ranking but never silently destroyed. The `permanent` decay class exists specifically for schema-derived axioms and load-bearing project facts.

---

## Knowledge Graph

The graph is layered ON TOP of pages — pages are still the readable unit, the graph is the navigable unit.

**Node types** (extensible via the active schema): `person`, `project`, `library`, `concept`, `file`, `decision`, `event`, `lesson`, `source`, `dashboard`.

**Edge types** (typed and weighted): `uses`, `depends_on`, `contradicts`, `caused`, `fixed`, `supersedes`, `derived_from`, `mentions`, `owns`, `authored`, `co_occurs_with`.

Every edge has: `from`, `to`, `type`, `confidence`, `sources[]`, `created_at`, optional `superseded_by`. Stored in `graph/edges.json`. Workers propose edges; master commits them. Edge confidence decays alongside connected page confidence.

**Graph traversal queries** (`!wiki query`, `!wiki graph`): start at named entities, walk outward N hops along typed edges, weight by confidence × distance. Catches structural connections that BM25 + vectors miss.

---

## Hybrid Search

`index.json` stores three parallel structures:

1. **BM25 postings** — token → page list with TF-IDF weights. Stemmed, with synonym expansion driven by schema's glossary.
2. **Embedding refs** — vectors live in `embeddings/{slug}.bin` with a sidecar `embeddings/{slug}.meta.json` recording `{body_sha256, embedder, dims, created_at}`. **Embedding writes are content-hash gated**: the page-write hook computes `sha256(body)` and skips re-embed if it matches the sidecar's `body_sha256`. Frontmatter-only edits never trigger re-embed. During a swarm, embedding requests are batched and flushed every 10s or 50 pages, whichever first — so a 30-page crystallize fires one batch call instead of thirty.
3. **Entity refs** — entity ID → pages mentioning it.

The embedder is configured during `!wiki init` (`none` | `local-minilm` | `openai-3-small` | `custom`). If `none`, hybrid search degrades to BM25 + graph only; the vector worker is skipped and RRF fuses two streams instead of three. **Master never calls `WebFetch` for embeddings** — that's an HTTP fetcher, not an embedding client. Embedder invocation goes through the configured provider's SDK, not a generic URL fetch.

Query path: dispatch up to three workers in parallel (BM25, vector, graph), fuse via Reciprocal Rank Fusion. `index.md` exists for human browsing only — never the LLM's primary search past ~100 pages.

---

## Hooks Integration (Synapse-native automation)

The wiki becomes self-maintaining via Synapse hooks. `!wiki init` proposes the following entries for `.claude/settings.json` and applies them via the `update-config` skill **only on user confirmation**.

| Event | Hook | Action | Cost class | Cooldown / Guard |
|---|---|---|---|---|
| Source dropped in `sources/_inbox/` | `PostToolUse` watcher | `!wiki ingest_batch sources/_inbox/` | swarm | 5 min per dir |
| Session start | Pre-session | Inject top-5 fused pages as context | cheap | none |
| Session end | Post-session | Compress session → `working.json` entry | cheap | none |
| Swarm complete | Post-swarm | `!wiki crystallize <dashboard_id>` | swarm | per dashboard |
| Page write | `PostToolUse` on `pages/*.md` | Re-embed **only if body hash changed**; rebuild `index.json` deltas; check contradictions | embed_heavy (gated) | content-hash gated |
| Daily | Schedule | `!wiki decay` + `!wiki consolidate` | free | n/a |
| Weekly | Schedule | `!wiki audit` + `!wiki lint` | swarm | budget-gated (skip if `daily_max_tokens` would exceed) |

**Cycle protection.** Every hook-triggered invocation propagates `--triggered-by <run_id>` and `--depth N`. The dispatcher refuses any chain at `depth > 3` and writes the cycle path to `_attention.md`. This prevents lint→ingest→lint loops and crystallize cascades.

**Cost discipline.**
- Daily cron is intentionally `free` (decay + consolidate are local I/O). Lint and audit move to **weekly** because they cost real tokens.
- `budgets.daily_max_tokens` and `budgets.weekly_max_tokens` live in schema. On exceed, the configured `on_exceed:` policy fires (`pause | warn | hard_stop`).
- Every `swarm` and `embed_heavy` op supports `--dry-run`, which prints the planned worker count and rough token budget before dispatch.

**No-progress detector.** Lint and audit both store a hash of their proposed-fix / open-finding set in `audit.jsonl`. After 3 consecutive runs with the same hash and no user resolution, that loop stops auto-firing and writes a one-line summary to `_attention.md`. Self-healing should know how to give up.

**Hooks first, polling never.** Use the table above for automation. Do not implement polling loops in the command itself; schedule via the `loop` or `schedule` skill if needed.

---

## Privacy & Governance

- **Filter on ingest.** Every ingest worker MUST run a redaction sweep before persisting raw sources. Patterns are defined in the active schema under `privacy_filters:`. Defaults: API key formats, JWT tokens, AWS keys, Bearer tokens, email addresses (configurable).
- **Quarantine, don't reject.** If redaction can't strip cleanly, move to `quarantine/` for human review rather than silently dropping.
- **Audit trail.** Every ingest, edit, delete, query, and lint decision appends to `audit.jsonl`. Format: `{ ts, op, actor, target, before_hash?, after_hash?, reason }`. Never truncated.
- **Bulk ops are reversible.** `!wiki export` + filesystem-level snapshot before any bulk delete. The wiki never offers an unguarded `delete-all`.

---

## Multi-agent / Shared vs Private

- **Default scope: project.** `{project_root}/.synapse/wiki/` is checked into git or kept local per the project's policy.
- **Private overlay:** `{user_home}/.synapse/wiki-private/` is auto-merged at read time; never written by swarm workers, only by direct `!wiki` invocations marked `--private`.
- **Mesh sync via per-page edit log. Last-write-wins is forbidden on pages.** Each page has a sibling `pages/{slug}.history.jsonl` — append-only, every write is `{ts, actor, op, frontmatter_patch, body_diff}`. The on-disk `pages/{slug}.md` is the *materialized* current state, regenerable from history on read or after merge.
  - **Body merge.** Two agents touching the same page produce two history entries with a common ancestor; merge is three-way (`git merge-file` semantics) on the body. Conflicts produce git-style markers AND a `contradictions:` flag in frontmatter so audit/lint surface them.
  - **Frontmatter scalar conflicts.** Take latest by `ts`. If both edits land within a 60-second window, mark conflict — don't silently pick.
  - **Frontmatter sets** (`tags`, `sources`, `entities`): union.
  - **Frontmatter numerics** (`support.source_count`, `support.contradiction_count`): take max — never overwrite downward.
  - **Graph artifacts** (`entities.json`, `edges.json`): collection-level edit logs at `graph/entities.history.jsonl` and `graph/edges.history.jsonl`. Edges union as before; entities use the same scalar/set/numeric rules as page frontmatter.

The edit log is the source of truth for every contested artifact. Materialized `.md` and `.json` files are derived state — regenerable, throwable. This is the only mesh-safe primitive that doesn't lose work.

---

## Schema.md — the real product

The schema is the most important file in the system AND is itself versioned, audited, and rollback-able. It lives at `schema/v{N}.md`; the active version is pointed to by `schema/current`. Auto-bootstrapped by `!wiki init`. It encodes:

- Domain entity types and edge types specific to this project's vocabulary
- Privacy filters (regex list)
- Embedder choice + model + dimensions (`embedder:`)
- Decay class defaults per page type (`decay_defaults:`)
- `auto_file_back:` policy + `file_back_quality_threshold:`
- `dedup:` thresholds (cosine / entity-overlap / type gates for near-duplicate detection)
- `ranking_weights:` (W_AUTH, W_SUPPORT, W_RECENCY, W_PENALTY) — tunable via `!wiki calibrate`
- Quality thresholds (min `quality_score` to surface in search)
- Glossary / synonym map for BM25 expansion
- Page templates per type
- Consolidation thresholds (overrides defaults)
- `inference_rules:` — graph rules audit Worker D uses to predict missing transitive edges
- `budgets:` — `daily_max_tokens`, `weekly_max_tokens`, `per_swarm_max_tokens`, `on_exceed: pause | warn | hard_stop`
- `audit.auto_refetch:` (true/false) — whether high-severity temporal-drift findings auto-trigger a re-ingest

Master and workers ALWAYS read the active schema first; the schema's version is recorded in every page's frontmatter (`schema_version:`) and in every audit log entry. **Co-evolution is propose-then-accept**, never auto-apply. Lint and audit propose patches; `!wiki schema_accept <ver>` promotes them; `!wiki schema_rollback <ver>` reverts. Pages are NEVER auto-rewritten on schema change — drift surfaces in the next audit.

---

## Implementation Spectrum (incremental adoption)

You don't need everything on day one. The command supports a tiered rollout:

| Tier | What you get | What's needed |
|---|---|---|
| **MVW (Minimal Viable Wiki)** | `ingest`, `query`, `lint`, `index.md` | `!wiki init` creates `pages/` + `sources/` + `schema/v001.md` |
| **+ Lifecycle** | `support` components, supersession, decay | Per-page edit logs + `support` block + `audit.jsonl` |
| **+ Structure** | Knowledge graph + entity-aware queries | Add `graph/` + entity workers in ingest |
| **+ Automation** | Hooks → hands-off maintenance with cycle protection | Wire `.claude/settings.json` hooks (proposed by `!wiki init`) |
| **+ Audit** | Periodic epistemic sweep — contradictions, drift, anomalies, gaps; per-finding history | Add `findings/`, weekly `!wiki audit` cron |
| **+ Scale** | Hybrid search + consolidation tiers | Configure embedder, add `index.json` BM25 + `embeddings/`, `memory/` tiers |
| **+ Collaboration** | Mesh-safe merge + private overlay | Wire per-page edit log merge protocol, add `wiki-private/` |

`!wiki status` reports current tier and the next adoption step. `!wiki init --upgrade` advances the tier, showing a confirmation diff before applying.

---

## Rules

### Non-Negotiable — Master Agent Constraints

1. **Master never reads source files directly during ingest.** All raw-source reading is delegated to ingest workers. Master only reads agent returns and the schema.
2. **Parallel ingest is mandatory at ≥3 sources.** Use `!p_track` with full dashboard tracking. Sequential ingest is forbidden when the source set decomposes naturally — the dashboard exists exactly for this.
3. **Graph writes are serialized through one integration worker (or the master) per swarm.** Never let multiple workers write `graph/entities.json` or `graph/edges.json` concurrently. Use Pattern B (Integration) from CLAUDE.md.
4. **Streaming assembly.** Master writes pages and graph updates as workers return — do NOT batch until end of wave. Mid-swarm interruption must leave the wiki in a consistent state.
5. **Schema.md is loaded by every operation.** No exceptions. The schema IS the behavior.

### Quality Rules

- **Every page MUST cite sources.** A page with empty `sources: []` is rejected by lint and quarantined for review.
- **Every claim that contradicts an existing page triggers the supersession protocol.** No silent overwrites.
- **Confidence is computed, not asserted.** Workers write the `support:` components only. They may NOT write a literal `confidence` field — pages with one are quarantined. `confidence_for_ranking()` and `confidence_for_display()` are computed by the master at query/render time.
- **Lint and audit auto-trigger guards apply.** Cooldown, threshold, budget, and no-progress gates (see Hooks) — auto-firing without these guards is forbidden.
- **Audit every mutation.** Every page/graph/index/schema write appends to `audit.jsonl` with the current `schema_version`, `run_id`, and `--depth`. No exceptions, including auto-fixes.
- **Embedding writes are content-hash gated.** The page-write hook MUST check `sha256(body)` against the embedding sidecar's `body_sha256` before re-embedding. Frontmatter-only edits never trigger re-embed.
- **Schema changes go through propose/accept/rollback.** Never edit `schema/current` directly. Never edit a promoted `schema/v{N}.md` — versions are immutable once accepted. Use `!wiki schema_propose` → review → `!wiki schema_accept`.
- **Plan capsules preserve provenance.** `!wiki plan` and `!wiki plan_batch` never rewrite the original plan. They copy it into `source.md`, preserve source hash/path metadata, and stage extracted knowledge before the global merge.
- **Plan alternatives stay distinct.** Multiple candidate plans may contradict each other by design. Cross-link alternatives and contradictions with graph edges; do not collapse competing plans into one blended recommendation.
- **Plan status is explicit.** Plan-derived pages and manifests must record whether the plan is proposed, selected, rejected, superseded, or unknown when that status is knowable.

### Synapse Integration Rules

- **Wiki ops use Synapse dashboards.** `ingest_batch`, `plan_batch`, `lint`, `audit`, `crystallize`, `consolidate` all spin up real dashboards (or attach to an existing one when chained). Track them like any other swarm.
- **Workers report progress per `tracker_worker_instructions.md`.** Wiki workers are normal Synapse workers with normal progress files.

#### Wiki ↔ PKI Exchange Contract

The wiki and PKI feed each other. The mapping is explicit:

| PKI artifact | On `!wiki crystallize` → wiki effect |
|---|---|
| File-level gotcha | Edge `(@file) -[has_gotcha]-> (@lesson)`; lesson page created with `decay_class: medium` |
| Convention / pattern | Page of `type: pattern`, `decay_class: slow`; entities auto-linked into graph |
| Domain term | Entity of `type: concept`; glossary entry added to schema's synonym map |
| File relationship | Edge `(@file_a) -[depends_on]-> (@file_b)` with `sources: [pki:{commit_sha}]` |

**Reverse direction.** `!learn_update` reads pages of `type: decision | convention | pattern` and seeds annotations for the files those pages list in their `entities:` field. The wiki provides the *why*; the PKI provides the *where in this commit*.

**Conflict rule.** When wiki and PKI disagree about the same file: the **wiki is canonical for cross-session/durable claims**, the **PKI is canonical for the current commit**. On disagreement, the wiki page gets `pki_drift: true` in frontmatter and the next `!wiki audit` Worker C surfaces it as a confidence anomaly. This is intentional — durable knowledge should not be silently overwritten by per-commit observations, but per-commit reality should not be hidden either.

### General Rules

- **Pages are markdown + frontmatter, always.** Never store wiki content as raw JSON. JSON is reserved for graph/index/memory/audit.
- **Slugs are kebab-case and stable.** Renaming a page requires a redirect entry: leave a stub page with `superseded_by: <new_slug>`.
- **Wikilinks resolve at write time.** Every `[[link]]` is verified during page write; broken links flagged immediately.
- **Sources are immutable.** Never edit `sources/{hash}.{ext}` after write. Re-ingest creates a new hash.
- **Plan source copies are immutable.** Never edit `plans/{plan_slug}/source.md` after write. Re-running against changed plan content creates a new source hash and either updates the capsule manifest with a new version or creates a versioned capsule slug.
- **Materialized files are derived state.** Don't hand-edit `pages/{slug}.md`, `graph/*.json`, or `index.json`. Always go through `!wiki` subcommands so the per-page / collection edit logs stay authoritative and the audit log stays consistent.
- **Schema evolves; the LLM proposes, the human accepts.** Lint and audit surface schema patches; `!wiki schema_accept <ver>` is the only way to promote them.
- **Findings are append-only.** `findings/{hash}.history.jsonl` is never rewritten — even resolution is recorded as a new entry. Recurring findings are how the wiki notices its own unresolved problems.
- **`_attention.md` is the human escape hatch.** Anything the wiki can't auto-resolve (recurring findings, no-progress lint, hook cycles, budget exhaustion) lands here. It is the first file a human should check when something feels off.
- **No emojis in wiki content** unless the active schema explicitly opts in.
