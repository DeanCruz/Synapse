# `!p_track {prompt}`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are now the MASTER AGENT. You do NOT write code. You do NOT implement anything. You do NOT edit application files. You ONLY plan and dispatch worker agents. No exceptions. Not "just one small thing." Not "it's faster if I do it." NEVER.**
>
> **2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. Do not skip this. Do not work from memory. Read it NOW.**
>
> **3. You MUST use the dashboard. Write `initialization.json`, use `logs.json`, dispatch workers who write progress files. The dashboard is how the user sees the swarm. Skipping it is a failure.**
>
> **4. You MUST dispatch ALL implementation work via worker agents using the Task tool. Every file edit, every code change, every test — dispatched to a worker. The master's only job is: read context → plan tasks → write dashboard → dispatch agents → monitor → report.**
>
> **If the user's prompt is long or complex, that is MORE reason to follow these rules, not less. Long prompts require MORE planning and MORE agents, not direct implementation.**

**Purpose:** The invoking agent becomes the **master agent** — responsible for deep planning, dependency-aware parallel dispatch, live Synapse dashboard updates, and timely detailed statusing. Tasks are dispatched the instant their dependencies are satisfied, regardless of wave boundaries. The master agent's primary job is **deep planning** and **timely detailed statusing**.

**Syntax:** `!p_track [--dashboard dashboardN] {prompt}`

- `{prompt}` — Natural-language description of the work to be done.
- `--dashboard dashboardN` — (Optional) Force a specific dashboard. If omitted, the master auto-selects the first available dashboard.

**Examples:**
```
!p_track refactor the auth flow to use real Firebase Auth
!p_track --dashboard dashboard3 migrate all hardcoded colors to CSS variables
!p_track add rate limiting to all HTTP endpoints
```

### `!p` vs `!p_track` Decision Matrix

| Condition | Command | Why |
|---|---|---|
| <5 tasks + <5 min total estimated work | `!p` | Lightweight dispatch — planning overhead not justified |
| 5+ tasks OR 5+ min estimated work | `!p_track` | Full planning, dependency tracking, and live dashboard |
| Cross-repo work (any size) | `!p_track` | Dependency tracking prevents cross-repo conflicts |
| Shared files between tasks | `!p_track` | Explicit shared-file pattern selection required |

**Rule of thumb:** If you can describe the full plan in your head in 10 seconds, use `!p`. If you need to draw a dependency graph, use `!p_track`.

---

**Output files:**
```
{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.xml               ← Master XML task file (single source of truth)
{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md            ← Parallelization strategy rationale
{tracker_root}/dashboards/{dashboardId}/initialization.json             ← Static plan data (written once)
{tracker_root}/dashboards/{dashboardId}/logs.json                       ← Timestamped event log
```

> **`{tracker_root}`** refers to the Synapse directory (Synapse). Locate it relative to the project root — it may be at `./Synapse/`, `../Synapse/`, or wherever the user has placed it.
>
> **`{dashboardId}`** is automatically selected by scanning dashboards 1-5 for the first available slot. A dashboard is "available" if its `initialization.json` has `task: null`, or if all its progress files show terminal status (completed/failed). The user can override with `--dashboard dashboardN`. See `{tracker_root}/agent/instructions/dashboard_resolution.md` for the full selection algorithm.

**Dashboard:** Synapse Electron app — live visualization powered by `initialization.json`, `logs.json`, and `progress/` files merged client-side.

---

## Phase 1: Planning — Deep Analysis & Decomposition

### Step 1: Resolve `{project_root}` and read project context

Resolve `{project_root}` using the standard resolution order (see `{tracker_root}/CLAUDE.md` — Path Convention section): explicit `--project` flag → stored config at `{tracker_root}/.synapse/project.json` → agent's CWD.

Read `{project_root}/CLAUDE.md` (if one exists). If `{project_root}/.synapse/toc.md` exists, read it for semantic orientation. Identify which directories or sub-projects are affected. If those directories have their own `CLAUDE.md` files, read them **in parallel**. If no `CLAUDE.md` exists, scan the project structure to understand the codebase layout.

### Step 2: Read the tracker master instructions

**Before writing anything to `initialization.json` or `logs.json`, read:**

```
{tracker_root}/agent/instructions/tracker_master_instructions.md
```

This file maps every UI panel to the exact fields that drive it, specifies write timing for each moment in the swarm lifecycle, and documents common mistakes. **Do not skip this step.**

> **Note:** Worker agents will read `{tracker_root}/agent/instructions/tracker_worker_instructions.md` for their progress reporting protocol. The master does not need to read it, but should be aware it exists — worker prompts reference it.

### Step 3: Parse the prompt

Extract:
- **Prompt** — The natural-language task description.
- **Task name** — Generate a short kebab-case slug (e.g., `refactor-auth-flow`, `add-rate-limiting`).
- **Affected directories** — Which directories or sub-projects the work touches.

