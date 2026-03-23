# Worker Protocol Overview

The Worker Protocol defines how worker agents operate within a Synapse swarm. Worker agents are dispatched by the master agent during `!p_track` (or `!p`) swarms to execute individual tasks in parallel. Each worker is an autonomous agent that reads context, implements its assigned task, and reports progress back to the live dashboard.

This document covers the worker agent lifecycle, responsibilities, and the rules that govern worker behavior.

---

## What Is a Worker Agent?

A worker agent is a Task-tool-spawned agent that the master dispatches to execute a single, atomic task. Workers are the implementers of the swarm — they write code, create files, run tests, and produce artifacts. The master agent never writes code; workers do all implementation work.

Each worker:

- Receives a **self-contained dispatch prompt** from the master with everything it needs to execute
- Operates within **`{project_root}`** for code work (the target project being developed)
- Reports progress to **`{tracker_root}`** via a dedicated progress file (the Synapse repository)
- Owns exactly one progress file at `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`
- Is the **sole writer** of its progress file — no other agent reads or modifies it

---

## Two Critical Paths

Every worker receives two paths in its dispatch prompt. These are distinct locations and must never be confused:

| Path | Purpose | Example |
|---|---|---|
| `{tracker_root}` | The Synapse repository. Where the worker writes progress files. | `/Users/dean/tools/Synapse` |
| `{project_root}` | The target project. Where the worker reads source files and writes code. | `/Users/dean/repos/my-app` |

**Code work happens in `{project_root}`. Progress reporting goes to `{tracker_root}`.**

---

## Worker Lifecycle

A worker agent progresses through a fixed sequence of stages from dispatch to completion. The lifecycle is the same for every worker, regardless of what the task involves.

### Stage Sequence

```
reading_context  ->  planning  ->  implementing  ->  testing  ->  finalizing  ->  completed
                                                                                    |
                                                                                 (or failed)
```

| Stage | Description |
|---|---|
| `reading_context` | Reading project files, CLAUDE.md, documentation, task file, upstream progress files |
| `planning` | Assessing readiness, planning the implementation approach |
| `implementing` | Writing code, creating/modifying files in `{project_root}` |
| `testing` | Running tests, validating that changes work correctly |
| `finalizing` | Final cleanup, preparing the summary report |
| `completed` | Task completed successfully |
| `failed` | Task failed and cannot be recovered |

Workers must progress through stages **in order**. Every stage transition requires a progress file write (see [Progress Reporting](progress-reporting.md)).

---

## Worker Responsibilities

### 1. Read Instructions First

Before doing any work, every worker MUST:

1. Read `{tracker_root}/agent/instructions/tracker_worker_instructions.md` — the authoritative reference for progress reporting
2. Write an initial progress file with `status: "in_progress"` and `stage: "reading_context"`
3. Read upstream dependency progress files if the task has dependencies (see [Upstream Results](upstream-results.md))

### 2. Read Context Thoroughly

Workers read the files specified in their dispatch prompt:

- The project's `CLAUDE.md` for conventions and patterns
- Source files relevant to the task
- Types, schemas, and interfaces needed for implementation
- Any documentation referenced in the prompt

### 3. Implement the Task

Workers execute the task exactly as described in their dispatch prompt. The prompt is the spec — it contains:

- Specific files to read and modify
- Code conventions from `{project_root}/CLAUDE.md`
- Code snippets the worker needs to reference
- Clear success criteria
- Both `{tracker_root}` and `{project_root}` paths

### 4. Report Progress Continuously

Workers write their progress file throughout execution:

- On every stage transition (mandatory)
- On significant milestones (recommended)
- On any deviation from the plan (mandatory, immediately)
- On any error (mandatory)
- On task completion or failure (mandatory)

See [Progress Reporting](progress-reporting.md) for the complete schema and rules.

### 5. Report Deviations

Any divergence from the dispatch prompt — different files modified, different API used, additional helpers created, skipped steps — must be reported as a deviation immediately when it occurs.

See [Deviations](deviations.md) for the full protocol and severity classification.

### 6. Adapt to Upstream Results

If the task depends on other tasks that ran before it, the worker must read those tasks' progress files and adapt to what was *actually built*, not what was *planned*.

See [Upstream Results](upstream-results.md) for the complete protocol.

### 7. Return Results

When the task completes, the worker returns a structured result to the master agent containing:

