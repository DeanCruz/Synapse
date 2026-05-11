# Swarm Commands

All swarm commands are located at `{tracker_root}/_commands/Synapse/`. They manage the lifecycle of parallel agent swarms, provide monitoring and visibility, and control the dashboard server.

---

## Swarm Lifecycle Commands

### `!p_track`

**Purpose:** The primary command for parallel agent swarms. Plans, dispatches, tracks, and reports a full swarm with live dashboard updates.

**Syntax:**
```
!p_track [--dashboard dashboardN] {prompt}
```

**Arguments:**
- `{prompt}` -- Natural-language description of the work to be done
- `--dashboard {id}` -- (Optional) Force a specific dashboard. Your system prompt contains a `DASHBOARD ID:` directive — use that dashboard unconditionally. No scanning or auto-selection.

**Key Behavior:**
- The invoking agent becomes the **master agent** and enters orchestrator mode
- The master reads project context, decomposes the task into atomic subtasks, maps dependencies, and presents a plan for user approval
- After approval, the master writes `initialization.json` to populate the dashboard, then dispatches worker agents via the Task tool
- Workers write progress files to `{tracker_root}/dashboards/{dashboardId}/progress/` for live dashboard updates
- Tasks are dispatched the instant their dependencies are satisfied, not when a wave completes
- The master never writes code -- it only plans, dispatches, monitors, and reports
- Includes circuit breaker logic: if 3+ tasks fail in the same wave or a failure blocks half of remaining tasks, automatic replanning is triggered

**Produces:**
- `{tracker_root}/dashboards/{dashboardId}/plan.json` -- Canonical task spec and shared context
- `{tracker_root}/tasks/{date}/parallel_{name}.json` -- Master task record
- `{tracker_root}/tasks/{date}/parallel_plan_{name}.md` -- Strategy rationale
- `{tracker_root}/dashboards/{dashboardId}/initialization.json` -- Dashboard plan data
- `{tracker_root}/dashboards/{dashboardId}/logs.json` -- Event log
- `{tracker_root}/dashboards/{dashboardId}/progress/*.json` -- Worker progress files

**Phases:**
1. Context and Planning (gather context, decompose tasks, present plan)
2. Execution (dispatch workers, process completions, handle failures)
3. Report (compile final summary)

---

### `!p_track_plan`

**Purpose:** Plan-driven swarm execution. The invoking agent becomes the master agent -- reads a pre-written `.md` plan document, translates it into a dependency-aware swarm, populates the dashboard, waits for user approval, then dispatches and monitors workers. Unlike `!p_track` (which discovers and decomposes from a prompt), `!p_track_plan` faithfully translates an existing plan.

**Syntax:**
```
!p_track_plan [--dashboard {id}] {plan_path}
```

**Arguments:**
- `{plan_path}` -- Path to a `.md` plan document. Absolute path, or relative to `{tracker_root}`.
- `--dashboard {id}` -- (Optional) Force a specific dashboard.

**Key Behavior:**
- Reads the plan document in full and analyzes its structure: phases, files, dependencies, constraints, risks
- Translates plan phases to waves, bullet points to tasks, phase ordering to dependencies
- Preserves plan structure -- the dependency graph mirrors the source document
- Presents the translated plan with an approval gate before dispatching
- After approval, runs the same execution and completion lifecycle as `!p_track`
- The plan document is read-only -- the master never modifies it
- Ambiguities are surfaced during the approval gate, not silently resolved

**Translation Rules:**
- Plan phases become waves; items within a phase with no interdependency become parallel tasks
- Each concrete action item becomes a task (1-5 min, 1-2 files modified)
- Phase ordering maps to task dependencies
- Every task is traceable to a specific section of the source plan

**When to use `!p_track_plan` vs `!p_track` vs `!plan`:**
- `!p_track_plan` -- You have a pre-written plan document to execute
- `!p_track` -- Starting from a prompt, no existing plan
- `!plan` -- Want analysis only, no execution (produces a plan document)

**Natural workflow:** `!plan {task}` --> review and refine --> `!p_track_plan {plan_path}` to execute

**Produces:**
- Same output files as `!p_track` (`plan.json`, companion task file if produced, rationale, initialization.json, logs.json, progress files)

---

### `!p`

**Purpose:** Lightweight parallel dispatch. Deep planning and high-quality worker prompts without any dashboard tracking overhead.