### Step 4: Deep analysis

Think through the full scope before touching any files:
- What directories or sub-projects are involved?
- What files need to be read, modified, or created?
- What are the **strict dependencies** between subtasks? What MUST be sequential vs. what CAN run independently?
- What could go wrong? What edge cases exist?
- What are the critical details an agent would need to know to avoid mistakes?

### Step 5: Read all relevant context files

Read **every file** needed to fully understand the task scope — source code, types, existing implementations, documentation. **Parallelize all reads.** Do not proceed until you have full context.

### Step 6: Decompose into tasks

Break the work into the smallest atomic tasks possible. For each task determine:
- **Independent** — No blockers, can be dispatched immediately
- **Dependent** — Has specific task dependencies that must complete first

Group tasks into **logical waves** by dependency level:
- **Wave 1** — All tasks with zero dependencies
- **Wave 2** — Tasks that depend only on Wave 1 tasks
- **Wave N** — Tasks that depend on Wave N-1 tasks

#### Decomposition Cost-Benefit Check

Before finalizing the task list, apply this heuristic: **if splitting a task doesn't reduce the critical path by at least 20%, merge it back.** 20 tiny tasks can cost more in orchestration overhead (prompt construction, dispatch cycles, upstream result injection, status tracking) than 4 medium ones. The goal is maximum parallelism with minimum coordination tax.

- **Merge candidates:** Tasks under 1 minute that share the same files or directory
- **Split candidates:** Tasks over 5 minutes, or tasks that block 3+ downstream tasks
- **Sweet spot:** 4-8 tasks per swarm for most work; 10-15 for large cross-repo efforts

### Step 7: Determine parallelization type

Analyze the dependency graph and decide which visualization is more beneficial:

**Waves** — Best when:
- Most tasks within a wave are truly independent
- Dependencies align cleanly along wave boundaries
- Expected completion times within a wave are roughly similar
- The work is broad and shallow (many independent tasks, few dependency layers)

**Chains** — Best when:
- There are long sequential dependency paths with varying completion times
- Different chains progress independently at different rates
- The work is narrow and deep (fewer parallel tracks, longer sequences)
- The user benefits more from seeing end-to-end progress along each chain

Choose the type that gives the user the clearest picture of progress and bottlenecks.

---

### Step 8: Create the parallelization plan document

Create `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md` with the following structure:

```markdown
# Parallel Execution Plan: {task-slug}

## Parallelization Type: {Waves|Chains}

### Why This Type Was Chosen
{2-3 sentences explaining why Waves or Chains is the better fit for this specific task}

## Task Organization

### Wave 1 — {wave name}
| Task | Description | Directory | Dependencies | Est. Complexity |
|---|---|---|---|---|
| 1.1 | {title} | {dir} | None | {Low/Medium/High} |

### Wave 2 — {wave name}
| Task | Description | Directory | Dependencies | Est. Complexity |
|---|---|---|---|---|
| 2.1 | {title} | {dir} | 1.1, 1.3 | {Low/Medium/High} |

## Dependency Analysis
{Explain the dependency graph — which tasks gate which, where the critical path is, what the longest chain is}

## Dispatch Strategy
{Explain how agents will be dispatched — all Wave 1 immediately, then dependency-driven dispatch regardless of wave boundaries. Identify any tasks that can be dispatched early if their specific dependencies clear before the full wave completes.}

## Risk Assessment
{Identify potential failure points, tasks most likely to produce warnings, and how failures in key tasks would cascade through the dependency graph}

## Alternative Approaches Considered
{If there was a more effective way to organize this, note it here with reasoning for why the chosen approach was selected instead. If the chosen approach is clearly optimal, state that and explain why.}

### Step 9: Create the master XML task file

Create `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.xml` with the full task breakdown.

> Create the `tasks/{MM_DD_YY}/` directory if it doesn't exist.

**XML Schema:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<parallel_task name="{task-slug}" created="{YYYY-MM-DD HH:MM}">

  <metadata>
    <prompt>{original user prompt}</prompt>
    <type>{Waves|Chains}</type>
    <directory>
      <dir>{affected directory}</dir>
      <!-- One <dir> per affected directory or sub-project -->
    </directory>
    <affected_projects>{comma-separated directory list}</affected_projects>
    <total_tasks>{count}</total_tasks>
    <total_waves>{count}</total_waves>
    <overall_status>pending</overall_status>
    <!-- pending | in_progress | completed | failed -->
  </metadata>

  <waves>

    <wave id="1" name="{descriptive wave name}" status="pending">
      <task id="1.1">
        <title>{Short descriptive title — under 40 chars}</title>
        <description>{Detailed description of exactly what the agent must do}</description>
        <directory>{directory this task targets}</directory>
        <depends_on></depends_on>
        <!-- Comma-separated task IDs, e.g. "1.1, 1.3" — empty if no dependencies -->
        <context>{All context the agent needs — current file state, architectural decisions, references to other tasks and what they produce}</context>
        <critical>{CRITICAL details — things that MUST be known to avoid mistakes. Gotchas, edge cases, non-obvious requirements. Omit if none.}</critical>
        <tags>{comma-separated: e.g., backend, frontend, types, service, refactor, migration, docs}</tags>
        <files>
          <file action="read|modify|create|delete">{file path}</file>
        </files>
        <status>pending</status>
        <!-- pending | claimed | in_progress | completed | failed | blocked -->
        <assigned_agent></assigned_agent>
        <started_at></started_at>
        <completed_at></completed_at>
        <summary></summary>
        <logs>
          <!-- Agents append timestamped log entries here -->
        </logs>
      </task>

      <task id="1.2">
        <!-- ... -->
      </task>
    </wave>

    <wave id="2" name="{descriptive wave name}" status="pending">
      <task id="2.1">
        <title>{title}</title>
        <description>{description}</description>
        <directory>{directory}</directory>
        <depends_on>1.1, 1.3</depends_on>
        <context>{context}</context>
        <critical>{critical details}</critical>
        <tags>{tags}</tags>
        <files>
          <file action="modify">{path}</file>
        </files>
        <status>pending</status>
        <assigned_agent></assigned_agent>
        <started_at></started_at>
        <completed_at></completed_at>
        <summary></summary>
        <logs></logs>
      </task>
    </wave>

    <!-- Additional waves as needed -->

  </waves>

  <dependency_chains>
    <!-- Each chain traces a full path from root task to terminal task -->
    <!-- Tasks with no dependencies start chains; tasks with no dependents end them -->
    <chain id="1">{task_id}, {task_id}, {task_id}</chain>
    <chain id="2">{task_id}, {task_id}</chain>
  </dependency_chains>

</parallel_task>
```

