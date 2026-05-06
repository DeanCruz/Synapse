# Worker Agent — Lite Progress Reporting Instructions

**For:** Worker agents on simple, independent tasks (no upstream dependencies). For dependent or complex tasks, use `tracker_worker_instructions.md`.

**Key paths:** Progress files go to `{tracker_root}`. Code work happens in `{project_root}`. Do NOT confuse them.

## Task Spec (read first)

Your canonical task spec lives at `{tracker_root}/dashboards/{dashboardId}/plan.json`. Read `context` (shared prompt + conventions for ALL agents) and the `tasks[]` entry whose `id` matches your `task_id` (deeply-thought `approach` + `files`) before doing anything else. Your dispatch prompt summarizes this, but `plan.json` is the source of truth.

## Progress File

Write to: `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` — write the **full file** on every update (sole writer, no read-modify-write). Always use the Write tool, not shell echo/cat.

```json
{
  "task_id": "1.1",
  "dashboard_id": "{dashboardId}",
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
  ],
  "files_changed": [
    { "path": "src/middleware/auth.ts", "action": "created" },
    { "path": "src/routes/index.ts", "action": "modified" }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `task_id` | string | Your task ID from the dispatch prompt |
| `dashboard_id` | string | Dashboard ID — must match the dashboard directory name. Provided in dispatch context as `dashboardId`. The server rejects progress files where this doesn't match. |
| `status` | string | `"in_progress"`, `"completed"`, or `"failed"` |
| `started_at` / `completed_at` | ISO 8601 \| null | Start on first write; end on completion/failure |
| `summary` | string \| null | One-line result, set on completion |
| `assigned_agent` | string | Your agent label from the dispatch prompt |
| `stage` | string | Current stage (see Fixed Stages) |
| `message` | string | What you are doing right now — one specific line |
| `milestones` | array | `{ "at": "ISO", "msg": "..." }` — significant accomplishments |
| `deviations` | array | `{ "at": "ISO", "severity": "MODERATE", "description": "..." }` — plan divergences. Severity: `CRITICAL` (affects downstream), `MODERATE` (different approach, same outcome), `MINOR` (cosmetic) |
| `logs` | array | `{ "at": "ISO", "level": "info\|warn\|error\|deviation", "msg": "..." }` |
| `files_changed` | array | **Required from `implementing` stage onward.** Each: `{ "path": "relative/path", "action": "created\|modified\|deleted" }`. Track every file you create, modify, or delete. |
| `annotations` | object \| null | Optional. Per-file knowledge for the PKI (see below) |
| `pki_used` | string[] \| null | Optional. PKI gotchas you actually consumed. Each entry: `"[<file path>] <gotcha-text>"` copied verbatim from your prompt's `## PKI Knowledge` block (see below) |
| `pki_noise` | string[] \| null | Optional. PKI gotchas surfaced in your prompt that turned out to be irrelevant or misleading for this task. Same format as `pki_used` (see below) |

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

1. **Before starting work** — NON-NEGOTIABLE. Set `dashboard_id`, `status: "in_progress"`, `started_at`, `assigned_agent`, `stage: "reading_context"`, initial log entry.
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

## PKI Usage Telemetry (Optional)

If your dispatch prompt included a `## PKI Knowledge` block and you actually consumed any of its gotchas, record which ones helped (`pki_used`) and which were irrelevant (`pki_noise`). The post-swarm extractor sums these to score annotations (`+1` for used, `-0.5` for noise, clamped to `[-3, +5]`). Each entry must be of the form `"[<file path>] <gotcha-text>"` — copy the gotcha verbatim from your prompt and prefix it with the file path in square brackets. Both fields are optional; absence is a clean no-op.

```json
{
  "pki_used": [
    "[src/server/services/WatcherService.js] Reconciliation interval is 5s — file writes may not appear on dashboard immediately if OS watcher misses an event"
  ],
  "pki_noise": [
    "[src/ui/hooks/useDashboardData.js] SSE reconnection has no backoff — rapid reconnects possible if server is down"
  ]
}
```

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