**Syntax:**
```
!p {prompt}
```

**Key Behavior:**
- Same deep planning and prompt quality as `!p_track`
- No task files, no dashboard writes, no progress files
- All plan data lives in conversation context
- Workers execute and return directly
- Best for focused tasks with fewer than 5 subtasks where live visualization is not needed

**When to use `!p` vs `!p_track`:**
- `!p` -- Fast, context-efficient. Best for quick parallel jobs without live monitoring.
- `!p_track` -- Full tracking with live dashboard. Best for large, long-running swarms.

---

### `!master_plan_track`

**Purpose:** Multi-stream orchestration. Decomposes a large body of work into multiple independent swarms, each running on its own dashboard with its own child master agent.

**Syntax:**
```
!master_plan_track {prompt}
```

**Key Behavior:**
- The invoking agent becomes the **meta-planner** -- it dispatches planner agents and child master agents, never workers directly
- Decomposes work into 2-8 independent planning streams
- Dispatches planner agents in parallel to create plans for each stream
- After user approval, dispatches child master agents to execute each stream's swarm on its own dashboard
- Manages dashboard slot allocation (up to 5 dashboards) with overflow into queue slots
- Handles queue-to-dashboard promotion as dashboards free up
- Supports cross-stream dependencies (planning is parallel, only execution dispatch is sequenced)

**Agent Hierarchy:**
```
META-PLANNER (you)
  dispatches: planner agents + child master agents

CHILD MASTER AGENTS (one per stream)
  own: one dashboard each
  dispatch: worker agents

WORKER AGENTS (many per stream)
  own: one progress file each
```

**When to use:**
- Work naturally splits into 2+ independent swarms (each with its own dependency graph)
- Tasks that would require sequential `!p_track` runs can be parallelized across dashboards

---

### `!dispatch`

**Purpose:** Manually dispatch a specific pending task or all tasks whose dependencies are satisfied.

**Syntax:**
```
!dispatch [dashboardId] {task_id}        -- Dispatch a specific task
!dispatch [dashboardId] --ready          -- Dispatch all unblocked tasks
```

**Key Behavior:**
- Validates that the task exists, is pending, and all dependencies are completed
- Reads `dashboards/{dashboardId}/plan.json` to extract full task context for the worker prompt
- Dispatches a worker agent with a complete, self-contained prompt
- Logs the dispatch to `logs.json`
- Does not create a progress file -- the worker creates its own when it starts

---

### `!retry`

**Purpose:** Re-dispatch a failed or blocked task with a fresh agent. Includes root cause analysis from the previous attempt.

**Syntax:**
```
!retry [dashboardId] {task_id}
```

**Key Behavior:**
- Validates the task exists and has a progress file with `status: "failed"`
- If the task is `"in_progress"`, warns and asks for confirmation
- If the task is `"completed"`, warns and asks for confirmation before re-running
- Saves the previous failure summary and logs for context
- Analyzes the failure root cause by reading previous logs and relevant project files
- Deletes the old progress file so the new worker starts fresh
- Dispatches a new agent with the original task context plus retry-specific sections: previous failure summary, root cause analysis, and remediation guidance

---

### `!resume`

**Purpose:** Resume a chat session after the agent process was interrupted, crashed, or the connection was lost. Reviews conversation history, reconstructs context, and picks up where the agent left off.

**Syntax:**
```
!resume
```

**Key Behavior:**
- Reviews full conversation history to understand the original task and progress made
- Checks current file state and git status to verify what was actually completed
- Presents a status summary before continuing work
- Picks up exactly where the agent left off

---

### `!track_resume`

**Purpose:** Resume a stalled or interrupted swarm. Inspects dashboard state, identifies all incomplete tasks, and re-dispatches them with full context.

**Syntax:**
```
!track_resume [dashboardId]
```

**Key Behavior:**
- Assesses the full swarm state by reading `initialization.json`, all progress files, and `logs.json`
- Classifies every task: completed (skip), failed (retry with failure context), stale in-progress (re-dispatch with partial progress context), pending ready (dispatch), pending blocked (wait)
- Treats all `in_progress` tasks as stale (if the master is running `!track_resume`, the previous session is dead)
- Presents a resume plan for user approval
- Cleans up stale progress files and dispatches all ready tasks simultaneously
- Continues the standard execution loop: process completions, dispatch newly unblocked tasks
- Includes full resume context in worker prompts so workers know they are in a resumed swarm

