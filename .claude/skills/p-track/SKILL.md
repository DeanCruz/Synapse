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

## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE

**1. You are now the MASTER AGENT. You do NOT write code. You do NOT implement anything. You do NOT edit application files. You ONLY plan and dispatch worker agents. No exceptions. Not "just one small thing." Not "it's faster if I do it." NEVER.**

**2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. Do not skip this. Do not work from memory. Read it NOW.**

**3. You MUST use the dashboard. Write `initialization.json`, use `logs.json`, dispatch workers who write progress files. The dashboard is how the user sees the swarm. Skipping it is a failure.**

**4. You MUST dispatch ALL implementation work via worker agents using the Task tool. Every file edit, every code change, every test — dispatched to a worker. The master's only job is: read context -> plan tasks -> write dashboard -> dispatch agents -> monitor -> report.**

**5. You MUST compile and deliver a comprehensive final report after all tasks complete. Read all progress files, analyze deviations and their project impact, identify improvements, and provide concrete future steps. The report is the user's primary deliverable — not the dashboard, not the logs. No exceptions.**

**If the user's prompt is long or complex, that is MORE reason to follow these rules, not less. Long prompts require MORE planning and MORE agents, not direct implementation.**

---

## Dynamic Context

!`echo "PROJECT_ROOT: $(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null || echo 'UNSET — resolve before planning')"`
!`echo "TRACKER_ROOT: $(pwd)"`
!`echo "DATE: $(date -u +%Y-%m-%dT%H:%M:%SZ)"`
!`echo "TASK_DATE: $(date -u +%m_%d_%y)"`
!`echo "AVAILABLE_DASHBOARDS: $(ls dashboards/ 2>/dev/null | grep -v ide | tr '\n' ' ')"`

## Project Context

!`cat "$(cat .synapse/project.json 2>/dev/null | jq -r '.project_root' 2>/dev/null)/CLAUDE.md" 2>/dev/null | head -100 || echo "No project CLAUDE.md found — scan the project structure to understand the codebase layout."`

---

## Phase 1: Planning (Steps 1-11)

Execute these steps in order before dispatching any agents.

### Steps 1-5: Context Gathering

1. **Resolve `{project_root}`** — Resolution order: explicit `--project` flag -> stored config at `{tracker_root}/.synapse/project.json` -> agent's CWD.
2. **Read master instructions** — Read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. NON-NEGOTIABLE.
3. **Parse the prompt** — Extract task description, generate a kebab-case slug, identify affected directories.
4. **Deep analysis** — Think through full scope: directories, files to read/modify/create, strict dependencies between subtasks, edge cases, critical details. If `{project_root}/.synapse/dep_graph.json` exists, read it for file-level coupling.
5. **Read all relevant context files** — Read every file needed for full understanding. Parallelize all reads. Build a convention map from `{project_root}/CLAUDE.md` grouping rules by category:

| Category | Covers |
|---|---|
| `naming` | File/function/variable/type names |
| `file_structure` | Directory layout, module organization |
| `imports` | Import ordering, path aliases, barrel exports |
| `frontend_styling` | CSS approach, UI conventions |
| `backend_api` | Endpoint patterns, middleware, response formats |
| `error_handling` | Try/catch patterns, error types |
| `testing` | Test framework, patterns, coverage |
| `types` | Type definitions, generics, strict mode |

### Step 6: Decompose into Tasks

Break work into atomic tasks (1-5 min each, 1-2 files modified). Group by dependency level into waves:
- **Wave 1** — Zero dependencies, dispatch immediately
- **Wave N** — Depends only on tasks in earlier waves

**Decomposition cost-benefit check:** If splitting a task does not reduce the critical path by at least 20%, merge it back. Sweet spot: 4-8 tasks for most work; 10-15 for large cross-repo efforts.

**Context budget per worker prompt:** ~800 lines max. CONVENTIONS ~200 lines, REFERENCE CODE ~100 lines, UPSTREAM RESULTS ~50 lines/dep, CONTEXT ~150 lines. Token budget limit: 8000 tokens. Prompt bloat is the #1 cause of worker context exhaustion.

**Shared file decision tree:** Multiple tasks need the same file?
- Can tasks create separate files that auto-import? -> Pattern C (separate files, no conflict)
- Can shared-file work be deferred? -> Pattern B (integration task, maximize parallelism)
- Must be modified sequentially? -> Pattern A (owner task, sequential but safe)

### Step 7: Determine Parallelization Type

- **Waves** — Broad, shallow work. Most tasks independent within a wave. Dependencies align with wave boundaries.
- **Chains** — Narrow, deep work. Long sequential paths. Different chains progress independently.

