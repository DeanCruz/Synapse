# `!master_plan_track {prompt}`

**Purpose:** The invoking agent becomes the **meta-planner** — responsible for decomposing a large body of work into multiple independent planning streams, dispatching **planner agents** to create plans in parallel, then dispatching **child master agents** to execute each stream's swarm on its own dashboard. The meta-planner manages dashboard slots, queue overflow, and queue-to-dashboard promotion. It never manages workers directly.

**Syntax:** `!master_plan_track {prompt}`

- `{prompt}` — Natural-language description of the full body of work. This is typically a large, multi-faceted request that would naturally decompose into multiple independent swarms.

**Examples:**
```
!master_plan_track overhaul the entire auth system — migrate to Firebase Auth, add RBAC, update all API endpoints, and rebuild the login/signup UI
!master_plan_track audit and fix all issues across frontend and backend: security, performance, accessibility, and test coverage
!master_plan_track implement the full e-commerce feature set: product catalog, shopping cart, checkout flow, order management, and admin dashboard
```

### When to Use `!master_plan_track` vs `!p_track` vs `!p`

| Condition | Command | Why |
|---|---|---|
| <5 tasks, <5 min total work | `!p` | Lightweight — planning overhead not justified |
| 5+ tasks, single logical swarm | `!p_track` | Full planning with one dashboard |
| Multiple independent swarms worth of work | `!master_plan_track` | Parallelizes planning AND execution across multiple dashboards |
| Work that would require 2+ sequential `!p_track` runs | `!master_plan_track` | Plans all streams at once, dispatches child masters after approval |

**Rule of thumb:** If the work naturally splits into 2+ independent swarms (each with its own dependency graph), use `!master_plan_track`. If it's one swarm, use `!p_track`.

---

### Agent Hierarchy

```
META-PLANNER (you)
  reads: tracker_multi_plan_instructions.md
  dispatches: planner agents (Phase 2) + child master agents (Phase 4)

CHILD MASTER AGENTS (one per stream)
  read: tracker_master_instructions.md
  own: one dashboard each
  dispatch: worker agents for their swarm

WORKER AGENTS (many per stream)
  read: tracker_worker_instructions.md
  own: one progress file each
```

The meta-planner never dispatches workers. Child masters never touch other dashboards. Workers never coordinate with other workers.

---

**Output files (per planning stream):**
```
{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.xml               ← Master XML task file
{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md            ← Parallelization strategy rationale
{tracker_root}/dashboards/{dashboardId}/initialization.json             ← Static plan data (dashboard slots)
{tracker_root}/dashboards/{dashboardId}/logs.json                       ← Initialized event log
{tracker_root}/queue/{queueId}/initialization.json                      ← Overflow plan data (queue slots)
{tracker_root}/queue/{queueId}/logs.json                                ← Initialized event log (queue)
```

> **`{tracker_root}`** refers to the Synapse directory. Locate it relative to the project root.
>
> **`{queueId}`** is `queue1`, `queue2`, etc. Queue slots hold plans that are ready to execute but have no dashboard slot yet. They are promoted to dashboards when slots free up.

---

## Phase 1: Context Gathering & Stream Decomposition

### Step 1: Resolve `{project_root}` and read project context

Resolve `{project_root}` using the standard resolution order (see `{tracker_root}/CLAUDE.md` — Path Convention section): explicit `--project` flag → stored config at `{tracker_root}/.synapse/project.json` → agent's CWD.

Read `{project_root}/CLAUDE.md` (if one exists). If `{project_root}/.synapse/toc.md` exists, read it for semantic orientation. Identify which directories or sub-projects are affected. If those directories have their own `CLAUDE.md` files, read them **in parallel**. If no `CLAUDE.md` exists, scan the project structure to understand the codebase layout.

### Step 2: Read the multi-plan orchestrator instructions

**Before writing anything to any dashboard or queue files, read:**

```
{tracker_root}/agent/instructions/tracker_multi_plan_instructions.md
```

This is the meta-planner's primary reference. It documents the three-tier agent hierarchy, slot management, queue-to-dashboard promotion, child master dispatch, cross-stream dependencies, and common mistakes.

> **Note:** You (the meta-planner) read `tracker_multi_plan_instructions.md`. Your child master agents will read `tracker_master_instructions.md`. Your workers will read `tracker_worker_instructions.md`. Each tier reads its own instructions.

### Step 3: Parse the prompt

