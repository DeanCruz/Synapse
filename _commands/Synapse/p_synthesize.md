# `!p_synthesize [topic-filter]`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are now the MASTER AGENT. You do NOT rewrite research artifacts directly. You do NOT modify any file under `documentation/research/{topic-slug}/` (the per-topic research is the immutable input). You ONLY plan, dispatch, and route worker outputs into `documentation/research/synthesis/`. Workers do all reading, deduplication, and stitching.**
>
> **2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing dashboard files. Workers MUST read `{tracker_root}/agent/instructions/tracker_worker_instructions.md`.**
>
> **3. You MUST use the dashboard. Write `plan.json`, `initialization.json`, append to `logs.json`, and dispatch workers who write progress files. Synthesis swarms ALWAYS hit the full-tracking thresholds and are NEVER eligible for `!p` lightweight mode.**
>
> **4. You MUST treat per-topic research as immutable input.** `!p_synthesize` reads `documentation/research/{*}/_synthesis.md`, `_claims.json`, `_graph.json`, `raw/*.md`, and `_missing_sources.md`. It does NOT modify them. All synthesis output lands in `documentation/research/synthesis/`. The per-topic record stays canonical for "what was researched and concluded for that single topic."
>
> **5. The verification wave is single-worker, mandatory, and runs LAST.** A merged synthesis without a final independent contradiction sweep is incomplete. The verifier reads the merged outputs end-to-end and either certifies them or appends to `_open_issues.md`.

**Purpose:** Take the catalogue of per-topic research produced by `!p_research` and weave it into a single project-wide synthesis. Workers in parallel (a) detect duplicate claims across topics and merge them, (b) stitch complementary information from related topics into unified subject pages, (c) extract every contradiction and unanswered question into a living `_open_issues.md` document that is updated incrementally as new research lands. A final single-worker verification pass confirms no lingering contradictions slipped through merge.

**Distinct from `!p_research`:** `!p_research` GATHERS information for one topic; `!p_synthesize` MERGES information across many already-researched topics into a project-level knowledge layer. `!p_synthesize` produces no new external sources — it only reorganizes and reconciles existing research.

**Distinct from `!wiki crystallize`:** `crystallize` distills ONE swarm into wiki pages. `!p_synthesize` operates one tier above — it merges N research outputs into a coherent layer that can THEN be crystallized into the wiki. Run order: `!p_research` (many runs) → `!p_synthesize` → `!wiki ingest_batch documentation/research/synthesis/` (optional).

**Distinct from `!wiki audit`:** `audit` runs against the wiki itself. `!p_synthesize` runs against `documentation/research/`. They use the same epistemic primitives (contradictions, support components, rule-based confidence band) so audit findings transfer cleanly when the synthesis is later ingested.

**Syntax:** `!p_synthesize [--dashboard {id}] [--mode {full|incremental|verify-only}] [--topics "slug1,slug2,..."] [--depth {standard|deep}] [topic-filter]`

- `[topic-filter]` — (Optional) Free-text filter applied to the per-topic `_synthesis.md` frontmatter to limit which topics are merged. Empty = synthesize all topics under `documentation/research/` except `synthesis/` itself.
- `--mode` — (Optional, default `full`)
  - `full` — full re-synthesis from scratch. Overwrites `documentation/research/synthesis/` outputs. Use after a large batch of new research, or when the structure of synthesis pages should be reconsidered.
  - `incremental` — merge ONLY topics whose `_synthesis.md` `generated_at` is newer than the current synthesis layer's `generated_at`. Updates affected synthesis pages and `_open_issues.md` in place. Default for a maintenance run.
  - `verify-only` — skip merge waves; run only the verification pass. Use to spot-check the existing synthesis without re-merging.
- `--topics "slug1,slug2"` — (Optional) Comma-separated list of `{topic-slug}` directories to include. Overrides the auto-discovery scan.
- `--depth` — (Optional, default `standard`) Controls cluster size and worker count per wave. `deep` doubles parallelism for wide research catalogues (≥20 topics).
- `--dashboard {id}` — (Optional) Force a specific dashboard.

**Examples:**
```
!p_synthesize
!p_synthesize --mode incremental
!p_synthesize --topics "postgres-replication,mysql-replication,read-replica-patterns" --depth deep
!p_synthesize --mode verify-only
!p_synthesize auth
```

---

## Output Structure

All synthesis artifacts live under the target project at `{project_root}/documentation/research/synthesis/`:

```
{project_root}/documentation/research/synthesis/
├── _index.md                            # Human entry point. Read this first.
├── _master_synthesis.md                 # Project-wide unified narrative across all merged topics.
├── _open_issues.md                      # LIVING document — contradictions + unanswered questions. Updated incrementally.
├── _open_issues.history.jsonl           # Append-only history of every state change to _open_issues.md (open / resolved / recurring).
├── _verification_report.md              # Final verifier's report. Written by Phase 5.
├── _claims.json                         # Merged structured claims, deduplicated, with confidence bands.
├── _graph.json                          # Merged entity + typed-edge graph across all topics.
├── _coverage.md                         # Which topics were merged, which were skipped, which were stale.
├── _audit.jsonl                         # Append-only ops log for the synthesis layer.
├── topics/
│   └── {synthesis-topic-slug}.md        # Per-cluster unified subject pages (e.g., "replication-strategies.md" merging 3 topic dirs).
├── topics/_index.md                     # Topical index of synthesis pages.
└── _attention.md                        # What synthesis couldn't auto-resolve. Surfaced for the human.
```

