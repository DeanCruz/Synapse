# p_track — Phase 2: Execution — Dependency-Driven Dispatch

> **Module:** This file contains the Execution phase (Steps 12-16) of the `!p_track` command.
> **Source:** Extracted from `{tracker_root}/_commands/Synapse/p_track.md`
> **Related modules:** `p_track_planning.md` (Phase 1), `p_track_completion.md` (Phase 3)

> **WAVES ARE VISUAL ONLY.** Dispatch is driven exclusively by individual task dependencies (`depends_on` arrays), not by wave boundaries. A task in wave 5 with all dependencies satisfied is dispatchable immediately — even if waves 2, 3, and 4 still have running tasks. If you removed the `wave` field from every agent, the dispatch logic should not change at all.

---

## Step 12: Begin execution

The dashboard is already populated with the full plan from Step 11. All tasks are visible as pending. Now begin dispatching agents.

> **Note:** The master does NOT update `initialization.json` after planning. There is no `started_at` or `overall_status` to set — the dashboard derives the swarm start time from the earliest worker's `started_at` in their progress files, and derives overall status from the aggregate of all progress files.

---

## Step 13: Dispatch initial agents

Dispatch **every task whose dependencies are already satisfied** (all of Wave 1, plus any higher-wave tasks with no blockers). There is **no fixed concurrency cap** — maximize parallelism.

For each dispatched task, follow this **exact sequence**:

### A. Launch the agent FIRST

Dispatch the Task agent with the full prompt (see Step 14 for the prompt template). The agent is now running.

### B. Update tracker AFTER dispatch (NON-NEGOTIABLE)

**Only after the agent has been dispatched**, update the tracker files:

1. Run `date -u +"%Y-%m-%dT%H:%M:%SZ"` to get the current timestamp.

2. Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
   ```json
   {
     "timestamp": "{captured timestamp}",
     "task_id": "{id}",
     "agent": "Agent {N}",
     "level": "info",
     "message": "Dispatched: {task title}",
     "task_name": "{task-slug}"
   }
   ```
   Write back.

> **Note:** The master does NOT update `initialization.json` on dispatch. Workers write their own `status`, `assigned_agent`, and `started_at` to their progress files. The dashboard derives agent status from progress files.

**Do NOT display a terminal status table.** The dashboard is the primary reporting channel. The master outputs only a brief one-line confirmation per dispatch batch (e.g., "Dispatched Wave 1: 4 agents").

---

## Step 14: Swarm agent prompt template

Every dispatched agent receives a **self-contained prompt** with all context needed to work independently. The master embeds relevant project conventions and patterns directly into the prompt to minimize redundant reading by workers. Use this template:

```
You are a worker agent in the "{task-slug}" swarm, executing task {id}.
TEMPLATE_VERSION: p_track_v2

═══════════════════════════════════
TASK {id}: {title}
═══════════════════════════════════

DESCRIPTION:
{detailed description from XML <description>}

CONTEXT:
{all context from XML <context>}

PROJECT ROOT: {project_root}
TRACKER ROOT: {tracker_root}

CONVENTIONS:
{Filtered from the convention_map (Step 5A) — include ONLY categories relevant to this
specific task per the Step 6D checklist. For example, a backend API task gets `backend_api`,
`error_handling`, `naming`, and `types` — but NOT `frontend_styling` or `testing` (unless
the task includes tests).
Quote directly from the CLAUDE.md for included categories — do not paraphrase.
For large CLAUDE.md files (500+ lines), summarize each category as 2-3 bullet points.
Omit section entirely if no CLAUDE.md exists.}

REFERENCE CODE:
{Working examples from the codebase that the worker should follow as patterns.
If the worker needs to create a new endpoint and there are existing endpoints,
include a complete example. If the worker needs to follow a specific pattern,
show the pattern with actual code. Omit section if no reference patterns apply.}

UPSTREAM RESULTS:
{Only include for downstream tasks that depend on completed upstream work.
For each completed dependency:
  - Task {dep_id}: {dep_title} — {dep_summary}
  - Files changed: {list of files the upstream task created/modified}
  - New interfaces/exports: {any new types, functions, or APIs the upstream task introduced}
  - Deviations: {any deviations from the plan that affect this task}
Omit this entire section for Wave 1 tasks with no dependencies.}

SIBLING TASKS:
{Optional — include when same-wave tasks modify related areas of the codebase.
Lists tasks running concurrently with this worker so it can avoid file conflicts.
For each sibling in the same wave:
  - {sibling_id}: {sibling_title} — modifies {sibling_files}

You do NOT depend on these tasks and they do NOT depend on you.
Do NOT modify any files listed under sibling tasks.
If you discover you need to modify a sibling's file, report it as a deviation.

Omit this entire section if the task has no same-wave siblings, or if sibling file
lists do not overlap with this task's area of the codebase.}

CRITICAL:
{critical details from XML <critical> — omit section if empty}

SUCCESS CRITERIA:
{Exactly what "done" looks like — specific, verifiable conditions. The worker should be able
to check each criterion and confirm completion. Examples:
- "The middleware is registered in src/app.ts before all route handlers"
- "All existing tests still pass"
- "The new endpoint returns 429 with Retry-After header when rate limited"}

FILES:
{list each file with its action}
  - READ:   {path}
  - MODIFY: {path}
  - CREATE: {path}

DIRECTORY: {working directory}

═══════════════════════════════════
PREPARATION — REQUIRED BEFORE STARTING WORK
═══════════════════════════════════

Before writing any code, complete these steps in order:

1. READ YOUR TASK IN THE MASTER XML:
   Read `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.xml` — specifically your task at id="{id}".
   Focus on: your task's full description, context, critical details, and dependency relationships.
   Do NOT read the entire XML — only your task section and any tasks listed in your depends_on.

2. READ PROJECT INSTRUCTIONS (only if not already provided above):
   If the CONVENTIONS section above is empty or says "no CLAUDE.md", check if a CLAUDE.md file
   exists at {project_root}/CLAUDE.md or in the target directory and read it. If conventions were
   already provided above, skip this step — do not re-read what the master already extracted for you.
   NOTE: Your code work happens in {project_root}. Your progress reporting goes to {tracker_root}.

3. READINESS CHECKLIST — verify each item before writing code:
   [ ] I have listed every file path I will modify or create (write them in a milestone)
   [ ] I have read at least one existing file that follows the pattern I need to replicate
   [ ] I can state in one sentence what this task produces (write it in a milestone)
   [ ] For each file I will modify, I have read it and confirmed it exists at the expected path
   [ ] If this task has upstream dependencies, I have reviewed the UPSTREAM RESULTS section
       and confirmed the files/exports I depend on exist

   If any item fails:
   - Missing file path → Glob for it, log the discovery as a milestone
   - No pattern reference → Read the closest similar file, log it
   - Upstream export missing → Log as a deviation and report in your return
   - After 3 additional file reads without resolution → report as a blocker, do not read further

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
  - Example: function validateAuthToken — validates JWT and returns decoded payload
  - Example: type UserProfile — user profile interface with avatar, bio, settings fields
  - Example: endpoint POST /api/auth/refresh — refreshes expired access tokens
DIVERGENT ACTIONS: (omit entirely if none — include if ANY deviation from the plan occurred)
  - {what was different from the plan and why}
WARNINGS: (omit entirely if none)
  - {description of unexpected finding or issue}
ERRORS: (omit entirely if none)
  - {description of error that prevented completion}
```

### Prompt Completeness Checklist

Before dispatching each agent, verify the prompt contains all of these. A missing item is the #1 cause of worker confusion:

| Required Element | Check |
|---|---|
| **File paths** | Every file to read/modify/create is listed with its full relative path |
| **CLAUDE.md conventions** | Relevant sections quoted directly (not paraphrased) from the target repo's CLAUDE.md |
| **Conventions filtered by relevance** | Only convention categories relevant to this specific task are included (per Step 6D checklist and convention_map from Step 5A) — no full CLAUDE.md dumps |
| **Reference code** | If the worker must follow an existing pattern, a working example is included |
| **Upstream results** | For downstream tasks: summary, files changed, new exports, and deviations from each dependency |
| **Sibling tasks** | (Optional) For same-wave tasks with related file areas: sibling IDs, titles, and file lists included so the worker can avoid conflicts |
| **Success criteria** | The worker can unambiguously determine when the task is done |
| **Critical details** | Edge cases, gotchas, and non-obvious constraints are explicitly stated |
| **Instruction mode** | FULL or LITE is selected based on task complexity (see Instruction Mode Selection) |

If any element is missing, add it before dispatch. Do not assume the worker will figure it out.


### Instruction Mode Selection

The master selects FULL or LITE mode per-task based on complexity:

| Criteria | FULL | LITE |
|---|---|---|
| Has upstream dependencies | ✓ | |
| Modifies 3+ files | ✓ | |
| Requires coordination with other tasks | ✓ | |
| High deviation risk | ✓ | |
| Simple, independent task | | ✓ |
| Single-file modification | | ✓ |
| No upstream dependencies | | ✓ |
| Well-defined, mechanical change | | ✓ |

Default to FULL when uncertain. LITE is an optimization for simple tasks — never use it for tasks with dependencies or coordination requirements.

---

## Step 15: Process completions and dispatch immediately

**This is the core execution loop.** Every time an agent returns:

### A. Parse the agent's return

Extract `STATUS`, `SUMMARY`, `FILES CHANGED`, `EXPORTS`, `DIVERGENT ACTIONS`, `WARNINGS`, and `ERRORS` from the agent's response.

### A-2. Worker Return Validation

After parsing the agent's return text, the master must validate these required sections before treating it as a successful completion:

| Section | Required? | Validation |
|---|---|---|
| STATUS | Yes | Must be present. Must be one of: `COMPLETED`, `FAILED`, `PARTIAL`. If missing, treat the return as a failure — log `"error"` level: `"Worker returned without STATUS section — treating as failure."` |
| SUMMARY | Yes | Must be present and non-generic. If empty or matches generic patterns (`"Done"`, `"Completed"`, `"Finished"`, `"Task complete"`), log `"warn"` level: `"Worker returned generic summary — quality check needed."` Still count as completed, but flag for review. |
| FILES CHANGED | Conditional | If the task was expected to modify files (i.e., the task description mentions creating, modifying, or editing files), this section should list specific file paths. If empty or missing for a file-modifying task, log `"warn"` level: `"Worker reported no files changed for a task expected to modify files."` |
| DIVERGENT ACTIONS | Optional | If present, parse each deviation and log at `"deviation"` level in logs.json. |

**Processing rules:**
- If STATUS is `FAILED`, follow the existing failure recovery procedure (repair task creation or circuit breaker).
- If STATUS is `PARTIAL`, treat as completed but log a `"warn"` entry and include the incomplete items in the final report.
- If STATUS is missing entirely, treat as a failure — create a repair task per the standard procedure.

### B. Update the master XML

Read the XML. Find the task by `id`:
- Set `<status>` to `completed` or `failed`
- Set `<completed_at>` to current ISO timestamp
- Write `<summary>` with the agent's SUMMARY line
- Append any logs, warnings, or divergent actions to `<logs>`
Write back.

### C. Append to logs.json

Always append a completion/failure entry to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
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

If the agent reported WARNINGS, append a separate entry per warning at level `"warn"`.
If the agent reported ERRORS, append at level `"error"`.
If the agent reported DIVERGENT ACTIONS, append at level `"deviation"` with the deviation description. The dashboard displays these with a yellow badge.