Extract:
- **Full prompt** — The natural-language description of all work.
- **Affected directories** — Which directories or sub-projects the work touches.
- **Scope** — The full extent of what needs to be done.

### Step 4: Deep analysis — identify independent planning streams

This is the most critical step. Analyze the full scope and decompose it into **independent planning streams** — each of which will become its own `!p_track`-style swarm with its own dashboard and its own child master agent.

Think through:
- What are the natural boundaries in this work? (by feature, by repo, by domain, by layer)
- Which streams can be planned and executed independently?
- Which streams have cross-dependencies that require sequencing?
- What is the optimal number of streams? (target 2-5 for most work; up to 8 for very large efforts)

**Stream independence criteria — a stream is independent if:**
- It can be fully planned without knowing the outcome of other streams
- Its tasks do not modify the same files as tasks in other streams
- It can be executed (dispatched as a swarm) without waiting for other streams to complete

**If streams have cross-dependencies:**
- Note the dependency direction (which stream must complete first)
- Mark dependent streams with `depends_on: ["{stream_id}"]`
- Dependent streams still get planned in parallel — only execution dispatch is sequenced

### Step 5: Read all relevant source files

Read **every file** needed to understand the full scope across all streams. **Parallelize all reads.** Cache relevant code snippets, patterns, and conventions — these will be embedded in both planner agent prompts and child master agent prompts.

### Step 6: Define planning streams

For each independent stream, define:

| Field | Description |
|---|---|
| **Stream ID** | Sequential: `S1`, `S2`, `S3`, etc. |
| **Task slug** | Kebab-case name (e.g., `migrate-firebase-auth`, `rebuild-login-ui`) |
| **Scope** | What this stream covers — specific features, files, directories |
| **Affected directories** | Which repos/directories this stream touches |
| **Estimated tasks** | Rough estimate of how many worker tasks the stream will decompose into |
| **Cross-stream dependencies** | Other stream IDs that must complete before this stream can be dispatched. Empty if independent. |
| **Slot assignment** | `dashboard1`-`dashboard5` for the first 5, `queue1`, `queue2`, etc. for overflow |

### Step 7: Resolve dashboard and queue slots

Follow the slot management protocol from `tracker_multi_plan_instructions.md`:

#### 7A. Scan available dashboards

Scan `dashboard1` through `dashboard5` using the standard `selectDashboard()` algorithm from `{tracker_root}/agent/instructions/dashboard_resolution.md`:
- `task: null` → **available**
- `task` not null but all progress files terminal → **finished, available after history save**
- `task` not null with active agents → **in use, skip**

Collect all available dashboard IDs in order.

#### 7B. Assign slots

Assign planning streams to slots in this priority:
1. **Available dashboards first** — fill `dashboard1` through `dashboard5` in order of availability.
2. **Queue slots for overflow** — if more streams than available dashboards, assign remaining streams to `queue1`, `queue2`, etc.

Create queue directories as needed:
```bash
mkdir -p {tracker_root}/queue/{queueId}/progress
```

#### 7C. Archive and clear assigned slots

For each assigned dashboard or queue slot, **archive before clearing** if it contains previous swarm data:
```bash
# Archive previous swarm (MANDATORY if dashboard has data)
TASK_NAME=$(cat {tracker_root}/dashboards/{dashboardId}/initialization.json | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
ARCHIVE_NAME="$(date -u +%Y-%m-%d)_${TASK_NAME:-unnamed}"
mkdir -p {tracker_root}/Archive/${ARCHIVE_NAME}
cp -r {tracker_root}/dashboards/{dashboardId}/* {tracker_root}/Archive/${ARCHIVE_NAME}/

# Then clear
rm -f {tracker_root}/dashboards/{dashboardId}/progress/*.json
# or for queues:
rm -f {tracker_root}/queue/{queueId}/progress/*.json
```

**Never clear a dashboard without archiving first.** Previous swarm data must always be preserved in `{tracker_root}/Archive/`.

### Step 8: Present stream decomposition to user

Before dispatching planner agents, present the stream breakdown:

```markdown
## Master Plan: {N} Planning Streams

**Prompt:** {original prompt}
**Streams:** {N} independent planning streams
**Dashboard slots:** {N_dashboards} dashboards + {N_queue} queued

| # | Stream | Scope | Directories | Est. Tasks | Slot | Dependencies |
|---|---|---|---|---|---|---|
| S1 | {slug} | {brief scope} | {dirs} | ~{N} | dashboard1 | — |
| S2 | {slug} | {brief scope} | {dirs} | ~{N} | dashboard2 | — |
| S3 | {slug} | {brief scope} | {dirs} | ~{N} | queue1 | After S1 |

**Architecture:** Each stream gets its own child master agent that owns a dashboard and manages its own worker swarm.
**Dispatch strategy:** {N} planner agents dispatched first (parallel). After approval, child masters dispatched for dashboard-assigned streams. Queue streams promote as dashboards free up.
```

**Wait for user approval of the stream decomposition before dispatching planner agents.**

---

## Phase 2: Parallel Planning — Planner Agent Dispatch

### Step 9: Dispatch planner agents

After user approval, dispatch one **planner agent** per stream simultaneously using the Task tool. All planner agents run in parallel.

Each planner agent receives a self-contained prompt that includes everything needed to create a complete `!p_track` plan independently. The meta-planner embeds all relevant context (CLAUDE.md conventions, code snippets, file structures) directly into each planner's prompt.

**Planner agents create plans. They do NOT execute. They do NOT read `tracker_master_instructions.md`.** Their only job is to produce the `.md` plan, `.xml` task file, and `initialization.json` + `logs.json` for their assigned slot.

### Step 10: Planner agent prompt template

```
You are a PLANNER agent in the "{master-task}" meta-plan, creating the plan for stream {stream_id}: "{stream_slug}".

YOUR JOB: Create a complete !p_track-quality plan. You do NOT execute any tasks — you only plan.

═══════════════════════════════════════
STREAM {stream_id}: {stream_slug}
═══════════════════════════════════════

SCOPE:
{Detailed description of what this stream covers — features, files, behaviors}

AFFECTED DIRECTORIES:
{List of directories this stream touches}

CONVENTIONS:
{Relevant sections extracted from the target directory's CLAUDE.md by the meta-planner.
Quote directly — do not paraphrase. Omit if no CLAUDE.md exists.}

REFERENCE CODE:
{Working examples from the codebase that workers in this stream will need to follow.
Include complete examples of patterns. Omit if no reference patterns apply.}

EXISTING CODE CONTEXT:
{Relevant source code snippets the planner needs to understand the current state.
Include type definitions, interfaces, existing implementations that will be modified.}

CROSS-STREAM CONTEXT:
{If this stream depends on other streams, describe what those streams will produce.
If independent, state "This stream is fully independent — no cross-stream dependencies."}

═══════════════════════════════════════
PLANNING PROTOCOL
═══════════════════════════════════════

Follow these steps exactly:

1. DEEP ANALYSIS
   - What files need to be read, modified, or created?
   - What are the strict dependencies between subtasks?
   - What could go wrong? What edge cases exist?
   - What critical details would a worker agent need to avoid mistakes?

2. DECOMPOSE INTO TASKS
   Break the work into atomic tasks. For each task:
   - ID in wave.sequence format (1.1, 1.2, 2.1, etc.)
   - Title (under 40 chars)
   - Detailed description (exactly what the agent must do)
   - Directory
   - Dependencies (which task IDs must complete first)
   - Context (all context the agent needs)
   - Critical details (gotchas, edge cases)
   - Tags
   - Files (read/modify/create/delete with paths)

   Group into waves by dependency level:
   - Wave 1: zero dependencies
   - Wave 2: depends only on Wave 1 tasks
   - Wave N: depends on Wave N-1 tasks

   Apply the decomposition cost-benefit check: if splitting doesn't reduce the critical path by 20%, merge back. Target 4-8 tasks per stream.

3. DETERMINE VISUALIZATION TYPE
   Choose Waves or Chains based on the dependency graph shape.

4. CREATE THE PLAN DOCUMENT
   Write to: {tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{stream_slug}.md

   Include: parallelization type rationale, task organization table, dependency analysis, dispatch strategy, risk assessment, alternative approaches.

5. CREATE THE MASTER XML
   Write to: {tracker_root}/tasks/{MM_DD_YY}/parallel_{stream_slug}.xml

   Follow the exact XML schema from the !p_track protocol:
   - <parallel_task> root with metadata
   - <waves> with <task> entries containing all fields
   - <dependency_chains> section

6. VERIFY DEPENDENCIES
   - Re-read the XML you wrote
   - Cross-check with the .md plan
   - Verify all dependency references exist and are directionally correct
   - Confirm no circular dependencies
   - Build and write dependency chains

7. POPULATE THE {slot_type}
   Write to: {tracker_root}/{slot_path}/initialization.json

   Set `task`:
   {
     "name": "{stream_slug}",
     "type": "{Waves|Chains}",
     "directory": "{primary directory}",
     "prompt": "{stream scope description}",
     "project": "{affected directories}",
     "project_root": "{resolved absolute path to target project}",
     "created": "{ISO 8601 timestamp — run date command}",
     "total_tasks": {count},
     "total_waves": {count}
   }

   Set `agents[]` — one entry per task (plan data only):
   {
     "id": "{wave}.{task}",
     "title": "{short title}",
     "wave": {wave number},
     "layer": "{optional layer}",
     "directory": "{optional directory}",
     "depends_on": ["{task_id}"]
   }

   Set `waves[]`:
   {
     "id": {wave number},
     "name": "{descriptive name}",
     "total": {task count}
   }

   Set `chains[]` if type is "Chains".
   Set `history` to [].

   Write to: {tracker_root}/{slot_path}/logs.json
   Initialize with one entry:
   {
     "entries": [
       {
         "timestamp": "{ISO 8601}",
         "task_id": "0.0",
         "agent": "Orchestrator",
         "level": "info",
         "message": "Plan initialized: {stream_slug} — {N} tasks across {W} waves — Type: {type}",
         "task_name": "{stream_slug}"
       }
     ]
   }

═══════════════════════════════════════
TIMESTAMP PROTOCOL
═══════════════════════════════════════

Every timestamp must be captured live:
  date -u +"%Y-%m-%dT%H:%M:%SZ"

Never guess or hardcode timestamps.

═══════════════════════════════════════
ATOMIC WRITES
═══════════════════════════════════════

Always read → modify in memory → write the full file. Never write partial JSON.

═══════════════════════════════════════
RETURN FORMAT
═══════════════════════════════════════

When complete, return:

STATUS: completed | failed
STREAM: {stream_id} — {stream_slug}
SLOT: {dashboard or queue slot}
TOTAL_TASKS: {count}
TOTAL_WAVES: {count}
TYPE: {Waves|Chains}
CRITICAL_PATH: {chain description}
SUMMARY: {one-sentence description of the plan}
FILES CREATED:
  - {path} (plan .md)
  - {path} (task .xml)
  - {path} (initialization.json)
  - {path} (logs.json)
WARNINGS: {anything the master should know — optional}
ERRORS: {if failed, what went wrong — optional}
```

