# Queue System

When all 5 dashboard slots are occupied by active swarms, Synapse uses an **overflow queue** to hold additional swarm plans until a dashboard becomes available. The queue ensures no work is lost even when the system is at full capacity.

---

## Overview

The queue is a holding area at `{tracker_root}/queue/` where swarm plans wait for an open dashboard slot. Each queue item mirrors the structure of a dashboard directory — it has its own `initialization.json`, `logs.json`, and `progress/` directory.

```
{tracker_root}/queue/
├── queue1/
│   ├── initialization.json
│   ├── logs.json
│   └── progress/
├── queue2/
│   └── ...
└── queue3/
    └── ...
```

Queue items are created dynamically as needed. Unlike dashboards (which have fixed slots 1-5), the queue can hold any number of items.

---

## How Items Enter the Queue

When the master agent runs `!p_track` and no dashboard slot is available (all 5 are in use with active swarms), the swarm plan is written to the queue instead of a dashboard:

1. Master completes planning and has a full `initialization.json` ready.
2. Master attempts dashboard selection via `selectDashboard()`.
3. All 5 dashboards are in use (at least one agent per dashboard is `pending` or `in_progress`).
4. Instead of asking the user to pick a dashboard to overwrite, the plan is written to `{tracker_root}/queue/queue{N}/`.
5. The user is notified that the swarm is queued and will be promoted when a slot opens.

---

## Queue Item Structure

Each queue item has the same file structure as a dashboard:

| File | Contents |
|---|---|
| `initialization.json` | Full static plan (task, agents, waves, chains) |
| `logs.json` | Event log (typically just an initialization entry) |
| `progress/` | Empty directory (workers have not started yet) |

The `initialization.json` in a queue item is identical to what would have been written to a dashboard. This means promotion to a dashboard is a simple directory copy.

---

## Queue Operations

### Listing Queue Items

The `QueueService.listQueue()` function scans the `queue/` directory for subdirectories that contain an `initialization.json` file. It returns a sorted array of queue IDs:

```javascript
listQueue()  // Returns: ['queue1', 'queue2', 'queue3']
```

### Reading Queue Data

Queue items support the same read operations as dashboards:

| Function | Purpose |
|---|---|
| `readQueueInit(id)` | Read a queue item's `initialization.json` |
| `readQueueProgress(id)` | Read all progress files (keyed by `task_id`) |
| `readQueueLogs(id)` | Read a queue item's `logs.json` |

All three have async variants (`readQueueInitAsync`, `readQueueProgressAsync`, `readQueueLogsAsync`).

### Queue Summaries

The `listQueueSummaries()` function returns metadata for all queue items, suitable for rendering in the UI:

```javascript
listQueueSummaries()
// Returns:
[
  {
    id: 'queue1',
    task: {
      name: 'Implement search feature',
      type: 'Waves',
      directory: '/Users/dean/repos/my-app',
      total_tasks: 8,
      created: '2026-03-22T10:00:00Z'
    },
    agentCount: 8,
    status: 'pending'
  },
  // ...
]
```

The `status` field is derived from progress files:
- `pending` — no progress files, or all agents still pending
- `in_progress` — at least one agent has started
- `completed` — all agents finished successfully
- `error` — all agents finished, at least one failed

---

## Promotion: Queue to Dashboard

When a dashboard slot becomes available (either cleared by `!reset`, auto-cleared by `selectDashboard()`, or completed), the next queue item can be promoted.

### Promotion Process

1. **Detect available dashboard** — A slot has been freed.
2. **Check the queue** — Call `listQueue()` to see if any items are waiting.
3. **Archive the dashboard** (if it has previous data) — Copy to `Archive/` before clearing.
4. **Copy queue item to dashboard** — Move `initialization.json`, `logs.json`, and `progress/` from the queue slot to the dashboard slot.
5. **Remove the queue item** — Delete the queue directory after successful copy.
6. **Begin dispatch** — The master can now dispatch workers for the promoted swarm.

### Manual Promotion

Users can also manually promote a queue item using dashboard management commands:

```
!reset dashboard2          # Clear dashboard 2
# Queue item is now eligible for promotion to dashboard 2
```

---

## Queue in the Dashboard UI

The dashboard sidebar shows queue items below the 5 dashboard slots. Each queue entry displays:

- **Queue position** (queue1, queue2, ...)
- **Task name** from the plan
- **Agent count** (number of tasks in the plan)
- **Status** (typically "pending" for queued items)

Users can click a queue entry to view the plan details without promoting it. The queue provides visibility into what is waiting without disrupting active swarms.

---

## Queue vs. Dashboard Comparison

| Aspect | Dashboard Slot | Queue Item |
|---|---|---|
| Count | Fixed at 5 | Dynamic (unlimited) |
| Workers can execute | Yes | No (waiting for promotion) |
| Has live progress | Yes (via `fs.watch`) | No (no workers running) |
| Appears in sidebar | Primary section | Queue section (below dashboards) |
| Data structure | `initialization.json` + `logs.json` + `progress/` | Same structure |
| Promotion required | No | Yes (must be moved to a dashboard slot) |

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/server/services/QueueService.js` | All queue operations: list, read, summarize |
| `src/server/utils/constants.js` | `QUEUE_DIR` path constant |
