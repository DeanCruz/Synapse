# Worker Agent — Progress Reporting Instructions

**Who this is for:** Worker agents dispatched by the master agent during a `!p_track` swarm. This document is your quick-start reference and hub for all worker protocols.

**This is NON-NEGOTIABLE.** Every worker agent MUST follow these instructions exactly. Failure to report progress means the dashboard shows no live updates for your task — the user has no visibility into what you're doing.

**Key location distinction:** Your dispatch prompt provides two critical paths:
- **`{tracker_root}`** — The Synapse repository. This is where you write progress files.
- **`{project_root}`** — The target project. This is where you do your actual code work (read source files, modify code, create files).

These are **different locations**. Do NOT confuse them. Your code work happens in `{project_root}`. Your progress reporting goes to `{tracker_root}`.

Your progress file path:
```
{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json
```

> **PATH SAFETY:** Always use the absolute path provided in your dispatch context. Never construct a relative `dashboards/` path yourself. Your CWD is `{project_root}`, not `{tracker_root}` — a relative path would write progress files into the target project instead of Synapse. A hook will block writes outside `{tracker_root}/dashboards/`.

---

## Quick Start Checklist

Follow these steps in order for every task:

1. **Write initial progress file** at the path above with `dashboard_id` (from your dispatch context), `status: "in_progress"`, `stage: "reading_context"`, `started_at` (live timestamp), and a starting log entry. Include `template_version` from your dispatch prompt header. Write the full JSON file every time — you are the sole owner. The server rejects progress files where `dashboard_id` doesn't match the dashboard directory.
2. **Query the PKI** (recommended): Read `{project_root}/.synapse/knowledge/manifest.json` and look up annotations for files in your task scope. Internalize gotchas, patterns, and conventions before implementing. Check insights for failure patterns in your area. --> See PKI Retrieval section below.
3. **If you have dependencies:** Read upstream progress files at `{tracker_root}/dashboards/{dashboardId}/progress/{dep_id}.json`. Check `status`, `summary`, `deviations[]` (especially `CRITICAL`), and `logs[]` for errors. Adapt if upstream deviated. Log what you found. --> Read `agent/worker/upstream_deps.md`
4. **Progress through fixed stages in order:** `reading_context` --> `planning` --> `implementing` --> `testing` --> `finalizing` --> `completed` | `failed`
5. **Write on every stage transition** — update `stage`, `message`, and add a log entry. Append milestones for significant accomplishments.
6. **Track every file change in `files_changed[]`** — NON-NEGOTIABLE. When you create, modify, or delete a project file, immediately add it to `files_changed` as `{ "path": "relative/path", "action": "created|modified|deleted" }`. Also add a log entry describing the change. Update incrementally — do NOT wait until finalization. The dashboard renders this as a clickable file list in the task popup.
7. **Report deviations IMMEDIATELY** — add to both `deviations[]` (with severity) and `logs[]` (at `level: "deviation"`) the moment any divergence occurs. --> Read `agent/worker/deviations.md`
8. **Populate `shared_context`** if you create exports, interfaces, or patterns that same-wave siblings could use. --> Read `agent/worker/sibling_comms.md`
9. **Annotate files you read deeply** (optional but encouraged): When you gain non-obvious understanding of a file during `reading_context` or `implementing`, add an `annotations` field to your progress file. This feeds the PKI (Project Knowledge Index) and helps future sessions. --> See PKI Annotations section below.
10. **On completion:** Set `status: "completed"`, `stage: "completed"`, `completed_at`, and a descriptive `summary`. Ensure `files_changed` is complete and matches your FILES CHANGED return. For partial completion (80%+ done), use `"completed"` with summary stating what remains blocked. Reserve `"failed"` for zero useful output.
11. **Return structured summary** to the master. --> Read `agent/worker/return_format.md`

```
STATUS: completed | failed
SUMMARY: {specific, quantified one-line description}
FILES CHANGED: {list with action prefixes: created/modified/deleted}
EXPORTS: {new public exports — omit if none}
DIVERGENT ACTIONS: {any deviations from the plan}
```

**Timestamps:** Always capture live via `date -u +"%Y-%m-%dT%H:%M:%SZ"`. Never guess or hardcode.

**Writes:** Always use the Write tool for progress files — not echo/cat shell commands.

---

## Module Index

Detailed instructions are organized into focused modules. Read the ones relevant to your task.