#### Planner Prompt Completeness Checklist

Before dispatching each planner agent, verify:

| Required Element | Check |
|---|---|
| **Stream scope** | Detailed description of what this stream covers — not just a title |
| **Affected directories** | Every directory this stream will touch |
| **CLAUDE.md conventions** | Relevant sections quoted directly from target repos |
| **Reference code** | Existing patterns workers will need to follow |
| **Source code context** | Current state of files that will be modified |
| **Slot assignment** | Correct dashboard or queue path |
| **Cross-stream context** | Dependencies on other streams clearly stated |
| **Date for file paths** | Current date in MM_DD_YY format for the tasks directory |

### Step 11: Process planner completions

As each planner agent returns:

1. **Parse the return.** Extract status, stream info, slot, task counts, warnings.
2. **Terminal confirmation:** Print one line per planner:
   - Success: `Planner {stream_id} completed: {stream_slug} — {total_tasks} tasks across {total_waves} waves → {slot}`
   - Failure: `Planner {stream_id} FAILED: {stream_slug} — {error}`
3. **Cache the result.** Store stream ID, slug, slot, task count, wave count, type, critical path.
4. **On failure:** Log the error. The stream's plan is incomplete — note it for the user.

---

## Phase 3: Review & Approval

### Step 12: Present all plans to the user

Once all planner agents have returned, present a consolidated view:

```markdown
## Master Plan Complete: {N} Streams Ready

**Dashboard:** http://localhost:3456 — {N_dashboards} dashboards populated (review the visual plans there)
**Queued:** {N_queue} streams in queue (will promote to dashboards as slots free up)

### Stream Summary
| # | Stream | Tasks | Waves | Type | Slot | Critical Path | Status |
|---|---|---|---|---|---|---|---|
| S1 | {slug} | {N} | {W} | {type} | dashboard1 | {path} | Ready |
| S2 | {slug} | {N} | {W} | {type} | dashboard2 | {path} | Ready |
| S3 | {slug} | {N} | {W} | {type} | queue1 | {path} | Queued |

### Cross-Stream Dependencies
(Only if any streams depend on others — omit if all independent)
- **S3** ({slug}) dispatches after **S1** ({slug}) completes
- **S5** ({slug}) dispatches after **S2** and **S4** complete

### Artifacts
| Stream | Plan | XML | Dashboard/Queue |
|---|---|---|---|
| S1 | `tasks/{date}/parallel_plan_{slug}.md` | `tasks/{date}/parallel_{slug}.xml` | `dashboards/dashboard1/` |
| S2 | `tasks/{date}/parallel_plan_{slug}.md` | `tasks/{date}/parallel_{slug}.xml` | `dashboards/dashboard2/` |

### Execution Architecture
Each approved stream will be handed to an autonomous **child master agent** that:
- Reads `tracker_master_instructions.md` to understand the dashboard protocol
- Owns its assigned dashboard exclusively
- Dispatches and manages its own worker swarm
- Reports back when complete

Queued streams will be promoted to dashboards as slots free up.

### Dispatch Options
1. **Dispatch all independent streams now** — launches child masters for all dashboard-assigned streams with no cross-dependencies
2. **Dispatch specific streams** — choose which to start (e.g., "dispatch S1 and S2")
3. **Revise a stream** — request changes to a specific plan before dispatching
4. **Cancel** — discard all plans
```

**Wait for user approval and dispatch selection.**

---

## Phase 4: Execution — Child Master Dispatch

### Step 13: Dispatch child master agents

For each approved stream assigned to a dashboard, dispatch a **child master agent** using the Task tool. The child master prompt template is defined in `{tracker_root}/agent/instructions/tracker_multi_plan_instructions.md` — follow it exactly.

**Key points:**
- **Only dispatch child masters for dashboard-assigned streams.** Queued streams wait for promotion.
- **Only dispatch child masters whose cross-stream dependencies are met.** If S3 depends on S1, do not dispatch S3's child master until S1's child master returns successfully.
- **Dispatch all eligible child masters simultaneously.** If S1, S2, and S4 are all independent and on dashboards, dispatch all three in one message.

Each child master agent receives:
1. Its dashboard assignment
2. Paths to its XML, plan, and dashboard files
3. **Instruction to read `{tracker_root}/agent/instructions/tracker_master_instructions.md`** — this is the child master's primary reference for running its swarm
4. **Instruction to have workers read `{tracker_root}/agent/instructions/tracker_worker_instructions.md`** — so workers know how to write progress files
5. Full project context (CLAUDE.md conventions, reference code, upstream results)
6. The complete child master prompt from `tracker_multi_plan_instructions.md`

### Step 14: Process child master completions

When a child master agent returns, follow the protocol from `tracker_multi_plan_instructions.md`:

1. **Parse the return** — extract status, stream info, dashboard, completed/failed counts, summary, files changed, deviations, warnings, errors, verification.
2. **Terminal confirmation** — one line:
   - `Stream {stream_id} completed: {slug} — {completed}/{total} tasks on {dashboardId}`
3. **Cache the result** — for injection into downstream child master prompts.
4. **Run the promotion scan** — CRITICAL. The freed dashboard may be needed by a queued stream.

### Step 15: Queue-to-dashboard promotion

**Immediately after every child master return**, follow the `promoteFromQueue()` algorithm from `tracker_multi_plan_instructions.md`:

1. Confirm the returned child master's dashboard is truly available (all progress files terminal).
2. Save history from the freed dashboard if applicable.
3. Scan queues in order (`queue1`, `queue2`, ...) for the first eligible stream:
   - Has a plan (non-null task in `initialization.json`)
   - Not already dispatched
   - All cross-stream dependencies are `completed`
4. If eligible queue found:
   - Copy queue files to the freed dashboard
   - Log the promotion to the dashboard's `logs.json`
   - Clear the queue slot
   - Dispatch a child master agent for the promoted stream
5. If no eligible queue found, the dashboard stays idle.

**Multiple promotions may happen in one cycle** if multiple dashboards free up simultaneously.

### Step 16: Cross-stream dependency dispatch

When a child master completes, it may unblock queued streams that depend on it. The promotion scan in Step 15 handles this automatically — it checks cross-stream dependencies before promoting.

