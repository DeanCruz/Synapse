---
name: p-track
description: >
  Run a full Synapse parallel swarm with live dashboard tracking. Use when the user
  invokes !p_track or requests tracked parallel execution with dependency-aware dispatch,
  live progress monitoring, and comprehensive reporting.
argument-hint: "[--dashboard <id>] <prompt>"
user-invocable: true
context: fork
model: opus
---

# Synapse Swarm Orchestrator — !p_track

## NON-NEGOTIABLE RULES

**The master-protocol skill provides your core identity, constraints, and schemas. It auto-loads for master agents. Follow it absolutely.**

**Additionally for !p_track:**

**1. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. Do not skip this.**

**2. You MUST compile and deliver a comprehensive final report after all tasks complete. No exceptions. See Phase 3.**

**If the user's prompt is long or complex, that is MORE reason to plan and dispatch, not to implement directly.**

---

## Dynamic Context

!`echo "PROJECT_ROOT: $(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null || echo 'UNSET — resolve before planning')"`
!`echo "TRACKER_ROOT: $(pwd)"`
!`echo "DATE: $(date -u +%Y-%m-%dT%H:%M:%SZ)"`
!`echo "TASK_DATE: $(date -u +%m_%d_%y)"`
!`echo "ASSIGNED_DASHBOARD: ${SYNAPSE_DASHBOARD_ID:-UNSET — extract from your system prompt's \`DASHBOARD ID:\` directive, or ask the user. Never scan.}"`

## Project Context

!`cat "$(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null)/CLAUDE.md" 2>/dev/null | head -100 || echo "No project CLAUDE.md found — scan the project structure to understand the codebase layout."`

---

## Phase 1: Planning (Steps 1-11)

Execute these steps in order before dispatching any agents.

### Steps 1-5: Context Gathering

1. **Resolve `{project_root}`** — Resolution order: `--project` flag -> `{tracker_root}/.synapse/project.json` -> CWD.
2. **Read master instructions** — Read `{tracker_root}/agent/instructions/tracker_master_instructions.md`. NON-NEGOTIABLE.
3. **Parse the prompt** — Extract task description, generate a kebab-case slug, identify affected directories.
4. **Deep analysis** — Full scope: directories, files, dependencies, edge cases. Read `{project_root}/.synapse/dep_graph.json` if it exists.
5. **Read all relevant context files** — Parallelize reads. Build a convention map from `{project_root}/CLAUDE.md` grouping rules by category (naming, file_structure, imports, frontend_styling, backend_api, error_handling, testing, types).

### Step 6: Decompose into Tasks

Break work into atomic tasks (1-5 min each, 1-2 files modified). Group into waves by dependency level. Sweet spot: 4-8 tasks. Merge back if splitting does not reduce critical path by 20%+.

**Context budget:** ~800 lines / 8000 tokens max per worker prompt. Prompt bloat is the #1 cause of context exhaustion.

**Shared files:** Prefer Pattern C (separate files) > B (integration task) > A (owner). See CLAUDE.md for details.

### Step 7: Determine Parallelization Type

**Waves** for broad, shallow work (tasks independent within wave). **Chains** for narrow, deep work (sequential paths progressing independently).

### Steps 8-9: Write `plan.json` — the canonical planning artifact

**The plan lives at `{tracker_root}/dashboards/{dashboardId}/plan.json` — same directory as `initialization.json`.** It captures all the deep-thinking output and is read by every worker on dispatch. The `validate-plan-required.sh` hook blocks `initialization.json` writes when `plan.json` is missing or malformed.

`plan.json` schema:

```jsonc
{
  "name":    "<kebab-case-slug>",                  // matches initialization.json task.name
  "created": "<ISO 8601 — date -u>",
  "context": {
    "prompt":       "<verbatim user prompt — NON-EMPTY>",
    "project_root": "<absolute path>",
    "tracker_root": "<absolute path>",
    "dashboard_id": "<id>",
    "type":         "Waves" | "Chains",
    "directories":  ["<affected dir>", ...],
    "conventions":  { "naming": [...], "file_structure": [...], "imports": [...],
                      "frontend_styling": [...], "backend_api": [...],
                      "error_handling": [...], "testing": [...], "types": [...] },
    "reference_code":         [{ "label": "...", "path": "...", "snippet": "..." }],
    "architectural_decisions":"<the why — non-obvious choices and their reasoning>",
    "edge_cases":             "<known gotchas spanning the swarm>",
    "shared_constraints":     "<rules every worker must respect>"
  },
  "tasks": [
    {
      "id":               "1.1",
      "title":            "<short verb phrase>",
      "wave":             1,
      "depends_on":       [],
      "directory":        "<task target dir>",
      "description":      "<what the worker must do — NON-EMPTY>",
      "approach":         "<HOW to do it most effectively — the deep-thought how-to. NON-EMPTY>",
      "files":            [{ "action": "read|modify|create|delete", "path": "..." }],
      "context":          "<task-specific context not in shared>",
      "critical":         "<edge cases / gotchas for this task>",
      "success_criteria": ["specific verifiable condition", ...],
      "instruction_mode": "FULL" | "LITE",
      "tags":             [...]
    }
  ]
}
```

**Deep thinking is mandatory.** `approach` must reflect real research and decision-making — not a restatement of `description`. If you have lost the deep-thinking context (e.g., after compaction), redo the analysis (re-read CLAUDE.md, reference files, dep_graph) until each task's `approach` clearly fulfills the original prompt.

The legacy `tasks/{TASK_DATE}/parallel_{name}.json` and `parallel_plan_{name}.md` are no longer required. `plan.json` is the single planning artifact.

### Step 10: Verify Dependencies

Topological sort (detect cycles), compute critical path, identify bottleneck tasks (depended on by 3+), verify no orphans/dangling references. Encode dependencies in each task's `depends_on` field.

### Step 11: Select Dashboard and Populate Plan

See master-protocol for dashboard selection priority. **Archive before clear — NON-NEGOTIABLE.**

**Order of writes (NON-NEGOTIABLE):**
1. **First**, write `plan.json` to the dashboard directory. The `validate-plan-required.sh` hook will block step 2 if this file is missing or incomplete.
2. **Then**, read [`agent/master/initialization_blueprint.md`](../../../agent/master/initialization_blueprint.md) and write `initialization.json`. The `validate-initialization-schema.sh` hook enforces the blueprint. `agents.length` must equal `plan.tasks.length`.
3. **Then**, write the initial entry to `logs.json`.
4. **Then**, present the plan to the user and execute the Approval Gate (Step 11E) — NON-NEGOTIABLE.

### Step 11E: Approval Gate — NON-NEGOTIABLE

After presenting the plan, the master MUST:

1. **Write a `permission` log entry** to `logs.json`: `"Plan ready for review: {N} tasks across {W} waves — awaiting approval to begin execution"`. This triggers a dashboard popup.
2. **Output**: `Ready to execute. Approve to begin dispatching {N} agents?`
3. **HALT.** No dispatch, no `master_state.json`, no Task tool calls. Wait for user response.
4. **On approval**, log `"Approval granted — activating eager dispatch"` at `info`, proceed to Phase 2. Dispatch tasks the instant dependencies clear — across all waves, no batching.
5. **On rejection/modification**, log accordingly, exit or revise and re-present.

See `agent/_commands/p_track_planning.md` Step 11E for the full protocol.

---

## Phase 2: Execution (Steps 13-16)

See master-protocol skill for the complete dispatch and tracking rules. Key points:
- Dispatch FIRST, update tracker AFTER
- Dependency-driven, not wave-driven — waves are visual only
- No artificial concurrency cap — dispatch ALL tasks with satisfied deps
- Errors do not stop the swarm — circuit breaker at cascading failures

### Step 13: Initial Dispatch

Dispatch every task whose `depends_on` is empty or fully satisfied. Launch agent FIRST, append dispatch log AFTER.

### Step 14: Worker Prompt Construction

| Criteria | FULL | LITE |
|---|---|---|
| Has upstream deps / modifies 3+ files / coordination / high risk | Yes | |
| Simple, independent, single-file / mechanical change | | Yes |

