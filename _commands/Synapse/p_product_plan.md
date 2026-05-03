# `!p_product_plan [focus]`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are now the MASTER AGENT. You do NOT write plans yourself. You do NOT write evaluations yourself. You do NOT write the final ratings or comparisons. Workers produce ALL plan content. The master ONLY plans the swarm, dispatches workers, and routes outputs into `documentation/research/plans/`.**
>
> **2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing dashboard files. Workers MUST read `{tracker_root}/agent/instructions/tracker_worker_instructions.md`.**
>
> **3. You MUST use the dashboard. `plan.json`, `initialization.json`, `logs.json`, progress files. Product-plan swarms ALWAYS hit the full-tracking thresholds (many parallel workers, multi-wave) and are NEVER eligible for `!p` lightweight mode.**
>
> **4. The synthesis layer is your PRIMARY input.** Read `documentation/research/synthesis/_master_synthesis.md`, `_open_issues.md`, `topics/*.md`, `_claims.json`. Per-topic research under `documentation/research/{topic-slug}/` is the secondary pool — workers may dive into it when a plan needs detail the synthesis didn't preserve.
>
> **5. Honesty is the contract.** The user explicitly asked for honest ratings. Workers MUST surface fatal flaws, weak assumptions, and load-bearing unknowns. The final-ratings worker is forbidden from inflating scores or burying weaknesses to make a plan look better. A polite, padded rating is a failure mode.

**Purpose:** Generate many candidate product plans from a project's research synthesis, evaluate each across the dimensions that matter for this specific topic (the master picks categories — they are not a fixed list), then have a single integration worker produce a final ratings document and a final top-3-to-5 deep-dive comparison. The user's deliverables are `final_ratings.md` and `final_plans.md` — every other artifact exists to make those two trustworthy.

**Distinct from `!p_research`:** `!p_research` GATHERS information. `!p_synthesize` MERGES it. `!p_product_plan` USES the merged knowledge to PROPOSE actionable product directions and rank them. It is the output stage of the research pipeline.

**Distinct from `!plan` (project-internal):** `!plan` is a single-task implementation planner for code. `!p_product_plan` is strategic — it proposes WHAT to build (and whether to build it at all), not how to implement a known feature.

**Run order:** `!p_research` (many topics) → `!p_synthesize` (merge) → `!p_product_plan` (propose + rate). Optionally followed by `!p_track` to actually execute the chosen plan once selected.

**Syntax:** `!p_product_plan [--dashboard {id}] [--breadth {standard|wide|exhaustive}] [--lenses "lens1,lens2,..."] [--categories "cat1,cat2,..."] [--top-n N] [focus]`

- `[focus]` — (Optional) Free-text framing of WHAT the plans should be about. Empty = the master derives it from the synthesis. Provide a focus when the synthesis spans many topics and you want plans for one slice.
- `--breadth` — (Optional, default `wide`)
  - `standard`: ~6-9 plan candidates from the highest-signal lenses
  - `wide`: ~10-15 candidates spanning most lenses (default — more plans, more honest comparison)
  - `exhaustive`: ~16-24 candidates including adversarial / contrarian lenses
- `--lenses "..."` — (Optional) Override the master's lens selection. Comma-separated list (see **Strategic Lenses** below).
- `--categories "..."` — (Optional) Force specific evaluation categories. Default is **the master picks per topic** — only use this flag when you want to compel a specific dimension (e.g., `--categories "regulatory,defensibility,unit-economics"`).
- `--top-n N` — (Optional, default 4) How many plans the final deep-dive (`final_plans.md`) covers. The user asked for "top 3-5" — `top-n` lives in [3, 5] unless explicitly overridden.
- `--dashboard {id}` — (Optional) Force a specific dashboard.

**Examples:**
```
!p_product_plan
!p_product_plan --breadth exhaustive
!p_product_plan --focus "developer-tooling angle" --top-n 5
!p_product_plan --lenses "niche,bootstrap,disruptive,counter-position" --top-n 3
!p_product_plan --categories "market-fit,unit-economics,defensibility" replication strategies
```

---

## Output Structure

All plan artifacts live under the target project at `{project_root}/documentation/research/plans/`:

```
{project_root}/documentation/research/plans/
├── _index.md                            # Entry point. Read this first.
├── final_plans.md                       # USER DELIVERABLE — top-N plans deep-dive with strengths/weaknesses comparison.
├── final_ratings.md                     # USER DELIVERABLE — honest ratings of every candidate plan.
├── _evaluation_framework.md             # Which categories were chosen for THIS run, with reasoning. Lives next to ratings for context.
├── _comparison_matrix.md                # Cross-plan matrix (rows: plans, columns: categories, cells: scores + 1-line rationale).
├── _coverage.md                         # Which synthesis pages and per-topic research were read.
├── _attention.md                        # What the swarm couldn't auto-resolve.
├── _audit.jsonl                         # Append-only ops log.
├── candidates/
│   ├── {plan-slug}.md                   # One file per plan candidate. Frontmatter + body. Worker-written, immutable once written.
│   └── ...
├── evaluations/
│   ├── {plan-slug}/
│   │   ├── {category-slug}.md           # One file per (plan, category). Worker-written.
│   │   └── ...
│   └── ...
└── comparisons/
    ├── head-to-head.md                  # Pairwise comparison angle output.
    ├── risk-adjusted-ranking.md         # Risk-adjusted ranking angle.
    ├── capital-efficiency-ranking.md    # Capital efficiency angle.
    └── time-to-revenue-ranking.md       # TTR angle.
```

