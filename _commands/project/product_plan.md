# `!product_plan {prompt}` — Deep Product Spec Sheet Generator

## Purpose

Take a **loose product spec prompt** and produce a single, exhaustive **`{product_name}_spec_sheet.md`** that captures every dimension a builder needs to make a confident, informed decision about how to construct the product. The spec sheet is the user's deliverable. It is built from parallel deep research, then synthesized into one document.

This command is **not a swarm with multiple plan alternatives** (that's `!p_product_plan` / `!q_product_plan`). It is **not a code-implementation plan** (that's `!plan`). It is the single, authoritative "if we built this, here is exactly what we'd build, on what stack, why, with what feasibility, against what market, with what risks" document — produced from scratch from the user's loose prompt.

---

## Usage

```
!product_plan {loose product description}
```

**Examples:**
```
!product_plan an AI-powered tool that helps mortgage brokers prep loan packages from client documents
!product_plan a Chrome extension that turns my Twitter feed into a calm, ordered daily digest
!product_plan a SaaS for indie hardware sellers to automate FBA reorder forecasting
!product_plan a local-first markdown notes app with end-to-end encrypted sync
```

The prompt should be a concept, problem statement, or rough product idea. Detail level can vary — the command's job is to take whatever the user gives it and fill in the gaps with research.

**Optional flags:**
- `--depth {standard|deep|exhaustive}` — Research depth (default `deep`)
  - `standard`: ~6-8 parallel research dimensions
  - `deep`: ~10-14 dimensions (default)
  - `exhaustive`: ~16-22 dimensions including adversarial, regulatory, and adjacent-market angles
- `--name "{product name}"` — Override the inferred product name (used in the output filename)
- `--out {path}` — Override the output path (default `{project_root}/{product_name}_spec_sheet.md`)
- `--no-web` — Skip web research (use only local context). Faster but the market/competitor sections will be thinner.
- `--inline-citations` — Embed inline citations in the spec sheet (default: a single References section at the end)

---

## Output

A single markdown file at:

```
{project_root}/{product_name}_spec_sheet.md
```

`{product_name}` is **slugified** (lowercase, hyphenated, ASCII-only). If the user did not name the product in their prompt, the master infers a working name from the concept and surfaces it for confirmation before writing the file.

The spec sheet is **comprehensive by design** — typical length is 4,000-12,000 words. Brevity is not a goal here; **decision-ready depth** is the goal.

---

## Execution Flow

### Phase 1 — Prompt Parsing & Research Planning (Master Agent, No Dispatch Yet)

1. **Parse the loose prompt** to extract:
   - **Working product name** (slugified for the filename). If the user named the product, use that. Otherwise, infer 2-3 candidate names and pick the most descriptive.
   - **Concept summary** in 1-2 sentences as the master understands it.
   - **Implicit assumptions** the prompt makes (target user, platform, business model). Surface these explicitly — many will be wrong and need research to confirm or revise.
   - **Open ambiguities** the master cannot resolve from the prompt alone. These become research questions.

2. **Read project context** (parallel reads in one tool message):
   - `{project_root}/CLAUDE.md` — project conventions, stack hints, team context
   - `{project_root}/.synapse/project.json` — project metadata (if present)
   - `{project_root}/README.md` — existing project framing (if present)
   - `{project_root}/.synapse/knowledge/` — PKI knowledge if available (gotchas, patterns)
   - The current directory listing (`Glob "*"` at `{project_root}`) to understand what already exists

   The project context informs **constraints**: if the project already has a stack, team size, or stated mission, the spec sheet must align rather than recommend a green-field choice.

3. **Plan the research dimensions.** The master picks a SUBSET of the **Research Dimension Menu** below. Default selection logic:
   - **Always include:** Problem & ICP, Market & Competition, Technical Architecture, Feasibility & Risk, Implementation Roadmap, Build Strategy, Success Metrics.
   - **Add based on signal in the prompt:** Monetization (if commercial), Regulatory (if finance/health/legal/data), UX/UI (if consumer-facing), Distribution/GTM (if commercial), Data Model & Privacy (if data-heavy).
   - At `--depth deep` (default), pick 10-14 dimensions.
   - At `--depth exhaustive`, also pick contrarian dimensions: Steel-Man-the-Skeptic, Adjacent-Pivot, Build-vs-Buy adversarial.