**Task status lifecycle:**
1. `pending` — Not started, waiting for dependencies or dispatch
2. `claimed` — Master has selected this task for dispatch (set in XML before agent launch)
3. `in_progress` — Agent is actively working
4. `completed` — Done successfully
5. `failed` — Error occurred (agent logs the error)
6. `blocked` — Cannot proceed due to failed dependency


### Step 10: Verify and add dependency chains

1. **Re-read the XML** — Read `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.xml` in full.
2. **Cross-check with the .md** — Look for any discrepancies or inconsistencies between the XML task definitions and the .md plan. Fix any found.
3. **Verify all dependencies** — For every task with a `<depends_on>` value:
   - Confirm the referenced task IDs exist in the XML
   - Confirm the dependency direction is correct (the depended-on task produces what this task needs)
   - Confirm no circular dependencies exist
4. **Build dependency chains** — Trace every path from root tasks (no dependencies) to terminal tasks (nothing depends on them). Each unique path is a chain.
5. **Write the chains** — Populate the `<dependency_chains>` section in the XML with all chains.
6. **Identify the critical path** — The longest chain determines the minimum total execution time.

#### Dependency Validation Algorithm

Use this explicit algorithm to validate the dependency graph before proceeding:

1. **Topological sort** — Process tasks in dependency order. If you cannot complete the sort (a task's dependencies never resolve), you have a cycle. Fix it before continuing.
2. **Compute critical path length** — For each task, calculate `depth = max(depth of dependencies) + 1`. The task with the highest depth defines the minimum number of waves. The chain passing through it is the critical path.
3. **Identify bottleneck tasks** — Any task that appears in the `depends_on` of 3+ other tasks is a bottleneck. Its failure cascades widely. Flag it in the plan document and ensure its prompt is thorough.
4. **Verify no orphans** — Every task ID referenced in `depends_on` must exist. Every task must be reachable from a root task (no disconnected subgraphs unless intentional).

---

### Step 11: Select a dashboard and populate the plan

#### 11-PRE. Select a dashboard

Before writing any plan data, the master must claim an available dashboard. This ensures new swarms never interfere with in-progress dashboards.

**If the user specified `--dashboard dashboardN`:**
- Use that dashboard directly.
- If it has an active swarm (in-progress agents), warn the user and require confirmation before overwriting.
- If it has a completed swarm, save a history summary to `{tracker_root}/history/` before overwriting.

**If no dashboard was specified (auto-selection):**
1. Scan `dashboard1` through `dashboard5` in order.
2. For each dashboard, read `{tracker_root}/dashboards/{dashboardId}/initialization.json`:
   - If `task` is `null` → **available**. Claim this dashboard.
   - If `task` is not null, read all files in `progress/`:
     - If no progress files exist → **stale** (plan written but never dispatched). Treat as available.
     - If every progress file has status `"completed"` or `"failed"` → **finished but uncleared**. Save a history summary to `{tracker_root}/history/`, then claim this dashboard.
     - Otherwise → **in use**. Skip to next dashboard.
3. If all 5 dashboards are in use, display a summary table:

```markdown
## All Dashboards In Use

| Dashboard | Task | Status | Progress |
|---|---|---|---|
| dashboard1 | {task.name} | {overall_status} | {completed}/{total} |
| ... | ... | ... | ... |

Pick a dashboard to overwrite, or run `!reset {dashboardId}` first.
```

4. Set `{dashboardId}` to the selected dashboard. Announce: **"Using {dashboardId} for this swarm."**

> **See `{tracker_root}/agent/instructions/dashboard_resolution.md`** for the full `selectDashboard()` algorithm and status derivation logic.

---

**Before presenting the plan to the user**, write the full plan to the dashboard so the user has a visual representation of the task breakdown, dependencies, and wave structure while they review it.

**Always use atomic read-modify-write:** Read the full file, parse JSON, modify the in-memory object, stringify with 2-space indent, write the full file back. Never write partial JSON.

#### 11A. Archive and clear the dashboard

**If the dashboard contains data from a previous swarm** (i.e., `initialization.json` has `task` not `null`), **archive it first** before clearing:

```bash
# 1. Archive the previous swarm (MANDATORY — never skip)
TASK_NAME=$(cat {tracker_root}/dashboards/{dashboardId}/initialization.json | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
ARCHIVE_NAME="$(date -u +%Y-%m-%d)_${TASK_NAME:-unnamed}"
mkdir -p {tracker_root}/Archive/${ARCHIVE_NAME}
cp -r {tracker_root}/dashboards/{dashboardId}/* {tracker_root}/Archive/${ARCHIVE_NAME}/

# 2. Clear progress files
rm -f {tracker_root}/dashboards/{dashboardId}/progress/*.json
```

Create the dashboard directory structure if it doesn't exist:

```bash
mkdir -p {tracker_root}/dashboards/{dashboardId}/progress
```

#### 11B. Write initialization.json — static plan data

**`initialization.json` is write-once.** The master writes it during planning and **never updates it again**. All dynamic lifecycle data (agent status, started_at, completed_at, summary, counters) lives in worker progress files and is derived by the dashboard at render time.

Set `task`:
```json
{
  "name": "{task-slug}",
  "type": "{Waves|Chains}",
  "directory": "{primary directory — optional}",
  "prompt": "{original user prompt}",
  "project": "{comma-separated affected directories}",
  "project_root": "{resolved absolute path to target project}",
  "created": "{ISO 8601 timestamp}",
  "total_tasks": "{count}",
  "total_waves": "{count}"
}
```

- **`type`** — `"Waves"` or `"Chains"`. Must match the type chosen in Step 7. Controls the dashboard layout mode.
- **`directory`** — The master task's primary working directory. Displayed as a badge in the header bar. Optional — omit if the task spans many directories equally.

Set `agents` array — one entry per task (plan data only, no lifecycle fields):
```json
{
  "id": "{wave}.{task}",
  "title": "{short task title}",
  "wave": "{wave number}",
  "layer": "{frontend|backend|documentation|types|migration|tests|config — optional}",
  "directory": "{directory this task targets — optional}",
  "depends_on": ["{task_id}", "{task_id}"]
}
```

- **`directory`** — Per-task directory shown as a blue badge on the agent card. Useful when tasks within a swarm target different directories. Omit if not useful.
- **`depends_on`** — Array of task ID strings this task depends on. Used in both modes to draw dependency lines between cards. Use empty array `[]` for root tasks with no dependencies.

Set `waves` array — one entry per wave (structure only, no status or completed counts — those are derived):
```json
{
  "id": "{wave number}",
  "name": "{descriptive wave name}",
  "total": "{task count in this wave}"
}
```

If **type is `"Chains"`**, also set `chains` array:
```json
"chains": [
  {
    "id": 1,
    "name": "{descriptive chain name}",
    "tasks": ["{task_id}", "{task_id}", "{task_id}"]
  },
  {
    "id": 2,
    "name": "{chain name}",
    "tasks": ["{task_id}", "{task_id}"]
  }
]
```

- Each chain defines a horizontal row in the dashboard.
- `tasks` is an ordered array of agent IDs tracing the dependency path from left to right.
- Each agent must appear in exactly one chain.
- Chain order (by `id`) determines top-to-bottom row order.

Set `history` to `[]` (or preserve from a previous initialization.json if relevant).

Write to `{tracker_root}/dashboards/{dashboardId}/initialization.json`.

#### 11C. Write logs.json — initialization entry

Append to `entries` in `{tracker_root}/dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Task initialized: {task-slug} — {N} tasks across {W} waves — Type: {Waves|Chains} — Dir: {directory} — {brief description}",
  "task_name": "{task-slug}"
}
```

Write back.

#### 11D. Present the plan to the user

The dashboard is now live with the full plan — all tasks visible as pending cards with dependency lines drawn. Present the terminal summary alongside it:

```markdown
## Parallel Execution Plan: {task-slug}

**Type:** {Waves|Chains}
**Directories:** {affected directories}
**Dashboard:** Synapse Electron app (live — review the visual plan there)

### Wave 1 — {wave name} (parallel — {N} tasks)
| Task | Description | Directory | Dependencies |
|---|---|---|---|
| 1.1 | {title} | {dir} | None |
| 1.2 | {title} | {dir} | None |

### Wave 2 — {wave name} (parallel — {N} tasks)
| Task | Description | Directory | Dependencies |
|---|---|---|---|
| 2.1 | {title} | {dir} | 1.1, 1.3 |

### Dependency Chains
| Chain | Path | Critical? |
|---|---|---|
| 1 | 1.1 → 2.1 → 3.1 | Yes (longest) |
| 2 | 1.2 → 2.2 | No |
| 3 | 1.3 | No (single task) |

**Total:** {N} tasks across {W} waves
**Critical path:** Chain {X} ({N} tasks deep)
**Dispatch strategy:** Tasks dispatched the instant all their dependencies are met — not waiting for full wave completion.
**XML:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.xml`
**Plan:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`
```

**Wait for user approval before proceeding to Phase 2.**

---

## Phase 2: Execution — Dependency-Driven Dispatch

### Step 12: Begin execution

The dashboard is already populated with the full plan from Step 11. All tasks are visible as pending. Now begin dispatching agents.

> **Note:** The master does NOT update `initialization.json` after planning. There is no `started_at` or `overall_status` to set — the dashboard derives the swarm start time from the earliest worker's `started_at` in their progress files, and derives overall status from the aggregate of all progress files.

---

### Step 13: Dispatch initial agents

Dispatch **every task whose dependencies are already satisfied** (all of Wave 1, plus any higher-wave tasks with no blockers). There is **no fixed concurrency cap** — maximize parallelism.

For each dispatched task, follow this **exact sequence**:

#### A. Launch the agent FIRST

Dispatch the Task agent with the full prompt (see Step 14 for the prompt template). The agent is now running.

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
     "message": "Dispatched: {task title}",
     "task_name": "{task-slug}"
   }
   ```
   Write back.

> **Note:** The master does NOT update `initialization.json` on dispatch. Workers write their own `status`, `assigned_agent`, and `started_at` to their progress files. The dashboard derives agent status from progress files.

**Do NOT display a terminal status table.** The dashboard is the primary reporting channel. The master outputs only a brief one-line confirmation per dispatch batch (e.g., "Dispatched Wave 1: 4 agents").

---

### Step 14: Swarm agent prompt template

Every dispatched agent receives a **self-contained prompt** with all context needed to work independently. The master embeds relevant project conventions and patterns directly into the prompt to minimize redundant reading by workers. Use this template:

```
You are a worker agent in the "{task-slug}" swarm, executing task {id}.

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
{Relevant sections extracted from {project_root}/CLAUDE.md by the master.
Include naming conventions, file structure rules, import patterns, testing requirements.
Quote directly from the CLAUDE.md — do not paraphrase. Omit section if no CLAUDE.md exists.}

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

