# Synapse — Master Agent Reference

**Who this is for:** The master orchestrator agent when running `!p_track` or any swarm command. This document maps every UI panel on the dashboard to the exact fields in `initialization.json`, `logs.json`, and worker progress files that drive it, so you know precisely what to write and when.

> **Portability:** This tracker works in any repository. All paths are relative to the Synapse directory (`{tracker_root}`). Dashboard files live under `{tracker_root}/dashboards/{dashboardId}/`. The tracker does not assume any specific project structure — it works with monorepos, single projects, or any codebase layout.

---

## How the Dashboard Works

The server (`server.js`) watches three data sources per dashboard:

- **`dashboards/{dashboardId}/initialization.json`** — Static plan data, watched via `fs.watchFile`
- **`dashboards/{dashboardId}/logs.json`** — Event log, watched via `fs.watchFile`
- **`dashboards/{dashboardId}/progress/`** — Worker progress files, watched via `fs.watch` on the directory

When any file changes, the server immediately pushes the update to every open browser tab via Server-Sent Events (SSE).

**The dashboard merges data client-side:** It reads `initialization.json` for the static plan (task metadata, agent plan entries, wave structure, chains) and merges it with individual `progress/{task_id}.json` files for all dynamic lifecycle data (agent status, started_at, completed_at, summary, stage, milestones, deviations, logs). Stats like completed count, failed count, in-progress count, and elapsed time are **all derived from progress files** — the master does not maintain counters.

**Every write you make becomes visible within ~100ms.**

Because the server re-reads the full file on every change, **atomic writes are mandatory.** Always read the full file → parse → modify in memory → stringify with 2-space indent → write the whole file back. Never write partial JSON; an invalid file silently stops all updates until corrected.

**Do not modify or remove the `_instructions` key** present in data files. It is metadata for the master agent and does not affect rendering.

---

## CRITICAL — Eager Dispatch on Every Worker Completion

> **This is the master agent's highest-priority runtime obligation.** Failing to dispatch available tasks immediately is the single most common cause of pipeline stalls. Read this section carefully.

### The Rule

**Every time a worker agent completes (success or failure), the master MUST immediately scan ALL remaining tasks — across ALL waves — and dispatch an agent for EVERY task whose dependencies are fully satisfied.** Do not wait for an entire wave to finish. Do not batch dispatches. Do not limit yourself to "the current wave." The only gate is dependency satisfaction.

A completed task may unblock tasks in wave 3, wave 5, and wave 7 simultaneously. All of them must be dispatched in the same pass.

### Waves Are Visual, Not Execution Barriers — NON-NEGOTIABLE

**The master agent MUST NOT wait for a wave to complete before dispatching tasks in subsequent waves.** Waves exist purely as a visual grouping on the dashboard for human readability. They have zero bearing on dispatch logic. The dispatch engine operates on the dependency graph — individual `depends_on` arrays — and nothing else.

**The correct behavior:** The moment ANY task completes, scan the ENTIRE `agents[]` array. If a task in wave 4 has all its `depends_on` satisfied, dispatch it NOW — even if waves 2 and 3 still have running tasks. Every second a dispatchable task sits idle is wasted wall-clock time.

**The incorrect behavior (explicitly forbidden):**
- Waiting for all wave 1 tasks to finish before starting wave 2
- Waiting for "most" of a wave to finish before looking ahead
- Batching dispatch rounds by wave number
- Treating wave boundaries as synchronization points
- Any logic that references wave IDs when deciding what to dispatch

**Think of it this way:** if you removed the `wave` field from every agent, the dispatch logic should not change at all. Waves are a UI label. Dependencies are the only dispatch constraint.

### On Failure — Automatic Recovery via Repair Tasks

When a worker returns with `status: "failed"`, the master does NOT treat the failed task as completed. **Failed tasks do not satisfy dependencies.** Any downstream task with the failed task in its `depends_on` remains blocked. However, the master MUST still run the eager dispatch scan — other dependency chains unrelated to the failure may have been freed by concurrent completions.

**The master's failure recovery procedure is:**

**Step 1 — Log the failure.** Write an `"error"` level entry to `logs.json` with the failed task's summary/error.

**Step 2 — Create a repair task in `initialization.json`.** The master adds a new agent entry to the `agents[]` array in `initialization.json`. This is the **one exception** to the "initialization.json is write-once" rule — repair tasks are appended to `agents[]` and `total_tasks` / the relevant `waves[].total` are incremented.

The repair task:
- **ID:** `"{failed_task_wave}.{next_available_index}r"` — the `r` suffix marks it as a repair task (e.g., if `2.1` failed and wave 2 has 3 tasks, the repair ID is `"2.4r"`).
- **Wave:** Same wave as the failed task.
- **Title:** `"REPAIR: {original task title}"` — prefixed so it's immediately recognizable on the dashboard.
- **Layer:** Same as the failed task (if any).
- **Directory:** Same as the failed task (if any).
- **`depends_on`:** Identical to the failed task's `depends_on` — the repair task has the same prerequisites (which are already satisfied, since the original task was dispatched).

