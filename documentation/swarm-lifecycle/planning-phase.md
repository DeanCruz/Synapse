# Planning Phase

The planning phase is the most critical part of the swarm lifecycle. A well-planned swarm executes fast with zero confusion. A poorly-planned swarm produces broken code, conflicting edits, and wasted cycles. The master agent invests heavily in planning and never rushes it.

The planning phase encompasses everything from the moment the user invokes `!p_track` to the moment the user approves the plan: context gathering, task decomposition, dependency mapping, prompt construction, artifact creation, dashboard population, and plan presentation.

---

## Phase Overview

```
!p_track {prompt}
    |
    v
+---------------------------+
| 1. Read Command File      |  Read p_track.md in full
| 2. Read CLAUDE.md         |  Read both Synapse and project CLAUDE.md
| 3. Read Master Instr.     |  Read tracker_master_instructions.md
+---------------------------+
    |
    v
+---------------------------+
| 4. Resolve {project_root} |  --project flag > stored config > CWD
| 5. Parse the Prompt       |  Extract task name, affected directories
| 6. Deep Analysis          |  Think through full scope
+---------------------------+
    |
    v
+---------------------------+
| 7. Read Context Files     |  Source code, types, configs, docs
| 8. Decompose into Tasks   |  Atomic units with dependencies
| 9. Context Budget Check   |  Verify prompt sizes fit within limits
+---------------------------+
    |
    v
+---------------------------+
| 10. Choose Layout Type    |  Waves vs Chains
| 11. Create Plan Document  |  parallel_plan_{name}.md
| 12. Create Master Task    |  parallel_{name}.json
| 13. Validate Dependencies |  Cycle/orphan/dangling detection
+---------------------------+
    |
    v
+---------------------------+
| 14. Select Dashboard      |  Priority chain resolution
| 15. Archive if Needed     |  Previous swarm data preserved
| 16. Write initialization  |  Static plan data (write-once)
| 17. Write logs.json       |  Initialization entry
| 18. Present to User       |  Terminal summary + live dashboard
+---------------------------+
```

---

## Step 1: Invocation and Initial Reads

When the user types `!p_track {prompt}`, three things happen immediately and non-negotiably:

1. **The agent enters master dispatch mode.** It becomes the orchestrator. It does not write code, edit application files, or run application commands for the remainder of the swarm.

2. **The command file is read in full.** The master reads `{tracker_root}/_commands/Synapse/p_track.md` and follows it step by step. This is done every time -- the master never works from memory, regardless of how many swarms it has run before.

3. **The master instructions are read.** The master reads `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. This file maps every UI panel to the exact fields that drive it, specifies write timing for each moment in the lifecycle, and documents common mistakes.

### Required Reads Before Planning

| File | Purpose | Location |
|---|---|---|
| **p_track.md** | Complete command specification with all steps | `{tracker_root}/_commands/Synapse/p_track.md` |
| **Synapse CLAUDE.md** | Swarm protocols, principles, constraints | `{tracker_root}/CLAUDE.md` |
| **Master Instructions** | Dashboard field-to-UI mappings, write timing | `{tracker_root}/agent/instructions/tracker_master_instructions.md` |
| **Project CLAUDE.md** | Target project conventions, architecture | `{project_root}/CLAUDE.md` |
| **Project TOC** | Semantic file index (if it exists) | `{project_root}/.synapse/toc.md` |

These reads are non-negotiable. The master reads the command file and master instructions every time. Skipping these reads is the single most common cause of dashboard errors, missed protocols, and incomplete plans.

---

## Step 2: Context Gathering

Context gathering is the foundation of a good plan. The master reads extensively -- more than any individual worker will -- because this deep understanding is what makes agent prompts accurate and self-contained.

### Resolving {project_root}

The target project path is resolved in this priority order:

```
1. Explicit --project /path flag on the command
        |
        v (not provided)
2. Stored config at {tracker_root}/.synapse/project.json
        |
        v (not found)
