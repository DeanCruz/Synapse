# `!p_research {topic}`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are now the MASTER AGENT. You do NOT gather sources directly. You do NOT fetch URLs. You do NOT read external content. You ONLY plan, dispatch, and synthesize. Workers do all source-gathering. The master only reads worker returns and performs final synthesis.**
>
> **2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. Workers MUST be instructed to read `{tracker_root}/agent/instructions/tracker_worker_instructions.md`.**
>
> **3. You MUST use the dashboard. Write `plan.json`, `initialization.json`, append to `logs.json`, and dispatch workers who write progress files. Research swarms ALWAYS hit the full-tracking thresholds (3+ agents, multi-wave) and are NEVER eligible for `!p` lightweight mode.**
>
> **4. You MUST saturate parallelism. Research is embarrassingly parallel. Dispatch as many workers as the tool allows in every wave; if tasks remain, fire a back-to-back dispatch round immediately. Sequential research is a failure mode.**
>
> **5. You MUST preserve every raw return. All worker findings land in `{project_root}/documentation/research/{topic-slug}/raw/` BEFORE synthesis. Synthesis works from the on-disk raw record, not just in-memory returns. This makes the swarm resumable and auditable.**

**Purpose:** Run a deep, breadth-first research pipeline as a parallel Synapse swarm. The master decomposes a topic into many independent angles, dispatches waves of parallel research workers (saturating the parallelism limit), and stitches the returns into a coherent wiki memory readable by both humans and downstream agents. Inaccessible sources are not silently dropped — they are catalogued with an estimated-value weight so the user can decide which gaps are worth closing manually.

**Distinct from `!wiki ingest_batch`:** `ingest_batch` processes sources you ALREADY HAVE. `!p_research` GOES OUT and finds sources, evaluates them, and produces a synthesis. The output of `!p_research` is a candidate corpus that can be fed into `!wiki ingest_batch` afterward to crystallize into the durable wiki.

**Distinct from `!context`:** `!context` is read-only project-internal context gathering. `!p_research` is external + internal, multi-wave, multi-agent, and produces persisted artifacts under `documentation/research/`.

**Syntax:** `!p_research [--dashboard {id}] [--depth {shallow|standard|deep|exhaustive}] [--scope {internal|external|both}] [--max-waves N] {topic}`

- `{topic}` — The research question. Can be a technical topic, a decision to investigate, a domain to map, or a comparison to evaluate.
- `--dashboard {id}` — (Optional) Force a specific dashboard. Otherwise use the pre-assigned chat dashboard or auto-select per `dashboard_resolution.md`.
- `--depth` — (Optional, default `deep`) Controls wave count and worker count per wave. See **Depth Tiers** below.
- `--scope` — (Optional, default `both`) `internal` = project repo + PKI + wiki only. `external` = web/docs/papers only. `both` = both pools.
- `--max-waves` — (Optional) Hard cap on wave count regardless of depth tier.

**Examples:**
```
!p_research how should we architect our SSE-to-IPC bridge for multi-window Electron
!p_research --depth exhaustive Postgres logical replication for read replicas
!p_research --scope external --depth standard prompt-caching strategies for Claude API
!p_research --dashboard a3f7k2 evaluate React Server Components vs traditional SSR for our use case
```

---

## Output Structure

All research artifacts live under the **target project**, not the tracker:

```
{project_root}/documentation/research/{topic-slug}/
├── _index.md                          # Human-readable entry point. Start here.
├── _synthesis.md                      # Coherent stitched narrative — the primary deliverable.
├── _claims.json                       # Agent-readable structured claims with citations + confidence band.
├── _missing_sources.md                # Weighted catalogue of sources we couldn't reach.
├── _confidence.md                     # Per-claim confidence with the components that produced the band.
├── _graph.json                        # Entities + typed edges discovered across all findings.
├── raw/
│   ├── w{wave}-{agent_id}-{angle-slug}.md   # Per-agent raw findings (immutable once written).
│   └── ...
├── sources/
│   ├── {hash}.{ext}                   # Cached raw source bodies (when fetch succeeded + redaction passed).
│   ├── {hash}.meta.json               # Provenance: origin URL, fetched_at, redactions applied, accessor agent.
│   └── _quarantine/                   # Sources that failed redaction; awaiting human review.
└── _attention.md                      # Anything the swarm couldn't auto-resolve (cycles, budget hits, recurring contradictions).
```