**Comparison:**
| Command | Scope |
|---------|-------|
| `!track_resume` | Entire swarm -- full assessment + re-dispatch ALL incomplete tasks |
| `!dispatch --ready` | Pending only -- dispatches unblocked tasks, does not retry failed |
| `!retry {id}` | Single task -- re-dispatches one specific failed task |

---

### `!add_task`

**Purpose:** Inject new tasks into an active swarm mid-flight. Deeply analyzes the prompt, decomposes it into subtasks, resolves dependencies against all existing tasks (both directions), updates the dashboard, and dispatches any tasks whose dependencies are already satisfied.

**Syntax:**
```
!add_task {prompt}                          -- Add tasks to the active swarm (uses your assigned dashboard)
!add_task --dashboard {id} {prompt}         -- Add tasks to a specific dashboard's swarm
```

**Key Behavior:**
- Requires an active swarm on the target dashboard
- Reads the full swarm state (`plan.json`, initialization.json, all progress files, master_state.json, companion task file if present) and project context before planning
- Decomposes the prompt into 1 or more right-sized subtasks following the same quality standards as `!p_track` planning
- Resolves dependencies in both directions: new tasks may depend on existing tasks, and existing pending tasks may have new dependencies added
- Validates no circular dependencies and warns about file conflicts with in-progress tasks
- Assigns wave numbers and task IDs following existing conventions
- Updates initialization.json, `plan.json` when task specs change, logs.json, master_state.json, and companion task files when present atomically
- Runs eager dispatch for any new tasks whose dependencies are already satisfied
- Never modifies completed or in-progress tasks -- only pending tasks can have their dependencies updated

---

### `!eager_dispatch`

**Purpose:** Run a standalone eager dispatch round on an active swarm. Reads current dashboard state, identifies all tasks whose dependencies are satisfied but have not been dispatched, builds complete worker prompts, and dispatches them all immediately.

**Syntax:**
```
!eager_dispatch                             -- Dispatch on your assigned dashboard
!eager_dispatch --dashboard {id}            -- Target a specific dashboard
```

**Key Behavior:**
- Reads `plan.json`, initialization.json, all progress files, master_state.json, and any companion task file
- Builds completed/in-progress/failed sets from progress files
- Identifies every task where ALL `depends_on` are completed and the task is not yet dispatched
- Presents a dispatch summary and waits for user approval before dispatching
- Builds complete, self-contained worker prompts with conventions, upstream results, and reference code
- Does NOT monitor worker completions, retry failed tasks, run the circuit breaker, or produce a final report -- it is a one-shot dispatch operation

**Comparison with `!dispatch --ready`:**

| Feature | `!dispatch --ready` | `!eager_dispatch` |
|---------|---------------------|-------------------|
| Worker prompt quality | Basic -- task info + paths | Full -- conventions, upstream results, reference code |
| Reads project CLAUDE.md | No | Yes -- builds convention_map |
| Upstream result injection | No | Yes -- structured per-dependency summaries |
| Writes master_state.json | No | Yes |
| Approval gate | No | Yes -- presents summary before dispatching |

---

### `!export`

**Purpose:** Export a dashboard's full swarm state as a formatted document for post-mortems, documentation, or sharing.

**Syntax:**
```
!export                                     -- Export your assigned dashboard as markdown
!export c3d4e5                          -- Export a specific dashboard
!export --format json                       -- Export as raw JSON
!export --format markdown                   -- Export as formatted markdown (default)
```

**Key Behavior:**
- Reads initialization.json, logs.json, all progress files, and metrics.json (if it exists)
- Merges initialization data with progress files to compute full swarm state: task statuses, agent assignments, timelines, deviations, and derived stats
- Supports two output formats:
  - **Markdown** (default): Structured document with task summary table, deviations, event timeline, and performance metrics
  - **JSON**: Raw combined data as a single JSON object with task metadata, derived stats, agents, waves, log entries, and metrics
- Read-only -- does not modify any files

---

### `!p_track_resume`

**Purpose:** Comprehensive resume of a stalled, interrupted, or partially completed `!p_track` swarm. The invoking agent becomes the master agent -- responsible for reconstructing the full swarm state from disk, determining which agents are alive vs stale, re-dispatching where necessary, and running the full execution-to-completion lifecycle including the final report.