3. Current working directory (agent's CWD)
```

### What the Master Reads

| Source | Purpose |
|---|---|
| `{project_root}/CLAUDE.md` | Project conventions, architecture, naming rules, testing requirements |
| `{project_root}/.synapse/toc.md` | Semantic index of files and directories (if it exists) |
| Sub-directory CLAUDE.md files | Per-directory conventions when work spans multiple areas |
| Source code files | Types, existing implementations, patterns to follow |
| Documentation | API docs, architecture docs, anything relevant to the task |

### Context Efficiency Principles

The master gathers context efficiently to preserve context window space for reasoning and execution:

1. **Glob/Grep first.** File search tools cost zero context tokens and are always current. Use them for targeted discovery before reading files.
2. **Read with purpose.** Before reading any file, know what you expect to find. "Just in case" reads waste context.
3. **Parallel reads.** When multiple files need to be read, read them all in a single parallel call. Never read files sequentially when they have no dependency on each other.
4. **Targeted line ranges.** For large files where only a specific section is needed, use line offsets rather than reading the entire file.
5. **Summarize, don't hoard.** After reading a file for context, extract the relevant facts and move on. The master does not need to keep entire file contents in working memory.

### Prompt Parsing

From the user's prompt, the master extracts:

- **The natural-language task description** -- What needs to be done.
- **A task name** -- A short kebab-case slug (e.g., `refactor-auth-flow`, `add-rate-limiting`).
- **Affected directories** -- Which areas of the codebase the work touches.

### Dependency Graph Consultation

If `{project_root}/.synapse/dep_graph.json` exists, the master reads it for file-level dependency information. The dep graph maps import relationships between files -- which files import from which other files. It is used to detect hidden coupling that task-level analysis may miss, identify all consumers of a file that will be modified (blast radius), and validate that task boundaries align with module boundaries.

### Deep Analysis

Before decomposing into tasks, the master thinks through the full scope:

- What directories or sub-projects are involved?
- What files need to be read, modified, or created?
- What are the strict dependencies between subtasks? What must be sequential versus what can run independently?
- What could go wrong? What edge cases exist?
- What are the critical details an agent would need to know to avoid mistakes?

---

## Step 3: Task Decomposition

The master breaks the work into the smallest atomic tasks possible. This is where the parallelism advantage is created.

### Atomic Task Design

Each task must be:

- **Self-contained** -- An agent can complete it with only the context provided in its prompt
- **Small** -- Takes a single agent 1-5 minutes of focused effort
- **Verifiable** -- The master can confirm success from the summary
- **Non-overlapping** -- No two tasks modify the same file concurrently

### Right-Sizing Tasks

| Too Small (< 1 min) | Right-Sized (1-5 min) | Too Large (> 5 min) |
|---|---|---|
| Orchestration overhead dominates | Good parallelism/overhead ratio | Risk of context exhaustion |
| Many dispatch cycles for little work | Workers stay focused | Worker may lose track of scope |
| Log noise drowns signal | Each completion is meaningful | Long waits between status updates |

**Heuristic:** A task that reads 2-3 files and modifies 1-2 files is typically right-sized. A task that reads 10+ files or modifies 5+ files should be decomposed further.

### Decomposition Cost-Benefit Check

Before finalizing the task list, apply this rule: **if splitting a task does not reduce the critical path by at least 20%, merge it back.** Twenty tiny tasks can cost more in orchestration overhead (prompt construction, dispatch cycles, upstream result injection, status tracking) than four medium ones.

- **Merge candidates** -- Tasks under 1 minute that share the same files or directory
- **Split candidates** -- Tasks over 5 minutes, or tasks that block 3+ downstream tasks
- **Sweet spot** -- 4-8 tasks per swarm for most work; 10-15 for large cross-repo efforts

### Dependency Mapping

For every task, the master determines whether it is:

- **Independent** -- No blockers, can be dispatched immediately (Wave 1)
- **Dependent** -- Has specific task dependencies that must complete first

Tasks are grouped into logical waves by dependency level:

```
Wave 1: All tasks with zero dependencies
Wave 2: Tasks that depend only on Wave 1 tasks
Wave 3: Tasks that depend on Wave 1 or Wave 2 tasks
Wave N: Tasks that depend on tasks from waves 1 through N-1
```

Waves are a visual grouping for the dashboard, not an execution barrier. The dispatch engine operates solely on individual task dependencies.

### Shared File Strategies

When multiple tasks need to modify the same file, the master must select a conflict-avoidance pattern. Two tasks must never modify the same file simultaneously.

**Pattern A -- Owner Task:** One task "owns" the shared file. Other tasks depend on the owner.

```
Task 1.1 (owner): Creates router.ts with initial routes
Task 2.1 (depends on 1.1): Adds auth routes to router.ts
Task 2.2 (depends on 2.1): Adds admin routes to router.ts
```

Trade-off: Simple but sequential -- limits parallelism on the shared file.

**Pattern B -- Integration Task:** All content producers are independent. A dedicated integration task collects their outputs.

```
Task 1.1: Creates auth-routes.ts (standalone)
Task 1.2: Creates admin-routes.ts (standalone)
Task 1.3: Creates user-routes.ts (standalone)
Task 2.1 (depends on 1.1, 1.2, 1.3): Creates router.ts importing all route files
```

Trade-off: Maximizes parallelism but requires an extra integration step.

**Pattern C -- Append Protocol:** Design tasks to create new files rather than modifying an existing one.

```
Task 1.1: Creates routes/auth.ts (auto-imported by directory scan)
Task 1.2: Creates routes/admin.ts (auto-imported by directory scan)
Task 1.3: Creates routes/user.ts (auto-imported by directory scan)
```

Trade-off: Best parallelism and zero conflicts, but requires the project to support auto-importing.

**Preference order:** Pattern C (no shared file at all) > Pattern B (maximize parallelism) > Pattern A (simplest but least parallel).

---

## Step 4: Layout Type Selection

The master analyzes the dependency graph and selects the dashboard visualization mode:

### Waves Layout

Best for **broad, shallow** work:

```
| Wave 1       | Wave 2       | Wave 3       |
|--------------|--------------|--------------|
| [Task 1.1]   | [Task 2.1]   | [Task 3.1]   |
| [Task 1.2]   | [Task 2.2]   |              |
| [Task 1.3]   |              |              |
| [Task 1.4]   |              |              |
```

Choose Waves when:
- Most tasks within a wave are truly independent
- Dependencies align cleanly along wave boundaries
- Expected completion times within a wave are roughly similar
- Many independent tasks, few dependency layers

### Chains Layout

Best for **narrow, deep** work:

```
Chain 1: [1.1] --> [2.1] --> [3.1]
Chain 2: [1.2] --> [2.2]
Chain 3: [1.3]
```

Choose Chains when:
- Long sequential dependency paths with varying completion times
- Different chains progress independently at different rates
- Fewer parallel tracks, longer sequences
- User benefits from seeing end-to-end progress along each chain

---

## Step 5: Artifact Creation

The master creates two planning artifacts before populating the dashboard.

### Plan Rationale Document

Created at `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md`, this document explains the planning decisions:

- **Parallelization type** -- Waves or Chains, with 2-3 sentences explaining why
- **Task organization** -- Tabular listing of all tasks per wave (ID, description, directory, dependencies, estimated complexity)
- **Dependency analysis** -- The dependency graph explained, critical path identified, longest chain highlighted
- **Dispatch strategy** -- How agents will be dispatched, early dispatch opportunities
- **Risk assessment** -- Potential failure points, tasks most likely to produce warnings, cascade analysis
- **Alternative approaches** -- Why the chosen approach was selected over alternatives

### Master Task File

Created at `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`, this is the authoritative task record. It contains everything needed to understand and track the swarm: metadata, task definitions with descriptions and context, critical details, file lists, dependencies, status tracking, and dependency chains.

```json
{
  "name": "{slug}",
  "created": "{timestamp}",
  "metadata": {
    "prompt": "{original prompt}",
    "type": "{Waves|Chains}",
    "total_tasks": "{count}",
    "total_waves": "{count}",
    "overall_status": "pending"
  },
  "waves": [
    {
      "id": 1,
      "name": "{name}",
      "status": "pending",
      "tasks": [
        {
          "id": "1.1",
          "title": "{Short title -- under 40 chars}",
          "description": "{Detailed description}",
          "depends_on": [],
          "context": "{All context the agent needs}",
          "critical": "{Edge cases, gotchas, non-obvious requirements}",
          "tags": ["{backend, frontend, types, etc.}"],
          "files": [
            { "action": "read|modify|create", "path": "{path}" }
          ],
          "status": "pending"
        }
      ]
    }
  ],
  "dependency_chains": [
    { "id": 1, "tasks": ["{task_id}", "{task_id}", "{task_id}"] }
  ]
}
```

Every agent reads the task file for context. The master updates it on every completion with summaries, timing, and status changes.

---

## Step 6: Dependency Validation

Before populating the dashboard, the master validates the dependency graph using this algorithm:

1. **Topological sort** -- Process tasks in dependency order. If the sort cannot complete (a task's dependencies never resolve), a cycle exists. Cycles must be fixed before continuing.

2. **Compute critical path** -- For each task, calculate `depth = max(depth of dependencies) + 1`. The task with the highest depth defines the minimum number of waves. The chain passing through it is the critical path.

3. **Identify bottleneck tasks** -- Any task that appears in the `depends_on` of 3+ other tasks is a bottleneck. Its failure cascades widely. The master flags it in the plan document and ensures its prompt is especially thorough.

4. **Verify no orphans** -- Every task ID referenced in `depends_on` must exist. Every task must be reachable from a root task (no disconnected subgraphs unless intentional).

5. **Check for self-references** -- No task may depend on itself.

6. **Check for dangling references** -- Every entry in every task's `depends_on` must reference an existing task ID.

If any validation check fails, the master stops and fixes the issue before writing to the dashboard.

### Full Dashboard Tracking Threshold Verification

After validating dependencies, the master confirms that full dashboard tracking thresholds are met. When a swarm has 3+ parallel agents or more than 1 wave, the master MUST populate its designated dashboard with full tracking. This is non-negotiable for multi-wave swarms. Workers must be instructed to read `tracker_worker_instructions.md` and write progress files to the dashboard.

---

## Step 7: Prompt Construction

For each task, the master crafts a self-contained worker prompt. The prompt must contain everything the worker needs to execute without asking questions or reading additional files beyond what is listed.

### Prompt Template Structure

Every worker prompt includes these sections:

| Section | Content |
|---|---|
| **Header** | Swarm name, task ID, title |
| **DESCRIPTION** | Detailed description of what the agent must do |
| **CONTEXT** | Architectural context, current file state, design decisions |
| **PROJECT ROOT / TRACKER ROOT** | Both paths so the worker knows where to do code work and where to report progress |
| **CONVENTIONS** | Relevant sections extracted from `{project_root}/CLAUDE.md` (quoted directly, not paraphrased) |
| **REFERENCE CODE** | Working examples from the codebase the worker should follow as patterns |
| **UPSTREAM RESULTS** | For downstream tasks: completed dependency summaries, files changed, new exports, deviations |
| **CRITICAL** | Edge cases, gotchas, non-obvious requirements |
| **SUCCESS CRITERIA** | Specific, verifiable conditions that define "done" |
| **FILES** | Every file to READ, MODIFY, or CREATE |
| **PREPARATION** | Readiness checklist the worker must verify before coding |
| **PROGRESS REPORTING** | Progress file path, task ID, agent label, instruction mode (FULL or LITE) |
| **RETURN FORMAT** | Structured report template (STATUS, SUMMARY, FILES CHANGED, EXPORTS, DIVERGENT ACTIONS) |

### Context Budget Guidelines

| Section | Max Lines | Notes |
|---|---|---|
| CONVENTIONS | ~200 lines | Extract only sections relevant to this specific task |
| REFERENCE CODE | ~100 lines | One complete, representative example; summarize the rest |
| UPSTREAM RESULTS | ~50 lines per dependency | Summarize to key facts: what was built, what changed, new exports |
| CONTEXT | ~150 lines | Focus on architectural decisions and current file state |
| **Total prompt** | **~800 lines** | If exceeded, split the task or summarize further |

When a prompt exceeds the budget: summarize instead of pasting, split the task if context is genuinely needed, prioritize success criteria and critical details over reference code, and use READ file lists instead of inlining large files.

### Token Budget Estimate

After constructing each worker's dispatch prompt, the master estimates the token budget by section:

| Section | Typical Range |
|---|---|
| Task description | 200-500 tokens |
| File context | 500-2000 tokens |
| Conventions | 300-800 tokens |
| Upstream results | 200-600 tokens |
| Critical details | 200-400 tokens |
| Instructions | 400-600 tokens |

**Budget limit: 8000 tokens (~32KB of text).** If a prompt exceeds this estimate, the master splits the task, summarizes conventions to 3-5 bullet points, trims reference code to specific functions/types, and condenses upstream results to one-line summaries.

Prompt bloat is the number one cause of worker context exhaustion. A worker that receives a 15,000-token prompt has already consumed 15% of its context window before writing a single line of code.

### Convention Relevance Filtering

Before extracting CLAUDE.md content for a worker prompt, the master uses the convention map (built during context gathering) to select only categories relevant to each specific task:

| Category | Include when... | Skip when... |
|---|---|---|
| `naming` | Task creates new files, functions, variables, or types | Task only modifies existing code |
| `file_structure` | Task creates new files or moves files | Task modifies existing files in-place |
| `imports` | Task adds new imports or creates new modules | Task does not touch imports |
| `testing` | Task involves writing or modifying tests | Task has no test component |
| `error_handling` | Task involves error paths, try/catch, or validation | Task is purely additive/cosmetic |
| `backend_api` | Task creates or modifies API endpoints | Task does not touch APIs |
| `frontend_styling` | Task involves UI/CSS/component styling | Task is backend-only |
| `types` | Task creates or modifies type definitions | Task does not touch types |

This filtering is applied per-worker, not globally -- different tasks need different convention subsets. If the project CLAUDE.md exceeds 500 lines, always summarize rather than quote.

### Instruction Mode Selection

The master selects FULL or LITE mode per task based on complexity:

| Criteria | FULL | LITE |
|---|---|---|
| Has upstream dependencies | FULL | |
| Modifies 3+ files | FULL | |
| Requires coordination with other tasks | FULL | |
| High deviation risk | FULL | |
| Simple, independent task | | LITE |
| Single-file modification | | LITE |
| No upstream dependencies | | LITE |
| Well-defined, mechanical change | | LITE |

Default to FULL when uncertain. LITE is an optimization for simple tasks -- never use it for tasks with dependencies or coordination requirements.

### Prompt Completeness Checklist

Before dispatch, the master verifies each prompt contains:

- Every file path to read/modify/create
- CLAUDE.md conventions quoted directly
- Reference code patterns (if applicable)
- Upstream results (for downstream tasks)
- Success criteria the worker can verify
- Critical details and gotchas
- Both `{tracker_root}` and `{project_root}` paths
- Progress file path and agent label

If any element is missing, the master adds it before dispatch. Workers should not have to figure things out.

---

## Step 8: Dashboard Population

With the plan complete and validated, the master populates the dashboard before presenting the plan. This gives the user a live visual representation to review alongside the terminal summary.

### Dashboard Selection

Dashboards are selected via a priority chain:

```
1. Assigned dashboard (DASHBOARD ID: directive in system prompt)
       → Use unconditionally. NO access to other dashboards.
       → If has previous data: ask user before archiving (active) or archive directly (completed/failed).
       |
       v (not present)
2. Explicit --dashboard {id} flag
       |
       v (not provided)
3. Ask the user which dashboard to use. Never scan or auto-select.
```

Dashboard IDs are 6-character hex strings (e.g., `a3f7k2`). The `ide` dashboard is permanently reserved for the IDE agent.

### Archive Before Clear

If the selected dashboard has existing swarm data, the master archives before clearing. This is non-negotiable -- previous swarm data is never discarded.

```
1. Copy entire dashboard directory to {tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/
2. Clear progress files: rm -f {tracker_root}/dashboards/{dashboardId}/progress/*.json
```

### Writing initialization.json

The master writes the full plan as a single atomic write:

```json
{
  "task": {
    "name": "add-rate-limiting",
    "type": "Waves",
    "directory": "src/api",
    "prompt": "add rate limiting to all HTTP endpoints",
    "project": "src/api, src/middleware",
    "project_root": "/Users/dean/repos/my-app",
    "created": "2026-03-22T14:00:00Z",
    "total_tasks": 8,
    "total_waves": 3
  },
  "agents": [
    {
      "id": "1.1",
      "title": "Create rate limiter middleware",
      "wave": 1,
      "layer": "backend",
      "directory": "src/middleware",
      "depends_on": []
    }
  ],
  "waves": [
    { "id": 1, "name": "Foundation", "total": 4 },
    { "id": 2, "name": "Endpoint Integration", "total": 3 },
    { "id": 3, "name": "Testing", "total": 1 }
  ],
  "chains": [],
  "history": []
}
```

This file is write-once. The master never updates it after the planning phase, with one exception: inserting repair tasks when a worker fails (see [Circuit Breaker](./circuit-breaker.md)).

Note the absence of lifecycle fields (`status`, `started_at`, `completed_at`, `summary`, `assigned_agent`, `completed_tasks`, `failed_tasks`, `overall_status`). All of these are derived by the dashboard from worker progress files.

### Writing the Initialization Log Entry

The master appends an initialization entry to `logs.json`:

```json
{
  "entries": [
    {
      "timestamp": "2026-03-22T14:00:00Z",
      "task_id": "0.0",
      "agent": "Orchestrator",
      "level": "info",
      "message": "Task initialized: add-rate-limiting -- 8 tasks across 3 waves -- Type: Waves",
      "task_name": "add-rate-limiting"
    }
  ]
}
```

---

## Step 9: Plan Presentation and User Approval

The dashboard is now live with the full plan -- all tasks visible as pending cards with dependency lines drawn. The master presents a terminal summary alongside it:

```markdown
## Parallel Execution Plan: add-rate-limiting

**Type:** Waves
**Directories:** src/api, src/middleware
**Dashboard:** Synapse Electron app (live -- review the visual plan there)

### Wave 1 -- Foundation (parallel -- 4 tasks)
| Task | Description | Directory | Dependencies |
|---|---|---|---|
| 1.1 | Create rate limiter middleware | src/middleware | None |
| 1.2 | Define rate limit config types | src/types | None |

### Wave 2 -- Integration (parallel -- 3 tasks)
| Task | Description | Directory | Dependencies |
|---|---|---|---|
| 2.1 | Apply rate limiting to auth endpoints | src/api/auth | 1.1, 1.2 |

### Dependency Chains
| Chain | Path | Critical? |
|---|---|---|
| 1 | 1.1 -> 2.1 -> 3.1 | Yes (longest) |
| 2 | 1.2 -> 2.2 | No |

**Total:** 8 tasks across 3 waves
**Critical path:** Chain 1 (3 tasks deep)
**Dispatch strategy:** Tasks dispatched the instant all their dependencies are met.
```

At this point the user can see:

- The terminal summary with the structured plan breakdown
- The live dashboard showing all tasks as pending cards (gray dots, "Waiting..." text)
- Dependency lines drawn between cards
- Stats bar showing Total = 8, all others = 0
- Log panel with one initialization entry
- No elapsed timer yet (starts when the first worker begins)

The master waits for user approval before proceeding to the dispatch phase. The user may approve, suggest changes, or cancel.

---

## Planning Principles Summary

1. **Invest heavily in planning.** The front-loaded investment pays off in execution speed -- agents work independently without needing to ask questions.
2. **Read extensively.** The master reads more than any worker will. Deep context makes accurate plans.
3. **Make prompts self-contained.** Each worker must be able to execute with only the context provided in its prompt.
4. **Validate everything.** Check for cycles, dangling references, orphans, and budget overruns before proceeding.
5. **Populate the dashboard before presenting.** The user should see the visual plan while reviewing the terminal summary.
6. **Never rush.** A poorly-planned swarm costs more time than the minutes saved by skipping planning.
7. **Right-size tasks.** Target 1-5 minutes each. Use the cost-benefit heuristic to avoid over-decomposition.
8. **Handle shared files explicitly.** Select a conflict-avoidance pattern and encode it in the dependency graph.

---

## Related Documentation

- [Overview](./overview.md) -- End-to-end swarm lifecycle summary
- [Dispatch Phase](./dispatch-phase.md) -- Worker dispatch mechanics and the eager dispatch protocol
- [Monitoring Phase](./monitoring-phase.md) -- Live progress tracking and deviation handling
- [Completion Phase](./completion-phase.md) -- Final report and archiving
- [Circuit Breaker](./circuit-breaker.md) -- Automatic replanning on cascading failures