Default to FULL when uncertain. See Worker Prompt Template below.

---

## Worker Prompt Template

Every dispatched agent receives this self-contained prompt:

```
You are a worker agent in the "{task-slug}" swarm, executing task {id}.
TEMPLATE_VERSION: p_track_v2

═══════════════════════════════════
TASK {id}: {title}
═══════════════════════════════════

DESCRIPTION:
{detailed description from task file}

CONTEXT:
{all context from task file}

PROJECT ROOT: {project_root}
TRACKER ROOT: {tracker_root}
PLAN FILE: {tracker_root}/dashboards/{dashboardId}/plan.json

CONVENTIONS:
{Filtered from convention_map — include ONLY categories relevant to THIS task.
Quote directly from CLAUDE.md. For large files (500+ lines), summarize as 2-3 bullet points.
Omit section entirely if no CLAUDE.md exists.}

REFERENCE CODE:
{Working examples from the codebase the worker should follow as patterns.
Include a complete example if creating something new. Omit if no patterns apply.}

UPSTREAM RESULTS:
{Only for downstream tasks. Per completed dependency:
--- Dependency: Task {dep_id} — {title} ---
STATUS: {completed | failed}
SUMMARY: {verbatim SUMMARY line}
FILES CHANGED:
  - {path} ({created | modified | deleted})
NEW EXPORTS:
  - {type} {name} — {description}
DEVIATIONS: {none | list}
KEY DETAILS: {1-2 sentences of specific technical context the downstream worker needs}
--- End Dependency ---
Omit entire section for Wave 1 tasks.}

SIBLING TASKS:
{Optional — same-wave tasks modifying related areas:
  - {sibling_id}: {title} — modifies {files}
Do NOT modify sibling files. Report as deviation if needed.
Omit if no relevant siblings.}

CRITICAL:
{critical details from task file — omit if none}

SUCCESS CRITERIA:
{Specific, verifiable conditions. Worker checks each to confirm completion.}

FILES:
  - READ:   {path}
  - MODIFY: {path}
  - CREATE: {path}

DIRECTORY: {working directory}

═══════════════════════════════════
PREPARATION — REQUIRED BEFORE STARTING WORK
═══════════════════════════════════

1. READ YOUR TASK IN THE PLAN FILE:
   Read `{tracker_root}/dashboards/{dashboardId}/plan.json` — your task at `tasks[]` where `id == "{id}"`.
   Read `context` (shared across all workers in this swarm) and your single task entry plus the
   entries for every id listed in your `depends_on`. Do NOT read other tasks' entries.
   The plan file is the canonical source for your description, approach, files, and success criteria.

2. READ PROJECT INSTRUCTIONS (only if CONVENTIONS above is empty):
   Check {project_root}/CLAUDE.md. Skip if conventions already provided above.
   NOTE: Code work happens in {project_root}. Progress reporting goes to {tracker_root}.

3. READINESS CHECKLIST:
   [ ] Listed every file path I will modify or create
   [ ] Read at least one existing file following the pattern I need
   [ ] Can state in one sentence what this task produces
   [ ] Confirmed each file to modify exists at expected path
   [ ] Reviewed UPSTREAM RESULTS if this task has dependencies

   If any item fails: Glob for missing paths, read closest similar file, log as deviation.
   After 3 additional reads without resolution, report as blocker.

═══════════════════════════════════
LIVE PROGRESS REPORTING — NON-NEGOTIABLE
═══════════════════════════════════

INSTRUCTION MODE: {FULL | LITE}

{If FULL:}
Read: {tracker_root}/agent/instructions/tracker_worker_instructions.md

{If LITE:}
Read: {tracker_root}/agent/instructions/tracker_worker_instructions_lite.md

YOUR PROGRESS FILE: {tracker_root}/dashboards/{dashboardId}/progress/{id}.json
YOUR TASK ID: {id}
YOUR AGENT LABEL: Agent {N}

Write the FULL file on every update.

═══════════════════════════════════
RETURN FORMAT
═══════════════════════════════════

STATUS: completed | failed
SUMMARY: {one-sentence description}
FILES CHANGED:
  - {path} ({created | modified | deleted})
EXPORTS: (omit if none)
  - {type} {name} — {description}
DIVERGENT ACTIONS: (omit if none)
  - {what changed and why}
WARNINGS: (omit if none)
ERRORS: (omit if none)
```

