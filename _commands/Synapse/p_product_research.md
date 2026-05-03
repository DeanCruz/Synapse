# `!p_product_research {prompt}`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are the PIPELINE MASTER.** You orchestrate three stages in strict sequence: `!p_research` → `!p_synthesize` → `!p_product_plan`. You do NOT skip stages. You do NOT reorder stages. You do NOT collapse them into a single dashboard. Each stage runs as its own full-tracking swarm with its own dashboard.
>
> **2. The PROMPT IS PERSISTED FIRST.** Before any worker is dispatched, write `{project_root}/documentation/research/prompt.md`. This file is the durable record of intent for the entire pipeline. Every downstream stage may reference it. Failure to persist the prompt before Stage 1 dispatch is a pipeline failure.
>
> **3. You inherit the protocol of each underlying command for its stage.** While running Stage 1, you ARE the `!p_research` master and must follow that command's rules verbatim. Same for Stage 2 (`!p_synthesize`) and Stage 3 (`!p_product_plan`). The pipeline does not relax any constraint of any underlying command.
>
> **4. Each stage requires its own user approval.** The pipeline does NOT auto-approve. Stage 1 plans, the user approves, Stage 1 executes. THEN Stage 2 plans, the user approves, Stage 2 executes. THEN Stage 3. The pipeline orchestrates approvals — it does not bypass them.
>
> **5. Stage failure halts the pipeline.** If Stage 1 fails fatally, do NOT proceed to Stage 2. If Stage 2 fails fatally, do NOT proceed to Stage 3. Surface the failure and stop. Partial pipelines are honest; silent fall-through to the next stage is not.

**Purpose:** One-command end-to-end product research pipeline. Persists the user's research prompt as the durable guiding document, then runs the three pipeline commands consecutively. Each stage runs as its own full Synapse swarm with its own dashboard. The user gets three deliverables progressively: a research corpus (Stage 1), a synthesized knowledge layer (Stage 2), and ranked product plans with a final recommendation (Stage 3).

**Distinct from running the three commands manually:** Functionally equivalent in output. The benefit of `!p_product_research` is (a) the prompt is persisted in one canonical place that all stages reference, (b) pipeline-level state is tracked so failures and resumes are obvious, (c) a unified pipeline report at the end summarizes the full journey from prompt to recommendation.

**Run order (strict):**
1. **Persist** the prompt to `documentation/research/prompt.md`
2. **Stage 1** — `!p_research {prompt}` produces `documentation/research/{topic-slug}/`
3. **Stage 2** — `!p_synthesize` produces `documentation/research/synthesis/`
4. **Stage 3** — `!p_product_plan` produces `documentation/research/plans/` including `final_ratings.md` and `final_plans.md`
5. **Pipeline report** — unified summary linking all stages

**Syntax:** `!p_product_research [--research-depth {shallow|standard|deep|exhaustive}] [--research-scope {internal|external|both}] [--synthesize-mode {full|incremental}] [--plan-breadth {standard|wide|exhaustive}] [--plan-top-n N] {prompt}`

- `{prompt}` — The research question. Saved verbatim to `documentation/research/prompt.md`. Used as the topic for Stage 1, the focus for Stage 3, and (when relevant) referenced in Stage 2's framing.
- `--research-depth` — (Optional, default `deep`) Passed through to Stage 1's `!p_research --depth`.
- `--research-scope` — (Optional, default `both`) Passed through to Stage 1's `!p_research --scope`.
- `--synthesize-mode` — (Optional, default auto) `full` forces a from-scratch synthesis. `incremental` only re-syntheses affected clusters. Auto picks: `full` if no prior `synthesis/_master_synthesis.md` exists, otherwise `incremental`.
- `--plan-breadth` — (Optional, default `wide`) Passed through to Stage 3's `!p_product_plan --breadth`.
- `--plan-top-n` — (Optional, default 4) Passed through to Stage 3's `!p_product_plan --top-n`.