| Module | File | What It Covers |
|---|---|---|
| **Progress Reporting** | `agent/worker/progress_reporting.md` | Full JSON schema (15 fields), status values, fixed stages, 7 mandatory writes, ambiguity handling, atomic writes, log/milestone/deviation entry formats, partial completion, dashboard rendering, full lifecycle examples |
| **Return Format** | `agent/worker/return_format.md` | STATUS/SUMMARY/FILES CHANGED/EXPORTS/WARNINGS/ERRORS/DIVERGENT ACTIONS return structure, good vs bad summaries, 4 complete examples |
| **Deviations** | `agent/worker/deviations.md` | Severity levels (CRITICAL/MODERATE/MINOR), 7 concrete examples with classifications, ambiguity-as-deviation, how the master uses severity for replanning |
| **Upstream Dependencies** | `agent/worker/upstream_deps.md` | 4-step procedure: read files, extract critical info, adapt approach, log findings. Handling failures and CRITICAL deviations |
| **Sibling Communication** | `agent/worker/sibling_comms.md` | shared_context sub-fields, sibling_reads tracking, 7 rules, never-write-to-sibling-files invariant, practical example |

---

## When to Read What

| Moment | Module to Read |
|---|---|
| Starting any task | `agent/worker/progress_reporting.md` |
| Before reading source files | See PKI Retrieval section below |
| Your task has upstream dependencies | `agent/worker/upstream_deps.md` |
| Something deviates from the plan | `agent/worker/deviations.md` |
| Same-wave sibling awareness needed | `agent/worker/sibling_comms.md` |
| Gained deep understanding of a file | See PKI Annotations section below |
| Task finishing — preparing return | `agent/worker/return_format.md` |

---

## Progress Reporting — Summary

Your progress file is the full lifecycle record of your task — status, timestamps, stage, message, milestones, deviations, logs, files_changed, and optional shared context. The dashboard watches this file and broadcasts changes in real-time (~50ms). Write the full JSON on every update. Use the Write tool for atomic writes.

**8 mandatory writes** (skipping any is a failure): (1) before starting work, (2) after PKI retrieval and/or reading upstream dependencies, (3) on every stage transition, (4) on any deviation, (5) on any error, (6) on every file change (add to `files_changed[]`), (7) on completion, (8) on failure.

--> Full details: `agent/worker/progress_reporting.md`

---

## Deviations — Summary

A deviation is anything you did that was not explicitly in your dispatch prompt. Classify with severity: `CRITICAL` (changes interfaces downstream tasks depend on — may trigger replanning), `MODERATE` (different approach, same outcome), or `MINOR` (cosmetic, no functional impact). When in doubt, report it — under-reporting is worse than over-reporting.

--> Full details: `agent/worker/deviations.md`

---

## Upstream Dependencies — Summary

If your task has dependencies, you MUST read their progress files before implementing. The master's dispatch prompt was written during planning — upstream workers may have deviated, failed, or changed interfaces since then. Progress files are the ground truth. Follow the 4-step procedure: read files, extract critical info, adapt approach, log findings.

--> Full details: `agent/worker/upstream_deps.md`

---

## Sibling Communication — Summary

Same-wave workers can optionally coordinate via `shared_context` and `sibling_reads` fields. This is supplementary — never block on sibling data. Populate `shared_context` early when you create exports or interfaces peers might use. Record every sibling file read in `sibling_reads[]`. Never write to another worker's file.

--> Full details: `agent/worker/sibling_comms.md`

---

## Additional Context Directories — Summary

Your dispatch prompt may include **Additional Context Directories (READ-ONLY)** — paths to reference material outside `{project_root}` and `{tracker_root}`. These directories contain documentation, design guidelines, coding standards, or architectural patterns provided by the user or master agent.

**Key rules:**

- **READ-ONLY** — never create, modify, or delete files in additional context directories. They are reference material only.
- **CLAUDE.md applies** — if an additional context directory contains a `CLAUDE.md`, read it and follow its guidelines. Conventions from these files apply to your work alongside the project's own `CLAUDE.md`.
- **Use for guidance** — reference these directories for design patterns, naming conventions, API styles, and domain knowledge. When your task involves decisions about structure or style, check additional context dirs for relevant guidance before defaulting to your own judgment.
- **Cite what you use** — if an additional context directory influences your implementation, log it as an info-level entry describing what you referenced and how it shaped your approach.

