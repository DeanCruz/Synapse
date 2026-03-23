# Dashboard UI Map — Panel-to-Field Reference

This document maps every dashboard panel to the exact fields in `initialization.json`, `logs.json`, and worker progress files that drive it. Use this as the authoritative reference for knowing precisely what to write and when, so the dashboard renders correctly.

---

## 1. Header Bar

```
+------------------------------------------------------------------+
| Synapse   [task.name] [directory]   3 active                     |
+------------------------------------------------------------------+
```

| UI element | Source field | Notes |
|---|---|---|
| Task name (bold center) | `task.name` (from `initialization.json`) | Kebab-case slug. Keep short — it displays at ~0.88rem, no wrap. |
| Directory (dim pill, next to name) | `task.directory` (from `initialization.json`) | Shown as a subtle rounded badge. Displays the master task's working directory. Hidden if null/empty. |
| Active badge (purple pill, top-right) | Derived: count of progress files where `status === "in_progress"` | Computed live by the dashboard from progress files. |
| Connection dot (green/red) | Server-side SSE health | Not your concern. Goes green when the browser connects. |

**When it appears:** Header center is hidden when `task === null` in `initialization.json`. It appears as soon as you write a valid `task` object.

---

## 2. Progress Bar

```
++++++++++++++++________________  62%
```

| UI element | Source field | Notes |
|---|---|---|
| Fill width | Derived: `(count of progress files with status "completed") / task.total_tasks * 100` | Set `total_tasks` accurately in `initialization.json`. The dashboard counts completed progress files to compute fill — no counters to maintain. |

---

## 3. Stats Bar (6 cards)

