# `!p_track_resume [--dashboard {id}]`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are the MASTER AGENT. You do NOT write code. You do NOT implement anything. You do NOT edit application files. You ONLY assess state, communicate with agents, and dispatch worker agents. No exceptions.**
>
> **2. You MUST read ALL master instruction documents listed in Phase 0 before taking any action. Do not skip this. Do not work from memory. Read them NOW.**
>
> **3. You MUST read the master task file to understand the full plan, task descriptions, context, and critical details before dispatching any worker.**
>
> **4. Every dispatched worker gets a COMPLETE, SELF-CONTAINED prompt with all context needed to work independently — identical in quality and depth to what `!p_track` would produce.**
>
> **5. Every dispatched worker is explicitly instructed to read the appropriate worker instructions file (`tracker_worker_instructions.md` or `tracker_worker_instructions_lite.md`). This is NON-NEGOTIABLE.**
>
> **6. You MUST compile and deliver a comprehensive final report after all tasks complete. No exceptions. See Phase 5.**
>
> **7. You MUST attempt to detect whether previously dispatched agents are still alive before re-dispatching them. Do not blindly re-dispatch everything — check progress file recency first.**

**Purpose:** Comprehensive resume of a stalled, interrupted, or partially completed `!p_track` swarm. The invoking agent becomes the master agent — responsible for reconstructing the full swarm state from disk, determining which agents are alive vs stale, re-dispatching where necessary, dispatching all tasks with cleared dependencies, and running the full execution-to-completion lifecycle including the NON-NEGOTIABLE final report.

**This command is the complete "pick up where we left off" operation.** It combines state reconstruction, agent health assessment, upstream result cache rebuilding, eager dispatch, failure recovery, and the full `!p_track` completion phase into a single command.

**Syntax:**
- `!p_track_resume` — Auto-detect the dashboard to resume
- `!p_track_resume --dashboard a3f7k2` — Resume a specific dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

**Use cases:**
- The master agent's session was interrupted (user stopped it, context exhaustion, crash)
- Workers were killed or timed out without completing
- The user wants to restart failed tasks alongside dispatching pending ones
- A swarm was partially completed and needs to be finished
- Context compaction dropped the master's cached state mid-swarm

---

## Phase 0: Read Core Instructions — NON-NEGOTIABLE

**Before any state assessment or dispatch, read ALL of these documents.** This is not optional. The master cannot correctly update dashboards, construct worker prompts, handle failures, or perform eager dispatch without reading these files. Do not work from memory — read them every time.

Read these files **in parallel** where possible:

| Priority | File | Why |
|---|---|---|
| **REQUIRED** | `{tracker_root}/CLAUDE.md` | Synapse protocols, path conventions, master agent rules |
| **REQUIRED** | `{tracker_root}/agent/instructions/tracker_master_instructions.md` | Master hub — dashboard field mappings, write protocols, module index |
| **REQUIRED** | `{tracker_root}/agent/master/dashboard_writes.md` | Complete schemas for `initialization.json`, `logs.json`, progress files, `master_state.json`, `metrics.json` — write timing and rules |
| **REQUIRED** | `{tracker_root}/agent/master/eager_dispatch.md` | The 5-step dispatch mechanism, wave vs dependency semantics, common mistakes |
| **REQUIRED** | `{tracker_root}/agent/master/worker_prompts.md` | Full worker prompt template, instruction mode selection, context budgeting, convention filtering, completeness checklist |
| **REQUIRED** | `{tracker_root}/agent/master/compaction_recovery.md` | Master state checkpoint schema, recovery procedure, metrics computation |
| **REQUIRED** | `{tracker_root}/agent/master/failure_recovery.md` | Repair task creation, dependency rewiring, circuit breaker, worker return validation |

**Verification gate:** Before proceeding to Phase 1, confirm you have read all 7 documents. If any file is missing or unreadable, log a warning and proceed — but do NOT skip this phase entirely.

---

## Phase 1: State Reconstruction

### Step 1: Resolve the dashboard

**If `{dashboardId}` was specified:** Use it directly.

**If no dashboard was specified (auto-detect):**
1. Scan all dashboards (excluding `ide`, which is reserved for the IDE agent).
2. For each dashboard, read `{tracker_root}/dashboards/{dashboardId}/initialization.json`:
   - If `task` is `null` → **empty**. Skip — nothing to resume.
   - If `task` is not null → candidate. Read all progress files from `progress/`.
     - If **every** progress file has `status: "completed"` → **fully done**. Skip.
     - If **any** progress file has `status: "in_progress"`, `"failed"`, or is **missing** (task exists in `agents[]` but has no progress file) → **resumable**. Select this dashboard.
3. If no resumable dashboard is found, report: "No dashboards have incomplete swarms to resume." and list all dashboard states.