Additional context directories are supplementary. If none are listed in your dispatch prompt, ignore this section.

---

## PKI Retrieval — Consuming Knowledge Before You Work

**Recommended.** Before diving into implementation, check the Project Knowledge Index (PKI) for existing knowledge about the files you'll be working with. The PKI accumulates gotchas, patterns, and conventions discovered by previous agents — using it prevents you from re-learning things the hard way.

### When to Query the PKI

Query the PKI during **`reading_context`** stage — before you start implementing. This is a lightweight operation (1-3 file reads) that can save significant time by surfacing hidden constraints early.

### Retrieval Procedure

**Step 1 — Check if PKI exists:**
```
Read: {project_root}/.synapse/knowledge/manifest.json
```
If the file doesn't exist or fails to parse, skip PKI retrieval entirely — proceed with normal context reading. Do NOT treat this as an error.

**Step 2 — Identify your task's files:**
From your dispatch prompt, identify the files you expect to read or modify. Also extract relevant keywords from your task description (e.g., "authentication", "API", "middleware").

**Step 3 — Look up files in the manifest:**
For each file in your task scope, check if it exists in the manifest's `files` object. Note the `hash` field for any matches.

Also scan `domain_index` and `tag_index` for your task keywords — this may surface related files you didn't know about.

**Step 4 — Read relevant annotations:**
For matched files (max 3-5 to stay within budget), read:
```
{project_root}/.synapse/knowledge/annotations/{hash}.json
```

Extract and internalize:
- **`gotchas`** — These are foot-guns. Respect them. They were discovered by previous agents who hit these issues.
- **`patterns`** — Follow established patterns for consistency. Don't invent a new approach if one already exists.
- **`conventions`** — Maintain project conventions in any new code you write.
- **`relationships`** — Understand which files depend on yours and which yours depends on.

**Step 5 — Check for swarm insights:**
Read the `insights_index` in the manifest (if it exists). Scan for insights related to your task area. If a recent insight mentions your files or domain, read the insight file at:
```
{project_root}/.synapse/knowledge/insights/{filename}.json
```
Look for `dependency_insights`, `complexity_surprises`, and `failure_patterns` — these warn you about pitfalls previous swarms encountered.

**Step 6 — Log what you found:**
Add a log entry describing what PKI knowledge you consumed:
```json
{
  "timestamp": "{ISO 8601}",
  "level": "info",
  "msg": "PKI retrieval: read annotations for 3 files, found 2 gotchas and 1 pattern relevant to my task"
}
```

### Rules for PKI Retrieval

- **Never block on PKI** — if any read fails, continue without it. PKI is an optimization, not a requirement.
- **Budget: max 3-5 annotation reads** — don't read the entire knowledge base. Focus on files directly in your task scope.
- **Trust but verify** — if an annotation is marked `stale: true` in the manifest, the knowledge may be outdated. Verify stale gotchas by reading the actual file.
- **PKI supplements, never replaces, file reading** — you must still read the actual source files. PKI tells you what to watch out for, not what the code currently looks like.
- **Log what influenced you** — if a PKI gotcha or pattern changed your implementation approach, log it. This helps the master understand your decisions.

---

## PKI Annotations — Contributing Knowledge

**Optional but encouraged.** When you read a file deeply during your task, you can capture operational knowledge about it by adding an `annotations` field to your progress file. This feeds the **Project Knowledge Index (PKI)** — a persistent knowledge layer that gives future Claude sessions rich understanding of the codebase without redundant exploration.

### When to Annotate

Annotate during **`reading_context`** and **`implementing`** stages — the moments when you're gaining deep understanding of files. Do NOT annotate files you only glanced at. Only annotate files where you learned something non-obvious that would help a future agent.

### The `annotations` Field

Add this to your progress file JSON (alongside `task_id`, `status`, etc.):

```json
{
  "annotations": {
    "src/server/services/WatcherService.js": {
      "gotchas": ["Reconciliation interval is 5s — file writes may not appear on dashboard immediately if OS watcher misses an event"],
      "patterns": ["Singleton service — instantiated once in index.js and shared across all route handlers"],
      "conventions": ["Error responses use { error: string } shape consistently"]
    },
    "src/ui/hooks/useDashboardData.js": {
      "gotchas": ["SSE reconnection has no backoff — rapid reconnects possible if server is down"],
      "patterns": ["Custom hook wrapping EventSource with React state updates"]
    }
  }
}
```