```
+--------+ +-----------+ +-------------+ +--------+ +---------+ +---------+
|   23   | |    18     | |      4      | |   0    | |    1    | |  3m 12s |
| Total  | | Completed | | In Progress | | Failed | | Pending | | Elapsed |
+--------+ +-----------+ +-------------+ +--------+ +---------+ +---------+
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

## 4. Layout Types: Waves vs Chains

The dashboard supports two layout modes controlled by `task.type` in `initialization.json`:

**`"Waves"` (default)** — Tasks are grouped into vertical wave columns that scroll horizontally. Each column represents a wave (dependency level). Best for broad, parallel workloads where most tasks within a wave are independent. Dependency lines are drawn using BFS pathfinding through corridor gaps between cards.

**`"Chains"`** — Tasks are grouped into horizontal dependency chains that flow left to right. Each row is a chain (an end-to-end path through the dependency graph). Wave columns provide vertical alignment so tasks at the same dependency depth line up. SVG lines connect dependent tasks, and **lines light up green when the dependency task completes**.

### When to use each type

| Type | Best for | Visual metaphor |
|---|---|---|
| **Waves** | Broad, shallow work — many independent tasks, few dependency layers | Vertical columns, horizontal scroll |
| **Chains** | Narrow, deep work — fewer parallel tracks, longer sequential pipelines | Horizontal rows with connecting lines |

### Chains mode — required data

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

## 5. Wave Pipeline (main content area)

```
+----------------------+  +----------------------+  +----------------------+
| Wave 1: Foundation   |  | Wave 2: Services     |  | Wave 3: Integration  |
| [completed]          |  | [in_progress]        |  | [pending]            |
|                      |  |                      |  |                      |
| +- 1.1 Agent 1 ---+  |  | +- 2.1 Agent 4 ---+  |  | +- 3.1 - - - - - -+  |
| +- [summary] [1m] +  |  | +- [1m 22s ...]   +  |  | +- Waiting...      +  |
|                      |  |                      |  |                      |
| +- 1.2 Agent 2 ---+  |  | +- 2.2 Agent 5 ---+  |  |                      |
| +- [summary] [48s]+  |  | +- [0m 55s ...]   +  |  |                      |
+----------------------+  +----------------------+  +----------------------+
```

Each column is one entry in `waves[]`. Agent cards within a column are all entries in `agents[]` where `agent.wave === wave.id`.

### Wave Column Fields (`waves[]` in `initialization.json`)

| Field | What it drives | How to set it |
|---|---|---|
| `id` | Column order (left to right) and matching key for agents | Integer starting at 1. Must match `agents[].wave`. |
| `name` | Column title: `"Wave {id}: {name}"` | Use a short, descriptive phrase: `"Foundation"`, `"Auth Layer"`, `"API Routes"`, `"Integration Tests"`. Not `"Wave 1"` — that's added automatically. |
| `total` | Used to determine when the wave is done | Set this to the count of agents in this wave before dispatch. |

> **Note:** `status` and `completed` fields are no longer stored in `initialization.json` — the dashboard derives wave status and completion count from the progress files of agents within each wave.

### Agent Card Fields

Agent cards are built by merging static plan data from `agents[]` in `initialization.json` with dynamic lifecycle data from `progress/{task_id}.json`. Each agent card has three rows.

**Top row** — Task identity:

| Field | Source | What it drives |
|---|---|---|
| `id` | `initialization.json` -> `agents[].id` | Dim ID label (e.g., `"1.3"`). Format: `"{wave}.{index}"`. |
| Status dot color | `progress/{id}.json` -> `status` | green/purple/red/gray/lime |
| `title` | `initialization.json` -> `agents[].title` | Main card title — truncated at one line. Keep it under ~40 chars or it will ellipsis. |

**Meta row** — Context labels:

| Field | Source | What it drives |
|---|---|---|
| `layer` | `initialization.json` -> `agents[].layer` | Optional tinted badge. Good values: `"frontend"`, `"backend"`, `"documentation"`, `"migration"`, `"types"`, `"tests"`, `"config"`. Omit if not useful. |
| `directory` | `initialization.json` -> `agents[].directory` | Optional blue-tinted badge showing the task's target directory. Omit if not useful. |
| `assigned_agent` | `progress/{id}.json` -> `assigned_agent` | Agent label shown in dim text. Format: `"Agent 3"`. Written by the worker. |

**Bottom row** — varies by status (all from progress files):

| Status | What's shown | Source |
|---|---|---|
| `"pending"` | `"Waiting..."` in italic gray | Automatic — no progress file exists yet |
| `"in_progress"` | Stage badge + elapsed time + milestone message | `progress/{id}.json` -> `stage`, `message`, `started_at` |
| `"completed"` | Summary text (gray) + duration badge (`"1m 3s"`) | `progress/{id}.json` -> `summary` + `calcDuration(started_at, completed_at)` |
| `"failed"` | Summary text in red | `progress/{id}.json` -> `summary` |

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

## 6. Dependency Lines (Wave mode)

In Wave mode, dependency lines are drawn between cards using BFS pathfinding through an invisible pathway grid. Lines route through corridor gaps between columns and card gaps — never through cards or title headers.

**Interaction behaviors:**

- **Line hover:** Individual dependency lines highlight blue on hover with a glow effect.
- **Card hover:** Hovering a card highlights all its **needs** (incoming dependencies) in blue and all tasks it **blocks** (outgoing dependencies) in red. Unrelated lines dim to near-invisible.

These behaviors are driven entirely by the `depends_on` field on each agent in `initialization.json`. No additional data is needed — just ensure `depends_on` is accurate.

---

## 7. Log Panel (bottom drawer)

```
  ^ Logs (47 entries)  [Complete]
  +-----------------------------------------------------------------------+
  | [All] [Info] [Warn] [Error] [Deviation]                               |
  | 14:32:01  0.0  Orchestrator  [info ]      Task initialized: 12 tasks  |
  | 14:32:02  1.1  Agent 1       [info ]      Starting: Add auth midlwr   |
  | 14:33:05  1.1  Agent 1       [info ]      Completed: Add auth midlwr  |
  | 14:33:10  1.2  Agent 2       [deviation]  Added soft-delete — not in  |
  +-----------------------------------------------------------------------+
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

## 8. Permission Request Popup

When the master agent needs to ask the user for confirmation before proceeding, it must notify the dashboard **before** pausing to ask in the terminal.

**How it works:** Write a log entry with `level: "permission"` to `dashboards/{dashboardId}/logs.json`. The dashboard immediately shows a modal popup that says "Agent is requesting your permission" with your message, and instructs the user to respond in their terminal.