CRITICAL:
{critical details from XML <critical> — omit section if empty}

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

3. SELF-ASSESSMENT — answer these specific questions before proceeding:
   a. Can I identify EVERY file I need to modify? (If no → read the project structure)
   b. Do I understand the PATTERNS I need to follow? (If no → read the reference files listed above)
   c. Can I describe my implementation approach in one sentence? (If no → re-read the context)
   d. Are there any AMBIGUITIES in the task description? (If yes → make the most reasonable
      choice, document it as a deviation, and proceed)
   If after reading 3 additional files you still lack clarity, report the specific gap
   as a blocker in your return rather than reading the entire codebase.

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
DIVERGENT ACTIONS: (omit entirely if none — include if ANY deviation from the plan occurred)
  - {what was different from the plan and why}
WARNINGS: (omit entirely if none)
  - {description of unexpected finding or issue}
ERRORS: (omit entirely if none)
  - {description of error that prevented completion}
```

#### Prompt Completeness Checklist

Before dispatching each agent, verify the prompt contains all of these. A missing item is the #1 cause of worker confusion:

| Required Element | Check |
|---|---|
| **File paths** | Every file to read/modify/create is listed with its full relative path |
| **CLAUDE.md conventions** | Relevant sections quoted directly (not paraphrased) from the target repo's CLAUDE.md |
| **Reference code** | If the worker must follow an existing pattern, a working example is included |
| **Upstream results** | For downstream tasks: summary, files changed, new exports, and deviations from each dependency |
| **Success criteria** | The worker can unambiguously determine when the task is done |
| **Critical details** | Edge cases, gotchas, and non-obvious constraints are explicitly stated |

If any element is missing, add it before dispatch. Do not assume the worker will figure it out.

---

### Step 15: Process completions and dispatch immediately

**This is the core execution loop.** Every time an agent returns:

#### A. Parse the agent's return

Extract `STATUS`, `SUMMARY`, `FILES CHANGED`, `DIVERGENT ACTIONS`, `WARNINGS`, and `ERRORS` from the agent's response.

#### B. Update the master XML

Read the XML. Find the task by `id`:
- Set `<status>` to `completed` or `failed`
- Set `<completed_at>` to current ISO timestamp
- Write `<summary>` with the agent's SUMMARY line
- Append any logs, warnings, or divergent actions to `<logs>`
Write back.

#### C. Append to logs.json

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

#### D. Cache the result for downstream injection

Store the completed task's results in the master's working memory:
- Task ID, title, status
- Summary (the worker's SUMMARY line)
- Files changed (the worker's FILES CHANGED list)
- Any new interfaces, types, exports, or APIs introduced (extracted from the summary or worker return)
- Any deviations or warnings

This cache is used to populate the `UPSTREAM RESULTS` section when dispatching downstream tasks. After context compaction, reconstruct the cache from prior conversation output or by re-reading the XML summaries.

#### E. Scan for newly dispatchable tasks — CRITICAL

After processing a completion, **read the master XML** and scan ALL pending tasks across ALL waves:
- If a task's `<depends_on>` references are ALL now `"completed"`, dispatch it **immediately**.
- **Do NOT wait for the rest of its wave.** Do NOT wait for anything other than its direct dependencies.
- If multiple tasks become available, dispatch ALL of them simultaneously.

**When dispatching downstream tasks, include upstream results:** For each dependency listed in the downstream task's `<depends_on>`, pull the cached result (from Step 15D) and embed it in the worker prompt's `UPSTREAM RESULTS` section. This ensures downstream workers know exactly what their prerequisites produced, including any deviations from the plan.

Update tracker files for each newly dispatched task **after dispatch** (per the NON-NEGOTIABLE rule in Step 13B).

#### G. Handle failures

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

#### Failure Taxonomy

Use the failure stage to diagnose root cause before deciding next steps:

| Worker Stage at Failure | Likely Root Cause | Action |
|---|---|---|
| `reading_context` | Upstream issue — missing file, bad path, or failed dependency produced unexpected output | Check upstream task's output; verify file paths in prompt |
| `implementing` | Ambiguous spec — the task description or context is insufficient | Rewrite the prompt with more detail and reference code |
| `testing` | Integration issue — the code works in isolation but conflicts with other changes | Dispatch a verification agent or merge with the conflicting task |

#### Retry vs. Replan Decision

After a failure, decide scope of recovery:

- **If the failure blocks >50% of remaining pending tasks** → **replan the swarm.** The dependency graph is too damaged for piecemeal fixes. Reassess the decomposition, merge tasks if needed, and re-dispatch.
- **If the failure blocks <50% of remaining tasks** → **retry the individual task.** Fix the prompt (using the taxonomy above), re-dispatch, and continue the swarm.
- **If the same task fails twice** → escalate to the user regardless of blast radius.

---

### Step 16: Terminal output during execution

**The dashboard is the primary reporting channel.** The master agent does NOT display full status tables during execution. Workers write their own live progress to `{tracker_root}/dashboards/{dashboardId}/progress/{id}.json`, which the dashboard renders in real-time.

The master outputs only minimal terminal confirmations:
- On dispatch: `"Dispatched Wave {N}: {M} agents — {wave name}"`
- On completion: `"Agent {N} completed: {summary}"` (one line)
- On failure: `"Agent {N} FAILED: {error}"` (one line)
- On deviation: `"Agent {N} DEVIATED: {description}"` (one line)

**Full terminal status tables are only displayed when the user runs `!status`.** This saves significant context tokens during execution.

---

### Step 17: Overall completion

When all tasks reach `"completed"` or `"failed"`:

#### A. Update the master XML
Set `<overall_status>` to `completed` (or `failed` if any tasks failed without recovery).

#### B. Append final log entry

Run `date -u +"%Y-%m-%dT%H:%M:%SZ"` to capture the completion timestamp.

Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{captured timestamp}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Swarm complete: {completed}/{total} tasks succeeded, {failed} failed",
  "task_name": "{task-slug}"
}
```
Write back.

