# `!q_product_plan [focus]`

> **Lightweight version of `!p_product_plan`.** Same plan quality and output artifacts. One task card per wave, no worker progress files, master aggregates returns. This is where `!q_` mode saves the most tokens — `!p_product_plan` Wave 2 alone can dispatch 84+ evaluation workers, each writing 3+ progress updates.
>
> **Read `!p_product_plan` for:** output schemas, strategic lenses menu, evaluation category menu, plan candidate file schema, evaluation file schema, comparison schemas, `final_ratings.md` / `final_plans.md` schemas, anti-inflation rules, quality rules. This file ONLY describes what's different.

**Syntax:** `!q_product_plan [--breadth {standard|wide|exhaustive}] [--lenses "lens1,..."] [--categories "cat1,..."] [--top-n N] [focus]`

---

## Non-Negotiable Rules

1. **You are the MASTER AGENT.** Same constraints as `!p_product_plan` — you do NOT write plan content.
2. **Read `{tracker_root}/agent/instructions/tracker_master_instructions.md`** before writing dashboard files.
3. **Workers do NOT write progress files.** Workers return structured reports; master updates dashboard.
4. **One task card per wave.** `initialization.json` has one agent entry per wave.
5. **Honesty rules are unchanged.** The lightweight model does NOT relax honesty, anti-inflation, or citation requirements. Workers still must surface weaknesses, cite evidence, and commit to scores.
6. **Same output quality.** All plan artifacts are identical to `!p_product_plan` output.

---

## Dashboard Model

Same one-agent-per-wave model. Example for `--breadth wide` (12 lenses, 7 categories):

```json
{
  "agents": [
    { "id": "wave-1", "label": "Wave 1 — Plan Generation", "task_id": "wave-1", "status": "pending", "wave": 1, "worker_count": 12 },
    { "id": "wave-2", "label": "Wave 2 — Multi-Dimensional Evaluation", "task_id": "wave-2", "status": "pending", "wave": 2, "worker_count": 84, "depends_on": ["wave-1"] },
    { "id": "wave-3", "label": "Wave 3 — Comparison Angles", "task_id": "wave-3", "status": "pending", "wave": 3, "worker_count": 4, "depends_on": ["wave-2"] },
    { "id": "wave-4", "label": "Wave 4 — Adversarial Review", "task_id": "wave-4", "status": "pending", "wave": 4, "worker_count": 4, "depends_on": ["wave-3"] },
    { "id": "wave-5", "label": "Wave 5 — Comparison Matrix", "task_id": "wave-5", "status": "pending", "wave": 5, "worker_count": 1, "depends_on": ["wave-4"] },
    { "id": "wave-6", "label": "Wave 6 — Final Synthesis", "task_id": "wave-6", "status": "pending", "wave": 6, "worker_count": 1, "depends_on": ["wave-5"] }
  ]
}
```

Progress files follow `progress/wave-{N}.json` — same schema as `!q_research` with plan-specific aggregation fields.

---

## Execution Flow

### Phase 1 — Discovery, Lens Selection, & Plan Framing

**Identical to `!p_product_plan` Phase 1** — same synthesis layer reading, same frame extraction, same lens/category selection, same `plan.json` schema, same `_evaluation_framework.md` write. Only difference: `initialization.json` uses one-agent-per-wave model.

Present the plan to the user and wait for approval.

### Phase 2 — Wave Execution (Waves 1-6)

For each wave:

1. Update wave card to `in_progress`.
2. Dispatch ALL workers in parallel using the Agent tool.
   - Worker prompts identical to `!p_product_plan` EXCEPT: remove progress file instructions, add return-only instruction.
   - **Wave 1 (Plan Generation):** One worker per lens. Each writes `candidates/{lens-slug}-{topic}.md` on disk. Returns plan summary with key metrics.
   - **Wave 2 (Evaluation):** One worker per (plan, category) pair. Each writes `evaluations/{plan-slug}/{category-slug}.md` on disk. Returns score + evidence_quality + 1-line rationale. **This wave is the biggest token saver** — at `wide` breadth, 84 workers × 3 progress writes = 252 eliminated file operations.
   - **Wave 3 (Comparisons):** Workers 3A-3D in parallel. Each writes one file under `comparisons/`. Returns ranking summaries.
   - **Wave 4 (Adversarial):** One worker per top-N candidate. Each writes `evaluations/{plan-slug}/_adversarial.md`. Returns the strongest case against.
   - **Wave 5 (Matrix):** Single worker. Writes `_comparison_matrix.md`. Returns matrix summary.
   - **Wave 6 (Final Synthesis):** Single worker. Writes `final_ratings.md` AND `final_plans.md`. Returns recommendation summary.
3. As workers return, update wave card. For Wave 2, track the score matrix incrementally.
4. On wave completion, extract upstream context for next wave.

### Master Upstream Context Extraction

Between waves, the master condenses key findings:

- **Wave 1 → Wave 2:** Plan slugs, plan titles, plan file paths (so eval workers can read them).
- **Wave 2 → Wave 3:** Complete score matrix `{plan_slug: {category: {score, evidence_quality}}}` extracted from returns. This is the critical upstream — comparison workers need the full matrix.
- **Wave 3 → Wave 4:** Provisional top-N from comparison rankings. Compute mean rank across all comparison angles.
- **Wave 3 → Wave 4 (adversarial prompts):** For each top-N plan, include the plan file path + all evaluation file paths + comparison results.
- **Wave 4 → Wave 5:** Adversarial review summaries per plan.
- **Wave 5 → Wave 6:** Comparison matrix path + all evaluation/adversarial/comparison file paths.

### Phase 3 — Completion

Same as `!q_research`: inline final report, `metrics.json`, history save. The final report surfaces the same content as `!p_product_plan` Phase 8 — top-N grades, convergent risks, strategic forks, honesty audit, next steps.

---

## What's Preserved / What's Removed

- **Preserved:** All output artifacts (`final_plans.md`, `final_ratings.md`, `_comparison_matrix.md`, `_evaluation_framework.md`, all candidates, all evaluations, all comparisons), honesty rules, anti-inflation rules, citation requirements, calibration anchors, Pattern B enforcement for Waves 5/6, user approval gate.
- **Removed:** Worker progress files, worker reading `tracker_worker_instructions.md`, per-worker agent entries, per-worker log entries.

## Token Savings Estimate

| Breadth | `!p_product_plan` workers | Progress writes saved | Approx. token savings |
|---|---|---|---|
| standard | ~60 | ~180 | ~150k tokens |
| wide | ~105 | ~315 | ~260k tokens |
| exhaustive | ~190 | ~570 | ~475k tokens |