> **`{topic-slug}`** is kebab-case derived from the topic. The master writes a `_slug:` field to `plan.json` so resume runs hit the same directory.

---

## Depth Tiers

Each tier sets target wave count and parallel worker count per wave. The master may exceed targets when the topic decomposes naturally — these are floors, not ceilings.

| Tier | Waves | Workers/wave | Cost class | When to use |
|---|---|---|---|---|
| `shallow` | 2 | 4-6 | swarm | Quick survey before committing to a deeper dive |
| `standard` | 3 | 6-10 | swarm | Default for most research questions |
| `deep` | 4-5 | 8-12 | swarm | When the topic spans multiple disciplines or has known controversy |
| `exhaustive` | 5-7 | 10-15 | swarm (heavy) | Pre-decision research where missing a perspective is expensive |

**Saturation rule:** When the dispatch tool's concurrency limit is reached, fire back-to-back dispatch rounds within the same wave. The wave is not "done" until every angle in its plan has a worker assigned. **Do not lower worker counts to fit one round.**

---

## Phase 1 — Decomposition & Plan

Master only. No external fetching.

1. **Resolve roots.** `{project_root}` from `.synapse/project.json` (or `--project` flag). `{tracker_root}` from CWD/binding. Compute `{topic-slug}` (kebab-case, ≤60 chars). Create `{project_root}/documentation/research/{topic-slug}/{raw,sources,sources/_quarantine}/` if missing.
2. **Read master instructions** from `{tracker_root}/agent/instructions/tracker_master_instructions.md`.
3. **Internal context warm-up (parallel, master-side reads only).** In a single tool message, read in parallel:
   - `{project_root}/CLAUDE.md` if present
   - `{project_root}/.synapse/knowledge/manifest.json` if PKI exists (extract domain/tag/concept indexes only — do NOT read every annotation)
   - `{wiki_root}/index.md` if a wiki exists (so we don't re-research things the wiki already knows)
   - `{project_root}/documentation/research/_index.md` if it exists (sibling research that may overlap)
4. **Decompose the topic into angles.** Aim for **breadth first**. The decomposition framework — apply each lens that fits the topic; skip lenses that don't:
   - **Definitional** — what the thing IS, canonical definitions, vocabulary
   - **Historical / state-of-the-art** — how the field got here, what's current
   - **Technical / mechanism** — how it works, internals, algorithms, protocols
   - **Comparative** — alternatives, tradeoffs, X-vs-Y matrices
   - **Practitioner / case study** — real-world deployments, war stories, lessons learned
   - **Failure modes** — what goes wrong, gotchas, anti-patterns, postmortems
   - **Adversarial / criticism** — strongest critiques, dissenting views, "why this is wrong"
   - **Adjacent / cross-disciplinary** — what neighboring fields know that's relevant
   - **Empirical / benchmarks** — measured numbers, performance, scaling data
   - **Tooling / ecosystem** — what libraries/products exist
   - **Regulatory / policy** — legal/compliance/standards angles, when relevant
   - **Future / speculative** — research frontier, where it's heading
   - **Project-internal angle** (if `--scope` includes internal) — how this project's existing code/conventions/PKI/wiki relates
5. **Right-size each angle into a task.** Each task targets **8-15 minutes of worker work** and produces 1-3 raw findings files. If an angle is too big, split it. Group related angles into the same wave when they share a research approach (e.g., all benchmark angles in one wave).
6. **Plan the wave layout.** Default progression:
   - **Wave 1 — Discovery (broadest, most parallel).** One worker per angle from step 4. Goal: surface candidate sources and initial claims. Workers report what they found AND what they couldn't access.
   - **Wave 2 — Deep dive.** Master reads Wave 1 returns and identifies the high-value sources/sub-questions surfaced. Dispatches workers to read those sources end-to-end and extract structured claims. New workers also chase contradictions surfaced in Wave 1.
   - **Wave 3 — Gap fill & cross-validation.** Master identifies remaining gaps and contested claims. Dispatches workers to find independent corroboration or refutation, attempt alternate fetch routes for inaccessible sources (cached versions, archives, mirrors), and probe under-covered angles.
   - **Wave 4 (deep / exhaustive only) — Adversarial.** Workers explicitly tasked with finding the strongest counter-evidence to the emerging synthesis. This wave's job is to break the synthesis, not confirm it.
   - **Wave N — Synthesis (always last, single integration worker).** Reads all raw findings from `raw/`, produces `_synthesis.md`, `_claims.json`, `_graph.json`, `_confidence.md`. Pattern B from CLAUDE.md — one writer for the merged artifacts to avoid contention.
7. **Write `plan.json`.** Schema:
   ```json
   {
     "context": {
       "topic": "...",
       "topic_slug": "...",
       "depth": "deep",
       "scope": "both",
       "research_root": "{project_root}/documentation/research/{topic-slug}",
       "internal_anchors": [...],   // Files/PKI domains/wiki pages already known to be relevant
       "out_of_scope": [...],       // Explicit non-goals to keep workers focused
       "prompt": "<original user prompt>"
     },
     "tasks": [
       {
         "id": "w1-t1-definitional",
         "wave": 1,
         "title": "...",
         "angle": "definitional",
         "description": "...",
         "approach": "...",         // The deep-thought how-to (required by plan validation hook)
         "files": [],               // Worker writes ONE file in raw/ — listed here for hook
         "sources_to_seek": [...],  // Initial seed URLs/queries; worker may expand
         "expected_outputs": [...]  // What this angle should produce
       }
     ]
   }
   ```
8. **Write `initialization.json`** (after `plan.json` exists; the validate-plan-required hook enforces this). `agents.length` MUST equal `plan.tasks.length`. Initialize `logs.json`.
9. **Present the plan to the user and wait for approval** — angle list, wave layout, depth tier, expected worker count, estimated cost class. **Do not dispatch before approval.**

> **Read `{tracker_root}/agent/_commands/p_track_planning.md` for the underlying planning protocol — `!p_research` follows the same write-order and validation requirements.**

---

## Phase 2 — Wave Dispatch & Execution

Workers do all research; master only orchestrates and ingests returns.

### Worker prompt requirements (per angle)

Every research worker prompt MUST include:

- **Identity:** task ID, wave number, angle slug, agent label.
- **Topic context:** the topic + the specific angle this worker owns + the out-of-scope list.
- **Output target:** exactly one file path under `raw/` — `{project_root}/documentation/research/{topic-slug}/raw/w{wave}-{agent_id}-{angle-slug}.md`. The worker writes this and only this raw file (plus its progress JSON and any successful source fetches under `sources/`).
- **Source-fetch protocol:** for each external source the worker accesses successfully, compute SHA-256 of body, write `sources/{hash}.{ext}` and `sources/{hash}.meta.json` (origin URL, fetched_at, redactions applied, accessor agent ID). For inaccessible sources, log them under the `inaccessible_sources` section of the raw findings file (see schema below).
- **Redaction sweep:** before persisting any fetched body, run a redaction pass for API keys, tokens, auth headers, emails, anything matched by the active wiki schema's `privacy_filters:` if a wiki exists, otherwise default filters. If redaction can't strip cleanly, route the source body to `sources/_quarantine/` and stop using that source.
- **Upstream results (Wave ≥ 2):** the master injects a UPSTREAM RESULTS block summarizing relevant Wave-(N-1) findings — entity names already discovered, contradictions to chase, sources known-inaccessible-but-valuable.
- **Sibling awareness:** the angles being researched in parallel by other workers in the same wave (so they don't duplicate fetches).
- **Progress instructions:** standard `tracker_worker_instructions.md` requirements — progress file path, task ID, agent label, template_version, mandatory write points (planning, working, completed/failed).
- **Return format:** the worker's return MUST conform to the **Worker Return Schema** below.

### Worker raw findings file schema (the file under `raw/`)

Every raw findings file MUST start with this frontmatter and structure:

```yaml
---
task_id: w1-t3-comparative
wave: 1
angle: comparative
topic_slug: postgres-logical-replication
agent: w1-t3
fetched_at: 2026-05-02T...
sources_attempted: 14
sources_fetched: 9
sources_inaccessible: 5
claim_count: 12
contradictions_flagged: 2
---

# {Angle title}

## TL;DR
3-5 sentence summary of what this worker learned for THIS angle. No padding.

## Claims
For each claim, structured as:

### Claim: {short claim title}
- **Statement:** ...
- **Citations:** `sources/{hash}.{ext}` (or external URL if not fetched)
- **Authority signal:** {primary | secondary | tertiary | anecdotal}
- **Recency:** ISO date of source
- **Notes:** caveats, scope limits, where this claim might fail

## Discovered Entities
List of typed entities (people, projects, libraries, concepts, papers) with one-line descriptions.

## Discovered Relationships
Typed edges between entities — `{from} -[type]-> {to}` (uses, depends_on, contradicts, supersedes, derived_from, ...).

## Contradictions Flagged
Cross-source conflicts the worker noticed — to be resolved in synthesis or chased in a later wave.

## Inaccessible Sources
For EVERY source the worker wanted to read but could not, append a record (used by the source-weighting phase):

- **URL / locator:** ...
- **Inaccessibility reason:** {paywall | login-required | 404 | rate-limited | robot-blocked | private-repo | broken-link | timed-out | other}
- **Why this looked valuable:** 1-2 sentences
- **Estimated unique-info contribution:** {high | medium | low}
- **Estimated authority:** {primary | secondary | tertiary | anecdotal}
- **Suggested fallback:** alternate access route if the worker thought of one (web archive, cached version, mirror, asking the user)

## Open Questions
Sub-questions this angle surfaced that warrant a follow-up wave.
```

### Worker return schema

Workers return a structured object summarizing their progress file (NOT the full raw file body — the raw file is on disk):

```json
{
  "task_id": "w1-t3-comparative",
  "status": "completed",
  "raw_file": "documentation/research/{slug}/raw/w1-t3-comparative.md",
  "claim_count": 12,
  "sources_fetched": 9,
  "sources_inaccessible": 5,
  "high_value_inaccessible": [...],
  "contradictions_flagged": [...],
  "open_questions": [...],
  "deviations": [...]
}
```

### Master loop per wave

1. **Compute the worker set for this wave** from `plan.json` (Wave 1) or from Wave-(N-1) returns + master analysis (Wave ≥ 2).
2. **Dispatch ALL workers in this wave in parallel.** If concurrency cap hit, fire back-to-back rounds within the same wave. Do NOT advance to Wave N+1 until all Wave N workers return.
3. **As workers return,** append entries to `logs.json`. Do NOT modify any worker's raw file. Cache the worker return in master working memory for downstream prompts.
4. **Failure handling.** A failed research worker is NOT necessarily a swarm failure — research is allowed to come up empty for an angle. Log the failure, capture the failure reason in the upstream-results cache for future waves, and continue. Apply standard circuit breaker only when failures are systemic (network outage, repeated tool errors, cost ceiling hit).
5. **Between waves, master plans the next wave.** This is master's most important work after planning — read all Wave N raw files (master CAN read raw files, since they're worker-produced and immutable; what master can't do is fetch external sources directly), identify high-value sources to follow, contradictions to chase, gaps to fill. Write the next wave's tasks into `plan.json` (append; never rewrite earlier waves) and the next batch of agents into `initialization.json`.
6. **Streaming consistency.** Mid-swarm interruption must leave `documentation/research/{slug}/` in a consistent state — every worker's raw file is fully written or absent. The swarm is resumable from the dashboard.

> **Read `{tracker_root}/agent/_commands/p_track_execution.md` for the underlying execution protocol — same dispatch rules, same compaction recovery, same circuit breaker.**

---

## Phase 3 — Source Weighting (between final research wave and synthesis)

Single integration worker OR master assembly when corpus is small (<20 inaccessible sources).

**Goal:** produce `_missing_sources.md` — a ranked catalogue of inaccessible sources with weights, so the user can decide which gaps are worth closing manually.

**Weight formula** (simple, transparent — not a calibrated probability):

```
unique_info_weight = { high: 1.0, medium: 0.5, low: 0.2 }[contribution]
authority_weight   = { primary: 1.0, secondary: 0.7, tertiary: 0.4, anecdotal: 0.2 }[authority]
mention_factor     = log(distinct_workers_who_referenced_this_source + 1) / log(2)
                     # 1 mention → 0, 2 → 1.0, 3 → ~1.6, 4 → 2.0
recency_factor     = 1.0 if source dated within 2y, 0.7 if 2-5y, 0.4 if older, 0.5 if undated
fetchability_hint  = 1.0 if fallback route suggested, 0.5 if no fallback

value_score = (unique_info_weight × 0.4
            +  authority_weight × 0.3
            +  recency_factor   × 0.2
            +  fetchability_hint × 0.1)
            × (1 + 0.5 × mention_factor)        // sources mentioned by multiple workers get a boost
```

The integration worker:

1. **Aggregates** every `Inaccessible Sources` entry across all `raw/*.md` files. Deduplicates by normalized URL/locator (strip query strings, anchor fragments, trailing slashes; lowercase host). Multiple workers referring to the same source merge into one record with the union of their notes and `mention_count = N`.
2. **Computes** `value_score` per merged record using the formula above.
3. **Ranks** records by `value_score` descending. Buckets into `critical` (≥1.5), `high` (1.0-1.5), `medium` (0.5-1.0), `low` (<0.5).
4. **Writes `_missing_sources.md`:**
   ```markdown
   # Missing Sources — {topic}

   {N} unique inaccessible sources were referenced across {M} workers. Weighted by estimated unique-information contribution × authority × multi-worker mentions × recency × fetchability.

   ## Critical (manual access strongly recommended)
   ### {source_title or first 80 chars of URL}
   - **URL:** ...
   - **Score:** 1.83
   - **Reason inaccessible:** paywall (4 workers hit this)
   - **Why valuable:** {merged synthesis of why-valuable notes}
   - **Suggested fallback:** {merged fallback suggestions; e.g., "Internet Archive snapshot from 2024-08", "ask user for institutional access", "GitHub mirror at ..."}
   - **Referenced by:** w1-t3-comparative, w2-t1-deep, w3-t2-adversarial

   ## High
   ...

   ## Medium
   ...

   ## Low
   ...
   ```
5. **Surfaces critical gaps to the synthesis worker** via the upstream-results block — synthesis must explicitly note in `_synthesis.md` which conclusions would change if the critical sources were available.

> **Source weighting is part of the swarm, not an afterthought.** Skipping it forfeits the swarm's awareness of its own blind spots.

---

## Phase 4 — Synthesis (single integration worker, always the final wave)

This worker reads everything in `raw/` and produces the human + agent deliverables. Pattern B (Integration) — exactly one writer for the merged artifacts.

**Synthesis worker prompt MUST include:**

- The original topic and `out_of_scope` list (from `plan.json` `context`).
- The full list of `raw/*.md` files with their angles and frontmatter summaries.
- The aggregated `_missing_sources.md` content (so synthesis can flag what's missing).
- A pointer to `{tracker_root}/agent/instructions/tracker_worker_instructions.md` for progress reporting.
- The exact output schemas below.

**Outputs produced by the synthesis worker** (all under `{project_root}/documentation/research/{topic-slug}/`):

### `_synthesis.md` — primary human-readable deliverable

```markdown
---
topic: ...
topic_slug: ...
depth: deep
generated_at: ISO-8601
wave_count: 4
worker_count: 36
sources_fetched: 142
sources_inaccessible: 41
claim_count: 187
high_confidence_claim_count: 64
disputed_claim_count: 9
critical_missing_sources: 3
---

# {Topic} — Synthesis

## TL;DR
The 5-bullet executive summary. If the user reads only this, what should they take away?

## Conclusions
The actual answers to the research question. Each conclusion:
- **States the conclusion in one sentence.**
- Cites the supporting claims by ID (`[[claim-42]]`) and the highest-authority sources backing them.
- Notes the confidence band ({high|medium|low|disputed}) — RULE-BASED, not a fake decimal.
- Notes the conditions under which it would flip (what new evidence would change the answer).

## Landscape
Map of the space — entities, players, key concepts. Use `[[wikilink]]` form to entity slugs in `_graph.json`.

## Tradeoffs / Comparison Tables
Where applicable, structured comparison tables.

## Failure Modes & Gotchas
The "what goes wrong" aggregation across all workers' findings.

## Disputed Claims
Each open contradiction with both sides + why it's not yet resolved + what evidence would resolve it.

## Confidence Map
For each conclusion, why this band:
- **Conclusion X:** high — {N} primary sources, {M} corroborating, no contradictions, mean recency 2025
- **Conclusion Y:** disputed — primary sources disagree (see [[claim-87]] vs [[claim-91]])

## Critical Gaps
The top 3-5 entries from `_missing_sources.md` and **for each, what specifically about the synthesis would change if we had it.** This is the single most important section for the user — it tells them where to spend manual effort.

## Recommended Next Steps
- Manual access targets (from `_missing_sources.md` critical bucket)
- Sub-questions worth a follow-up `!p_research` (with depth recommendation)
- Project-internal follow-up (e.g., "this synthesis suggests X — consider !context X to see what we already have")
- Optional: `!wiki ingest_batch documentation/research/{topic-slug}/raw/` to crystallize into the durable wiki

## Provenance
- Dashboard: `{tracker_root}/dashboards/{dashboard_id}/`
- Plan: `dashboards/{dashboard_id}/plan.json`
- Logs: `dashboards/{dashboard_id}/logs.json`
- Raw findings: `documentation/research/{topic-slug}/raw/`
- Source bodies: `documentation/research/{topic-slug}/sources/`
- Missing sources: `documentation/research/{topic-slug}/_missing_sources.md`
```

### `_claims.json` — agent-readable structured claims

```json
{
  "topic_slug": "...",
  "schema_version": 1,
  "generated_at": "ISO-8601",
  "claims": [
    {
      "id": "claim-42",
      "statement": "...",
      "type": "factual | evaluative | predictive | definitional",
      "support": {
        "source_count": 4,
        "source_authority_max": 1.0,
        "contradiction_count": 0,
        "primary_source_count": 2,
        "last_confirmed": "ISO-8601"
      },
      "citations": ["sources/{hash}.pdf", "https://..."],
      "confidence_band": "high",
      "contradicts": [],
      "supersedes": null,
      "supported_by": ["claim-12", "claim-31"],
      "raised_by_workers": ["w1-t3", "w2-t1"]
    }
  ]
}
```

`confidence_band` is computed by the same rule-based composer as the wiki:
- `disputed` if `contradiction_count > 0`
- `low` if `source_count == 1` AND `last_confirmed` older than 90 days
- `high` if `source_count >= 3` AND mean source authority ≥ secondary
- `medium` otherwise

**Workers do NOT write a `confidence` scalar.** They write the components; the composer produces the band.

### `_graph.json` — typed entities and edges

```json
{
  "entities": [
    {"id": "entity-pgsql", "type": "library", "name": "PostgreSQL", "first_seen_in": "w1-t1"},
    ...
  ],
  "edges": [
    {"from": "entity-pgsql", "to": "entity-mvcc", "type": "uses", "sources": ["sources/abc.pdf"], "raised_by_workers": ["w1-t1", "w2-t3"]},
    ...
  ]
}
```

### `_confidence.md` — the per-claim confidence rationale

Human-readable expansion of `_claims.json` showing why each claim earned its band — the components, the citations, and the rule that fired.

### `_index.md` — entry point

A 30-line index pointing into the other files. This is what the user reads FIRST when they revisit the research.

```markdown
# Research: {topic}

**Generated:** ISO-8601 · **Depth:** deep · **Dashboard:** `{dashboard_id}`

## Read these in order
1. **[_synthesis.md](_synthesis.md)** — start here. The actual answers.
2. **[_missing_sources.md](_missing_sources.md)** — what we couldn't reach, weighted.
3. **[_claims.json](_claims.json)** — structured for agents (downstream `!wiki ingest_batch`, etc.).
4. **[_graph.json](_graph.json)** — entities + relationships.
5. **[_confidence.md](_confidence.md)** — why each claim got its band.

## Stats
{table from synthesis frontmatter}

## Topic angles covered
- definitional (w1-t1) — {1-line summary}
- comparative (w1-t3) — {1-line summary}
- ...

## Topic angles attempted but thin
{any wave-N angle that returned <3 claims — flagged for follow-up}
```

---

## Phase 5 — Final Report

After the synthesis worker completes, the master compiles the standard `!p_track` final report (NON-NEGOTIABLE) — but with research-specific framing:

1. **Read all worker progress files, all raw findings, the synthesis outputs, and `_missing_sources.md`.**
2. **Compile the report:**
   - **Summary:** what the user asked, what waves ran, what was learned (top conclusions from `_synthesis.md` TL;DR).
   - **Files produced:** every file under `documentation/research/{topic-slug}/`.
   - **Coverage:** angles attempted, angles that returned thin, sources fetched vs inaccessible (with critical-bucket count surfaced).
   - **Deviations:** any worker who deviated from their angle (e.g., "w2-t4 was tasked with benchmark angle but found no benchmarks; pivoted to industry surveys — yielded 4 useful claims").
   - **Synthesis confidence:** how confident is the synthesis as a whole? Which conclusions are load-bearing on critical missing sources?
   - **Concrete next steps:** ordered list — manual fetches, follow-up `!p_research` runs, `!wiki ingest_batch` candidates, `!context` queries to connect to project-internal knowledge.
3. **Write metrics.json** with research-specific fields: `total_workers`, `wave_count`, `sources_fetched`, `sources_inaccessible`, `critical_missing`, `claim_count`, `disputed_claim_count`, `synthesis_confidence_distribution: {high, medium, low, disputed}`.
4. **Save to history** per standard `!p_track` completion.

> **Read `{tracker_root}/agent/_commands/p_track_completion.md` for the underlying completion protocol.**

---

## Rules (Non-Negotiable)

### Master Constraints

1. **Master never fetches external sources directly.** All `WebFetch` / `WebSearch` / source reads happen in worker contexts. Master only reads worker returns, raw files written by workers, and dashboard files.
2. **`plan.json` precedes `initialization.json`.** Same hook (`validate-plan-required.sh`) as `!p_track`. Every task must have `id`, `title`, `description`, `approach`, `files`.
3. **Saturation is mandatory.** Every wave dispatches as many workers as there are angles. If concurrency is capped, fire back-to-back rounds. Lowering worker count to fit one batch is a failure mode.
4. **Streaming raw writes.** Worker raw files land on disk before the master claims completion. Synthesis works from disk, not memory.
5. **Pattern B for synthesis.** Exactly one synthesis worker writes `_synthesis.md`, `_claims.json`, `_graph.json`, `_confidence.md`, `_index.md`. Never multiple writers on the merged artifacts.

### Quality Rules

6. **Every claim cites at least one source.** Claims with empty `citations` are quarantined (move to `_attention.md` for review) — they don't make it into `_synthesis.md` or `_claims.json`.
7. **Confidence is computed, never asserted.** Workers populate the support components; the master/synthesis worker runs the composer. A worker who writes a literal `confidence: 0.85` triggers a deviation flag.
8. **Inaccessible sources are first-class outputs.** Silently dropping inaccessible sources is forbidden. Every worker MUST surface every source they wanted but couldn't reach. The source-weighting phase is part of the swarm, not optional.
9. **Critical missing sources MUST be reflected in `_synthesis.md` Critical Gaps.** Synthesis must state, for each critical-bucket missing source, what about the synthesis would change if the source were available.
10. **No emojis in research output** unless the user's prompt explicitly opts in or the project's CLAUDE.md does.

### Privacy & Provenance

11. **Redact before persisting.** Workers run a redaction sweep before writing any fetched body to `sources/`. Failed redaction → `sources/_quarantine/`, never a silent drop.
12. **Source bodies are immutable.** Once `sources/{hash}.{ext}` is written, never rewrite. Re-fetch produces a new hash.
13. **Provenance is mandatory.** Every `sources/{hash}.meta.json` records origin URL, fetched_at, redactions applied, accessor agent ID. Every claim citation points to a `sources/{hash}` OR an external URL (when fetch failed).

### Synapse Integration

14. **Full dashboard tracking always.** `!p_research` is never eligible for `!p` lightweight mode. Workers always read `tracker_worker_instructions.md` (FULL) and write progress files.
15. **Cycle protection.** If `!p_research` is invoked from a hook (e.g., a future research-trigger), propagate `--triggered-by` and `--depth` per the wiki's cycle guard. Reject `depth > 3`.
16. **Wiki crystallization is opt-in, not automatic.** The final report SUGGESTS `!wiki ingest_batch documentation/research/{topic-slug}/raw/` — it does not auto-fire. The user crystallizes when ready.
17. **PKI suggestion when missing.** If `!p_research --scope both` runs and the project has no PKI, append a tip to the final report: `Run !learn to bootstrap the PKI — internal-scope research will be much sharper next time.`

### Dispatch & Tracking (inherited from `!p_track`)

18. **Dispatch FIRST, update tracker AFTER.** Same as `!p_track`.
19. **Atomic writes only.** Read → modify → write full file. Never partial JSON.
20. **Live timestamps.** Always `date -u +"%Y-%m-%dT%H:%M:%SZ"` at the moment of writing.
21. **Final report is non-negotiable.** Same as `!p_track` — Step 17E equivalent applies.

---

## Resume Behavior

`!p_research` swarms are resumable like any `!p_track` swarm via `!p_track_resume` or `!track_resume`:

- The dashboard's `plan.json` carries `_slug` and `research_root`, so resume hits the same on-disk directory.
- Workers whose raw file already exists at `raw/w{wave}-{agent_id}-{angle-slug}.md` AND has valid frontmatter are considered complete; resume skips them.
- Synthesis is idempotent — re-running it overwrites `_synthesis.md`, `_claims.json`, `_graph.json`, `_confidence.md`, `_index.md` from the current `raw/` corpus. (Source bodies under `sources/` are immutable and never overwritten.)

---

## Cost Discipline

- `--depth shallow` ≈ small swarm cost. Use for survey-then-decide.
- `--depth standard` ≈ medium swarm cost. Default.
- `--depth deep` / `exhaustive` ≈ heavy. Master MUST print the projected worker count and a one-line cost estimate before dispatch and wait for explicit user approval. (This is why Phase 1 ends with "wait for approval" — same as `!p_track`.)
- If a wiki budget config exists (`{wiki_root}/schema/current` → `budgets.per_swarm_max_tokens`), respect it. Append a one-line entry to `_attention.md` if dispatching the planned wave would exceed it; await user override.