**Examples:**
```
!p_product_research should we build a managed Postgres replication service for fintech compliance teams
!p_product_research --research-depth exhaustive --plan-breadth exhaustive AI-native code review tooling
!p_product_research --research-scope external --plan-top-n 5 should our framework support React Server Components
```

---

## Output Structure

The pipeline produces artifacts from each underlying command PLUS pipeline-level files:

```
{project_root}/documentation/research/
├── prompt.md                                   # PIPELINE INPUT — durable record of the original research prompt.
├── pipeline_report.md                          # PIPELINE DELIVERABLE — unified report tying all three stages together.
├── _pipeline_runs/
│   └── {pipeline_run_id}/
│       ├── invocation.json                     # Frozen flags + prompt + timestamps + user info
│       ├── stage1_research.json                # Stage 1 dashboard ID, topic slug, status, key metrics
│       ├── stage2_synthesize.json              # Stage 2 dashboard ID, mode, status, key metrics
│       └── stage3_product_plan.json            # Stage 3 dashboard ID, top-N grades, recommendation
│
├── {topic-slug}/                               # Stage 1 output — see !p_research
├── synthesis/                                  # Stage 2 output — see !p_synthesize
└── plans/                                      # Stage 3 output — see !p_product_plan
```

> **`prompt.md` is the pipeline's load-bearing artifact.** Every downstream stage may read it. Each stage persists `_pipeline_run_id:` in its `plan.json` `context` so the pipeline can correlate three swarm dashboards back to one pipeline invocation.

---

## Phase 0 — Prompt Persistence

Master only. Runs BEFORE any swarm dispatch. Synchronous.

1. **Resolve roots.** `{project_root}` from `.synapse/project.json` (or `--project` flag). Compute `research_root = {project_root}/documentation/research/`. Create `research_root/` and `research_root/_pipeline_runs/` if missing.
2. **Read master instructions** from `{tracker_root}/agent/instructions/tracker_master_instructions.md`.
3. **Generate `pipeline_run_id`** — `pr-{YYYYMMDD}-{6-char-hex}` (e.g., `pr-20260502-a3f7k2`). This ID threads through all three stages.
4. **Capture invocation timestamps** — `date -u +"%Y-%m-%dT%H:%M:%SZ"` at this exact moment.
5. **Write `documentation/research/prompt.md`** with the schema below.
   - **Append-only behavior:** if `prompt.md` already exists, do NOT overwrite. Append a new entry at the bottom (with a horizontal rule and the new run header). The file becomes a chronological log of every pipeline invocation against this project. Older prompts remain visible for context.
6. **Write `_pipeline_runs/{pipeline_run_id}/invocation.json`** with the frozen flag set, the prompt, the user invocation timestamp, and `git_sha` of the project at start (for reproducibility) if `{project_root}` is a git repo.
7. **Confirm with the user:** print "Pipeline run `{id}` initiated. Stage 1 (research) planning starting now." Do NOT prompt for additional input here — the user already provided the prompt.

### `prompt.md` schema