Write back.

> **Note:** The master does NOT update `initialization.json` on completions. The worker's progress file handles all lifecycle tracking (status, completed_at, summary). The dashboard derives all stats (completed count, failed count, wave progress) from progress files. The master still updates the XML and logs.json.

**Do NOT display a terminal status table.** Output only a brief one-line confirmation (e.g., "Agent 5 completed: {summary}"). The dashboard is the primary reporting channel.

### D. Cache the result for downstream injection

Store the completed task's results in the master's working memory:
- Task ID, title, status
- Summary (the worker's SUMMARY line)
- Files changed (the worker's FILES CHANGED list)
- Any new interfaces, types, exports, or APIs introduced (from the worker's EXPORTS section, or extracted from the summary if EXPORTS is omitted)
- Any deviations or warnings

This cache is used to populate the `UPSTREAM RESULTS` section when dispatching downstream tasks. After context compaction, reconstruct the cache from prior conversation output or by re-reading the XML summaries.

### Upstream Result Summary Format

When injecting upstream results into a downstream worker's prompt, use this structured format per dependency:

```
UPSTREAM RESULTS:
--- Dependency: Task {id} — {title} ---
STATUS: {completed | failed}
SUMMARY: {worker's SUMMARY line verbatim}
FILES CHANGED:
  - {path} ({created | modified | deleted})
NEW EXPORTS:
  - {type} {name} — {description}
DEVIATIONS: {none | list of deviations}
KEY DETAILS: {1-2 sentences of specific technical details the downstream worker needs —
  e.g., "The new function is exported as `validateGraph` from `utils/validation.js`
  and accepts an `agents[]` array", or "The middleware is registered BEFORE route handlers
  in app.ts line 45"}
--- End Dependency ---
```

**KEY DETAILS is the most important field.** It bridges the gap between the upstream worker's output and the downstream worker's needs. Without it, the downstream worker knows WHAT was done but not HOW — leading to redundant file reads or incorrect assumptions.

Populate KEY DETAILS by:
1. Reading the upstream worker's SUMMARY and FILES CHANGED
2. Extracting the specific technical facts the downstream task needs (based on the downstream task's description in the plan)
3. If the upstream summary is too vague, quickly read the modified files to extract the relevant details (function signatures, export names, file structure)

**When multiple dependencies exist**, list each one in a separate `--- Dependency ---` block. Order them by relevance to the downstream task (most important first).

### E. Scan for newly dispatchable tasks — CRITICAL

After processing a completion, **read the master XML** and scan ALL pending tasks across ALL waves:
- If a task's `<depends_on>` references are ALL now `"completed"`, dispatch it **immediately**.
- **Do NOT wait for the rest of its wave.** Do NOT wait for anything other than its direct dependencies.
- If multiple tasks become available, dispatch ALL of them simultaneously.

**When dispatching downstream tasks, include upstream results:** For each dependency listed in the downstream task's `<depends_on>`, pull the cached result (from Step 15D) and embed it in the worker prompt's `UPSTREAM RESULTS` section. This ensures downstream workers know exactly what their prerequisites produced, including any deviations from the plan.

Update tracker files for each newly dispatched task **after dispatch** (per the NON-NEGOTIABLE rule in Step 13B).

### F. Circuit Breaker Check

After every failure event, before proceeding to the eager dispatch scan, the master must evaluate three circuit breaker thresholds:

**Threshold A — Wave-level cascade:** 3+ tasks have failed within the same wave. Count all progress files with `status: "failed"` grouped by the wave ID from `initialization.json` agents[].

**Threshold B — Downstream blockage:** A single failed task blocks 3+ downstream tasks. Scan agents[] for any task whose `depends_on` contains the failed task's ID (or the repair task ID that replaced it) and count how many are transitively blocked.

**Threshold C — Majority blockage:** A single failure blocks more than half of all remaining non-completed tasks.

If ANY threshold is hit, the circuit breaker fires. The master must:
1. Log a `"warn"` level entry to `logs.json`: `"Circuit breaker triggered — threshold {A|B|C} hit. Entering replanning mode."`
2. Set a replanning flag (internal master state) that blocks all new dispatches
3. Proceed to the replanning procedure documented in `{tracker_root}/agent/instructions/tracker_master_instructions.md` — "Circuit Breaker — Automatic Replanning" section

**Example — Threshold B triggered:**
Task 2.1 fails. The master scans agents[] and finds that tasks 3.1, 3.2, 3.3, and 4.1 all have `depends_on` chains that include 2.1 (directly or transitively). That's 4 blocked tasks — exceeding the threshold of 3. The circuit breaker fires. The master pauses dispatches, enters the replanning procedure, analyzes root cause, and produces a revision plan.

---

## Step 16: Handle failures

If an agent fails:
- Mark the task `"failed"` in the XML.
- Log the error to `dashboards/{dashboardId}/logs.json` at level `"error"`.
- Output a brief one-line failure notice to the terminal.
- Mark any directly dependent tasks as `"blocked"` in the XML.
- Continue dispatching all non-dependent tasks.

**Circuit breaker — pause and reassess if ANY of these conditions are met:**
- 3 or more tasks have failed within the same wave
- A failed task blocks more than half of all remaining pending tasks
- 2 consecutive tasks in the same dependency chain have failed (indicates a systemic issue)

When the circuit breaker triggers:
1. **Pause all dispatching** — do not launch any new agents.
2. **Log to `dashboards/{dashboardId}/logs.json`** at level `"warn"`: `"Circuit breaker triggered: {reason}. Pausing dispatch for reassessment."`
3. **Write a `"permission"` level log entry** to trigger the dashboard popup.
4. **Present an assessment to the user:**
   - What failed and why (root cause analysis)
   - Whether a shared root cause is likely
   - Whether the plan needs revision
   - Options: continue, revise plan, or cancel swarm
5. Resume only after user confirmation.

### Failure Taxonomy

Use the failure stage to diagnose root cause before deciding next steps:

| Worker Stage at Failure | Likely Root Cause | Action |
|---|---|---|
| `reading_context` | Upstream issue — missing file, bad path, or failed dependency produced unexpected output | Check upstream task's output; verify file paths in prompt |
| `implementing` | Ambiguous spec — the task description or context is insufficient | Rewrite the prompt with more detail and reference code |
| `testing` | Integration issue — the code works in isolation but conflicts with other changes | Dispatch a verification agent or merge with the conflicting task |

### Retry vs. Replan Decision

After a failure, decide scope of recovery:

- **If the failure blocks >50% of remaining pending tasks** → **replan the swarm.** The dependency graph is too damaged for piecemeal fixes. Reassess the decomposition, merge tasks if needed, and re-dispatch.
- **If the failure blocks <50% of remaining tasks** → **retry the individual task.** Fix the prompt (using the taxonomy above), re-dispatch, and continue the swarm.
- **If the same task fails twice** → escalate to the user regardless of blast radius.

---

## Compaction Recovery

During long-running swarms, context compaction may discard the master's cached upstream results. When this happens, downstream tasks receive incomplete `UPSTREAM RESULTS` sections — the #1 cause of downstream worker confusion.

**Detection:** Before constructing any downstream worker prompt (Step 15.E), verify that cached results exist for all completed upstream tasks. If the master's working memory contains no cached result for a task that has a progress file with `status: "completed"`, compaction has occurred.

**Recovery procedure:**

1. List all files in `{tracker_root}/dashboards/{dashboardId}/progress/`. Read every progress file where `status === "completed"`.

2. For each completed progress file, extract:
   - `task_id`, `summary` — what the task accomplished
   - `milestones[]` — what was built, in order (look for file creation/modification milestones)
   - `deviations[]` — any plan divergences that affect downstream work
   - `logs[]` — scan for `"warn"` and `"error"` entries that may indicate partial issues

3. Rebuild the upstream result cache: for each completed task, reconstruct the cache entry with `task_id`, `summary`, and `deviations`. Note: progress files do not contain `FILES CHANGED` data (that comes from the worker's return). After compaction, file change data is lost unless the summary or milestones mention specific files. Include what can be recovered and note the gap.

4. Log a `"warn"` entry to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
   ```json
   {
     "timestamp": "{ISO 8601}",
     "task_id": "0.0",
     "agent": "Orchestrator",
     "level": "warn",
     "message": "Context compaction detected — rebuilt upstream cache from {N} progress files. File change data may be incomplete.",
     "task_name": "{task-slug}"
   }
   ```

5. Resume normal dispatch with the rebuilt cache. Downstream prompts will include recovered summaries and deviations. If file change data is missing, include a note in the `UPSTREAM RESULTS` section: "Note: File change details unavailable due to context compaction — check milestones for partial file information."

**Prevention:** To reduce compaction impact, keep terminal output minimal (Step 16) and avoid re-reading large files unnecessarily during dispatch loops.

---

## Terminal Output During Execution

**The dashboard is the primary reporting channel.** The master agent does NOT display full status tables during execution. Workers write their own live progress to `{tracker_root}/dashboards/{dashboardId}/progress/{id}.json`, which the dashboard renders in real-time.

The master outputs only minimal terminal confirmations:
- On dispatch: `"Dispatched Wave {N}: {M} agents — {wave name}"`
- On completion: `"Agent {N} completed: {summary}"` (one line)
- On failure: `"Agent {N} FAILED: {error}"` (one line)
- On deviation: `"Agent {N} DEVIATED: {description}"` (one line)

**Full terminal status tables are only displayed when the user runs `!status`.** This saves significant context tokens during execution.

---

## Master State Checkpoint

After every dispatch event (worker dispatched, worker completed, worker failed), the master should write a state checkpoint to:

```
{tracker_root}/dashboards/{dashboardId}/master_state.json
```

The checkpoint contains:

```json
{
  "last_updated": "2026-03-21T15:30:00Z",
  "completed": [
    { "id": "1.1", "summary": "Created auth middleware — 3 endpoints protected" },
    { "id": "1.2", "summary": "Set up database schema — 4 tables created" }
  ],
  "in_progress": ["2.1", "2.3"],
  "failed": [
    { "id": "2.2", "summary": "Failed: missing dependency express-rate-limit", "repair_id": "2.4r" }
  ],
  "ready_to_dispatch": ["3.1"],
  "upstream_results": {
    "1.1": "Created auth middleware with rate limiting for /api/auth, /api/users, /api/admin. Exports: authMiddleware, rateLimiter.",
    "1.2": "Created User, Session, Permission, AuditLog tables. Migration file: 001_initial_schema.sql."
  },
  "next_agent_number": 5,
  "permanently_failed": []
}
```

**Write rules:**
- Write the full file on every update (atomic, like progress files)
- This is the master's own state file — workers never read or write it
- `upstream_results` stores one-line summaries per completed task, used for injecting into downstream worker prompts
- `next_agent_number` tracks the agent numbering counter so re-dispatch after compaction uses the right numbers
- Keep summaries short (one line each) — this file should stay under 2000 tokens

**Recovery procedure:** If the master experiences context compaction (detected by losing track of which tasks are dispatched), it should:
1. Read `dashboards/{dashboardId}/master_state.json`
2. Read `dashboards/{dashboardId}/initialization.json` (for the full plan)
3. Read all files in `dashboards/{dashboardId}/progress/` (for ground truth)
4. Cross-reference checkpoint against progress files (progress files are authoritative if they conflict)
5. Resume the eager dispatch loop