> **`final_plans.md` and `final_ratings.md` are the user's primary deliverables.** Every other file exists to support them. The audit trail and per-evaluation files exist so the user can challenge a rating and trace it back to its evidence.

---

## Phase 1 — Discovery, Lens Selection, & Plan Framing

Master only. No worker dispatch yet.

1. **Resolve roots.** `{project_root}` from `.synapse/project.json` (or `--project` flag). Compute `plans_root = {project_root}/documentation/research/plans/`. Create the directory tree (`candidates/`, `evaluations/`, `comparisons/`) if missing.
2. **Read master instructions** from `{tracker_root}/agent/instructions/tracker_master_instructions.md`.
3. **Read the synthesis layer (parallel reads in one tool message):**
   - `{project_root}/documentation/research/synthesis/_master_synthesis.md`
   - `{project_root}/documentation/research/synthesis/_open_issues.md`
   - `{project_root}/documentation/research/synthesis/_index.md`
   - `{project_root}/documentation/research/synthesis/_claims.json` (frontmatter + first 50 claims for context)
   - `{project_root}/documentation/research/synthesis/topics/_index.md` (the topical catalogue)
   - `{project_root}/CLAUDE.md` (project context)
   - `{project_root}/.synapse/project.json` (if it has business/product hints)
4. **Determine the planning frame.** Extract:
   - The PROBLEM SPACE the research illuminates (from `_master_synthesis.md` TL;DR + Project-Wide Patterns sections)
   - The KEY ENTITIES (from `_graph.json` if present, otherwise the synthesis Cluster Map)
   - The OPEN ISSUES that any plan must contend with (from `_open_issues.md` recurring + high-severity)
   - The CONSTRAINTS the project imposes (from CLAUDE.md — team size hints, stack hints, declared goals)
   - The USER'S FOCUS (from the optional `[focus]` argument)
5. **Pick strategic lenses for plan generation.** Each lens produces ONE plan candidate. The master selects from the menu below — picking lenses that make sense for THIS problem space, NOT all of them. Default selection logic:
   - Always include: at least one ambitious-scale lens, one MVP/cheap-to-validate lens, one niche-focused lens, one adversarial/counter-position lens.
   - Add lenses that match the topic — e.g., a B2B SaaS topic warrants `enterprise-direct`, `bottoms-up`, `platform-ecosystem`; a consumer-facing topic warrants `viral-growth`, `community-led`, `freemium`.
   - At `--breadth wide`, add 4-6 more from the menu. At `exhaustive`, add the contrarian / adversarial lenses (`steel-man-the-skeptic`, `counter-positioning-against-X`, `do-nothing`).
6. **Pick evaluation categories per topic.** This is the master's most consequential choice. The categories are NOT fixed — they emerge from what matters for this specific problem. Use the **Category Menu** below as a starting set, then PRUNE to the categories that actually discriminate among the candidate plans. A category that all plans score identically on is a category not worth running. Examples:
   - **Open-source dev tool topic:** `developer-experience`, `community-flywheel`, `monetization-path`, `competitive-landscape`, `time-to-self-sustaining`, `defensibility`, `team-fit`, `risk-of-being-cloned`.
   - **B2B SaaS topic:** `market-fit`, `ICP-clarity`, `GTM-feasibility`, `unit-economics`, `regulatory-load`, `competitive-moat`, `time-to-revenue`, `team-fit`, `capital-required`.
   - **Hardware-adjacent topic:** add `manufacturing-feasibility`, `inventory-risk`, `supply-chain`.
   - **Regulated-industry topic:** add `regulatory-burden`, `liability-exposure`, `compliance-cost-curve`.
   - Document the chosen categories AND the reasoning in `_evaluation_framework.md` so the user can challenge the framing.
7. **Plan the wave layout:**
   - **Wave 1 — Plan generation (parallel, one worker per lens).** Each worker takes one strategic lens and produces ONE plan candidate file. Workers do NOT see each other's plans — diversity comes from independent generation.
   - **Wave 2 — Multi-dimensional evaluation (parallel, fan-out).** For each plan, dispatch one worker per evaluation category. If `--breadth wide` produces 12 plans and the master picked 7 categories, this is 84 workers across saturated rounds. Workers write to `evaluations/{plan-slug}/{category-slug}.md`. None overlap.
   - **Wave 3 — Comparison angles (parallel, fan-in).** Workers compute different rankings: head-to-head pairwise, risk-adjusted, capital-efficiency, time-to-revenue. Each writes ONE file under `comparisons/`.
   - **Wave 4 — Adversarial review (parallel, one worker per top-N candidate).** Each worker is given ONE plan and tasked with attacking it — finding the strongest counter-arguments, the weakest assumptions, the failure-mode no other evaluator caught. This is a deliberate negation pass before final synthesis.
   - **Wave 5 — Comparison matrix assembly (single integration worker, Pattern B).** Reads all evaluations + adversarial reviews; writes `_comparison_matrix.md`.
   - **Wave 6 — Final synthesis (single integration worker, Pattern B, MANDATORY).** Reads everything; writes `final_ratings.md` and `final_plans.md`. The user's deliverables.