> **`_open_issues.md` is a living document.** Its sibling `_open_issues.history.jsonl` is append-only — every status change (`open`, `resolved`, `recurring`) is logged. Same primitive used by `!wiki audit` for `findings/{hash}.history.jsonl`. This means "has anyone already tried to resolve this contradiction?" is a one-line query against the history file.

> **The synthesis layer is derived state.** Per-topic `_synthesis.md`, `_claims.json`, `_graph.json` under `documentation/research/{topic-slug}/` are canonical and immutable from this command's perspective. Re-running `!p_synthesize --mode full` regenerates the synthesis layer from those canonical inputs.

---

## Phase 1 — Discovery & Cluster Plan

Master only. No worker dispatch yet.

1. **Resolve roots.** `{project_root}` from `.synapse/project.json` (or `--project` flag). Compute `synthesis_root = {project_root}/documentation/research/synthesis/`. Create the directory and `topics/` subdir if missing.
2. **Read master instructions** from `{tracker_root}/agent/instructions/tracker_master_instructions.md`.
3. **Scan the research catalogue.** Glob `{project_root}/documentation/research/*/`. For each topic directory (excluding `synthesis/` itself):
   - Read `_index.md` (header + stats table)
   - Read `_synthesis.md` frontmatter (topic, topic_slug, depth, generated_at, claim_count, disputed_claim_count, critical_missing_sources)
   - Read `_claims.json` summary (count + confidence-band distribution)
   - Read `_graph.json` summary (entity count + edge count + entity name list)
   - Note `_missing_sources.md` critical-bucket count
4. **Apply the topic filter** (`--topics` list or free-text `topic-filter`). If `--mode incremental`, drop topics whose `_synthesis.md` `generated_at` is older than the current synthesis layer's `_master_synthesis.md` `generated_at`.
5. **Cluster topics by entity / domain overlap.** Build a cluster map:
   - Two topics belong to the same cluster if they share ≥ `min_shared_entities` entities (default 3, in `_graph.json`) OR ≥ `min_shared_tags` domains/tags (default 2).
   - Use union-find on the entity-overlap edges to form clusters.
   - Singletons (topics with no overlap) form their own one-topic clusters.
   - Each cluster gets a `synthesis-topic-slug` derived from its dominant shared entities or its constituent topic slugs.
