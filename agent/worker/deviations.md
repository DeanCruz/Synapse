# Worker Guide — Deviation Reporting

**Who this is for:** Worker agents dispatched during a `!p_track` swarm. This document is your complete reference for recognizing, classifying, and reporting deviations from the master agent's plan.

---

## What Is a Deviation?

A deviation is ANYTHING you did that was not explicitly specified in your dispatch prompt. When in doubt, report it — under-reporting is worse than over-reporting.

**The rule is simple: if someone diffed your changes against the task description, would they find anything not mentioned? If yes, it's a deviation. Report it.**

---

## When to Report Deviations

Reporting deviations is **mandatory write #4** in the worker progress protocol. On any deviation from the plan:

1. Add an entry to your `deviations[]` array **IMMEDIATELY** when the deviation occurs — do not batch them for the end of the task.
2. Add a corresponding log entry at `level: "deviation"` in your `logs[]` array.

Both updates must happen at the same time, in the same progress file write. This is NON-NEGOTIABLE. Skipping deviation reporting is a failure.

---

## How Deviations Appear on the Dashboard

- **Deviation badge** — A yellow "N deviation(s)" badge appears on your task card whenever your `deviations[]` array is non-empty. This is visible in real-time as soon as you write the deviation to your progress file.
- **Agent details popup** — When the user clicks your card, the full deviation list is shown in the detail modal.
- **Log panel** — The dashboard log panel has a "Deviation" filter button. Your `level: "deviation"` log entries appear there, giving the user a cross-agent view of all plan divergences.

---

## Deviation Entry Format

Each entry in the `deviations` array:

```json
{ "at": "ISO 8601 timestamp", "severity": "MODERATE", "description": "What changed and why" }
```

Always capture the timestamp live using:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

**Never guess or construct timestamps from memory.**

Example progress file snippet with a deviation:

```json
{
  "deviations": [
    { "at": "2026-02-25T14:07:00Z", "severity": "MODERATE", "description": "Used fs.promises.readFile instead of suggested fs.readFileSync — async version matches existing codebase pattern" }
  ],
  "logs": [
    { "at": "2026-02-25T14:07:00Z", "level": "deviation", "msg": "Used fs.promises.readFile instead of suggested fs.readFileSync — async version matches existing codebase pattern" }
  ]
}
```

---

## Deviation Severity Levels

Every deviation **must** include a `severity` field. Classify each deviation into one of these three levels:

| Severity | Meaning | Example |
|---|---|---|
| `CRITICAL` | Changes an API, interface, or contract that downstream tasks depend on. May block other agents. | Changed a function signature that other tasks import |
| `MODERATE` | Different approach or implementation than planned, but produces the same outcome. Does not affect downstream. | Used a different library method to achieve the same result |
| `MINOR` | Cosmetic or naming differences with no functional impact. | Renamed a variable for clarity, adjusted whitespace |

The master agent uses severity to decide whether to re-plan downstream tasks (`CRITICAL`), note for review (`MODERATE`), or ignore (`MINOR`).

### How the Master Uses Severity

| Severity | Master Action |
|---|---|
| `CRITICAL` | May trigger replanning of downstream tasks. The master reviews whether dependent tasks need updated prompts or different approaches. |
| `MODERATE` | Noted for review during the final report. Does not trigger replanning unless combined with other issues. |
| `MINOR` | Generally ignored during orchestration. Included in the final report for completeness. |

---

## What Counts as a Deviation — Concrete Examples

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

---

## Handling Ambiguity as a Deviation

When you encounter something unclear or ambiguous during execution — a vague requirement, a missing detail, or conflicting information — and you resolve it by making a judgment call, that resolution is a deviation. Specifically:

1. Make the most conservative choice (changes the least, breaks nothing, follows existing patterns).
2. Document it as a deviation with severity `MODERATE` unless the choice affects downstream tasks (then use `CRITICAL`).
3. Add a log entry at level `"warn"` making the ambiguity visible in the dashboard logs.

**Never guess silently.** An undocumented guess looks like a bug when the master reviews your work. A documented conservative choice looks like good judgment.