8. **Saturation rule:** Wave 2 will commonly exceed concurrency. Fire back-to-back dispatch rounds within Wave 2 until every (plan, category) pair has a worker. Do not lower the worker count to fit one round.
9. **Write `plan.json`** with the schema below. Estimate worker count (`lens_count + lens_count*category_count + 4 + top_n + 1 + 1`). Surface the projected count and rough cost class to the user.
10. **Write `initialization.json`** (after `plan.json` exists; the validate-plan-required hook enforces this). Initialize `logs.json`.
11. **Present the plan to the user and wait for approval** — chosen lenses with reasoning, chosen categories with reasoning, expected worker count, top-N target. **No dispatch before approval.**

> **Read `{tracker_root}/agent/_commands/p_track_planning.md` for the underlying planning protocol.**

### `plan.json` schema (product-plan-specific extensions)

```json
{
  "context": {
    "command": "p_product_plan",
    "focus": "<user-provided focus or master-derived problem statement>",
    "breadth": "wide",
    "top_n": 4,
    "synthesis_root": "{project_root}/documentation/research/synthesis",
    "plans_root": "{project_root}/documentation/research/plans",
    "frame": {
      "problem_space": "<2-3 sentence summary>",
      "key_entities": [...],
      "open_issues_to_address": ["ct-1", "oq-3", ...],
      "constraints": ["small team", "no enterprise sales motion yet", ...]
    },
    "chosen_lenses": [
      {"slug": "ambitious-scale", "rationale": "..."},
      {"slug": "niche-focus", "rationale": "..."},
      {"slug": "mvp-validate-cheap", "rationale": "..."},
      {"slug": "counter-position-against-incumbent", "rationale": "..."}
    ],
    "chosen_categories": [
      {"slug": "market-fit", "rationale": "..."},
      {"slug": "unit-economics", "rationale": "..."},
      ...
    ],
    "rejected_categories": [
      {"slug": "regulatory-burden", "rationale": "every plan scores roughly the same here — no discrimination"}
    ],
    "prompt": "<original user prompt>"
  },
  "tasks": [
    {
      "id": "w1-l1-ambitious-scale",
      "wave": 1,
      "title": "Generate ambitious-scale plan candidate",
      "lens": "ambitious-scale",
      "approach": "...",
      "files": ["documentation/research/plans/candidates/ambitious-scale-{topic}.md"]
    }
  ]
}
```

---

## Strategic Lenses (the menu)

The master picks a SUBSET. Each picked lens produces one plan candidate. Aim for diversity — don't pick three flavors of the same thing.

### Scale & Ambition Axis
- **`ambitious-scale`** — Maximize the addressable market. Build for the platform / category-king outcome.
- **`niche-focus`** — Pick the smallest defensible wedge. Dominate one segment before expanding.
- **`mvp-validate-cheap`** — Minimize cost-to-learn. The plan optimizes for the next decision, not the end state.

### Distribution / GTM Axis
- **`bottoms-up`** — Individual users adopt; org adoption follows.
- **`enterprise-direct`** — Top-down sales motion; long cycles, high ACV.
- **`viral-growth`** — Product mechanics that drive net-new acquisition.
- **`community-led`** — Users build community around the product; community drives growth.
- **`developer-tool-flywheel`** — Open-core or open-source distribution; monetize a slice.
- **`marketplace-two-sided`** — Two-sided liquidity play; both sides need a wedge.

### Positioning Axis
- **`disruptive-low-end`** — Cheaper / simpler than incumbents; eat from below.
- **`premium-high-margin`** — Charge a lot; serve fewer customers excellently.
- **`counter-position-against-X`** — Attack a specific incumbent's moat by inverting their model.
- **`platform-ecosystem`** — Be the substrate others build on.
- **`vertical-integration`** — Own the full stack; capture margin at every layer.
- **`horizontal-breadth`** — Cover many use-cases shallowly; integrate deeply later.

### Capital / Risk Axis
- **`bootstrap-capital-efficient`** — Stay default-alive; profitable early.
- **`venture-blitzscale`** — Raise large rounds; spend ahead of revenue.
- **`acqui-target`** — Build for an acquisition exit by a known buyer.

### AI-Era Lenses
- **`ai-native-rebuild`** — Re-imagine the category assuming AI is a primitive.
- **`ai-augment-existing`** — Wrap AI on top of existing workflows.
- **`agent-coordination`** — Build for the world where AI agents are the primary user.

### Adversarial / Contrarian (default at `--breadth exhaustive`)
- **`steel-man-the-skeptic`** — The plan that assumes the optimistic case is wrong. What's a plan that survives the worst-case interpretation of the research?
- **`do-nothing`** — Argue that no product should be built; the synthesis suggests this is a bad space. (Always include in `exhaustive` — sometimes the right answer.)
- **`adjacent-pivot`** — The research surfaced an adjacent opportunity bigger than the one being researched. Pursue that instead.

The master is encouraged to **invent additional lenses** when the topic suggests one not on this list (e.g., for a deep-tech topic, `research-grant-funded` may be apt). New lenses must be documented with a rationale in `_evaluation_framework.md`.

---

## Evaluation Category Menu

The master picks a SUBSET — categories that will actually discriminate among plans. Document choices and rejections in `_evaluation_framework.md`.

### Demand-Side
- **`market-fit`** — Does the plan address a real, urgent, frequent pain?
- **`ICP-clarity`** — Can you describe the target customer in one sentence?
- **`willingness-to-pay`** — Is there evidence anyone has paid for this kind of thing?
- **`market-size`** — How big is the addressable market under realistic assumptions?
- **`market-timing`** — Is now the right time? What changed that makes this possible?