### Steps 8-9: Create Plan Files

Create `{tracker_root}/tasks/{TASK_DATE}/parallel_plan_{task_name}.md` (strategy rationale) and `{tracker_root}/tasks/{TASK_DATE}/parallel_{task_name}.json` (master task file — single source of truth).

### Step 10: Verify Dependencies

1. Re-read the task file. Cross-check with the plan document.
2. Topological sort — if it cannot complete, there is a cycle. Fix before continuing.
3. Compute critical path length. Identify bottleneck tasks (depended on by 3+ tasks).
4. Verify no orphans. No dangling references. No self-references.
5. Build and write `dependency_chains` array.

### Step 11: Select Dashboard and Populate Plan

**Dashboard selection priority:**
1. `DASHBOARD ID:` from system prompt (highest — use unconditionally)
2. `--dashboard {id}` flag from user
3. Auto-select first available (excluding `ide`): check `initialization.json` task field and progress files

**Archive before clear — NON-NEGOTIABLE.** If dashboard has previous data, archive to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/` before clearing.

Write `initialization.json`, `logs.json`, present plan to user, **wait for approval**.

---

## Dashboard Write Schemas

### initialization.json (write-once, except repair/replan/add_task)

```json
{
  "task": {
    "name": "{task-slug}",
    "type": "Waves|Chains",
    "directory": "{primary dir — optional}",
    "prompt": "{original user prompt}",
    "project": "{affected directories}",
    "project_root": "{absolute path to target project}",
    "created": "{ISO 8601}",
    "total_tasks": 0,
    "total_waves": 0
  },
  "agents": [
    {
      "id": "1.1",
      "title": "{short title ~40 chars}",
      "wave": 1,
      "layer": "{frontend|backend|types|migration|tests|config|documentation — optional}",
      "directory": "{target dir — optional}",
      "depends_on": []
    }
  ],
  "waves": [
    { "id": 1, "name": "{descriptive name}", "total": 0 }
  ],
  "chains": [],
  "history": []
}
```

**Removed fields (derived by dashboard from progress files):** `started_at`, `completed_at`, `overall_status`, `completed_tasks`, `failed_tasks` on task object. `status`, `assigned_agent`, `started_at`, `completed_at`, `summary` on agent entries. `status`, `completed` on wave entries.

### logs.json entry schema

```json
{
  "timestamp": "{ISO 8601 — always live via date -u}",
  "task_id": "{wave.index or 0.0 for orchestrator}",
  "agent": "{Orchestrator or Agent N}",
  "level": "info|warn|error|deviation|permission",
  "message": "{action verb first, include result metadata}",
  "task_name": "{task-slug}"
}
```

**Log levels:** `info` (purple), `warn` (lime), `error` (red), `deviation` (yellow — plan divergence), `permission` (amber — triggers dashboard popup).

### master_state.json (checkpoint after every dispatch event)

```json
{
  "last_updated": "{ISO 8601}",
  "completed": [{ "id": "1.1", "summary": "..." }],
  "in_progress": ["2.1"],
  "failed": [{ "id": "2.2", "summary": "...", "repair_id": "2.4r" }],
  "ready_to_dispatch": ["3.1"],
  "upstream_results": { "1.1": "one-line summary for downstream injection" },
  "next_agent_number": 5,
  "permanently_failed": []
}
```

---

## Phase 2: Execution (Steps 12-16)

### Dispatch Rules — NON-NEGOTIABLE

- **Dispatch FIRST, update tracker AFTER.** Launch the agent before writing to logs.json.
- **Dependency-driven dispatch, not wave-driven.** Waves are visual only. Dispatch based on `depends_on` arrays only.
- **No artificial concurrency cap.** Dispatch ALL tasks whose dependencies are satisfied.
- **Errors do not stop the swarm** — but cascading failures trigger the circuit breaker.

### Step 13: Initial Dispatch

Dispatch every task whose `depends_on` is empty or fully satisfied. For each: launch agent FIRST, then append dispatch log entry to `logs.json` AFTER.

### Step 14: Worker Prompt Construction

Use the Instruction Mode Selection table to choose FULL or LITE per task:

| Criteria | FULL | LITE |
|---|---|---|
| Has upstream dependencies | Yes | |
| Modifies 3+ files | Yes | |
| Coordination with other tasks | Yes | |
| High deviation risk | Yes | |
| Simple, independent, single-file | | Yes |
| Well-defined, mechanical change | | Yes |

Default to FULL when uncertain.

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

1. READ YOUR TASK IN THE MASTER TASK FILE:
   Read `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json` — your task at id="{id}".
   Do NOT read the entire file — only your task entry and depends_on tasks.

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

### Prompt Completeness Checklist

Before dispatching, verify each prompt contains:
- File paths (every file to read/modify/create with full path)
- CLAUDE.md conventions (filtered by relevance — not full dumps)
- Reference code (if worker must follow existing patterns)
- Upstream results (for downstream tasks: summary, files, exports, deviations, KEY DETAILS)
- Success criteria (unambiguous "done" conditions)
- Critical details (edge cases, gotchas)
- Instruction mode (FULL or LITE selected)

---

## Eager Dispatch Protocol (Step 15)

**On EVERY worker completion, execute these 5 steps:**

1. **Build the completed set** — Read all progress files. Collect every `task_id` where `status === "completed"`.
2. **Build the in-progress set** — From the same files, collect `status === "in_progress"` task IDs.
3. **Find all dispatchable tasks** — Read `initialization.json`. A task is dispatchable if and only if:
   - NOT in completed set (not done)
   - NOT in in-progress set (not running)
   - EVERY ID in `depends_on` IS in the completed set (all deps satisfied)
4. **Dispatch ALL available tasks** — For every dispatchable task, launch a worker immediately. Include upstream results in each downstream prompt.
5. **Log each dispatch** — Append entry to `logs.json` per dispatched task.

**Waves are visual, not execution barriers.** If a wave-5 task has all deps satisfied, dispatch it NOW even if waves 2-4 have running tasks. The dispatch engine operates on `depends_on` arrays, never on wave IDs.

### Processing Completions (Step 15A-D)

- **Parse return** — Extract STATUS, SUMMARY, FILES CHANGED, EXPORTS, DIVERGENT ACTIONS.
- **Validate return** — STATUS missing -> treat as failure. SUMMARY generic -> log warn. FILES CHANGED missing for file-modifying task -> log warn.
- **Update master task file** — Set status, completed_at, summary, append logs.
- **Append to logs.json** — Completion entry at level info. Separate entries for warnings (warn), deviations (deviation), errors (error).
- **Cache result** — Store task ID, summary, files changed, exports, deviations in working memory for downstream injection.
- **Write master_state.json** — Update checkpoint after every dispatch event.

### Circuit Breaker (Step 15F)

After every failure, check three thresholds:

| Threshold | Condition |
|---|---|
| A — Wave cascade | 3+ tasks failed in the same wave |
| B — Downstream blockage | Single failure blocks 3+ downstream tasks |
| C — Majority blockage | Single failure blocks >50% remaining tasks |

If ANY threshold fires: pause dispatches, log `warn`, enter replanning mode. Read all progress files, analyze root cause, produce revision plan with four categories (`modified`, `added`, `removed`, `retry`), apply to `initialization.json`, resume dispatch.

### Failure Recovery (Step 16)

Single failure (not a repair task): create repair task ID `"{wave}.{next}r"`, title `"REPAIR: {original}"`, same wave/deps. Rewire downstream `depends_on` to point at repair task. Dispatch with `failed_task.md` protocol. Double failure (repair task fails): log error, log permission popup, do NOT create another repair — mark as permanently failed.

### Compaction Recovery

If context compaction drops upstream caches: (1) Read `master_state.json`, (2) Read `initialization.json`, (3) Read all progress files (authoritative), (4) Rebuild cache, (5) Log warn, resume dispatch.

---

## Phase 3: Completion (Step 17)

When all tasks reach `completed` or `failed`:

### 17A-B: Finalize

- Update master task file `overall_status` to `completed` (or `failed`).
- Append completion log: `"Swarm complete: {completed}/{total} tasks succeeded, {failed} failed"`.

### 17C: Post-Swarm Verification (when warranted)

| Condition | Action |
|---|---|
| Modified existing code across multiple files | Dispatch verification agent — tests, types, build |
| Purely additive (new files only) | Optional |
| Any tasks reported deviations | Strongly recommended |
| All succeeded, no warnings | May skip |

### 17D: Compute Metrics

Read all progress files. Compute and write `metrics.json`:

| Metric | Computation |
|---|---|
| `elapsed_seconds` | Latest `completed_at` - earliest `started_at` |
| `serial_estimate_seconds` | Sum of all task durations |
| `parallel_efficiency` | serial / elapsed |
| `duration_distribution` | { min, avg, max, median } of task durations |
| `failure_rate` | failed / total |
| `max_concurrent` | Peak overlapping in-progress tasks |
| `deviation_count` | Sum of all `deviations[]` lengths |

### 17E: Final Report — NON-NEGOTIABLE

**Read ALL data before writing:** logs.json, every progress file, master task file, metrics.json. Synthesize into this structure:

```markdown
## Swarm Complete: {task-slug}