**Step 3 — Rewire the dependency chain.** Every task in `agents[]` that had the failed task's ID in its `depends_on` must be updated to depend on the **repair task's ID** instead. This splices the repair task into the dependency chain as a drop-in replacement.

Example: If `2.1` failed and the repair task is `2.4r`:
- Task `3.1` had `depends_on: ["2.1"]` → update to `depends_on: ["2.4r"]`
- Task `3.2` had `depends_on: ["2.1", "1.2"]` → update to `depends_on: ["2.4r", "1.2"]`

**Step 4 — Update `chains[]` if applicable.** If `task.type` is `"Chains"`, find the chain containing the failed task and insert the repair task ID immediately after the failed task's ID in the chain's `tasks[]` array.

**Step 5 — Dispatch the repair worker.** Send a worker agent with instructions from `{tracker_root}/agent/instructions/failed_task.md`. The dispatch prompt must include:
- The failed task's original dispatch prompt (full context)
- The failed task's progress file contents (error details, logs, deviations)
- The failed task's summary/error description
- The repair task's ID and progress file path
- Clear instruction to follow the `failed_task.md` protocol: enter planning mode first, diagnose the root cause, plan the fix, then implement

**Step 6 — Log the repair dispatch.** Write an `"info"` level entry to `logs.json`: `"Dispatching repair task {repair_id} for failed task {failed_id} — {brief reason}"`.

**Step 7 — Run the eager dispatch scan as normal.** The repair task is now in-progress. Other unblocked tasks (unrelated to the failure) are dispatched. The pipeline continues.

> **Permission gate for major deviations:** The repair worker follows `failed_task.md`, which instructs it to diagnose and fix the issue autonomously for straightforward failures. If the repair requires a **major deviation** from the original plan (e.g., the approach is fundamentally wrong, a dependency is missing, the task scope needs to change), the repair worker reports back to the master instead of proceeding. The master then writes a `"permission"` log entry and asks the user for guidance before continuing. See `agent/instructions/failed_task.md` for the full repair worker protocol.

### The Mechanism — How to Identify Available Tasks

Use this exact procedure every time a worker returns:

**Step 1 — Build the completed set.** List all files in `dashboards/{dashboardId}/progress/` and read each one. Collect every `task_id` where `status === "completed"` into a set. This is your **completed set**.

**Step 2 — Build the in-progress set.** From the same progress files, collect every `task_id` where `status === "in_progress"` into a set. These are already dispatched — do not re-dispatch them.

**Step 3 — Find all dispatchable tasks.** Read `initialization.json` and iterate over every entry in `agents[]`. A task is **available for dispatch** if and only if ALL of these are true:

1. Its `id` is **not** in the completed set (not already done)
2. Its `id` is **not** in the in-progress set (not already running)
3. **Every** ID in its `depends_on` array **is** in the completed set (all dependencies satisfied)
4. If `depends_on` is empty or omitted, the task has no dependencies and is available immediately (these are typically wave-1 tasks and should already be dispatched at swarm start)

**Step 4 — Dispatch ALL available tasks.** For every task that passes the check in Step 3, dispatch a worker agent immediately. Do not pick one — dispatch all of them in parallel.

**Step 5 — Log each dispatch.** Write a log entry to `dashboards/{dashboardId}/logs.json` for each newly dispatched task.

### Example Scenario

```
agents[] contains:
  1.1 (depends_on: [])         ← Wave 1, already completed
  1.2 (depends_on: [])         ← Wave 1, already completed
  2.1 (depends_on: ["1.1"])    ← Wave 2, already in_progress
  2.2 (depends_on: ["1.2"])    ← Wave 2, already completed
  3.1 (depends_on: ["2.1"])    ← Wave 3, blocked (2.1 not done)
  3.2 (depends_on: ["2.2"])    ← Wave 3, available! (2.2 is done)
  4.1 (depends_on: ["3.1", "3.2"]) ← Wave 4, blocked

Worker for 2.1 just completed. New completed set: {1.1, 1.2, 2.1, 2.2}

Scan all agents:
  3.1 — depends_on: ["2.1"] → 2.1 IS in completed set → DISPATCH
  3.2 — depends_on: ["2.2"] → already in_progress (dispatched last round) → SKIP
  4.1 — depends_on: ["3.1", "3.2"] → 3.1 NOT in completed set → BLOCKED

Result: Dispatch 3.1 immediately. 4.1 stays blocked until both 3.1 and 3.2 complete.
```

### Example Scenario — Failure Recovery

```
Same agents[] as above. But this time, worker 2.1 returns with status: "failed".

Completed set: {1.1, 1.2, 2.2} (2.1 is NOT completed — it failed)

Step 1 — Log the failure to logs.json.

Step 2 — Create repair task in initialization.json:
  New agent: 2.4r (depends_on: ["1.1"], title: "REPAIR: Add auth middleware", wave: 2)
  Increment task.total_tasks: 7 → 8
  Increment waves[1].total: 3 → 4

Step 3 — Rewire dependencies:
  3.1 had depends_on: ["2.1"] → update to depends_on: ["2.4r"]

Step 4 — Dispatch repair worker 2.4r with failed_task.md protocol.

Step 5 — Run eager dispatch scan:
  3.1 — depends_on: ["2.4r"] → 2.4r NOT in completed set → BLOCKED (waiting for repair)
  3.2 — depends_on: ["2.2"] → already in_progress → SKIP
  4.1 — depends_on: ["3.1", "3.2"] → BLOCKED

  No additional tasks to dispatch (but 2.4r is already dispatched as the repair).

Later, when 2.4r completes successfully:
  Completed set: {1.1, 1.2, 2.2, 2.4r}
  3.1 — depends_on: ["2.4r"] → 2.4r IS in completed set → DISPATCH
  Pipeline continues as if 2.1 had succeeded.
```

