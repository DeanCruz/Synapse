# Master Agent — Planning Protocol

Planning is where the master agent earns its value. A well-planned swarm executes fast with zero confusion. A poorly-planned swarm produces broken code, conflicting edits, and wasted cycles. This document covers the complete planning protocol: task decomposition, dependency mapping, wave grouping, prompt writing, and dashboard population.

---

## Planning Phase Overview

The planning phase follows a strict sequence:

1. Resolve `{project_root}` and read project context.
2. Read the tracker master instructions.
3. Parse the user's prompt.
4. Perform deep analysis of the task scope.
5. Read all relevant context files.
6. Decompose into tasks.
7. Determine the parallelization type (Waves or Chains).
8. Create the parallelization plan document.
9. Create the master XML task file.
10. Verify dependencies and add dependency chains.
11. Select a dashboard, archive previous data, populate the plan.
12. Present the plan to the user and wait for approval.

Each step builds on the previous one. The master must not skip steps or reorder them.

---

## Step 1: Resolve the Project and Read Context

Before anything else, the master resolves `{project_root}` using the standard resolution order:

1. Explicit `--project /path` flag on the command.
2. Stored config at `{tracker_root}/.synapse/project.json` (set via `!project set /path`).
3. The agent's current working directory.

Once resolved, read:

- `{project_root}/CLAUDE.md` for conventions, architecture, and constraints.
- `{project_root}/.synapse/toc.md` (if it exists) for semantic orientation.
- Any sub-directory CLAUDE.md files if the task touches specific sub-projects.

If no `CLAUDE.md` exists, scan the project structure to understand the codebase layout.

## Step 2: Read Tracker Master Instructions

Before writing anything to `initialization.json` or `logs.json`, read:

```
{tracker_root}/agent/instructions/tracker_master_instructions.md
```

This file maps every UI panel to the exact fields that drive it and specifies write timing for each moment in the swarm lifecycle. This step is non-negotiable.

## Step 3: Parse the Prompt

Extract from the user's command:

- **Prompt** -- The natural-language task description.
- **Task name** -- Generate a short kebab-case slug (e.g., `refactor-auth-flow`, `add-rate-limiting`).
- **Affected directories** -- Which directories or sub-projects the work touches.

## Step 4: Deep Analysis

Think through the full scope before touching any files:

- What directories or sub-projects are involved?
- What files need to be read, modified, or created?
- What are the strict dependencies between subtasks? What MUST be sequential versus what CAN run independently?
- What could go wrong? What edge cases exist?
- What are the critical details an agent would need to know to avoid mistakes?

---

## Task Decomposition

### Atomic Task Design

Each task should be:

- **Self-contained** -- An agent can complete it with only the context provided in its dispatch prompt.
- **Small** -- Takes a single agent one focused effort (target 1-5 minutes).
- **Verifiable** -- The master can confirm success from the summary.
- **Non-overlapping** -- No two tasks modify the same file (or if they must, they are sequential with explicit dependencies).

### Right-Sizing Tasks

| Too Small (< 1 min) | Right-Sized (1-5 min) | Too Large (> 5 min) |
|---|---|---|
| Orchestration overhead dominates | Good parallelism/overhead ratio | Risk of context exhaustion |
| Many dispatch cycles for little work | Workers stay focused | Worker may lose track of scope |
| Log noise drowns signal | Each completion is meaningful | Long waits between status updates |

**Rule of thumb:** A task that reads 2-3 files and modifies 1-2 files is typically right-sized. A task that reads 10+ files or modifies 5+ files should be decomposed further.

### Decomposition Cost-Benefit Check

Before finalizing the task list, apply this heuristic: if splitting a task does not reduce the critical path by at least 20%, merge it back. 20 tiny tasks can cost more in orchestration overhead (prompt construction, dispatch cycles, upstream result injection, status tracking) than 4 medium ones.

- **Merge candidates:** Tasks under 1 minute that share the same files or directory.
- **Split candidates:** Tasks over 5 minutes, or tasks that block 3 or more downstream tasks.
- **Sweet spot:** 4-8 tasks per swarm for most work; 10-15 for large cross-repo efforts.

---

## Dependency Mapping

### Identifying Dependencies

For each task, determine:

- **Independent** -- No blockers, can be dispatched immediately.
- **Dependent** -- Has specific task dependencies that must complete first.

Dependencies exist when:

- Task B reads a file that Task A creates.
- Task B imports a function, type, or interface that Task A defines.
- Task B modifies a file that Task A also modifies (sequential access required).
- Task B needs to verify or integrate the output of Task A.

### Dependency Validation Algorithm

Before proceeding to dispatch, validate the dependency graph:

1. **Topological sort** -- Process tasks in dependency order. If you cannot complete the sort (a task's dependencies never resolve), you have a cycle. Fix it before continuing.

2. **Compute critical path length** -- For each task, calculate `depth = max(depth of dependencies) + 1`. The task with the highest depth defines the minimum number of waves. The chain passing through it is the critical path.

3. **Identify bottleneck tasks** -- Any task that appears in the `depends_on` of 3 or more other tasks is a bottleneck. Its failure cascades widely. Flag it in the plan document and ensure its prompt is thorough.

4. **Verify no orphans** -- Every task ID referenced in `depends_on` must exist. Every task must be reachable from a root task (no disconnected subgraphs unless intentional).

5. **Check for self-references** -- No task's own ID should appear in its `depends_on` array.

6. **Check for dangling references** -- Every entry in every task's `depends_on` array must reference an existing task ID in the agents array.

---

## Wave Grouping

Group tasks into logical waves by dependency level:

- **Wave 1** -- All tasks with zero dependencies. These are dispatched immediately.
- **Wave 2** -- Tasks that depend only on Wave 1 tasks.
- **Wave N** -- Tasks that depend on tasks from waves 1 through N-1.

Waves are a visual grouping mechanism for the dashboard, not an execution barrier. The dispatch engine operates on individual task dependencies, not wave boundaries. A task in Wave 3 whose dependencies are all satisfied gets dispatched immediately, even if Wave 2 still has running tasks.

### Choosing Waves vs. Chains

The dashboard supports two layout modes:

**Waves** -- Best when:
- Most tasks within a wave are truly independent.
- Dependencies align cleanly along wave boundaries.
- Expected completion times within a wave are roughly similar.
- The work is broad and shallow (many independent tasks, few dependency layers).

**Chains** -- Best when:
- There are long sequential dependency paths with varying completion times.
- Different chains progress independently at different rates.
- The work is narrow and deep (fewer parallel tracks, longer sequences).
- The user benefits more from seeing end-to-end progress along each chain.

The type is set via `task.type` in `initialization.json` (`"Waves"` or `"Chains"`).

---

## Handling Shared Files

When multiple tasks need to add entries to the same file, two tasks must never modify the same file simultaneously. Use one of these patterns:

### Pattern A -- Owner Task

One task "owns" the shared file. Other tasks that need it depend on the owner. The owner creates or modifies the file; downstream tasks append to it sequentially.

- Simplest approach.
- Least parallel (downstream tasks are serialized on the owner).

### Pattern B -- Integration Task

All tasks that produce content for the shared file are independent, but a dedicated "integration task" in a later wave collects their outputs and writes the shared file.

- Maximizes parallelism during the main work phase.
- Requires a final integration step.

### Pattern C -- Append Protocol

If a shared file supports independent additions (e.g., adding new route files to a directory that auto-imports), design tasks to create new files rather than modifying an existing one.

- Best option: eliminates the shared-file conflict entirely.
- Only works when the framework supports auto-discovery.

**Decision tree:** Prefer Pattern C (no shared file at all) over Pattern B (maximize parallelism) over Pattern A (simplest but least parallel).

---

## Writing Agent Prompts

Every dispatched agent receives a self-contained prompt with all context needed to work independently. The master embeds relevant project conventions and patterns directly into the prompt to minimize redundant reading by workers.

### Prompt Template Structure

Each prompt follows this structure:

1. **Task header** -- Task ID, title, and swarm name.
2. **Description** -- Detailed description of exactly what the agent must do.
3. **Context** -- All context the agent needs: current file state, architectural decisions, references to other tasks.
4. **Project root and tracker root** -- Both absolute paths must be included. Workers cannot auto-detect these.
5. **Conventions** -- Relevant sections extracted from `{project_root}/CLAUDE.md`. Quote directly, do not paraphrase.
6. **Reference code** -- Working examples from the codebase that the worker should follow as patterns.
7. **Upstream results** -- For downstream tasks only: what each dependency produced, including deviations.
8. **Critical details** -- Edge cases, gotchas, and non-obvious constraints.
9. **Success criteria** -- Exactly what "done" looks like, stated as specific, verifiable conditions.
10. **Files list** -- Every file to READ, MODIFY, or CREATE with its full path.
11. **Preparation instructions** -- Readiness checklist the worker must verify before coding.
12. **Progress reporting instructions** -- Path to the worker's progress file and the instruction mode (FULL or LITE).
13. **Deviation reporting instructions** -- Requirement to report any plan divergences immediately.
14. **Execution rules** -- Constraints on what the worker may and may not do.
15. **Return format** -- The exact structure for the worker's completion report.

### Context Budget

Per-task prompt budget guidelines:

| Section | Max Lines | Notes |
|---|---|---|
| Conventions | ~200 lines | Extract only sections relevant to THIS task from CLAUDE.md. Do not dump the entire file. |
| Reference Code | ~100 lines | Include one complete, representative example. Summarize the rest. |
| Upstream Results | ~50 lines per dependency | Summarize to key facts: what was built, what files changed, what new exports exist. |
| Context | ~150 lines | Focus on architectural decisions and current file state. |
| Total prompt | ~800 lines | If a prompt exceeds this, the task should be split or context should be summarized further. |

When a prompt exceeds the budget:

1. **Summarize, don't paste.** Replace inline code blocks with one-line summaries and explicit file paths the worker can read.
2. **Split the task.** If the context is genuinely needed and cannot be summarized, the task is too large.
3. **Prioritize critical details.** Success criteria and critical gotchas should never be cut for space.
4. **Use READ file lists.** Instead of inlining a 200-line file, add it to the READ list and tell the worker what to look for.

### Instruction Mode Selection

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

Default to FULL when uncertain. LITE is an optimization for simple tasks -- never use it for tasks with dependencies or coordination requirements.

### Prompt Completeness Checklist

Before dispatching each agent, verify the prompt contains:

| Required Element | Description |
|---|---|
| File paths | Every file to read, modify, or create is listed with its full path |
| CLAUDE.md conventions | Relevant sections quoted directly from the target repo's CLAUDE.md |
| Reference code | If the worker must follow an existing pattern, a working example is included |
| Upstream results | For downstream tasks: summary, files changed, new exports, and deviations from each dependency |
| Success criteria | The worker can unambiguously determine when the task is done |
| Critical details | Edge cases, gotchas, and non-obvious constraints are explicitly stated |
| Instruction mode | FULL or LITE is selected based on task complexity |
| Both paths | `{tracker_root}` and `{project_root}` are both present in the prompt |

If any element is missing, add it before dispatch. Do not assume the worker will figure it out.

---

## Creating Plan Artifacts

### The Parallelization Plan Document

Create `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md` with:

- **Parallelization type** and why it was chosen.
- **Task organization** -- Tables per wave showing task ID, description, directory, dependencies, and estimated complexity.
- **Dependency analysis** -- Which tasks gate which, where the critical path is, what the longest chain is.
- **Dispatch strategy** -- How agents will be dispatched, identifying tasks that can be dispatched early.
- **Risk assessment** -- Potential failure points and cascade analysis.
- **Alternative approaches considered** -- Why the chosen approach was selected.

### The Master XML Task File

Create `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.xml` containing:

- **Metadata** -- Original prompt, type, directories, task and wave counts, overall status.
- **Waves** -- Each wave contains task entries with: ID, title, description, directory, dependencies, context, critical details, tags, file lists, status fields, and logs.
- **Dependency chains** -- Every path from root tasks (no dependencies) to terminal tasks (nothing depends on them).

The XML is the authoritative task record. All agents read from it. The master updates it on every completion.

### Task Status Lifecycle (in the XML)

1. `pending` -- Not started, waiting for dependencies or dispatch.
2. `claimed` -- Master has selected this task for dispatch (set before agent launch).
3. `in_progress` -- Agent is actively working.
4. `completed` -- Done successfully.
5. `failed` -- Error occurred.
6. `blocked` -- Cannot proceed due to failed dependency.

---

## Populating the Dashboard

Before presenting the plan to the user, the master populates the dashboard so the user has a live visual representation while they review and approve it.

### Archive Before Clear (Non-Negotiable)

If the dashboard contains data from a previous swarm (i.e., `initialization.json` has `task` not `null`), the master must archive it first:

1. Copy the entire dashboard directory to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`.
2. Then clear progress files.
3. Previous swarm data is never discarded.

### Writing initialization.json

`initialization.json` is write-once. The master writes it during planning and never updates it after the planning phase (with one exception for repair tasks on failure recovery).

The file contains:

- **`task` object** -- Swarm metadata: name, type, directory, prompt, project, project_root, created timestamp, total_tasks, total_waves.
- **`agents[]` array** -- One entry per task with plan data only: id, title, wave, layer, directory, depends_on. No lifecycle fields (status, started_at, completed_at, summary) -- those live in worker progress files.
- **`waves[]` array** -- One entry per wave with structure only: id, name, total. No status or completed counts -- those are derived from progress files.
- **`chains[]` array** -- Required when type is "Chains". Each chain defines a horizontal row with id, name, and ordered task array.
- **`history[]` array** -- Previous swarm records.

### Writing the Initialization Log Entry

Append to `logs.json`:

```json
{
  "timestamp": "{ISO 8601}",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "info",
  "message": "Task initialized: {task-slug} -- {N} tasks across {W} waves -- Type: {Waves|Chains}",
  "task_name": "{task-slug}"
}
```

### Presenting the Plan

After the dashboard is populated, present a terminal summary showing:

- Parallelization type and affected directories.
- A table per wave with task ID, description, directory, and dependencies.
- Dependency chains with critical path identification.
- Total task and wave counts.
- Dispatch strategy summary.
- Links to the XML and plan document.

Wait for user approval before proceeding to the dispatch phase.

---

## Related Documentation

- [Master Agent Overview](./overview.md) -- Role definition, constraints, and responsibilities.
- [Dispatch Protocol](./dispatch-protocol.md) -- Eager dispatch, dependency-driven dispatch, pipeline flow, and error handling.
- [Statusing Protocol](./statusing.md) -- Dashboard updates, logs.json, XML updates, and terminal output rules.