Each key is a **relative file path** (relative to `{project_root}`). Each sub-field is an optional array of strings:

| Sub-field | What to capture |
|---|---|
| `gotchas` | Operational warnings — things that would bite you if you didn't know them. Edge cases, non-obvious behaviors, foot-guns. |
| `patterns` | Coding patterns used in this file — how things are structured, design patterns in play. |
| `conventions` | Project-level conventions observed — naming, error handling, logging, file organization. |

All three sub-fields are optional. Include only the ones where you have something genuinely useful to say.

### What Makes a Good Annotation

**Good annotations are specific, actionable, and non-obvious.** They capture knowledge that a future agent would benefit from — things you had to figure out that aren't apparent from a quick read.

**Good:**
- `"gotchas": ["Port defaults to 4000 but Electron hardcodes this — changing PORT env var breaks the desktop app"]`
- `"patterns": ["Uses asyncHandler wrapper for all async routes — unwrapped async throws crash the server"]`
- `"conventions": ["All config files use camelCase keys, not snake_case — inconsistency causes silent failures"]`

**Bad (too vague or obvious):**
- `"gotchas": ["This file is complicated"]`
- `"patterns": ["Uses JavaScript"]`
- `"conventions": ["Has functions"]`

**The test:** Would a future agent who reads this annotation make better decisions or avoid a mistake? If yes, include it. If it just restates what the code obviously does, skip it.

### Rules

- **Optional** — never required. Your task is to complete your assigned work. Annotations are a bonus.
- **Lightweight** — don't spend significant time on annotations. Capture knowledge you already gained during normal task execution.
- **Honest** — only annotate what you actually observed. Don't speculate about files you didn't read deeply.
- **Append-friendly** — the master merges these into the full PKI after the swarm completes. Your annotations are a lightweight subset of the full annotation schema.

---

## Return Format — Summary

Return a structured summary with STATUS, SUMMARY, FILES CHANGED, and optionally EXPORTS and DIVERGENT ACTIONS. Summaries must be specific and quantified: "Created auth middleware with rate limiting — 3 endpoints protected" not "Done". The master uses this to log results and construct upstream context for downstream workers.

--> Full details: `agent/worker/return_format.md`

---

## Rules Summary

1. **Write your progress file before starting any work** — NON-NEGOTIABLE
2. **Read upstream dependency progress files if you have dependencies** — NON-NEGOTIABLE
3. **Write on every stage transition** — NON-NEGOTIABLE
4. **Report deviations immediately** — NON-NEGOTIABLE
5. **Use live timestamps** — always via `date -u +"%Y-%m-%dT%H:%M:%SZ"`
6. **Write the full file every time** — no partial updates
7. **Always use the Write tool** for progress files — not echo/cat shell commands
8. **Include detailed logs** — NON-NEGOTIABLE — the popup log box renders from your `logs[]` array. Every log entry must be specific and descriptive (≥20 chars). Never use vague placeholders like "Starting...", "Done", or "Working on it". Log what you read, what you learned, what you decided, what you changed, and why.
9. **Update progress after every significant action** — NON-NEGOTIABLE — after reading files, making decisions, editing code, running tests, or completing sub-steps, update your progress file with a detailed log entry. Hooks enforce this — you will be warned if your logs are too sparse or your progress file is stale.
10. **Set lifecycle fields** — `started_at` on first write, `completed_at` on completion/failure
11. **Summary must be descriptive** — specific and quantified, never vague
12. **Include `dashboard_id` in every write** — from your dispatch context. The server rejects mismatches.
13. **Minimum log counts enforced by stage** — `reading_context` ≥1, `planning` ≥2, `implementing` ≥3, `testing` ≥4, `finalizing`/`completed` ≥5. Hooks will warn if you fall below these thresholds.
14. **Add milestones for significant accomplishments** — from `implementing` stage onward, milestones[] must not be empty. Record files created, features implemented, tests passed.
15. **Track every file change in `files_changed[]`** — NON-NEGOTIABLE — add `{ "path": "relative/path", "action": "created|modified|deleted" }` for every project file you create, modify, or delete. Update incrementally as you work. Hooks will warn if `files_changed` is empty during `implementing` stage or later. The dashboard renders this as a clickable file list in the task popup.
