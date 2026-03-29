# Worker Prompt Construction Guidelines

This module covers everything the master agent needs to construct high-quality, self-contained worker dispatch prompts. It includes the full prompt template, instruction mode selection, context budgeting, convention filtering, and the pre-dispatch quality checklist.

---

## Worker Dispatch Prompt Template

Every dispatched agent receives a **self-contained prompt** with all context needed to work independently. The master embeds relevant project conventions and patterns directly into the prompt to minimize redundant reading by workers. Use this template:

```
You are a worker agent in the "{task-slug}" swarm, executing task {id}.
TEMPLATE_VERSION: p_track_v2

═══════════════════════════════════
TASK {id}: {title}
═══════════════════════════════════

DESCRIPTION:
{detailed description from task file "description" field}

CONTEXT:
{all context from task file "context" field

PKI-sourced relationships (optional — append when PKI annotations include relationship
data for files in this task's READ/MODIFY list): If annotations list depends_on,
depended_by, or related relationships, append them here so the worker understands the
file's architectural connections without rediscovering them:

  [PKI] Known file relationships:
  - {file_path} depends on {related_path} — {description}
  - {file_path} is consumed by {related_path} — {description}

Omit if no PKI or no relationship data exists for task files.}

PROJECT ROOT: {project_root}
TRACKER ROOT: {tracker_root}

CONVENTIONS:
{Filtered from the convention_map (Step 5A) — include ONLY categories relevant to this
specific task per the Convention Relevance Checklist below. For example, a backend API task
gets `backend_api`, `error_handling`, `naming`, and `types` — but NOT `frontend_styling`
or `testing` (unless the task includes tests).
Quote directly from the CLAUDE.md for included categories — do not paraphrase.
For large CLAUDE.md files (500+ lines), summarize each category as 2-3 bullet points.
Omit section entirely if no CLAUDE.md exists.

PKI-sourced conventions (optional — append when a Project Knowledge Index exists):
If a PKI exists at {project_root}/.synapse/knowledge/ and the manifest contains entries
for files in this task's READ/MODIFY/CREATE list, append file-specific gotchas, patterns,
and conventions from PKI annotations after the CLAUDE.md conventions. This gives the worker
institutional knowledge about the files it will touch. Format:

  [PKI] File-specific knowledge from previous sessions:

  {relative_file_path}:
    GOTCHAS:
      - {gotcha from annotation}
    PATTERNS:
      - {pattern from annotation}
    CONVENTIONS:
      - {convention from annotation}

Include only non-empty categories per file. When the combined CLAUDE.md + PKI content
would exceed the ~200 line budget, prioritize in this order: gotchas > patterns >
relationships > conventions. Gotchas prevent bugs; patterns guide structure; the rest
is supplementary. See the PKI Context Injection Guidelines section below for the full
lookup procedure. Omit PKI content if no PKI exists, no files match, or all matched
annotations are stale.}

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
{critical details from task file "critical" field — omit section if empty}

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

1. READ YOUR TASK IN THE MASTER TASK FILE:
   Read `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json` — specifically your task at id="{id}".
   Focus on: your task's full description, context, critical details, and dependency relationships.
   Do NOT read the entire task file — only your task section and any tasks listed in your depends_on.

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

If you cannot read the instruction file at the path above, use the inline PROGRESS FILE SCHEMA provided in this prompt instead. Log the failure as a deviation in your progress file.

{If LITE:}
FIRST: Read the lite worker instructions file:
  {tracker_root}/agent/instructions/tracker_worker_instructions_lite.md

Follow those instructions EXACTLY. They contain the streamlined progress file schema
and required reporting points for simple tasks.

If you cannot read the instruction file at the path above, use the inline PROGRESS FILE SCHEMA provided in this prompt instead. Log the failure as a deviation in your progress file.

PROGRESS FILE SCHEMA (fallback — use this if you cannot read the instruction file above):
{
  "task_id": "{id}",
  "template_version": "p_track_v2",
  "status": "in_progress | completed | failed",
  "started_at": "ISO-8601",
  "completed_at": "ISO-8601 | null",
  "summary": "one-line result on completion",
  "assigned_agent": "Agent {N}",
  "stage": "reading_context | planning | implementing | testing | finalizing | completed | failed",
  "message": "what you are doing right now",
  "milestones": [{ "at": "ISO-8601", "msg": "significant accomplishment" }],
  "deviations": [{ "at": "ISO-8601", "description": "plan divergence" }],
  "logs": [{ "at": "ISO-8601", "level": "info|warn|error|deviation", "msg": "event" }]
}
Write the FULL file on every update. Mandatory writes: (1) before starting work, (2) on every stage transition, (3) on any deviation, (4) on completion/failure. Timestamps: always `date -u +"%Y-%m-%dT%H:%M:%SZ"`.

YOUR PROGRESS FILE: {tracker_root}/dashboards/{dashboardId}/progress/{id}.json
MANDATORY: Write your first progress file IMMEDIATELY with status: "in_progress", stage: "reading_context" BEFORE doing any work. This is NON-NEGOTIABLE.
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

---

## Instruction Mode Selection

The master selects FULL or LITE mode per-task based on complexity:

| Criteria | FULL | LITE |
|---|---|---|
| Has upstream dependencies | Yes | |
| Modifies 3+ files | Yes | |
| Requires coordination with other tasks | Yes | |
| High deviation risk | Yes | |
| Simple, independent task | | Yes |
| Single-file modification | | Yes |
| No upstream dependencies | | Yes |
| Well-defined, mechanical change | | Yes |

Default to FULL when uncertain. LITE is an optimization for simple tasks — never use it for tasks with dependencies or coordination requirements.

---

## Context Budget Guidelines

### Per-Task Prompt Budget

| Section | Max Lines | Notes |
|---|---|---|
| CONVENTIONS | ~200 lines | Extract relevant CLAUDE.md sections + PKI-sourced file-specific knowledge (if PKI exists). PKI content shares this budget — when combined CLAUDE.md + PKI content approaches 200 lines, cap PKI at 5 files and prioritize MODIFY files over READ files. |
| REFERENCE CODE | ~100 lines | Include one complete, representative example. If more patterns are needed, summarize the rest. |
| UPSTREAM RESULTS | ~50 lines per dependency | Summarize to key facts: what was built, what files changed, what new exports exist. Do not paste raw summaries. |
| CONTEXT | ~150 lines | Focus on architectural decisions and current file state. Link to files rather than inlining large blocks. |
| Total prompt | ~800 lines | If a prompt exceeds this, the task should be split or context should be summarized further. |

### When a Prompt Exceeds the Budget

1. **Summarize, don't paste.** Replace inline code blocks with one-line summaries and explicit file paths the worker can read.
2. **Split the task.** If the context is genuinely needed and cannot be summarized, the task is too large — decompose it further.
3. **Prioritize critical details.** Success criteria and critical gotchas should never be cut for space. Cut reference code and conventions first.
4. **Use READ file lists.** Instead of inlining a 200-line file, add it to the READ list and tell the worker what to look for: "READ: src/auth/middleware.ts — focus on the `validateToken` function signature and error handling pattern."

---

## Token Budget Estimate

After constructing each worker's dispatch prompt, the master should estimate the token budget of the prompt by breaking it into sections:

| Section | Description | Typical range |
|---|---|---|
| Task description | What the worker must do | 200-500 tokens |
| File context | Code snippets the worker needs to see | 500-2000 tokens |
| Conventions | Extracted CLAUDE.md sections + PKI-sourced gotchas, patterns, conventions (if PKI exists) | 300-1000 tokens |
| Upstream results | Summaries from completed dependency tasks | 200-600 tokens |
| Critical details | Edge cases, gotchas, constraints | 200-400 tokens |
| Instructions | Worker protocol, progress file path, return format | 400-600 tokens |

**Budget limit: 8000 tokens (~32KB of text).** If a worker prompt exceeds this estimate:

1. **Split the task** — If the prompt is large because the task touches too many files, decompose it into smaller tasks.
2. **Summarize conventions** — Instead of quoting full CLAUDE.md sections, extract only the 3-5 most relevant rules as bullet points.
3. **Trim reference code** — Include only the specific functions/types the worker needs, not entire files. Use line ranges.
4. **Condense upstream results** — One-line summaries per completed task, not full progress file contents.

> **Prompt bloat is the #1 cause of worker context exhaustion.** A worker that receives a 15,000-token prompt has already consumed 15% of its context window before writing a single line of code. Keep prompts lean — every token should earn its place.

---

## Convention Map System

After reading `{project_root}/CLAUDE.md`, categorize its conventions into a **convention_map** — a mental or written index that groups rules by domain. This map is used during prompt construction to filter conventions per-worker, ensuring each agent receives only the rules relevant to its specific task.

### Convention Map Categories

| Category | What it covers | Example rules |
|---|---|---|
| `naming` | File names, function names, variable names, type names | "Components use PascalCase", "Utils use camelCase" |
| `file_structure` | Directory layout, file placement, module organization | "Services go in src/services/", "One component per file" |
| `imports` | Import ordering, path aliases, barrel exports | "Use @/ aliases", "Group imports: external → internal → relative" |
| `frontend_styling` | CSS approach, component patterns, UI conventions | "Use Tailwind utility classes", "No inline styles" |
| `backend_api` | Endpoint patterns, middleware, response formats | "REST endpoints return { data, error }", "Use async/await" |
| `error_handling` | Try/catch patterns, error types, logging | "All errors extend AppError", "Log with structured JSON" |
| `testing` | Test framework, patterns, coverage expectations | "Use Vitest", "Test files colocated with source" |
| `types` | Type definitions, generics, strict mode rules | "No `any` types", "Prefer interfaces over type aliases" |

### Example Convention Map Structure

```json
{
  "naming": ["Components use PascalCase", "Hooks prefixed with use"],
  "file_structure": ["One component per file in src/components/"],
  "imports": ["Use @/ path aliases", "External imports first"],
  "frontend_styling": ["Tailwind utility classes only"],
  "backend_api": [],
  "error_handling": ["All errors extend AppError"],
  "testing": ["Vitest with React Testing Library"],
  "types": ["Strict mode, no any"]
}
```

The master does not need to write this to a file — it is a planning artifact held in working memory. The categories are used during prompt construction to select which conventions to inject into each worker's prompt.

---

## Convention Relevance Checklist

Before extracting CLAUDE.md content for a worker prompt, use the convention_map to select only the categories relevant to THIS specific task:

| Category | Include when... | Skip when... |
|---|---|---|
| `naming` | Task creates new files, functions, variables, or types | Task only modifies existing code |
| `file_structure` | Task creates new files or moves files | Task modifies existing files in-place |
| `imports` | Task adds new imports or creates new modules | Task doesn't touch imports |
| `testing` | Task involves writing or modifying tests | Task has no test component |
| `error_handling` | Task involves error paths, try/catch, or validation | Task is purely additive/cosmetic |
| `backend_api` | Task creates or modifies API endpoints | Task doesn't touch APIs |
| `frontend_styling` | Task involves UI/CSS/component styling | Task is backend-only |
| `types` | Task creates or modifies type definitions | Task doesn't touch types |
| `pki_context` | PKI exists and manifest has non-stale entries for files in the task's READ/MODIFY list — append PKI-sourced gotchas, patterns, and conventions to CONVENTIONS section per the PKI Context Injection Guidelines | No PKI exists, or no task files appear in the PKI manifest, or all matched annotations are stale |

### Rules

1. Cross-reference each task's files and description against the convention_map categories
2. Only extract CLAUDE.md sections that match checked categories above
3. If the project CLAUDE.md exceeds 500 lines, ALWAYS summarize rather than quote — extract the 5-10 most relevant rules as bullet points
4. Cap convention content at ~200 lines in the worker prompt
5. If no categories apply (rare), include a 3-line summary of the project's tech stack and primary patterns

This filtering should be applied per-worker, not globally — different tasks need different convention subsets.

---

## PKI Context Injection Guidelines

When a Project Knowledge Index (PKI) exists at `{project_root}/.synapse/knowledge/`, the master should inject file-specific annotations into the worker prompt's existing CONVENTIONS and CONTEXT sections. This gives workers institutional knowledge about the files they will touch — gotchas to avoid, patterns to follow, and conventions to respect — without requiring each worker to rediscover this information. PKI data is **merged into existing sections**, not added as a separate section.

### Lookup Procedure

1. **Check for PKI existence.** Read `{project_root}/.synapse/knowledge/manifest.json`. If the file does not exist, skip PKI injection entirely — the prompt works without it.
2. **Match task files against the manifest.** For each file in the worker's READ/MODIFY/CREATE list, check if it appears as a key in `manifest.files`. Collect matched entries.
3. **Filter out stale annotations.** For each matched entry, check the `stale` field. If `stale: true`, exclude it — stale annotations may contain outdated information that misleads the worker.
4. **Read annotations for matched files.** For each non-stale match, use the `hash` field to locate the annotation file at `{project_root}/.synapse/knowledge/annotations/{hash}.json`. Extract `gotchas`, `patterns`, `conventions`, and `relationships` arrays.
5. **Prioritize and cap.** Prioritize MODIFY files over READ files (workers need the most context for files they will change). Cap at **5 files**. The combined CLAUDE.md + PKI content must fit within the ~200 line CONVENTIONS budget. When trimming is needed, apply the **priority order**: gotchas > patterns > relationships > conventions. Gotchas prevent bugs and are never cut. Conventions from PKI (as opposed to CLAUDE.md conventions) are the first to go.
6. **Inject into existing sections.** Append gotchas, patterns, and conventions to the CONVENTIONS section under a `[PKI]` label. Append relationships to the CONTEXT section under a `[PKI]` label. See format examples below.

### Priority Order for Budget-Constrained Prompts

When PKI data would push the CONVENTIONS section over ~200 lines, trim PKI content in this order (cut from bottom first):

| Priority | Category | Rationale | Cut when... |
|---|---|---|---|
| 1 (keep) | Gotchas | Prevent bugs and foot-guns — highest ROI per token | Never cut unless budget is catastrophically tight |
| 2 | Patterns | Guide structural decisions — important for CREATE tasks | Budget < 20 lines remaining for PKI |
| 3 | Relationships | Provide architectural context — useful but available via CONTEXT section | Budget < 40 lines remaining for PKI |
| 4 (cut first) | Conventions | Often overlap with CLAUDE.md conventions already included | Budget < 60 lines remaining for PKI |

### When to Skip PKI Injection

Omit PKI content from the prompt entirely when any of these conditions apply:

- No PKI exists (no `manifest.json` at the expected path)
- No files in the task's READ/MODIFY/CREATE list appear in the PKI manifest
- All matched annotations are stale (`stale: true` on every matched entry)
- The task is a pure CREATE task with no existing files to look up
- The CONVENTIONS section is already at the ~200 line budget from CLAUDE.md content alone — do not exceed the budget to include PKI

### Injection Example: CONVENTIONS Section

After the CLAUDE.md conventions, append PKI-sourced file knowledge under a `[PKI]` label:

```
CONVENTIONS:
{... CLAUDE.md conventions from convention_map ...}

