# Worker Agent — Progress Reporting Instructions

**Who this is for:** Worker agents dispatched by the master agent during a `!p_track` swarm. This document is your complete reference for how to report your progress to the live dashboard.

**This is NON-NEGOTIABLE.** Every worker agent MUST follow these instructions exactly. Failure to report progress means the dashboard shows no live updates for your task — the user has no visibility into what you're doing.

**Key location distinction:** Your dispatch prompt provides two critical paths:
- **`{tracker_root}`** — The Synapse repository. This is where you write progress files (`{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`).
- **`{project_root}`** — The target project. This is where you do your actual code work (read source files, modify code, create files).

These are different locations. Do NOT confuse them. Your code work happens in `{project_root}`. Your progress reporting goes to `{tracker_root}`.

---

## Your Progress File

You own exactly one file:

```
{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

The `{tracker_root}`, `{dashboardId}`, and `{task_id}` values are provided in your dispatch prompt. Write to this exact path.

You write the **full file** on every update (overwrite, not append). You are the sole writer — no read-modify-write needed, just write the entire JSON object each time.

The dashboard server watches this directory and broadcasts changes to the browser in real-time via SSE. Every write you make becomes visible within ~50ms.

---

## Progress File Schema

```json
{
  "task_id": "1.1",
  "status": "in_progress",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "implementing",
  "message": "Creating auth middleware — 2/3 endpoints done",
  "milestones": [
    { "at": "2026-02-25T14:05:10Z", "msg": "Read CLAUDE.md and task XML" },
    { "at": "2026-02-25T14:05:35Z", "msg": "Read existing middleware for patterns" },
    { "at": "2026-02-25T14:06:01Z", "msg": "Created rate limiter for /api/auth" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task — reading context" },
    { "at": "2026-02-25T14:05:10Z", "level": "info", "msg": "Read CLAUDE.md — found auth patterns" },
    { "at": "2026-02-25T14:06:01Z", "level": "info", "msg": "Rate limiter created for /api/auth endpoint" }
  ]
}
```

### Field Definitions

| Field | Type | Description |
|---|---|---|
| `task_id` | string | Your task ID (e.g., `"1.1"`, `"2.3"`). Provided in your dispatch prompt. |
| `status` | string | Current lifecycle status. See **Status Values** below. |
| `started_at` | ISO 8601 \| null | Timestamp when you began work. Set on your first write. |
| `completed_at` | ISO 8601 \| null | Timestamp when you finished. Set only on `"completed"` or `"failed"`. |
| `summary` | string \| null | One-line summary of what you accomplished. Set on completion. |
| `assigned_agent` | string | Your agent label (e.g., `"Agent 1"`). Provided in your dispatch prompt. |
| `stage` | string | Current stage. See **Fixed Stages** below. |
| `message` | string | What you are doing right now — one line, specific and actionable. |
| `milestones` | array | Significant accomplishments during execution. Append-only. |
| `deviations` | array | Any divergences from the original plan. Append-only. |
| `logs` | array | Detailed log entries for the popup log box. Append-only. |

### Status Values

| Status | When to set |
|---|---|
| `"in_progress"` | On your first write (when you start reading context) |
| `"completed"` | When your task is done successfully |
| `"failed"` | When your task fails and cannot be recovered |

### Fixed Stages

Progress through these stages in order:

| Stage | Description |
|---|---|
| `reading_context` | Reading project files, CLAUDE.md, documentation, task XML |
| `planning` | Assessing readiness, planning approach |
| `implementing` | Writing code, creating/modifying files |
| `testing` | Running tests, validating changes |
| `finalizing` | Final cleanup, preparing summary report |
| `completed` | Task completed successfully |
| `failed` | Task failed |

---

## When You MUST Write

### Mandatory writes (skipping any of these is a failure):

1. **Before starting work** — Write your initial progress file with `status: "in_progress"`, `stage: "reading_context"`, and a log entry saying you're starting.

2. **On every stage transition** — Update `stage`, `message`, and add a log entry.

3. **On any deviation from the plan** — Add to `deviations[]` AND add a log entry at `level: "deviation"`. Do this IMMEDIATELY when the deviation occurs.

4. **On any error** — Add a log entry at `level: "error"` with details.

5. **On task completion** — Set `status: "completed"`, `stage: "completed"`, `completed_at`, `summary`, and add a final log entry.

6. **On task failure** — Set `status: "failed"`, `stage: "failed"`, `completed_at`, `summary` (with error description), and add a log entry at `level: "error"`.

### Recommended writes (as often as useful):

- **On significant milestones** within a stage — Add to `milestones[]` and `logs[]`.
- **On unexpected findings** — Add a log entry at `level: "warn"`.
- **On starting a new sub-operation** — Update `message` and add a log entry.

---

## Handling Ambiguity

When you encounter something unclear or ambiguous during execution — a vague requirement, a missing detail, or conflicting information — resolve it using this priority order:

1. **Check your dispatch prompt first.** The master agent's prompt is your primary spec. Re-read it carefully — the answer may already be there.
2. **Check the repo's `CLAUDE.md`.** Conventions and patterns defined there override general assumptions.
3. **Make the most conservative choice.** When neither the prompt nor `CLAUDE.md` resolves the ambiguity, choose the approach that changes the least, breaks nothing, and follows existing patterns in the codebase.
4. **Document it as a deviation.** Add an entry to `deviations[]` explaining what was ambiguous, what you chose, and why. Use severity `MODERATE` unless the choice affects downstream tasks (then use `CRITICAL`).
5. **Add a log entry at level `"warn"`.** Make the ambiguity visible in the dashboard logs.

**Never guess silently.** An undocumented guess looks like a bug when the master reviews your work. A documented conservative choice looks like good judgment.

---

## How to Write

### Getting Timestamps

Always capture live timestamps:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Use the output directly. **Never guess or construct timestamps from memory.**

### Atomic Writes

Write the full file every time. Since you are the sole writer, simply construct the entire JSON object in memory and write it all at once. The Write tool does this naturally.

### Log Entry Format

Each entry in the `logs` array:

```json
{ "at": "ISO 8601 timestamp", "level": "info", "msg": "What happened" }
```

**Log levels:**

| Level | When to use | Dashboard display |
|---|---|---|
| `info` | Normal progress, milestones, stage transitions | Purple badge |
| `warn` | Unexpected findings, non-blocking issues | Lime/yellow badge |
| `error` | Failures, blocking issues | Red badge |
| `deviation` | Any divergence from the planned approach | Yellow badge |

### Milestone Entry Format

Each entry in the `milestones` array:

```json
{ "at": "ISO 8601 timestamp", "msg": "What was accomplished" }
```

### Deviation Entry Format

Each entry in the `deviations` array:

```json
{ "at": "ISO 8601 timestamp", "severity": "MODERATE", "description": "What changed and why" }
```

### Deviation Severity Levels

Every deviation **must** include a `severity` field. Classify each deviation into one of these three levels:

| Severity | Meaning | Example |
|---|---|---|
| `CRITICAL` | Changes an API, interface, or contract that downstream tasks depend on. May block other agents. | Changed a function signature that other tasks import |
| `MODERATE` | Different approach or implementation than planned, but produces the same outcome. Does not affect downstream. | Used a different library method to achieve the same result |
| `MINOR` | Cosmetic or naming differences with no functional impact. | Renamed a variable for clarity, adjusted whitespace |

The master agent uses severity to decide whether to re-plan downstream tasks (`CRITICAL`), note for review (`MODERATE`), or ignore (`MINOR`).

### Reading Upstream Results

If your task has upstream dependencies, the master's dispatch prompt will include their results. Before implementing, extract the following from each upstream dependency in your prompt:

| Field | What to look for |
|---|---|
| **Task ID** | Which upstream task produced this result |
| **Summary** | What the upstream task accomplished |
| **Files changed** | Which files were created or modified (check for conflicts with your task) |
| **New exports** | Any new functions, types, APIs, or interfaces you should use |
| **Deviations** | Any plan divergences that affect your work — especially `CRITICAL` severity |

If an upstream deviation at `CRITICAL` severity affects your task's assumptions, **log a warning** and adapt your approach accordingly. Document how you adapted as a deviation in your own progress file.

---

## Example: Full Progress Lifecycle

Here's what a typical task's progress file looks like at each stage:

### 1. Initial write (before starting work)

```json
{
  "task_id": "1.1",
  "status": "in_progress",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "reading_context",
  "message": "Reading CLAUDE.md and task XML",
  "milestones": [],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task — reading context files" }
  ]
}
```

### 2. During implementation (mid-task)

```json
{
  "task_id": "1.1",
  "status": "in_progress",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "implementing",
  "message": "Creating auth middleware — rate limiter for /api/auth",
  "milestones": [
    { "at": "2026-02-25T14:05:10Z", "msg": "Read CLAUDE.md — found auth patterns" },
    { "at": "2026-02-25T14:05:35Z", "msg": "Read existing middleware for patterns" },
    { "at": "2026-02-25T14:06:01Z", "msg": "Created rate limiter for /api/auth" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task — reading context files" },
    { "at": "2026-02-25T14:05:10Z", "level": "info", "msg": "Read CLAUDE.md — JWT auth pattern with rate limiting" },
    { "at": "2026-02-25T14:05:35Z", "level": "info", "msg": "Existing middleware uses express-rate-limit pattern" },
    { "at": "2026-02-25T14:06:01Z", "level": "info", "msg": "Created rate limiter — 100 req/15min for /api/auth" }
  ]
}
```

### 3. Final write (task complete)

```json
{
  "task_id": "1.1",
  "status": "completed",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": "2026-02-25T14:08:30Z",
  "summary": "Created auth middleware with rate limiting — 3 endpoints protected, tests added",
  "assigned_agent": "Agent 1",
  "stage": "completed",
  "message": "Task complete — auth middleware with rate limiting",
  "milestones": [
    { "at": "2026-02-25T14:05:10Z", "msg": "Read CLAUDE.md — found auth patterns" },
    { "at": "2026-02-25T14:05:35Z", "msg": "Read existing middleware for patterns" },
    { "at": "2026-02-25T14:06:01Z", "msg": "Created rate limiter for /api/auth" },
    { "at": "2026-02-25T14:07:15Z", "msg": "Added JWT validation to all protected routes" },
    { "at": "2026-02-25T14:08:00Z", "msg": "Tests passing — 12/12" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task — reading context files" },
    { "at": "2026-02-25T14:05:10Z", "level": "info", "msg": "Read CLAUDE.md — JWT auth pattern with rate limiting" },
    { "at": "2026-02-25T14:05:35Z", "level": "info", "msg": "Existing middleware uses express-rate-limit pattern" },
    { "at": "2026-02-25T14:06:01Z", "level": "info", "msg": "Created rate limiter — 100 req/15min for /api/auth" },
    { "at": "2026-02-25T14:07:15Z", "level": "info", "msg": "JWT validation middleware added to 3 protected routes" },
    { "at": "2026-02-25T14:08:00Z", "level": "info", "msg": "All tests passing — 12/12" },
    { "at": "2026-02-25T14:08:30Z", "level": "info", "msg": "Task complete — auth middleware with rate limiting for 3 endpoints" }
  ]
}
```

---

## Dashboard Rendering

The dashboard uses your progress file to enhance your task card:

- **Stage badge** — Color-coded badge showing your current stage
- **Elapsed time** — Live timer from `started_at`
- **Current message** — Your `message` field displayed below the stage
- **Deviation badge** — Yellow "N deviation(s)" badge if `deviations[]` is non-empty
- **Popup log box** — When the user clicks your card, a scrollable log box shows all entries from your `logs[]` array in chronological order with colored level badges

### Log Box Detail

The popup log box is the user's deep-dive into your task. Write logs that tell a clear story:
- What you read and what you learned from it
- What you decided to do and why
- What you created/modified
- Any issues encountered and how you resolved them

Good logs tell a narrative. Bad logs are just "Starting..." / "Done."

---

## Partial Completion Protocol

Not every task finishes cleanly. If you complete **80%+ of the task** but hit a blocker on the remaining work, follow this protocol:

1. **Set `status` to `"completed"`** — not `"failed"`. Partial completion with useful output is a success, not a failure.
2. **Write a clear summary** that states what was accomplished AND what remains blocked. Example: `"Created 3/4 API endpoints — /users/delete blocked by missing soft-delete migration"`.
3. **Add a deviation entry** describing the blocker, what you tried, and why it could not be resolved.
4. **Add a log entry** at level `"warn"` documenting the blocker details.

**When to use `"failed"` instead:** Reserve `status: "failed"` for cases where the task produced **zero useful output** — e.g., the target file doesn't exist, a fundamental assumption was wrong, or the environment is broken. If you accomplished meaningful work, use `"completed"` with a clear summary of what's done and what's not.

---

## Rules Summary

1. **Write your progress file before starting any work** — NON-NEGOTIABLE
2. **Write on every stage transition** — NON-NEGOTIABLE
3. **Report deviations immediately** — NON-NEGOTIABLE
4. **Use live timestamps** — always via `date -u +"%Y-%m-%dT%H:%M:%SZ"`
5. **Write the full file every time** — no partial updates
6. **Include logs** — the popup log box renders from your `logs[]` array
7. **Set status lifecycle fields** — `started_at` on first write, `completed_at` on completion/failure
8. **Summary must be descriptive** — "Created auth middleware with rate limiting — 3 endpoints" not "Done"