```markdown
# Research Prompts — Pipeline History

This file is the durable record of every `!p_product_research` invocation against this project. Each section below is one pipeline run. Older entries are kept for historical context — they ground "what were we trying to learn 3 months ago?" against the current state.

> **Editing this file by hand is discouraged.** It is meant as an audit trail. If a prompt was wrong and you want to redo it, run `!p_product_research` again with the corrected prompt — a new entry appends below.

---

## Pipeline Run: `pr-20260502-a3f7k2`

**Invoked at:** 2026-05-02T14:23:11Z
**Invoked by:** {user from .synapse/project.json or git config — "unknown" if not available}
**Project git SHA at invocation:** {sha or "not-a-git-repo"}

### Original Prompt
> {The user's prompt, verbatim, in a blockquote — preserves exact wording.}

### Pipeline Configuration
- `--research-depth`: deep
- `--research-scope`: both
- `--synthesize-mode`: full (auto-selected: no prior synthesis layer)
- `--plan-breadth`: wide
- `--plan-top-n`: 4

### Stage Pointers
- **Stage 1 (research):** dashboard `{dashboard1}` → `documentation/research/{topic-slug}/`
- **Stage 2 (synthesize):** dashboard `{dashboard2}` → `documentation/research/synthesis/`
- **Stage 3 (product plan):** dashboard `{dashboard3}` → `documentation/research/plans/`
- **Unified report:** `documentation/research/pipeline_report.md` (regenerated each run; check `_pipeline_runs/{id}/` for per-run snapshots)

### Status (live, updated by pipeline master)
- Stage 1: pending → planning → executing → completed | failed | aborted
- Stage 2: pending → planning → executing → completed | failed | aborted
- Stage 3: pending → planning → executing → completed | failed | aborted
- Pipeline: pending → in-progress → completed | failed-at-stage-N | aborted-by-user

---

## Pipeline Run: {previous_run_id}
{... older entries preserved below}
```

### `_pipeline_runs/{id}/invocation.json` schema

```json
{
  "pipeline_run_id": "pr-20260502-a3f7k2",
  "invoked_at": "2026-05-02T14:23:11Z",
  "invoked_by": "...",
  "project_root": "...",
  "tracker_root": "...",
  "git_sha": "...",
  "prompt": "should we build a managed Postgres replication service for fintech compliance teams",
  "flags": {
    "research_depth": "deep",
    "research_scope": "both",
    "synthesize_mode": "full",
    "plan_breadth": "wide",
    "plan_top_n": 4
  },
  "stage_status": {
    "stage1_research": "pending",
    "stage2_synthesize": "pending",
    "stage3_product_plan": "pending"
  },
  "pipeline_status": "pending"
}
```

The `stage_status` and `pipeline_status` fields are updated as the pipeline progresses. After each stage transition, the master rewrites this file (atomic full-file write).

---

## Phase 1 — Stage 1: Research

The pipeline master now becomes the master agent for `!p_research`.

1. **Read `{tracker_root}/_commands/Synapse/p_research.md` end-to-end.** This is non-negotiable — the pipeline does NOT have its own watered-down research protocol. It executes `!p_research` verbatim with the prompt as the topic.
2. **Set the Stage 1 inputs:**
   - Topic = the prompt from `prompt.md` (verbatim)
   - Depth = `--research-depth` flag (default `deep`)
   - Scope = `--research-scope` flag (default `both`)
   - The `plan.json` `context` MUST include `pipeline_run_id` so the dashboard can be linked back to the pipeline.
3. **Allocate a fresh dashboard for Stage 1.** Auto-select per `dashboard_resolution.md` — do NOT reuse the chat's pre-assigned dashboard if one exists, since the pipeline may need three. Record the chosen dashboard ID in `_pipeline_runs/{id}/stage1_research.json`.
4. **Update pipeline status:** rewrite `_pipeline_runs/{id}/invocation.json` with `stage1_research: "planning"` and `pipeline_status: "in-progress"`. Append a status update to `prompt.md`'s current run entry.
5. **Run Phases 1-5 of `!p_research` exactly as documented.** That includes: planning, user approval gate, parallel wave dispatch, source weighting, synthesis-within-research-stage, final report. The user gets the standard `!p_research` user-approval prompt — DO NOT bypass it.
6. **On Stage 1 completion:**
   - Read the produced `documentation/research/{topic-slug}/_synthesis.md` frontmatter for key metrics.
   - Write `_pipeline_runs/{id}/stage1_research.json` with `dashboard_id`, `topic_slug`, `status: "completed"`, `claim_count`, `sources_fetched`, `sources_inaccessible`, `critical_missing_count`, `synthesis_path`.
   - Update the master invocation JSON: `stage1_research: "completed"`.
   - Update `prompt.md`'s run entry status table.
