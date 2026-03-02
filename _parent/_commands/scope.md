# !scope {task description} — Blast Radius Analysis

## Overview

Before touching any code, analyze a task to determine its full blast radius — which repos, directories, files, and cross-repo contracts would be affected. Helps the user understand complexity and make informed decisions about whether to proceed, simplify, or break the task into phases.

---

## Usage

```
!scope add a profile picture upload feature
!scope rename the User type to Account
!scope migrate from Firebase Auth to Clerk
!scope fix the checkout total calculation bug
```

---

## Execution Steps

### Step 1: Understand the Task

Parse the task description and identify:
- What is being changed (new feature, refactor, bug fix, migration)?
- Which domains does it touch (auth, payments, UI, database, etc.)?
- Is it additive (new files) or modificative (changing existing files)?

### Step 2: Search for Affected Files

Using Grep, Glob, and `TableOfContentsMaster.md`:

1. Find all files directly related to the task
2. For each file, check its imports and exports to find indirect dependencies
3. For any shared types or API contracts affected, trace all consumers across repos
4. Check for config files, environment variables, or deployment scripts that may need updating

### Step 3: Produce the Analysis

```
## Scope Analysis: {task description}

### Impact Summary

- **Repos affected:** {N} ({list})
- **Files to modify:** {N}
- **Files to create:** {N}
- **Cross-repo contracts affected:** {N}
- **Estimated mode:** Serial / Parallel ({reason})

### Affected Files by Repo

**{repo_1}** ({N} files)
- `path/to/file.ts` — {what changes and why}
- `path/to/file2.ts` — {what changes and why}

**{repo_2}** ({N} files)
- `path/to/file.ts` — {what changes and why}

### Cross-Repo Impact

- {Shared type X must be updated in both repos}
- {API endpoint Y will change — frontend must update call}
- {Environment variable Z needs new value in both .env files}

### Dependencies & Ordering

1. {First: update the backend type definition}
2. {Then: update the backend handler}
3. {Then: update the frontend type + API call}
4. {Finally: update the frontend component}

### Risks

- {Risk 1: description and mitigation}
- {Risk 2: description and mitigation}

### Recommendation

{One of:}
- **Proceed as-is** — scope is manageable
- **Break into phases** — {suggest how to split}
- **Simplify first** — {suggest what to descope}
- **Needs more investigation** — {what's unclear}
```

---

## Rules

- **Do not modify any files.** This command is read-only analysis.
- **Be honest about complexity.** Don't minimize scope to make the task seem easier. The user needs accurate information.
- **Include indirect effects.** A type rename might touch 50 files. A new API endpoint might require auth middleware, validation, tests, and frontend integration. Surface all of it.
- **Run in serial mode.**