### Supply-Side / Feasibility
- **`technical-feasibility`** — Can it actually be built with available tech?
- **`team-fit`** — Does the project's team have the skills/experience?
- **`capital-required`** — How much money does the plan need to reach the next milestone?
- **`time-to-MVP`** — Calendar time to first usable thing.
- **`time-to-revenue`** — Calendar time to first dollar.
- **`time-to-self-sustaining`** — Calendar time to default-alive.

### Defensibility
- **`competitive-moat`** — What stops a well-funded incumbent from copying this in 6 months?
- **`network-effects`** — Does value-per-user grow with user count?
- **`switching-costs`** — Does the customer get harder to leave over time?
- **`data-flywheel`** — Does usage produce data that improves the product?
- **`risk-of-being-cloned`** — How fast can a copy ship?

### Economics
- **`unit-economics`** — Per-customer revenue minus per-customer cost. Is it positive at scale?
- **`gross-margin-trajectory`** — Margin curve over time.
- **`distribution-cost`** — CAC vs LTV envelope.
- **`monetization-path`** — Concrete revenue model with assumptions exposed.

### Risk
- **`regulatory-burden`** — Compliance load.
- **`liability-exposure`** — Worst-case legal downside.
- **`platform-risk`** — Does the plan depend on a platform that could change rules?
- **`key-dependency-risk`** — What single vendor / model / partner could kill this?

### Strategic / Soft
- **`mission-alignment`** — Does this fit what the team actually wants to build?
- **`reversibility`** — How committed are you once you start?
- **`optionality-preserved`** — Does this plan close off other plans?
- **`learning-value`** — If it fails, do you learn something valuable?

The master MUST document a rejection rationale for excluded categories — not just to be transparent, but because if every plan scores the same on a category, that category is wasted budget.

---

## Phase 2 — Wave 1: Plan Generation

One worker per chosen lens. Each writes ONE candidate plan file. Workers do NOT see each other's plans — diversity is preserved by independent generation.

### Worker prompt requirements

Every Wave 1 worker prompt MUST include:

- **Identity:** task ID, wave 1, lens slug, agent label.
- **The frame** (from `plan.json` `context.frame`): problem space, key entities, open issues to address, project constraints.
- **The lens definition + rationale** (from `plan.json` `context.chosen_lenses` for this lens).
- **Inputs to read:**
  - `synthesis/_master_synthesis.md` (full)
  - `synthesis/_open_issues.md` (full — every plan must engage with the open issues)
  - `synthesis/topics/{relevant-pages}.md` (the master pre-selects which topical pages are most relevant for this lens)
  - Optional: `documentation/research/{topic-slug}/_synthesis.md` for any topic the worker decides needs deeper context
- **Output target:** exactly one file at `documentation/research/plans/candidates/{lens-slug}-{topic-slug}.md`.
- **Honesty mandate:** the worker MUST surface the plan's weakest assumption, the most likely failure mode, and the load-bearing unknown. A plan without a stated weakness is a failure of the worker.
- **Citations:** every claim grounding the plan in research must cite `[topic-slug:claim-id]` form so a reader can trace back.
- **Progress instructions:** standard `tracker_worker_instructions.md`.

### Plan candidate file schema

```yaml
---
plan_slug: niche-focus-replication-strategies
plan_id: <stable hash: sha256(lens_slug + frame_hash + author_summary)>
lens: niche-focus
title: <Short, specific title — not "the niche-focused plan", but "Postgres-only managed replication for fintech compliance teams">
generated_at: ISO-8601
agent: w1-l2
research_basis:
  synthesis_pages_read: ["replication-strategies", "regulatory-load"]
  per_topic_pages_read: ["postgres-logical-replication"]
  open_issues_engaged: ["ct-7", "oq-3"]
contains_required_sections: true
schema_version: 1
---

# {Title}

## One-Sentence Pitch
A specific, concrete sentence. Not "platform for X". A real product description.

## Problem Statement
The customer's pain in 3-5 sentences. Tied to specific evidence in the synthesis (cite `[topic-slug:claim-id]`).

## ICP — The Specific Customer
- **Who:** role + segment + company stage
- **What they currently do:** the workaround they have today
- **Trigger event:** what makes them want a new solution this week
- **Where you find them:** the channel where they congregate

## Solution
The product. Concrete. What it does, what it doesn't do, what's V1 vs roadmap.

## Why This Lens Fits
Why does this PLAN belong to THIS lens? (Helps the user spot mis-categorized plans.)

## Strategy Specifics
- **GTM motion:** the actual first-90-days customer-acquisition plan
- **Pricing:** specific numbers, not "freemium" — "$199/seat/month, free tier capped at X"
- **Positioning:** vs the named competitor or status quo
- **Wedge:** the smallest defensible thing this plan owns first

## How This Engages With Open Issues
For each `open_issues_engaged` ID, explain how the plan handles the contradiction or fills the open question — OR concedes that resolving the issue is a precondition for the plan.

## Required Resources
- **Team:** roles + headcount
- **Capital:** dollar amount to reach the next milestone, with the milestone defined
- **Calendar time:** to MVP, to first revenue, to default-alive
- **Critical dependencies:** the single vendor / model / partner the plan needs

## Risk & Failure Modes
The HONESTY section. The worker MUST include:
- **Weakest assumption:** the single belief most likely to be wrong
- **Most likely failure mode:** how this plan dies, specifically
- **Load-bearing unknown:** the one piece of evidence that, if found, would change the plan's viability
- **Specific kill criteria:** "we kill this plan if {observable} doesn't happen by {date}"
- **What the steel-manned critic would say:** the strongest argument against this plan

## Reasoning Trail
Why this plan, given the research? Walk the reader from synthesis evidence → strategic conclusion. This is the CITED reasoning the user can challenge.

## Confidence Components (worker writes components, NEVER a scalar)
- **evidence_strength:** {strong | moderate | thin} — how much research backs the plan vs how much is the worker filling in gaps
- **assumption_density:** {few | several | many} — how many independent assumptions chain together to make the plan work
- **precedent_count:** integer — how many real-world precedents the worker can cite for plans of this shape (with citations)
- **fatal_flaw_count:** integer — how many of the worker's own listed risks are existential to the plan (vs. survivable setbacks)
```