4. **Surface the plan to the user before dispatch.** Output:
   - Working product name (with confirmation prompt if inferred)
   - Concept summary as understood
   - Implicit assumptions surfaced
   - Research dimensions the master plans to dispatch
   - Estimated worker count
   - Estimated cost class (light / medium / heavy)
   - Output file path

5. **Wait for user approval.** No research dispatch before approval. The user may:
   - Approve as-is → proceed to Phase 2
   - Adjust dimensions → master revises and re-presents
   - Adjust the product name or output path → master revises
   - Abort → master stops cleanly with no artifacts written

### Phase 2 — Parallel Deep Research (Worker Dispatch)

Dispatch ALL research dimensions in parallel using the `Agent` tool with `subagent_type: "general-purpose"`. Each dimension is **one independent research worker** with WebSearch + WebFetch + read tools.

#### Worker Prompt Template (every research worker)

Every research worker prompt MUST include:

- **Identity:** dimension name, dimension slug, the working product name, the master's concept summary.
- **The full original user prompt** (verbatim — the worker may extract nuance the master missed).
- **The implicit assumptions the master surfaced** (the worker is told to verify or refute each).
- **Project constraints** (extracted from CLAUDE.md / project.json — stack, team size, declared goals).
- **The specific research questions for this dimension** (see Research Dimension Menu below).
- **Honesty mandate:** the worker MUST surface uncertainty, weak evidence, and contradictions in what they find. Worker is forbidden from inventing market sizes, competitor names, or technical claims they cannot ground.
- **Citation requirement:** every external claim cites a URL or source. Local-context claims cite the file path.
- **Return format:** structured markdown with the sections specified by the dimension's schema (see menu).
- **Length budget:** 800-2,500 words per dimension. Worker should be thorough but not pad.

Workers operate independently — they do NOT see each other's output. Diversity comes from the master picking dimensions that don't overlap.

#### Saturation

If the dimension count exceeds the available concurrency, fire **back-to-back dispatch rounds**. Do not lower the dimension count to fit one round.

### Phase 3 — Synthesis (Master Aggregates)

The master is the synthesizer. After all research workers return:

1. **Read every worker return.** Cache the full text indexed by dimension slug.
2. **Identify cross-cutting patterns.** Look for:
   - **Convergent claims:** what multiple dimensions agree on (high confidence).
   - **Contradictory claims:** where dimensions disagree (must be flagged in the spec sheet's "Open Questions" section).
   - **Load-bearing assumptions:** facts the spec sheet's recommendation depends on. These must be surfaced explicitly.
   - **Red flags:** any dimension that returned "this is not feasible" or "the market doesn't exist" — these are existential and must be elevated to a "Do Not Build" recommendation if severe.
3. **Resolve the working product name.** If research surfaced a better name (e.g., trademark conflict on the inferred name), update it. Confirm with user if the name changes from what was approved in Phase 1.
4. **Write the spec sheet** to `{project_root}/{product_name}_spec_sheet.md` using the schema below.
5. **Surface the spec sheet's headline judgments** in the master's final message: feasibility verdict, top 3 risks, recommended next step.

### Phase 4 — Final Report

The master's final chat message includes:
- Spec sheet file path (clickable for the user)
- 5-line executive summary (concept, feasibility verdict, top risk, top opportunity, recommended next step)
- List of dimensions researched
- List of any "Open Questions" the spec sheet flagged that warrant `!p_research` follow-up
- If the verdict is "Do Not Build" or "Pivot", a clear surfaced recommendation rather than burying it

---

## Research Dimension Menu

The master picks a SUBSET. Each picked dimension produces ONE worker that returns a structured research report. The master then weaves these into the spec sheet.

### 1. Problem & ICP (Almost Always Picked)
- What is the precise pain the product addresses?
- Who specifically experiences it (role, segment, life stage, company stage)?
- What workaround do they use today?
- What trigger event makes them want a new solution this week?
- How urgent and frequent is the pain (1x/year vs daily)?
- How willing are they to pay (evidence: existing products in the space + their pricing)?

### 2. Market & Competition (Almost Always Picked)
- Direct competitors: name them, summarize their positioning, pricing, traction signals, weaknesses.
- Indirect competitors / substitutes (including "do nothing" / spreadsheets / manual workflows).
- Market size estimate (top-down + bottom-up, with assumptions exposed).
- Market trends and timing (what changed recently that makes this possible / urgent).
- Share-of-voice signals (search trends, communities discussing the problem).

### 3. Technical Architecture (Almost Always Picked)
- Recommended tech stack (frontend, backend, database, infra, AI/ML if relevant) with justifications tied to project constraints.
- High-level system architecture (described as text + ASCII diagram).
- Data model: core entities, relationships, lifecycle.
- API surface: endpoints / RPCs / events the product exposes or consumes.
- Third-party integrations and the risks they introduce.
- Performance, scale, and reliability targets.

### 4. Feasibility & Risk (Almost Always Picked)
- Technical risks (unproven tech, scaling unknowns, dependencies).
- Market risks (no demand, demand evaporates, incumbent reaction).
- Operational risks (team skill gaps, compliance load, support burden).
- Existential risks (regulatory ban, platform policy change, key vendor lock-in).
- Mitigations for each.

### 5. Implementation Roadmap (Almost Always Picked)
- Phase 0 (validation): what to test before building, with kill criteria.
- Phase 1 (MVP): minimum scope to put in front of real users + timeline estimate.
- Phase 2 (V1): post-MVP feature set + timeline.
- Phase 3+ (Vision): the longer arc.
- Decision gates between phases (what evidence advances the project).

### 6. Build Strategy (Almost Always Picked)
- Team composition: roles, headcount, sequencing (who do you hire first?).
- Build vs buy: for each significant component, recommend build, buy, or open-source.
- Tooling: dev environment, CI/CD, monitoring, analytics.
- Estimated cost-to-MVP in dollars and calendar time.

### 7. Success Metrics (Almost Always Picked)
- North-star metric: the one number that defines success.
- Leading indicators: weekly/daily metrics that predict the north star.
- Validation experiments: small, time-boxed tests with kill criteria.

### 8. Functional Requirements (Pick if the prompt is feature-light)
- Core feature list (MVP): every feature the V1 must have, with acceptance criteria.
- Extended feature list (V1+): features deferred but mapped.
- Non-functional requirements: performance, security, accessibility, internationalization.
- User stories / use-case walkthroughs for each major feature.

### 9. UX / UI Design Direction (Pick if consumer-facing or design-critical)
- Design principles tailored to the ICP.
- Primary user flows (described as step-by-step + state transitions).
- Page / screen inventory.
- Component inventory and design-system fit.
- Inspirations and anti-patterns (named, with reasoning).

### 10. Monetization & Pricing (Pick if commercial)
- Pricing model (subscription, usage, freemium, one-time, etc.) with justification.
- Specific price points (with market evidence).
- Free tier limits and conversion mechanics.
- Unit economics: per-customer revenue, cost-to-serve, gross margin trajectory.
- Upsell / expansion motion.

### 11. Distribution & GTM (Pick if commercial)
- First 100 customers: where to find them and how to reach them.
- Channels: which work for this ICP, which don't, with reasoning.
- Content / community strategy.
- Partnership opportunities.
- CAC envelope under realistic assumptions.

### 12. Data Model & Privacy (Pick if data-heavy or regulated)
- What data is stored, where, and for how long.
- PII / sensitive data handling.
- Compliance requirements (GDPR, HIPAA, SOC2, etc.) — name the ones that apply.
- Data flywheel potential (does usage produce data that improves the product?).

### 13. Regulatory & Legal (Pick if finance / health / legal / data)
- Regulations that apply (named, with citations).
- Compliance load (cost, calendar time, ongoing burden).
- Liability exposure and insurance considerations.
- Terms of service and data processing posture.

### 14. AI / ML Considerations (Pick if the product uses AI)
- Models recommended (with cost / latency / quality tradeoffs).
- Prompt / system design strategy.
- Eval strategy (how do you know the AI is good enough?).
- Hallucination / failure-mode handling.
- Cost-per-request envelope.

### 15. Defensibility & Moat (Pick at `--depth deep` and above)
- What stops a well-funded incumbent from cloning this in 6 months?
- Network effects, switching costs, data flywheels, brand, distribution lock-in — which (if any) apply?
- Time-to-clone estimate.

### 16. Adjacent Markets & Pivot Lanes (Pick at `--depth exhaustive`)
- If the primary product fails, what pivot is closest (uses the same tech, ICP, or distribution)?
- What adjacent markets does the same tech unlock?

### 17. Steel-Man-the-Skeptic (Pick at `--depth exhaustive`)
- The strongest possible argument that this product should NOT be built.
- The single fact that, if found, would kill the project.
- A "Do Nothing" comparison: how much worse off is the user if the product doesn't exist?

### 18. Build-vs-Buy Adversarial (Pick at `--depth exhaustive`)
- For every component the product includes, the strongest case for buying or open-sourcing it instead of building.
- Surfaces hidden complexity in "we'll build it ourselves" decisions.

### 19. Operational & Support Load (Pick if SaaS or service)
- Anticipated support volume per customer.
- Documentation requirements.
- Onboarding flow and friction points.
- Churn risk vectors and customer-success motion.

### 20. Security & Threat Model (Pick if data-handling, financial, or multi-tenant)
- Threat actors: who might attack this and why.
- Attack surfaces: where the vulnerabilities live.
- Mitigations: authn/authz, encryption, audit, rate-limiting.
- Incident response posture.

### 21. Internationalization & Accessibility (Pick if consumer-facing at scale)
- Language / locale support strategy.
- Accessibility (WCAG) compliance posture.
- Cultural / localization considerations for the ICP.

### 22. Time-to-Revenue & Capital Efficiency (Pick at `--depth deep` and above)
- Calendar time from start to first dollar of revenue (with assumptions).
- Cash burn envelope to reach default-alive.
- Sensitivity: what shaves months off, what adds months?

The master is encouraged to **invent additional dimensions** when the prompt suggests one not on this list (e.g., for a hardware product, add `Manufacturing Feasibility`; for a marketplace, add `Two-Sided Liquidity Bootstrap`).

---

## Spec Sheet Output Schema

The master writes ONE file at `{project_root}/{product_name}_spec_sheet.md` with the following structure. Sections marked **(MANDATORY)** appear in every spec sheet. Other sections appear when the master picked the corresponding research dimension.

```markdown
---
product_name: {Product Name}
product_slug: {product-slug}
generated_at: {ISO-8601 timestamp}
generated_by: !product_plan
depth: {standard | deep | exhaustive}
schema_version: 1
research_dimensions:
  - problem-and-icp
  - market-and-competition
  - technical-architecture
  - feasibility-and-risk
  - implementation-roadmap
  - build-strategy
  - success-metrics
  # ... etc, only the dimensions actually researched
verdict: {Build | Build with caveats | Pivot | Do Not Build}
verdict_confidence: {high | moderate | low}
---

# {Product Name} — Spec Sheet

## Executive Summary (MANDATORY)

3-5 paragraphs covering:
- **One-line pitch:** a specific, concrete sentence (NOT "platform for X").
- **The problem:** in 2-3 sentences with specific evidence.
- **The solution:** what the product does in V1.
- **Verdict:** Build / Build with caveats / Pivot / Do Not Build, with the single most important reason.
- **Headline numbers:** estimated time-to-MVP, capital required, target ICP size, top risk.

## The Original Prompt (MANDATORY)

> {Verbatim quote of the user's prompt}

This is preserved so the reader can audit how faithfully the spec sheet honors the original ask.

## Concept (MANDATORY)

### Vision
The 3-5-year version of the product. What does it look like at scale?

### Mission
What change does the product create in the world for its ICP?

### One-Sentence Pitch
A sentence a stranger could understand without context.

### Core Value Proposition
The 2-3 things the product does dramatically better than the status quo, with evidence.

## Problem & ICP (MANDATORY)

### The Pain
{From research dimension 1.}

### The Ideal Customer Profile
- **Who:** {role + segment + company / life stage}
- **What they currently do:** {the workaround today}
- **Trigger event:** {what makes them want a solution this week}
- **Where to find them:** {the specific channels where they congregate}

### Anti-ICP
Who is this product NOT for? Surface this explicitly — it's where most product drift comes from.

### Evidence Backing the Problem
Cite specific sources, communities, or signals that demonstrate the pain is real.

## Market & Competition (MANDATORY)

### Market Size
- **Top-down estimate:** {number + assumptions}
- **Bottom-up estimate:** {number + assumptions}
- **Realistic addressable slice:** {SAM, with reasoning}

### Direct Competitors
For each (3-7 competitors):
- **Name:** {name}
- **Positioning:** {1-line}
- **Pricing:** {specifics}
- **Traction signals:** {users, revenue, raise — only what's verifiable}
- **Strengths:** {what they do well}
- **Weaknesses:** {what they do poorly — your wedge}

### Indirect Competitors / Substitutes
Including "do nothing" — what the ICP uses today instead.

### Market Trends & Timing
What changed recently that makes this product possible or urgent now?

### Why Now?
The honest answer to "why hasn't someone already built this?"

## Functional Requirements

### MVP Feature List
For each MVP feature:
- **Feature:** {name}
- **Description:** {what it does}
- **Acceptance criteria:** {how you know it's done}
- **Priority:** {must-have | should-have}
- **Estimated complexity:** {S | M | L | XL}

### Post-MVP (V1) Features
Same schema. These are deferred but mapped.

### Non-Functional Requirements
- **Performance:** {targets}
- **Scale:** {expected concurrent users / data volume / throughput}
- **Security:** {classification + posture}
- **Accessibility:** {compliance target}
- **Internationalization:** {locale support}

### User Stories
The 5-10 most important "as a {role}, I want {capability}, so that {outcome}" stories.

## Technical Architecture (MANDATORY)

### Recommended Stack
For each layer (frontend, backend, database, infra, AI/ML, etc.):
- **Choice:** {specific technology}
- **Why:** {justification tied to project constraints, ICP needs, team fit}
- **Alternatives considered:** {2-3 alternatives with trade-offs}

### High-Level Architecture
Text description + ASCII diagram showing components and data flow.

### Data Model
For each core entity:
- **Entity:** {name}
- **Fields:** {key fields with types}
- **Relationships:** {1:1, 1:N, N:N to other entities}
- **Lifecycle:** {creation, mutation, archival}

### API Surface
The endpoints / RPCs / events the product exposes.

### Third-Party Integrations
For each integration:
- **Service:** {name}
- **Purpose:** {why}
- **Risk:** {vendor lock-in, pricing, reliability}
- **Alternative:** {backup / migration path}

### Infrastructure & Deployment
Hosting, CI/CD, monitoring, logging, alerting.

## UX / UI Design Direction

### Design Principles
3-5 principles tailored to the ICP.

### Primary User Flows
Step-by-step walkthroughs of the most important flows.

### Screen / Page Inventory
Every distinct screen the MVP needs.

### Component Inventory
Reusable UI components (buttons, forms, lists, etc.).

### Inspirations & Anti-Patterns
Specific products with named patterns to emulate or avoid.

## Build Strategy (MANDATORY)

### Team Composition
- **Roles needed for MVP:** {list with headcount}
- **Hiring sequence:** {who first, who second, why}
- **Skill gaps:** {what the current team lacks}

### Build vs Buy Decisions
For each significant component, the recommendation (build / buy / open-source) with reasoning.

### Development Workflow
- **Source control:** {recommended branching model}
- **CI/CD:** {recommended pipeline}
- **Code review:** {posture}
- **Testing strategy:** {unit / integration / e2e split}

### Tooling
Dev environment, debugging, observability, analytics.

### Estimated Cost-to-MVP
- **Calendar time:** {months}
- **Capital:** {dollar range}
- **Headcount:** {person-months}

## Implementation Roadmap (MANDATORY)

### Phase 0 — Validation (Pre-Build)
What to test before writing the first line of code. Kill criteria for the project.

### Phase 1 — MVP
- **Scope:** {features}
- **Timeline:** {months}
- **Decision gate to advance:** {observable evidence}

### Phase 2 — V1
- **Scope:** {features}
- **Timeline:** {months}
- **Decision gate:** {evidence}

### Phase 3+ — Vision Track
The longer arc, sketched not specified.

### Milestones
The 5-10 specific events that mark progress (first user, first dollar, default-alive, etc.).

## Monetization & Pricing

### Pricing Model
{Subscription / usage / freemium / one-time / hybrid} with justification.

### Specific Prices
Actual numbers with market evidence.

### Free Tier
{Scope, limits, conversion mechanics}

### Unit Economics
- **ARPU:** {target}
- **CAC:** {estimate}
- **LTV:** {estimate}
- **Gross margin:** {trajectory}

### Upsell / Expansion
How accounts grow over time.

## Distribution & GTM

### First 100 Customers
The specific plan for getting from 0 to 100. Channels, content, outreach.

### Channels
For each channel: {effective for this ICP? evidence? CAC?}.

### Content / Community Strategy
What is published, where, and why.

### Partnerships
Specific named partners with reasoning.

## Data Model & Privacy

### Data Inventory
What data is collected, where it's stored, retention policy.

### PII / Sensitive Data Handling
Encryption, access controls, audit logging.

### Compliance Requirements
GDPR, HIPAA, SOC2, etc. — only those that apply, with reasoning.

### Data Flywheel
Does usage produce data that improves the product? How?

## Regulatory & Legal

### Applicable Regulations
Named regulations with citations.

### Compliance Load
Cost, calendar time, ongoing burden.

### Liability Exposure
Worst-case legal scenarios.

### Insurance & Legal Posture
What the project needs from day 1.

## AI / ML Considerations

### Models Recommended
Specific models with cost / latency / quality tradeoffs.

### Prompt / System Design
The architecture of AI invocations.

### Evaluation Strategy
How do you know the AI is good enough? Specific evals with pass/fail criteria.

### Failure-Mode Handling
Hallucinations, refusals, latency spikes — concrete handling.

### Cost Envelope
$ per request, $ per active user per month.

## Defensibility & Moat

### What Protects This?
Network effects, switching costs, data flywheels, brand, distribution lock-in — which apply.

### Time to Clone
Estimate for a well-funded incumbent.

### Long-Term Moat Strategy
How the moat is deepened over time.

## Feasibility & Risk Assessment (MANDATORY)

### Technical Risks
For each: {risk, likelihood, impact, mitigation}.

### Market Risks
{No demand, evaporating demand, incumbent reaction, etc.}

### Operational Risks
{Team gaps, compliance load, support burden, etc.}

### Existential Risks
{Regulatory ban, platform change, vendor lock-in, etc.}

### Risk Heat Map
A simple text table: rows = risk, columns = likelihood / impact / mitigation strength.

## Operational & Support Load

### Anticipated Support Volume
Tickets per customer per month, with reasoning.

### Documentation Requirements
Help center, API docs, in-product onboarding.

### Onboarding Flow
The first 10 minutes of a new user's experience.

### Churn Risk Vectors
Where customers leave and why.

## Security & Threat Model

### Threat Actors
Who might attack and why.

### Attack Surfaces
Where the vulnerabilities live.

### Mitigations
Authn/authz, encryption, audit, rate-limiting, monitoring.

### Incident Response
Posture and runbook outline.

## Success Metrics (MANDATORY)

### North-Star Metric
The one number that defines success.

### Leading Indicators
Daily/weekly metrics that predict the north star.

### Validation Experiments
Small, time-boxed tests with kill criteria.

## Adjacent Markets & Pivot Lanes

If the primary product fails, what pivot is closest (uses same tech / ICP / distribution)? What adjacent markets does the same tech unlock?

## The Skeptic's Case (Steel-Manned)

The strongest possible argument that this product should NOT be built. Surface it; do not bury it. If after writing this you cannot construct a credible counter, the verdict should be "Do Not Build" or "Pivot".

### Most Likely Failure Mode
How this dies, specifically.

### Load-Bearing Assumption
The single belief most likely to be wrong.

### Single Killer Fact
The one piece of evidence that, if found, would kill the project.

## Verdict & Recommendation (MANDATORY)

### Verdict: {Build | Build with caveats | Pivot | Do Not Build}

3-5 paragraphs defending the verdict, citing the research that supports it. The verdict must commit. Hedging language ("it depends") is a failure of the spec sheet.

### Recommended Next Step
The single most useful action the user can take next:
- **Validate** — run experiment X with kill criteria Y before writing code
- **Build MVP** — the validation is sufficient; start with feature scope Z
- **Pivot** — the better product is W; re-run `!product_plan W`
- **Do Not Build** — the evidence does not support this; redirect resources to {alternative}

### Confidence in Verdict
{High | Moderate | Low}, with the specific evidence-quality gap that explains why.

## Open Questions (MANDATORY)

The questions the research could not answer that matter most for the project's success. Each entry:
- **Question:** {what's unknown}
- **Why it matters:** {what hangs on the answer}
- **How to answer:** {customer interview, prototype, more research, etc.}
- **Kill-criteria:** {what answer would make the project unviable}

## Glossary (Optional)

Domain terms a future reader (or new team member) needs to understand the spec sheet.

## References & Sources (MANDATORY)

Numbered list of every external source cited in the spec sheet. URLs, paper titles, community thread references. The reader must be able to audit every external claim.

## Appendix — Research Dimension Reports (MANDATORY)

For each research dimension the master dispatched, include the worker's full report verbatim under a collapsed heading. This is the audit trail — the user can challenge any spec-sheet claim by reading the underlying research.

### {Dimension Name}
{Worker's full research report}
```

---

## Quality Rules (Non-Negotiable)

### Honesty Rules

1. **The verdict must commit.** "Build", "Build with caveats", "Pivot", or "Do Not Build" — not a hedge. A non-committal verdict is a failure.
2. **Surface weaknesses, do not bury them.** Every spec sheet must have a credible Skeptic's Case. If the master cannot construct one, the research was too shallow.
3. **No fabricated facts.** Market sizes, competitor names, regulations, pricing — every external claim must cite a source. Internal-context claims cite the file path.
4. **Flag thin evidence.** When a section is built on weak research, mark the affected claims with `[evidence: thin]` so the reader knows what's provisional.
5. **Honor the prompt.** The spec sheet must address what the user asked about. If research surfaces a better adjacent product, surface it — but the original ask gets a verdict, not a silent substitution.

### Structure Rules

6. **Single-file output.** The deliverable is ONE markdown file. No supporting files, no separate appendices. The Appendix lives inside the main file.
7. **Mandatory sections are mandatory.** Sections marked (MANDATORY) appear in every spec sheet, even when research was thin (note thinness explicitly).
8. **Verbatim original prompt.** Always preserved in "The Original Prompt" section.
9. **Slugified filename.** Lowercase, hyphenated, ASCII-only product name in the filename. Spaces become hyphens; punctuation stripped.

### Process Rules

10. **User approval gate before research dispatch.** The master surfaces the plan and waits for approval. No silent dispatch.
11. **Parallel research dispatch.** All research dimensions go out in parallel. Saturate concurrency, fire back-to-back rounds if needed.
12. **No code is written.** This command produces a spec sheet, not an implementation.
13. **No emojis** unless the user opts in or the project's CLAUDE.md does.
14. **Live timestamps.** Always `date -u +"%Y-%m-%dT%H:%M:%SZ"` for the `generated_at` field.

### Anti-Inflation Rules

15. **The "Verdict" cannot be inflated.** "Build with caveats" is the soft option, but it requires the caveats to be specific, observable, and addressable. A vague "Build with caveats" is rejected — either commit to "Build", commit to "Pivot / Do Not Build", or list the caveats with the evidence that would discharge each.
16. **A "Build" verdict requires evidence the worker can cite for "what success looks like" in this category.** Otherwise the verdict is downgraded to "Build with caveats".
17. **The "Recommended Next Step" must be concrete.** "Iterate on the plan" is not a next step. "Run a 30-customer interview campaign with the [open-question:Q-3] script" is a next step.

### Output Location Rules

18. **Default output is `{project_root}/{product_name}_spec_sheet.md`.** Override only via the `--out` flag.
19. **Never overwrite without confirmation.** If the file already exists, the master surfaces a diff summary and asks the user before overwriting.
20. **Atomic writes.** The full spec sheet is written in one Write call.

---

## Cost Discipline

`!product_plan` is research-heavy by design. Worker counts:

| Depth | Research dimensions | Worker prompts | Est. cost class |
|---|---|---|---|
| `standard` | 6-8 | 6-8 | Light |
| `deep` (default) | 10-14 | 10-14 | Medium |
| `exhaustive` | 16-22 | 16-22 | Heavy |

The master MUST surface the projected worker count and cost class **before dispatch** and wait for approval. Same gating as `!p_research --depth deep`.

If the user invoked the command in a constrained-context environment, the master should propose `--depth standard` and surface the trade-off (less depth in market / regulatory sections) so the user can decide.

---

## When to Use vs Adjacent Commands

- **Use `!product_plan`** when: you have a loose product idea and want a single, comprehensive spec sheet you can hand to a builder, an investor, or your future self. The output is decision-ready.
- **Use `!p_product_plan` instead** when: you've already done research synthesis (`!p_research` + `!p_synthesize`) and want **multiple ranked plan candidates** to choose between. Output: `final_plans.md` + `final_ratings.md`.
- **Use `!plan` instead** when: the product already exists and you want an implementation plan for a specific change. Output: an in-chat implementation plan, no spec sheet.
- **Use `!scope` instead** when: you have a specific code change and want a blast-radius analysis. Output: an in-chat impact map.

---

## Resume / Re-Run

`!product_plan` is meant to be re-runnable as the concept evolves:

- After customer interviews surface a new ICP, re-run with the refined prompt to update the spec sheet.
- After a competitor ships, re-run to refresh the market section.
- After a tech stack decision is made, re-run with the constraint baked in to tighten the architecture section.

Each re-run **overwrites** the spec sheet (with confirmation if the file exists). For history, the user is encouraged to commit the file to git so the evolution is preserved in `git log`.

---

## Failure Modes & Recovery

- **Research worker fails:** the master flags the affected dimension in the spec sheet's Open Questions section as "research incomplete — re-dispatch with `!product_plan --depth ... --redispatch {dimension-slug}`".
- **The prompt is too vague:** the master should NOT silently invent a product. Instead, surface the ambiguities and ask the user to disambiguate the 2-3 most consequential ones before dispatch.
- **The research surfaces a fundamentally different product than the prompt:** the master writes the spec sheet for the user's prompt as asked, AND surfaces the alternative finding in the "Adjacent Markets & Pivot Lanes" section with a clear "consider re-running `!product_plan {alternative}`" recommendation.
- **No `{project_root}` is set:** the master refuses to dispatch and prompts the user to run `!project set {path}` first.