### Step 2: Read the full dashboard state

Read these **in parallel**:

1. **`{tracker_root}/dashboards/{dashboardId}/initialization.json`** — The full plan: task metadata, agents array, waves, chains, and `task.project_root`.
2. **All progress files** from `{tracker_root}/dashboards/{dashboardId}/progress/` — Build a status map: `{ task_id → { status, summary, deviations, logs, started_at, completed_at, stage, milestones } }`.
3. **`{tracker_root}/dashboards/{dashboardId}/logs.json`** — Event history for context. Note the last event timestamp and the last agent number used.
4. **`{tracker_root}/dashboards/{dashboardId}/master_state.json`** (if exists) — Previous master's cached state: completed tasks, in-progress tasks, failed tasks, upstream results cache, `next_agent_number`, permanently failed tasks.

### Step 3: Locate and read the master task file

The master task file contains the full task descriptions, context, critical details, and file lists that workers need.

1. Extract `task.name` from `initialization.json` (the task slug).
2. Extract `task.created` to determine the date directory.
3. Look for the task file at: `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
   - If not found, search: `{tracker_root}/tasks/*/parallel_{task_name}.json`
   - If still not found, check `{tracker_root}/tasks/` for any task files matching the task name pattern.
4. **Read the full master task file.** You need every task's `description`, `context`, `critical`, `files`, `tags`, and `depends_on`.

### Step 4: Read project context

1. **Resolve `{project_root}`** from `task.project_root` in `initialization.json`. If not present, resolve using the standard resolution order (see `{tracker_root}/CLAUDE.md` — Path Convention section).
2. **Read `{project_root}/CLAUDE.md`** if it exists — you need project conventions for worker prompts.
3. If `{project_root}/.synapse/toc.md` exists, read it for orientation.
4. **Build the convention map** from the project CLAUDE.md — categorize conventions into `naming`, `file_structure`, `imports`, `frontend_styling`, `backend_api`, `error_handling`, `testing`, `types` as described in `{tracker_root}/agent/master/worker_prompts.md`. This map is used to filter conventions per-worker during prompt construction.

### Step 5: Rebuild upstream result cache

The previous master's cached upstream results may be lost (session death or context compaction). Rebuild them from the authoritative sources:

1. **Start with `master_state.json`** (if it exists) — its `upstream_results` field contains one-line summaries per completed task. This is the best available cache from the previous master session.

2. **Cross-reference against progress files** (progress files are authoritative if they conflict with `master_state.json`):
   - For each task with a progress file showing `status: "completed"`, verify the cache has an entry.
   - If missing from cache, reconstruct from the progress file's `summary`, `milestones[]`, and `deviations[]`.
   - Extract file change information from milestones where possible (progress files do not contain `FILES CHANGED` directly — that data comes from the worker's return to the master and may be lost).

3. **If no `master_state.json` exists**, build the entire cache from scratch by reading all completed progress files.

4. **Determine `next_agent_number`:**
   - If `master_state.json` exists, use its `next_agent_number`.
   - Otherwise, scan `logs.json` for the highest `"Agent {N}"` reference and set `next_agent_number` to N+1.
   - If logs are empty, set to 1.

5. Log the cache rebuild to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
   ```json
   {
     "timestamp": "{live timestamp via date -u}",
     "task_id": "0.0",
     "agent": "Orchestrator",
     "level": "info",
     "message": "Resume: rebuilt upstream cache from {N} completed progress files. master_state.json: {found | not found}.",
     "task_name": "{task-slug}"
   }
   ```

---

## Phase 2: Agent Health Check & Task Classification

> **Do not blindly re-dispatch everything.** The previous master session is dead, but dispatched worker agents may still be alive and actively working. Clobbering a running worker by deleting its progress file and re-dispatching causes wasted computation and potential file conflicts.

### Step 6: Check agent health

For each task with a progress file showing `status: "in_progress"`, assess whether the worker is likely still alive:

**Alive indicators (ANY of these suggest the agent is still running):**
- The progress file's most recent `milestones[]` entry has a timestamp within the last **10 minutes**
- The progress file's most recent `logs[]` entry has a timestamp within the last **10 minutes**
- The `stage` field shows active work (`implementing`, `testing`) and the file was modified recently

**Stale indicators (ALL of these suggest the agent is dead):**
- No milestone or log entry within the last **10 minutes**
- The `started_at` timestamp is more than **20 minutes** old with no recent updates
- The `stage` is still `reading_context` or `planning` after more than **10 minutes**
- The progress file has not been modified since the previous master session died (compare against the last `logs.json` entry from the previous session)

**Classification decision:**
| Evidence | Classification | Action |
|---|---|---|
| Recent milestone/log within 10 min | **Likely alive** | Monitor — do NOT re-dispatch. Wait for return or timeout. |
| No recent activity, but started < 20 min ago | **Uncertain** | Monitor for 2-3 minutes. If no progress file update occurs, reclassify as stale. |
| No recent activity, started > 20 min ago | **Stale** | Mark for re-dispatch. Save progress file contents for retry context. |
| Progress file shows `stage: "completed"` but `status: "in_progress"` | **Likely completed** | Treat as completed — the worker finished but the master never processed the return. |

### Step 7: Classify every task

For each agent in `initialization.json`'s `agents[]` array, classify it:

| Category | Condition | Action |
|---|---|---|
| **Completed** | Progress file exists with `status: "completed"` | Skip — already done. Cache the result for downstream injection. |
| **Failed** | Progress file exists with `status: "failed"` | Mark for re-dispatch with failure context (like `!retry`). |
| **Likely Alive** | Progress file shows `in_progress` with recent activity (Step 6) | Monitor — do NOT re-dispatch. Include in the "monitoring" set. |
| **Stale In-Progress** | Progress file shows `in_progress` with no recent activity (Step 6) | Mark for re-dispatch with partial progress context. |
| **Pending (ready)** | No progress file AND all `depends_on` tasks are completed | Dispatch immediately. |
| **Pending (blocked)** | No progress file AND some `depends_on` tasks are NOT completed | Wait — will dispatch after dependencies complete. |

### Step 8: Present the resume plan

Display a comprehensive summary showing the state of the swarm and what will happen:

```markdown
## Resume Plan: {task-slug}

**Dashboard:** {dashboardId}
**Project:** {project_root}
**Task file:** {path to master task file}
**master_state.json:** {found | not found}
**Upstream cache:** {N entries rebuilt from {source}}

### Current State
| Status | Count | Tasks |
|---|---|---|
| Completed | {N} | {task_ids} |
| Failed (will retry) | {N} | {task_ids} |
| Likely alive (monitoring) | {N} | {task_ids} |
| Stale in-progress (will re-dispatch) | {N} | {task_ids} |
| Pending (ready to dispatch) | {N} | {task_ids} |
| Pending (blocked) | {N} | {task_ids} |

### Will Dispatch Now: {total count}
{List each task to be dispatched with its ID, title, and reason (retry/re-dispatch/new)}

### Monitoring: {count}
{List agents that appear alive with their current stage and last activity time}

### Still Blocked: {count}
{List blocked tasks and what they're waiting for}
```

**Wait for user approval before dispatching.**

---

## Phase 3: Cleanup, Dispatch & Monitor

### Step 9: Clean up stale progress files

For each task being re-dispatched (failed or stale in-progress):

1. **Save the previous progress file contents** in working memory — you need the failure summary, logs, deviations, and stage information for the worker's retry context.
2. **Delete the old progress file:**
   ```bash
   rm -f {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
   ```
   The new worker will create a fresh one.

**Do NOT delete progress files for "likely alive" agents.** They are still running.

### Step 10: Build worker prompts with full context

For **each task to be dispatched**, build a complete, self-contained prompt using the **exact same template** from `{tracker_root}/agent/master/worker_prompts.md`. Every worker prompt MUST include:

```
You are a worker agent in the "{task-slug}" swarm, executing task {id}.
TEMPLATE_VERSION: p_track_v2

═══════════════════════════════════
TASK {id}: {title}
═══════════════════════════════════

DESCRIPTION:
{detailed description from master task file}

CONTEXT:
{all context from master task file}

PROJECT ROOT: {project_root}
TRACKER ROOT: {tracker_root}

CONVENTIONS:
{Filtered from the convention_map built in Step 4 — include ONLY categories relevant to
this specific task per the Convention Relevance Checklist in worker_prompts.md.
Quote directly from the project CLAUDE.md — do not paraphrase.
Omit section entirely if no CLAUDE.md exists.}

REFERENCE CODE:
{Working examples from the codebase that the worker should follow as patterns.
Read the actual source files referenced in the task's <files> list to extract relevant patterns.
If the task modifies an existing file, include the current state of the sections being modified.
Omit section if no reference patterns apply.}

UPSTREAM RESULTS:
{For each completed dependency task, use the structured format from worker_prompts.md:
--- Dependency: Task {dep_id} — {dep_title} ---
STATUS: completed
SUMMARY: {from upstream cache or progress file}
FILES CHANGED: {from cache if available, or "unavailable — check milestones"}
NEW EXPORTS: {if available}
DEVIATIONS: {none | list}
KEY DETAILS: {1-2 sentences of specific technical facts this worker needs}
--- End Dependency ---

This is CRITICAL for resume — upstream tasks are already completed and their
results define what this worker should build on. Read the actual upstream
progress files to get ground truth, not stale plan data.}

SIBLING TASKS:
{Optional — include when same-wave tasks modify related areas of the codebase.
Omit entirely if no same-wave siblings overlap.}

CRITICAL:
{critical details from master task file — omit section if empty}

SUCCESS CRITERIA:
{Exactly what "done" looks like — specific, verifiable conditions.}

FILES:
{list each file with its action}
  - READ:   {path}
  - MODIFY: {path}
  - CREATE: {path}

DIRECTORY: {working directory}

═══════════════════════════════════
RESUME CONTEXT
═══════════════════════════════════

NOTE: This is a RESUMED swarm. Some tasks have already been completed by previous workers.
The project may already contain files created by earlier tasks. Read the actual file state
before making changes — do not assume files are in their pre-swarm state.

{If this is a RETRY of a failed or stale task, include:}
PREVIOUS ATTEMPT:
This task was previously attempted and {failed | was interrupted mid-execution}.

Previous status: {status from old progress file}
Previous stage reached: {stage from old progress file}
Previous summary: {summary from old progress file, if any}

Previous milestones:
{Key milestones from the old progress file — what was accomplished before interruption}

Previous logs:
{Key log entries from the old progress file that provide context about what
the previous worker accomplished and where it failed/stopped}

Previous deviations:
{Any deviations the previous worker reported}

ROOT CAUSE ANALYSIS:
{Master's analysis of what went wrong — read the old progress file logs carefully
and the actual project files to determine the root cause. For stale tasks, note
that the worker may have been interrupted mid-implementation — check the actual
file state to see what was partially completed. Include specific guidance
on how to avoid the same failure or how to continue from the partial state.}

REMEDIATION GUIDANCE:
{Specific instructions based on the root cause analysis. Reference actual file
contents, correct import paths, proper function signatures, etc. For stale tasks
interrupted mid-implementation, instruct the worker to check what was already
written and continue from there rather than starting over.}
{End retry section}

═══════════════════════════════════
PREPARATION — REQUIRED BEFORE STARTING WORK
═══════════════════════════════════

Before writing any code, complete these steps in order:

1. READ YOUR TASK IN THE MASTER TASK FILE:
   Read `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json` — specifically your task at id="{id}".
   Focus on: your task's full description, context, critical details, and dependency relationships.
   Do NOT read the entire task file — only your task entry and any tasks listed in your depends_on.

2. READ PROJECT INSTRUCTIONS (only if not already provided above):
   If the CONVENTIONS section above is empty or says "no CLAUDE.md", check if a CLAUDE.md file
   exists at {project_root}/CLAUDE.md or in the target directory and read it. If conventions were
   already provided above, skip this step — do not re-read what the master already extracted for you.
   NOTE: Your code work happens in {project_root}. Your progress reporting goes to {tracker_root}.

3. CHECK ACTUAL FILE STATE:
   Since this is a resumed swarm, files may have been modified by previously completed tasks
   or partially modified by a previous interrupted worker on this same task.
   Read the current state of any files you need to modify BEFORE making changes.
   Do not assume the file matches the pre-swarm state described in the task plan.

4. READ UPSTREAM DEPENDENCY PROGRESS FILES:
   For each task ID in your depends_on list, read:
   {tracker_root}/dashboards/{dashboardId}/progress/{dependency_task_id}.json
   Extract: status, summary, deviations, and key log entries.
   Adapt your approach based on what upstream workers actually did.

5. READINESS CHECKLIST — verify each item before writing code:
   [ ] I have listed every file path I will modify or create (write them in a milestone)
   [ ] I have read at least one existing file that follows the pattern I need to replicate
   [ ] I can state in one sentence what this task produces (write it in a milestone)
   [ ] For each file I will modify, I have read it and confirmed it exists at the expected path
   [ ] If this task has upstream dependencies, I have reviewed the UPSTREAM RESULTS section
       and confirmed the files/exports I depend on exist

   If any item fails:
   - Missing file path -> Glob for it, log the discovery as a milestone
   - No pattern reference -> Read the closest similar file, log it
   - Upstream export missing -> Log as a deviation and report in your return
   - After 3 additional file reads without resolution -> report as a blocker, do not read further

═══════════════════════════════════
LIVE PROGRESS REPORTING — NON-NEGOTIABLE
═══════════════════════════════════

You MUST report your progress throughout execution. This is how the dashboard shows real-time updates.

INSTRUCTION MODE: {FULL | LITE}

{If FULL:}
FIRST: Read the worker instructions file:
  {tracker_root}/agent/instructions/tracker_worker_instructions.md

Follow those instructions EXACTLY. They contain the full progress file schema,
required reporting points, log format, and examples.

{If LITE:}
FIRST: Read the lite worker instructions file:
  {tracker_root}/agent/instructions/tracker_worker_instructions_lite.md

Follow those instructions EXACTLY. They contain the streamlined progress file schema
and required reporting points for simple tasks.

YOUR PROGRESS FILE: {tracker_root}/dashboards/{dashboardId}/progress/{id}.json
YOUR TASK ID: {id}
YOUR AGENT LABEL: Agent {N}

Include the TEMPLATE_VERSION value from the top of this prompt as `template_version` in your progress file on every write.

You own this file exclusively. Write the FULL file on every update.
The dashboard watches it and displays your progress in real-time.

═══════════════════════════════════
DEVIATION REPORTING — MANDATORY
═══════════════════════════════════

If you deviate from the original plan in ANY way, you MUST report it immediately.
See `{tracker_root}/agent/instructions/tracker_worker_instructions.md` for the full deviation
reporting protocol, including the progress file format and required fields.

Deviations must also be included in your final return to the master agent (DIVERGENT ACTIONS section).
Failing to report a deviation is a failure of this task.

═══════════════════════════════════
EXECUTION RULES
═══════════════════════════════════

1. Only modify files listed above. If you discover additional files need changes, log it
   in your summary and as a deviation — do not modify them unless absolutely required.
2. Do not refactor, clean up, or improve anything not directly required by this task.
3. If you encounter an unexpected state (missing file, conflicting implementation,
   ambiguous requirement), note it in your summary as a WARN and in a milestone.
4. Since this is a RESUMED swarm, be extra careful about file state. Check for:
   - Files that were partially modified by a previous interrupted worker
   - Files that were fully completed by upstream tasks
   - Merge conflicts or inconsistencies from concurrent previous edits

═══════════════════════════════════
RETURN FORMAT
═══════════════════════════════════

When complete, return a structured report in this exact format:

STATUS: completed | failed
SUMMARY: {one-sentence description of what was done}
FILES CHANGED:
  - {path} ({created | modified | deleted})
EXPORTS: (omit entirely if no new exports were introduced)
  - {type: function|type|interface|endpoint|constant|file} {name} — {brief description}
DIVERGENT ACTIONS: (omit entirely if none — include if ANY deviation from the plan occurred)
  - {what was different from the plan and why}
WARNINGS: (omit entirely if none)
  - {description of unexpected finding or issue}
ERRORS: (omit entirely if none)
  - {description of error that prevented completion}
```

#### Prompt Completeness Checklist

Before dispatching each agent, verify the prompt contains ALL of these:

| Required Element | Check |
|---|---|
| **File paths** | Every file to read/modify/create is listed with full relative path |
| **CLAUDE.md conventions** | Relevant sections quoted directly from the target repo's CLAUDE.md |
| **Conventions filtered by relevance** | Only categories relevant to this specific task (per convention_map) |
| **Reference code** | Working example included if the worker must follow an existing pattern |
| **Upstream results** | Summary, files changed, deviations from each completed dependency |
| **Resume context** | Previous attempt details if retrying a failed/stale task |
| **Actual file state** | Instruction to check current file state before modifying |
| **Success criteria** | Worker can unambiguously determine when the task is done |
| **Critical details** | Edge cases, gotchas, and non-obvious constraints explicitly stated |
| **Both paths** | `{tracker_root}` AND `{project_root}` are in the prompt |
| **Dashboard ID** | `{dashboardId}` is in the prompt for progress file path |
| **Worker instructions** | Worker is told to read `tracker_worker_instructions.md` or `tracker_worker_instructions_lite.md` |
| **Instruction mode** | FULL or LITE is selected based on task complexity |

### Step 11: Dispatch all ready tasks

Dispatch **every task classified as "ready"** (failed retries, stale re-dispatches, and pending with satisfied dependencies) **simultaneously**. Follow the exact dispatch sequence from `!p_track`:

#### A. Launch the agent FIRST

Dispatch the Task agent with the full prompt from Step 10. The agent is now running.

#### B. Update tracker AFTER dispatch (NON-NEGOTIABLE)

**Only after the agent has been dispatched**, update the tracker files:

1. Run `date -u +"%Y-%m-%dT%H:%M:%SZ"` to get the current timestamp.

2. Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
   ```json
   {
     "timestamp": "{captured timestamp}",
     "task_id": "{id}",
     "agent": "Agent {N}",
     "level": "info",
     "message": "Resumed: {task title} ({reason: retry | re-dispatch | new})",
     "task_name": "{task-slug}"
   }
   ```
   Write back.

#### C. Write master state checkpoint

After all dispatches, write `{tracker_root}/dashboards/{dashboardId}/master_state.json` with the current state:
```json
{
  "last_updated": "{live timestamp}",
  "completed": [{completed tasks with summaries}],
  "in_progress": ["{dispatched + monitoring task IDs}"],
  "failed": [{failed tasks not yet retried}],
  "ready_to_dispatch": [],
  "upstream_results": {rebuilt cache},
  "next_agent_number": {N},
  "permanently_failed": [{double-failed task IDs}]
}
```

**Output a brief one-line confirmation per dispatch batch** (e.g., "Resumed 4 tasks: 1.2 (retry), 2.1 (re-dispatch), 2.3 (new), 2.4 (new). Monitoring 1 alive agent: 1.3").

---

## Phase 4: Execution Loop — Standard `!p_track` Protocol

From this point, follow the **exact same execution loop** as `!p_track` Phase 2. You are now the master orchestrator for this swarm.

### Step 12: Process completions and dispatch immediately

1. **Every time a worker completes**, parse its return using the worker return validation protocol from `{tracker_root}/agent/master/failure_recovery.md`:
   - Validate STATUS (required — if missing, treat as failure)
   - Validate SUMMARY (required — warn if generic)
   - Validate FILES CHANGED (conditional — warn if expected but missing)
   - Process DIVERGENT ACTIONS (log at "deviation" level)

2. **Update the master task file** with completion status, timestamp, summary, and any deviations.

3. **Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:**
   ```json
   {
     "timestamp": "{ISO 8601}",
     "task_id": "{id}",
     "agent": "Agent {N}",
     "level": "info",
     "message": "Completed: {task title} — {SUMMARY}",
     "task_name": "{task-slug}"
   }
   ```

4. **Cache the result** for downstream injection — store task ID, summary, files changed, exports, deviations.

5. **Run the eager dispatch scan** per `{tracker_root}/agent/master/eager_dispatch.md`:
   - Build the completed set from progress files
   - Build the in-progress set from progress files
   - Find all dispatchable tasks (not completed, not in-progress, all depends_on satisfied)
   - Dispatch ALL available tasks simultaneously with full prompts
   - Include upstream results for each completed dependency using the structured format

6. **Write master state checkpoint** after every event.

**Do NOT display terminal status tables.** Output only brief one-line confirmations per event. The dashboard is the primary reporting channel.

### Step 13: Handle monitoring agents

For agents classified as "likely alive" in Step 6:

1. **If a monitored agent completes normally** — process its return exactly like any other completion (Step 12). Run the eager dispatch scan.

2. **If a monitored agent's progress file stops updating** (no change for 10+ minutes after being classified as alive):
   - Reclassify as stale.
   - Save the progress file contents for retry context.
   - Delete the progress file.
   - Build a full worker prompt with RESUME CONTEXT and PREVIOUS ATTEMPT sections.
   - Dispatch a new worker.
   - Log the re-dispatch.

3. **If a monitored agent fails** — follow the standard failure recovery procedure from `{tracker_root}/agent/master/failure_recovery.md` (create repair task, rewire dependencies, dispatch repair worker).

### Step 14: Handle failures

Follow the complete failure recovery protocol from `{tracker_root}/agent/master/failure_recovery.md`:

1. **Single task failure:** Create a repair task (ID format: `{wave}.{next_idx}r`), rewire dependencies, dispatch repair worker with `{tracker_root}/agent/instructions/failed_task.md` protocol.

2. **Double failure (repair task fails):** Log the permanent failure. Do NOT create another repair. Request manual intervention via `"permission"` level log entry. Continue with unrelated tasks.

3. **Circuit breaker:** Evaluate after every failure:
   - **Threshold A:** 3+ tasks failed in the same wave
   - **Threshold B:** Single failure blocks 3+ downstream tasks
   - **Threshold C:** Single failure blocks >50% remaining tasks

   If ANY threshold is hit: pause dispatches, analyze root cause, produce a revision plan (`modified`/`added`/`removed`/`retry`), apply to `initialization.json`, log, resume.

### Step 15: Handle context compaction

If context compaction occurs during the execution loop (detected by losing cached upstream results for completed tasks):

1. Follow the compaction recovery procedure from `{tracker_root}/agent/master/compaction_recovery.md`:
   - Read `master_state.json` for the last checkpoint
   - Read `initialization.json` for the full plan
   - Read all progress files (ground truth — authoritative over checkpoint)
   - Cross-reference and rebuild the upstream result cache
   - Log the recovery
   - Resume dispatch

2. This is why `master_state.json` is written after every event — it exists for exactly this scenario.

---

## Phase 5: Completion — Verify, Report & Metrics — NON-NEGOTIABLE

When all tasks reach `"completed"` or `"failed"`:

**Follow the EXACT completion protocol from `{tracker_root}/agent/_commands/p_track_completion.md` — Steps 17A through 17F.** Every step is mandatory.

### Step 16A: Update the master task file

Set `overall_status` to `"completed"` (or `"failed"` if any tasks failed without recovery).

### Step 16B: Append final log entry

```json
{
  "timestamp": "{live timestamp via date -u}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Swarm resumed and completed: {completed}/{total} tasks succeeded, {failed} failed",
  "task_name": "{task-slug}"
}
```

### Step 16C: Post-swarm verification (when warranted)

| Condition | Verification |
|---|---|
| Modified existing code across multiple files | Dispatch a verification agent — run tests, type check, build |
| Purely additive (new files only, no modifications) | Verification optional |
| Any tasks reported deviations | Verification strongly recommended |
| All tasks succeeded with no warnings | May skip verification |

If verification is needed, dispatch a verification agent per the protocol in `p_track_completion.md` Step 17C.

### Step 16D: Compute swarm metrics

Compute metrics and write to `{tracker_root}/dashboards/{dashboardId}/metrics.json` per the protocol in `p_track_completion.md` Step 17D.

### Step 16E: Compile and deliver final report — NON-NEGOTIABLE

> **The master MUST compile and deliver a comprehensive final report after every swarm. No exceptions. This is not optional. Do not skip it. Do not abbreviate it. The report is the user's primary artifact for understanding what happened, what changed, and what to do next.**

**Data gathering — read ALL of these before writing the report:**

1. **Read `{tracker_root}/dashboards/{dashboardId}/logs.json` in full** — analyze all entries for the current task.
2. **Read every progress file** in `{tracker_root}/dashboards/{dashboardId}/progress/` — extract summaries, deviations, milestones, warnings, and logs from each worker.
3. **Read the master task file** — cross-reference planned vs. actual outcomes.
4. **Read `{tracker_root}/dashboards/{dashboardId}/metrics.json`** — include performance data.

**Synthesize all gathered data into a report with the following structure. Every section marked REQUIRED must appear. Sections marked CONDITIONAL appear only when their trigger condition is met.**

```markdown
## Swarm Resumed & Completed: {task-slug}

**{completed}/{total} tasks** · **{W} waves** · **{0 or N} failures** · **{elapsed_seconds}s elapsed** · **{parallel_efficiency}x parallel efficiency** · **Type: {Waves|Chains}** · **Resumed from: {dashboardId}**

---

### Summary of Work Completed (REQUIRED)

{Thorough summary of what was accomplished. This is NOT a 2-sentence blurb — it should give the
user a complete understanding of the work without needing to read individual task outputs. Cover:
- What was the original goal?
- What was actually built/changed/fixed?
- How does the implementation work at a high level?
- Any significant architectural or design decisions made during execution?
- What is the current state of the feature/fix — is it fully functional, partially complete, or needs follow-up?
- What was the state when the swarm was resumed? What additional work was needed?

Aim for a well-structured summary that tells the full story.}

### Files Changed (REQUIRED)

| File | Action | Task | What Changed |
|---|---|---|---|
| {path} | created / modified / deleted | {task id} | {1-line description of the change} |

### Deviations & Their Impact (CONDITIONAL — include if ANY worker reported deviations)

For each deviation:
- **Task {id} — {title}**
  - **What changed:** {What the worker did differently from the plan}
  - **Why:** {The reason for the deviation}
  - **Impact on project:** {How this deviation affects the codebase, other features, future work}

### Warnings & Observations (CONDITIONAL — include if any workers reported warnings)

- **{task id}:** {warning description and its significance}

### Failures (CONDITIONAL — include if any tasks failed)

- **{task id} — {title}:** {what failed and why}
- **Recovery:** {was a repair task dispatched? Did it succeed?}
- **Blocked by failure:** {any tasks that could not run as a result}
- **Residual impact:** {any incomplete work or broken state left behind}

### Resume Details (REQUIRED)

- **Tasks completed before resume:** {N} ({task_ids})
- **Tasks re-dispatched (stale):** {N} ({task_ids})
- **Tasks retried (failed):** {N} ({task_ids})
- **Tasks dispatched fresh (pending):** {N} ({task_ids})
- **Agents found alive during resume:** {N} ({task_ids or "none"})

### Verification Results (CONDITIONAL — include if a verification step was run)

- **Tests:** {pass | fail | no test suite}
- **Types:** {pass | fail | N/A}
- **Build:** {pass | fail | N/A}
- **Issues:** {list of integration problems, or "None"}

### Potential Improvements (REQUIRED)

{Based on everything the master observed — worker logs, deviations, code patterns,
architectural decisions — identify improvements that could be made. Consider:
- Code quality, DRY violations, missing abstractions
- Performance concerns
- Error handling gaps, missing edge cases
- Test coverage gaps
- Architectural fit

If the work is genuinely clean, explicitly state that and explain why.}

### Future Steps (REQUIRED)

{Concrete, actionable next steps. These should emerge naturally from the work done:
- Follow-up work that was out of scope but is now possible or necessary
- Integration steps
- Manual testing that should be done
- Configuration or environment changes needed
- Related features or improvements
- Technical debt to address

If truly self-contained: "No immediate follow-up required."}

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

- **Task file:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
- **Plan:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`
- **Dashboard:** `{tracker_root}/dashboards/{dashboardId}/initialization.json`
- **Logs:** `{tracker_root}/dashboards/{dashboardId}/logs.json`
- **Metrics:** `{tracker_root}/dashboards/{dashboardId}/metrics.json`
```

> **Quality bar:** The final report should be good enough that a developer who was not present during the swarm can read it and fully understand: (1) what was done, (2) what went sideways, (3) what state the project is in now, (4) what they should do next. If your report doesn't meet this bar, it's incomplete.

### Step 16F: Save to history

After delivering the final report, save a history summary to `{tracker_root}/history/` for future reference.

---

## Post-Swarm Behavior

Once all workers have finished and the master has compiled its final report, the swarm is over. At this point — and **only** at this point — the master agent may resume normal agent behavior (including direct code edits) if the user requests non-parallel work. The no-code restriction applies **exclusively during active swarm orchestration.**

---

## Quick Reference: Resume Commands

| Command | Scope | What it does |
|---|---|---|
| `!p_track_resume` | **Full lifecycle** | Comprehensive resume: reads all master instructions, checks agent health, rebuilds state, dispatches with full prompts, runs complete execution loop, delivers NON-NEGOTIABLE final report with metrics. The definitive "pick up where we left off" command. |
| `!track_resume` | **Dispatch-focused** | Lighter resume: assesses state, re-dispatches incomplete tasks, monitors completion. Less emphasis on instruction reading and final reporting. |
| `!dispatch --ready` | **Pending only** | Dispatches tasks whose dependencies are met. Does NOT retry failed tasks or handle stale in-progress. |
| `!retry {id}` | **Single task** | Re-dispatches one specific failed task with failure context. |
| `!resume` | **Chat session** | Resumes a non-swarm chat session. Reviews conversation history and picks up where the agent left off. Not for swarm orchestration. |

---

## Rules (Non-Negotiable)

### Instruction Reading

1. **Read ALL master documents in Phase 0.** Do not skip any. Do not work from memory. These documents contain the schemas, protocols, and rules that govern every action the master takes during a swarm. Reading them is not a suggestion — it is a prerequisite for correct operation.

2. **Workers MUST be instructed to read worker instructions.** Every worker prompt must include either `tracker_worker_instructions.md` (FULL mode) or `tracker_worker_instructions_lite.md` (LITE mode). The instruction mode is selected per the criteria in `worker_prompts.md`. Default to FULL when uncertain.

### Agent Health & Re-Dispatch

3. **Check before re-dispatching.** Do not blindly re-dispatch all in-progress tasks. Check progress file recency to determine if the agent is likely still alive. Re-dispatching a running agent wastes computation and risks file conflicts.

4. **Treat uncertain agents conservatively.** If you cannot determine whether an agent is alive or stale, monitor it briefly (2-3 minutes) before re-dispatching. The cost of a brief wait is much lower than the cost of a duplicate worker.

### Dispatch & Tracking

5. **Dispatch FIRST, update tracker AFTER.** The agent must be launched before `logs.json` is updated with the dispatch. This is the single most important dispatch rule.

6. **Dependency-driven dispatch, not wave-driven.** Waves are visual only. Dispatch logic looks ONLY at individual task dependencies.

7. **Fill all open slots simultaneously.** When a completion unlocks multiple tasks, dispatch ALL of them in the same cycle.

8. **No artificial concurrency cap.** Send as many agents as there are ready tasks.

### State Management

9. **Write `master_state.json` after every event.** This is your lifeline for context compaction recovery.

10. **Progress files are authoritative.** If `master_state.json` conflicts with progress files, trust the progress files.

11. **Atomic writes only.** Always read -> modify in memory -> write the full file.

12. **Timestamps must be live.** Always run `date -u +"%Y-%m-%dT%H:%M:%SZ"` at the exact moment of writing.

### Completion

13. **Final report is NON-NEGOTIABLE.** After all tasks complete, the master MUST read all progress files, logs, and the master task file, then compile and deliver a comprehensive final report covering: summary of work, files changed, deviations and impact, improvements, and future steps. Not "the dashboard shows everything." Not "the user can check the logs." A complete written report every time.

14. **Metrics are NON-NEGOTIABLE.** Compute and write `metrics.json` before the final report.

---

## Timestamp Protocol

Every timestamp must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Use the output of this command directly. Never guess, estimate, or hardcode timestamps.
