# Worker Agent — Lite Progress Reporting Instructions

**For:** Worker agents on simple, independent tasks (no upstream dependencies). For dependent or complex tasks, use `tracker_worker_instructions.md`.

**Key paths:** Progress files go to `{tracker_root}`. Code work happens in `{project_root}`. Do NOT confuse them.

## Progress File

Write to: `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` — write the **full file** on every update (sole writer, no read-modify-write). Always use the Write tool, not shell echo/cat.

```json
{
  "task_id": "1.1",
  "status": "completed",
  "started_at": "2026-02-25T14:05:00Z",
  "completed_at": "2026-02-25T14:08:30Z",
  "summary": "Created auth middleware with rate limiting — 3 endpoints protected",
  "assigned_agent": "Agent 1",
  "stage": "completed",
  "message": "Task complete — auth middleware with rate limiting",
  "milestones": [
    { "at": "2026-02-25T14:05:10Z", "msg": "Read CLAUDE.md — found auth patterns" },
    { "at": "2026-02-25T14:06:01Z", "msg": "Created rate limiter for /api/auth" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-02-25T14:05:00Z", "level": "info", "msg": "Starting task" },
    { "at": "2026-02-25T14:08:30Z", "level": "info", "msg": "Task complete" }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `task_id` | string | Your task ID from the dispatch prompt |
| `status` | string | `"in_progress"`, `"completed"`, or `"failed"` |
| `started_at` / `completed_at` | ISO 8601 \| null | Start on first write; end on completion/failure |
| `summary` | string \| null | One-line result, set on completion |
| `assigned_agent` | string | Your agent label from the dispatch prompt |
| `stage` | string | Current stage (see Fixed Stages) |
| `message` | string | What you are doing right now — one specific line |
| `milestones` | array | `{ "at": "ISO", "msg": "..." }` — significant accomplishments |
| `deviations` | array | `{ "at": "ISO", "description": "..." }` — plan divergences |
| `logs` | array | `{ "at": "ISO", "level": "info\|warn\|error\|deviation", "msg": "..." }` |
| `annotations` | object \| null | Optional. Per-file knowledge for the PKI (see below) |

## Fixed Stages

| Stage | Description |
|---|---|
| `reading_context` | Reading project files, CLAUDE.md, task description |
| `planning` | Assessing readiness, planning approach |
| `implementing` | Writing code, creating/modifying files |
| `testing` | Running tests, validating changes |
| `finalizing` | Final cleanup, preparing summary |
| `completed` | Task completed successfully |
| `failed` | Task failed |

## Mandatory Writes

1. **Before starting work** — NON-NEGOTIABLE. Set `status: "in_progress"`, `started_at`, `assigned_agent`, `stage: "reading_context"`, initial log entry.
2. **On every stage transition** — Update `stage`, `message`, add a log entry.
3. **On any deviation** — Add to `deviations[]` and a log entry at `level: "deviation"` immediately.
4. **On completion** — Set `status: "completed"`, `stage: "completed"`, `completed_at`, `summary`, final log entry.
5. **On failure** — Set `status: "failed"`, `stage: "failed"`, `completed_at`, `summary` (with error), log at `level: "error"`.

**Timestamps:** Always capture live via `date -u +"%Y-%m-%dT%H:%M:%SZ"`. Never guess or hardcode.

## PKI Annotations (Optional)

When you gain deep understanding of a file during your task, you can capture that knowledge in the optional `annotations` field. This feeds the Project Knowledge Index (PKI) — a persistent knowledge layer for future sessions. Add annotations for files where you discovered non-obvious gotchas, patterns, or conventions:

```json
{
  "annotations": {
    "src/auth/login.ts": {
      "gotchas": ["Refresh token rotation: old must be invalidated first"],
      "patterns": ["Uses asyncHandler wrapper for all async routes"],
      "conventions": ["Error shape: { error: string, code: number }"]
    }
  }
}
```

All sub-fields (`gotchas`, `patterns`, `conventions`) are optional arrays of strings. Only annotate files you actually read deeply — don't speculate.

## Return Format

```
STATUS: completed | failed
SUMMARY: {one-sentence description}
FILES CHANGED:
  - {path} ({created | modified | deleted})
EXPORTS: (omit if no new exports)
  - {type} {name} — {description}
DIVERGENT ACTIONS: (omit if none)
WARNINGS: (omit if none)
ERRORS: (omit if none)
```
