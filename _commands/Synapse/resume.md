# `!resume [dashboardId]`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are the MASTER AGENT. You do NOT write code. You do NOT implement anything. You ONLY analyze state and dispatch worker agents. No exceptions.**
>
> **2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before dispatching any agents. Do not skip this. Do not work from memory. Read it.**
>
> **3. You MUST read the master task file to understand the full plan, task descriptions, context, and critical details before dispatching any worker.**
>
> **4. Every dispatched worker gets a COMPLETE, SELF-CONTAINED prompt with all context needed to work independently — identical in quality and depth to what `!p_track` would produce.**

**Purpose:** Resume a stalled or interrupted `!p_track` swarm. Inspects the dashboard state, identifies all tasks that are not yet completed, and re-dispatches them with full context — effectively picking up where the swarm left off.

**Syntax:**
- `!resume` — Auto-detect the dashboard to resume
- `!resume dashboard3` — Resume a specific dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

**Use cases:**
- The master agent's session was interrupted (user stopped it, context exhaustion, crash)
- Workers were killed or timed out without completing
- The user wants to restart failed tasks alongside dispatching pending ones
- A swarm was partially completed and needs to be finished

---

## Phase 1: Assess Current State

### Step 1: Read core instructions

Read these files **in parallel** — all are required before any action:

1. `{tracker_root}/CLAUDE.md` — Synapse protocols and master agent rules
2. `{tracker_root}/agent/instructions/tracker_master_instructions.md` — Dashboard field mappings and write protocols

### Step 2: Resolve the dashboard

**If `{dashboardId}` was specified:** Use it directly.

**If no dashboard was specified (auto-detect):**
1. Scan `dashboard1` through `dashboard5` in order.
2. For each dashboard, read `{tracker_root}/dashboards/{dashboardId}/initialization.json`:
   - If `task` is `null` → **empty**. Skip — nothing to resume.
   - If `task` is not null → candidate. Read all progress files from `progress/`.
     - If **every** progress file has `status: "completed"` → **fully done**. Skip.
     - If **any** progress file has `status: "in_progress"`, `"failed"`, or is **missing** (task exists in `agents[]` but has no progress file) → **resumable**. Select this dashboard.
3. If no resumable dashboard is found, report: "No dashboards have incomplete swarms to resume." and list all dashboard states.

### Step 3: Read the full dashboard state

Read these **in parallel**:

1. **`{tracker_root}/dashboards/{dashboardId}/initialization.json`** — The full plan: task metadata, agents array, waves, chains, and `task.project_root`.
2. **All progress files** from `{tracker_root}/dashboards/{dashboardId}/progress/` — Build a status map: `{ task_id → { status, summary, deviations, logs } }`.
3. **`{tracker_root}/dashboards/{dashboardId}/logs.json`** — Event history for context.

### Step 4: Locate and read the master task file

The master task file contains the full task descriptions, context, critical details, and file lists that workers need.