### Why This Matters

Waves are a **visual grouping mechanism for the dashboard**, not an execution barrier. The dependency graph is the only thing that controls dispatch order. A task in wave 5 with all dependencies met is dispatchable NOW — it does not wait for waves 2, 3, and 4 to fully complete.

The master agent's job is to keep the pipeline **maximally saturated**. Every idle moment where an available task sits undispatched is wasted wall-clock time. Scan aggressively, dispatch immediately, log everything.

### Common Mistakes in Eager Dispatch

| Mistake | Consequence | Fix |
|---|---|---|
| Waiting for an entire wave to finish before checking the next wave | Pipeline stalls — tasks sit available but undispatched | Scan ALL tasks on every completion, not just the next wave |
| Only checking tasks in wave N+1 | Tasks in wave N+2 or beyond with satisfied deps are missed | Iterate the entire `agents[]` array every time |
| Forgetting to check for failed dependencies | Dispatching a task whose dependency failed, leading to cascading failures | Only count `status === "completed"` in the completed set — failed tasks do NOT satisfy dependencies |
| Not re-scanning after dispatching | A newly dispatched task might have been the last blocker for another task | One full scan per completion event is sufficient — newly dispatched tasks are in_progress, not completed |
| Treating a failed task as completed | Downstream tasks dispatched against broken/missing output — cascading failures | Failed tasks NEVER enter the completed set. Create a repair task instead. |
| Not rewiring `depends_on` after creating a repair task | Downstream tasks still point at the failed task ID, which will never complete | Replace every reference to the failed task's ID with the repair task's ID in all `depends_on` arrays |
| Skipping the planning/diagnosis phase in repair workers | Repair worker repeats the same mistake, fails again | Always dispatch repair workers with `failed_task.md` protocol — diagnosis before implementation is mandatory |

---

## Locating the Tracker

The Synapse directory contains:
```
{tracker_root}/
├── server.js                               ← Node.js server (zero dependencies)
├── dashboards/
│   └── dashboard1/
│       ├── initialization.json             ← Static plan data (written once by master)
│       ├── logs.json                       ← Event log (written by master)
│       └── progress/                       ← Worker progress files (one per agent)
│           ├── 1.1.json
│           └── 2.1.json
├── _commands/                              ← Command specs
│   └── ...
├── agent/
│   └── instructions/
│       ├── tracker_master_instructions.md  ← This file
│       ├── tracker_worker_instructions.md  ← Worker reporting protocol
│       ├── failed_task.md                  ← Repair worker protocol (for failed task recovery)
│       └── dashboard_resolution.md         ← Dashboard selection/detection
├── tasks/                                  ← XML task files and plans (created per swarm)
└── public/
    ├── index.html                          ← Dashboard HTML
    ├── styles.css                          ← Dark theme styling
    └── dashboard.js                        ← SSE client + DOM rendering
```

To start the dashboard:
```bash
node {tracker_root}/server.js
```

Dashboard URL: `http://localhost:3456` (configurable via `PORT` env var).

---

## UI Map: What Each Panel Reads

### 1. Header Bar

```
┌──────────────────────────────────────────────────────────────────┐
│ Synapse   [task.name] [directory]   3 active │
└──────────────────────────────────────────────────────────────────┘
```

| UI element | Source field | Notes |
|---|---|---|
| Task name (bold center) | `task.name` (from `initialization.json`) | Kebab-case slug. Keep short — it displays at ~0.88rem, no wrap. |
| Directory (dim pill, next to name) | `task.directory` (from `initialization.json`) | Shown as a subtle rounded badge. Displays the master task's working directory. Hidden if null/empty. |
| Active badge (purple pill, top-right) | Derived: count of progress files where `status === "in_progress"` | Computed live by the dashboard from progress files. |
| Connection dot (green/red) | Server-side SSE health | Not your concern. Goes green when the browser connects. |

**When it appears:** Header center is hidden when `task === null` in `initialization.json`. It appears as soon as you write a valid `task` object.

---

### 2. Progress Bar

```
████████████████░░░░░░░░░░░░  62%
```

| UI element | Source field | Notes |
|---|---|---|
| Fill width | Derived: `(count of progress files with status "completed") / task.total_tasks * 100` | Set `total_tasks` accurately in `initialization.json`. The dashboard counts completed progress files to compute fill — no counters to maintain. |

---

### 3. Stats Bar (6 cards below the progress bar)

