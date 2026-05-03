# `!p_product_research_resume [--dashboard {id}] [--pipeline-run {pipeline_run_id}]`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are the PIPELINE MASTER (resume mode).** You do NOT write code. You do NOT implement anything. You do NOT edit any file in `{project_root}` other than:
> - `documentation/research/prompt.md` (status table updates only)
> - `documentation/research/_pipeline_runs/{id}/*.json` (pipeline-state JSON)
> - `documentation/research/pipeline_report.md` (only after all three stages complete)
>
> All real work is done by dispatched workers via the `Agent` tool with `subagent_type: "swarm-worker"`.
>
> **2. You inherit the protocol of `!p_product_research`.** This command resumes a pipeline started by `!p_product_research`. Every constraint of `!p_product_research` (three-stages-in-strict-order, per-stage user-approval gates, full dashboard tracking, no-stage-skipping, stage-failure-halts-pipeline) applies VERBATIM.
>
> **3. You inherit the protocol of `!p_track_resume` for the active stage.** Whichever stage is being resumed (Stage 1/2/3), you ARE the master agent of that underlying swarm and must follow its resume protocol verbatim — including filesystem reconciliation, progress-file repair, dependency re-evaluation, stuck-task re-dispatch, and full final-report generation when the stage completes.
>
> **4. Completed stages are NEVER re-run.** If `_pipeline_runs/{id}/stageN_*.json` shows `status: "completed"`, that stage is DONE. Skip it. Move to the next stage. Re-running a completed stage is a violation of pipeline state.
>
> **5. Dispatched workers MUST receive `tracker_worker_instructions.md` references and the dashboard's `plan.json` path.** No exceptions. A re-dispatched worker that doesn't know how to write its progress file is a corruption of the dashboard.
>
> **6. The resume continues the pipeline through ALL remaining stages.** This is not "resume Stage 1 only." If Stage 1 was active and resumes successfully, the pipeline master then runs Stage 2 (with user approval gate) and Stage 3 (with user approval gate). The pipeline returns to its standard end-to-end behavior after recovery.

**Purpose:** Resume a stalled, interrupted, or partially-completed `!p_product_research` pipeline. Reads the current dashboard, identifies which pipeline stage is in flight, reconciles dashboard progress against the actual filesystem state in `documentation/research/`, repairs orphaned/stuck progress files, re-dispatches incomplete tasks with full worker context, and continues the pipeline through any remaining stages.

**Use when:**
- A `!p_product_research` pipeline was interrupted (chat closed, network drop, master compaction, manual cancel)
- The active stage's dashboard shows tasks stuck in `dispatched` or `in_progress` for >5 minutes with no progress
- Files appeared in `documentation/research/{topic-slug}/`, `synthesis/`, or `plans/` but the dashboard didn't register completion
- The pipeline halted at a stage transition gate (e.g., Stage 1 finished but Stage 2 never planned)

**Distinct from `!p_track_resume`:** `!p_track_resume` resumes a single dashboard's swarm and stops. `!p_product_research_resume` resumes the active stage's swarm AND continues through the remaining pipeline stages (with their approval gates) until `pipeline_report.md` is written.

**Syntax:**
```
!p_product_research_resume                                # Auto-detect from this chat's pre-assigned dashboard
!p_product_research_resume --dashboard {id}               # Explicit dashboard for the active stage
!p_product_research_resume --pipeline-run pr-20260502-a3f7k2   # Explicit pipeline run ID (preferred when known)
```

If neither flag is given, the master uses this chat's pre-assigned dashboard (per `dashboard_resolution.md`) and walks UP from that dashboard to its `pipeline_run_id` via `plan.json` `context.pipeline_run_id`.

---

## Phase 0 — Resume Discovery

Master only. Synchronous. Runs BEFORE any worker dispatch.

### 0.1 Resolve roots

- `{tracker_root}` — Synapse repository (CWD or `--tracker-root` flag).
- `{project_root}` — from `{tracker_root}/.synapse/project.json` (or `--project` flag).
- `research_root = {project_root}/documentation/research/`
- `pipeline_runs_root = {research_root}/_pipeline_runs/`

