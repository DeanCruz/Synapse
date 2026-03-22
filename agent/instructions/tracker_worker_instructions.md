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
  ],
  "prompt_size": {
    "total_chars": 12500,
    "estimated_tokens": 3571
  }
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
| `prompt_size` | object \| null | Optional. Size metrics of the dispatch prompt received. Contains `total_chars` (integer) and `estimated_tokens` (integer). |

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

   Optionally, measure the size of your dispatch prompt and include it as `prompt_size` in your initial write. This helps the master agent calibrate future prompt budgets.

   To calculate prompt size, count the total characters of your full dispatch prompt (everything the master sent you). Estimate tokens as `Math.ceil(totalChars / 3.5)`. This is approximate — precision is not required.

2. **After initial write, if you have dependencies** — Read all upstream dependency progress files (see **Reading Upstream Results** below). Log what you found. If any upstream task failed or has `CRITICAL` deviations, adapt before proceeding.

3. **On every stage transition** — Update `stage`, `message`, and add a log entry.

4. **On any deviation from the plan** — Add to `deviations[]` AND add a log entry at `level: "deviation"`. Do this IMMEDIATELY when the deviation occurs.

5. **On any error** — Add a log entry at `level: "error"` with details.

6. **On task completion** — Set `status: "completed"`, `stage: "completed"`, `completed_at`, `summary`, and add a final log entry.

7. **On task failure** — Set `status: "failed"`, `stage: "failed"`, `completed_at`, `summary` (with error description), and add a log entry at `level: "error"`.

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

Write the full file every time. Since you are the sole writer, simply construct the entire JSON object in memory and write it all at once. The Write tool does this naturally — it writes to a temporary file and renames it into place, so the target file is never in a partially-written state.

**Always use the Write tool for progress file updates.** Do not use manual `echo` or `cat` shell commands to write JSON files — those do not guarantee atomic writes and can produce truncated files if interrupted. The Write tool is the correct and safest approach for all progress file updates.

If for any reason you must write a file via shell (e.g., in a script), use the write-then-rename pattern:
1. Write to `{filePath}.tmp`
2. Rename `{filePath}.tmp` to `{filePath}` (rename is atomic on POSIX and NTFS)

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

### What Counts as a Deviation — Concrete Examples

A deviation is ANYTHING you did that was not explicitly specified in your dispatch prompt. When in doubt, report it — under-reporting is worse than over-reporting.

**Common deviations workers should catch:**

| What Happened | Severity | Example Deviation Entry |
|---|---|---|
| Modified a file not in the FILES list | MODERATE | "Modified src/utils/helpers.ts to add a missing export — not in original file list but required for the new endpoint to compile" |
| Used a different API/library method than the prompt suggested | MODERATE | "Used `fs.promises.readFile` instead of the suggested `fs.readFileSync` — async version is consistent with the existing codebase pattern" |
| Added error handling or validation not specified in the task | MINOR | "Added input validation for empty strings on the name field — not specified but prevents a runtime error discovered during implementation" |
| Changed a function signature (parameters, return type) | CRITICAL | "Changed `createUser(name, email)` to `createUser(userData: CreateUserInput)` — upstream interface was incompatible with the existing validation middleware" |
| Created a helper function, utility, or file not in the plan | MODERATE | "Created src/utils/sanitize.ts with `sanitizeInput()` helper — extracting shared logic between the two endpoints this task creates" |
| Skipped a step from the task description | MODERATE | "Skipped adding the migration file — the database schema already has the required column from a previous migration" |
| Discovered and fixed a pre-existing bug while implementing | MINOR | "Fixed off-by-one error in existing pagination logic — discovered while adding the new endpoint, the bug would have caused the new endpoint to return incorrect page counts" |

**The rule is simple: if someone diffed your changes against the task description, would they find anything not mentioned? If yes, it's a deviation. Report it.**

### Reading Upstream Results — NON-NEGOTIABLE for Dependent Tasks

If your task has upstream dependencies (listed in your dispatch prompt), you **MUST read the progress files of every upstream dependency** before starting implementation. This is not optional — the master's dispatch prompt may contain a summary, but the progress files contain the **ground truth**: what actually happened, what deviated, what failed, and what the upstream worker logged.

#### Step 1: Read upstream progress files

For each dependency task ID listed in your dispatch prompt, read:

```
{tracker_root}/dashboards/{dashboardId}/progress/{dependency_task_id}.json
```