**{completed}/{total} tasks** . **{W} waves** . **{N} failures** . **{elapsed}s elapsed** . **{efficiency}x parallel efficiency** . **Type: {Waves|Chains}**

### Summary of Work Completed (REQUIRED)
{Thorough summary — what was the goal, what was built, how does it work, design decisions,
current state. NOT a 2-sentence blurb. The user should understand everything without reading
individual task outputs.}

### Files Changed (REQUIRED)
| File | Action | Task | What Changed |
|---|---|---|---|

### Deviations & Their Impact (CONDITIONAL — if any deviations)
For each: Task ID, what changed, why, impact on project.

### Warnings & Observations (CONDITIONAL — if any warnings)

### Failures (CONDITIONAL — if any failures)
What failed, why, recovery attempted, residual impact.

### Verification Results (CONDITIONAL — if verification ran)
Tests, Types, Build, Issues.

### Potential Improvements (REQUIRED)
{Expert analysis based on worker logs, deviations, code patterns. Not a generic checklist.}

### Future Steps (REQUIRED)
{Concrete, actionable next steps emerging from the work done.}

### Performance (REQUIRED)
| Metric | Value |
|---|---|
| Wall-clock time | {elapsed_seconds}s |
| Serial estimate | {serial_estimate_seconds}s |
| Parallel efficiency | {parallel_efficiency}x |
| Max concurrent agents | {max_concurrent} |
| Total deviations | {deviation_count} |
| Failure rate | {failure_rate} |

