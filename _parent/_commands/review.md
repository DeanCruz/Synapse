# !review — Cross-Repo Code Review

## Overview

Reviews recent code changes (staged, unstaged, or specific commits) with full cross-repo context. Checks for broken contracts, inconsistent types, convention violations, missing consumer updates, and general code quality.

Unlike a single-repo linter, this review understands the entire workspace and can catch cross-repo breakage.

---

## Usage

```
!review                  ← Review all uncommitted changes across all repos
!review staged           ← Review only staged changes
!review HEAD~3..HEAD     ← Review the last 3 commits
!review my-backend      ← Review uncommitted changes in a specific repo
```

---

## Execution Steps

### Step 1: Identify What Changed

Based on the argument:
- **No argument / "all":** `git diff` and `git diff --staged` in every repo
- **"staged":** `git diff --staged` in every repo
- **Commit range:** `git diff {range}` in every repo
- **Specific repo:** `git diff` in that repo only

Collect the full list of changed files and their diffs.

### Step 2: Read Context

For each changed file:
1. Read the full file (not just the diff) to understand context
2. Read the repo's `CLAUDE.md` to check convention compliance
3. If the change touches a shared type or API endpoint — find all consumers in other repos

### Step 3: Review Each Change

For each file, check:

**Code Quality:**
- Does the change follow the repo's conventions (from its `CLAUDE.md`)?
- Are there obvious bugs, edge cases, or error handling gaps?
- Is the code readable and maintainable?
- Are there security concerns (SQL injection, XSS, exposed secrets, etc.)?

**Cross-Repo Impact:**
- Does this change break any API contracts with other repos?
- Does this change a shared type without updating consumers?
- Does this change require a corresponding change in another repo that wasn't made?
- Are environment variables or config values affected?

**Completeness:**
- Are there related files that should have been updated but weren't?
- Are there missing tests for the changes?
- Does the change need documentation updates?

### Step 4: Produce the Review

```
## Code Review

### Changes Reviewed
- **Repos:** {list}
- **Files changed:** {N}
- **Lines added/removed:** +{N} / -{N}

### Issues

#### 🔴 Critical
- **{file:line}** — {description of critical issue}
  {explanation of why it's critical and how to fix}

#### 🟡 Warning
- **{file:line}** — {description}
  {explanation}

#### 🔵 Suggestion
- **{file:line}** — {description}
  {explanation}

### Cross-Repo Impact

- {Change to X in repo A requires update to Y in repo B — not yet done}
- {Shared type Z was modified — consumer in repo C still uses old shape}

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
- **Prioritize cross-repo issues.** Single-file bugs are easy to spot. Cross-repo contract breakage is what this command uniquely catches.
- **Run in serial mode.**
