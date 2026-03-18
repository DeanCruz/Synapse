# !plan {task} — Implementation Plan (No Execution)

## Overview

Produces a detailed implementation plan for a task without writing any code. Reads all relevant context, identifies every file to create or modify, maps dependencies, determines the right execution mode (serial vs. parallel), and presents the full plan for user approval.

Use this when you want to understand the full scope of a change before committing to it.

---

## Usage

```
!plan add user profile picture upload
!plan refactor the auth middleware to support API keys
!plan fix the checkout total calculation bug
!plan migrate from REST to tRPC
```

---

## Execution Steps

### Step 1: Gather Context

1. Read `{project_root}/.synapse/toc.md` to identify relevant directories and files
2. Read the project's `CLAUDE.md` for architecture and conventions
3. Use Grep/Glob to find all files related to the task
4. Read the key files to understand current implementation
5. Identify cross-layer contracts, shared types, and config dependencies

### Step 2: Design the Plan

For each change required:
- **Which file** (existing or new)
- **What changes** (specific description of the modification)
- **Why** (what this change achieves in the context of the task)
- **Dependencies** (what must be done before this change)
- **Risks** (what could go wrong)

### Step 3: Determine Execution Mode

Based on the plan:
- **Serial** if <=3 changes with dependencies between them
- **Parallel** if 3+ independent changes across different areas of the project

### Step 4: Present the Plan

```
## Implementation Plan: {task}

### Context Summary
{2-3 sentences: what currently exists, what needs to change, why}

### Execution Mode: {Serial / Parallel}
{Brief justification}

### Changes

#### 1. {Change title}
- **File:** `{path/file.ext}` ({create / modify})
- **What:** {Specific description of the change}
- **Why:** {How this contributes to the task}
- **Depends on:** {None / Change #N}

#### 2. {Change title}
- **File:** `{path/file.ext}` ({create / modify})
- **What:** {Specific description}
- **Why:** {Justification}
- **Depends on:** {Change #1}

{...continue for all changes...}

### Dependency Order

```
Change #1 (no deps)
    |-- Change #2 (depends on #1)
    |   |-- Change #4 (depends on #2)
    |-- Change #3 (depends on #1)
Change #5 (no deps, parallel with #1)
```

### Cross-Layer Impact
- {Any shared types, API contracts, or config that spans frontend/backend/etc.}

### Risks & Mitigations
- **{Risk}:** {mitigation}

### Testing Strategy
- {How to verify the changes work}

### Estimated Scope
- **Files to modify:** {N}
- **Files to create:** {N}
- **Areas affected:** {list}
```

### Step 5: Wait for Approval

After presenting the plan, ask the user:
- **Proceed?** Execute the plan as designed
- **Modify?** Adjust specific parts of the plan
- **Abort?** Cancel the task

Do NOT begin execution until the user approves.

---

## Rules

- **Do not write any code.** This command produces a plan only.
- **Be specific.** "Update the file" is not a plan. "Add a `phone?: string` field to the `UserProfile` interface at line 15" is a plan.
- **Include testing.** Every plan should have a verification strategy.
- **Run in serial mode.** This is a read-only analysis.
