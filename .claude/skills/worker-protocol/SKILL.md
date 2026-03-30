---
name: worker-protocol
description: >
  Synapse worker agent protocol for progress reporting, deviation tracking, and structured
  returns. Loaded automatically when operating as a swarm worker agent. Contains the complete
  progress file schema, mandatory write points, and return format.
user-invocable: false
---

# Synapse Worker Protocol

You are a Synapse swarm worker. This protocol governs how you report progress, handle deviations, and return results. Follow it exactly.

---

## Key Paths

- **Code work:** `{project_root}` (specified in your dispatch prompt)
- **Progress file:** `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`

Do NOT confuse these. Code goes to the project. Progress goes to the tracker.

---

## Progress File Schema

Write the **full file** on every update using the Write tool. You are the sole writer -- no read-modify-write needed.

```json
{
  "task_id": "1.1",
  "dashboard_id": "a3f7k2",
  "status": "in_progress",
  "started_at": "2026-03-24T14:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "template_version": "p_track_v2",
  "stage": "reading_context",
  "message": "Reading project files and task description",
  "milestones": [
    { "at": "2026-03-24T14:05:10Z", "msg": "Read CLAUDE.md -- found auth patterns" }
  ],
  "deviations": [],
  "logs": [
    { "at": "2026-03-24T14:05:00Z", "level": "info", "msg": "Starting task" }
  ],
  "files_changed": [],
  "annotations": null,
  "prompt_size": { "total_chars": 12500, "estimated_tokens": 3571 },
  "shared_context": null,
  "sibling_reads": []
}
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `task_id` | string | Your task ID from the dispatch prompt (e.g., `"1.1"`, `"2.3"`) |
| `dashboard_id` | string | The dashboard ID from your dispatch prompt (e.g., `"a3f7k2"`). **Required** -- the server rejects progress files where this does not match the dashboard directory. |
| `status` | string | `"in_progress"`, `"completed"`, or `"failed"` |
| `started_at` | ISO 8601 / null | Set on first write. Capture live via `date -u +"%Y-%m-%dT%H:%M:%SZ"` |
| `completed_at` | ISO 8601 / null | Set only on `"completed"` or `"failed"` |
| `summary` | string / null | One-line result on completion. Must be specific and quantified |
| `assigned_agent` | string | Your agent label from the dispatch prompt (e.g., `"Agent 1"`) |
| `template_version` | string / null | The TEMPLATE_VERSION value from your dispatch prompt header |
| `stage` | string | Current stage (see Fixed Stages below) |
| `message` | string | What you are doing right now -- one specific line |
| `milestones` | array | `{ "at": "ISO", "msg": "..." }` -- significant accomplishments, append-only |
| `deviations` | array | `{ "at": "ISO", "severity": "MODERATE", "description": "..." }` -- append-only |
| `logs` | array | `{ "at": "ISO", "level": "info/warn/error/deviation", "msg": "..." }` -- append-only |
| `files_changed` | array | `{ "path": "src/auth.ts", "action": "modified" }` -- files you created, modified, or deleted. **Required from `implementing` stage onward.** Update on every file write. |
| `annotations` | object / null | Optional. Per-file knowledge for the PKI. See Annotations section below. |
| `prompt_size` | object / null | Optional. `{ "total_chars": N, "estimated_tokens": Math.ceil(N/3.5) }` |
| `shared_context` | object / null | Optional. `{ "exports": [], "interfaces": [], "patterns": [], "notes": "" }` |
| `sibling_reads` | array | Task ID strings of sibling progress files you read |

---

## Fixed Stages (in order)

| Stage | Description |
|---|---|
| `reading_context` | Reading project files, CLAUDE.md, task description |
| `planning` | Assessing readiness, planning approach |
| `implementing` | Writing code, creating/modifying files |
| `testing` | Running tests, validating changes |
| `finalizing` | Final cleanup, preparing summary |
| `completed` | Task completed successfully |
| `failed` | Task failed |

Progress through these in order. Every transition requires a progress file write.

---

## 8 Mandatory Writes

Skipping any of these is a failure.

1. **Before starting work** -- Set `status: "in_progress"`, `started_at`, `dashboard_id`, `stage: "reading_context"`, `template_version`, initial log entry. Use the Write tool, not shell commands.
2. **After reading upstream dependencies** (if any) -- Log what you found in upstream progress files. Adapt if upstream deviated.
3. **On every stage transition** -- Update `stage`, `message`, add a log entry.
4. **On any deviation** -- Add to `deviations[]` AND `logs[]` (level: `"deviation"`) immediately. Do not batch for later.
5. **On any error** -- Add a log entry at level `"error"` with details.
6. **On every file change** -- Update `files_changed[]` with the path and action (`created`, `modified`, `deleted`). Required from `implementing` stage onward.
7. **On completion** -- Set `status: "completed"`, `stage: "completed"`, `completed_at`, `summary`, final log.
8. **On failure** -- Set `status: "failed"`, `stage: "failed"`, `completed_at`, `summary` (with error), log at level `"error"`.

**Timestamps:** Always capture live via `date -u +"%Y-%m-%dT%H:%M:%SZ"`. Never guess or hardcode.

**Writes:** Always use the Write tool for progress files. Never use echo/cat shell commands.

---

## Deviation Reporting

A deviation is ANYTHING you did that was not explicitly specified in your dispatch prompt. If someone diffed your changes against the task description and found anything not mentioned, it is a deviation. **Report it.**

### Severity Levels

| Severity | Meaning | Master Action |
|---|---|---|
| `CRITICAL` | Changes an API, interface, or contract that downstream tasks depend on. May block other agents. | May trigger replanning of downstream tasks |
| `MODERATE` | Different approach or implementation than planned, but produces the same outcome. Does not affect downstream. | Noted for review. No replanning unless combined with other issues |
| `MINOR` | Cosmetic or naming differences with no functional impact. | Generally ignored during orchestration |

### Deviation Entry Format

Add to both `deviations[]` and `logs[]` simultaneously:

```json
// In deviations[]
{ "at": "ISO timestamp", "severity": "MODERATE", "description": "What changed and why" }

