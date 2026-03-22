Upgrade the worker prompt templates in Synapse's two primary orchestration commands (`!p_track` and `!p`) to improve agent output quality and reduce common failure modes. The target project is Synapse itself at {tracker_root} = /Users/dean/Desktop/Working/Repos/Synapse (also {project_root} for this swarm).

This swarm addresses four specific prompt template gaps that lead to lower-quality worker output, under-reported deviations, and context overflow in large swarms.

---

TASK 1: Add a Success Criteria section to the `!p_track` worker prompt template

The lightweight `!p` command at `_commands/Synapse/p.md` includes an explicit `## Success Criteria` section in its worker prompt template (Step 8, around line 170). However, `_commands/Synapse/p_track.md` — the primary, most-used orchestration command — does NOT have a `## Success Criteria` section in its worker prompt template (Step 14, lines 535-668).

The p_track template has a "Prompt Completeness Checklist" (lines 670-683) that mentions "Success criteria" as a checklist item, and the PREPARATION section includes a self-assessment step. But there is no dedicated section in the prompt body where the master places task-specific success criteria for the worker to reference.

Fix: Add a `SUCCESS CRITERIA:` section to the p_track worker prompt template in Step 14. Place it after the `CRITICAL:` section (after line 576) and before the `FILES:` section (line 578). Use this format:

```
SUCCESS CRITERIA:
{Exactly what "done" looks like — specific, verifiable conditions. The worker should be able
to check each criterion and confirm completion. Examples:
- "The middleware is registered in src/app.ts before all route handlers"
- "All existing tests still pass"
- "The new endpoint returns 429 with Retry-After header when rate limited"}
```

This matches the style used in `p.md` Step 8 (lines 170-174) but adapted to p_track's `ALL_CAPS:` formatting convention.

File to modify: `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md`

Success criteria: The p_track worker prompt template includes a SUCCESS CRITERIA section between CRITICAL and FILES. The format is consistent with p_track's existing ALL_CAPS section header style. The Prompt Completeness Checklist at lines 670-683 still references success criteria (it already does — just verify it's consistent).

---

TASK 2: Add EXPORTS field to worker return format in both p_track.md and p.md

When a worker completes a task that creates new functions, types, endpoints, constants, or files, downstream tasks need to know about these exports. Currently, the master must manually extract this information from the worker's summary and files-changed list. An explicit EXPORTS field makes this automatic.

Fix: In both `_commands/Synapse/p_track.md` and `_commands/Synapse/p.md`, add an `EXPORTS:` section to the worker return format, placed between `FILES CHANGED:` and `DIVERGENT ACTIONS:`.

For p_track.md (Step 14, around lines 656-668), the return format currently reads:
```
STATUS: completed | failed
SUMMARY: {one-sentence description of what was done}
FILES CHANGED:
  - {path} ({created | modified | deleted})
DIVERGENT ACTIONS: (omit entirely if none ...)
WARNINGS: (omit entirely if none)
ERRORS: (omit entirely if none)
```

Change it to:
```
STATUS: completed | failed
SUMMARY: {one-sentence description of what was done}
FILES CHANGED:
  - {path} ({created | modified | deleted})
EXPORTS: (omit entirely if no new exports were introduced)
  - {type: function|type|interface|endpoint|constant|file} {name} — {brief description}
  - Example: function validateAuthToken — validates JWT and returns decoded payload
  - Example: type UserProfile — user profile interface with avatar, bio, settings fields
  - Example: endpoint POST /api/auth/refresh — refreshes expired access tokens
DIVERGENT ACTIONS: (omit entirely if none ...)
WARNINGS: (omit entirely if none)
ERRORS: (omit entirely if none)
```

Apply the same change to `_commands/Synapse/p.md` (Step 8, around lines 183-188), adapting to that file's formatting style.

Additionally, update `agent/instructions/tracker_worker_instructions.md` to document the EXPORTS field. Add a brief subsection after the "Rules Summary" section (after line 387) titled "## Return Format — EXPORTS Field" explaining:
- What qualifies as an export (new public functions, types, interfaces, endpoints, constants, files that downstream tasks may depend on)
- That workers should omit the section entirely if no new exports were introduced
- That the master uses EXPORTS to construct the UPSTREAM RESULTS section of downstream worker prompts

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md` — Update return format in Step 14
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p.md` — Update return format in Step 8
- `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/tracker_worker_instructions.md` — Add EXPORTS documentation