```
┌────────┐ ┌───────────┐ ┌─────────────┐ ┌────────┐ ┌─────────┐ ┌─────────┐
│   23   │ │    18     │ │      4      │ │   0    │ │    1    │ │  3m 12s │
│ Total  │ │ Completed │ │ In Progress │ │ Failed │ │ Pending │ │ Elapsed │
└────────┘ └───────────┘ └─────────────┘ └────────┘ └─────────┘ └─────────┘
```

| Stat card | Source | Color |
|---|---|---|
| **Total** | `task.total_tasks` (from `initialization.json`) | White |
| **Completed** | Derived: count of progress files with `status === "completed"` | Green (`#34d399`) |
| **In Progress** | Derived: count of progress files with `status === "in_progress"` | Purple (`#9b7cf0`) |
| **Failed** | Derived: count of progress files with `status === "failed"` | Red (`#ef4444`) when > 0 |
| **Pending** | Derived: `total_tasks - completed - in_progress - failed` | Dim gray |
| **Elapsed** | Derived: ticks from earliest worker `started_at` until done; frozen when all workers have `completed_at` | Purple while running |

> **All stats are derived from progress files by the dashboard.** The master does not maintain counters — no `completed_tasks`, `failed_tasks`, or `overall_status` fields to update.

**Critical — the Elapsed timer:**

- **`started_at`** is derived from the **earliest** worker `started_at` across all progress files. The timer starts automatically when the first worker writes its progress file with a `started_at` value.
- **`completed_at`** is derived from the **latest** worker `completed_at` across all progress files. The timer freezes when every worker has a `completed_at` set.
- The master does NOT set these values — workers write them in their progress files.

**Timestamp accuracy — workers MUST capture the real wall-clock time:**

The elapsed timer is calculated from worker timestamps. Workers must run `date -u +"%Y-%m-%dT%H:%M:%SZ"` to capture accurate timestamps in their progress files. The worker instructions file (`agent/instructions/tracker_worker_instructions.md`) covers this protocol.

---

### Layout Types: Waves vs Chains

The dashboard supports two layout modes controlled by `task.type` in `initialization.json`:

**`"Waves"` (default)** — Tasks are grouped into vertical wave columns that scroll horizontally. Each column represents a wave (dependency level). Best for broad, parallel workloads where most tasks within a wave are independent. Dependency lines are drawn using BFS pathfinding through corridor gaps between cards.

**`"Chains"`** — Tasks are grouped into horizontal dependency chains that flow left to right. Each row is a chain (an end-to-end path through the dependency graph). Wave columns provide vertical alignment so tasks at the same dependency depth line up. SVG lines connect dependent tasks, and **lines light up green when the dependency task completes**.

#### When to use each type

| Type | Best for | Visual metaphor |
|---|---|---|
| **Waves** | Broad, shallow work — many independent tasks, few dependency layers | Vertical columns, horizontal scroll |
| **Chains** | Narrow, deep work — fewer parallel tracks, longer sequential pipelines | Horizontal rows with connecting lines |

#### Chains mode — required data

When `task.type` is `"Chains"`, you **must** provide:

1. **`chains[]` array** at the top level of `initialization.json` (sibling to `agents[]` and `waves[]`):
   ```json
   "chains": [
     { "id": 1, "name": "Auth Flow", "tasks": ["1.1", "2.1", "3.1"] },
     { "id": 2, "name": "User Service", "tasks": ["1.2", "2.2"] },
     { "id": 3, "name": "Config Setup", "tasks": ["1.3"] }
   ]
   ```
   - Each chain defines a horizontal row of tasks.
   - `tasks` is an ordered array of agent IDs tracing the dependency path left to right.
   - A task must appear in exactly one chain.
   - Every agent in `agents[]` should appear in exactly one chain.

2. **`agents[].depends_on`** — an array of task ID strings for each agent:
   ```json
   { "id": "2.1", "depends_on": ["1.1", "1.3"], ... }
   ```
   - This drives the SVG dependency lines between cards.
   - Empty array `[]` or omitted = no dependencies (root task).

3. **`waves[]` array** — still required in chains mode. Waves define the column structure (vertical alignment).

---

### 4. Wave Pipeline (main content area)