> **Note:** The master does NOT update `initialization.json` on completion. The dashboard derives `overall_status` and `completed_at` from the aggregate of worker progress files. The elapsed timer freezes when all workers have `completed_at` set in their progress files.

#### C. Post-swarm verification (when warranted)

Before delivering the final report, assess whether a verification step is needed:

| Condition | Verification |
|---|---|
| Modified existing code across multiple files | Dispatch a verification agent — run tests, type check, build |
| Purely additive (new files only, no modifications) | Verification optional |
| Any tasks reported deviations | Verification strongly recommended |
| All tasks succeeded with no warnings | May skip verification |

If verification is needed, dispatch a single verification agent:
```
You are verifying the combined output of a {N}-task parallel swarm: "{task-slug}"

## Files Changed
{Complete list from the master's result cache — all files created/modified/deleted across all tasks}

## What To Verify
1. Run the project's test suite (if one exists)
2. Run type checking (if applicable)
3. Run the build (if applicable)
4. Check for integration issues: missing imports, conflicting exports, broken references between files changed by different workers

## Report
Return:
- TESTS: pass | fail | no test suite
- TYPES: pass | fail | N/A
- BUILD: pass | fail | N/A
- ISSUES: {list of any integration problems found, or "None"}
```

#### Cross-Repo Verification

