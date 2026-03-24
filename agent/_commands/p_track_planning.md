# p_track Phase 1: Planning — Deep Analysis & Decomposition

> This module covers Steps 1-11 of `!p_track`. It is loaded by the master agent during the planning phase.
> For the full NON-NEGOTIABLE rules and command overview, see `{tracker_root}/_commands/Synapse/p_track.md`.

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

#### 4A. Consult the Dependency Graph

If `{project_root}/.synapse/dep_graph.json` exists, read it for file-level dependency information. The dep graph maps import relationships between files — which files import from which other files.

Use the dep graph to identify **coupling between files**: files that import from each other should generally be modified by the same task or in sequential tasks to avoid conflicts. If two planned tasks would modify tightly coupled files concurrently, flag this during decomposition (Step 6) and either merge the tasks or add an explicit dependency between them.

The dep graph is particularly valuable for:
- Detecting hidden coupling that task-level analysis may miss
- Identifying all consumers of a file that will be modified (blast radius)
- Validating that task boundaries align with module boundaries

If no dep graph exists, skip this step — the master proceeds with manual analysis from Step 5.

### Step 5: Read all relevant context files

Read **every file** needed to fully understand the task scope — source code, types, existing implementations, documentation. **Parallelize all reads.** Do not proceed until you have full context.

#### 5A. Build a Convention Map

After reading `{project_root}/CLAUDE.md`, categorize its conventions into a **convention_map** — a mental or written index that groups rules by domain. This map is used in Step 14 to filter conventions per-worker, ensuring each agent receives only the rules relevant to its specific task.

**Convention map categories:**

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

**Example convention_map.json structure:**
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

The master does not need to write this to a file — it is a planning artifact held in working memory. The categories are used during prompt construction (Step 14) to select which conventions to inject into each worker's prompt.

### Step 6: Decompose into tasks

Break the work into the smallest atomic tasks possible. For each task determine:
- **Independent** — No blockers, can be dispatched immediately
- **Dependent** — Has specific task dependencies that must complete first

Group tasks into **logical waves** by dependency level:
- **Wave 1** — All tasks with zero dependencies
- **Wave 2** — Tasks that depend only on Wave 1 tasks
- **Wave N** — Tasks that depend on Wave N-1 tasks

#### Dep Graph Coupling Check

If the dep graph was consulted in Step 4A, cross-reference it against the task decomposition: if two tasks modify files that have import dependencies between them (file A imports from file B, and task X modifies A while task Y modifies B), add an explicit task dependency or merge them. The dep graph reveals hidden coupling that task-level analysis may miss — a change to an exported interface in one file can break all its importers.

**Action items:**
- For each pair of concurrent tasks, check whether their target files have import relationships in the dep graph
- If coupling is found: either merge the tasks into one, or add a dependency so the upstream file is modified first
- Log any coupling-driven merges or dependency additions in the plan rationale document

#### Decomposition Cost-Benefit Check

Before finalizing the task list, apply this heuristic: **if splitting a task doesn't reduce the critical path by at least 20%, merge it back.** 20 tiny tasks can cost more in orchestration overhead (prompt construction, dispatch cycles, upstream result injection, status tracking) than 4 medium ones. The goal is maximum parallelism with minimum coordination tax.

- **Merge candidates:** Tasks under 1 minute that share the same files or directory
- **Split candidates:** Tasks over 5 minutes, or tasks that block 3+ downstream tasks
- **Sweet spot:** 4-8 tasks per swarm for most work; 10-15 for large cross-repo efforts

### Step 6B: Context Budget Check

Before proceeding to visualization and dispatch, verify that each task's prompt will fit within a reasonable context budget. Oversized prompts cause workers to miss critical details buried in noise.

**Per-task prompt budget guidelines:**

| Section | Max Lines | Notes |
|---|---|---|
| CONVENTIONS | ~200 lines | Extract only sections relevant to THIS task from CLAUDE.md. Do not dump the entire file. |
| REFERENCE CODE | ~100 lines | Include one complete, representative example. If more patterns are needed, summarize the rest. |
| UPSTREAM RESULTS | ~50 lines per dependency | Summarize to key facts: what was built, what files changed, what new exports exist. Do not paste raw summaries. |
| CONTEXT | ~150 lines | Focus on architectural decisions and current file state. Link to files rather than inlining large blocks. |
| Total prompt | ~800 lines | If a prompt exceeds this, the task should be split or context should be summarized further. |

**When a prompt exceeds the budget:**

