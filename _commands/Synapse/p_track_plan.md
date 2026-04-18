# `!p_track_plan {plan_path}`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are now the MASTER AGENT. You do NOT write code. You do NOT implement anything. You do NOT edit application files. You ONLY plan and dispatch worker agents. No exceptions. Not "just one small thing." Not "it's faster if I do it." NEVER.**
>
> **2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. Do not skip this. Do not work from memory. Read it NOW.**
>
> **3. You MUST use the dashboard. Write `initialization.json`, use `logs.json`, dispatch workers who write progress files. The dashboard is how the user sees the swarm. Skipping it is a failure.**
>
> **4. You MUST dispatch ALL implementation work via worker agents using the Task tool. Every file edit, every code change, every test — dispatched to a worker. The master's only job is: read plan → translate to tasks → write dashboard → dispatch agents → monitor → report.**
>
> **5. You MUST compile and deliver a comprehensive final report after all tasks complete. Read all progress files, analyze deviations and their project impact, identify improvements, and provide concrete future steps. The report is the user's primary deliverable — not the dashboard, not the logs. No exceptions.**
>
> **The plan document drives the swarm. Your job is to translate it faithfully into dispatchable tasks, not to redesign it.**

**Purpose:** The invoking agent becomes the **master agent** — responsible for reading a pre-written plan document, translating it into a dependency-aware swarm, populating the dashboard, waiting for user approval, then dispatching and monitoring workers. The master does NOT discover the plan — the plan already exists. The master's primary job is **faithful translation** and **timely detailed statusing**.

**Syntax:** `!p_track_plan [--dashboard {id}] {plan_path}`

- `{plan_path}` — Path to a `.md` plan document. Absolute path, or relative to `{tracker_root}`.
- `--dashboard {id}` — (Optional) Force a specific dashboard by ID (e.g., `a3f7k2` or `dashboard3`). If omitted, use the pre-assigned chat dashboard if one exists; otherwise auto-select per `dashboard_resolution.md`.

**Examples:**
```
!p_track_plan tasks/04_18_26/pki_accumulation_plan.md
!p_track_plan /Users/dean/.claude/plans/happy-dreaming-backus.md
!p_track_plan --dashboard a3f7k2 plans/refactor_auth.md
```

### When to use `!p_track_plan` vs `!p_track` vs `!plan`

| Scenario | Command | Why |
|---|---|---|
| You have a pre-written plan document to execute | `!p_track_plan` | Plan already exists — skip discovery, translate and dispatch |
| Starting from a prompt, no existing plan | `!p_track` | Full discovery + decomposition needed |
| Want analysis only, no execution | `!plan` | Read-only — produces a plan document, doesn't dispatch |
| Plan document from a previous `!plan` session | `!p_track_plan` | Convert the `!plan` output into a live swarm |

> **Natural workflow:** `!plan {task}` → review and refine the plan → `!p_track_plan {plan_path}` to execute it.

> **Full Dashboard Tracking Thresholds:** Same as `!p_track` — when a swarm has **3+ agents** or **more than 1 wave**, full dashboard tracking is mandatory and non-negotiable.

---

**Output files:**
```
{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json              ← Master task file (single source of truth)
{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md            ← Parallelization rationale (references source plan)
{tracker_root}/dashboards/{dashboardId}/initialization.json             ← Static plan data (written once)
{tracker_root}/dashboards/{dashboardId}/logs.json                       ← Timestamped event log
```

> **`{tracker_root}`** refers to the Synapse directory. Locate it relative to the project root.
>
> **`{dashboardId}`** resolution order is: (1) pre-assigned dashboard from the chat's `DASHBOARD ID:` binding; (2) explicit `--dashboard {id}` flag; (3) auto-selection via `{tracker_root}/agent/instructions/dashboard_resolution.md`.

**Dashboard:** Synapse Electron app — live visualization powered by `initialization.json`, `logs.json`, and `progress/` files merged client-side.

---

## Phase 0: Plan Ingestion — Read and Analyze the Plan Document