```
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Wave 1: Foundation   │  │ Wave 2: Services      │  │ Wave 3: Integration  │
│ [completed ✓]        │  │ [in_progress ●]       │  │ [pending]            │
│                      │  │                       │  │                      │
│ ┌ 1.1 Agent 1 ────── │  │ ┌ 2.1 Agent 4 ─────── │  │ ┌ 3.1 ─ ─ ─ ─ ─ ─ ─ │
│ └ [summary] [1m 3s]  │  │ └ [1m 22s elapsed...] │  │ └ Waiting...         │
│                      │  │                       │  │                      │
│ ┌ 1.2 Agent 2 ────── │  │ ┌ 2.2 Agent 5 ─────── │  │                      │
│ └ [summary] [0m 48s] │  │ └ [0m 55s elapsed...] │  │                      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

Each column is one entry in `waves[]`. Agent cards within a column are all entries in `agents[]` where `agent.wave === wave.id`.

#### Wave column fields (`waves[]` in `initialization.json`)

| Field | What it drives | How to set it |
|---|---|---|
| `id` | Column order (left to right) and matching key for agents | Integer starting at 1. Must match `agents[].wave`. |
| `name` | Column title: `"Wave {id}: {name}"` | Use a short, descriptive phrase: `"Foundation"`, `"Auth Layer"`, `"API Routes"`, `"Integration Tests"`. Not `"Wave 1"` — that's added automatically. |
| `total` | Used to determine when the wave is done | Set this to the count of agents in this wave before dispatch. |

> **Note:** `status` and `completed` fields are no longer stored in `initialization.json` — the dashboard derives wave status and completion count from the progress files of agents within each wave.

#### Agent card fields

Agent cards are built by merging static plan data from `agents[]` in `initialization.json` with dynamic lifecycle data from `progress/{task_id}.json`. Each agent card has three rows.

**Top row** — Task identity:
| Field | Source | What it drives |
|---|---|---|
| `id` | `initialization.json` → `agents[].id` | Dim ID label (e.g., `"1.3"`). Format: `"{wave}.{index}"`. |
| Status dot color | `progress/{id}.json` → `status` | green/purple/red/gray/lime |
| `title` | `initialization.json` → `agents[].title` | Main card title — truncated at one line. Keep it under ~40 chars or it will ellipsis. |

**Meta row** — Context labels:
| Field | Source | What it drives |
|---|---|---|
| `layer` | `initialization.json` → `agents[].layer` | Optional tinted badge. Good values: `"frontend"`, `"backend"`, `"documentation"`, `"migration"`, `"types"`, `"tests"`, `"config"`. Omit if not useful. |
| `directory` | `initialization.json` → `agents[].directory` | Optional blue-tinted badge showing the task's target directory. Omit if not useful. |
| `assigned_agent` | `progress/{id}.json` → `assigned_agent` | Agent label shown in dim text. Format: `"Agent 3"`. Written by the worker. |

**Bottom row** — varies by status (all from progress files):

| Status | What's shown | Source |
|---|---|---|
| `"pending"` | `"Waiting..."` in italic gray | Automatic — no progress file exists yet |
| `"in_progress"` | Stage badge + elapsed time + milestone message | `progress/{id}.json` → `stage`, `message`, `started_at` |
| `"completed"` | Summary text (gray) + duration badge (`"1m 3s"`) | `progress/{id}.json` → `summary` + `calcDuration(started_at, completed_at)` |
| `"failed"` | Summary text in red | `progress/{id}.json` → `summary` |

**Deviation badge** (yellow, any status):

If the worker's progress file (`progress/{id}.json`) contains a non-empty `deviations[]` array, a yellow "deviation(s)" badge appears on the card. This is driven entirely by the progress file — the master does not need to set anything for this to appear.

**Left border accent** (visible on every card):

| Status | Border color |
|---|---|
| `"completed"` | Green `#34d399` |
| `"in_progress"` | Purple `#9b7cf0` — animates (pulse on/off) |
| `"failed"` | Red `#ef4444` |
| `"pending"` | Gray |
| `"claimed"` | Lime |

> **Summary quality matters.** The summary is the most visible text on a completed card. It should be one line, action-oriented, and include key result metadata. Good: `"Created auth middleware — added rate limiting to 4 endpoints, wrote tests"`. Bad: `"Done"`.

---

### 5. Dependency Lines (Wave mode)

In Wave mode, dependency lines are drawn between cards using BFS pathfinding through an invisible pathway grid. Lines route through corridor gaps between columns and card gaps — never through cards or title headers.

**Interaction behaviors:**
- **Line hover:** Individual dependency lines highlight blue on hover with a glow effect.
- **Card hover:** Hovering a card highlights all its **needs** (incoming dependencies) in blue and all tasks it **blocks** (outgoing dependencies) in red. Unrelated lines dim to near-invisible.

These behaviors are driven entirely by the `depends_on` field on each agent in `initialization.json`. No additional data is needed — just ensure `depends_on` is accurate.

---

### 6. Log Panel (bottom drawer)

```
  ∧ Logs (47 entries)  [Complete]
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ [All] [Info] [Warn] [Error] [Deviation]                                 │
  │ 14:32:01  0.0  Orchestrator  [info ]      Task initialized: 12 tasks …  │
  │ 14:32:02  1.1  Agent 1       [info ]      Starting: Add auth middleware  │
  │ 14:33:05  1.1  Agent 1       [info ]      Completed: Add auth midlwr …  │
  │ 14:33:10  1.2  Agent 2       [deviation]  Added soft-delete — not in … │
  └─────────────────────────────────────────────────────────────────────────┘
```

The log panel reads entirely from `logs.json`. Each entry in `entries[]` becomes one row.

| Log row column | Source field | Notes |
|---|---|---|
| Timestamp | `entry.timestamp` | Displayed as `HH:MM:SS`. Use real ISO 8601 — the UI parses it with `new Date()`. |
| Task ID badge | `entry.task_id` | Use `"0.0"` for orchestrator events. Use `"{wave}.{index}"` for per-agent events. |
| Agent label | `entry.agent` | Matches `agents[].assigned_agent`. Use `"Orchestrator"` for top-level events. |
| Level badge | `entry.level` | `"info"` (purple), `"warn"` (lime), `"error"` (red), `"debug"` (gray/dim), `"permission"` (amber — triggers popup), `"deviation"` (yellow — plan divergence). |
| Message | `entry.message` | Full message text. No length limit in the UI. |