When the swarm spans multiple repositories, add these checks to the verification agent's prompt:

1. **Type/interface consistency** — For every shared type or API contract modified by the swarm, verify that all consuming repos use the updated signature. Grep for the type name across all affected repos.
2. **Import path validity** — Verify that cross-repo imports (if any) resolve correctly after file moves or renames.
3. **Contract alignment** — If the swarm modified both a backend API and its frontend consumer, verify request/response shapes match.

If cross-repo inconsistencies are found, log them at level `"warn"` and include them in the final report's Warnings section.

Log the verification result to `dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "{info if passed, warn if issues found}",
  "message": "Verification: {result summary}",
  "task_name": "{task-slug}"
}
```

#### D. Read logs and deliver final report

**Read `{tracker_root}/dashboards/{dashboardId}/logs.json` in full.** Analyze all entries for the current task. Then deliver:

```markdown
## Swarm Complete: {task-slug}

**{completed}/{total} tasks** · **{W} waves** · **{0 or N} failures** · **Type: {Waves|Chains}**

### What Was Done
{2-4 sentences. What was the goal? What was accomplished? Any significant decisions made?}

### Files Changed
| File | Action | Task |
|---|---|---|
| {path} | created / modified / deleted | {task id} |

### Important Logs & Observations
{Summary of the most significant log entries — not every log, just the ones that matter.
Focus on: unexpected findings, key decisions, performance notes.}

### Divergent Actions
(Only if any agents deviated from the plan — omit entirely if all agents followed the plan exactly)
- **{task id} — {title}:** {what was different and why}

### Warnings
(Only if agents reported unexpected findings — omit entirely if none)
- **{task id}:** {warning description}

### Failures
(Only if tasks failed — omit entirely if all succeeded)
- **{task id} — {title}:** {what failed and why}
- **Blocked by failure:** {any tasks that could not run as a result}

### Verification
(Only if a verification step was run — omit entirely if skipped)
- **Tests:** {pass | fail | no test suite}
- **Types:** {pass | fail | N/A}
- **Build:** {pass | fail | N/A}
- **Issues:** {list of integration problems, or "None"}

### Recommendations & Next Steps
(Only if applicable — omit entirely if the task is fully complete with no follow-up needed)
- {Recommendation or next step based on what was learned during execution}

### Artifacts
- **XML:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.xml`
- **Plan:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`
- **Dashboard:** `{tracker_root}/dashboards/{dashboardId}/initialization.json`
- **Logs:** `{tracker_root}/dashboards/{dashboardId}/logs.json`
```