If `research_root` does not exist OR `pipeline_runs_root` does not exist OR `pipeline_runs_root` is empty:
- **STOP.** There is no `!p_product_research` pipeline to resume. Tell the user: "No pipeline runs found at `{pipeline_runs_root}`. If you intended to start a new pipeline, run `!p_product_research {prompt}`. If you intended to resume a different command's swarm, use `!p_track_resume`."

### 0.2 Identify the pipeline run

Pick `pipeline_run_id` in this order:

1. **`--pipeline-run` flag** — if given, use it directly. Verify `{pipeline_runs_root}/{id}/invocation.json` exists; if not, abort and list available run IDs.
2. **Walk from a dashboard** — if `--dashboard {id}` is given OR this chat has a pre-assigned dashboard, read `{tracker_root}/dashboards/{dashboard_id}/plan.json` and extract `context.pipeline_run_id`. If absent, that dashboard is not part of a pipeline — abort and recommend `!p_track_resume {dashboard_id}` for a single-dashboard recovery.
3. **Most-recent run** — if neither flag is given and no chat dashboard is pre-assigned, list `pipeline_runs_root/` directories sorted by mtime. If exactly one is `pipeline_status: "in-progress"` or `failed-at-stage-N`, pick it. If multiple, list them and ask the user which to resume — do NOT guess.

Read `{pipeline_runs_root}/{pipeline_run_id}/invocation.json` and parse:
- `prompt`
- `flags` (depth, scope, mode, breadth, top_n)
- `stage_status` (per-stage statuses)
- `pipeline_status`
- `project_root`, `tracker_root`, `git_sha` (informational)

### 0.3 Identify the active stage

The **active stage** is the FIRST stage whose status is NOT `completed`:

| stage_status               | Active stage      |
|---|---|
| `stage1: in-progress`      | Stage 1           |
| `stage1: planning`         | Stage 1           |
| `stage1: failed`           | Stage 1 (recovery) |
| `stage1: completed`, `stage2: pending`/`planning`/`in-progress`/`failed` | Stage 2 |
| `stage1: completed`, `stage2: completed`, `stage3: pending`/`planning`/`in-progress`/`failed` | Stage 3 |
| All three `completed`, `pipeline: in-progress` | Pipeline-report only — go straight to Phase 4 of `!p_product_research` |
| All three `completed`, `pipeline: completed` | **Nothing to resume.** Tell the user the pipeline is already complete; print pointers to `pipeline_report.md`, the three dashboards, and the artifact directories. STOP. |

For the active stage, read its per-stage status file:
- Stage 1 → `_pipeline_runs/{id}/stage1_research.json`
- Stage 2 → `_pipeline_runs/{id}/stage2_synthesize.json`
- Stage 3 → `_pipeline_runs/{id}/stage3_product_plan.json`

If the file exists, extract `dashboard_id`. If it does NOT exist, the stage was never planned — proceed to **Phase 1B (skip-resume, plan-fresh)** below for that stage.

### 0.4 Read agent instructions

Before any planning or dispatch, read these in full (master is allowed to read tracker docs):

- `{tracker_root}/agent/instructions/tracker_master_instructions.md`
- `{tracker_root}/agent/master/failure_recovery.md`
- `{tracker_root}/agent/master/dashboard_writes.md`
- `{tracker_root}/_commands/Synapse/p_product_research.md` (you must inherit its protocol)
- `{tracker_root}/_commands/Synapse/p_track_resume.md` (you must inherit its dashboard-resume protocol)
- The active stage's command:
  - Stage 1 → `{tracker_root}/_commands/Synapse/p_research.md`
  - Stage 2 → `{tracker_root}/_commands/Synapse/p_synthesize.md`
  - Stage 3 → `{tracker_root}/_commands/Synapse/p_product_plan.md`

### 0.5 Pre-flight summary

Print to the user, then continue automatically:

```
Pipeline resume: {pipeline_run_id}
  Prompt: "{first 80 chars of invocation.json prompt}"
  Stage 1 (research):     {status} → dashboard {dashboard1 or "—"}
  Stage 2 (synthesize):   {status} → dashboard {dashboard2 or "—"}
  Stage 3 (product plan): {status} → dashboard {dashboard3 or "—"}

  Active stage to resume: Stage {N} ({command_name})
  Active dashboard: {dashboard_id_or_"to-be-created"}

Beginning Phase 1: dashboard reconciliation.
```