**Steps 0A-0D:** Parse arguments to extract `{plan_path}` and optional `--dashboard` flag. Read the plan document in full. Analyze its structure — extract implementation phases, files to create/modify/read, dependencies between phases, constraints, risks, and verification steps. Validate that referenced files and directories exist. Flag any issues.

> **The plan document is the source of truth.** Do not redesign it. Translate it faithfully. If the plan has gaps or ambiguities, note them during the approval gate — do not silently fill them in.

---

## Phase 1: Plan Translation — Convert Document to Swarm Tasks

**Steps 1-11:** Resolve `{project_root}`, read master instructions, read project context (CLAUDE.md, relevant source files), build convention map. Map plan phases to waves/chains. Decompose into atomic tasks (1-5 min each). Verify dependencies (topological sort, critical path). Create plan files. Select dashboard, archive previous data, populate `initialization.json` and `logs.json`, present translated plan to user, **execute the Approval Gate — NON-NEGOTIABLE.**

> **Read `{tracker_root}/agent/_commands/p_track_planning.md` for the dashboard population and approval gate protocol (Steps 8-11).**

### Translation Rules

1. **Plan phases → waves.** Each phase or numbered step in the plan document becomes a wave. Items within a phase that have no dependency on each other become parallel tasks within the same wave.
2. **Plan bullet points → tasks.** Each concrete action item (create file X, modify file Y, add function Z) becomes a task. Right-size: 1-5 min, 1-2 files modified.
3. **Phase ordering → dependencies.** If phase 2 depends on phase 1, all wave 2 tasks depend on the relevant wave 1 tasks. Map specific dependencies where the plan indicates them.
4. **Preserve plan structure.** The dependency graph in `initialization.json` should mirror the plan document's structure. A reader should be able to trace each task back to its source in the plan.
5. **Store plan source.** Add `task.plan_source` to `initialization.json` with the absolute path to the source plan document.

### Approval Gate — NON-NEGOTIABLE

After presenting the translated plan, the master MUST:

1. **Write a `permission` log entry** to `logs.json`: `"Plan translated from {plan_path}: {N} tasks across {W} waves — awaiting approval to begin execution"`. This triggers a dashboard popup.
2. **Output**: Show how plan phases mapped to waves, then: `Ready to execute. Approve to begin dispatching {N} agents?`
3. **HALT.** No dispatch, no `master_state.json`, no Task tool calls. Wait for user response.
4. **On approval**, log `"Approval granted — activating eager dispatch"` at `info`, proceed to Phase 2.
5. **On rejection/modification**, log accordingly, exit or revise and re-present.

---

## Phase 2: Execution — Dispatch & Monitor

Identical to `!p_track` Phase 2. Dispatch all tasks with satisfied dependencies, construct self-contained worker prompts, process completions with eager dispatch, handle failures, evaluate circuit breaker.

> **Read `{tracker_root}/agent/_commands/p_track_execution.md` for the complete execution protocol.**

---

## Phase 3: Completion — Verify & Report

Identical to `!p_track` Phase 3. Post-swarm verification, metrics computation, final report (NON-NEGOTIABLE), history save.

> **Read `{tracker_root}/agent/_commands/p_track_completion.md` for the complete completion protocol.**

---

## Rules (Non-Negotiable)

All rules from `!p_track` apply without exception — dispatch & tracking, statusing, agent prompts, upstream results & caching, planning, parallelization, verification & reporting, permission requests. See `_commands/Synapse/p_track.md` for the full rules list.

### Additional Rules for Plan-Driven Swarms

1. **Faithful translation.** The master translates the plan document into tasks — it does not redesign the plan. If the plan says "Phase 1: Create PKIMerger.js", that becomes a task to create PKIMerger.js, not something else.
2. **Surface ambiguities.** If the plan document is ambiguous or has gaps, surface them during the approval gate. Let the user decide how to resolve them.
3. **Traceability.** Every task in `initialization.json` should be traceable to a specific section of the source plan document. The rationale `.md` file must reference which plan phases mapped to which waves.
4. **Plan document is read-only.** The master never modifies the source plan document.

---

## Timestamp Protocol

Same as `!p_track`. Every timestamp must be captured live via `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
