# Swarm Lifecycle Overview

The Synapse swarm lifecycle is the complete end-to-end process of decomposing a complex task into parallel work streams, dispatching autonomous worker agents, tracking their live progress, and compiling a final report. Every swarm follows the same deterministic sequence of phases, governed by strict protocols that ensure reliability, visibility, and maximum parallelism.

---

## The Full Lifecycle at a Glance

A swarm progresses through thirteen distinct stages, from the moment the user types a command to the moment the master agent delivers its final report.

```
User invokes !p_track {prompt}
        |
        v
 1. INVOCATION
    Master reads command file, CLAUDE.md, master instructions
        |
        v
 2. CONTEXT GATHERING
    Master reads project CLAUDE.md, TOC, source files
        |
        v
 3. PLANNING
    Decompose into tasks, map dependencies, write agent prompts
        |
        v
 4. DASHBOARD POPULATION
    Archive old data, write initialization.json, log init entry
        |
        v
 5. USER APPROVAL
    Present plan summary, wait for confirmation
        |
        v
 6. INITIAL DISPATCH
    Spawn all Wave 1 workers + any higher-wave tasks with no blockers
        |
        v
 7. EAGER DISPATCH LOOP
    On each completion, scan ALL tasks, dispatch every unblocked one
        |
        v
 8. MONITORING
    Workers write progress files, dashboard shows live updates, master logs events
        |
        v
 9. COMPLETION DETECTION
    All tasks done, or all remaining blocked by failures
        |
        v
10. VERIFICATION
    Optional verification agent for cross-file integration
        |
        v
11. METRICS
    Compute swarm performance metrics, write metrics.json
        |
        v
12. FINAL REPORT
    Read all data, compile comprehensive report with required sections
        |
        v
13. POST-SWARM
    History save, master resumes normal behavior
```

---

## Two Actors, Two Roles

Every swarm involves exactly two types of actors with strictly separated responsibilities.

### The Master Agent

The master agent is the orchestrator. It plans, dispatches, monitors, and reports. It never writes code. It never edits application files. It never runs application commands. Its sole purpose is to maintain the elevated perspective required to coordinate the entire swarm.

The master agent has exactly five responsibilities:

1. **Gather Context** -- Read project files, documentation, types, and code to build a complete mental model of the codebase and the task.
2. **Plan** -- Decompose the task into atomic units, map dependencies between them, assign wave groupings, and write self-contained agent prompts with full context.
3. **Dispatch** -- Spawn worker agents via the Task tool, feed them upstream results from completed tasks, and keep the pipeline maximally saturated.
4. **Status** -- Log events to `logs.json`, update the master task file on completions and failures, and maintain awareness of the swarm's state.
5. **Report** -- Compile a final summary when all workers have finished, including verification results, deviations, and recommendations.

The master writes to exactly six categories of files during a swarm, and no others:

| File | Purpose |
|---|---|
| `dashboards/{dashboardId}/initialization.json` | Static plan data (written once during planning) |
| `dashboards/{dashboardId}/logs.json` | Timestamped event log for the dashboard |
| `dashboards/{dashboardId}/master_state.json` | Master's execution state checkpoint (dispatch tracking, upstream result cache) |
| `dashboards/{dashboardId}/metrics.json` | Post-swarm performance metrics (written once at completion) |
| `tasks/{date}/parallel_{name}.json` | Master task record (plan, status, summaries) |
| `tasks/{date}/parallel_plan_{name}.md` | Strategy rationale document |

### Worker Agents