1. **Summarize, don't paste.** Replace inline code blocks with one-line summaries and explicit file paths the worker can read.
2. **Split the task.** If the context is genuinely needed and cannot be summarized, the task is too large — decompose it further.
3. **Prioritize critical details.** Success criteria and critical gotchas should never be cut for space. Cut reference code and conventions first.
4. **Use READ file lists.** Instead of inlining a 200-line file, add it to the READ list and tell the worker what to look for: "READ: src/auth/middleware.ts — focus on the `validateToken` function signature and error handling pattern."

### Step 6C: Token Budget Estimate

After constructing each worker's dispatch prompt, the master should estimate the token budget of the prompt by breaking it into sections:

| Section | Description | Typical range |
|---|---|---|
| Task description | What the worker must do | 200-500 tokens |
| File context | Code snippets the worker needs to see | 500-2000 tokens |
| Conventions | Extracted CLAUDE.md sections | 300-800 tokens |
| Upstream results | Summaries from completed dependency tasks | 200-600 tokens |
| Critical details | Edge cases, gotchas, constraints | 200-400 tokens |
| Instructions | Worker protocol, progress file path, return format | 400-600 tokens |

**Budget limit: 8000 tokens (~32KB of text).** If a worker prompt exceeds this estimate:

1. **Split the task** — If the prompt is large because the task touches too many files, decompose it into smaller tasks.
2. **Summarize conventions** — Instead of quoting full CLAUDE.md sections, extract only the 3-5 most relevant rules as bullet points.
3. **Trim reference code** — Include only the specific functions/types the worker needs, not entire files. Use line ranges.
4. **Condense upstream results** — One-line summaries per completed task, not full progress file contents.

> **Prompt bloat is the #1 cause of worker context exhaustion.** A worker that receives a 15,000-token prompt has already consumed 15% of its context window before writing a single line of code. Keep prompts lean — every token should earn its place.

### Step 6D: Convention Relevance Checklist

Before extracting CLAUDE.md content for a worker prompt, use the **convention_map** built in Step 5A to select only the categories relevant to THIS specific task:

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

**Rules:**
1. Cross-reference each task's files and description against the convention_map categories from Step 5A
2. Only extract CLAUDE.md sections that match checked categories above
3. If the project CLAUDE.md exceeds 500 lines, ALWAYS summarize rather than quote — extract the 5-10 most relevant rules as bullet points
4. Cap convention content at ~200 lines in the worker prompt
5. If no categories apply (rare), include a 3-line summary of the project's tech stack and primary patterns

