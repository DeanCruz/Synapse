# Deviation Reporting

A deviation is any divergence from the original plan — anything the worker does that was not explicitly specified in its dispatch prompt. Deviations are not failures. They are expected in complex tasks. But they must be visible so the master agent and the user can assess their impact on the swarm.

This document covers the deviation reporting protocol, severity classification, concrete examples, and how deviations flow through the system.

---

## What Counts as a Deviation

**The rule is simple:** If someone diffed the worker's changes against the task description, would they find anything not mentioned? If yes, it is a deviation. Report it.

Deviations include:

- Modifying a file not listed in the dispatch prompt's FILES list
- Using a different API, library, or method than what the prompt suggested
- Adding error handling, validation, or logic not specified in the task
- Changing a function signature, parameters, or return type
- Creating a helper function, utility, or file not in the plan
- Skipping a step from the task description
- Discovering and fixing a pre-existing bug while implementing
- Choosing a different approach because the planned approach was not feasible
- Resolving an ambiguity in the dispatch prompt with a judgment call

**When in doubt, report it.** Under-reporting is worse than over-reporting. A reported deviation is information. An unreported deviation is a hidden risk.

---

## Severity Levels

Every deviation **must** include a `severity` field. This is not optional. The master agent uses severity to decide how to handle the deviation.

### CRITICAL

**Meaning:** Changes an API, interface, or contract that downstream tasks depend on. May block other agents.

**Impact:** The master agent may need to re-plan downstream tasks, update their dispatch prompts, or re-dispatch them with corrected context.

**Examples:**
- Changed a function signature that other tasks import: `createUser(name, email)` became `createUser(userData: CreateUserInput)`
- Changed an exported type or interface that downstream tasks reference
- Changed an API endpoint path or response shape that other tasks call
- Renamed an exported function, class, or constant that appears in other tasks' prompts
- Changed the file location of an export that other tasks expect at a specific path

**When to use:** Whenever the deviation could cause a downstream task to fail because it relies on the interface, contract, or API that was changed.

### MODERATE

**Meaning:** Different approach or implementation than planned, but produces the same outcome. Does not affect downstream tasks.

**Impact:** The master notes it for review but no re-planning is needed. The swarm continues normally.

**Examples:**
- Modified a file not in the original FILES list because it was required for compilation
- Used `fs.promises.readFile` instead of the suggested `fs.readFileSync` because the codebase uses async patterns
- Created an unplanned helper function to extract shared logic
- Skipped adding a migration file because the schema already had the required column
- Used a different library method to achieve the same result
- Resolved an ambiguity in the prompt by making a conservative choice

**When to use:** Whenever the worker did something differently than planned but the end result is functionally equivalent and does not change any interface that other tasks depend on.

### MINOR

**Meaning:** Cosmetic or naming differences with no functional impact.

**Impact:** The master can safely ignore these. They exist for completeness.

**Examples:**
- Renamed a local variable for clarity
- Adjusted whitespace or formatting
- Added a comment not specified in the plan
- Fixed a typo in existing code discovered during implementation
- Fixed an off-by-one error in existing pagination logic encountered while adding a new endpoint
- Reordered imports to match the project's convention

**When to use:** Whenever the change has zero functional impact and cannot affect any other task.

---

## Deviation Entry Format

Each entry in the `deviations[]` array follows this format:

```json
{
  "at": "2026-02-25T14:07:00Z",
  "severity": "MODERATE",
  "description": "Modified src/utils/helpers.ts to add a missing export — not in original file list but required for the new endpoint to compile"
}
```

