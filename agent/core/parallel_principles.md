# Core Principles for Efficient Parallelization

These principles govern how the master agent should plan and execute parallel work. They apply universally regardless of the project being worked on.

---

## 1. Always Parallelize Independent Work

If two or more tasks have no dependency between them, they **must** run in parallel. This applies to everything — file reads, file writes, searches, edits, agent dispatches. Sequential execution of independent tasks is a failure mode.

---

## 2. Dependency-Driven Dispatch, Not Wave-Driven

Waves are a visual grouping for humans. The dispatch engine looks **only** at individual task dependencies. If task 2.3 depends only on 1.1 and 1.1 is done, dispatch 2.3 immediately — even if tasks 1.2 through 1.8 are still running. Never wait for a full wave to complete.

---

## 3. Pipeline Must Flow Continuously

When an agent completes:

1. Record the completion
2. Immediately scan ALL pending tasks for newly satisfied dependencies
3. Dispatch every unblocked task in the same update cycle
4. Never let the pipeline stall waiting for a batch

---

## 4. No Artificial Concurrency Cap

Send as many agents as there are ready tasks. The bottleneck should be dependencies, not artificial limits.

**Practical note:** The Task tool dispatches agents via tool calls. If a wave has more tasks than can be dispatched in a single message (~8-10 simultaneous tool calls), batch them into back-to-back dispatch rounds — but never wait for the first batch to complete before sending the second. Dispatch all ready tasks as fast as the tool allows.

---

## 5. Errors Don't Stop the Swarm (But Cascading Failures Trigger Automatic Replanning)

A failed task blocks only its direct dependents. Everything else continues. Log the error, mark the task, keep dispatching.

**Circuit breaker:** The orchestrator automatically enters replanning mode when any of these conditions are met:

- **3+ tasks fail within the same wave** — suggests a shared root cause, not isolated failures
- **A single failure blocks 3+ downstream tasks** — the failure is cascading through the dependency graph
- **A single failure blocks more than half of all remaining tasks** — critical-path failure

Whichever threshold is hit first triggers the circuit breaker.

**Automatic replanning:** When the circuit breaker fires, the master performs replanning inline:

1. Pauses all new dispatches
2. Reads all progress files to build a full picture of completed, failed, and blocked tasks
3. Analyzes root cause from failure patterns
4. Produces a revision plan with four categories:
   - `modified` — updated pending tasks
   - `added` — new repair tasks with `r`-suffixed IDs
   - `removed` — no longer viable tasks
   - `retry` — re-dispatch as-is
5. Applies the revision to `initialization.json` (the documented exception to write-once)
6. Resumes dispatch

**Fallback:** If replanning analysis fails to produce a valid revision (e.g., the master cannot determine root cause or all remaining tasks are blocked), the swarm pauses for manual intervention rather than pushing through blind. The user can then manually retry tasks or cancel the swarm.

Never blindly push through cascading failures.

---

## 6. Plan Deep, Execute Fast

Invest time upfront in thorough planning:

- Read all relevant code and documentation before decomposing
- Identify every dependency between tasks
- Give each agent a self-contained prompt with full context
- Verify the dependency graph has no cycles or missing references

This front-loaded investment pays off in execution speed — agents work independently without needing to ask questions or make assumptions.

---

## 7. Atomic Task Design

Each task should be:

- **Self-contained** — An agent can complete it with only the context provided
- **Small** — Takes a single agent one focused effort (not hours of work)
- **Verifiable** — The master can confirm success from the summary
- **Non-overlapping** — No two tasks modify the same file (or if they must, they're sequential)

---

## 8. Statusing Is Non-Negotiable

Status reporting is split between master and workers:

### Workers handle ALL status — lifecycle, live progress, and detailed logs:

- Write `dashboards/{dashboardId}/progress/{id}.json` with full lifecycle: `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`
- Write live progress: `stage`, `message`, `milestones[]`, `deviations[]`
- Write detailed logs: `logs[]` array (feeds the popup log box in agent details modal)
- Dashboard picks up changes in real-time via `fs.watch` + SSE

### Master handles event logging and task file updates only:

- Agent dispatched → append to `logs.json`
- Agent completed → append to `logs.json` + update task file
- Agent failed → append to `logs.json` + update task file
- Agent deviated → append to `logs.json` at level `"deviation"`
- Master does NOT update `initialization.json` after planning

**Master does NOT output terminal status tables** during execution. Terminal output is limited to one-line confirmations. The dashboard is the user's primary window into swarm progress.

---

## 9. Right-Size Tasks

Each task should take a single agent **1-5 minutes** to complete. This range balances parallelism against orchestration overhead.

| Too small (< 1 min) | Right-sized (1-5 min) | Too large (> 5 min) |
|---|---|---|
| Orchestration overhead dominates | Good parallelism/overhead ratio | Risk of context exhaustion |
| Many dispatch cycles for little work | Workers stay focused | Worker may lose track of scope |
| Log noise drowns signal | Each completion is meaningful | Long waits between status updates |

When estimating: a task that reads 2-3 files and modifies 1-2 files is typically right-sized. A task that reads 10+ files or modifies 5+ files should be decomposed further.

---

## 10. Shared File Accumulation Patterns

When multiple tasks need to add entries to the same file (routes to a router, exports to an index, entries to a config), **two tasks must never modify the same file simultaneously.** Use one of these patterns:

**Pattern A — Owner Task:** One task "owns" the shared file. Other tasks that need it depend on the owner. The owner creates/modifies the file; downstream tasks append to it sequentially.

**Pattern B — Integration Task:** All tasks that produce content for the shared file are independent, but a dedicated "integration task" in a later wave collects their outputs and writes the shared file. This maximizes parallelism.

**Pattern C — Append Protocol:** If a shared file supports independent additions (e.g., adding new route files to a directory that auto-imports), design tasks to create new files rather than modifying an existing one.

**Preference order:** Always prefer Pattern C (no shared file at all) > Pattern B (maximize parallelism) > Pattern A (simplest but least parallel).

---

## 11. Feed Upstream Results to Downstream Tasks

When a task completes and its dependents become dispatchable, the master **must include the upstream task's results** in the downstream worker's prompt:

- What the upstream task accomplished (summary)
- What files it created or modified
- Any new interfaces, types, exports, or APIs it introduced
- Any deviations from the plan that affect downstream work

This is critical because the downstream worker's prompt was written during planning — before the upstream work was done. Without upstream results, the downstream worker operates on stale assumptions.

---

## 12. Verify After Completion

After all tasks complete (or all remaining are blocked), the master should assess whether a **verification step** is warranted:

- If the swarm modified code across multiple files → dispatch a verification agent to run tests, type checking, or build validation
- If the swarm was purely additive (new files, no modifications to existing code) → verification may be optional
- If any tasks reported deviations → verification is strongly recommended

The verification agent gets a prompt listing ALL files changed across the swarm and runs the project's standard validation commands. Its job is to catch integration issues that individual workers can't see.