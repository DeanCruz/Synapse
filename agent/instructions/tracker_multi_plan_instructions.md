# Synapse — Multi-Plan Orchestrator Reference

**Who this is for:** The top-level meta-planner agent when running `!master_plan_track`. This agent does NOT manage individual swarms directly — it manages **child master agents**, each of whom owns a dashboard and runs their own `!p_track`-style swarm using `tracker_master_instructions.md`.

> **Key distinction:** `tracker_master_instructions.md` teaches a master agent how to run a single swarm on a single dashboard. **This file** teaches the meta-planner how to coordinate multiple master agents across multiple dashboards and queues simultaneously.

---

## Architecture — Three-Tier Agent Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│  META-PLANNER (you)                                          │
│  Reads: tracker_multi_plan_instructions.md (this file)       │
│  Role: Decompose into streams, assign slots, dispatch        │
│        child masters, manage queues, promote when free       │
│  Does NOT: Write code, manage individual workers, write      │
│            progress files, run eager dispatch scans           │
├──────────────────────────────────────────────────────────────┤
│  CHILD MASTER AGENTS (one per stream)                        │
│  Read: tracker_master_instructions.md                        │
│  Role: Own one dashboard, plan one swarm, dispatch workers,  │
│        run eager dispatch, update XML/logs, report back      │
│  Does NOT: Write code, manage other streams, promote queues  │
├──────────────────────────────────────────────────────────────┤
│  WORKER AGENTS (many per stream)                             │
│  Read: tracker_worker_instructions.md                        │
│  Role: Execute one task, write progress files, report back   │
│        to their child master                                 │
│  Does NOT: Coordinate with other workers or other streams    │
└──────────────────────────────────────────────────────────────┘
```

**The meta-planner's only children are child master agents.** It never dispatches worker agents directly. Each child master is a fully autonomous `!p_track` orchestrator that plans, dispatches, tracks, and reports its own swarm.

---

## Data Architecture — Dashboards, Queues, and the Stream Registry

### Dashboards

Dashboards are live-visualized slots at `{tracker_root}/dashboards/dashboard[1-5]/`. The server watches them and pushes updates via SSE. Each dashboard holds exactly one swarm at a time.

### Queues

Queues are holding slots at `{tracker_root}/queue/queue[N]/`. They have **identical file structure** to dashboards:

```
{tracker_root}/queue/{queueId}/
├── initialization.json     ← Static plan data (same schema as dashboards)
├── logs.json               ← Event log (same schema as dashboards)
└── progress/               ← Worker progress files (same schema as dashboards)
```

Queues are NOT watched by the server — they have no live visualization. They exist purely as a staging area for plans that are waiting for a dashboard slot.

### Stream Registry

The meta-planner maintains an in-memory registry of all streams:

```
{
  stream_id: "S1",
  slug: "migrate-firebase-auth",
  slot_type: "dashboard" | "queue",
  slot_id: "dashboard2" | "queue1",
  status: "planning" | "planned" | "dispatched" | "in_progress" | "completed" | "failed",
  depends_on: ["S3"],              // cross-stream deps (stream IDs, not task IDs)
  child_master_agent_id: null,     // set when dispatched
  total_tasks: 8,
  completed_tasks: 0,
  failed_tasks: 0
}
```

This registry is the meta-planner's internal state. It is NOT written to disk — it lives in working memory. After context compaction, reconstruct it by reading dashboard/queue `initialization.json` files and scanning progress directories.

---

## Slot Management — The Core Protocol

### Scanning Available Dashboards

Use the standard `selectDashboard()` algorithm from `{tracker_root}/agent/instructions/dashboard_resolution.md`:

1. Scan `dashboard1` through `dashboard5` in order.
2. For each dashboard, read `initialization.json`:
   - `task` is `null` or file doesn't exist → **available**
   - `task` is not null, no progress files → **stale claim, treat as available**
   - `task` is not null, ALL progress files terminal (`completed`/`failed`) → **finished but uncleared**. Save history, then treat as available.
   - `task` is not null, any progress file `pending`/`in_progress` → **in use, skip**
3. Collect available dashboard IDs.

### Assignment Priority

When assigning streams to slots:

1. **Available dashboards first** — fill in order of availability (`dashboard1` before `dashboard2`, etc.)
2. **Queue slots for overflow** — if more streams than available dashboards, assign `queue1`, `queue2`, etc.

Create queue directories as needed:
```bash
mkdir -p {tracker_root}/queue/{queueId}/progress
```

### Clearing Slots Before Use — Archive First

Before writing to any assigned slot, **always archive if the dashboard contains previous swarm data** (`initialization.json` has `task` not `null`):

```bash
# 1. Archive the previous swarm (MANDATORY — never skip)
TASK_NAME=$(cat {tracker_root}/dashboards/{dashboardId}/initialization.json | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
ARCHIVE_NAME="$(date -u +%Y-%m-%d)_${TASK_NAME:-unnamed}"
mkdir -p {tracker_root}/Archive/${ARCHIVE_NAME}
cp -r {tracker_root}/dashboards/{dashboardId}/* {tracker_root}/Archive/${ARCHIVE_NAME}/

# 2. Then clear
rm -f {tracker_root}/dashboards/{dashboardId}/progress/*.json

# For queues:
rm -f {tracker_root}/queue/{queueId}/progress/*.json
```

**Never clear a dashboard without archiving first.** Previous swarm data must always be preserved in `{tracker_root}/Archive/`. Also save a history summary to `{tracker_root}/history/`.

---

## Queue-to-Dashboard Promotion — CRITICAL

This is the meta-planner's most important runtime responsibility. When a dashboard slot becomes available (a child master's swarm completes), the meta-planner must immediately check the queue and promote the next eligible stream.

### When Promotion Triggers

A dashboard becomes available when:
- A child master agent returns with all tasks completed/failed
- The meta-planner confirms this by reading progress files: every file shows `completed` or `failed`

### Promotion Algorithm — `promoteFromQueue(freedDashboardId)`

**Execute this immediately every time a child master completes:**

1. **Scan queues** — Read `queue1`, `queue2`, ... in order. For each:
   - Read `initialization.json` — if `task` is `null`, skip (empty queue slot)
   - Check `status` in the stream registry — skip if already `dispatched` or `in_progress`
   - Check cross-stream dependencies — skip if any `depends_on` stream is not yet `completed`
   - **First eligible queue = next to promote**

2. **If no eligible queue found** — Log: `"No queued streams eligible for promotion — {N} remaining in queue, blocked by dependencies"`. Do nothing.

3. **If eligible queue found** — Execute promotion:

   **Step A — Archive and save history from the freed dashboard (MANDATORY):**
   If the freed dashboard had a completed swarm, **archive it first** (copy to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`), then save its history summary per standard protocol. Never clear without archiving.

   **Step B — Copy queue files to dashboard:**
   ```bash
   cp {tracker_root}/queue/{queueId}/initialization.json {tracker_root}/dashboards/{freedDashboardId}/initialization.json
   cp {tracker_root}/queue/{queueId}/logs.json {tracker_root}/dashboards/{freedDashboardId}/logs.json
   mkdir -p {tracker_root}/dashboards/{freedDashboardId}/progress
   rm -f {tracker_root}/dashboards/{freedDashboardId}/progress/*.json
   ```

   **Step C — Log the promotion** to the dashboard's `logs.json`:
   ```json
   {
     "timestamp": "{ISO 8601 — live}",
     "task_id": "0.0",
     "agent": "Orchestrator",
     "level": "info",
     "message": "Promoted from {queueId} to {freedDashboardId} — ready for dispatch",
     "task_name": "{stream_slug}"
   }
   ```

   **Step D — Update the stream registry:**
   Change the stream's `slot_type` to `"dashboard"`, `slot_id` to `{freedDashboardId}`, `status` to `"planned"`.

   **Step E — Clear the queue slot:**
   Write `{"task": null, "agents": [], "waves": [], "chains": [], "history": []}` to `{tracker_root}/queue/{queueId}/initialization.json` and `{"entries": []}` to `{tracker_root}/queue/{queueId}/logs.json`.

   **Step F — Dispatch a child master for the promoted stream** (see "Dispatching Child Master Agents" below).

### Promotion Priority

When multiple queued streams are eligible simultaneously:
1. **Streams with satisfied cross-stream dependencies** before streams still blocked
2. **Lower queue number first** (`queue1` before `queue2`) as a tiebreaker
3. **Streams with more downstream dependents** get priority (unblocking more work)

### Multiple Dashboards Free Simultaneously

If two child masters complete at the same time, run the promotion algorithm for each freed dashboard. Multiple queued streams may promote in the same cycle.

---

## Dispatching Child Master Agents

### When to Dispatch

Dispatch a child master agent when:
- A stream's plan is approved by the user AND it is assigned to a dashboard (not a queue slot)
- A queued stream has just been promoted to a dashboard

**Never dispatch a child master agent for a queue slot.** Queue slots have no live visualization — the child master would write progress files that nobody can see. Wait for promotion.

### Child Master Prompt Template

Each child master receives a fully self-contained prompt. The meta-planner embeds all project context so the child master can focus on execution.

```
You are a CHILD MASTER AGENT in the "{meta-task}" multi-plan, managing stream {stream_id}: "{stream_slug}".

You own dashboard {dashboardId}. You are a fully autonomous !p_track orchestrator.

═══════════════════════════════════════
YOUR DASHBOARD: {dashboardId}
═══════════════════════════════════════

Your plan has already been created and written to the dashboard. The dashboard
at http://localhost:3456 already shows your tasks as pending cards.

YOUR FILES:
- XML:              {tracker_root}/tasks/{MM_DD_YY}/parallel_{stream_slug}.xml
- Plan:             {tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{stream_slug}.md
- Dashboard Init:   {tracker_root}/dashboards/{dashboardId}/initialization.json
- Dashboard Logs:   {tracker_root}/dashboards/{dashboardId}/logs.json
- Progress Dir:     {tracker_root}/dashboards/{dashboardId}/progress/

═══════════════════════════════════════
REQUIRED READING — DO THIS FIRST
═══════════════════════════════════════

Before dispatching ANY worker agents, read these two files:

1. {tracker_root}/agent/instructions/tracker_master_instructions.md
   This is your primary reference. It maps every dashboard UI panel to the exact
   fields that drive it. It documents eager dispatch, failure recovery, write timing,
   and every common mistake. Follow it exactly.

2. {tracker_root}/tasks/{MM_DD_YY}/parallel_{stream_slug}.xml
   This is YOUR master XML — the single source of truth for your swarm's tasks,
   dependencies, and status.

═══════════════════════════════════════
STREAM: {stream_slug}
═══════════════════════════════════════

SCOPE:
{Detailed description of what this stream covers}

AFFECTED DIRECTORIES:
{List of directories}

CONVENTIONS:
{Relevant sections extracted from CLAUDE.md files by the meta-planner.
Quoted directly. Workers need these embedded in their prompts.}

REFERENCE CODE:
{Working examples from the codebase. Include complete patterns workers
will need to follow.}

CROSS-STREAM CONTEXT:
{If this stream depends on completed upstream streams, include:
- What each upstream stream produced (summary)
- Files changed by upstream streams
- New interfaces/exports introduced
- Deviations from the plan
If independent, state "This stream is fully independent."}

═══════════════════════════════════════
YOUR JOB
═══════════════════════════════════════

1. Read tracker_master_instructions.md (NON-NEGOTIABLE)
2. Read your master XML
3. Begin execution — dispatch all Wave 1 tasks (and any higher-wave tasks
   with already-satisfied dependencies) simultaneously
4. Follow the standard !p_track Phase 2 protocol EXACTLY:
   - Use the worker prompt template from !p_track Step 14
   - Each worker must be told to read:
     {tracker_root}/agent/instructions/tracker_worker_instructions.md
   - Each worker writes its own progress file to:
     {tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
   - Process completions with eager dispatch scanning (CRITICAL)
   - Update the XML and logs.json on every event
   - Handle failures per the repair task protocol
5. When all tasks are complete, return your final report

═══════════════════════════════════════
EXECUTION RULES
═══════════════════════════════════════

- You manage ONLY your dashboard ({dashboardId}). Do not touch other dashboards.
- You dispatch ONLY worker agents. Do not dispatch other master agents.
- You do NOT write application code. You plan, dispatch, track, and report.
- Dashboard is the primary reporting channel. Terminal output is one-line
  confirmations only.
- Atomic writes only. Read → modify in memory → write full file.
- Live timestamps only. Run: date -u +"%Y-%m-%dT%H:%M:%SZ"
- Dispatch the INSTANT dependencies are met — not when waves complete.
  Waves are visual grouping only.

═══════════════════════════════════════
RETURN FORMAT
═══════════════════════════════════════

When your swarm is complete, return:

STATUS: completed | completed_with_errors | failed
STREAM: {stream_id} — {stream_slug}
DASHBOARD: {dashboardId}
COMPLETED: {N}/{total} tasks
FAILED: {N} tasks
DURATION: {elapsed time}
SUMMARY: {2-3 sentences describing what was accomplished}
FILES CHANGED:
  - {path} ({created | modified | deleted}) — Task {id}
DEVIATIONS: (omit if none)
  - Task {id}: {what deviated and why}
WARNINGS: (omit if none)
  - Task {id}: {warning}
ERRORS: (omit if none)
  - Task {id}: {error description}
VERIFICATION: (omit if not run)
  - Tests: {pass | fail | no test suite}
  - Types: {pass | fail | N/A}
  - Build: {pass | fail | N/A}
  - Issues: {list or "None"}
```

### Prompt Completeness Checklist

Before dispatching each child master, verify:

| Required Element | Check |
|---|---|
| **Dashboard assignment** | Correct `dashboardId` — must be a live dashboard, never a queue |
| **XML and plan paths** | Correct date and slug in file paths |
| **Instruction file reference** | `tracker_master_instructions.md` path included |
| **Worker instruction reference** | `tracker_worker_instructions.md` path included for embedding in worker prompts |
| **CLAUDE.md conventions** | Relevant sections quoted for embedding in worker prompts |
| **Reference code** | Patterns workers will need |
| **Upstream results** | For streams with cross-stream dependencies, include what predecessors produced |
| **Scope description** | Detailed enough that the child master understands what the swarm accomplishes |

---

## Processing Child Master Returns

When a child master agent returns:

### A. Parse the return

Extract `STATUS`, `STREAM`, `DASHBOARD`, `COMPLETED`, `FAILED`, `SUMMARY`, `FILES CHANGED`, `DEVIATIONS`, `WARNINGS`, `ERRORS`, `VERIFICATION`.

### B. Update the stream registry

Set the stream's `status` to `completed` or `failed`, update task counts.

### C. Terminal confirmation

Print one line:
- Success: `Stream {stream_id} completed: {slug} — {completed}/{total} tasks on {dashboardId}`
- Partial: `Stream {stream_id} completed with errors: {slug} — {completed}/{total} tasks, {failed} failed on {dashboardId}`
- Failure: `Stream {stream_id} FAILED: {slug} — {error}`

### D. Cache the result for downstream streams

Store:
- Stream ID, slug, status
- Summary
- All files changed across all tasks
- New interfaces, types, exports introduced
- Any deviations that affect downstream streams

This cache feeds the `CROSS-STREAM CONTEXT` section of downstream child master prompts.

### E. Run the promotion scan — CRITICAL

**Immediately after processing every child master return**, run the promotion algorithm:

1. The returned child master's dashboard is now available (or may be if all tasks are terminal).
2. Confirm the dashboard is truly available by reading progress files.
3. Run `promoteFromQueue(freedDashboardId)`.
4. If a stream was promoted, dispatch its child master.

### F. Check for newly unblocked streams across ALL queues

A completed stream may satisfy cross-stream dependencies for queued streams beyond just the first in line. Scan the entire queue:
- For each queued stream where `depends_on` is now fully satisfied AND a dashboard is available → promote and dispatch.
- If multiple streams become eligible but only one dashboard is free, promote by priority order (see "Promotion Priority" above). The remaining unblocked streams stay queued until more dashboards free up.

---

## Cross-Stream Dependencies

### How They Work

Cross-stream dependencies are between **streams** (identified by stream ID like `S1`, `S3`), not between individual tasks. A stream with `depends_on: ["S1", "S3"]` cannot be dispatched until both S1 and S3 have `status: "completed"` in the stream registry.

### Planning vs. Execution

- **Planning is always parallel.** All streams get planned simultaneously regardless of dependencies. Cross-stream dependencies only block execution dispatch.
- **A queued stream with unmet dependencies stays queued** even if a dashboard is available. It cannot promote until its dependencies are met AND a dashboard is free.

### Injecting Upstream Results

When dispatching a child master for a stream that depends on completed upstream streams, the meta-planner includes the upstream results in the `CROSS-STREAM CONTEXT` section of the child master's prompt:

```
CROSS-STREAM CONTEXT:
This stream depends on {N} completed upstream streams:

Stream S1 ({slug}): {summary}
  Files changed:
    - {path} ({action}) — Task {id}
  New exports/interfaces:
    - {description}
  Deviations:
    - {if any}

Stream S3 ({slug}): {summary}
  ...
```

The child master then propagates relevant upstream context into its own worker prompts.

---

## Failure Handling at the Stream Level

### Child Master Failure

If a child master agent itself fails (not a worker within it, but the master agent):

1. **Log the failure** — note the stream, dashboard, and error.
2. **Read the dashboard state** — check progress files to see how far the swarm got.
3. **Assess recovery options:**
   - If most tasks completed, dispatch a new child master to finish the remaining tasks.
   - If the swarm barely started, dispatch a fresh child master with the same prompt.
   - If the failure is systemic (bad plan, wrong approach), report to the user.
4. **Do NOT auto-promote a queue item to the failed dashboard.** The dashboard may have partially-completed work that a recovery master needs.

### Stream-Level Circuit Breaker

If 2+ child masters fail (not their workers — the masters themselves), pause all dispatch and assess with the user. This indicates a systemic issue (bad context, impossible tasks, tool failures).

### Worker-Level Failures

Worker failures within a stream are handled entirely by the child master using the repair task protocol from `tracker_master_instructions.md`. The meta-planner does not intervene — it only sees the final stream result.

---

## Write Timing Summary

### What the Meta-Planner Writes

| Moment | File | What |
|---|---|---|
| **Planning phase** | `dashboards/{id}/initialization.json` | Full plan (via planner agents) — write-once |
| **Planning phase** | `dashboards/{id}/logs.json` | Initialization entry |
| **Planning phase** | `queue/{id}/initialization.json` | Full plan for overflow streams — write-once |
| **Planning phase** | `queue/{id}/logs.json` | Initialization entry |
| **On promotion** | `dashboards/{id}/initialization.json` | Copy from queue |
| **On promotion** | `dashboards/{id}/logs.json` | Copy from queue + promotion entry |
| **On promotion** | `queue/{id}/*` | Clear the queue slot |

### What the Meta-Planner Does NOT Write

- **Progress files** — Workers write these. The meta-planner never touches `progress/*.json`.
- **Dashboard updates during execution** — Child masters handle their own `logs.json` and XML updates.
- **Application code** — The meta-planner never writes code. Ever.

### What Child Masters Write

Child masters follow `tracker_master_instructions.md` exactly:
- `dashboards/{id}/logs.json` — append on every dispatch, completion, failure, deviation
- `tasks/{date}/parallel_{slug}.xml` — update on every completion
- They also instruct workers to write `dashboards/{id}/progress/{task_id}.json`

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Dispatching a child master for a queue slot | Workers write progress files to `queue/` which the server doesn't watch — no live dashboard | Never dispatch child masters for queue slots. Wait for promotion to a dashboard. |
| Not running promotion scan after every child master return | Queue items sit idle even when dashboards are free | Run `promoteFromQueue()` every time a child master returns — no exceptions. |
| Dispatching workers directly instead of child masters | Meta-planner drowns in worker management, can't track multiple streams | Dispatch only child master agents. Each manages its own workers. |
| Not including `tracker_master_instructions.md` in child master prompts | Child master doesn't know dashboard protocols, writes bad data | Always include the read instruction. It's the child master's primary reference. |
| Not including `tracker_worker_instructions.md` path in child master prompts | Child master can't tell workers how to report progress | Include the path so the child master embeds it in worker prompts. |
| Promoting a queue item while the dashboard still has active workers | Overwrites in-progress swarm data | Always confirm the dashboard is truly available (all progress files terminal) before promoting. |
| Not injecting upstream results for cross-stream dependencies | Child master's workers don't know what upstream streams produced | Include full upstream results in the child master's CROSS-STREAM CONTEXT section. |
| Not clearing queue slot after promotion | Queue slot still looks occupied, can't be reused | Write null task to queue's `initialization.json` after copying to dashboard. |
| Trying to manage worker-level failures from the meta-planner | Wastes context, duplicates work the child master already handles | Worker failures are the child master's problem. The meta-planner only sees stream-level results. |
| Forgetting to save history before overwriting a freed dashboard | Previous swarm's results are lost | Always save history per `dashboard_resolution.md` protocol before promoting into a freed slot. |
| Dispatching a child master for a stream with unmet cross-stream deps | Child master starts work that depends on output that doesn't exist yet | Check `depends_on` in the stream registry before dispatch. All referenced streams must be `completed`. |

---

## Reconstruction After Context Compaction

If the meta-planner's context is compacted and the stream registry is lost:

1. **Scan all dashboards** (`dashboard1`–`dashboard5`):
   - Read `initialization.json` for task name, total tasks
   - Read all `progress/*.json` files to derive status
   - Reconstruct each dashboard's stream entry in the registry

2. **Scan all queue directories** (`queue1`, `queue2`, ...):
   - Read `initialization.json` — if `task` is not null, it's an active queue entry
   - Reconstruct each queue stream entry in the registry

3. **Rebuild cross-stream dependency map** from conversation history or the original plan.

4. **Resume operations** — check for promotable queues, check for completable streams.

---

## Timestamp Protocol

Every timestamp written to any file must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Use the output directly. Never guess, estimate, or hardcode timestamps.