For example, if your task depends on `1.1` and `1.3`, read both:
- `{tracker_root}/dashboards/{dashboardId}/progress/1.1.json`
- `{tracker_root}/dashboards/{dashboardId}/progress/1.3.json`

**Read these files in parallel** — they have no dependency on each other.

#### Step 2: Extract critical information

From each upstream progress file, extract:

| Field | What to look for |
|---|---|
| **`status`** | Did it complete successfully or fail? If `"failed"`, assess whether your task can still proceed. |
| **`summary`** | What the upstream task accomplished — the definitive one-line result. |
| **`deviations[]`** | Every plan divergence. Pay special attention to `CRITICAL` severity — these may change your assumptions about interfaces, file locations, or APIs. |
| **`milestones[]`** | What was actually built, in order. Cross-reference with what your dispatch prompt expects to exist. |
| **`logs[]`** | The full narrative of what happened. Scan for `"error"` and `"warn"` level entries — these reveal issues that may affect your work. |
| **`message`** | Final state message — useful for understanding the last thing the upstream worker did. |

#### Step 3: Adapt your approach

- **If an upstream task failed:** Log a `"warn"` entry explaining which dependency failed and how you're proceeding. If the failure means a file or API you need doesn't exist, attempt to work around it or set your own status to `"failed"` with a clear explanation.
- **If an upstream task has `CRITICAL` deviations:** The upstream worker changed something your dispatch prompt assumed would be a certain way. Adapt your implementation to match what was *actually* built, not what was *planned*. Log every adaptation as a deviation in your own progress file.
- **If an upstream task has `MODERATE` deviations:** Note them but they likely don't affect your work. Log that you reviewed them.
- **If an upstream task's logs contain `"error"` entries:** Even if the task completed, errors may indicate partial issues. Review them to ensure nothing impacts your work.

#### Step 4: Log what you learned

After reading upstream progress files, add a log entry summarizing what you found:

```json
{ "at": "...", "level": "info", "msg": "Read upstream dependencies: 1.1 (completed, no deviations), 1.3 (completed, 1 MODERATE deviation — used alternative API pattern)" }
```

If any upstream deviation requires you to adapt, log it immediately:

```json
{ "at": "...", "level": "deviation", "msg": "Adapting to upstream 1.3 deviation: using fetchUsers() instead of planned getUsers() — upstream changed the export name" }
```

#### Why this matters

The master agent writes dispatch prompts during the **planning phase** — before any work is done. By the time your task runs, upstream workers may have deviated from the plan, encountered errors, used different file names, or changed interfaces. If you only rely on the master's dispatch prompt, you're working from a stale snapshot. Reading the progress files gives you the **actual state of the world** as left by the workers before you.

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
2. **Read upstream dependency progress files if you have dependencies** — NON-NEGOTIABLE
3. **Write on every stage transition** — NON-NEGOTIABLE
4. **Report deviations immediately** — NON-NEGOTIABLE
5. **Use live timestamps** — always via `date -u +"%Y-%m-%dT%H:%M:%SZ"`
6. **Write the full file every time** — no partial updates
7. **Include logs** — the popup log box renders from your `logs[]` array
8. **Set status lifecycle fields** — `started_at` on first write, `completed_at` on completion/failure
9. **Summary must be descriptive** — "Created auth middleware with rate limiting — 3 endpoints" not "Done"

---

## Return Format — EXPORTS Field

When your task introduces new public functions, types, interfaces, endpoints, constants, or files that downstream tasks may depend on, include an `EXPORTS:` section in your return format between `FILES CHANGED:` and `DIVERGENT ACTIONS:`.

**What qualifies as an export:**
- New public functions, methods, or classes
- New TypeScript/JSDoc types or interfaces
- New API endpoints or routes
- New constants or configuration values
- New files that other tasks will import from

**Format:**
```
EXPORTS:
  - {type: function|type|interface|endpoint|constant|file} {name} — {brief description}
```

**Examples:**
```
EXPORTS:
  - function validateAuthToken — validates JWT and returns decoded payload
  - type UserProfile — user profile interface with avatar, bio, settings fields
  - endpoint POST /api/auth/refresh — refreshes expired access tokens
```

**Rules:**
- Omit the EXPORTS section entirely if no new exports were introduced
- Only include exports that downstream tasks might need — internal helpers don't qualify
- The master uses EXPORTS to construct the UPSTREAM RESULTS section of downstream worker prompts