**Syntax:**
```
!p_track_resume                             -- Resume your assigned dashboard
!p_track_resume --dashboard {id}            -- Resume a specific dashboard
```

**Key Behavior:**
- Reads all master instruction documents before taking any action (7 required files including master instructions, dashboard writes, eager dispatch, worker prompts, compaction recovery, and failure recovery)
- Reconstructs full swarm state from initialization.json, all progress files, logs.json, and master_state.json
- Locates and reads `plan.json`, any companion task file, and project CLAUDE.md for worker prompt construction
- Rebuilds the upstream result cache from progress files and master_state.json
- Assesses agent health for in-progress tasks: checks progress file recency (milestones/logs within last 10 minutes) to determine if workers are likely alive or stale
- Classifies every task as: completed, failed, likely alive, stale in-progress, pending ready, or pending blocked
- Presents a detailed resume plan and waits for user approval
- Dispatches all ready tasks with full worker prompts (identical quality to `!p_track`)
- Runs the standard `!p_track` execution loop: process completions, eager dispatch, failure recovery, circuit breaker, context compaction recovery
- Delivers the NON-NEGOTIABLE final report with metrics upon completion

**Comparison:**

| Command | Scope |
|---------|-------|
| `!p_track_resume` | Full lifecycle -- reads all master instructions, checks agent health, rebuilds state, dispatches with full prompts, runs complete execution loop, delivers final report with metrics |
| `!track_resume` | Dispatch-focused -- assesses state, re-dispatches incomplete tasks, monitors completion. Less emphasis on instruction reading and final reporting |
| `!dispatch --ready` | Pending only -- dispatches unblocked tasks, does not retry failed |
| `!retry {id}` | Single task -- re-dispatches one specific failed task |
| `!resume` | Chat session -- resumes a non-swarm chat session, not for swarm orchestration |

---

### `!cancel`

**Purpose:** Cancel the active swarm immediately. Marks all non-completed tasks as failed.

**Syntax:**
```
!cancel [dashboardId] [--force]
```

**Key Behavior:**
- Without `--force`: writes a `"permission"` log entry (triggers dashboard popup) and asks for terminal confirmation
- With `--force`: skips confirmation
- Completed tasks are preserved -- only in-progress and pending tasks are marked as `"failed"`
- Running agents may continue in the background; their progress file writes will still succeed
- This is the one exception where the master writes progress files directly

---

### `!cancel-safe`

**Purpose:** Graceful shutdown. Stops dispatching new tasks but lets all in-progress agents finish their work naturally.

**Syntax:**
```
!cancel-safe [dashboardId]
```

**Key Behavior:**
- Sets an internal flag that prevents any new task dispatches
- Running agents continue and complete (or fail) on their own
- Polls progress files every 10 seconds until all in-progress agents finish
- After 10 minutes, warns the user and offers to force-cancel
- Once all running agents finish, marks remaining pending tasks as cancelled
- Preserves all completed and naturally-finished work intact

**Contrast with `!cancel`:** `!cancel` immediately marks in-progress agents as failed (though they may still be running). `!cancel-safe` waits for running work to finish, preserving results.

---

## Monitoring Commands

### `!status`

**Purpose:** Quick terminal summary of the current swarm state. Read-only, no dispatch, no log writes.

**Syntax:**
```
!status [dashboardId]
```

**Key Behavior:**
- Reads `initialization.json` and all progress files
- Derives all stats: completed, failed, in_progress, pending counts, overall status, elapsed time
- Displays a formatted agent table with status, wave, and summary for each task
- Includes wave summary table

---

### `!p_status`

**Purpose:** Mid-swarm health check that also takes action. Statuses all currently dispatched workers, surfaces stalls and failures, and re-saturates the pipeline by dispatching newly-ready tasks and re-dispatching cleanly failed ones -- without interrupting any actively running worker.

**Syntax:**
```
!p_status [dashboardId]
```