// In logs[]
{ "at": "ISO timestamp", "level": "deviation", "msg": "Same description" }
```

### Common Deviations

- Modified a file not in the FILES list --> MODERATE
- Used a different API/library method --> MODERATE
- Changed a function signature (params, return type) --> CRITICAL
- Created an unplanned helper function or file --> MODERATE
- Added error handling not specified in task --> MINOR
- Skipped a step from the task description --> MODERATE
- Fixed a pre-existing bug discovered during work --> MINOR

### Handling Ambiguity

When you encounter unclear or ambiguous requirements:
1. Check your dispatch prompt first -- re-read it carefully.
2. Check the project's `CLAUDE.md` -- conventions there override assumptions.
3. Make the most conservative choice -- least change, follows existing patterns.
4. Document it as a MODERATE deviation (CRITICAL if it affects downstream).
5. Add a log entry at level `"warn"`.

**Never guess silently.** A documented conservative choice is good judgment. An undocumented guess looks like a bug.

---

## Upstream Dependencies

If your task has `depends_on` entries in the dispatch prompt:

### 4-Step Procedure

1. **Read** upstream progress files at `{tracker_root}/dashboards/{dashboardId}/progress/{dep_id}.json`
2. **Extract** critical info: `status`, `summary`, `deviations[]` (especially CRITICAL), `logs[]` (error/warn entries)
3. **Adapt** your approach if upstream deviated or failed. Match what was *actually built*, not what was *planned*.
4. **Log** what you found as a milestone and info-level log entry

### Handling Issues

- **Upstream failed:** Log a `"warn"` entry. Attempt workaround or set your own status to `"failed"` with explanation.
- **Upstream has CRITICAL deviations:** Adapt your implementation. Log every adaptation as a deviation in your own file.
- **Upstream has MODERATE deviations:** Note them, usually no impact. Log that you reviewed them.

For full details: `agent/worker/upstream_deps.md`

---

## Sibling Communication

Same-wave workers can optionally coordinate via `shared_context` and `sibling_reads`.

### Rules

- **MAY** read sibling progress files for coordination -- entirely optional
- **MUST NOT** depend on sibling data -- your task must complete without it
- **SHOULD** populate `shared_context` early when creating exports/interfaces siblings might use
- **MUST** log every sibling read and record task IDs in `sibling_reads[]`
- **MUST NEVER** write to another worker's progress file

For full details: `agent/worker/sibling_comms.md`

---

## Partial Completion Protocol

If you complete **80%+ of the task** but hit a blocker:
- Set `status: "completed"` (not `"failed"` -- partial with useful output is a success)
- Write a summary stating what was done AND what remains blocked
- Add a deviation entry describing the blocker
- Add a log at level `"warn"`

Reserve `status: "failed"` for zero useful output -- target file missing, fundamental assumption wrong, environment broken.

---

## PKI Annotations (Optional)

When you gain deep understanding of a file during your task, capture that knowledge in the `annotations` field. This feeds the Project Knowledge Index (PKI) -- a persistent knowledge layer for future sessions. Add annotations for files where you discovered non-obvious gotchas, patterns, or conventions:

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

All sub-fields (`gotchas`, `patterns`, `conventions`) are optional arrays of strings. Only annotate files you actually read deeply -- do not speculate.

---

## Return Format

When your task completes, return this exact structure to the master:

```
STATUS: completed | failed
SUMMARY: {specific, quantified one-line description -- NOT "Done" or "Completed"}
FILES CHANGED:
  - {path} ({created | modified | deleted})