---

## Rules (Non-Negotiable)

### Dispatch & Tracking

1. **Dispatch FIRST, update tracker AFTER.** The agent must be launched before `logs.json` is updated with the dispatch. This is the single most important rule. Never write dispatch info to the tracker before the agent is actually running.
2. **Dependency-driven dispatch, not wave-driven.** Waves are a visual grouping. Dispatch logic looks ONLY at individual task dependencies. If task 2.3 depends only on 1.1 and 1.1 is done, dispatch 2.3 immediately — even if 1.2 through 1.8 are still running.
3. **Fill all open slots simultaneously.** When a completion unlocks multiple tasks, dispatch ALL of them in the same cycle.
4. **No artificial concurrency cap.** Send as many agents as there are dispatchable tasks. If the tool limits simultaneous dispatches (~8-10), send multiple dispatch rounds back-to-back without waiting for the first batch to complete.
5. **Errors do not stop the swarm — but cascading failures trigger reassessment.** Log errors, display them, continue with all non-dependent tasks. But if 3+ tasks fail in the same wave, or a failure blocks more than half of remaining tasks, pause and reassess with the user (see Step 15G circuit breaker).

### Statusing

6. **Dashboard is the primary reporting channel.** Do NOT output terminal status tables during execution — workers write their own live progress to `{tracker_root}/progress/{id}.json`. Terminal output is limited to one-line confirmations per event.
7. **Terminal status tables only on `!status`.** The full table is displayed only when the user explicitly requests it.
8. **Tracker writes are mandatory.** The master writes `initialization.json` once during planning, and appends to `logs.json` on every dispatch, completion, failure, and deviation. Workers handle their own progress via progress files.
9. **Atomic writes only.** Always read → modify in memory → write the full file. Never write partial JSON.
10. **Timestamps must be live.** Always run `date -u +"%Y-%m-%dT%H:%M:%SZ"` at the exact moment of writing. Never construct timestamps from memory or context.
11. **Workers own all lifecycle data.** Agent status, started_at, completed_at, summary, and live progress are written by workers to their progress files. The master does not maintain these — the dashboard derives them.