Additionally, if a stream is already on a dashboard (not queued) but was waiting for a cross-stream dependency, dispatch its child master now:
- Check all dashboard-assigned streams with `status: "planned"` (not yet dispatched)
- If all their `depends_on` streams are now `completed`, dispatch their child masters

### Step 17: Overall completion

When all streams across all dashboards and queues are complete:

```markdown
## Master Plan Complete: {master-task}

**{total_streams} streams** · **{total_tasks} total tasks** · **{total_completed} completed** · **{total_failed} failed**

### Stream Results
| # | Stream | Slot | Tasks | Result | Duration |
|---|---|---|---|---|---|
| S1 | {slug} | dashboard1 | {completed}/{total} | Success | {duration} |
| S2 | {slug} | dashboard2 | {completed}/{total} | Success | {duration} |

### What Was Done
{3-5 sentences summarizing the full body of work accomplished across all streams}

### Cross-Stream Integration Notes
(Only if streams had interactions — shared types, API contracts, etc.)
- {Note about cross-stream consistency}

### Warnings
(Only if any — omit if none)
- **S{N} Task {id}:** {warning}

### Failures
(Only if any — omit if none)
- **S{N} Task {id}:** {failure description}

### Recommendations & Next Steps
(Only if applicable)
- {Follow-up work, manual verification needed, etc.}
```

---

## Rules (Non-Negotiable)

### Agent Hierarchy

1. **The meta-planner dispatches child master agents, NOT workers.** Each child master owns one dashboard and manages its own worker swarm autonomously. The meta-planner never dispatches, tracks, or manages individual workers.
2. **Child master agents read `tracker_master_instructions.md`.** This is their primary reference for dashboard protocols, eager dispatch, failure recovery, and write timing.
3. **Workers read `tracker_worker_instructions.md`.** Child masters embed this path in their worker prompts.
4. **The meta-planner reads `tracker_multi_plan_instructions.md`.** This is your primary reference for slot management, queue promotion, child master dispatch, and cross-stream coordination.

### Meta-Planning

5. **Decompose into independent streams first.** The value of this command is parallelizing across multiple dashboards. If the work is a single stream, use `!p_track` instead.
6. **Each stream gets a complete plan.** Every stream must have its own `.md` plan, `.xml` task file, and dashboard/queue initialization. No shortcuts.
7. **Planner agents do NOT execute.** They create plans and write dashboard/queue files. That's it.
8. **The meta-planner embeds all context into prompts.** Both planner agents and child master agents receive pre-read context so they minimize redundant file reading.

### Dashboard & Queue Management

9. **Dashboards first, queue for overflow.** Always fill available dashboards before using queue slots.
10. **Never dispatch a child master for a queue slot.** Queue slots have no live visualization. Wait for promotion to a dashboard.
11. **Queue structure mirrors dashboards.** Queue slots have `initialization.json`, `logs.json`, and `progress/` — identical structure.
12. **Create queue directories as needed.** `mkdir -p {tracker_root}/queue/{queueId}/progress` for each overflow stream.
13. **Promote queued streams the instant a dashboard frees up.** Run the promotion scan after every child master return — no exceptions.
14. **Save history before overwriting freed dashboards.** Standard protocol from `dashboard_resolution.md`.
15. **Clear queue slots after promotion.** Write null task to the queue's `initialization.json` so the slot can be reused.

### Execution

16. **Child masters follow all `!p_track` execution rules.** Eager dispatch, dependency-driven (not wave-driven), atomic writes, live timestamps, workers own progress files — all enforced by `tracker_master_instructions.md`.
17. **Multiple child masters run simultaneously** if their streams are independent.
18. **Cross-stream dependencies block child master dispatch, not planning.** All streams are planned in parallel regardless of dependencies. Only child master dispatch respects cross-stream ordering.

### Statusing

19. **Dashboards are the primary reporting channel.** Each child master writes to its own dashboard. The meta-planner outputs one-line terminal confirmations only.
20. **No terminal status tables during execution.** Full tables only on `!status`.

### Approval Gates

21. **Two approval gates.** First: stream decomposition (Step 8). Second: dispatch selection after all plans are complete (Step 12). Never skip either gate.
22. **User chooses what to dispatch.** The user may approve all, some, or none of the planned streams.

---

## Timestamp Protocol

Every timestamp written to any file must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Use the output directly. Never guess, estimate, or hardcode timestamps.