**Key Behavior:**
- Non-disruptive: never interrupts, kills, or overwrites an active worker's progress file
- Never double-dispatches: re-reads progress files immediately before dispatch
- Classifies every task into: active, stale, completed, failed, pending, or blocked
- Staleness detection: flags `in_progress` tasks with no activity for 10+ minutes (does NOT auto-kill; warns user and suggests `!retry`)
- Eager dispatch: dispatches all pending tasks whose dependencies are now satisfied (with full worker prompts including upstream results)
- Failure re-dispatch: retries cleanly failed tasks with root-cause analysis context (applies circuit breaker if 3+ cluster failures)
- Safe to re-run: idempotent -- running twice with no worker activity in between produces no new dispatches
- Never marks a swarm complete or writes metrics.json -- it is a checkpoint, not a terminator

**Comparison with related commands:**

| Command | Scope |
|---------|-------|
| `!p_status` | Live health check + dispatch of ready tasks + retry of failures. Non-disruptive to active workers |
| `!status` | Print-only summary, no dispatch, no log writes |
| `!p_track_resume` | Full state reconstruction when the entire swarm is dead |
| `!eager_dispatch` | Dispatch-only; does not status active workers or handle failures |
| `!dispatch --ready` | Dispatch ready tasks; does not retry failures or surface stalls |

---

### `!logs`

**Purpose:** View and filter event log entries from the dashboard's `logs.json`.

**Syntax:**
```
!logs [dashboardId] [--level {level}] [--task {id}] [--agent {name}] [--last {N}] [--since {HH:MM}]
```

**Filters (can be combined):**
- `--level error` -- Show only error entries (also: `info`, `warn`, `deviation`)
- `--task 2.3` -- Show logs for a specific task
- `--agent "Agent 5"` -- Show logs for a specific agent
- `--last 20` -- Show only the last 20 entries
- `--since 14:30` -- Show entries after a specific time

---

### `!inspect`

**Purpose:** Deep-dive into a specific task. Shows full context, dependencies, status timeline, milestones, deviations, and worker logs.

**Syntax:**
```
!inspect [dashboardId] {task_id}
```

**Key Behavior:**
- Reads from `plan.json`, `initialization.json`, the task's progress file, any companion task file, and `logs.json`
- Displays: status, wave, timeline (created/dispatched/completed/duration), agent info, milestones, deviations, upstream dependencies with their statuses, downstream blocks, task context and critical details, file lists, worker logs, and dashboard logs

---

### `!deps`

**Purpose:** Visualize the dependency graph for the entire swarm or a specific task.

**Syntax:**
```
!deps [dashboardId]                  -- Full dependency graph
!deps [dashboardId] {task_id}        -- Dependencies for a specific task
!deps [dashboardId] --critical       -- Highlight the critical path
!deps [dashboardId] --blocked        -- Show only blocked/failing chains
```

**Key Behavior:**
- Builds an ASCII visualization of the dependency graph with status indicators
- Identifies the critical path (longest chain from root to terminal task)
- Identifies bottlenecks (in-progress tasks with the most downstream dependents)
- For a single task, traces both upstream (needs) and downstream (blocks) chains

---

### `!history`

**Purpose:** View past swarm history from saved summary files.

**Syntax:**
```
!history [--last N]
```

**Key Behavior:**
- Reads all `.json` files from `{tracker_root}/history/`
- Displays a table with: name, project, task counts, wave count, status, duration, and cleared date
- Sorted by `cleared_at` descending (newest first)
- History summaries are created automatically when dashboards are cleared

---

### `!update_dashboard`

**Purpose:** Generate a visual progress report of the current swarm showing all completed tasks, milestones, deviations, and remaining work.

**Syntax:**
```
!update_dashboard [dashboardId]
```

**Key Behavior:**
- Read-only -- does not modify any files
- Computes swarm stats from progress files
- Shows a progress bar, wave summary table, details of the most recently completed task, a table of all completed tasks, any deviations across the swarm, and remaining pending/in-progress work
- Useful for getting a quick terminal snapshot of swarm progress

---

## Research Pipeline Commands

The research pipeline is a multi-stage system for deep, breadth-first research that produces a synthesized knowledge layer and ranked product plans. The pipeline stages are: `!p_research` (gather) -> `!p_synthesize` (merge) -> `!p_product_plan` (plan and rank). The `!p_product_research` command orchestrates all three as a single pipeline.

### `!p_research`

**Purpose:** Run a deep, breadth-first research pipeline as a parallel Synapse swarm. Decomposes a topic into many independent angles, dispatches waves of parallel research workers (saturating parallelism), and stitches returns into a coherent synthesis. Inaccessible sources are catalogued with weighted value scores.