Success criteria: Both p_track.md and p.md return formats include the EXPORTS field between FILES CHANGED and DIVERGENT ACTIONS. Worker instructions document the EXPORTS field with clear guidance on what qualifies as an export. The examples in the return format are concrete and illustrative.

---

TASK 3: Rewrite deviation reporting instructions with concrete examples

In `agent/instructions/tracker_worker_instructions.md`, the deviation reporting guidance is too abstract. The current instructions (around line 107) say workers should report "any divergence from the original plan." Workers interpret this narrowly and under-report deviations — they only report when they did something completely different, missing common cases like modifying an unlisted file or using a different API than suggested.

Fix: Rewrite the deviation reporting section in `tracker_worker_instructions.md`. Locate the existing deviation guidance — it appears in multiple places:
1. The mandatory write rule #4 (line 107): "On any deviation from the plan — Add to `deviations[]` AND add a log entry at level `"deviation"`. Do this IMMEDIATELY when the deviation occurs."
2. The "Deviation Entry Format" section (lines 179-184)
3. The "Deviation Severity Levels" section (lines 188-195)

Between the "Deviation Severity Levels" section (after line 195) and the "Reading Upstream Results" section (line 198), add a new subsection:

```
### What Counts as a Deviation — Concrete Examples

A deviation is ANYTHING you did that was not explicitly specified in your dispatch prompt. When in doubt, report it — under-reporting is worse than over-reporting.

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

**The rule is simple: if someone diffed your changes against the task description, would they find anything not mentioned? If yes, it's a deviation. Report it.**
```

File to modify: `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/tracker_worker_instructions.md`

Success criteria: The deviation section includes at least 7 concrete examples in a table with scenario, severity, and example entry. The introductory text redefines "deviation" as "anything not explicitly specified" rather than "divergence from the original plan." The examples cover the most common under-reported categories: unlisted file modifications, different APIs, added error handling, signature changes, helper creation, skipped steps, and incidental bug fixes.

---

TASK 4: Add context budget guidelines to the p_track.md planning phase

Large swarms suffer from context overflow — worker prompts become so long that workers lose track of key details buried in walls of text. The master agent has no explicit guidance on prompt length limits.

Fix: Add a new subsection to `_commands/Synapse/p_track.md` in the planning phase. Place it after Step 6 ("Decompose into tasks," which ends around line 115) and before Step 7 ("Determine parallelization type," which starts at line 117). Title it "Step 6B: Context Budget Check."

Content:

```
### Step 6B: Context Budget Check

Before proceeding to visualization and dispatch, verify that each task's prompt will fit within a reasonable context budget. Oversized prompts cause workers to miss critical details buried in noise.

**Per-task prompt budget guidelines:**

| Section | Max Lines | Notes |
|---|---|---|
| CONVENTIONS | ~200 lines | Extract only sections relevant to THIS task from CLAUDE.md. Do not dump the entire file. |
| REFERENCE CODE | ~100 lines | Include one complete, representative example. If more patterns are needed, summarize the rest. |
| UPSTREAM RESULTS | ~50 lines per dependency | Summarize to key facts: what was built, what files changed, what new exports exist. Do not paste raw summaries. |
| CONTEXT | ~150 lines | Focus on architectural decisions and current file state. Link to files rather than inlining large blocks. |
| Total prompt | ~800 lines | If a prompt exceeds this, the task should be split or context should be summarized further. |

**When a prompt exceeds the budget:**

1. **Summarize, don't paste.** Replace inline code blocks with one-line summaries and explicit file paths the worker can read.
2. **Split the task.** If the context is genuinely needed and cannot be summarized, the task is too large — decompose it further.
3. **Prioritize critical details.** Success criteria and critical gotchas should never be cut for space. Cut reference code and conventions first.
4. **Use READ file lists.** Instead of inlining a 200-line file, add it to the READ list and tell the worker what to look for: "READ: src/auth/middleware.ts — focus on the `validateToken` function signature and error handling pattern."
```

File to modify: `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md`

Success criteria: A new "Step 6B: Context Budget Check" subsection exists between Step 6 and Step 7. It includes specific line limits in a table. It provides four concrete strategies for handling prompts that exceed the budget. The step numbers for subsequent steps (7, 8, 9...) remain unchanged — this is 6B, not a renumbering. Verify that the numbering flow reads naturally: Step 6 -> Step 6B -> Step 7.