7. **On Stage 1 failure:**
   - Write `_pipeline_runs/{id}/stage1_research.json` with `status: "failed"` + failure reason.
   - Update master invocation JSON: `pipeline_status: "failed-at-stage-1"`.
   - Update `prompt.md`.
   - Surface the failure to the user with a recommendation (resume via `!p_track_resume {dashboard1}`, OR re-invoke `!p_product_research` with adjusted flags, OR debug Stage 1 manually).
   - **STOP. Do not proceed to Stage 2.**

### Stage 1 → Stage 2 transition gate

Before starting Stage 2, confirm:

- `documentation/research/{topic-slug}/_synthesis.md` exists and has a non-empty `claim_count` in its frontmatter
- `documentation/research/{topic-slug}/_index.md` exists
- `_pipeline_runs/{id}/stage1_research.json` `status: "completed"`

If any check fails, treat as Stage 1 failure (per step 7 above) — do NOT silently proceed to Stage 2 with a degraded research corpus.

---

## Phase 2 — Stage 2: Synthesize

The pipeline master now becomes the master agent for `!p_synthesize`.

1. **Read `{tracker_root}/_commands/Synapse/p_synthesize.md` end-to-end.** Same rule — execute that command's protocol verbatim.
2. **Determine the synthesize mode:**
   - If `--synthesize-mode` is explicitly set, use it.
   - Else (auto): check whether `documentation/research/synthesis/_master_synthesis.md` exists. If NOT → `--mode full`. If YES → `--mode incremental` (the new Stage 1 topic just landed; merge it into the existing layer).
3. **Set the Stage 2 inputs:**
   - Mode = chosen above
   - `--topics` = (only when `incremental`) explicitly include the new topic slug from Stage 1 plus any topics whose `_synthesis.md` is newer than the current synthesis layer's `generated_at`. The auto-discovery in `!p_synthesize` Phase 1 already does this, but the pipeline ensures the new topic is always included by passing it explicitly.
   - The `plan.json` `context` MUST include `pipeline_run_id`.
4. **Allocate a fresh dashboard for Stage 2.** Record in `_pipeline_runs/{id}/stage2_synthesize.json`.
5. **Update pipeline status:** `stage2_synthesize: "planning"`. Update `prompt.md`.
6. **Run all phases of `!p_synthesize` exactly as documented.** Including the user-approval gate after Phase 1. Including Wave 6 verification — the verifier is non-negotiable.
7. **On Stage 2 completion:**
   - Read `documentation/research/synthesis/_verification_report.md` for the certification status (`certified` | `passes-with-flags` | `failed`).
   - Read `documentation/research/synthesis/_master_synthesis.md` frontmatter for key metrics.
   - Write `_pipeline_runs/{id}/stage2_synthesize.json` with `dashboard_id`, `mode`, `status: "completed"`, `verification_status`, `cluster_count`, `topic_count`, `total_claims`, `recurring_issues`, `synthesis_path`.
   - Update master invocation JSON: `stage2_synthesize: "completed"`.
   - Update `prompt.md`.
8. **On Stage 2 failure:**
   - Same protocol as Stage 1 failure.
   - **STOP. Do not proceed to Stage 3.**

### Special case: Stage 2 verification flagged or failed

The `!p_synthesize` Wave 6 verifier may certify (`certified`), pass-with-flags, or fail outright. The pipeline master's response:

- **`certified`** — proceed normally to Stage 3.
- **`passes-with-flags`** — Stage 2 is considered complete; the flags are appended to `_open_issues.md` per the verifier's protocol. Proceed to Stage 3 BUT surface the flags in the unified pipeline report. The product-plan worker in Stage 3 will see `_open_issues.md` and engage with the flagged issues normally.
- **`failed`** — treat as Stage 2 failure. Do NOT proceed to Stage 3. Surface the verifier's remediation plan and recommend a `!p_synthesize --mode full` re-run before re-invoking `!p_product_research`.