1. Extract `task.name` from `initialization.json` (the task slug).
2. Extract `task.created` to determine the date directory.
3. Look for the task file at: `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
   - If not found, search: `{tracker_root}/tasks/*/parallel_{task_name}.json`
   - If still not found, check `{tracker_root}/tasks/` for any task files matching the task name pattern.
4. **Read the full master task file.** You need every task's `description`, `context`, `critical`, `files`, `tags`, and `depends_on`.

### Step 5: Read project context

1. **Resolve `{project_root}`** from `task.project_root` in `initialization.json`. If not present, resolve using the standard resolution order (see `{tracker_root}/CLAUDE.md` — Path Convention section).
2. **Read `{project_root}/CLAUDE.md`** if it exists — you need project conventions for worker prompts.
3. If `{project_root}/.synapse/toc.md` exists, read it for orientation.

### Step 6: Classify every task

For each agent in `initialization.json`'s `agents[]` array, classify it into one of these categories:

| Category | Condition | Action |
|---|---|---|
| **Completed** | Progress file exists with `status: "completed"` | Skip — already done |
| **Failed** | Progress file exists with `status: "failed"` | Re-dispatch with failure context (like `!retry`) |
| **Stale In-Progress** | Progress file exists with `status: "in_progress"` but no active worker process | Re-dispatch with partial progress context |
| **Pending (ready)** | No progress file AND all `depends_on` tasks are completed | Dispatch immediately |
| **Pending (blocked)** | No progress file AND some `depends_on` tasks are NOT completed | Wait — will dispatch after dependencies complete |

**How to detect "stale in-progress":** A task is stale if its progress file says `in_progress` but:
- There is no active CLI worker running for it (check via the Electron worker list if available)
- OR the `started_at` timestamp is more than 15 minutes old with no recent milestone updates
- OR the master agent session was restarted (which means all previously dispatched workers are gone)

**For resume purposes, treat ALL `in_progress` tasks as stale** — if the master is running `!resume`, the previous master session is dead, which means all its dispatched workers are dead too. Re-dispatch everything that isn't `completed`.

### Step 7: Present the resume plan

Display a summary showing the state of the swarm and what will be dispatched:

```markdown
## Resume Plan: {task-slug}

**Dashboard:** {dashboardId}
**Project:** {project_root}
**Task file:** {path to master task file}

### Current State
| Status | Count | Tasks |
|---|---|---|
| Completed | {N} | {task_ids} |
| Failed (will retry) | {N} | {task_ids} |
| Stale in-progress (will re-dispatch) | {N} | {task_ids} |
| Pending (ready to dispatch) | {N} | {task_ids} |
| Pending (blocked) | {N} | {task_ids} |

### Will Dispatch Now: {total count}
{List each task to be dispatched with its ID, title, and reason (retry/re-dispatch/new)}

### Still Blocked: {count}
{List blocked tasks and what they're waiting for}
```

**Wait for user approval before dispatching.**

---

## Phase 2: Dispatch — Resume Execution

### Step 8: Clean up stale progress files

For each task being re-dispatched (failed or stale in-progress):

1. **Save the previous progress file contents** — you need the failure summary, logs, and deviations for the worker's retry context.
2. **Delete the old progress file:**
   ```bash
   rm -f {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
   ```
   The new worker will create a fresh one.

### Step 9: Build worker prompts with full context

For **each task to be dispatched**, build a complete, self-contained prompt using the **exact same template** from `!p_track` Step 14. Every worker prompt MUST include:

```
You are a worker agent in the "{task-slug}" swarm, executing task {id}.

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
{Relevant sections extracted from {project_root}/CLAUDE.md by the master.
Include naming conventions, file structure rules, import patterns, testing requirements.
Quote directly from the CLAUDE.md — do not paraphrase. Omit section if no CLAUDE.md exists.}

REFERENCE CODE:
{Working examples from the codebase that the worker should follow as patterns.
Read the actual source files referenced in the task's <files> list to extract relevant patterns.
If the task modifies an existing file, include the current state of the sections being modified.
Omit section if no reference patterns apply.}

UPSTREAM RESULTS:
{For each completed dependency task:
  - Task {dep_id}: {dep_title} — {summary from progress file}
  - Files changed: {from progress file milestones/summary}
  - Deviations: {from progress file deviations[]}
This is CRITICAL for resume — upstream tasks are already completed and their
results define what this worker should build on. Read the actual upstream
progress files to get ground truth, not stale plan data.}

CRITICAL:
{critical details from task file — omit section if empty}

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

{If this is a RETRY of a failed task, include:}
PREVIOUS ATTEMPT:
This task was previously attempted and {failed | was interrupted}.

Previous status: {status from old progress file}
Previous stage reached: {stage from old progress file}
Previous summary: {summary from old progress file, if any}

Previous logs:
{Key log entries from the old progress file that provide context about what
the previous worker accomplished and where it failed/stopped}

Previous deviations:
{Any deviations the previous worker reported}

ROOT CAUSE ANALYSIS:
{Master's analysis of what went wrong — read the old progress file logs carefully
and the actual project files to determine the root cause. Include specific guidance
on how to avoid the same failure.}

REMEDIATION GUIDANCE:
{Specific instructions based on the root cause analysis. Reference actual file
contents, correct import paths, proper function signatures, etc. The more specific
you are, the less likely the retry will fail for the same reason.}
{End retry section}

═══════════════════════════════════
PREPARATION — REQUIRED BEFORE STARTING WORK
═══════════════════════════════════

Before writing any code, complete these steps in order:

1. READ YOUR TASK IN THE MASTER TASK FILE:
   Read `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json` — specifically your task at id="{id}".
   Focus on: your task's full description, context, critical details, and dependency relationships.
   Do NOT read the entire task file — only your task section and any tasks listed in your depends_on.

2. READ PROJECT INSTRUCTIONS (only if not already provided above):
   If the CONVENTIONS section above is empty or says "no CLAUDE.md", check if a CLAUDE.md file
   exists at {project_root}/CLAUDE.md or in the target directory and read it. If conventions were
   already provided above, skip this step — do not re-read what the master already extracted for you.
   NOTE: Your code work happens in {project_root}. Your progress reporting goes to {tracker_root}.

3. CHECK ACTUAL FILE STATE:
   Since this is a resumed swarm, files may have been modified by previously completed tasks.
   Read the current state of any files you need to modify BEFORE making changes.
   Do not assume the file matches the pre-swarm state described in the task plan.

4. READ UPSTREAM DEPENDENCY PROGRESS FILES:
   For each task ID in your depends_on list, read:
   {tracker_root}/dashboards/{dashboardId}/progress/{dependency_task_id}.json
   Extract: status, summary, deviations, and key log entries.
   Adapt your approach based on what upstream workers actually did.

5. SELF-ASSESSMENT — answer these specific questions before proceeding:
   a. Can I identify EVERY file I need to modify? (If no → read the project structure)
   b. Do I understand the PATTERNS I need to follow? (If no → read the reference files listed above)
   c. Can I describe my implementation approach in one sentence? (If no → re-read the context)
   d. Are there any AMBIGUITIES in the task description? (If yes → make the most reasonable
      choice, document it as a deviation, and proceed)

═══════════════════════════════════
LIVE PROGRESS REPORTING — NON-NEGOTIABLE
═══════════════════════════════════

You MUST report your progress throughout execution. This is how the dashboard shows real-time updates.

FIRST: Read the worker instructions file:
  {tracker_root}/agent/instructions/tracker_worker_instructions.md

Follow those instructions EXACTLY. They contain the full progress file schema,
required reporting points, log format, and examples.

YOUR PROGRESS FILE: {tracker_root}/dashboards/{dashboardId}/progress/{id}.json
YOUR TASK ID: {id}
YOUR AGENT LABEL: Agent {N}

You own this file exclusively. Write the FULL file on every update.
The dashboard watches it and displays your progress in real-time.

═══════════════════════════════════
DEVIATION REPORTING — MANDATORY
═══════════════════════════════════

If you deviate from the original plan in ANY way, you MUST report it immediately.
See `{tracker_root}/agent/instructions/tracker_worker_instructions.md` for the full deviation
reporting protocol, including the progress file format and required fields.

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
DIVERGENT ACTIONS: (omit entirely if none)
  - {what was different from the plan and why}
WARNINGS: (omit entirely if none)
  - {description of unexpected finding or issue}
ERRORS: (omit entirely if none)
  - {description of error that prevented completion}
```

#### Prompt Completeness Checklist (same as `!p_track`)

Before dispatching each agent, verify the prompt contains ALL of these:

| Required Element | Check |
|---|---|
| **File paths** | Every file to read/modify/create is listed with full relative path |
| **CLAUDE.md conventions** | Relevant sections quoted directly from the target repo's CLAUDE.md |
| **Reference code** | Working example included if the worker must follow an existing pattern |
| **Upstream results** | Summary, files changed, deviations from each completed dependency |
| **Resume context** | Previous attempt details if retrying a failed/stale task |
| **Actual file state** | Instruction to check current file state before modifying |
| **Success criteria** | Worker can unambiguously determine when the task is done |
| **Critical details** | Edge cases, gotchas, and non-obvious constraints explicitly stated |
| **Both paths** | `{tracker_root}` AND `{project_root}` are in the prompt |
| **Dashboard ID** | `{dashboardId}` is in the prompt for progress file path |

### Step 10: Dispatch all ready tasks

Dispatch **every task classified as "ready"** (failed retries, stale re-dispatches, and pending with satisfied dependencies) **simultaneously**. Follow the exact dispatch sequence:

#### A. Launch the agent FIRST

Dispatch the Task agent with the full prompt from Step 9. The agent is now running.

#### B. Log the dispatch

Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{live timestamp via date -u}",
  "task_id": "{id}",
  "agent": "Agent {N}",
  "level": "info",
  "message": "Resumed: {task title} ({reason: retry | re-dispatch | new})",
  "task_name": "{task-slug}"
}
```

**Output a brief one-line confirmation per dispatch batch** (e.g., "Resumed 4 tasks: 1.2 (retry), 2.1 (re-dispatch), 2.3 (new), 2.4 (new)").

---

## Phase 3: Monitor — Standard Execution Loop

### Step 11: Process completions and dispatch immediately

From this point, follow the **exact same execution loop** as `!p_track` Phase 2 (Steps 15-17):

1. **Every time a worker completes**, parse its return (STATUS, SUMMARY, FILES CHANGED, DIVERGENT ACTIONS, WARNINGS, ERRORS).
2. **Update the master task file** with completion status, timestamp, summary, and any deviations.
3. **Log the completion** to `{tracker_root}/dashboards/{dashboardId}/logs.json`.
4. **Immediately scan ALL remaining tasks** for newly satisfied dependencies and dispatch every ready task. Do not wait for wave boundaries.
5. **If a worker fails**, follow the failure recovery procedure from `tracker_master_instructions.md` — create a repair task, rewire dependencies, dispatch the repair worker.

### Step 12: Handle the circuit breaker

If 3+ tasks fail within the same wave, or a failed task blocks more than half of remaining tasks:
- **Pause dispatching**
- **Assess root cause** — Is there a shared problem? Environment issue? Bad assumption?
- **Present assessment to the user** — Continue, revise, or cancel?

### Step 13: Final report

When all tasks are completed (or all remaining are blocked/failed):

1. **Compile a final summary:**
   - Total tasks: {N} completed, {N} failed, {N} blocked
   - Total elapsed time (from earliest `started_at` to latest `completed_at` across all progress files)
   - Key accomplishments
   - Any remaining issues or follow-up needed
   - Deviations across all workers

2. **Update the master task file** with final `overall_status` and completion summary.

3. **Log the completion** to `logs.json`:
   ```json
   {
     "timestamp": "{live timestamp}",
     "task_id": "0.0",
     "agent": "Orchestrator",
     "level": "info",
     "message": "Swarm resumed and completed: {task-slug} — {completed}/{total} tasks successful",
     "task_name": "{task-slug}"
   }
   ```

4. **Present the final report** to the user.

---

## Quick Reference: `!resume` vs `!dispatch --ready` vs `!retry`

| Command | Scope | What it does |
|---|---|---|
| `!resume` | **Entire swarm** | Full assessment + re-dispatch ALL incomplete tasks (failed, stale, pending) with complete context. Becomes the new master orchestrator for the swarm. |
| `!dispatch --ready` | **Pending only** | Dispatches tasks whose dependencies are met. Does NOT retry failed tasks or handle stale in-progress. |
| `!retry {id}` | **Single task** | Re-dispatches one specific failed task with failure context. |

`!resume` is the "pick up where we left off" command. It combines the assessment depth of `!status`, the retry logic of `!retry`, and the dispatch mechanics of `!dispatch --ready` into a single operation that fully restores a stalled swarm.