| Field | Type | Description |
|---|---|---|
| `at` | `ISO 8601 string` | Timestamp when the deviation occurred. Always a live timestamp. |
| `severity` | `string` | One of: `"CRITICAL"`, `"MODERATE"`, `"MINOR"`. See [Severity Levels](#severity-levels). |
| `description` | `string` | What changed, why it changed, and what the impact is. Be specific. |

### Writing Good Deviation Descriptions

A deviation description should answer three questions:

1. **What happened?** — What did the worker do that was not in the plan?
2. **Why?** — What prompted the deviation? (missing file, incompatible interface, existing pattern, ambiguity)
3. **What is the impact?** — Does this affect downstream tasks? Does it change any interfaces?

**Good examples:**

```
"Modified src/utils/helpers.ts to add a missing export — not in original file list but required for the new endpoint to compile"

"Used fs.promises.readFile instead of the suggested fs.readFileSync — async version is consistent with the existing codebase pattern"

"Changed createUser(name, email) to createUser(userData: CreateUserInput) — upstream interface was incompatible with the existing validation middleware"

"Added input validation for empty strings on the name field — not specified but prevents a runtime error discovered during implementation"
```

**Bad examples:**

```
"Changed something"

"Had to modify a file"

"Used a different approach"
```

---

## When to Report Deviations

### Immediately (NON-NEGOTIABLE)

Deviations must be reported **immediately when they occur** — not at the end of the task, not during the finalizing stage, but right when the worker makes the divergent decision. This ensures:

1. The dashboard shows the deviation badge in real-time
2. The master agent can see deviations while the swarm is still running
3. The user has immediate visibility into plan divergences

### How to Report

When a deviation occurs, the worker must do two things simultaneously:

1. **Add an entry to `deviations[]`** in the progress file
2. **Add a log entry at `level: "deviation"`** so it appears in both the popup log box and the main log panel

Example progress file update when a deviation occurs:

```json
{
  "deviations": [
    {
      "at": "2026-02-25T14:07:00Z",
      "severity": "MODERATE",
      "description": "Created src/utils/sanitize.ts with sanitizeInput() helper — extracting shared logic between the two endpoints this task creates"
    }
  ],
  "logs": [
    { "at": "2026-02-25T14:07:00Z", "level": "deviation", "msg": "Created unplanned src/utils/sanitize.ts — shared sanitization logic for both endpoints" }
  ]
}
```

---

## Deviations in the Return Format

When the worker completes and returns its result to the master, deviations are also included in the `DIVERGENT ACTIONS` section:

```
DIVERGENT ACTIONS:
  - [MODERATE] Created src/utils/sanitize.ts with sanitizeInput() helper — extracting shared logic between the two endpoints this task creates
  - [MINOR] Fixed off-by-one error in existing pagination logic — discovered while adding the new endpoint
```

This ensures the master has the full deviation record even if it does not read the progress file.

---

## How the Master Uses Deviations

The master agent processes deviations based on severity:

| Severity | Master Action |
|---|---|
| `CRITICAL` | Re-plan downstream tasks. Update dispatch prompts to reflect the actual interface/API. May re-dispatch affected tasks with corrected context. |
| `MODERATE` | Note for review. Include in the final swarm report. No re-planning needed. |
| `MINOR` | Ignore during swarm execution. Include in the final report for completeness. |

### Feeding CRITICAL Deviations Downstream

When a task completes with `CRITICAL` deviations and has dependent tasks waiting, the master must:

1. Read the completed task's deviations
2. Update the downstream tasks' dispatch prompts to reflect the actual state
3. Include the deviation context in the UPSTREAM RESULTS section of the downstream prompt

This is why immediate reporting is critical — the master needs to know about CRITICAL deviations before dispatching downstream tasks.

---

## Dashboard Display

Deviations are surfaced in multiple places on the dashboard:

| Location | Display |
|---|---|
| Agent card | Yellow "N deviation(s)" badge if `deviations[]` is non-empty |
| Agent details modal | Full deviation list with severity badges and timestamps |
| Log panel | Deviation-level entries displayed with yellow badges |
| Log panel filter | "Deviation" filter button to show only deviation-level log entries |

---

## Common Deviation Scenarios

The following table provides a quick reference for common situations workers encounter and how to classify them:

| Scenario | Severity | Why |
|---|---|---|
| Modified a file not in the FILES list | MODERATE | Different scope, same outcome |
| Used a different API/library method than suggested | MODERATE | Different approach, same result |
| Added error handling not specified in the task | MINOR | Defensive coding, no functional change |
| Changed a function signature (parameters, return type) | CRITICAL | Interface change affects dependents |
| Created an unplanned helper function or file | MODERATE | New artifact, but no interface change |
| Skipped a step from the task description | MODERATE | Scope change, needs review |
| Fixed a pre-existing bug discovered during implementation | MINOR | Incidental fix, no planned change |
| Changed an exported type or interface | CRITICAL | Contract change affects dependents |
| Renamed a local variable for clarity | MINOR | Cosmetic, zero functional impact |
| Resolved an ambiguity with a judgment call | MODERATE | Undocumented decision, needs review |

---

## Handling Ambiguity as Deviations

When the worker encounters an ambiguous or unclear requirement and must make a judgment call, this is a deviation. The resolution priority order is:

1. **Check the dispatch prompt** — re-read carefully, the answer may already be there
2. **Check `{project_root}/CLAUDE.md`** — conventions override general assumptions
3. **Make the most conservative choice** — change the least, break nothing, follow existing patterns
4. **Document it as a deviation** with severity `MODERATE` (or `CRITICAL` if the choice affects downstream tasks)
5. **Add a log entry at `level: "warn"`** — make the ambiguity visible

**Never guess silently.** An undocumented guess looks like a bug during review. A documented conservative choice looks like good judgment.