**Toggle button text:** `"Logs ({N} entries)"` — driven by `entries.length`.

**Complete badge** (green pill next to entry count): Appears when the count of progress files with terminal status (`completed` or `failed`) equals `task.total_tasks` AND no progress files show `in_progress`.

**Level filter buttons:** Users can filter by `info`, `warn`, `error`, `deviation`. Log at the right level — too much `info` buries warnings. Use `deviation` level for plan divergences reported by workers.

**Auto-scroll:** The log panel auto-scrolls to the bottom as new entries arrive, unless the user has manually scrolled up.

---

### 7. Permission Request Popup

When the master agent needs to ask the user for confirmation before proceeding, it must notify the dashboard **before** pausing to ask in the terminal.

**How it works:** Write a log entry with `level: "permission"` to `dashboards/{dashboardId}/logs.json`. The dashboard immediately shows a modal popup that says "Agent is requesting your permission" with your message, and instructs the user to respond in their terminal.

> **MANDATORY GATE — NO EXCEPTIONS:**
> Before calling `AskUserQuestion`, printing any question to the terminal, or pausing for any form of user input, you **MUST** complete these two steps in order:
> 1. Write the `"permission"` log entry to `dashboards/{dashboardId}/logs.json` (triggers the dashboard popup)
> 2. Only then ask in the terminal
>
> **Skipping step 1 means the user will never see the popup.**

**Write this to `dashboards/{dashboardId}/logs.json` before asking:**

```json
{
  "timestamp": "<live ISO timestamp>",
  "task_id": "0.0",
  "agent": "Orchestrator",
  "level": "permission",
  "message": "Need permission to delete 3 files in src/old/. Respond in terminal to confirm.",
  "task_name": "<task.name>"
}
```

**Rules:**
- **Step 1: write the log entry. Step 2: ask in the terminal. Always in that order.**
- The `message` field is displayed verbatim inside the popup. Write a clear, one-sentence description of what you need and why.
- The popup is dismissible. Each new `"permission"` entry triggers a fresh popup.
- After the user responds and you resume, write a normal `"info"` log entry confirming what was decided.

---

### 8. Empty State

```
        No active agents
   Waiting for dispatch...
```

