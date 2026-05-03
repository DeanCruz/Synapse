# `!q_research {topic}`

> **Lightweight version of `!p_research`.** Same research quality and output artifacts. Drastically reduced tracking overhead: one task card per wave, no worker progress files, master aggregates returns.
>
> **Read `!p_research` for:** output schemas, decomposition framework, depth tiers, raw findings file schema, worker return schema, source weighting protocol, synthesis worker protocol, quality rules. This file ONLY describes what's different.

**Syntax:** `!q_research [--depth {shallow|standard|deep|exhaustive}] [--scope {internal|external|both}] [--max-waves N] {topic}`

---

## Non-Negotiable Rules

1. **You are the MASTER AGENT.** Same role constraints as `!p_research` — you do NOT fetch sources directly.
2. **Read `{tracker_root}/agent/instructions/tracker_master_instructions.md`** before writing dashboard files.
3. **Workers do NOT read `tracker_worker_instructions.md` and do NOT write progress files.** This is the core difference. Workers return structured reports to the master; the master updates the dashboard.
4. **One task card per wave.** `initialization.json` has one agent entry per wave, not per worker.
5. **Same output quality.** The research artifacts under `documentation/research/{topic-slug}/` are identical to `!p_research` output. Only the tracking overhead is reduced.

---

## Dashboard Model (What's Different)

### `initialization.json` — one agent per wave

```json
{
  "swarm_title": "Quick Research: {topic}",
  "layout": "waves",
  "agents": [
    {
      "id": "wave-1",
      "label": "Wave 1 — Discovery",
      "task_id": "wave-1",
      "status": "pending",
      "wave": 1,
      "worker_count": 12,
      "description": "Broad discovery across all angles"
    },
    {
      "id": "wave-2",
      "label": "Wave 2 — Deep Dive",
      "task_id": "wave-2",
      "status": "pending",
      "wave": 2,
      "worker_count": 8,
      "depends_on": ["wave-1"],
      "description": "Deep-dive into high-value sources from Wave 1"
    }
  ]
}
```

### Progress files — one per wave

Write to `{tracker_root}/dashboards/{dashboardId}/progress/wave-{N}.json`:

```json
{
  "task_id": "wave-1",
  "status": "in_progress",
  "started_at": "ISO-8601",
  "worker_count": 12,
  "workers_completed": 7,
  "workers_failed": 0,
  "stage": "executing",
  "message": "7/12 workers returned — 42 claims, 3 contradictions surfaced so far",
  "worker_summaries": [
    {
      "agent_id": "w1-t1-definitional",
      "status": "completed",
      "claim_count": 8,
      "sources_fetched": 6,
      "sources_inaccessible": 2,
      "key_findings": "Core definitions established; canonical sources agree on X"
    }
  ],
  "aggregated": {
    "total_claims": 42,
    "total_sources_fetched": 31,
    "total_sources_inaccessible": 11,
    "contradictions_flagged": 3,
    "high_value_findings": ["...", "..."]
  }
}
```

The master updates this file incrementally as each worker returns. When all workers complete, set `status: "completed"` and write the final aggregation.

---

## Execution Flow

### Phase 1 — Decomposition & Plan

**Identical to `!p_research` Phase 1** with these changes:

- `plan.json` is written exactly as in `!p_research` (same schema, same task decomposition).
- `initialization.json` uses the one-agent-per-wave schema above (NOT one-agent-per-worker).
- Present the plan to the user and wait for approval (same gate).

### Phase 2 — Wave Dispatch & Execution

For each wave:

1. **Update wave card** to `in_progress` in `progress/wave-{N}.json`.
2. **Dispatch ALL workers for this wave in parallel** using the Agent tool. Worker prompts are identical to `!p_research` worker prompts EXCEPT:
   - **Remove** all progress file instructions (no `tracker_worker_instructions.md` reference, no progress file path, no mandatory write points).
   - **Add** this return instruction: "When done, return a structured JSON summary of your findings. Do NOT write any progress or tracking files. Your ONLY file outputs are your raw findings file under `raw/` and any source body files under `sources/`."
   - Worker prompts still include: identity, topic context, output target (raw file path), source-fetch protocol, redaction sweep, upstream results (Wave ≥ 2), sibling awareness.
3. **As each worker returns**, parse the structured return, append a summary to `wave-{N}.json` `worker_summaries`, update the aggregated counts, and update `message` with current progress.
4. **On wave completion** (all workers returned), set wave card `status: "completed"` with full aggregation. Extract key upstream context:
   - High-value sources discovered
   - Contradictions to chase
   - Inaccessible sources worth retrying
   - Open questions for next wave
5. **Plan next wave** using the extracted upstream context (same inter-wave planning as `!p_research`). Add the next wave's tasks to `plan.json` (append). Add the next wave agent to `initialization.json`.
6. **Repeat** until all waves complete.

### Phase 3 — Source Weighting

Same as `!p_research` Phase 3. The integration worker is dispatched the same way (no progress file). Master updates the relevant wave card.

### Phase 4 — Synthesis

Same as `!p_research` Phase 4. Single synthesis worker dispatched without progress file overhead. Master updates the final wave card.

### Phase 5 — Completion

1. **Update `logs.json`** with a single completion entry (not per-worker entries).
2. **Write the final report** inline in the conversation (NON-NEGOTIABLE). Same content as `!p_research` Phase 5 — summary, files produced, coverage, deviations, confidence, next steps.
3. **Write `metrics.json`** with same fields as `!p_research`.
4. **Save to history** per standard completion.

---

## What's Preserved from `!p_research`

- **All output artifacts** — same `_synthesis.md`, `_claims.json`, `_graph.json`, `_confidence.md`, `_missing_sources.md`, `_index.md`, `raw/*.md`, `sources/*`.
- **All quality rules** — every claim cites sources, confidence is computed not asserted, inaccessible sources are first-class, redaction before persistence.
- **Same decomposition framework** — angles, lenses, depth tiers.
- **Same synthesis protocol** — Pattern B single writer, same schema.
- **User approval gate** — still required before dispatch.

## What's Removed

- Worker progress files (3+ writes per worker eliminated)
- Worker reading `tracker_worker_instructions.md` (~800 tokens per worker saved)
- Per-worker agent entries in `initialization.json`
- Per-worker log entries in `logs.json`
- Per-worker dashboard rendering overhead

## Token Savings Estimate

| Depth | `!p_research` workers | Progress writes saved | Approx. token savings |
|---|---|---|---|
| shallow | ~10 | ~30 | ~25k tokens |
| standard | ~20 | ~60 | ~50k tokens |
| deep | ~35 | ~105 | ~90k tokens |
| exhaustive | ~50 | ~150 | ~125k tokens |