**Syntax:**
```
!p_research {topic}
!p_research --depth {shallow|standard|deep|exhaustive} {topic}
!p_research --scope {internal|external|both} {topic}
!p_research --max-waves N {topic}
!p_research --dashboard {id} {topic}
```

**Arguments:**
- `{topic}` -- The research question (technical topic, decision to investigate, domain to map, or comparison)
- `--depth` -- (Optional, default `deep`) Controls wave count and workers per wave
- `--scope` -- (Optional, default `both`) `internal` = project repo + PKI + wiki. `external` = web/docs/papers. `both` = both pools
- `--max-waves` -- (Optional) Hard cap on wave count
- `--dashboard {id}` -- (Optional) Force a specific dashboard

**Depth Tiers:**

| Tier | Waves | Workers/wave | When to use |
|------|-------|--------------|-------------|
| `shallow` | 2 | 4-6 | Quick survey before committing to deeper dive |
| `standard` | 3 | 6-10 | Default for most research questions |
| `deep` | 4-5 | 8-12 | Multi-discipline topics or known controversy |
| `exhaustive` | 5-7 | 10-15 | Pre-decision research where missing a perspective is expensive |

**Key Behavior:**
- The invoking agent becomes the master. Master never fetches external sources -- workers do all source-gathering
- Decomposes topics into angles: definitional, historical, technical, comparative, practitioner, failure modes, adversarial, adjacent, empirical, tooling, regulatory, future, project-internal
- Wave 1 = broad discovery. Wave 2 = deep dive into high-value sources. Wave 3 = gap fill and cross-validation. Wave 4 (deep/exhaustive) = adversarial. Final wave = single integration worker for synthesis
- All raw findings persist to `{project_root}/documentation/research/{topic-slug}/raw/` before synthesis
- Source weighting phase computes value scores for inaccessible sources, producing `_missing_sources.md`
- Full dashboard tracking always (never lightweight mode)

**Produces:**
```
{project_root}/documentation/research/{topic-slug}/
  _index.md                    -- Entry point
  _synthesis.md                -- Primary deliverable (coherent narrative)
  _claims.json                 -- Structured claims with citations + confidence bands
  _missing_sources.md          -- Weighted catalogue of inaccessible sources
  _confidence.md               -- Per-claim confidence rationale
  _graph.json                  -- Entities + typed edges
  raw/                         -- Per-agent raw findings (immutable)
  sources/                     -- Cached source bodies + provenance metadata
```

---

### `!p_synthesize`

**Purpose:** Merge per-topic research produced by `!p_research` into a single project-wide synthesis layer. Workers detect duplicate claims across topics, stitch complementary information into unified subject pages, and extract contradictions and unanswered questions into a living `_open_issues.md` document. A final verification pass confirms no contradictions slipped through.

**Syntax:**
```
!p_synthesize
!p_synthesize --mode {full|incremental|verify-only}
!p_synthesize --topics "slug1,slug2,..."
!p_synthesize --depth {standard|deep}
!p_synthesize --dashboard {id}
!p_synthesize [topic-filter]
```

**Arguments:**
- `--mode` -- (Optional, default `full`) `full` = re-synthesis from scratch. `incremental` = merge only topics newer than current synthesis. `verify-only` = skip merge, run only verification pass
- `--topics` -- (Optional) Comma-separated topic slugs to include
- `--depth` -- (Optional, default `standard`) `deep` doubles parallelism for wide catalogues (20+ topics)
- `[topic-filter]` -- (Optional) Free-text filter on topic frontmatter

**Key Behavior:**
- Per-topic research is immutable input -- synthesis never modifies `documentation/research/{topic-slug}/`
- Clusters topics by entity/domain overlap using union-find on shared entities/tags
- Wave 1 = dedup detection (one worker per cluster). Wave 2 = cluster stitching (per-cluster pages). Wave 3 = cross-cluster integration. Wave 4 = issues consolidation (single writer). Wave 5 = master synthesis assembly (single writer). Wave 6 = verification (mandatory, always last)
- `_open_issues.md` is a living document with append-only history (`_open_issues.history.jsonl`). Issues get memory across runs -- never silently lost
- Stable hash-based IDs for all contradictions and open questions enable cross-run continuity
- Confidence bands are rule-based (computed from components), never asserted as scalars

