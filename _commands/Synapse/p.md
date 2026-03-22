# `!p {prompt}`

**Purpose:** Lightweight parallel dispatch — deep planning and high-quality worker prompts without any dashboard tracking overhead. The master agent plans, decomposes, and dispatches worker agents with self-contained, context-rich prompts. No XML files, no dashboard writes, no progress files. Pure planning and execution.

**Syntax:** `!p {prompt}`

- `{prompt}` — Natural-language description of the work to be done.

**Examples:**
```
!p refactor the auth flow to use real Firebase Auth
!p migrate all hardcoded colors to CSS variables across the frontend
!p add rate limiting to all HTTP endpoints
```

**Produces no files.** All plan data lives in the conversation context. Workers execute and return — no progress tracking, no live dashboard updates.

> **When to use `!p` vs `!p_track`:**
> - `!p` — Fast, context-efficient. Best for focused tasks where you want speed over live visualization. No dashboard updates.
> - `!p_track` — Full dashboard tracking with live visualization, progress files, event logs, and history. Best for large, long-running swarms where live monitoring matters.

---

## Phase 1: Context & Planning

The master agent's most important job is **deep planning** and **high-quality prompt construction**. Every minute spent here saves ten minutes of worker confusion.

### Step 1: Resolve `{project_root}` and read project context

Resolve `{project_root}` using the standard resolution order (see `{tracker_root}/CLAUDE.md` — Path Convention section): explicit `--project` flag → stored config at `{tracker_root}/.synapse/project.json` → agent's CWD.

Read `{project_root}/CLAUDE.md` (if one exists). If `{project_root}/.synapse/toc.md` exists, read it for semantic orientation. Identify which directories or sub-projects are affected. If those directories have their own `CLAUDE.md` files, read them **in parallel**.

**Extract and cache** the conventions, patterns, tech stack, and constraints that are relevant to this task. These will be embedded directly into worker prompts — workers will not read these files themselves.

### Step 2: Parse the prompt

Extract:
- **Task name** — a short slug for terminal output (e.g., `refactor-auth-flow`)
- **Affected directories** — which parts of the codebase are involved
- **Scope** — what is and isn't included

### Step 3: Deep analysis

Before touching any code, analyze the task thoroughly:

- **Scope boundaries** — what exactly needs to change? What must NOT change?
- **Dependencies** — which changes must happen before others?
- **Shared state** — what files, types, or interfaces are touched by multiple tasks?
- **Edge cases** — what could go wrong? What assumptions might be wrong?
- **Cross-cutting concerns** — testing, types, imports, configuration
- **Risk areas** — complex logic, performance-critical paths, security boundaries

### Step 4: Read all relevant source files

Read every file that workers will need to understand or modify. **Parallelize all reads in a single message.** Cache the contents in working memory — you will embed relevant snippets directly into worker prompts.

Be thorough here. Workers cannot ask follow-up questions. Everything they need must be in their prompt.

### Step 5: Decompose into atomic tasks + map dependencies

Break the work into the smallest independent units that can be executed in parallel. For each task:

| Field | Description |
|---|---|
| **ID** | Wave.Sequence format: `1.1`, `1.2`, `2.1`, etc. |
| **Title** | Concise name |
| **Description** | Detailed specification of what to implement/change |
| **Wave** | Group number — tasks in the same wave are independent of each other |
| **Dependencies** | Which task IDs must complete first (empty for Wave 1) |
| **Files** | READ list + MODIFY list + CREATE list |
| **Context** | Code snippets, patterns, and conventions the worker needs |
| **Critical details** | Gotchas, edge cases, things that are easy to get wrong |
| **Success criteria** | Exactly what "done" looks like |

**Decomposition principles:**
- **No file overlaps within a wave.** Two tasks in the same wave must not modify the same file.
- **Minimize dependencies.** The fewer dependency chains, the more parallelism.
- **Self-contained tasks.** Each task should be completable without knowing about other tasks (except through its explicit dependencies).
- **Right-sized.** Too small = overhead dominates. Too large = loses parallelism. Aim for tasks that take 1-5 minutes each.

### Step 6: Present plan to user

Display the plan inline. Do NOT write any files.

