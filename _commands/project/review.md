# !review — Code Review

## Overview

Reviews recent code changes (staged, unstaged, or specific commits) with full project context. Checks for broken contracts, inconsistent types, convention violations, missing updates, and general code quality.

Unlike a simple linter, this review understands the entire project and can catch breakage across layers (frontend, backend, shared types, config, etc.).

---

## Usage

```
!review                  <- Review all uncommitted changes
!review staged           <- Review only staged changes
!review HEAD~3..HEAD     <- Review the last 3 commits
!review src/api          <- Review uncommitted changes in a specific directory
```

---

## Execution Steps

### Step 1: Identify What Changed

Based on the argument:
- **No argument / "all":** `git diff` and `git diff --staged` in the project
- **"staged":** `git diff --staged`
- **Commit range:** `git diff {range}`
- **Specific directory:** `git diff` scoped to that directory

Collect the full list of changed files and their diffs.

### Step 2: Read Context

For each changed file:
1. Read the full file (not just the diff) to understand context
2. Read the project's `CLAUDE.md` to check convention compliance
3. If the change touches a shared type or API endpoint — find all consumers within the project

### Step 3: Review Each Change

For each file, check:

**Code Quality:**
- Does the change follow the project's conventions (from its `CLAUDE.md`)?
- Are there obvious bugs, edge cases, or error handling gaps?
- Is the code readable and maintainable?
- Are there security concerns (SQL injection, XSS, exposed secrets, etc.)?

**Cross-Layer Impact:**
- Does this change break any API contracts between frontend and backend?
- Does this change a shared type without updating consumers?
- Does this change require a corresponding update elsewhere that wasn't made?
- Are environment variables or config values affected?

**Completeness:**
- Are there related files that should have been updated but weren't?
- Are there missing tests for the changes?
- Does the change need documentation updates?

### Step 4: Produce the Review

```
## Code Review

### Changes Reviewed
- **Directories:** {list}
- **Files changed:** {N}
- **Lines added/removed:** +{N} / -{N}

### Issues

#### Critical
- **{file:line}** — {description of critical issue}
  {explanation of why it's critical and how to fix}

#### Warning
- **{file:line}** — {description}
  {explanation}

#### Suggestion
- **{file:line}** — {description}
  {explanation}

### Cross-Layer Impact

- {Change to X in backend requires update to Y in frontend — not yet done}
- {Shared type Z was modified — consumer at path still uses old shape}

### Missing Changes
- {File that should have been updated but wasn't}
- {Test that should have been added}

### Summary

{Overall assessment: is this change safe to commit/merge? What needs to be addressed first?}
```

---

## Rules

- **Do not modify any files.** This is a read-only review.
- **Be honest, not harsh.** Flag real issues, don't nitpick style preferences that aren't in the `CLAUDE.md`.
- **Prioritize cross-layer issues.** Single-file bugs are easy to spot. Contract breakage across frontend/backend/config is what this command uniquely catches.
- **Run in serial mode.**