> **Plans are immutable once written.** Workers write each plan file once; rewrites happen only via re-run of the swarm. The IDs are stable hashes so re-runs of `Wave 6` can identify which plan they're rating.

---

## Phase 3 — Wave 2: Multi-Dimensional Evaluation

For each plan, dispatch ONE worker per chosen evaluation category. Massive fan-out. Workers do NOT see other category evaluations of the same plan, and they do NOT see other plans — they evaluate independently to avoid herding.

### Worker prompt requirements

Every Wave 2 worker prompt MUST include:

- **Identity:** task ID, wave 2, plan slug, category slug, agent label.
- **Inputs to read:**
  - The plan candidate file at `candidates/{plan-slug}.md` (full)
  - The synthesis pages relevant to this CATEGORY (e.g., for `regulatory-burden`, the synthesis page on regulation if one exists)
  - The `_open_issues.md` entries the plan claimed to engage with (worker checks the engagement is real, not lip-service)
- **Output target:** exactly one file at `evaluations/{plan-slug}/{category-slug}.md`.
- **Honesty mandate:** the worker MUST give a number AND a rationale. A worker who returns a vague qualitative summary without a numeric score is rejected. Inflation is a deviation.
- **Calibration anchors** (passed in the prompt): for THIS category, what does a 10/10 look like? What does a 1/10 look like? What does a 5/10 look like? The master constructs anchors from the synthesis. This grounds scores so they're comparable across plans.
- **Progress instructions:** standard.

### Evaluation file schema

```yaml
---
plan_slug: niche-focus-replication-strategies
plan_id: <plan_id from candidate file>
category: market-fit
generated_at: ISO-8601
agent: w2-p2-c1
score: 7                                 # Integer 1-10. NOT a confidence. A category score.
score_calibration_anchors:
  one: "<what 1/10 looks like for this category>"
  five: "<what 5/10 looks like>"
  ten: "<what 10/10 looks like>"
evidence_quality: {strong | moderate | thin}    # How much the synthesis can actually tell us about this category for this plan
schema_version: 1
---

# {Plan title} — {Category}

## Score: 7/10
**Rationale (3-5 sentences):**
The honest argument for this score. Includes the strongest reason FOR a higher score AND the strongest reason AGAINST it. Cite `[topic-slug:claim-id]`.

## Strengths
- Specific, evidence-backed strengths for THIS category. Each cited.

## Weaknesses
- Specific, evidence-backed weaknesses for THIS category. Each cited.
- The worker MUST include at least one weakness. A 10/10 with no weaknesses is a failure of the worker — every plan has weaknesses; their absence means the worker didn't look hard enough.

## What Would Change the Score
- Concrete, observable evidence that would push this score up or down. This is what the user uses to decide where to invest follow-up research.

## Confidence in This Score
- **`evidence_quality`:** strong | moderate | thin
- **What's missing:** the synthesis didn't cover X, Y; if those gaps were closed via `!p_research`, the score could change.
```

### Master loop for Wave 2

1. Compute the (plan, category) cross-product. Dispatch ALL workers. Saturate concurrency, fire back-to-back rounds.
2. As workers return, append `logs.json` entries. Cache scores keyed by `{plan_slug}/{category_slug}` for downstream waves.
3. Failure handling: a failed evaluation is recoverable — re-dispatch via `!retry`. If a category fails for ALL plans, surface in `_attention.md` (the category itself may be a poor fit for this swarm).

---

## Phase 4 — Wave 3: Comparison Angles

Multiple parallel workers, one per angle. Each writes ONE file under `comparisons/`. None overlap.

### Workers

- **Worker 3A — Head-to-head pairwise.** Reads all candidate plans + their evaluation files. Builds a pairwise matrix: for each plan pair (A, B), which is better in each category, by how much, and what the head-to-head verdict is. Writes `comparisons/head-to-head.md`.
- **Worker 3B — Risk-adjusted ranking.** Reads all evaluations. Weights each plan's expected-value scores by its `Risk` category outputs. Plans with high mean scores but high risk variance fall in the ranking; consistent-but-unspectacular plans rise. Writes `comparisons/risk-adjusted-ranking.md`.
- **Worker 3C — Capital-efficiency ranking.** Reads `capital-required` + `time-to-revenue` + revenue-side categories. Ranks plans by expected-return-per-dollar to next milestone. Writes `comparisons/capital-efficiency-ranking.md`.
- **Worker 3D — Time-to-revenue ranking.** Pure speed-to-first-dollar ranking. Writes `comparisons/time-to-revenue-ranking.md`.

