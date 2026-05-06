# `!q_product_research {prompt}`

> **Lightweight version of `!p_product_research`.** Same three-stage pipeline, same output quality, drastically reduced tracking overhead.
>
> **Core difference:** One task card per wave across the entire pipeline. Workers do NOT write progress files. The master dispatches workers, collects their final reports, updates wave task cards with aggregated results, and upstreams key context to the next wave. This eliminates hundreds of progress file writes and thousands of tokens of tracking overhead per stage.
>
> **Read `!p_product_research` for:** prompt persistence schema, pipeline state schema, `pipeline_report.md` schema, stage transition gates. This file describes the lightweight execution model.

**Syntax:** `!q_product_research [--research-depth {shallow|standard|deep|exhaustive}] [--research-scope {internal|external|both}] [--synthesize-mode {full|incremental}] [--plan-breadth {standard|wide|exhaustive}] [--plan-top-n N] {prompt}`

All flags pass through to the corresponding stage (same as `!p_product_research`).

---

## Non-Negotiable Rules

1. **You are the PIPELINE MASTER.** You orchestrate three stages in strict sequence: `!q_research` → `!q_synthesize` → `!q_product_plan`. You do NOT skip stages. You do NOT reorder stages.
2. **The PROMPT IS PERSISTED FIRST.** Same `prompt.md` and `_pipeline_runs/{id}/invocation.json` protocol as `!p_product_research`.
3. **You inherit each `!q_` command's protocol for its stage.** While running Stage 1, follow `!q_research`. While running Stage 2, follow `!q_synthesize`. While running Stage 3, follow `!q_product_plan`.
4. **Single dashboard for the entire pipeline.** Unlike `!p_product_research` (3 dashboards), `!q_product_research` uses ONE dashboard with stage-prefixed wave cards. This eliminates dashboard allocation overhead and gives a unified view.
5. **Each stage requires user approval.** Same approval gate as `!p_product_research`. The pipeline does NOT auto-approve.
6. **Stage failure halts the pipeline.** Same halt protocol as `!p_product_research`.

---

## Single-Dashboard Model

The pipeline uses ONE dashboard with task IDs prefixed by stage:

```json
{
  "swarm_title": "Quick Product Research: {prompt_first_50_chars}",
  "layout": "waves",
  "agents": [
    { "id": "s1-wave-1", "label": "S1: Research — Discovery", "task_id": "s1-wave-1", "status": "pending", "wave": 1, "worker_count": 12 },
    { "id": "s1-wave-2", "label": "S1: Research — Deep Dive", "task_id": "s1-wave-2", "status": "pending", "wave": 2, "worker_count": 8, "depends_on": ["s1-wave-1"] },
    { "id": "s1-wave-3", "label": "S1: Research — Gap Fill", "task_id": "s1-wave-3", "status": "pending", "wave": 3, "worker_count": 6, "depends_on": ["s1-wave-2"] },
    { "id": "s1-wave-4", "label": "S1: Research — Source Weighting", "task_id": "s1-wave-4", "status": "pending", "wave": 4, "worker_count": 1, "depends_on": ["s1-wave-3"] },
    { "id": "s1-wave-5", "label": "S1: Research — Synthesis", "task_id": "s1-wave-5", "status": "pending", "wave": 5, "worker_count": 1, "depends_on": ["s1-wave-4"] }
  ]
}
```

Stage 2 and Stage 3 wave cards are appended to `initialization.json` when each stage is planned (after the preceding stage completes and user approves). This avoids upfront planning of all 3 stages — each stage plans based on the preceding stage's output.

Progress files: `progress/s{stage}-wave-{N}.json` — same wave-level schema as `!q_research`.

---

## Phase 0 — Prompt Persistence

**Identical to `!p_product_research` Phase 0.** Persist `prompt.md`, create `_pipeline_runs/{id}/invocation.json`, generate `pipeline_run_id`. No changes.

---

## Phase 1 — Stage 1: Research (`!q_research`)

1. **Read `{tracker_root}/_commands/Synapse/q_research.md`** to load the lightweight research protocol.
2. **Set Stage 1 inputs** — same as `!p_product_research` Phase 1 (topic = prompt, depth, scope flags).
3. **Plan Stage 1** — follow `!q_research` Phase 1. Write `plan.json` with Stage 1 tasks. Write wave cards to `initialization.json` with `s1-` prefix.
4. **Update pipeline status** — `stage1_research: "planning"`. Update `prompt.md` status.
5. **Present plan to user, wait for approval.**
6. **Execute Stage 1** — follow `!q_research` Phase 2 through completion. The master dispatches workers, collects returns, updates `s1-wave-{N}` cards.
7. **On completion** — verify `_synthesis.md` exists with non-empty `claim_count`. Write `_pipeline_runs/{id}/stage1_research.json`. Update pipeline status.
8. **On failure** — halt. Same protocol as `!p_product_research`.

### Stage 1 → Stage 2 Transition Gate

Same checks as `!p_product_research`: `_synthesis.md` exists, `_index.md` exists, `stage1_research.json` status is `completed`.

---

## Phase 2 — Stage 2: Synthesize (`!q_synthesize`)

1. **Read `{tracker_root}/_commands/Synapse/q_synthesize.md`** to load the lightweight synthesis protocol.
2. **Determine synthesize mode** — same auto-detection as `!p_product_research`.
3. **Plan Stage 2** — follow `!q_synthesize` Phase 1. Append Stage 2 wave cards to `initialization.json` with `s2-` prefix.
4. **Update pipeline status** — `stage2_synthesize: "planning"`.
5. **Present plan to user, wait for approval.**
6. **Execute Stage 2** — follow `!q_synthesize` Phase 2 through completion.
7. **On completion** — check verification status. Write `_pipeline_runs/{id}/stage2_synthesize.json`. Update pipeline status.
8. **Verification handling** — same as `!p_product_research`: `certified` → proceed; `passes-with-flags` → proceed with flags noted; `failed` → halt.