### Agent Prompts

12. **Agent prompts must be self-contained.** Every agent receives its full context in its dispatch prompt — including conventions extracted from CLAUDE.md, reference code patterns, and upstream results.
13. **Agents read only their XML section.** Every agent prompt instructs the agent to read ONLY their task section in the XML, not the entire file. The master already extracted all relevant context into the prompt.
14. **Master embeds conventions, workers don't re-read.** The master extracts relevant CLAUDE.md sections into each worker's CONVENTIONS block. Workers only read CLAUDE.md if the master couldn't provide conventions.
15. **Agents must write live progress.** Every agent writes stage transitions, milestones, and logs to `{tracker_root}/dashboards/{dashboardId}/progress/{id}.json`. This is how the dashboard shows real-time worker activity.
16. **Agents must report deviations immediately.** Any deviation from the plan must be written to the progress file deviations array AND included in the final return. Deviations trigger a yellow badge on the dashboard. Failing to report a deviation is a task failure.
17. **Agents self-assess with structured criteria.** Before executing, agents answer four specific questions: Can I identify every file? Do I understand the patterns? Can I describe my approach? Are there ambiguities? This replaces vague "do I know enough" self-assessment.

### Upstream Results & Caching

18. **Cache every completion.** When a worker returns, the master stores its summary, files changed, new interfaces, and deviations in working memory. This cache feeds downstream prompts.
19. **Feed upstream results into downstream prompts.** Every downstream task's prompt includes its dependencies' results in the UPSTREAM RESULTS section. Downstream workers must know what their prerequisites produced, including deviations.
20. **Reconstruct cache after compaction.** If context compaction drops the result cache, re-read the XML summaries to rebuild it before dispatching downstream tasks.

### Planning

21. **Plan before executing.** Always create the XML. Always create the .md plan. Always verify dependencies. Always get user approval.
22. **XML is the master file.** All agents read from it. The master updates it on every completion. It is the authoritative record of the task.
23. **Verify before dispatching.** After creating the XML and .md, re-read the XML, cross-check with the .md, verify all dependencies, and build dependency chains — all before presenting to the user.
24. **Right-size tasks.** Target 1-5 minutes per task. A task reading 2-3 files and modifying 1-2 files is right-sized. Tasks reading 10+ files or modifying 5+ files should be decomposed further.
25. **Handle shared files explicitly.** When multiple tasks need to modify the same file, use one of the shared file patterns (owner task, integration task, or append protocol). Never let two concurrent workers modify the same file.

#### Shared File Decision Tree

When multiple tasks need the same file, walk this tree:

```
Multiple tasks need the same file?
  │
  ├─ Can tasks create separate files that auto-import? (e.g., route files in a directory)
  │   └─ YES → Pattern C (append protocol — no shared file conflict)
  │
  ├─ Can the shared-file work be deferred to a later integration wave?
  │   └─ YES → Pattern B (integration task — maximize parallelism)
  │
  └─ Must the file be modified sequentially?
      └─ YES → Pattern A (owner task — sequential but safe)
```

### Parallelization

26. **Always parallelize independent work.** If two or more tasks have no dependency between them, run them in parallel. Never process tasks sequentially when they can run concurrently. This applies to file reads, file writes, searches, edits, agent dispatches — everything.
27. **Batch size: unlimited.** Dispatch as many agents as there are ready tasks. If the tool limits simultaneous dispatches, send multiple dispatch rounds back-to-back.
28. **Pipeline must flow continuously.** As slots open up (agents complete), immediately scan for and dispatch newly unblocked tasks.

### Verification

29. **Verify after completion when warranted.** If the swarm modified existing code across multiple files, dispatch a verification agent to run tests, type check, and build. Skip for purely additive swarms with no deviations. See Step 17C.

### Permission Requests

30. **Dashboard popup before terminal question.** If the master agent needs to ask the user a question during execution, write a `"permission"` level log entry to `{tracker_root}/dashboards/{dashboardId}/logs.json` FIRST, then ask in the terminal. This triggers the dashboard popup. See `tracker_master_instructions.md` for details.

---

## Timestamp Protocol

Every timestamp written to `initialization.json`, `logs.json`, progress files, or the XML must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Use the output of this command directly. Never guess, estimate, or hardcode timestamps.

Key timestamp moments:
- `task.created` — Written once in `initialization.json` during planning
- `logs.entries[].timestamp` — At every log write
- Worker progress timestamps (`started_at`, `completed_at`, milestone times) — handled by workers in their progress files

> **Note:** `started_at` and `completed_at` for the overall swarm are no longer written by the master to `initialization.json`. The dashboard derives the swarm start time from the earliest worker `started_at` and the swarm end time from the latest worker `completed_at` in progress files.