The master may add additional comparison angles when the topic warrants — e.g., for regulated industries, a `regulatory-survival` ranking that excludes plans whose regulatory burden is structurally fatal.

### Master loop for Wave 3

Dispatch all comparison workers in parallel. Wave 3 cannot start until Wave 2 is fully complete (the rankings depend on the full evaluation matrix).

---

## Phase 5 — Wave 4: Adversarial Review of Top-N Candidates

The master computes a provisional top-N from Wave 3's average rankings. For each provisional-top plan, dispatch ONE adversarial worker.

### Worker prompt

The adversarial worker is told to ATTACK the plan. Specifically:

- Read the plan candidate file + ALL its evaluation files + ALL Wave 3 comparisons.
- Write the strongest case AGAINST the plan that the worker can construct, citing the synthesis and the evaluations.
- Surface assumptions the Wave 1 worker didn't list as "weakest" but should have.
- Identify failure modes the Wave 2 evaluators missed because they evaluated in isolation.
- Propose the ONE experiment / observation that would most efficiently kill the plan if it's wrong.

### Output

Each adversarial worker writes `evaluations/{plan-slug}/_adversarial.md`. This becomes part of the plan's evidence base for Wave 6.

> **Adversarial review is mandatory, not optional.** A top-N candidate without an adversarial review is incomplete. It is the deliberate negation pass before the user sees the final ratings.

---

## Phase 6 — Wave 5: Comparison Matrix (single integration worker, Pattern B)

ONE worker reads all evaluations + all Wave 3 comparisons + all Wave 4 adversarial reviews and writes `_comparison_matrix.md`.

### Output schema (`_comparison_matrix.md`)

```markdown
---
generated_at: ISO-8601
plan_count: 12
category_count: 7
schema_version: 1
---

# Comparison Matrix

## Score Matrix

| Plan | market-fit | unit-economics | competitive-moat | time-to-revenue | team-fit | regulatory-burden | learning-value | Mean |
|---|---|---|---|---|---|---|---|---|
| niche-focus-replication-strategies | 7 | 8 | 6 | 7 | 8 | 6 | 7 | 7.0 |
| ... | | | | | | | | |

## Mean by Plan
Sorted descending. Plans within 0.5 of each other are within evaluator noise — do NOT treat small mean differences as meaningful.

## Ranking Disagreement Map
Where do Wave 3 rankings DISAGREE? A plan that's #1 by capital-efficiency but #6 by risk-adjusted is interesting — surface those disagreements explicitly.

## Coverage Notes
For each (plan, category), the `evidence_quality`. Plans with many `thin` cells are scored on weaker evidence; the mean is less trustworthy.
```

---

## Phase 7 — Wave 6: Final Synthesis (single integration worker, Pattern B, MANDATORY)

The user's deliverables. ONE worker writes both `final_ratings.md` and `final_plans.md`.

### Worker prompt

The Wave 6 worker is given:

- All candidate plans (`candidates/*.md`)
- All evaluations (`evaluations/{plan-slug}/{category}.md`)
- All adversarial reviews (`evaluations/{plan-slug}/_adversarial.md`)
- All Wave 3 comparisons (`comparisons/*.md`)
- The comparison matrix (`_comparison_matrix.md`)
- The frame from `plan.json`
- The user's `--top-n` setting (default 4)

### Output 1: `final_ratings.md` — honest ratings of EVERY plan

```markdown
---
generated_at: ISO-8601
plan_count: 12
top_n: 4
schema_version: 1
---

# Final Ratings — All Plans

This document rates EVERY candidate plan, not just the top-N. The intent is honest: a plan that didn't make the top-N is not necessarily bad — it may be excellent for a different goal — but it's also not in the top-N for a specific, statable reason.

**Rating scale:**
- **A** (8.5+) — strong recommendation; the evaluators converged on this being viable
- **B** (7.0-8.4) — credible plan with specific weaknesses; pursuing requires closing the gaps
- **C** (5.5-6.9) — plausible but unproven; significant unknowns or weaknesses
- **D** (4.0-5.4) — flawed in load-bearing ways; would need substantial rework
- **F** (<4.0) — should not be pursued as currently described

The rating is computed from the comparison matrix mean BUT is adjusted by:
- Adversarial review severity (a plan with a fatal flaw in adversarial review caps at C)
- Evidence quality (plans rated mostly on `thin` evidence have their grade flagged with a `?`)
- Open-issue engagement (plans that didn't honestly engage with `_open_issues.md` are penalized)

## Plan: niche-focus-replication-strategies — B+ (7.4)
**One-line take:** {The honest one-line take}

**Strengths:**
- Strongest category: `team-fit` (8) — {1-line evidence}
- Honest evidence backing in `market-fit` (7) — {1-line evidence}

**Weaknesses:**
- Weakest category: `competitive-moat` (6) — {1-line evidence + adversarial-review echo}
- Load-bearing unknown: {what we don't know that matters most}

**Adversarial verdict:** {The strongest case against, in 2 sentences}

**Why not A:** {The specific gap between this and an A grade}
**Why not C:** {The specific reasons it cleared the C bar}

---

## Plan: ... — B (...)
[same structure]

---

## Plans Below C
For plans rated D or F, give the rating and a 2-sentence honest assessment of why. Do not pad. The user asked for honesty.

## Honest Disclaimers
- N evaluations were on `thin` evidence — those scores are flagged with `?` in the matrix and should be treated as provisional.
- The frame the master chose was {summary}. A different frame could produce different ratings.
- The chosen evaluation categories are listed in `_evaluation_framework.md`. A different category set would produce different ratings.
```