**Produces:**
```
{project_root}/documentation/research/synthesis/
  _index.md                    -- Entry point
  _master_synthesis.md         -- Project-wide unified narrative
  _open_issues.md              -- Living contradictions + open questions
  _open_issues.history.jsonl   -- Append-only state-change history
  _verification_report.md      -- Verifier's independent report
  _claims.json                 -- Merged structured claims
  _graph.json                  -- Merged entity + edge graph
  _coverage.md                 -- Topics merged/skipped/stale
  topics/                      -- Per-cluster unified subject pages
```

---

### `!p_product_plan`

**Purpose:** Generate candidate product plans from a project's research synthesis, evaluate each across context-specific dimensions, then produce final ratings and a top-N deep-dive comparison. Outputs honest, citation-backed recommendations.

**Syntax:**
```
!p_product_plan
!p_product_plan --breadth {standard|wide|exhaustive}
!p_product_plan --lenses "lens1,lens2,..."
!p_product_plan --categories "cat1,cat2,..."
!p_product_plan --top-n N
!p_product_plan --dashboard {id}
!p_product_plan [focus]
```

**Arguments:**
- `[focus]` -- (Optional) Free-text framing. Empty = derived from synthesis
- `--breadth` -- (Optional, default `wide`) `standard` ~6-9 plans, `wide` ~10-15 plans, `exhaustive` ~16-24 plans
- `--lenses` -- (Optional) Override lens selection (comma-separated)
- `--categories` -- (Optional) Force specific evaluation categories
- `--top-n` -- (Optional, default 4) How many plans in the final deep-dive (range: 3-5)
- `--dashboard {id}` -- (Optional) Force a specific dashboard

**Key Behavior:**
- Reads the synthesis layer (`_master_synthesis.md`, `_open_issues.md`, topics) as primary input
- Master picks strategic lenses for plan generation (scale/ambition, distribution/GTM, positioning, capital/risk, AI-era, adversarial axes)
- Master picks evaluation categories per topic -- categories that actually discriminate among plans, not a fixed list
- Wave 1 = plan generation (one worker per lens, independent). Wave 2 = multi-dimensional evaluation (one worker per plan-category pair, massive fan-out). Wave 3 = comparison angles (head-to-head, risk-adjusted, capital-efficiency, time-to-revenue). Wave 4 = adversarial review of top-N. Wave 5 = comparison matrix assembly. Wave 6 = final synthesis (single worker writes deliverables)
- Honesty is mandatory: workers must surface weaknesses, fatal flaws, and load-bearing unknowns. Anti-inflation rules enforce calibrated scoring
- Plans are immutable once written; stable plan IDs enable cross-run comparison

**Produces:**
```
{project_root}/documentation/research/plans/
  final_plans.md               -- USER DELIVERABLE: top-N deep-dive comparison
  final_ratings.md             -- USER DELIVERABLE: honest ratings of every plan
  _evaluation_framework.md     -- Chosen categories + reasoning
  _comparison_matrix.md        -- Cross-plan score matrix
  candidates/                  -- One file per plan candidate
  evaluations/                 -- Per-plan, per-category evaluation files
  comparisons/                 -- Ranking angle outputs
```

**Cost Discipline:**
- `standard` (~60 workers), `wide` (~105 workers), `exhaustive` (~190 workers)
- Projected count surfaced before dispatch; user approval required

---

### `!p_product_research`

**Purpose:** One-command end-to-end product research pipeline. Persists the user's research prompt, then runs three pipeline stages consecutively: `!p_research` -> `!p_synthesize` -> `!p_product_plan`. Each stage runs as its own full Synapse swarm with its own dashboard.

**Syntax:**
```
!p_product_research {prompt}
!p_product_research --research-depth {shallow|standard|deep|exhaustive} {prompt}
!p_product_research --research-scope {internal|external|both} {prompt}
!p_product_research --synthesize-mode {full|incremental} {prompt}
!p_product_research --plan-breadth {standard|wide|exhaustive} {prompt}
!p_product_research --plan-top-n N {prompt}
```