---

## Phase 3 — Stage 3: Product Plan (`!q_product_plan`)

1. **Read `{tracker_root}/_commands/Synapse/q_product_plan.md`** to load the lightweight plan protocol.
2. **Set Stage 3 inputs** — focus = original prompt, breadth/top-n from flags.
3. **Plan Stage 3** — follow `!q_product_plan` Phase 1. Append Stage 3 wave cards to `initialization.json` with `s3-` prefix.
4. **Update pipeline status** — `stage3_product_plan: "planning"`.
5. **Present plan to user, wait for approval.**
6. **Execute Stage 3** — follow `!q_product_plan` Phase 2 through completion.
7. **On completion** — read `final_plans.md` and `final_ratings.md`. Write `_pipeline_runs/{id}/stage3_product_plan.json`. Update pipeline status to `completed`.

---

## Phase 4 — Pipeline Report

**Same `pipeline_report.md` as `!p_product_research` Phase 4.** The report schema is identical — it summarizes the same output artifacts. The only difference: all stage pointers reference the single dashboard ID (not 3 separate ones).

---

## Phase 5 — Final Pipeline Disclosure

**Same terminal output as `!p_product_research` Phase 5.** Print the recommendation, reading order, and most-valuable follow-up.

---

## Pipeline State Management

### `_pipeline_runs/{id}/invocation.json` — same schema as `!p_product_research`

With one addition:

```json
{
  "pipeline_run_id": "qr-20260503-a3f7k2",
  "mode": "quick",
  "dashboard_id": "{single_dashboard_id}",
  ...
}
```

`pipeline_run_id` prefix is `qr-` (quick-research) to distinguish from `pr-` (full pipeline) runs.

### Stage status JSON files — same schema as `!p_product_research`

All three `stage{N}_*.json` files point to the SAME dashboard ID with stage-prefixed wave references.

---

## Rules (Non-Negotiable)

### Pipeline Constraints

1. **Persist the prompt FIRST.** No dispatch before `prompt.md` and `invocation.json` exist.
2. **Three stages, strict order.** No reordering, no skipping, no collapsing.
3. **Single dashboard.** One dashboard for the entire pipeline. Stage wave cards are prefixed `s{N}-`.
4. **User approval per stage.** The pipeline does NOT auto-approve.
5. **Stage failure halts.** Surface and stop.

### Lightweight Tracking Constraints

6. **One task card per wave.** No per-worker cards.
7. **Workers do NOT write progress files.** Workers return structured reports to the master.
8. **Master updates wave cards incrementally.** As each worker returns, the master updates the wave card with the worker's summary and aggregated metrics.
9. **Master upstreams context between waves.** Between waves and stages, the master extracts the key findings that downstream work needs and injects them into the next dispatch prompts.

### Wave Lifecycle Enforcement (ENFORCED BY HOOK)

10. **Mark `in_progress` BEFORE dispatch.** For every wave, the master MUST write the wave's progress file with `status: "in_progress"` BEFORE dispatching any Agent for that wave. The `validate-wave-lifecycle.sh` PreToolUse hook will **BLOCK** Agent tool calls if no wave is currently `in_progress`.
11. **Mark `completed` AFTER all workers return.** When all workers for a wave have returned, the master MUST **immediately** update the wave's progress file to `status: "completed"` before proceeding. The hook will **BLOCK** the next wave's dispatch if the current wave isn't `completed`.
12. **This applies across all stages.** Stage 2 and Stage 3 wave cards (prefixed `s2-`, `s3-`) follow the same lifecycle. The hook validates all wave-level agent IDs regardless of stage prefix.

### Inheritance

10. **Each `!q_` sub-command's protocol is followed verbatim** during its stage. The pipeline does NOT further relax any rule.
11. **`pipeline_run_id` threads through every stage's `plan.json` `context`.** Same traceability as `!p_product_research`.
12. **All output quality rules from the `!p_` versions apply.** Honesty, citations, computed confidence, source weighting, verification — all unchanged.

### State

13. **Atomic full-file rewrites for `invocation.json`.** Same as `!p_product_research`.
14. **`prompt.md` is append-only across runs.** Same as `!p_product_research`.

---

## Cost Discipline

The primary savings are tracking overhead, not worker count. The same number of workers run, but each saves ~800+ tokens of progress instructions + 3+ file writes:

| Configuration | Workers | `!p_` progress writes | `!q_` progress writes | Tracking savings |
|---|---|---|---|---|
| All defaults | ~155-200 | ~465-600 | ~12-16 (wave cards only) | ~95-97% reduction |
| Cost-conscious | ~75-110 | ~225-330 | ~10-12 | ~95-97% reduction |
| Maximum | ~280-370 | ~840-1110 | ~18-22 | ~97-98% reduction |

Additional savings from single dashboard (vs 3): ~3x fewer dashboard allocation/management operations.

The pipeline master MUST still surface projected total worker count BEFORE Stage 1 dispatch.

---

## When to Use `!q_product_research` vs `!p_product_research`

**Use `!q_product_research` when:**
- Speed and token efficiency matter more than granular live tracking
- You're running the pipeline from a CLI agent (no GUI dashboard watching)
- The pipeline is expected to succeed without heavy intervention
- You want the same research quality with less overhead

**Use `!p_product_research` when:**
- You want granular live tracking in the Synapse dashboard GUI
- You expect to need to intervene mid-wave (inspect individual worker progress)
- You're debugging pipeline issues and need per-worker visibility
- Multiple stakeholders are watching the dashboard in real-time