```markdown
## Parallel Plan: {task-name}

**Tasks:** {N} across {W} waves
**Approach:** {1-2 sentence strategy}

### Wave 1 (independent — all dispatch simultaneously)
| # | Task | Files | Depends On |
|---|---|---|---|
| 1.1 | {title} | {key files} | — |
| 1.2 | {title} | {key files} | — |

### Wave 2 (dispatches as deps complete)
| # | Task | Files | Depends On |
|---|---|---|---|
| 2.1 | {title} | {key files} | 1.1 |
| 2.2 | {title} | {key files} | 1.1, 1.2 |

### Wave 3
...

### Dependency Rationale
{Explain WHY tasks are ordered this way — what shared state or sequential logic forces the ordering}
```

**Wait for user approval before dispatching.** If the user suggests changes, incorporate them and re-present.

---

## Phase 2: Execution

### Step 7: Dispatch all independent tasks simultaneously

For every task with no unmet dependencies, dispatch a worker agent using the **Task tool** in a single message with multiple tool calls. All independent tasks launch **simultaneously**.

Use `subagent_type: "general-purpose"` for each worker.

### Step 8: Worker prompt construction

**This is the most critical step.** Each worker gets a self-contained, highly detailed prompt. The worker must be able to complete its task using ONLY the information in the prompt plus the tools available to it. No external tracking files, no XML references.

```
You are executing task {id}: {title}

## What To Do
{Detailed description — not just a title, but exactly what to implement, change, or create.
Be specific about behavior, not just files. "Add rate limiting middleware that limits
each IP to 100 requests per 15-minute window, returning 429 with a Retry-After header"
is better than "add rate limiting".}

## Context
{Why this change is needed. How it fits into the larger task. What the codebase currently
looks like in the relevant area. Include actual code snippets that the worker needs to
understand — don't just say "read src/auth.ts", include the relevant functions.}

## Conventions
{Extracted from the relevant CLAUDE.md — only the sections that apply to this task.
Include naming conventions, file structure rules, import patterns, testing requirements.
Quote directly — don't paraphrase.}

## Reference Code
{Working examples from the codebase that the worker should follow as patterns.
If the worker needs to create a new endpoint and there are existing endpoints,
include a complete example. If the worker needs to follow a specific pattern,
show the pattern with actual code.}

## Files
- READ: {paths the worker should read for additional context}
- MODIFY: {exact paths the worker should edit}
- CREATE: {exact paths for new files, if any}

## Dependencies
{If this task depends on completed upstream work, include:
- What the upstream task did (its summary)
- What files it changed
- Any new interfaces, types, or exports the upstream task created
This gives the worker full awareness of the state of the codebase.}

## Critical Details
{Gotchas, edge cases, things that are easy to get wrong. Be specific:
- "The auth middleware must check req.headers.authorization, not req.headers.auth"
- "The rate limiter must use the X-Forwarded-For header behind the proxy"
- "Do NOT modify the existing /health endpoint — it must remain unauthenticated"}

## Success Criteria
{Exactly what "done" looks like — specific, verifiable conditions:
- "The middleware is registered in src/app.ts before all route handlers"
- "Rate limit info is returned in X-RateLimit-Remaining and X-RateLimit-Reset headers"
- "Existing tests still pass"}

## Rules
- Stay strictly within the scope of this task. Do not refactor, clean up, or improve code outside your task boundaries.
- Do not add features beyond what is specified. No "while I'm here" improvements.
- If you encounter unexpected state that blocks you, complete what you can and clearly report the blocker in your return.
- Do not ask questions — you have all the context you need. If something is ambiguous, make the most reasonable choice and note it.
- When done, return a structured summary:

STATUS: completed | failed
SUMMARY: {one-line description of what was done}
FILES CHANGED: {list of files modified/created/deleted}
EXPORTS: (omit if no new exports)
  - {type: function|type|interface|endpoint|constant|file} {name} — {description}
WARNINGS: {anything the master should know — optional}
ERRORS: {if failed, what went wrong}
```

**Prompt quality checklist — verify before dispatching each worker:**
- [ ] Description is specific enough that someone unfamiliar with the codebase could execute it
- [ ] All code patterns the worker needs to follow are included as actual snippets
- [ ] All files to modify are listed explicitly
- [ ] Success criteria are concrete and verifiable
- [ ] Critical details cover every gotcha you identified in Step 3
- [ ] If this task has dependencies, the upstream results are included

### Step 9: Process completions

As each worker returns:

1. **Parse the return.** Extract status, summary, files changed, warnings, errors.
2. **Terminal confirmation:** Print one line:
   - Success: `✓ {id} {title} — {summary}`
   - Failure: `✗ {id} {title} — {error}`