**Key Behavior:**
- The invoking agent becomes the pipeline master, orchestrating three stages in strict sequence
- Phase 0: Persists the prompt to `documentation/research/prompt.md` before any dispatch
- Stage 1 (`!p_research`): Produces research corpus in `documentation/research/{topic-slug}/`
- Stage 2 (`!p_synthesize`): Produces synthesized knowledge layer in `documentation/research/synthesis/`
- Stage 3 (`!p_product_plan`): Produces ranked plans in `documentation/research/plans/`
- Each stage requires its own user approval -- the pipeline does not auto-approve
- Stage failure halts the pipeline (no silent fall-through)
- Pipeline-level state tracked in `_pipeline_runs/{pipeline_run_id}/` for resume capability
- Unified `pipeline_report.md` ties all stages together at completion

**Cost Discipline:**
- All defaults (~155-200 total workers across 3 stages)
- Cost-conscious config (~75-110 workers)
- Maximum config (~280-370 workers)
- Three approval gates (one per stage) for cost control

---

### `!p_product_research_resume`

**Purpose:** Resume a stalled, interrupted, or partially-completed `!p_product_research` pipeline. Reconciles filesystem state against dashboard progress, repairs orphaned/stuck progress files, re-dispatches incomplete tasks, and continues the pipeline through remaining stages.

**Syntax:**
```
!p_product_research_resume
!p_product_research_resume --dashboard {id}
!p_product_research_resume --pipeline-run {pipeline_run_id}
```

**Key Behavior:**
- Identifies the active stage by reading `_pipeline_runs/{id}/invocation.json`
- Performs filesystem reconciliation: detects orphan completions (file exists but progress lost), false completions (progress claims done but file missing), stranded artifacts, and stale workers
- Re-dispatches all ready tasks with full worker context including resume-specific notes
- After recovering the active stage, continues the pipeline through remaining stages (with approval gates)
- Completed stages are never re-run
- Surfaces all repairs transparently to the user

**When to use:**
- Pipeline interrupted (chat closed, network drop, master compaction)
- Tasks stuck in `dispatched`/`in_progress` for >5 minutes with no progress
- Files appeared in `documentation/research/` but dashboard didn't register completion
- Pipeline halted at a stage transition gate

---

## Server Control Commands

### `!start`

**Purpose:** Start the Synapse dashboard server and launch the Electron app.

**Syntax:**
```
!start
```

**Key Behavior:**
- Checks if the server is already running on port 3456
- If not running, starts `node {tracker_root}/src/server/index.js` in the background
- Verifies the server is responding
- Launches the Electron app with `npm start`

---

### `!stop`

**Purpose:** Stop the Synapse dashboard server.

**Syntax:**
```
!stop
```

**Key Behavior:**
- Finds the server process on port 3456
- Kills it and confirms shutdown
- Reports if the server was not running

---

### `!reset`

**Purpose:** Clear a dashboard and reset it to empty state. Archives the previous swarm and saves a history summary.

**Syntax:**
```
!reset [dashboardId]        -- Reset a specific or your assigned dashboard
!reset --all                -- Reset all 5 dashboards
```

**Key Behavior:**
- Saves a history summary to `{tracker_root}/history/`
- Archives the full dashboard directory to `{tracker_root}/Archive/{date}_{task_name}/` (mandatory -- never clears without archiving)
- Deletes all progress files
- Resets `initialization.json` and `logs.json` to empty state

---

## Project Management Commands

### `!project`

**Purpose:** Show, set, or clear the target project that Synapse operates on.

**Syntax:**
```
!project                        -- Show current project and resolution method
!project set /path/to/repo      -- Store a target project path
!project clear                  -- Clear stored project, revert to CWD detection
```

**Key Behavior:**
- `!project` (no args): displays the resolved `{project_root}`, how it was resolved, whether `CLAUDE.md` exists, whether `.synapse/` exists, and detected tech stack indicators
- `!project set`: validates the path, writes to `{tracker_root}/.synapse/project.json`, creates `{project_root}/.synapse/` if needed
- `!project clear`: removes the stored config so `{project_root}` resolves from CWD

---

## Utility Commands

### `!guide`

**Purpose:** Interactive command decision tree that helps users pick the right Synapse command.

**Syntax:**
```
!guide
```

**Key Behavior:**
- Displays a visual decision tree flowchart organized by task type: project setup, parallel work, monitoring, task actions, history, server control, project analysis, knowledge graph management, and housekeeping
- Includes a complete command reference table grouped by category
- Provides quick-pick tips for common scenarios