### Output 2: `final_plans.md` — top-N deep-dive comparison

```markdown
---
generated_at: ISO-8601
top_n: 4
schema_version: 1
---

# Top {N} Plans — Deep-Dive Comparison

## Executive Summary
3-5 sentences: what these {N} plans collectively suggest about the right direction, and where they DISAGREE.

## Side-by-Side Comparison

| | Plan A | Plan B | Plan C | Plan D |
|---|---|---|---|---|
| Lens | niche-focus | mvp-validate-cheap | counter-position | bottoms-up |
| Final grade | B+ | B | B | B- |
| Best for | {1-line scenario} | {1-line scenario} | {1-line scenario} | {1-line scenario} |
| Capital required | $X | $Y | $Z | $W |
| Time to revenue | N months | M months | ... | ... |
| Largest risk | {1-line} | {1-line} | {1-line} | {1-line} |

## Plan-by-Plan Deep Dive

### 1. {Plan title} — {grade}
**Why this is in the top-N:** ...

**Strengths the evaluators converged on:**
- ...

**Weaknesses the evaluators converged on:**
- ...

**The adversarial case (the strongest argument against):**
{from adversarial review}

**What would push this from B+ to A:**
- Specific, observable evidence the plan would need

**Honest take:**
{The worker's calibrated assessment. Not promotional. Not falsely modest.}

### 2. ...

## Where the Top-N Disagree
Where the top plans CONTRADICT each other on strategy. This is the most useful section for the user — it surfaces the strategic forks they have to choose between.

- **Plan A vs Plan B on PRICING:** Plan A assumes premium pricing; Plan B assumes freemium. The synthesis evidence cited by both points different ways. The user must decide which side of `[open-issues:ct-12]` they believe.
- ...

## What ALL Top-N Plans Have in Common
The convergent assumptions. If these are wrong, ALL the top plans are wrong simultaneously. Surface them so the user knows where the correlated risk is.

## What I Would Do (Worker's Synthesis Recommendation)
The worker is REQUIRED to commit to a recommendation here. Not a wishy-washy "it depends." A specific, defended recommendation with the trade-off the user is making by following it. The recommendation can be:
- "Plan A — pursue as described"
- "Plan A core, with Plan C's GTM motion grafted on"
- "None of the top-N as-is — close `[open-issues:oq-7]` first via `!p_research X`, then re-run `!p_product_plan`"
- "Do nothing — the synthesis evidence does not support entering this market"

The recommendation must be DEFENDED in 5-10 sentences citing the comparison matrix and adversarial reviews.

## Confidence in This Recommendation
- **`evidence_quality`:** strong | moderate | thin
- **What would change the recommendation:** the specific evidence that, if found, would flip the call
- **Reversibility:** how committed is the user once they pick? (low reversibility = more reason to close `[open-issues]` before deciding)
```

> **The Wave 6 worker is FORBIDDEN from inflating ratings or hedging the recommendation into uselessness.** The user explicitly asked for honest ratings. A polite "they're all great" output is a failure of the worker. The recommendation must commit.

---

## Phase 8 — Final Report

Master compiles the standard `!p_track` final report (NON-NEGOTIABLE):

1. Read all worker progress files, all candidates, all evaluations, all comparisons, the matrix, `final_ratings.md`, `final_plans.md`.
2. Compile:
   - **Summary:** lenses chosen, categories chosen (with rejections), candidate count, evaluation count, top-N call.
   - **Files produced:** every file under `plans/`.
   - **Top-N grades:** the headline ratings.
   - **Convergent risks:** what every top plan has in common (load-bearing assumptions).
   - **Strategic forks:** where the top plans disagree.
   - **Honesty audit:** how many plans have `evidence_quality: thin` in 2+ categories (flag for follow-up `!p_research`); whether the Wave 6 worker committed to a recommendation; whether any plan was suspiciously inflated.
   - **Concrete next steps:**
     - If the recommendation is a specific plan: `!p_track {plan title}` to begin execution.
     - If the recommendation is "close open issues first": named `!p_research` follow-ups.
     - If the recommendation is "do nothing": explicit acknowledgment + alternative use of resources.
3. Write `metrics.json` with product-plan-specific fields: `lens_count`, `category_count`, `category_rejections`, `candidate_count`, `evaluation_count`, `top_n`, `mean_score_top_n`, `evidence_thin_evaluation_count`, `recommendation_type`.
4. Save to history per standard `!p_track` completion.

> **Read `{tracker_root}/agent/_commands/p_track_completion.md` for the underlying completion protocol.**

---

## Rules (Non-Negotiable)

### Master Constraints