This filtering should be applied per-worker, not globally — different tasks need different convention subsets.


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
```

### Step 9: Create the master task file

Create `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json` with the full task breakdown.

> Create the `tasks/{MM_DD_YY}/` directory if it doesn't exist.

**JSON Schema:**

```json
{
  "name": "{task-slug}",
  "created": "{YYYY-MM-DDTHH:MM:SSZ}",
  "metadata": {
    "prompt": "{original user prompt}",
    "type": "{Waves|Chains}",
    "directories": ["{affected directory}"],
    "affected_projects": "{comma-separated directory list}",
    "total_tasks": 0,
    "total_waves": 0,
    "overall_status": "pending"
  },
  "waves": [
    {
      "id": 1,
      "name": "{descriptive wave name}",
      "status": "pending",
      "tasks": [
        {
          "id": "1.1",
          "title": "{Short descriptive title — under 40 chars}",
          "description": "{Detailed description of exactly what the agent must do}",
          "directory": "{directory this task targets}",
          "depends_on": [],
          "context": "{All context the agent needs — current file state, architectural decisions, references to other tasks and what they produce}",
          "critical": "{CRITICAL details — things that MUST be known to avoid mistakes. Gotchas, edge cases, non-obvious requirements. Null if none.}",
          "tags": ["backend", "frontend", "types", "service", "refactor", "migration", "docs"],
          "files": [
            { "action": "read|modify|create|delete", "path": "{file path}" }
          ],
          "status": "pending",
          "assigned_agent": null,
          "started_at": null,
          "completed_at": null,
          "summary": null,
          "logs": []
        },
        {
          "id": "1.2",
          "...": "..."
        }
      ]
    },
    {
      "id": 2,
      "name": "{descriptive wave name}",
      "status": "pending",
      "tasks": [
        {
          "id": "2.1",
          "title": "{title}",
          "description": "{description}",
          "directory": "{directory}",
          "depends_on": ["1.1", "1.3"],
          "context": "{context}",
          "critical": "{critical details}",
          "tags": ["{tags}"],
          "files": [
            { "action": "modify", "path": "{path}" }
          ],
          "status": "pending",
          "assigned_agent": null,
          "started_at": null,
          "completed_at": null,
          "summary": null,
          "logs": []
        }
      ]
    }
  ],
  "dependency_chains": [
    { "id": 1, "tasks": ["{task_id}", "{task_id}", "{task_id}"] },
    { "id": 2, "tasks": ["{task_id}", "{task_id}"] }
  ]
}
```

**Task status lifecycle:**
1. `pending` — Not started, waiting for dependencies or dispatch
2. `claimed` — Master has selected this task for dispatch (set in task file before agent launch)
3. `in_progress` — Agent is actively working
4. `completed` — Done successfully
5. `failed` — Error occurred (agent logs the error)
6. `blocked` — Cannot proceed due to failed dependency


### Step 10: Verify and add dependency chains

1. **Re-read the task file** — Read `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json` in full.
2. **Cross-check with the .md** — Look for any discrepancies or inconsistencies between the task file definitions and the .md plan. Fix any found.
3. **Verify all dependencies** — For every task with a `depends_on` value:
   - Confirm the referenced task IDs exist in the task file
   - Confirm the dependency direction is correct (the depended-on task produces what this task needs)
   - Confirm no circular dependencies exist
4. **Build dependency chains** — Trace every path from root tasks (no dependencies) to terminal tasks (nothing depends on them). Each unique path is a chain.
5. **Write the chains** — Populate the `dependency_chains` array in the task file with all chains.
6. **Identify the critical path** — The longest chain determines the minimum total execution time.

#### Dependency Validation Algorithm

Use this explicit algorithm to validate the dependency graph before proceeding:

1. **Topological sort** — Process tasks in dependency order. If you cannot complete the sort (a task's dependencies never resolve), you have a cycle. Fix it before continuing.
2. **Compute critical path length** — For each task, calculate `depth = max(depth of dependencies) + 1`. The task with the highest depth defines the minimum number of waves. The chain passing through it is the critical path.
3. **Identify bottleneck tasks** — Any task that appears in the `depends_on` of 3+ other tasks is a bottleneck. Its failure cascades widely. Flag it in the plan document and ensure its prompt is thorough.
4. **Verify no orphans** — Every task ID referenced in `depends_on` must exist. Every task must be reachable from a root task (no disconnected subgraphs unless intentional).

#### Dep Graph Validation

If `{project_root}/.synapse/dep_graph.json` was consulted in Step 4A, run a final validation pass on the task plan using the dep graph:

1. **Circular dependency check** — Verify that no circular dependencies exist between tasks. The topological sort above catches direct cycles; this step catches indirect cycles introduced by the dep graph coupling check in Step 6.
2. **Coupled file sequencing** — For every pair of tasks that modify files with import dependencies (per `dep_graph.json`), verify they are properly sequenced — either in the same task or connected by an explicit dependency. Flag any concurrent tasks that modify coupled files.
3. **Scope validation** — Flag any tasks that modify files not mentioned in the original prompt's scope. Files discovered via the dep graph's transitive import chains may extend the blast radius beyond what the user expects.

Use `!deps validate` (if available) as the validation tool for automated checks. If the command is not available, perform the validation manually by cross-referencing the dep graph against the task plan.

If validation reveals issues, fix them before proceeding to Step 11. Do not write `initialization.json` or the task file with an invalid dependency graph.

---

### Step 10B: Verify Full Dashboard Tracking Thresholds

After verifying dependencies, check the full dashboard tracking thresholds:

| Condition | Result |
|---|---|
| **3+ agents in the plan** | Full dashboard tracking REQUIRED — workers must write progress files |
| **More than 1 wave** | Full dashboard tracking REQUIRED — **NON-NEGOTIABLE** |
| <3 agents AND 1 wave | Full dashboard tracking still applies (this is `!p_track`, not `!p`) |

Since this is `!p_track`, full tracking is always enforced. This step serves as a confirmation checkpoint — if the plan has 3+ agents or >1 wave, the master MUST ensure every dispatched worker prompt includes:
- `INSTRUCTION MODE: FULL | LITE` (selected per task)
- Path to `tracker_worker_instructions.md` or `tracker_worker_instructions_lite.md`
- `YOUR PROGRESS FILE: {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`
- `YOUR TASK ID` and `YOUR AGENT LABEL`

If the plan has <3 agents and 1 wave, these are still included for `!p_track` — but the threshold check ensures the master never accidentally skips dashboard population for larger swarms when auto-escalating from other modes.

---

### Step 11: Select a dashboard and populate the plan

#### 11-PRE. Select a dashboard

Before writing any plan data, the master must claim an available dashboard. This ensures new swarms never interfere with in-progress dashboards.

**Resolution order (first match wins):**

1. **Pre-assigned dashboard from chat context (highest priority).** If your system prompt contains a `DASHBOARD ID:` directive, you are running inside a chat view that is bound to that specific dashboard. **Use it unconditionally** — do not scan, do not auto-select, do not override. Each chat view is associated with exactly one dashboard, and you must write to that dashboard. This is how the user sees your swarm in the correct panel.

2. **Explicit `--dashboard {id}` flag.** If the user specified `--dashboard {id}` in the command, use that dashboard directly.
   - If it has an active swarm (in-progress agents), warn the user and require confirmation before overwriting.
   - If it has a completed swarm, save a history summary to `{tracker_root}/history/` before overwriting.

3. **Auto-selection (fallback — only when no dashboard is pre-assigned or explicitly specified):**
   1. Scan all dashboards in order (excluding `ide`).
      > **The `ide` dashboard is always excluded from auto-selection** — it is reserved for the IDE agent and must never be claimed by a swarm.
   2. For each dashboard, read `{tracker_root}/dashboards/{dashboardId}/initialization.json`:
      - If `task` is `null` → **available**. Claim this dashboard.
      - If `task` is not null, read all files in `progress/`:
        - If no progress files exist → **stale** (plan written but never dispatched). Treat as available.
        - If every progress file has status `"completed"` or `"failed"` → **finished but uncleared**. Save a history summary to `{tracker_root}/history/`, then claim this dashboard.
        - Otherwise → **in use**. Skip to next dashboard.
   3. If all dashboards are in use, display a summary table:

   ```markdown
   ## All Dashboards In Use

   | Dashboard | Task | Status | Progress |
   |---|---|---|---|
   | {dashboardId} | {task.name} | {overall_status} | {completed}/{total} |
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

#### 11B-validate. Validate the dependency graph

Before writing `initialization.json`, validate the planned `agents[]` array:

1. **Check for cycles:** Inspect the dependency graph for circular references. If any circular dependency is detected, STOP. Do not write initialization.json. Report the cycle to the user and re-plan the affected tasks to break the cycle.
2. **Check for dangling references:** Verify that every entry in every task's `depends_on` array references an existing task ID in the `agents[]` array. If any task's `depends_on` references a non-existent task ID, STOP. Fix the reference before writing.
3. **Check for self-references:** Verify that no task's own `id` appears in its `depends_on` array. If any task depends on itself, STOP. Remove the self-reference.
4. **Check for orphans (warning only):** Identify non-Wave-1 tasks that have no dependencies AND nothing depends on them. Warn the user but proceed — orphans may be intentional standalone tasks.

The master agent performs these checks by inspecting the planned `agents[]` array before writing it to `initialization.json`. This is a mental/logical check, not a code execution step — the master reviews the dependency graph it constructed and verifies these invariants hold. The `validateDependencyGraph` function in `src/server/utils/validation.js` documents the exact rules.

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
**Task file:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`
**Plan:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`
```

#### 11E. Approval Gate — NON-NEGOTIABLE

After presenting the plan (Step 11D), the master MUST halt and wait for explicit user approval before dispatching ANY agents. This gate is absolute — no exceptions, no shortcuts, no "the plan is simple enough to skip approval."

**Step 1 — Write a permission log entry to trigger the dashboard popup:**

Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{ISO 8601 via date -u}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "permission",
  "message": "Plan ready for review: {total_tasks} tasks across {total_waves} waves — awaiting approval to begin execution",
  "task_name": "{task-slug}"
}
```

Write back. The `permission` level triggers a dashboard popup, providing a visual signal alongside the terminal prompt.

**Step 2 — Present the approval prompt to the user:**

After the plan summary, output exactly:

```
Ready to execute. Approve to begin dispatching {N} agents?
```

**Step 3 — HALT. Do not proceed.**

Do NOT dispatch any agents. Do NOT begin Phase 2. Do NOT write `master_state.json`. Do NOT launch Task tool calls for workers. Wait for the user's response in the conversation.

The ONLY acceptable triggers to proceed:
- User explicitly approves (e.g., "yes", "go", "approved", "proceed", "do it", "lgtm", "looks good")
- User approves with modifications (e.g., "yes but change X" — apply the modification, update the plan files, then proceed)

If the user requests changes to the plan:
1. Apply the requested changes to `initialization.json` and the master task file
2. Re-present the updated plan summary
3. Return to Step 2 — request approval again

If the user cancels (e.g., "no", "cancel", "stop"):
1. Log an `info` entry: `"User declined plan — swarm cancelled before dispatch"`
2. Do NOT dispatch any agents
3. Exit the swarm flow

**Step 4 — On approval, log the transition and activate eager dispatch:**

When the user approves, BEFORE dispatching any agents:

Append to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
```json
{
  "timestamp": "{ISO 8601 via date -u}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Approval granted — activating eager dispatch",
  "task_name": "{task-slug}"
}
```

Write back. Now proceed to Phase 2 (Step 12). From this point forward, the master operates in **eager dispatch mode** — dispatching tasks the instant their dependencies clear, across all waves, with no artificial delays or batching.