> **MANDATORY GATE — NO EXCEPTIONS:**
> Before calling `AskUserQuestion`, printing any question to the terminal, or pausing for any form of user input, you **MUST** complete these two steps in order:
> 1. Write the `"permission"` log entry to `dashboards/{dashboardId}/logs.json` (triggers the dashboard popup)
> 2. Only then ask in the terminal
>
> **Skipping step 1 means the user will never see the popup.**

**Permission log entry format:**

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

## 9. Empty State

```
        No active agents
   Waiting for dispatch...
```

Shown when `task === null` in `initialization.json` (or the file doesn't exist). Disappears the moment you write a valid `task` object. If the user sees this after you've started writing, the file probably has a JSON syntax error.

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
| `prompt_size` | object \| null | Optional | Worker-reported size of the dispatch prompt. Contains `total_chars` and `estimated_tokens`. |

---

## Common Mistakes

| Mistake | Effect on dashboard | Fix |
|---|---|---|
| Writing to initialization.json after planning phase | Dashboard derives stats from progress; stale data in init causes confusion | initialization.json is write-once. Never update it after the planning phase. |
| Using a guessed timestamp | Elapsed shows wildly wrong value | Always capture live via `date -u +"%Y-%m-%dT%H:%M:%SZ"` |
| `agents[].wave` doesn't match any `waves[].id` | Agent cards don't appear | Ensure every agent's `wave` value has a corresponding wave entry |
| `waves[].total` set incorrectly | Dashboard can't determine wave completion | Count agents per wave carefully |
| Partial JSON write (crash mid-write) | Dashboard freezes | Always read -> modify in memory -> write full file |
| Logging every file read | Log panel becomes noise | Log events (dispatch, complete, warn, error, deviation) not tool calls |
| Asking permission without writing log entry first | **Popup never appears** | Write to `dashboards/{dashboardId}/logs.json` first, terminal second. No exceptions. |
| Not clearing `progress/` before a new swarm | Stale progress from previous swarm shows on cards | **Archive first**, then clear progress files. Never clear without archiving. |
| Master writing progress files for workers | Defeats the purpose — master context is wasted | Workers write their own `progress/{task_id}.json`. Master never writes progress files. |
| Worker not writing progress file at all | Card shows no status, no stage, no milestone, no deviations | Worker prompt must include the progress file protocol. |
| Worker not writing `logs[]` array | Popup log box shows empty in agent details modal | Worker must include log entries in progress file. |
| Not logging deviations at `"deviation"` level | Deviations hidden in log panel, can't filter | When worker reports deviation, master logs at `"deviation"` level, not `"warn"` |
| Writing log entry and terminal question simultaneously | Popup arrives late | Write log entry, let it complete, then ask in terminal |
| Printing full terminal status tables during execution | Wastes context, slows master agent | Dashboard is the primary channel. Terminal gets one-line confirmations only. Full tables only on `!status`. |
| **Waiting for a full wave before dispatching the next** | **Pipeline stalls — massive wall-clock waste** | **Scan ALL tasks on every worker completion. Dispatch everything with satisfied deps.** |
| Only scanning the next wave after a completion | Tasks in later waves with satisfied deps sit idle | Iterate the ENTIRE `agents[]` array, not just wave N+1 |
| Treating failed tasks as satisfying dependencies | Downstream tasks dispatched against broken output | Only `status === "completed"` counts. Failed tasks do NOT unblock dependents. |
| **Master implementing instead of dispatching** | **Entire swarm system bypassed. Dashboard empty. User blind. The worst possible failure.** | **NEVER write application code as master. Dispatch ALL work to worker agents.** |
| Master skipping the dashboard | No task cards, no progress, no visibility | Always write `initialization.json`, use `logs.json`, dispatch workers who write progress files |
| Not reading command/instruction files | Master forgets steps, skips dashboard, misses protocols | Read `_commands/Synapse/p_track.md` and `agent/instructions/tracker_master_instructions.md` in full every invocation |
| Creating a repair task for a failed repair task | Infinite repair loop — each repair fails and spawns another | Check if the failed task ID ends with `r`. If so, escalate to permanent failure — do NOT create another repair task |