---

## Phase 1A — Active-Stage Dashboard Reconciliation

This phase runs only if the active stage HAS an existing dashboard. If no dashboard exists for the active stage, jump to **Phase 1B**.

You inherit `!p_track_resume` here verbatim. The summary below is the pipeline-relevant subset; defer to `!p_track_resume.md` for any ambiguity.

### 1A.1 Snapshot the dashboard

For `dashboard_id = {active stage's dashboard}`, read:

- `{tracker_root}/dashboards/{dashboard_id}/plan.json` — canonical task spec, dependency graph, `context.pipeline_run_id` (verify match)
- `{tracker_root}/dashboards/{dashboard_id}/initialization.json` — task plan, agent definitions
- `{tracker_root}/dashboards/{dashboard_id}/logs.json` — full log history
- `{tracker_root}/dashboards/{dashboard_id}/master_state.json` (if present) — last master checkpoint
- Every file in `{tracker_root}/dashboards/{dashboard_id}/progress/*.json` — current per-task progress

Build an in-memory map: `task_id → { status, stage, files_changed, last_log_ts, deviations }`.

### 1A.2 Filesystem reconciliation against `documentation/research/`

For each task in `plan.json` `tasks[]`, look at its `files[]` (the files the master expected the worker to produce) AND check the appropriate research subdirectory for new artifacts:

| Active stage | Filesystem check root |
|---|---|
| Stage 1 | `{research_root}/{topic-slug}/` (topic_slug from `stage1_research.json` or derive from prompt) |
| Stage 2 | `{research_root}/synthesis/` |
| Stage 3 | `{research_root}/plans/` |

For each file expected by the task spec:

- **File exists, progress shows `completed`, `files_changed[]` lists it** → consistent. No action.
- **File exists, progress shows `in_progress`/`dispatched`** → **orphan completion**. The worker likely finished but its return was lost. **Repair the progress file:**
  - Set `status: "completed"`, `stage: "completed"`, `completed_at: {file mtime as ISO-8601}`.
  - Append `files_changed` entry if missing: `{ "path": "relative/path", "action": "created" }`.
  - Append a log entry: `{ "level": "info", "msg": "Reconciled by !p_product_research_resume — file detected on disk; worker return was lost. Status promoted from {prev} to completed.", "timestamp": "{now}" }`.
  - Add a milestone: `{ "ts": "{file mtime}", "text": "File reconciliation: detected {filename} on disk" }`.
  - Set `summary` if empty: `"Reconciled from filesystem — produced {filename}. No worker return captured; review file contents to confirm task completion."`
- **File exists, NO progress file at all** → **stranded artifact**. Create a synthetic progress file marked `completed` with a CRITICAL deviation explaining the file was found without dispatch context. Log this to `dashboards/{id}/logs.json` as a master-level warning.
- **File does NOT exist, progress shows `completed`** → **false-completion claim**. Demote the progress file to `failed` with a CRITICAL deviation: `"Progress claimed completion but expected file {path} is missing on disk. Task must be re-dispatched."`. Add to the re-dispatch list (Phase 2).
- **File does NOT exist, progress shows `in_progress`/`dispatched`/`pending`** → **incomplete or stuck**. Apply staleness rule (next step).
- **File does NOT exist, no progress file** → **never dispatched**. Add to dispatch list (Phase 2).

For Stage 1 specifically, also check `{research_root}/{topic-slug}/_synthesis.md` and `_index.md` — these are the stage's gate-required artifacts. Their presence/absence drives whether Phase 1A→Stage 2 transition can proceed.

For Stage 2, check `{research_root}/synthesis/_master_synthesis.md`, `_open_issues.md`, `_verification_report.md` — required for Stage 2 → Stage 3 gate.

For Stage 3, check `{research_root}/plans/final_plans.md`, `final_ratings.md`, `_evaluation_framework.md` — required for pipeline completion.

### 1A.3 Staleness rule for `in_progress`/`dispatched`

For each task whose progress file has `status: "in_progress"` or `"dispatched"`:

- Compute `staleness = now - max(last_log.timestamp, started_at)`.
- If `staleness > 5 minutes` AND no expected files exist on disk → **stuck**. Mark for re-dispatch.
- If `staleness > 5 minutes` AND SOME expected files exist on disk → **partially produced, likely worker died mid-task**. Mark for re-dispatch with a context note: `"Prior worker produced {existing_files} but did not complete. Continue from where it left off — verify those files match plan.json and complete the remaining: {missing_files}."`
- If `staleness <= 5 minutes` → **possibly still alive**. Wait 60 seconds, re-read the progress file. If still no movement, treat as stuck.

### 1A.4 Dependency graph re-evaluation

After all repairs in 1A.2 and 1A.3:

- Recompute dispatch readiness for every task: a task is **dispatchable** when `status ∈ {pending, failed, undispatched}` AND every dependency task has `status: "completed"`.
- Identify the **dispatch frontier**: the set of dispatchable tasks. These will be dispatched in Phase 2.
- If a task is `failed` and its failure reason indicates a planning error (worker reported CRITICAL deviation invalidating the approach), flag it for the user. Do NOT auto-replan — surface it and ask whether to (a) retry as-is, (b) skip via dependency rewire, or (c) abort and request `!p_product_research --resume` with revised flags.

### 1A.5 Write a reconciliation log

Append to `{tracker_root}/dashboards/{dashboard_id}/logs.json`:

```json
{
  "timestamp": "{now}",
  "level": "info",
  "scope": "master",
  "msg": "Resume reconciliation completed. Repaired N orphan completions, M stranded artifacts, K false-completion demotions. Dispatch frontier: {task_id list}.",
  "phase": "resume_reconciliation"
}
```

Then update `master_state.json` (full atomic rewrite) with the post-reconciliation state, including:
- `last_resume_at: {now}`
- `resume_invoker: "!p_product_research_resume"`
- `pipeline_run_id: {id}`
- `dispatch_frontier: [task_ids]`

---

## Phase 1B — Skip-Resume, Plan-Fresh Stage

This phase runs only if the active stage has NO existing dashboard (it was never planned in the original pipeline run, e.g., Stage 1 completed but the master died before Stage 2 was planned).

1. **Update pipeline state to "planning"** for the active stage in `_pipeline_runs/{id}/invocation.json`.
2. **Allocate a fresh dashboard** per `dashboard_resolution.md`. Record in `_pipeline_runs/{id}/stageN_{name}.json` with `dashboard_id` and `status: "planning"`.
3. **Run the active stage's planning phase verbatim** from the underlying command:
   - Stage 1 → `!p_research` Phase 1 (Research Plan)
   - Stage 2 → `!p_synthesize` Phase 1 (Topic Discovery & Plan)
   - Stage 3 → `!p_product_plan` Phase 1 (Lens & Category Brainstorm)
4. **Inject `pipeline_run_id` into `plan.json` `context`** — non-negotiable.
5. **User approval gate** — present the plan to the user exactly as the underlying command requires. Do NOT bypass.
6. **On approval**, proceed to Phase 2 (dispatch). On rejection or revision request, re-plan per the underlying command.

After Phase 1B, the rest of the resume flow (Phase 2 onward) treats the freshly-planned stage like any other dispatch frontier.

---

## Phase 2 — Re-Dispatch Frontier with Full Worker Context

For each task in the dispatch frontier, dispatch a worker via `Agent` tool with `subagent_type: "swarm-worker"`. Each worker prompt MUST include the full context block below — partial prompts are forbidden.

### 2.1 Worker prompt template (NON-NEGOTIABLE structure)