6. **Plan the wave layout.** Default progression:
   - **Wave 1 — Dedup detection (parallel, one worker per cluster).** Each worker reads ALL `_claims.json` files in its cluster + the relevant entity neighborhoods from each topic's `_graph.json`. Output: a per-cluster `dedup_report` listing duplicate / near-duplicate claim groups, complementary claim pairs (same entity, different aspects), and contradictions across topics.
   - **Wave 2 — Cluster stitching (parallel, one worker per cluster).** Each worker takes its cluster's `dedup_report` from Wave 1 plus the underlying claims and writes ONE unified subject page at `synthesis/topics/{synthesis-topic-slug}.md`. Workers do NOT touch any other cluster's page.
   - **Wave 3 — Cross-cluster integration (parallel, fan-in).** Workers scan ACROSS clusters to find:
     - Shared entities that appear in multiple cluster pages (master_synthesis cross-references)
     - Contradictions where the contradicting claims live in different clusters (so Wave 1 dedup workers wouldn't have caught them)
     - Project-wide patterns spanning multiple clusters
   - **Wave 4 — Issues consolidation (single integration worker).** One worker reads every cluster page + every Wave-1/Wave-3 contradiction record + every per-topic `_synthesis.md` Disputed-Claims section + every per-topic `_missing_sources.md` critical bucket, then writes/updates `_open_issues.md` and appends to `_open_issues.history.jsonl`. Pattern B — exactly one writer for the issues file.
   - **Wave 5 — Master synthesis assembly (single integration worker).** One worker writes `_master_synthesis.md`, `_claims.json`, `_graph.json`, `_index.md`, `_coverage.md`. Pattern B — exactly one writer for the merged artifacts.
   - **Wave 6 — Verification (single worker, ALWAYS LAST, NON-NEGOTIABLE).** A fresh worker who has not seen Waves 1-5 reads the synthesis layer end-to-end and runs the verification protocol (see Phase 5). Outputs `_verification_report.md` and appends to `_open_issues.md` if it finds anything Waves 1-4 missed.
7. **Saturation rule (same as `!p_research`):** if a wave has more clusters than the concurrency cap, fire back-to-back dispatch rounds within the same wave. Do not lower worker counts.
8. **Write `plan.json`** with the schema below. Worker count = `cluster_count + cluster_count + cross_integration_count + 1 + 1 + 1`. Estimate token cost; if it exceeds the wiki's `budgets.per_swarm_max_tokens` (when configured), append a one-line entry to `synthesis_root/_attention.md` and surface the warning before user approval.
9. **Write `initialization.json`** (after `plan.json` exists). `agents.length` MUST equal `plan.tasks.length`. Initialize `logs.json`.
10. **Present the plan to the user and wait for approval** — cluster map, wave layout, mode, expected worker count, and (if `--mode incremental`) the list of topics that triggered the run. **No dispatch before approval.**

### `plan.json` schema (synthesis-specific extensions)

```json
{
  "context": {
    "command": "p_synthesize",
    "mode": "full | incremental | verify-only",
    "research_root": "{project_root}/documentation/research",
    "synthesis_root": "{project_root}/documentation/research/synthesis",
    "topics_included": ["topic-slug-1", "topic-slug-2", ...],
    "topics_skipped": [{"slug": "...", "reason": "stale | filtered | failed-frontmatter-read"}],
    "clusters": [
      {
        "synthesis_topic_slug": "replication-strategies",
        "topic_slugs": ["postgres-logical-replication", "mysql-binlog-replication", "read-replica-patterns"],
        "shared_entities": ["replication", "wal", "consistency"],
        "shared_tags": ["database", "scaling"]
      }
    ],
    "prompt": "<original user prompt>"
  },
  "tasks": [
    {
      "id": "w1-c1-dedup",
      "wave": 1,
      "title": "...",
      "cluster_id": "replication-strategies",
      "phase": "dedup",
      "description": "...",
      "approach": "...",                   // Required by validate-plan-required hook
      "files": ["documentation/research/synthesis/_audit.jsonl"]   // Worker writes its progress + dedup report ONLY
    }
  ]
}
```

> **`plan.json` is required and validated by the `validate-plan-required.sh` hook.** Every task must have `id`, `title`, `description`, `approach`, `files`. Same enforcement as `!p_track` and `!p_research`.

---

## Phase 2 — Wave 1: Dedup Detection (parallel)

One worker per cluster. Workers do NOT write merged synthesis files — only their own progress JSON and a structured dedup_report returned via the worker return.

### Worker prompt (per cluster)

Each Wave 1 worker receives:

- **Identity:** task ID, wave 1, cluster ID, agent label.
- **Cluster manifest:** the topic slugs in the cluster, the shared entities, the shared tags.
- **Inputs to read:**
  - `documentation/research/{slug}/_claims.json` for every slug in the cluster
  - `documentation/research/{slug}/_graph.json` for every slug in the cluster
  - `documentation/research/{slug}/_synthesis.md` Disputed-Claims section for every slug (extract via frontmatter + section parse)
- **Output target:** the worker's progress JSON file. The dedup report is part of the structured return.
- **Progress instructions:** standard `tracker_worker_instructions.md` requirements.
- **Return format:** the **Dedup Worker Return Schema** below.

### Dedup worker return schema

```json
{
  "task_id": "w1-c1-dedup",
  "status": "completed",
  "cluster_id": "replication-strategies",
  "duplicate_groups": [
    {
      "group_id": "dg-1",
      "claims": [
        {"topic_slug": "postgres-logical-replication", "claim_id": "claim-12"},
        {"topic_slug": "mysql-binlog-replication", "claim_id": "claim-7"}
      ],
      "merge_strategy": "identical | near-identical | one-supersedes-other",
      "canonical_form": "...",                           // The proposed merged statement
      "merged_support": {                                // Components, not a scalar
        "source_count": 5,
        "source_authority_max": 1.0,
        "contradiction_count": 0,
        "primary_source_count": 3,
        "last_confirmed": "ISO-8601"
      },
      "merged_citations": ["sources/{hash1}", "sources/{hash2}", ...]
    }
  ],
  "complementary_pairs": [
    {
      "pair_id": "cp-1",
      "claims": [
        {"topic_slug": "postgres-logical-replication", "claim_id": "claim-31", "aspect": "throughput"},
        {"topic_slug": "mysql-binlog-replication", "claim_id": "claim-22", "aspect": "consistency"}
      ],
      "complementary_relation": "different aspects of same entity",
      "merged_narrative_hint": "When stitched, present as a side-by-side aspect comparison"
    }
  ],
  "contradictions": [
    {
      "contradiction_id": "ct-1",
      "claims": [
        {"topic_slug": "postgres-logical-replication", "claim_id": "claim-44", "statement": "..."},
        {"topic_slug": "mysql-binlog-replication", "claim_id": "claim-19", "statement": "..."}
      ],
      "scope": "intra-cluster",
      "severity": "low | medium | high",
      "evidence_summary": "What each side cites + why this is a real contradiction (not just a wording diff)"
    }
  ],
  "open_questions": [
    {"question_id": "oq-1", "raised_in": ["topic-slug-1"], "question": "..."}
  ],
  "deviations": []
}
```

**Stable IDs.** Every duplicate_group, complementary_pair, contradiction, and open_question gets a stable hash ID computed as `sha256(cluster_id + sorted(claim_ids) + canonical_form)`. This is what makes them trackable across re-runs — same content produces same ID. `_open_issues.md` keys off these IDs.

### Master loop for Wave 1

1. Dispatch ALL cluster workers in parallel. Saturate.
2. As workers return, append `logs.json` entries and append the worker's dedup_report to a master-side cache keyed by cluster ID. Do NOT write any merged file yet.
3. Failure handling: a failed dedup worker is recoverable — re-dispatch via `!retry`, or skip the cluster and flag in `_attention.md` if the cluster is non-critical.

---

## Phase 3 — Wave 2: Cluster Stitching (parallel)

One worker per cluster. Workers write `synthesis/topics/{synthesis-topic-slug}.md` and ONLY that file (plus their progress JSON).

### Worker prompt (per cluster)

Each Wave 2 worker receives:

- **Identity:** task ID, wave 2, cluster ID, target output path.
- **Inputs to read:**
  - The Wave 1 dedup_report for THIS cluster (passed via UPSTREAM RESULTS block)
  - The actual `_claims.json`, `_graph.json`, `_synthesis.md` files for every topic in the cluster (the worker does the deep reading; master only passed the Wave 1 distillation)
  - The relevant `raw/*.md` excerpts from each topic's research, IF the dedup_report flagged that fine-grained material is needed for a stitch
- **Output target:** exactly one file at `documentation/research/synthesis/topics/{synthesis-topic-slug}.md`.
- **Sibling awareness:** the synthesis-topic-slugs of OTHER clusters, so cross-references can be wikilink-style.
- **Stitching rules** (in the prompt):
  - **Duplicate groups:** emit ONE statement using the dedup_report's `canonical_form`. Cite the merged_citations. Use `merged_support` components — NEVER assert a confidence scalar.
  - **Complementary pairs:** emit a unified passage that integrates the aspects per the `merged_narrative_hint`.
  - **Contradictions:** do NOT pick a side. Emit BOTH claims with explicit attribution and a pointer to `_open_issues.md` (the contradiction will be referenced by ID; the issues consolidator in Wave 4 owns the issue page). Mark the page's frontmatter `contradiction_count` to reflect open contradictions in this cluster.
  - **Open questions:** list at the bottom of the page with stable IDs.
- **Progress instructions:** standard.
- **Return format:** the **Stitch Worker Return Schema** below.

### Cluster page schema (`synthesis/topics/{synthesis-topic-slug}.md`)

```yaml
---
synthesis_topic_slug: replication-strategies
title: Replication Strategies
generated_at: ISO-8601
source_topics: ["postgres-logical-replication", "mysql-binlog-replication", "read-replica-patterns"]
shared_entities: ["replication", "wal", "consistency"]
claim_count: 47
duplicate_groups_merged: 12
complementary_pairs_merged: 8
contradictions_open: 3                 # Pointer count into _open_issues.md
open_questions: 5
schema_version: 1
---

# Replication Strategies

## TL;DR
3-5 sentence summary of what this cluster collectively says.

## Unified Claims by Subject
For each subject within the cluster, emit unified prose with:
- Statement (merged where applicable)
- Citation: `[topic-slug:claim-id]` form for cross-document traceability
- Confidence band ({high|medium|low|disputed}) — RULE-BASED from merged_support components

### Subject: WAL-based replication
{Unified passage, integrating duplicate_group dg-1 and complementary_pair cp-1, citing claims [postgres-logical-replication:claim-12], [mysql-binlog-replication:claim-7], [postgres-logical-replication:claim-31], [mysql-binlog-replication:claim-22]. Confidence: high.}

### Subject: ...

## Cross-References
Wikilinks to other synthesis pages: `[[networking-fundamentals]]`, `[[storage-engines]]`.

## Open Contradictions in This Cluster
- **Contradiction `ct-1`:** see [_open_issues.md#ct-1](../_open_issues.md#ct-1)
- ...

## Open Questions
- **`oq-1`:** {question text}
- ...

## Provenance
- Source topics: list with paths to per-topic `_synthesis.md` files
- Wave 1 dedup report cached at: `dashboards/{dashboard_id}/progress/w1-c1-dedup.json`
```

### Stitch worker return schema

```json
{
  "task_id": "w2-c1-stitch",
  "status": "completed",
  "cluster_id": "replication-strategies",
  "page_path": "documentation/research/synthesis/topics/replication-strategies.md",
  "claim_count": 47,
  "duplicate_groups_merged": 12,
  "complementary_pairs_merged": 8,
  "contradictions_referenced": ["ct-1", "ct-2", "ct-3"],
  "open_questions_referenced": ["oq-1", "oq-2", "oq-3", "oq-4", "oq-5"],
  "cross_cluster_entity_mentions": [
    {"entity": "consistency", "appears_in_clusters": ["replication-strategies", "distributed-systems"]}
  ],
  "deviations": []
}
```

### Master loop for Wave 2

Same as Wave 1: dispatch all cluster stitchers in parallel, saturate, append `logs.json` on returns, cache stitch reports for downstream waves. Wave 2 cannot start until Wave 1 is fully complete (workers depend on dedup_reports).

---

## Phase 4 — Wave 3: Cross-Cluster Integration (parallel, fan-in)

Multiple parallel workers — one per integration angle.

### Workers

- **Worker 3A — Cross-cluster duplicates.** Reads ALL Wave 2 cluster pages + the original `_claims.json` files. Looks for duplicate or near-duplicate claims that were missed by Wave 1 because the duplicating claims lived in different clusters. Returns a `cross_cluster_dedup_report` with the same schema as Wave 1's dedup_report.
- **Worker 3B — Cross-cluster contradictions.** Reads ALL Wave 2 cluster pages. Looks for claims in cluster A that contradict claims in cluster B (including contradicting subject sub-headings, not just literal claim statements). Returns a `cross_cluster_contradictions` array.
- **Worker 3C — Project-wide patterns.** Reads ALL Wave 2 cluster pages + project CLAUDE.md / wiki index (if present). Looks for repeated patterns / themes spanning ≥3 clusters that warrant a top-level mention in `_master_synthesis.md`. Returns a `project_patterns` array.
- **Worker 3D — Coverage check.** Reads `documentation/research/{slug}/_missing_sources.md` for every merged slug. Aggregates the `critical` bucket entries. Identifies missing sources mentioned in ≥2 topics — these are the gaps most worth closing manually because their resolution would update multiple synthesis pages. Returns a `synthesis_critical_gaps` array.

### Master loop for Wave 3

Dispatch 3A, 3B, 3C, 3D in parallel. None of them write merged files — all return structured findings that feed into Waves 4 and 5.

---

## Phase 5 — Wave 4: Issues Consolidation (single worker)

Pattern B — exactly ONE writer for `_open_issues.md`.

### Worker prompt

The Wave 4 worker receives, via UPSTREAM RESULTS:

- All Wave 1 `contradictions` and `open_questions` arrays (intra-cluster issues)
- Wave 3B `cross_cluster_contradictions` (inter-cluster issues)
- Wave 3D `synthesis_critical_gaps` (sources whose absence creates open questions)
- The previous `_open_issues.md` content if it exists (for `--mode incremental` — preserves status history)
- The current `_open_issues.history.jsonl` if it exists

### Wave 4 worker responsibilities

1. **Compute stable issue IDs.** Each issue gets a hash: `sha256(issue_type + canonical(claim_ids or question_text))`. Same problem produces same ID across re-runs. This is the wiki-audit `findings/{hash}` primitive applied here.
2. **Diff against previous `_open_issues.md`:**
   - **New issue** (ID unseen): create entry with `status: open`, `first_seen: now`, full evidence.
   - **Recurring issue** (ID seen in prior runs, still detected this run): append a new history entry with current evidence; if the issue has been open across ≥3 consecutive synthesis runs without resolution, escalate to `status: recurring` and append a one-line entry to `_attention.md` ("issue {id} recurring 3+ runs — manual review needed").
   - **Resolved issue** (previously open, NOT detected this run): mark `status: resolved` in `_open_issues.md`, append a final history entry with `resolution_evidence` (whichever Wave 1 dedup_report retired the contradiction, OR whichever new claim filled the question). Do NOT delete — resolution is itself signal.
3. **Write `_open_issues.md`** sorted by: `recurring` → `high` severity contradictions → `medium` → `low` → `open questions` → `resolved` (capped to 100 entries with a pointer to history for the rest).
4. **Append to `_open_issues.history.jsonl`** — one line per state change, schema:
   ```json
   {"ts":"ISO-8601","run_id":"synthesis-abc123","issue_id":"ct-1","status":"open|recurring|resolved","evidence":[...],"actor":"w4-issues"}
   ```
5. **Append to `_audit.jsonl`** — one entry per state change (`op: issue_opened`, `issue_recurring`, `issue_resolved`).

### `_open_issues.md` schema

```markdown
---
generated_at: ISO-8601
synthesis_run_id: synthesis-abc123
issue_count: 17
recurring_count: 2
high_severity_count: 4
open_questions_count: 8
resolved_this_run: 3
schema_version: 1
---

# Open Issues — Project Research Synthesis

This document is **living**. Every entry is keyed by a stable hash. New research that resolves an issue updates the entry to `status: resolved` and appends to `_open_issues.history.jsonl` — entries are NOT deleted.

When you add new research via `!p_research` and re-run `!p_synthesize --mode incremental`, this document updates in place. Use `_open_issues.history.jsonl` to see the full history of any issue.

## Recurring Issues (3+ synthesis runs without resolution — needs human review)

### `ct-7` — Disagreement on WAL fsync semantics (recurring, 4 runs)
- **Severity:** high
- **First seen:** 2026-01-15
- **Topics involved:** `postgres-logical-replication`, `mysql-binlog-replication`
- **Claim A** (`postgres-logical-replication:claim-44`): "..."
- **Claim B** (`mysql-binlog-replication:claim-19`): "..."
- **Why unresolved:** ...
- **What evidence would resolve this:** ...
- **History:** see `_open_issues.history.jsonl` (4 entries)

## High-Severity Contradictions
### `ct-1` — ...
- **Severity:** high
- **Severity rationale:** the contradicting claims are load-bearing on multiple synthesis pages; resolution would change cross-cluster recommendations
- **Topics involved:** ...
- **Claim A** (`{topic}:{claim_id}`): "..."
- **Claim B** (`{topic}:{claim_id}`): "..."
- **Cited synthesis page:** `topics/replication-strategies.md`
- **Status:** open
- **First seen:** ISO-8601

## Medium-Severity Contradictions
...

## Low-Severity Contradictions
...

## Open Questions

### `oq-1` — Why does Postgres logical replication degrade above N writers?
- **Raised in:** `postgres-logical-replication`
- **What's missing:** primary-source benchmark data above 32 writers
- **Critical missing source:** `postgres-replication-benchmark-2024.pdf` (paywalled, see `documentation/research/postgres-logical-replication/_missing_sources.md` ID s-12)
- **Status:** open

## Resolved This Run
### `ct-3` — RESOLVED 2026-05-02
- **Resolution evidence:** new research in `mysql-binlog-replication` (run synthesis-...) provided primary-source benchmark that contradicted the earlier secondary-source claim; the contradicting claim is now superseded.
- **Final status:** resolved
- **History entries:** see `_open_issues.history.jsonl` (5 entries)
```

### Why this design works for incremental updates

When a NEW topic is added via `!p_research` and `!p_synthesize --mode incremental` runs:

- Wave 1 only dispatches workers for clusters affected by the new topic.
- Wave 4 reads the existing `_open_issues.md` and `_open_issues.history.jsonl`, computes new issue IDs from the new evidence, and:
  - For previously-open issues no longer detected → marks them `resolved` and logs the history.
  - For previously-open issues still detected → appends a new history entry, escalates to `recurring` if past threshold.
  - For brand-new issues → creates new entries.
- `_open_issues.md` is regenerated from this merge logic — but the history file is append-only, so the trail is preserved.

This is the same primitive `!wiki audit` uses for `findings/{hash}.history.jsonl`. Issues get **memory across runs** without ever being silently lost or silently fixed.

---

## Phase 6 — Wave 5: Master Synthesis Assembly (single worker)

Pattern B — exactly ONE writer for `_master_synthesis.md`, `_claims.json`, `_graph.json`, `_index.md`, `_coverage.md`.

### Worker prompt

The Wave 5 worker receives:

- All Wave 2 cluster pages (read directly from `synthesis/topics/`)
- All Wave 3 returns (cross-cluster reports)
- The Wave 4 `_open_issues.md` (just written)
- The list of source topics + their `_synthesis.md` frontmatter for the coverage report

### Outputs

#### `_master_synthesis.md` — project-wide unified narrative

```markdown
---
generated_at: ISO-8601
synthesis_run_id: ...
cluster_count: 8
topic_count: 23
total_claims: 412
high_confidence_claims: 187
disputed_claims: 17
open_questions: 24
recurring_issues: 2
schema_version: 1
---

# Project Research — Master Synthesis

## TL;DR
The project-wide 5-bullet executive summary across all clusters.

## Cluster Map
- **[[replication-strategies]]** — 47 claims, 3 open contradictions
- **[[storage-engines]]** — 31 claims, 0 open contradictions
- ...

## Project-Wide Patterns
From Wave 3C — patterns spanning ≥3 clusters.

## Cross-Cluster Tradeoffs
Comparison tables that span multiple clusters.

## Confidence Distribution
{table from frontmatter stats}

## Open Issues Pointer
See **[_open_issues.md](_open_issues.md)** for the living issues log. Highest-priority items:
- ...

## Critical Gaps That Block Conclusions
From Wave 3D — sources whose absence creates open questions across multiple synthesis pages. Resolving any of these would update multiple cluster pages.

## Provenance
- Source topics: see [_coverage.md](_coverage.md)
- Synthesis dashboard: `dashboards/{dashboard_id}/`
- Audit log: `_audit.jsonl`
```

#### `_claims.json` — merged structured claims

Same schema as `!p_research`'s `_claims.json`. Adds:

```json
{
  "merged_from": [
    {"topic_slug": "postgres-logical-replication", "claim_id": "claim-12"},
    {"topic_slug": "mysql-binlog-replication", "claim_id": "claim-7"}
  ],
  "contradiction_id": "ct-1"   // If this claim is one side of an open contradiction, points into _open_issues.md
}
```

#### `_graph.json` — merged entity + edge graph

Union of all per-topic `_graph.json` graphs. Edges from different topics referring to the same entity pair are merged with combined `sources[]` and `raised_by_workers[]`. Edge `support` is recomputed from the merged sources.

#### `_index.md` — entry point

Same shape as `!p_research`'s `_index.md` — but for the synthesis layer. Tells the reader which file to open in which order.

#### `_coverage.md`

```markdown
# Coverage

## Topics Merged ({N})
- `postgres-logical-replication` — claims: 32, generated: 2026-04-12, confidence band distribution: {...}
- ...

## Topics Skipped ({N})
- `legacy-mysql-5.6` — reason: filtered by --topics list
- `redis-streams` — reason: stale (older than synthesis _master_synthesis.md generated_at; --mode incremental)
- ...

## Cluster Composition
- **replication-strategies** = postgres-logical-replication + mysql-binlog-replication + read-replica-patterns
- ...

## Critical Missing Sources Aggregated
From `synthesis_critical_gaps` (Wave 3D). Sorted by mention_count across topics descending.
```

---

## Phase 7 — Wave 6: Verification (single worker, MANDATORY, ALWAYS LAST)

A FRESH worker who has not seen Waves 1-5. The verifier reads the synthesis layer end-to-end and adversarially checks for problems Waves 1-5 missed.

### Verifier prompt

The verifier worker receives:

- The full output set: `_master_synthesis.md`, `_open_issues.md`, every `topics/*.md`, `_claims.json`, `_graph.json`, `_coverage.md`
- The Wave 4 list of issue IDs (so the verifier knows what's already known-open)
- A pointer to the original per-topic research (for spot-check)
- The verification checklist below
- Output target: `documentation/research/synthesis/_verification_report.md`

### Verification checklist (the worker MUST run every check)

The verifier is required to perform each of these and document the result:

1. **Cross-page contradiction sweep.** For every claim in `_claims.json`, search every `topics/*.md` and `_master_synthesis.md` for contradicting statements. Any contradiction not present in `_open_issues.md` is a failure — appends to `_open_issues.md` (status: `open`, `severity` set by verifier) and to the history file.
2. **Citation integrity.** Every claim in `_claims.json` must have at least one citation that resolves to either an existing `documentation/research/{topic-slug}/sources/{hash}` file OR a URL recorded in some `_missing_sources.md`. Missing or broken citations are failures.
3. **Wikilink resolution.** Every `[[wikilink]]` in any `topics/*.md` or `_master_synthesis.md` must resolve to an existing synthesis page or a recorded entity. Broken links are failures.
4. **Frontmatter integrity.** Every synthesis file's frontmatter must match its body — declared `claim_count` matches actual count, declared `contradictions_open` matches the IDs the page references, declared `source_topics` matches the topics actually merged.
5. **Issue ID stability.** Spot-check 5 random issue IDs in `_open_issues.md` against the recipe — recompute hash from the recorded evidence, confirm match. ID drift is a failure.
6. **Confidence band correctness.** Spot-check 5 random claims — recompute the band from the `support` components using the published rule, confirm it matches the recorded band. Mismatch is a failure (workers smuggling in scalars or applying the rule incorrectly).
7. **Confidence-vs-content sanity.** For 5 random `high`-band claims, check that `_master_synthesis.md` doesn't hedge the same claim with weasel-words ("might", "perhaps", "unclear"). Conflict is a failure.
8. **Coverage cross-check.** `_coverage.md` declared topics must equal the topics whose claims actually appear in `_claims.json` `merged_from` arrays.
9. **Open-issues completeness.** Every `contradictions_referenced` ID in every Wave 2 cluster stitch return must appear in `_open_issues.md`. Missing references are failures.

### Verification outcomes

For each check:
- **PASS** — note in `_verification_report.md`, no further action.
- **FAIL with auto-fixable defect** — verifier appends correction to `_open_issues.md` (e.g., a missed contradiction) or `_attention.md` (e.g., a broken wikilink) and marks `status: passes-with-flags` for the run.
- **FAIL with structural defect** (frontmatter mismatch, ID drift, confidence-band miscompute) — verifier marks `status: failed` and writes a remediation plan in `_verification_report.md`. The master surfaces this in the final report and recommends `!p_synthesize --mode full` re-run.

### `_verification_report.md` schema

```markdown
---
generated_at: ISO-8601
synthesis_run_id: ...
verifier_agent: w6-verify
status: certified | passes-with-flags | failed
checks_run: 9
checks_passed: 9
checks_failed: 0
issues_appended_to_open_issues: 0
schema_version: 1
---

# Verification Report — Synthesis Run {synthesis_run_id}

## Status: certified

## Check Results

### 1. Cross-page contradiction sweep — PASS
Examined {N} claims across {M} pages. {K} contradictions detected; all {K} were already present in `_open_issues.md`. No new contradictions introduced.

### 2. Citation integrity — PASS
{N} citations checked, {N} resolved. 0 broken.

### 3. Wikilink resolution — PASS
...

### 4. Frontmatter integrity — PASS
...

### 5. Issue ID stability — PASS
Spot-checked 5 issue IDs. All hashes recomputed match.

### 6. Confidence band correctness — PASS
Spot-checked 5 claims. All bands recompute correctly per rule.

### 7. Confidence-vs-content sanity — PASS
...

### 8. Coverage cross-check — PASS
...

### 9. Open-issues completeness — PASS
...

## Remediation
{Empty if certified. Otherwise: ordered list of fixes with file paths and recommended re-run mode.}

## Independent Reading Notes
The verifier had not seen the Wave 1-5 outputs before this run. Notes from a fresh-read pass:
- {Anything the verifier wants to flag that isn't in the formal checklist — readability, redundancy, weak conclusions, etc.}
```

---

## Phase 8 — Final Report

Master compiles the final report (NON-NEGOTIABLE, same as `!p_track`):

1. Read all worker progress files, the synthesis layer outputs, `_open_issues.md`, `_verification_report.md`.
2. Compile:
   - **Summary:** mode, topics merged, clusters formed, issues opened/recurring/resolved this run.
   - **Files produced:** every file under `synthesis/`.
   - **Verification status:** certified / passes-with-flags / failed; surface any remediation plan.
   - **Top open issues:** the highest-severity items from `_open_issues.md`, with pointers to the cluster pages that reference them.
   - **Critical gaps:** synthesis-wide critical missing sources from `_coverage.md`.
   - **Concrete next steps:**
     - Manual fetches (synthesis_critical_gaps)
     - Follow-up `!p_research` runs to fill the highest-impact gaps
     - `!wiki ingest_batch documentation/research/synthesis/topics/` to crystallize the synthesis layer into the durable wiki (with a note: cluster pages are the most ingestible — they're already deduplicated)
3. Write `metrics.json` with synthesis-specific fields: `clusters_formed`, `topics_merged`, `topics_skipped`, `duplicate_groups_merged`, `contradictions_open`, `contradictions_resolved_this_run`, `recurring_issues`, `verification_status`.
4. Save to history per standard `!p_track` completion.

---

## Rules (Non-Negotiable)

### Master Constraints

1. **Master never modifies per-topic research.** `documentation/research/{topic-slug}/` is immutable input. All synthesis outputs go to `documentation/research/synthesis/`.
2. **`plan.json` precedes `initialization.json`.** Same `validate-plan-required.sh` enforcement as `!p_track` and `!p_research`.
3. **Saturation in Waves 1-3.** Dispatch one worker per cluster (Waves 1, 2) or per integration angle (Wave 3) in parallel. Back-to-back rounds when concurrency is capped.
4. **Pattern B for Waves 4, 5, 6.** Exactly one writer per merged file:
   - Wave 4 writes `_open_issues.md` and appends `_open_issues.history.jsonl`.
   - Wave 5 writes `_master_synthesis.md`, `_claims.json`, `_graph.json`, `_index.md`, `_coverage.md`.
   - Wave 6 writes `_verification_report.md` and may append to `_open_issues.md` / `_attention.md`.
5. **Verification wave is non-negotiable.** A run without Wave 6 is incomplete. `--mode verify-only` runs ONLY Wave 6 against the existing layer — that's the only legal way to skip Waves 1-5.

### Quality Rules

6. **Stable issue IDs.** Every contradiction and open question gets a hash-based ID. The hash is the contract for cross-run continuity. Workers that reinvent IDs per run break the audit trail.
7. **Confidence is computed, not asserted.** Same rule as `!p_research` — workers populate `support` components; the rule-based composer produces the band. A worker that writes a literal `confidence` scalar triggers a deviation.
8. **Contradictions are first-class.** Workers do NOT pick a winner during stitching. Both sides land in the cluster page with attribution; the issue ID is the bridge to `_open_issues.md`. Resolution happens via NEW research, not via synthesis-time editorial.
9. **`_open_issues.md` history is append-only.** Never rewrite `_open_issues.history.jsonl`. Resolution is a NEW history entry, not a deletion. Same primitive as wiki `findings/`.
10. **No emojis** unless the user opts in or the project's CLAUDE.md does.

### Provenance & Audit

11. **Audit every mutation.** Every state change in `_open_issues.md`, every cluster page write, every merged-artifact write appends to `_audit.jsonl` with `op`, `synthesis_run_id`, `actor`, `target`, `before_hash?`, `after_hash?`.
12. **Synthesis layer is derived state.** It is regenerable from per-topic research via `--mode full`. Don't hand-edit synthesis files; updates flow through re-runs. The exception is `_attention.md`, which is a human-facing log file and may be appended to manually.
13. **Cluster pages preserve traceability.** Every claim in a cluster page cites its source as `[topic-slug:claim-id]` so a reader can follow the trail back to the original per-topic research and from there to the original sources.

### Synapse Integration

14. **Full dashboard tracking always.** Same as `!p_research`. Never `!p` lightweight.
15. **Cycle protection.** If `!p_synthesize` is invoked from a hook (e.g., a future post-research hook), propagate `--triggered-by` and `--depth`. Reject `depth > 3`.
16. **Wiki crystallization is opt-in.** The final report SUGGESTS `!wiki ingest_batch documentation/research/synthesis/topics/` — does not auto-fire.
17. **Resume-safe.** Like `!p_research`, the swarm is resumable via `!p_track_resume`. Cluster pages whose file already exists with valid frontmatter and a matching `synthesis_run_id` are considered complete on resume.

### Dispatch & Tracking (inherited from `!p_track`)

18. **Dispatch FIRST, update tracker AFTER.**
19. **Atomic writes only.** Read → modify → write full file. Never partial JSON.
20. **Live timestamps.** Always `date -u +"%Y-%m-%dT%H:%M:%SZ"` at the moment of writing.
21. **Final report is non-negotiable.**

---

## Incremental Re-Run Behavior (`--mode incremental`)

When new research lands and the user re-runs `!p_synthesize --mode incremental`:

1. **Discovery** identifies which topics are newer than the current synthesis layer's `_master_synthesis.md` `generated_at`.
2. **Cluster recomputation** — new topics may join existing clusters (entity overlap) or form new ones. The plan reflects the affected clusters.
3. **Wave 1 dispatch is scoped to affected clusters.** Unaffected cluster pages are NOT re-stitched.
4. **Wave 4 reads existing `_open_issues.md`** and runs the resolved/recurring/new diff. Issues that were open in prior runs but are NOT detected in the affected clusters this run are checked against ALL cluster pages (not just the affected ones) before being marked resolved — an issue can only be resolved if it's no longer detected anywhere, not just in the affected subset.
5. **Wave 5 regenerates `_master_synthesis.md`** from ALL cluster pages (affected + unaffected) so the master synthesis stays current.
6. **Wave 6 verifies the FULL layer** — the verifier doesn't get a discount for incremental mode. Independent verification is the contract.

This means `!p_synthesize --mode incremental` is the maintenance run for an evolving research catalogue. As long as new research is added through `!p_research`, the synthesis layer stays current and `_open_issues.md` accumulates the project's institutional memory of "what we don't yet agree on" without ever silently losing an issue.

---

## Cost Discipline

- `--mode incremental` ≈ scoped to affected clusters; cheaper than full.
- `--mode full` ≈ full sweep; cost scales linearly with cluster count.
- `--mode verify-only` ≈ single worker; lightest mode.
- `--depth deep` doubles parallelism in Waves 1-3 — dispatches multiple workers per cluster (one for dedup of duplicates-only, one for complementary-pair detection, one for contradictions-only) instead of one worker per cluster doing all three. Use when individual clusters carry >30 claims each.
- If a wiki budget config exists (`{wiki_root}/schema/current` → `budgets.per_swarm_max_tokens`), respect it. Append a one-line entry to `_attention.md` if dispatching the planned wave would exceed it; await user override.