[PKI] File-specific knowledge from previous sessions:

src/server/index.js:
  GOTCHAS:
    - SSE connections are not authenticated — any client on the network can subscribe
    - Port defaults to 4000 but can be overridden via PORT env var — Electron app hardcodes 4000
  PATTERNS:
    - event-driven-architecture
    - singleton-service
  CONVENTIONS:
    - All routes registered in a single setup function rather than separate route files
    - Error responses use { error: string } shape consistently

src/server/services/WatcherService.js:
  GOTCHAS:
    - The reconciliation interval (5s) means brief delay between file write and dashboard update
  PATTERNS:
    - event-driven-architecture
```

### Injection Example: CONTEXT Section

After the task context, append PKI-sourced relationship data under a `[PKI]` label:

```
CONTEXT:
{... task context from plan ...}

[PKI] Known file relationships:
- src/server/index.js consumes src/server/services/WatcherService.js — receives file change events and broadcasts as SSE
- src/server/index.js serves src/ui/hooks/useDashboardData.js — provides SSE stream for React dashboard
- src/server/index.js is configured by electron/main.js — Electron spawns server as child process on port 4000
```

### Collecting Worker Annotations Post-Completion

The PKI is not just consumed by workers — it is also **produced** by them. When a worker completes a task, it may return an `ANNOTATIONS` section in its return format (see `agent/worker/return_format.md`) containing gotchas, patterns, and conventions discovered during execution. The master should:

1. **Read the ANNOTATIONS section** from the completed worker's return (if present).
2. **Read the `annotations` field** from the worker's progress file (if populated).
3. **Merge new annotations into the PKI** by updating or creating annotation files in `{project_root}/.synapse/knowledge/annotations/` and refreshing the manifest. If a `!learn_update` command exists, prefer delegating this to the command rather than writing PKI files directly.
4. **Feed forward.** Newly merged annotations become available for subsequent worker prompts in the same swarm — each wave of workers benefits from the annotations of previous waves.

This creates a feedback loop: workers consume PKI annotations via the `[PKI]`-labeled content in their CONVENTIONS and CONTEXT sections, and produce new annotations via their return format, progressively enriching the project's knowledge index across swarms.

---

## Prompt Completeness Checklist

Before dispatching each agent, verify the prompt contains all of these. A missing item is the #1 cause of worker confusion:

| Required Element | Check |
|---|---|
| **File paths** | Every file to read/modify/create is listed with its full relative path |
| **CLAUDE.md conventions** | Relevant sections quoted directly (not paraphrased) from the target repo's CLAUDE.md |
| **Conventions filtered by relevance** | Only convention categories relevant to this specific task are included (per the Convention Relevance Checklist and convention_map) — no full CLAUDE.md dumps |
| **PKI context** | If a PKI exists at `{project_root}/.synapse/knowledge/`, relevant annotations for task files are merged into CONVENTIONS (gotchas, patterns, conventions) and CONTEXT (relationships) sections under `[PKI]` labels (per the PKI Context Injection Guidelines). Omitted if no PKI or no matching files. |
| **Reference code** | If the worker must follow an existing pattern, a working example is included |
| **Upstream results** | For downstream tasks: summary, files changed, new exports, and deviations from each dependency |
| **Sibling tasks** | (Optional) For same-wave tasks with related file areas: sibling IDs, titles, and file lists included so the worker can avoid conflicts |
| **Success criteria** | The worker can unambiguously determine when the task is done |
| **Critical details** | Edge cases, gotchas, and non-obvious constraints are explicitly stated |
| **Instruction mode** | FULL or LITE is selected based on task complexity (see Instruction Mode Selection) |
| **Progress tracking** | Progress file path, task ID, agent label, template_version, inline schema, MANDATORY first-write line | Must include — workers without this will not report progress |

If any element is missing, add it before dispatch. Do not assume the worker will figure it out.

---

## Right-Sizing Tasks (Principle 9)

Each task should take a single agent **1-5 minutes** to complete. This range balances parallelism against orchestration overhead.

| Too small (< 1 min) | Right-sized (1-5 min) | Too large (> 5 min) |
|---|---|---|
| Orchestration overhead dominates | Good parallelism/overhead ratio | Risk of context exhaustion |
| Many dispatch cycles for little work | Workers stay focused | Worker may lose track of scope |
| Log noise drowns signal | Each completion is meaningful | Long waits between status updates |

When estimating: a task that reads 2-3 files and modifies 1-2 files is typically right-sized. A task that reads 10+ files or modifies 5+ files should be decomposed further.

---

## Feeding Upstream Results to Downstream Tasks (Principle 11)

When a task completes and its dependents become dispatchable, the master **must include the upstream task's results** in the downstream worker's prompt:

- What the upstream task accomplished (summary)
- What files it created or modified
- Any new interfaces, types, exports, or APIs it introduced
- Any deviations from the plan that affect downstream work

This is critical because the downstream worker's prompt was written during planning — before the upstream work was done. Without upstream results, the downstream worker operates on stale assumptions.

### Caching Results for Downstream Injection

After processing each completion, store the completed task's results in the master's working memory:
- Task ID, title, status
- Summary (the worker's SUMMARY line)
- Files changed (the worker's FILES CHANGED list)
- Any new interfaces, types, exports, or APIs introduced (from the worker's EXPORTS section, or extracted from the summary if EXPORTS is omitted)
- Any deviations or warnings

This cache is used to populate the `UPSTREAM RESULTS` section when dispatching downstream tasks. After context compaction, reconstruct the cache from prior conversation output or by re-reading the task file summaries.

---

## Upstream Result Injection Format

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

### Populating KEY DETAILS

1. Read the upstream worker's SUMMARY and FILES CHANGED
2. Extract the specific technical facts the downstream task needs (based on the downstream task's description in the plan)
3. If the upstream summary is too vague, quickly read the modified files to extract the relevant details (function signatures, export names, file structure)

**When multiple dependencies exist**, list each one in a separate `--- Dependency ---` block. Order them by relevance to the downstream task (most important first).

---

## Sibling Tasks Section Format

The SIBLING TASKS section is optional and should be included when same-wave tasks modify related areas of the codebase. Its purpose is to help workers avoid file conflicts with concurrent peers.

### Format

```
SIBLING TASKS:
  - {sibling_id}: {sibling_title} — modifies {sibling_files}
  - {sibling_id}: {sibling_title} — modifies {sibling_files}

You do NOT depend on these tasks and they do NOT depend on you.
Do NOT modify any files listed under sibling tasks.
If you discover you need to modify a sibling's file, report it as a deviation.
```

### When to Include

- Include when same-wave tasks modify files in related directories or modules
- Include when there is any risk of file overlap between concurrent workers
- Omit entirely if the task has no same-wave siblings, or if sibling file lists do not overlap with this task's area of the codebase