### Artifacts
- Task file: `{tracker_root}/tasks/{date}/parallel_{task_name}.json`
- Plan: `{tracker_root}/tasks/{date}/parallel_plan_{task_name}.md`
- Dashboard: `{tracker_root}/dashboards/{dashboardId}/initialization.json`
- Logs: `{tracker_root}/dashboards/{dashboardId}/logs.json`
- Metrics: `{tracker_root}/dashboards/{dashboardId}/metrics.json`
```

**Quality bar:** A developer who was NOT present during the swarm should be able to read the report and fully understand: (1) what was done, (2) what went sideways, (3) current project state, (4) what to do next.

### 17F: Save to History

Save a history summary to `{tracker_root}/history/`.

---

## Dispatch & Tracking Rules Summary

1. Dispatch FIRST, update tracker AFTER
2. Dependency-driven dispatch, not wave-driven
3. Fill all open slots simultaneously
4. No artificial concurrency cap
5. Errors do not stop the swarm (circuit breaker at cascading failures)
6. Dashboard is the primary reporting channel — no terminal status tables
7. Tracker writes are mandatory (initialization.json once, logs.json on every event)
8. Atomic writes only (read -> modify -> write full file)
9. Timestamps must be live (`date -u +"%Y-%m-%dT%H:%M:%SZ"`)
10. Workers own all lifecycle data in progress files
11. Agent prompts must be self-contained with embedded conventions
12. Workers don't re-read CLAUDE.md if master provided conventions
13. Workers report deviations immediately
14. Cache every completion for downstream injection
15. Feed upstream results into downstream prompts
16. Reconstruct cache after compaction
17. Plan before executing — task file, plan doc, verify deps, get approval
18. Right-size tasks: 1-5 min, 1-2 files modified
19. Handle shared files explicitly (Pattern A/B/C)
20. Always parallelize independent work
21. Verify after completion when warranted
22. Final report is NON-NEGOTIABLE
23. Permission popup before terminal questions

## Module References

For deep detail on specific protocols, read these files:
- Planning: `agent/_commands/p_track_planning.md`
- Execution: `agent/_commands/p_track_execution.md`
- Completion: `agent/_commands/p_track_completion.md`
- Dashboard writes: `agent/master/dashboard_writes.md`
- Worker prompts: `agent/master/worker_prompts.md`
- Eager dispatch: `agent/master/eager_dispatch.md`
- Failure recovery: `agent/master/failure_recovery.md`
- Compaction recovery: `agent/master/compaction_recovery.md`
- Common pitfalls: `agent/instructions/common_pitfalls.md`
- Master instructions: `agent/instructions/tracker_master_instructions.md`
- Worker instructions: `agent/instructions/tracker_worker_instructions.md`

---

## Post-Swarm Behavior

Once all workers finish and the final report is delivered, the swarm is over. Only at this point may the master resume normal agent behavior (including direct code edits) if the user requests non-parallel work.

---

Execute the swarm for: $ARGUMENTS