Shown when `task === null` in `initialization.json` (or the file doesn't exist). Disappears the moment you write a valid `task` object. If the user sees this after you've started writing, the file probably has a JSON syntax error.

---

## Write Timing — When to Update What

### initialization.json write points

| Moment | What to write |
|---|---|
| **Plan finalized, before user approval** | Full `task` object (static data only — no lifecycle fields), full `agents[]` (static plan data only — id, title, wave, layer, directory, depends_on), full `waves[]` (static — id, name, total), full `chains[]` if applicable. Clear `dashboards/{dashboardId}/progress/` directory. **This is the ONLY write to initialization.json. It is write-once — the master never updates it after the planning phase.** |
| **Worker fails (repair task creation)** | **EXCEPTION to write-once rule.** Append a new repair agent to `agents[]`, increment `task.total_tasks` and the relevant `waves[].total`, rewire `depends_on` references from the failed task ID to the repair task ID. If using Chains mode, insert the repair task ID into the relevant `chains[].tasks` array. See "On Failure — Automatic Recovery via Repair Tasks" above. |

### logs.json write points

> All paths below refer to `dashboards/{dashboardId}/logs.json`.

| Moment | `task_id` | `agent` | `level` | Message pattern |
|---|---|---|---|---|
| Task initialized | `"0.0"` | `"Orchestrator"` | `"info"` | `"Task initialized: {N} tasks across {W} waves — {brief plan}"` |
| Wave dispatched | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dispatching Wave {N}: {M} agents — {wave name}"` |
| Agent starts | `"{wave}.{idx}"` | `"Agent N"` | `"info"` | `"Starting: {task title}"` |
| Agent completes | `"{wave}.{idx}"` | `"Agent N"` | `"info"` | `"Completed: {task title} — {result detail}"` |
| Agent warns | `"{wave}.{idx}"` | `"Agent N"` | `"warn"` | `"WARN: {what was unexpected}"` |
| Agent deviates | `"{wave}.{idx}"` | `"Agent N"` | `"deviation"` | `"DEVIATION: {what changed and why}"` — logged by master when worker reports deviation |
| Agent fails | `"{wave}.{idx}"` | `"Agent N"` | `"error"` | `"FAILED: {task title} — {error reason}"` |
| **Repair task created** | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dispatching repair task {repair_id} for failed task {failed_id} — {brief reason}"` |
| All complete | `"0.0"` | `"Orchestrator"` | `"info"` | `"Swarm complete: {completed}/{total} tasks succeeded in {duration}"` |
| **Permission request** | `"0.0"` | `"Orchestrator"` | `"permission"` | `"{What you need and why}"` — triggers popup |
| **Eager dispatch** (after each worker completes) | `"0.0"` | `"Orchestrator"` | `"info"` | `"Dependency scan: dispatching {N} newly available tasks — {task IDs}"` |

### Eager dispatch write points (after every worker completion)

> **This is the master's most critical runtime loop. See "CRITICAL — Eager Dispatch on Every Worker Completion" at the top of this document for the full procedure.**

| Step | Action |
|---|---|
| 1. Worker returns | Log the completion/failure to `logs.json`. |
| 2. Build completed set | List + read all `progress/*.json` files. Collect IDs where `status === "completed"`. |
| 3. Build in-progress set | From the same read, collect IDs where `status === "in_progress"`. |
| 4. Scan `initialization.json` | Read `agents[]`. For each agent: if not completed, not in-progress, and ALL `depends_on` IDs are in the completed set → mark as dispatchable. |
| 5. Dispatch all available | Launch a worker agent for **every** dispatchable task. Log each dispatch to `logs.json`. |
| 6. Resume waiting | Wait for the next worker to return, then repeat from step 1. |

### progress/{task_id}.json (written by workers, NOT by master)

Each worker writes its own progress file at `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`. The server watches this directory and broadcasts changes to the dashboard via SSE. **The master agent never writes these files** — they exist purely for worker → dashboard communication. However, **the master DOES read progress files** after every worker completion to build the completed/in-progress sets for eager dispatch (see "CRITICAL — Eager Dispatch on Every Worker Completion" above).

The progress file now contains the **full lifecycle** for each agent — status, timing, summary, assigned_agent, AND detailed logs. This expanded schema replaces the lifecycle fields that previously lived in `status.json`.

| Moment | What the worker writes |
|---|---|
| **Task starts** | `status: "in_progress"`, `started_at`, `assigned_agent`, `stage: "reading_context"` |
| **Each stage transition** | `stage` field updated (e.g., `"reading_context"` → `"planning"` → `"implementing"` → `"testing"` → `"finalizing"`) |
| **Each meaningful milestone** | New entry appended to `milestones[]`: `{ "at": "<ISO timestamp>", "msg": "<what just happened>" }` |
| **Log entries** | New entries appended to `logs[]`: `{ "at": "<ISO timestamp>", "level": "info", "msg": "<what happened>" }`. The `logs[]` array feeds the popup log box in the agent details modal. |
| **Deviation from plan** | New entry appended to `deviations[]`: `{ "at": "<ISO timestamp>", "description": "<what changed and why>" }`. Worker also reports deviation to master. |
| **Current status message** | `message` field updated with the latest milestone text |
| **Task completes** | `status: "completed"`, `completed_at`, `summary` |
| **Task fails** | `status: "failed"`, `completed_at`, `summary` (error description) |

> **Master's only deviation responsibility:** When a worker reports a deviation in its return, the master logs it to `dashboards/{dashboardId}/logs.json` at `"deviation"` level. The yellow badge on the dashboard card is driven by the progress file — no master action needed for that.

---

## Field Reference Cheat Sheet

### `task` object (`initialization.json`)

| Field | Type | Set when | Notes |
|---|---|---|---|
| `name` | string | Plan creation | Kebab-case slug. Short. |
| `type` | string | Plan creation | `"Waves"` (default) or `"Chains"`. Controls layout. |
| `directory` | string | Plan creation | Master task directory displayed in header. Optional. |
| `prompt` | string | Plan creation | Full verbatim prompt. |
| `project` | string | Plan creation | Affected directory/project name(s). |
| `project_root` | string | Plan creation | Absolute path to the target project (`{project_root}`). Identifies which project this swarm serves. |
| `created` | ISO 8601 | Plan creation — **never overwrite** | Immutable creation timestamp. |
| `total_tasks` | number | Plan creation | Total agent count across all waves. |
| `total_waves` | number | Plan creation | Wave count. |

> **Removed fields:** `started_at`, `completed_at`, `overall_status`, `completed_tasks`, `failed_tasks` — all derived by the dashboard from progress files.

### `agents[]` entry (`initialization.json`)

| Field | Type | Set when | Notes |
|---|---|---|---|
| `id` | string | Plan creation | `"{wave}.{index}"` e.g. `"2.3"` |
| `title` | string | Plan creation | Short verb phrase. ~40 chars max. |
| `wave` | number | Plan creation | Must match a `waves[].id` exactly. |
| `layer` | string | Plan creation (optional) | Category badge. |
| `directory` | string | Plan creation (optional) | Blue-tinted badge showing target directory. |
| `depends_on` | string[] | Plan creation | Array of task ID strings. Drives dependency lines. Empty array for root tasks. |

> **Removed fields:** `status`, `assigned_agent`, `started_at`, `completed_at`, `summary` — all come from worker progress files now.

### `waves[]` entry (`initialization.json`)

| Field | Type | Set when | Notes |
|---|---|---|---|
| `id` | number | Plan creation | Must match `agents[].wave`. |
| `name` | string | Plan creation | Descriptive, not just `"Wave 1"`. |
| `total` | number | Plan creation | Count of agents in this wave. |

> **Removed fields:** `status`, `completed` — derived by the dashboard from progress files of agents in each wave.

### `chains[]` entry (required when type is `"Chains"`)

| Field | Type | Set when | Notes |
|---|---|---|---|
| `id` | number | Plan creation | Integer starting at 1. Determines row order. |
| `name` | string | Plan creation | Descriptive chain name. |
| `tasks` | string[] | Plan creation | Ordered array of agent IDs left to right. Each task appears in exactly one chain. |

### `logs.json` entry

| Field | Type | Notes |
|---|---|---|
| `timestamp` | ISO 8601 | Displayed as HH:MM:SS. |
| `task_id` | string | `"0.0"` for orchestrator, `"{wave}.{idx}"` for agents. |
| `agent` | string | `"Orchestrator"` for top-level, `"Agent N"` for workers. |
| `level` | string | `"info"` \| `"warn"` \| `"error"` \| `"debug"` \| `"permission"` \| `"deviation"` |
| `message` | string | Action verb first. Include result metadata. |
| `task_name` | string | Copy from `task.name`. |

### Progress file fields (`progress/{task_id}.json`)

| Field | Type | Set when | Notes |
|---|---|---|---|
| `task_id` | string | Task starts | Matches `agents[].id` in `initialization.json`. |
| `status` | string | Updated by worker throughout | `"in_progress"` → `"completed"` \| `"failed"` |
| `started_at` | ISO 8601 | Task starts | Worker captures live timestamp. Drives per-card elapsed timer. |
| `completed_at` | ISO 8601 \| null | Task completes/fails | Worker captures live timestamp. Freezes per-card timer. |
| `summary` | string \| null | Task completes/fails | One line. Include result metadata. Shown on completed/failed cards. |
| `assigned_agent` | string | Task starts | `"Agent N"`. Shown as dim label on card. |
| `stage` | string | Updated throughout | `"reading_context"` → `"planning"` → `"implementing"` → `"testing"` → `"finalizing"` → `"completed"` \| `"failed"` |
| `message` | string | Updated throughout | Current activity description. Shown on in-progress cards. |
| `milestones` | array | Appended on milestones | `[{ "at": "<ISO>", "msg": "<text>" }]`. Shown in agent details popup. |
| `deviations` | array | Appended on deviations | `[{ "at": "<ISO>", "description": "<text>" }]`. Drives yellow deviation badge. |
| `logs` | array | Appended throughout | `[{ "at": "<ISO>", "level": "info", "msg": "<text>" }]`. Feeds the popup log box in agent details modal. |

---

## Common Mistakes

| Mistake | Effect on dashboard | Fix |
|---|---|---|
| Writing to initialization.json after planning phase | Dashboard derives stats from progress; stale data in init causes confusion | initialization.json is write-once. Never update it after the planning phase. |
| Using a guessed timestamp | Elapsed shows wildly wrong value | Always capture live via `date -u +"%Y-%m-%dT%H:%M:%SZ"` |
| `agents[].wave` doesn't match any `waves[].id` | Agent cards don't appear | Ensure every agent's `wave` value has a corresponding wave entry |
| `waves[].total` set incorrectly | Dashboard can't determine wave completion | Count agents per wave carefully |
| Partial JSON write (crash mid-write) | Dashboard freezes | Always read → modify in memory → write full file |
| Logging every file read | Log panel becomes noise | Log events (dispatch, complete, warn, error, deviation) not tool calls |
| Asking permission without writing log entry first | **Popup never appears** | Write to `dashboards/{dashboardId}/logs.json` first, terminal second. No exceptions. |
| Writing log entry and terminal question simultaneously | Popup arrives late | Write log entry, let it complete, then ask in terminal |
| Printing full terminal status tables during execution | Wastes context, slows master agent | Dashboard is the primary channel. Terminal gets one-line confirmations only. Full tables only on `!status`. |
| Not clearing `progress/` before a new swarm | Stale progress from previous swarm shows on cards | Run `rm -f {tracker_root}/dashboards/{dashboardId}/progress/*.json` during swarm init |
| Master writing progress files for workers | Defeats the purpose — master context is wasted | Workers write their own `progress/{task_id}.json`. Master never writes progress files. |
| Worker not writing progress file at all | Card shows no status, no stage, no milestone, no deviations | Worker prompt must include the progress file protocol. Verify it's in the dispatch template. |
| Worker not writing `logs[]` array | Popup log box shows empty in agent details modal | Worker must include log entries in progress file per `agent/instructions/tracker_worker_instructions.md` |
| Not logging deviations at `"deviation"` level | Deviations hidden in log panel, can't filter | When worker reports deviation, master logs at `"deviation"` level, not `"warn"` |
| **Waiting for a full wave before dispatching the next** | **Pipeline stalls — massive wall-clock waste** | **Scan ALL tasks on every worker completion. Dispatch everything with satisfied deps. See "CRITICAL — Eager Dispatch" section.** |
| Only scanning the next wave after a completion | Tasks in later waves with satisfied deps sit idle | Iterate the ENTIRE `agents[]` array, not just wave N+1 |
| Treating failed tasks as satisfying dependencies | Downstream tasks dispatched against broken output | Only `status === "completed"` counts. Failed tasks do NOT unblock dependents. |