Worker agents are the implementers. Each worker is spawned by the master via the Task tool and receives a self-contained prompt with everything needed to complete a single atomic task. Workers do their code work in `{project_root}` and write progress updates to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`.

Workers progress through fixed stages in order:

| Stage | Description |
|---|---|
| `reading_context` | Reading project files, documentation, task file |
| `planning` | Assessing readiness, planning approach |
| `implementing` | Writing code, creating/modifying files |
| `testing` | Running tests, validating changes |
| `finalizing` | Final cleanup, preparing summary report |
| `completed` | Task completed successfully |
| `failed` | Task failed |

Each worker owns exactly one progress file. It writes the full file on every update (no read-modify-write needed since it is the sole writer). When finished, the worker returns a structured report to the master containing STATUS, SUMMARY, FILES CHANGED, EXPORTS, DIVERGENT ACTIONS, WARNINGS, and ERRORS.

---

## Key Data Files

The swarm lifecycle revolves around four categories of data files. Understanding which actor writes each file and when is critical to understanding how the system works.

| File | Written By | When | Purpose |
|---|---|---|---|
| `initialization.json` | Master (once) | During planning phase | Static plan data: task metadata, agent entries, wave structure, dependency graph |
| `logs.json` | Master (throughout) | On every event | Timestamped event log for the dashboard log panel |
| `progress/{task_id}.json` | Workers (each owns one) | Throughout execution | Live lifecycle data: status, stage, milestones, deviations, logs |
| `master_state.json` | Master (throughout) | After every dispatch event | Execution state checkpoint: completed/in-progress/failed task caches, upstream results, agent numbering |
| `metrics.json` | Master (once) | After all tasks complete | Post-swarm performance metrics: elapsed time, parallel efficiency, failure rate |
| `parallel_{name}.json` | Master (throughout) | Planning + on each completion | Authoritative task record: descriptions, context, summaries, status |

The dashboard merges `initialization.json` (static plan) with `progress/` files (dynamic lifecycle) to render the complete swarm view. All stat cards (Total, Completed, In Progress, Failed, Pending, Elapsed) are derived from progress files -- the master maintains no counters.

### Data Flow

```
Master Agent                   Dashboard Files                    Dashboard UI
============                   ===============                    ============

Planning:
  Write once  ---------->  initialization.json  ---------->  Task cards (pending)
  Write once  ---------->  logs.json (init entry)  ------->  Log panel
  Write once  ---------->  Task file                          (not rendered)
  Write once  ---------->  Plan rationale .md                 (not rendered)

Dispatch:
  Spawn workers  ------->  (workers start)  --------------->  Cards go purple
  Log dispatch  --------->  logs.json (dispatch entries)  -->  Log panel updates