---

## Phase 3 — Stage 3: Product Plan

The pipeline master now becomes the master agent for `!p_product_plan`.

1. **Read `{tracker_root}/_commands/Synapse/p_product_plan.md` end-to-end.**
2. **Set the Stage 3 inputs:**
   - `[focus]` = the original prompt from `prompt.md` (so plans are framed by the user's stated intent, not solely by what the synthesis emphasized)
   - `--breadth` = `--plan-breadth` flag (default `wide`)
   - `--top-n` = `--plan-top-n` flag (default 4)
   - The `plan.json` `context` MUST include `pipeline_run_id`.
3. **Allocate a fresh dashboard for Stage 3.** Record in `_pipeline_runs/{id}/stage3_product_plan.json`.
4. **Update pipeline status:** `stage3_product_plan: "planning"`. Update `prompt.md`.
5. **Run all phases of `!p_product_plan` exactly as documented.** Including the user-approval gate after lens & category selection. Including the mandatory single-worker Wave 6 final synthesis. Including the honesty enforcement rules — the pipeline does NOT relax those.
6. **On Stage 3 completion:**
   - Read `documentation/research/plans/final_plans.md` and `final_ratings.md` frontmatter for key metrics.
   - Write `_pipeline_runs/{id}/stage3_product_plan.json` with `dashboard_id`, `breadth`, `status: "completed"`, `lens_count`, `category_count`, `candidate_count`, `top_n_grades` (e.g., `["B+", "B", "B", "B-"]`), `recommendation_type` (specific-plan | hybrid | close-issues-first | do-nothing), `recommendation_summary`.
   - Update master invocation JSON: `stage3_product_plan: "completed"`, `pipeline_status: "completed"`.
   - Update `prompt.md`.
7. **On Stage 3 failure:**
   - Same protocol as Stage 1/2 failure.

---

## Phase 4 — Pipeline Report

After all three stages complete, the master writes `documentation/research/pipeline_report.md`. This is the unified deliverable that ties the pipeline together.

> **The pipeline master writes this report directly.** This is the ONE file the pipeline master writes outside of pipeline-state JSON — because it summarizes across the three stages and no underlying command produces it. (All three stages' own final reports exist as well; this one is the cross-stage view.)

### `pipeline_report.md` schema

```markdown
---
pipeline_run_id: pr-20260502-a3f7k2
generated_at: ISO-8601
prompt_first_line: "should we build a managed Postgres replication service..."
stages_completed: 3
pipeline_duration_minutes: 142
schema_version: 1
---

# Pipeline Report — `{pipeline_run_id}`

## Original Prompt
> {The full prompt, verbatim, in a blockquote.}

See [`prompt.md`](prompt.md) for the durable prompt log across all pipeline runs.

## TL;DR — The Recommendation
{1-2 sentences pulled from `plans/final_plans.md` "What I Would Do" section. The honest call.}

## Stage Summary

### Stage 1 — Research
- **Dashboard:** `{dashboard1}`
- **Output:** [`documentation/research/{topic-slug}/`]({topic-slug}/)
- **Synthesis (per-topic):** [`{topic-slug}/_synthesis.md`]({topic-slug}/_synthesis.md)
- **Stats:** {wave_count} waves, {worker_count} workers, {claim_count} claims, {sources_fetched} sources fetched, {sources_inaccessible} inaccessible ({critical_missing_count} critical)
- **Status:** completed
- **Note:** {one line — anything material from the Stage 1 final report}

### Stage 2 — Synthesize
- **Dashboard:** `{dashboard2}`
- **Output:** [`documentation/research/synthesis/`](synthesis/)
- **Master synthesis:** [`synthesis/_master_synthesis.md`](synthesis/_master_synthesis.md)
- **Open issues:** [`synthesis/_open_issues.md`](synthesis/_open_issues.md)
- **Verification:** [`synthesis/_verification_report.md`](synthesis/_verification_report.md) — {certified | passes-with-flags | failed}
- **Stats:** {cluster_count} clusters, {topic_count} topics merged, {total_claims} claims, {open_questions_count} open questions, {recurring_issues} recurring issues
- **Status:** completed
- **Note:** {one line — verifier's flags if any}

### Stage 3 — Product Plan
- **Dashboard:** `{dashboard3}`
- **Output:** [`documentation/research/plans/`](plans/)
- **Final plans (top-{N}):** [`plans/final_plans.md`](plans/final_plans.md)
- **Final ratings (all plans):** [`plans/final_ratings.md`](plans/final_ratings.md)
- **Evaluation framework:** [`plans/_evaluation_framework.md`](plans/_evaluation_framework.md)
- **Stats:** {lens_count} lenses, {category_count} categories, {candidate_count} plans evaluated, {top_n} in deep-dive
- **Top-{N} grades:** {comma-separated list, e.g., "B+, B, B, B-"}
- **Recommendation type:** {specific-plan | hybrid | close-issues-first | do-nothing}
- **Status:** completed

## The Recommendation in Detail
Pull the full "What I Would Do" recommendation from `plans/final_plans.md` here, with its citations and confidence band intact.

## Top Plans at a Glance
The side-by-side table from `plans/final_plans.md`, copied here for quick reference. Includes lens, grade, capital required, time-to-revenue, largest risk per plan.

## Convergent Risks
What ALL top-N plans share — load-bearing assumptions that, if wrong, invalidate every recommended direction. (From `plans/final_plans.md`.)

## Strategic Forks
Where the top-N plans DISAGREE — the choices the user must make. (From `plans/final_plans.md`.)

## What's Most Worth Doing Next

### If pursuing the recommended plan
Specific next actions — typically `!p_track {plan title}` to begin execution.

### Most valuable follow-up research
The single highest-impact `!p_research` follow-up that would, if completed, change the recommendation OR resolve the convergent risk that's most load-bearing. Pulled from:
- Critical missing sources in [`synthesis/_coverage.md`](synthesis/_coverage.md)
- Open issues in [`synthesis/_open_issues.md`](synthesis/_open_issues.md) the recommendation depends on resolving
- "What would change the recommendation" from [`plans/final_plans.md`](plans/final_plans.md)

### Honest concerns
Anything across the three stages that gives the pipeline master pause. Examples:
- "Stage 2 verifier flagged 3 cross-cluster contradictions still open — recommendation rests on one side"
- "{N} of the top-N plans were rated on `evidence_quality: thin` for {category} — that category may be wrong"
- "Stage 1 Critical missing sources include {source} — the recommendation would change if that source contradicted the synthesis"

## Provenance
- **Pipeline run ID:** `{pipeline_run_id}`
- **Invocation record:** [`_pipeline_runs/{id}/invocation.json`](_pipeline_runs/{id}/invocation.json)
- **Per-stage records:** [`_pipeline_runs/{id}/`](_pipeline_runs/{id}/)
- **Prompt log:** [`prompt.md`](prompt.md)
- **Stage 1 dashboard:** `{tracker_root}/dashboards/{dashboard1}/`
- **Stage 2 dashboard:** `{tracker_root}/dashboards/{dashboard2}/`
- **Stage 3 dashboard:** `{tracker_root}/dashboards/{dashboard3}/`

## Pipeline Cost Summary
- **Total workers across all stages:** {sum from all three metrics.json files}
- **Total wave count:** {sum}
- **Approximate token usage:** {sum if available}
- **Wall-clock duration:** {pipeline_duration_minutes} minutes (Stage 1: {x}m, Stage 2: {y}m, Stage 3: {z}m)
```

> **`pipeline_report.md` is regenerated on each pipeline run.** Older versions are preserved in git history (the file lives under the project repo). Per-run snapshots are also persisted in `_pipeline_runs/{id}/` for reference.

---

## Phase 5 — Final Pipeline Disclosure

After writing `pipeline_report.md`, the pipeline master prints a terminal summary:

```
Pipeline `pr-20260502-a3f7k2` completed.

  Stage 1 (research):     {dashboard1} → {topic-slug}/
  Stage 2 (synthesize):   {dashboard2} → synthesis/  ({verification_status})
  Stage 3 (product plan): {dashboard3} → plans/      (top-N: B+, B, B, B-)

  Recommendation: {1-line pull from final_plans.md}

  Read these in order:
    1. documentation/research/pipeline_report.md
    2. documentation/research/plans/final_plans.md
    3. documentation/research/plans/final_ratings.md
    4. documentation/research/synthesis/_master_synthesis.md (deeper context)
    5. documentation/research/synthesis/_open_issues.md (what's still unresolved)

  Most-valuable follow-up: {1-line — typically a specific !p_research or !p_track}
```

---

## Resume Behavior

`!p_product_research` is resumable at the pipeline level via inspection of `_pipeline_runs/{id}/invocation.json`. The flow:

1. **User invokes `!p_product_research --resume {pipeline_run_id}`** (alternate entry point — same command, alternate invocation pattern). The pipeline master:
2. **Reads `_pipeline_runs/{id}/invocation.json`** to determine the failed stage and the per-stage dashboard IDs.
3. **Resumes the failed stage** by following the underlying command's resume protocol:
   - Stage 1 partial → `!p_track_resume {dashboard1}` (which is the standard `!p_research` resume path since `!p_research` swarms ARE `!p_track`-class).
   - Stage 2 partial → `!p_track_resume {dashboard2}`.
   - Stage 3 partial → `!p_track_resume {dashboard3}`.
4. **Continues the pipeline** from the post-recovery state — runs subsequent stages normally.

> **The pipeline does NOT skip already-completed stages on resume.** If `_pipeline_runs/{id}/stage2_synthesize.json` shows `status: "completed"`, the resume goes directly to Stage 3 — completed stages are NOT re-run. This is what makes pipeline-level state worth tracking.

If the user wants to RE-RUN a completed stage with different parameters (e.g., re-run Stage 3 with `--plan-breadth exhaustive` after seeing the wide-breadth output), they should invoke `!p_product_plan` directly rather than re-running the pipeline. The pipeline is for end-to-end fresh runs and resume-from-failure; it is not a per-stage re-execution mechanism.

---

## Rules (Non-Negotiable)

### Pipeline Constraints

1. **Persist the prompt FIRST.** No swarm dispatch before `prompt.md` is written and `_pipeline_runs/{id}/invocation.json` exists.
2. **Three stages, in strict order.** No reordering. No skipping. No collapsing.
3. **Each stage uses its own dashboard.** No reuse across stages — three swarms, three dashboards.
4. **Each stage's user-approval gate fires.** The pipeline does not auto-approve any stage's plan. The user retains full visibility and veto at each transition.
5. **Stage failure halts the pipeline.** Surface the failure, write status, stop. No silent fall-through.

### Inheritance

6. **The pipeline inherits, never relaxes, each underlying command's protocol.** `!p_research`, `!p_synthesize`, `!p_product_plan` all run verbatim. If a constraint of any of those commands conflicts with what the pipeline wants, the underlying command wins.
7. **`pipeline_run_id` threads through every stage's `plan.json` `context` block.** This is how the dashboards are linked back to the pipeline.

### State

8. **Atomic full-file rewrites for `_pipeline_runs/{id}/invocation.json`.** Read → modify → write. Never partial JSON.
9. **`prompt.md` is append-only across runs.** A new pipeline run appends; never overwrites prior runs. The file is the durable prompt-history log.
10. **`_pipeline_runs/{id}/` is immutable per run.** A given pipeline_run_id's files are written once. Re-runs of `!p_product_research` produce a NEW run ID.

### Provenance & Audit

11. **Each stage's per-stage status JSON includes the dashboard ID.** This is the contract that lets a user trace from `pipeline_report.md` back to a specific dashboard, plan, log, and progress file.
12. **`pipeline_report.md` cites everything.** Every fact in the unified report is sourced — either from a specific stage output file (with relative path) OR from the per-stage status JSON. The pipeline master does NOT generate freestanding analysis; it summarizes and routes.

### Honesty

13. **The pipeline master surfaces all flags from all stages.** Stage 2 verifier flags, Stage 3 thin-evidence ratings, Stage 1 critical-missing-source impacts — all appear in the "Honest concerns" section of `pipeline_report.md`. Burying flags is forbidden.
14. **Pipeline-level recommendation echoes Stage 3's recommendation, never overrides it.** The pipeline master does NOT independently re-rate plans or substitute its own recommendation. It pulls Stage 3's "What I Would Do" verbatim, with citations.

### Synapse Integration

15. **Full dashboard tracking always at every stage.** Three swarms, three dashboards.
16. **Cycle protection.** If `!p_product_research` is invoked from a hook chain, propagate `--triggered-by` and `--depth` per the wiki cycle guard. Reject `depth > 2` (this command is itself a 3-stage pipeline; a hook-triggered pipeline-of-pipelines is not safe).
17. **Wiki crystallization is opt-in across all three stages.** The unified pipeline report SUGGESTS `!wiki ingest_batch documentation/research/synthesis/topics/` and `!wiki ingest_batch documentation/research/plans/` as next steps for durable wiki memory. The pipeline does not auto-fire these.

### Standard Inheritance from `!p_track`

18. **Live timestamps.** `date -u +"%Y-%m-%dT%H:%M:%SZ"` at every write moment.
19. **Final report is non-negotiable** at every stage AND at the pipeline level.

---

## Cost Discipline

The pipeline is the most expensive command in Synapse — it runs three full swarms back-to-back. Approximate worker counts:

| Configuration | Stage 1 | Stage 2 | Stage 3 | Total |
|---|---|---|---|---|
| All defaults (`deep` / auto / `wide` / 4) | ~30-40 workers | ~25-50 workers | ~100-110 workers | ~155-200 workers |
| Cost-conscious (`standard` / `incremental` / `standard` / 3) | ~15-20 workers | ~10-25 workers | ~50-65 workers | ~75-110 workers |
| Maximum (`exhaustive` / `full` / `exhaustive` / 5) | ~50-70 workers | ~40-80 workers | ~190-220 workers | ~280-370 workers |

The pipeline master MUST surface the projected total worker count BEFORE Stage 1 dispatch. The user has THREE approval gates (one per stage), so cost can also be controlled by aborting at a stage transition.

If a wiki budget is configured (`{wiki_root}/schema/current` → `budgets.per_swarm_max_tokens`), the pipeline master applies it at EACH stage independently — exceeding budget on any one stage halts that stage per the underlying command's budget protocol; the pipeline master treats the resulting halt as a stage failure for pipeline-status purposes.

---

## When to Use This vs the Underlying Commands

**Use `!p_product_research` when:**
- You're at the start of a research → decide cycle and want the full pipeline run with a single command
- You want pipeline-level state tracking and a unified report
- You want the prompt persisted as a first-class artifact

**Use the underlying commands directly when:**
- You're iterating on one stage (e.g., re-running just `!p_product_plan` with different lenses)
- You're adding new research to an existing synthesis layer (`!p_research X` then `!p_synthesize --mode incremental`)
- You're auditing a previous pipeline run and want to interrogate one stage in isolation

The pipeline does not replace the underlying commands; it composes them. They remain the canonical entry points for per-stage work.