```
# RESUMED DISPATCH — {pipeline_run_id} / Stage {N} / Task {task_id}

You are a swarm-worker resumed by `!p_product_research_resume`. The original dispatch may have failed, never run, or partially completed. Treat this as a fresh execution with the context below — but if the prior worker produced artifacts, build on them rather than redoing the work.

## Mandatory Reading (in order, before any other action)

1. `{tracker_root}/agent/instructions/tracker_worker_instructions.md` — Worker progress reporting protocol. Follow this VERBATIM. Your progress file path is:
   `{tracker_root}/dashboards/{dashboard_id}/progress/{task_id}.json`
2. `{tracker_root}/agent/worker/progress_reporting.md` — Full schema and 8 mandatory write points.
3. `{tracker_root}/agent/worker/return_format.md` — Required return structure (STATUS / SUMMARY / FILES CHANGED / EXPORTS / DIVERGENT ACTIONS).
4. `{tracker_root}/agent/worker/deviations.md` — How to classify and report deviations.
5. `{tracker_root}/agent/worker/upstream_deps.md` — REQUIRED if this task has dependencies (see plan.json `tasks[].dependencies`).
6. `{tracker_root}/dashboards/{dashboard_id}/plan.json` — Your canonical task spec. Read `context` AND your task entry where `id == "{task_id}"`. Your `approach` and `files` fields are the source of truth.

## Pipeline Context

- Pipeline run ID: `{pipeline_run_id}`
- Active stage: Stage {N} ({stage_command_name})
- Original prompt (from `documentation/research/prompt.md`):
  > {full prompt verbatim}
- Pipeline flags (frozen at invocation):
  - `--research-depth`: {value}
  - `--research-scope`: {value}
  - `--synthesize-mode`: {value}
  - `--plan-breadth`: {value}
  - `--plan-top-n`: {value}

## Stage-Specific Reading

{Include the active-stage's command file path:}
- Stage 1 → ALSO read `{tracker_root}/_commands/Synapse/p_research.md` for source-weighting, citation, and synthesis rules.
- Stage 2 → ALSO read `{tracker_root}/_commands/Synapse/p_synthesize.md` for cluster-merge protocol and verification expectations.
- Stage 3 → ALSO read `{tracker_root}/_commands/Synapse/p_product_plan.md` for evaluation framework, lens scoring, and honesty rules.

## Resume-Specific Notes

{ONE of the following blocks based on the task's reconciliation outcome:}

### If task was never dispatched
This task has no prior progress file. Execute it fresh per plan.json.

### If task was stuck/in-progress with no artifacts
Prior dispatch did not produce the expected files. Restart cleanly. Overwrite the existing progress file with a fresh `reading_context` write before any work. Add a log entry: "Resumed by !p_product_research_resume — prior dispatch produced no artifacts; restarting from scratch."

### If task was partially produced
Prior dispatch produced these files: {list with paths and mtimes}. The expected files NOT yet produced: {list}. Read each existing file and continue from where the prior worker left off. Do NOT redo work that's already done — append, extend, or finalize. Add a log entry: "Resumed by !p_product_research_resume — continuing from prior partial output. Existing files: {list}. Remaining: {list}."

### If task failed with a CRITICAL deviation
Prior worker reported: "{deviation message}". Address the root cause before attempting work. If the prior CRITICAL deviation indicates a planning error you cannot resolve, write a CRITICAL deviation in your progress file referencing the prior one and STOP — return STATUS: failed with the chained deviation context. Do not silently re-attempt the same broken approach.

## Dashboard Context

- Dashboard ID: `{dashboard_id}`
- Tracker root: `{tracker_root}`
- Project root: `{project_root}` — this is your CWD for all code/file work.
- Progress file (write here, full atomic rewrites):
  `{tracker_root}/dashboards/{dashboard_id}/progress/{task_id}.json`
- Include `dashboard_id: "{dashboard_id}"` in EVERY progress write.
- Include `template_version: "{from initialization.json}"`.

## Your Task (verbatim from plan.json `tasks[{task_id}]`)

{paste the full task entry: title, approach, files, dependencies, profile, success criteria, etc.}

## Upstream Dependency Snapshots

{For each dependency:}
- `{dep_id}` (status: completed): {dep summary from progress file}. Files produced: {dep files_changed list}. Read `{tracker_root}/dashboards/{dashboard_id}/progress/{dep_id}.json` for full deviations and notes BEFORE implementing.

## Return when done

Return the structured format from `return_format.md`:
```
STATUS: completed | failed
SUMMARY: {specific, quantified}
FILES CHANGED: {created/modified/deleted prefixes}
EXPORTS: {if any}
DIVERGENT ACTIONS: {if any}
```
```

### 2.2 Dispatch rules