1. **Master never writes plan content.** No candidate plans, no evaluations, no comparisons, no final ratings. ALL output prose comes from workers.
2. **`plan.json` precedes `initialization.json`.** Same `validate-plan-required.sh` enforcement as `!p_track`, `!p_research`, `!p_synthesize`.
3. **Lens & category choices are documented and challengable.** `_evaluation_framework.md` is mandatory and must include both chosen and rejected categories with reasoning. The user can challenge the framing — that's the whole point.
4. **Saturation in Waves 1-4.** Lens count, plan-times-category count, comparison count, top-N adversarial count — all dispatched in parallel with back-to-back rounds when concurrency-capped.
5. **Pattern B for Waves 5 and 6.** Exactly one writer:
   - Wave 5 writes `_comparison_matrix.md`
   - Wave 6 writes `final_ratings.md` AND `final_plans.md`

### Quality Rules

6. **Honesty over politeness.** Workers MUST surface weaknesses. A plan candidate without a stated weakest assumption, an evaluation without a weakness section, a final rating that grades everything B+ — all are failures.
7. **Citations are mandatory.** Every plan claim, every evaluation rationale, every final-synthesis judgment cites `[topic-slug:claim-id]` from the synthesis (or `[synthesis:section]` for synthesis-derived claims). Uncited assertions are deviations.
8. **Evidence quality is surfaced, not buried.** Every score has an `evidence_quality` field. Final ratings flag `thin`-evidence ratings with `?`. The user is told when a rating is provisional.
9. **Confidence components, not scalars.** Same rule from `!p_research` and `!p_synthesize`: workers populate components; the rule-based composer produces bands. Numeric category scores ARE allowed (1-10) because they have explicit calibration anchors — but they are scores, not confidence claims.
10. **Stable plan IDs.** `sha256(lens_slug + frame_hash + author_summary)`. Re-runs of `!p_product_plan` against the same synthesis produce the same plan IDs for the same lenses, so Wave 6 ratings are comparable across runs.
11. **No emojis** unless the user opts in or the project's CLAUDE.md does.

### Anti-Inflation Rules

12. **A 10/10 score requires evidence the worker can cite for "what 10/10 looks like" in this category.** Otherwise the score is capped at 8.
13. **A category where every plan scores within 1 point of the mean is flagged in `_evaluation_framework.md` as low-discrimination — the user is told the category was kept but didn't help separate plans.**
14. **The Wave 6 worker MUST commit to a recommendation.** A non-committal final document is rejected. Acceptable recommendations include "do nothing" and "close open issues first" — but they must be specific and defended.
15. **Adversarial review must produce a CRITIQUE, not a balanced summary.** A Wave 4 worker who hedges is a failure. The point of adversarial review is to write the strongest possible case AGAINST the plan.

### Provenance & Audit

16. **Audit every mutation.** Every file write appends to `_audit.jsonl` with `op`, `synthesis_run_id`, `actor`, `target`.
17. **Plans and evaluations are immutable once written.** Re-runs replace files; no in-place editing. The audit log records the version history.
18. **Coverage is honest.** `_coverage.md` lists EVERY synthesis page read AND every page that was relevant but NOT read (with reason). If the master skipped a synthesis page that should have been input, the user gets to challenge it.

### Synapse Integration

19. **Full dashboard tracking always.** Never `!p` lightweight.
20. **Cycle protection.** Reject `depth > 3` if invoked from a hook chain.
21. **Resume-safe.** Like `!p_research` and `!p_synthesize`, resumable via `!p_track_resume`. Plan files with valid frontmatter are considered complete on resume; missing or malformed plan files are re-dispatched.
22. **Wiki crystallization is opt-in.** The final report SUGGESTS `!wiki ingest_batch documentation/research/plans/` if the user wants the chosen plan and its reasoning to land in durable wiki memory.

### Dispatch & Tracking (inherited from `!p_track`)

23. **Dispatch FIRST, update tracker AFTER.**
24. **Atomic writes only.** Read → modify → write full file.
25. **Live timestamps.** Always `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
26. **Final report is non-negotiable.**

---

## Cost Discipline

`!p_product_plan` is the most worker-heavy command in the research pipeline because of the (lens × category) cross-product in Wave 2:

- `--breadth standard` (~7 lenses × ~6 categories = ~42 evaluators + ~7 plans + ~4 comparisons + ~4 adversarial + 2 integration ≈ 60 workers)
- `--breadth wide` (~12 lenses × ~7 categories = ~84 evaluators + ~12 plans + ~4 comparisons + ~4 adversarial + 2 integration ≈ 105 workers)
- `--breadth exhaustive` (~20 lenses × ~8 categories = ~160 evaluators + ~20 plans + ~5 comparisons + ~5 adversarial + 2 integration ≈ 190 workers)

The master MUST surface the projected worker count BEFORE dispatch and wait for explicit user approval. Same gating as `!p_research --depth deep`.

If a wiki budget is configured (`{wiki_root}/schema/current` → `budgets.per_swarm_max_tokens`), respect it. Append a one-line entry to `_attention.md` if dispatch would exceed it; await user override.

---

## When to Re-Run

`!p_product_plan` is meant to be re-runnable as the synthesis evolves:

- After new `!p_research` topics close `_open_issues` that were load-bearing on the previous run's recommendation, re-run to see if the call changes.
- After the user pursues a candidate plan and learns something material (a customer interview, an early test), re-run with the new evidence reflected in the synthesis.
- After significant time passes (the market moved, a competitor shipped), re-run to check whether the recommendation still holds.

Each re-run produces a new `final_plans.md` and `final_ratings.md` (overwriting the previous), but the audit log preserves the history of what was recommended when. "What did we think 6 months ago?" is a `git log -- documentation/research/plans/final_plans.md` away.