Monitoring:
  (workers write)  ------>  progress/*.json  -------------->  Live stage, milestones
  Log completions  ------>  logs.json (events)  ----------->  Log panel updates
  Update task file  ---->  Task file (summaries)              (not rendered)

Completion:
  Log final  ------------>  logs.json (completion)  -------->  "Complete" badge
  Write metrics  -------->  metrics.json                       (post-hoc analysis)
  (Optional archive)  --->  Archive/ directory                 (dashboard clears)
```

---

## Phase Relationships

The lifecycle phases are not purely sequential. While the macro flow follows the numbered sequence above, several important patterns emerge during execution.

### Overlapping Execution and Monitoring

Phases 6 through 8 (Initial Dispatch, Eager Dispatch, Monitoring) overlap continuously. Workers execute tasks while the master monitors completions, and each completion triggers a new dispatch scan. This is not a batch process -- it is a continuous pipeline that keeps the system maximally saturated.

### Dependency-Driven, Not Wave-Driven

Waves are a visual grouping for humans on the dashboard. The dispatch engine operates solely on the dependency graph. A task in Wave 4 whose dependencies are all satisfied gets dispatched immediately -- even if Wave 2 still has running tasks. The master never waits for a wave to complete before looking ahead.

If you removed the `wave` field from every agent, the dispatch logic would not change at all. Waves are a UI label. Dependencies are the only dispatch constraint.

### Failure Does Not Stop the Swarm

A failed task blocks only its direct dependents. Everything else continues. The master logs the error, creates a repair task that splices into the dependency chain, dispatches a repair worker with the full context of the failure, and continues the eager dispatch scan for unrelated tasks. Only cascading failures (meeting the circuit breaker thresholds) trigger a pause for reassessment.

### The Pipeline Must Flow Continuously

When an agent completes, the master must:
1. Record the completion
2. Immediately scan ALL pending tasks for newly satisfied dependencies
3. Dispatch every unblocked task in the same update cycle
4. Never let the pipeline stall waiting for a batch

Every idle moment where an available task sits undispatched is wasted wall-clock time.

---

## The Dashboard as Primary Interface

The Synapse dashboard is the user's primary window into swarm progress. During execution, the master outputs only minimal one-line confirmations to the terminal. All rich status information flows through the dashboard.

### Dashboard Panels

| Panel | What It Shows | Data Source |
|---|---|---|
| **Header bar** | Task name, active agent count | `initialization.json` + progress file count |
| **Progress bar** | Completion percentage | Completed / total_tasks ratio from progress files |
| **Stat cards** (6) | Total, Completed, In Progress, Failed, Pending, Elapsed | All derived from progress files |
| **Wave pipeline** | Visual cards for each agent, color-coded by status | `initialization.json` merged with progress files |
| **Dependency lines** | BFS-pathfound lines between dependent cards | `depends_on` field in `initialization.json` |
| **Log panel** | All event log entries, filterable by level | `logs.json` |
| **Agent detail popup** | Per-agent milestone timeline, deviation list, log box | Individual `progress/{id}.json` |

### Real-Time Updates

The server watches three data sources per dashboard:
- `initialization.json` -- via `fs.watchFile` (polling at 100ms intervals)
- `logs.json` -- via `fs.watchFile` (polling at 100ms intervals)
- `progress/` directory -- via `fs.watch` (OS-level event notification)

When any file changes, the server reads the file (with a 30ms initial delay for progress files, plus an 80ms retry if JSON is malformed mid-write) and pushes the update to every open browser tab via Server-Sent Events (SSE).

Additionally, the server runs a **periodic reconciliation** every 5 seconds that scans all progress files and rebroadcasts any changes the OS watcher may have missed. This ensures eventual consistency even if `fs.watch` drops an event.

The server also provides automatic dependency tracking: when a progress file changes to `status: "completed"`, the server waits 100ms (to let file writes settle), then calls `DependencyService.computeNewlyUnblocked()` to identify newly unblocked tasks and broadcasts a `tasks_unblocked` SSE event. The dashboard shows green toast notifications for dispatchable tasks.

The server validates progress files on every read: the `task_id` field must match the filename, and the `dashboard_id` field (if present) must match the dashboard directory. Mismatches are hard-rejected with a `write_rejected` SSE event -- the dashboard does not render invalid writes.

---

## Lifecycle Timing

A well-planned swarm follows this approximate timing profile:

| Phase | Typical Duration | Notes |
|---|---|---|
| Context Gathering | 30-90 seconds | Depends on project size and number of files to read |
| Planning | 1-3 minutes | Includes decomposition, prompt writing, task file/plan creation |
| Dashboard Population | 5-15 seconds | File writes are fast |
| User Approval | Variable | Depends on the user |
| Execution (dispatch + monitoring) | 3-15 minutes | Depends on task count and critical path length |
| Verification | 1-3 minutes | Optional, depends on scope of changes |
| Final Report | 15-30 seconds | Compilation and delivery |

Each individual worker task should take 1-5 minutes. Tasks under 1 minute have too much orchestration overhead relative to useful work. Tasks over 5 minutes risk context exhaustion and should be decomposed further.

---

## Key Invariants

These invariants hold throughout every swarm lifecycle:

1. **`initialization.json` is write-once.** The master writes it during planning and never updates it after, with the sole exception of repair task insertion when a worker fails.

2. **Workers own their progress files.** The master never writes to `progress/{task_id}.json`. Workers are the sole writers. The master reads progress files to build the completed/in-progress sets for eager dispatch.

3. **All stats are derived.** The dashboard computes completed count, failed count, in-progress count, and elapsed time from progress files. The master maintains no counters.

4. **Dispatch is dependency-driven.** Waves are visual groupings only. The dispatch engine operates exclusively on the dependency graph.

5. **Timestamps are always live.** Every timestamp is captured via `date -u +"%Y-%m-%dT%H:%M:%SZ"` at the exact moment of writing. No estimates, no guesses, no construction from memory.

6. **The master never writes code.** During an active swarm, the master's only outputs are dashboard files (`initialization.json`, `logs.json`), the task record, and the plan rationale document. Everything in `{project_root}` is written by worker agents.

7. **Atomic writes are mandatory.** Always read the full file, parse, modify in memory, stringify with 2-space indent, and write the full file back. Partial JSON writes cause the dashboard to freeze.

8. **Archive before clear.** Previous swarm data is never discarded. Before clearing a dashboard for a new swarm, the master copies the full dashboard directory to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`.

9. **Master state is checkpointed.** After every dispatch event (worker dispatched, completed, or failed), the master writes a state checkpoint to `master_state.json` containing completed task summaries, in-progress task IDs, upstream result cache, and agent numbering. This enables recovery after context compaction.

---

## Related Documentation

Each phase of the lifecycle is documented in detail in its own file:

| Document | Covers |
|---|---|
| [Planning Phase](./planning-phase.md) | Context gathering, task decomposition, plan creation, prompt writing |
| [Dispatch Phase](./dispatch-phase.md) | Worker dispatch, dependency resolution, pipeline flow, upstream result injection |
| [Monitoring Phase](./monitoring-phase.md) | Live progress tracking, status updates, deviation handling, dashboard rendering |
| [Completion Phase](./completion-phase.md) | Final report, verification, cleanup, history and archiving |
| [Circuit Breaker](./circuit-breaker.md) | Automatic failure detection and replanning on cascading failures |