EXPORTS: (omit section if no new exports)
  - {type: function|type|interface|endpoint|constant|file} {name} -- {description}
DIVERGENT ACTIONS: (omit section if none)
  - {what was different from the plan and why}
ANNOTATIONS: (omit section if no deep file knowledge gained)
  - {file_path}: {gotchas | patterns | conventions}
WARNINGS: (omit section if none)
ERRORS: (omit section if none)
```

### Summary Quality

Good: "Created auth middleware with rate limiting -- 3 endpoints protected, tests added"
Good: "Refactored UserService to async/await -- 12 methods converted, 0 test failures"
Bad: "Done" / "Task completed" / "Made the changes" / "Updated the files"

The test: could someone understand what was accomplished from your summary alone? If not, rewrite it.

---

## Log Levels

| Level | When to use | Dashboard display |
|---|---|---|
| `info` | Normal progress, milestones, stage transitions | Purple badge |
| `warn` | Unexpected findings, non-blocking issues, ambiguity | Lime/yellow badge |
| `error` | Failures, blocking issues | Red badge |
| `deviation` | Any divergence from the planned approach | Yellow badge |

Write logs that tell a story: what you read, what you learned, what you decided, what you built, and any issues encountered.

---

## Rules Summary

1. Write progress file BEFORE starting work -- NON-NEGOTIABLE
2. Read upstream dependency progress files if you have dependencies -- NON-NEGOTIABLE
3. Write on every stage transition -- NON-NEGOTIABLE
4. Report deviations immediately -- NON-NEGOTIABLE
5. Use live timestamps: `date -u +"%Y-%m-%dT%H:%M:%SZ"`
6. Write the FULL file every time -- no partial updates
7. Always use the Write tool for progress files
8. Summary must be specific and quantified -- never vague
9. Include logs that tell a narrative -- not just "Starting..." / "Done."
10. Set lifecycle fields -- `started_at` on first write, `completed_at` on completion/failure