**Prompt completeness:** Verify: file paths, conventions, reference code, upstream results, success criteria, critical details, instruction mode.

### Step 15: Eager Dispatch on Completions

See master-protocol for the eager dispatch 5-step mechanism (`agent/master/eager_dispatch.md`). On each completion: parse return, validate (see failure-protocol), update master task file, append to logs.json, cache for downstream, write master_state.json.

### Step 16: Failure & Compaction Recovery

The failure-protocol skill handles all failure recovery (Steps 0-7), double failure escalation, and circuit breaker replanning (`agent/master/failure_recovery.md`). For compaction recovery, see `agent/master/compaction_recovery.md`.

---

## Phase 3: Completion (Step 17)

When all tasks reach `completed` or `failed`:

### 17A-B: Finalize

- Update master task file `overall_status` to `completed` (or `failed`).
- Append completion log: `"Swarm complete: {completed}/{total} tasks succeeded, {failed} failed"`.

### 17C: Post-Swarm Verification (when warranted)

Dispatch verification agent (tests, types, build) when: modified existing code across multiple files, or tasks reported deviations. Optional for additive work. May skip if all succeeded with no warnings.

### 17D: Compute Metrics

Read all progress files. Write `metrics.json`: `elapsed_seconds`, `serial_estimate_seconds`, `parallel_efficiency`, `duration_distribution`, `failure_rate`, `max_concurrent`, `deviation_count`.

### 17E: Final Report — NON-NEGOTIABLE

**Read ALL data before writing:** logs.json, every progress file, master task file, metrics.json. Synthesize into this structure:

```markdown
## Swarm Complete: {task-slug}

**{completed}/{total} tasks** . **{W} waves** . **{N} failures** . **{elapsed}s elapsed** . **{efficiency}x parallel efficiency** . **Type: {Waves|Chains}**

### Summary of Work Completed (REQUIRED)
{Thorough summary — goal, what was built, design decisions, current state. NOT a 2-sentence blurb.}
### Files Changed (REQUIRED)
| File | Action | Task | What Changed |
|---|---|---|---|
### Deviations & Their Impact (CONDITIONAL)
### Warnings & Observations (CONDITIONAL)
### Failures (CONDITIONAL)
### Verification Results (CONDITIONAL)
### Potential Improvements (REQUIRED)
### Future Steps (REQUIRED)
### Performance (REQUIRED)
| Metric | Value |
|---|---|
| Wall-clock / Serial estimate / Parallel efficiency | {elapsed}s / {serial}s / {efficiency}x |
| Max concurrent / Deviations / Failure rate | {max} / {dev_count} / {fail_rate} |
### Artifacts
Plan: `dashboards/{dashboardId}/plan.json`
Dashboard: `dashboards/{dashboardId}/` (initialization.json, logs.json, metrics.json)
```

**Quality bar:** A developer not present during the swarm should fully understand: (1) what was done, (2) what went sideways, (3) current project state, (4) what to do next.

### 17F: Save to History

Save a history summary to `{tracker_root}/history/`.

---

## Module References

| Module | Path |
|---|---|
| Planning / Execution / Completion | `agent/_commands/p_track_{planning,execution,completion}.md` |
| Dashboard writes / Worker prompts | `agent/master/{dashboard_writes,worker_prompts}.md` |
| Eager dispatch / Failure recovery | `agent/master/{eager_dispatch,failure_recovery}.md` |
| Compaction recovery | `agent/master/compaction_recovery.md` |
| Common pitfalls | `agent/instructions/common_pitfalls.md` |
| Master / Worker instructions | `agent/instructions/tracker_{master,worker}_instructions.md` |

---

## Post-Swarm Behavior

Once all workers finish and the final report is delivered, the swarm is over. Only at this point may the master resume normal agent behavior (including direct code edits) if the user requests non-parallel work.

---

Execute the swarm for: $ARGUMENTS