- Summary of what was accomplished
- Files changed
- Exports introduced (new functions, types, endpoints, etc.)
- Divergent actions (deviations from the plan)

---

## Handling Ambiguity

When something is unclear or ambiguous during execution, workers resolve it using this priority order:

1. **Check the dispatch prompt first.** The master's prompt is the primary spec. Re-read it carefully.
2. **Check the repo's `CLAUDE.md`.** Conventions and patterns defined there override general assumptions.
3. **Make the most conservative choice.** Change the least, break nothing, follow existing patterns.
4. **Document it as a deviation.** Add an entry to `deviations[]` explaining what was ambiguous, what you chose, and why. Use severity `MODERATE` unless the choice affects downstream tasks (then use `CRITICAL`).
5. **Add a log entry at level `"warn"`.** Make the ambiguity visible in the dashboard logs.

**Never guess silently.** An undocumented guess looks like a bug when the master reviews the work. A documented conservative choice looks like good judgment.

---

## Partial Completion Protocol

Not every task finishes cleanly. When a worker completes **80% or more of the task** but hits a blocker on the remaining work:

1. **Set `status` to `"completed"`** — not `"failed"`. Partial completion with useful output is a success.
2. **Write a clear summary** stating what was accomplished AND what remains. Example: `"Created 3/4 API endpoints — /users/delete blocked by missing soft-delete migration"`.
3. **Add a deviation entry** describing the blocker, what was tried, and why it could not be resolved.
4. **Add a log entry** at level `"warn"` documenting the blocker details.

### When to Use `"failed"` Instead

Reserve `status: "failed"` for cases where the task produced **zero useful output**:

- The target file does not exist
- A fundamental assumption in the dispatch prompt was wrong
- The environment is broken (missing dependencies, wrong runtime, etc.)
- The task cannot produce any meaningful work product

If meaningful work was accomplished, use `"completed"` with a clear summary of what is done and what is not.

---

## Atomic Write Rules

Workers must use the **Write tool** for all progress file updates. The Write tool writes to a temporary file and renames it into place, ensuring the target file is never in a partially-written state.

**Do not** use manual `echo` or `cat` shell commands to write JSON files. Shell commands do not guarantee atomic writes and can produce truncated files if interrupted.

If shell writes are absolutely necessary (e.g., inside a script), use the write-then-rename pattern:

1. Write to `{filePath}.tmp`
2. Rename `{filePath}.tmp` to `{filePath}` (rename is atomic on POSIX and NTFS)

---

## Return Format

When a worker completes, it returns a structured response to the master. The format includes:

```
SUMMARY:
  One-line description of what was accomplished.

FILES CHANGED:
  - path/to/file1.ts — what was changed
  - path/to/file2.ts — what was created

EXPORTS:
  - {type} {name} — {brief description}

DIVERGENT ACTIONS:
  - Description of any deviations from the plan
```

### The EXPORTS Field

The `EXPORTS` section lists new public artifacts that downstream tasks may depend on:

- New public functions, methods, or classes
- New TypeScript/JSDoc types or interfaces
- New API endpoints or routes
- New constants or configuration values
- New files that other tasks will import from

**Format:**
```
EXPORTS:
  - function validateAuthToken — validates JWT and returns decoded payload
  - type UserProfile — user profile interface with avatar, bio, settings fields
  - endpoint POST /api/auth/refresh — refreshes expired access tokens
```

**Rules:**
- Omit the EXPORTS section entirely if no new exports were introduced
- Only include exports that downstream tasks might need — internal helpers do not qualify
- The master uses EXPORTS to construct the UPSTREAM RESULTS section of downstream worker prompts

---

## Rules Summary

These rules are NON-NEGOTIABLE for every worker agent:

1. **Write your progress file before starting any work**
2. **Read upstream dependency progress files if you have dependencies**
3. **Write on every stage transition**
4. **Report deviations immediately**
5. **Use live timestamps** — always via `date -u +"%Y-%m-%dT%H:%M:%SZ"`
6. **Write the full file every time** — no partial updates, overwrite the entire JSON
7. **Include logs** — the popup log box renders from the `logs[]` array
8. **Set status lifecycle fields** — `started_at` on first write, `completed_at` on completion/failure
9. **Summary must be descriptive** — `"Created auth middleware with rate limiting — 3 endpoints"` not `"Done"`