- **Parallelize within the wave.** All dispatchable frontier tasks of the same wave dispatch concurrently in a single message with multiple `Agent` tool uses.
- **Respect the dependency graph.** Do NOT dispatch a task whose dependencies are not all `completed`.
- **Append a master log entry** to `dashboards/{id}/logs.json` for each dispatch: `{ "timestamp": "{now}", "level": "info", "scope": "master", "msg": "Re-dispatched task {task_id} by !p_product_research_resume", "phase": "resume_dispatch" }`.
- **Update `master_state.json`** with the new in-flight task list.

### 2.3 Eager dispatch loop

After the initial frontier dispatches, run an eager-dispatch loop:

1. Wait for any worker to return.
2. Process its return per `failure_recovery.md` — repair progress file if the worker reported partial state, append return summary to logs.
3. Recompute the dispatch frontier (newly-completed dependencies may unlock downstream tasks).
4. Dispatch any newly-unlocked tasks immediately.
5. Repeat until no tasks remain `pending`/`dispatched`/`in_progress`.

If 3+ tasks fail in the same wave for related reasons, **trip the circuit breaker**: pause dispatch, summarize the pattern to the user, propose either (a) replanning the wave, (b) retrying with adjusted task specs, or (c) aborting the stage. Do NOT silently retry a broken plan.

---

## Phase 3 — Active-Stage Completion

Once all tasks in the active stage's dashboard are `completed` (or the stage is irrecoverably failed):

### On stage completion

1. **Run the underlying command's final-report phase verbatim:**
   - Stage 1 → `!p_research` Phase 5 (Final Synthesis & Report) — produces `{topic-slug}/_synthesis.md`, `_index.md`, `_coverage.md`.
   - Stage 2 → `!p_synthesize` Phase 6 (Verification) AND Phase 7 (Master Synthesis) — produces `synthesis/_master_synthesis.md`, `_open_issues.md`, `_verification_report.md`.
   - Stage 3 → `!p_product_plan` Phase 6 (Final Synthesis) — produces `plans/final_plans.md`, `final_ratings.md`.

   The pipeline master is allowed to dispatch the single-worker final-synthesis step if the underlying command requires it. The pipeline master does NOT write these reports directly — they are worker-generated.

2. **Pass the stage transition gate** per `!p_product_research`:
   - Stage 1 → 2 gate: `_synthesis.md` exists with non-empty `claim_count` AND `_index.md` exists.
   - Stage 2 → 3 gate: `_master_synthesis.md` exists, `_verification_report.md` certification status is read and recorded.
   - Stage 3 → pipeline-end gate: `final_plans.md` and `final_ratings.md` exist.

   Gate failure = stage failure. Surface to user and stop — do NOT proceed to the next stage.

3. **Update `_pipeline_runs/{id}/stageN_*.json`** with full metrics per `!p_product_research` Phase N completion schema.
4. **Update `_pipeline_runs/{id}/invocation.json`** atomic rewrite: `stageN: "completed"`. Update `pipeline_status` to `"in-progress"` if it was `failed-at-stage-N`.
5. **Update `documentation/research/prompt.md`** status table for the active pipeline run entry.

### On stage failure

1. Update `_pipeline_runs/{id}/stageN_*.json` with `status: "failed"` and failure reason.
2. Update `_pipeline_runs/{id}/invocation.json`: `pipeline_status: "failed-at-stage-{N}"`.
3. Update `prompt.md` status table.
4. Surface failure to user with clear next-step options: re-run resume, abort, or manual intervention. **STOP — do not advance to the next stage.**

---

## Phase 4 — Continue Pipeline Through Remaining Stages

If the active stage completed successfully AND it was not Stage 3:

1. Move to the next stage. Run that stage's planning phase per `!p_product_research` Phases 2 or 3 (depending on which is next).
2. The user-approval gate FIRES — do not bypass.
3. On approval, dispatch the wave per `!p_product_research`.
4. Repeat through Stage 3.

This is the critical difference between this command and `!p_track_resume`: after recovering the active stage, the pipeline returns to its standard end-to-end execution, including the remaining user-approval gates.

---

## Phase 5 — Pipeline Report

After Stage 3 completes:

1. The pipeline master writes `documentation/research/pipeline_report.md` per `!p_product_research` Phase 4 schema.
2. Print the Phase 5 terminal disclosure per `!p_product_research`.
3. Update `_pipeline_runs/{id}/invocation.json`: `pipeline_status: "completed"`.

`pipeline_report.md` MUST surface that the pipeline was resumed mid-flight in its "Provenance" section: `"This pipeline was resumed via !p_product_research_resume on {timestamp}. {N} tasks were re-dispatched during recovery. See dashboards/{id}/logs.json entries with phase: resume_* for details."`

---

## Rules (Non-Negotiable)

### Resume Discipline

1. **Walk from dashboard or pipeline-run ID. Never guess the active stage.** Read `_pipeline_runs/{id}/invocation.json` and trust its `stage_status` field.
2. **Reconcile filesystem before re-dispatching.** Orphan completions, stranded artifacts, and false-completion claims MUST be repaired in the progress files before any worker is dispatched. Re-dispatching without reconciliation duplicates work and confuses the dashboard.
3. **Completed stages are immutable.** Never re-run a stage with `status: "completed"`. Skip and move forward.
4. **Worker prompts MUST include `tracker_worker_instructions.md` reference and `plan.json` path.** Always. No exceptions.
5. **The pipeline continues end-to-end after recovery.** Resume is not "fix the active stage and stop." It is "fix the active stage and run the pipeline to completion."

### State Integrity

6. **Atomic full-file rewrites for `_pipeline_runs/{id}/invocation.json` and per-stage status JSONs.** Read → modify → write. Never partial.
7. **`prompt.md` is touched only to update the active run's status table.** Do NOT append new run entries — this is a resume, not a new invocation.
8. **Every reconciliation action is logged.** `dashboards/{id}/logs.json` entries with `phase: "resume_reconciliation"` or `"resume_dispatch"` so the user can audit what the resume did.

### Inheritance

9. **`!p_product_research` is the parent protocol.** Stage order, approval gates, gate criteria, and report format all defer to it.
10. **`!p_track_resume` is the dashboard-level protocol.** All in-stage dashboard repair, dispatch frontier computation, and circuit-breaker behavior defer to it.
11. **The active stage's underlying command (`!p_research` / `!p_synthesize` / `!p_product_plan`) governs that stage's dispatch waves, source weighting, verification, and final-report content.** The pipeline master inherits, never relaxes.

### Honesty

12. **Surface every repair in the user-facing summary.** Number of orphan completions, stranded artifacts, false claims demoted, tasks re-dispatched. Burying repair counts is forbidden.
13. **If a task was demoted from `completed` to `failed`, tell the user.** False completions point to either worker bugs or filesystem race conditions — both deserve visibility.
14. **`pipeline_report.md` discloses the resume.** When the pipeline ultimately completes via resume, the report's Provenance section names this command as the recovery mechanism, with a reconciliation summary.

### Safety

15. **No destructive operations on existing artifacts.** Files in `documentation/research/` produced by prior workers are NOT deleted. They are read, validated, and either accepted (orphan completion repair) or noted in deviations (mismatch with plan.json). Worker re-dispatches must extend or finalize, not overwrite, prior artifacts unless the task spec explicitly requires a rewrite.
16. **Cycle protection.** If `!p_product_research_resume` is invoked from a hook chain or another swarm, propagate `--triggered-by` and `--depth`. Reject `depth > 2` — same as `!p_product_research`.

---

## Resume vs Restart Decision

**Use `!p_product_research_resume` when:**
- The pipeline was started by `!p_product_research` and partially produced artifacts in `documentation/research/`.
- You want to preserve completed stages and only re-do what's incomplete.
- The original prompt is still the question you want answered.

**Use `!p_product_research {prompt}` (fresh invocation) when:**
- The original prompt is wrong or has changed materially.
- The prior pipeline produced corrupt or off-target artifacts you'd rather discard.
- You want to A/B compare two pipeline runs against the same project state.

A fresh `!p_product_research` produces a NEW `pipeline_run_id` and appends to `prompt.md`. The prior pipeline's dashboards and per-stage JSONs remain untouched and resumable independently.