3. **Record the result in the master's result cache.** For each completed task, store:
   - Task ID, title, status
   - Summary (the worker's one-line description)
   - Files changed (with actions: created/modified/deleted)
   - Any new interfaces, types, exports, or APIs introduced
   - Any deviations or warnings
   This cache persists in the master's working memory and is used to construct downstream prompts. After context compaction, re-read the cache from prior conversation output if needed.
4. **Scan for newly dispatchable tasks.** Check all pending tasks: if ALL of a task's dependencies are now completed, it is ready.
5. **Dispatch newly ready tasks immediately.** Do not wait for other tasks to complete first. The moment a dependency is satisfied, dispatch.
6. **Feed upstream results into downstream prompts.** When constructing a downstream task's prompt, include in the `## Dependencies` section:
   - What the upstream task did (summary)
   - What files it changed
   - Any new interfaces, types, or exports it created
   - Any deviations that affect downstream work

### Step 10: Handle failures

If a worker fails:

1. **Print the failure:** `✗ {id} {title} — {error}`
2. **Identify blocked downstream tasks.** Any task that depends on the failed task (directly or transitively) is now blocked.
3. **Continue dispatching unblocked work.** Failure of one branch does not stop independent branches.
4. **At the end, report all failures and blocked tasks** so the user can decide how to proceed.

**Circuit breaker:** If 3+ tasks fail within the same wave, or a failed task blocks more than half of remaining tasks, **pause dispatching** and assess:
- Is there a shared root cause (bad assumption in the plan, missing dependency, environment issue)?
- Does the plan need revision?
- Should the swarm be cancelled?

Present the assessment to the user. Either continue with justification, revise the plan, or cancel.

### Step 11: Final report

When all tasks are complete (or all remaining are blocked by failures):

```markdown
## Complete: {task-name}

**Result:** {completed}/{total} tasks completed{, {failed} failed if any}
**Duration:** {wall clock time from first dispatch to last completion}

### Results
| # | Task | Status | Summary |
|---|---|---|---|
| 1.1 | {title} | ✅ | {summary} |
| 1.2 | {title} | ✅ | {summary} |
| 2.1 | {title} | ❌ | {error} |
| 2.2 | {title} | ⏸ Blocked by 2.1 | — |
```

If all tasks succeeded: `"All {N} tasks completed successfully."`

If failures exist:
```
### Failed Tasks
- **{id}:** {title} — {error}
  Blocked: {list of downstream tasks that couldn't run}

To retry: address the issue and re-run the failed task manually, or use `!p` with a targeted prompt.
```

### Step 12: Post-swarm verification (when warranted)

After all tasks complete, assess whether verification is needed:

- **Modified existing code across multiple files?** → dispatch a verification agent to run tests, type checking, or build validation
- **Purely additive (new files only, no modifications)?** → verification is optional
- **Any tasks reported deviations?** → verification is strongly recommended
- **All tasks succeeded with no warnings?** → verification may be skipped

If verification is needed, dispatch a single agent with:
```
You are verifying the combined output of a {N}-task parallel swarm: "{task-name}"

## Files Changed
{Complete list of all files created/modified/deleted across all tasks}

## What To Verify
1. Run the project's test suite (if one exists)
2. Run type checking (if applicable)
3. Run the build (if applicable)
4. Check for obvious integration issues: missing imports, conflicting exports, broken references

## Report
Return:
- TESTS: pass | fail | no test suite
- TYPES: pass | fail | N/A
- BUILD: pass | fail | N/A
- ISSUES: {list of any integration problems found, or "None"}
```

Include verification results in the final report.

---

## Non-Negotiable Rules

1. **Plan FIRST, dispatch AFTER.** Never dispatch a single agent before the full plan is approved by the user.
2. **No file overlaps within a wave.** Two simultaneous agents must never modify the same file.
3. **Dispatch the instant dependencies are met.** Never hold a ready task waiting for unrelated work.
4. **Feed upstream results downstream.** Dependent tasks must know what their prerequisites produced.
5. **Continue through failures.** One failed branch must not stop independent work.
6. **Quality over speed in prompts.** A worker with a perfect prompt finishes faster than a worker with a vague prompt that has to figure things out. Invest the time to craft excellent prompts.
7. **The master does NOT write code.** The master plans, dispatches, monitors, and reports. It never edits application files.
8. **Stay in master mode until all tasks complete.** Do not exit to serial mode mid-swarm.
