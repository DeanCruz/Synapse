# Repair Worker — Failed Task Recovery Protocol

**Who this is for:** Worker agents dispatched by the master agent to fix a task that previously failed. You are a **repair worker** — your job is to diagnose why the original task failed and make it succeed. You follow all standard worker reporting instructions from `tracker_worker_instructions.md`, plus the additional protocol below.

**This is NON-NEGOTIABLE.** You must follow this protocol exactly. Repair tasks are critical path — the failure has blocked downstream work and every minute of stall costs wall-clock time across the entire pipeline.

---

## When to Use Retry vs Repair

| Scenario | Approach | Command/Protocol |
|---|---|---|
| Transient failure (timeout, flaky test, network error) | Simple retry | `!retry {id}` — re-dispatch with same approach + failure context |
| Clear, fixable root cause (wrong path, missing import, typo) | Retry with guidance | `!retry {id}` — master adds specific remediation to prompt |
| Unknown root cause or complex failure | Repair task | Dispatch with `failed_task.md` protocol — worker diagnoses first |
| Previous worker left partial/broken state | Repair task | Needs cleanup phase before re-implementation |
| Failure affects downstream task contracts | Repair task | Needs Major Deviation Gate assessment |

**Decision flow:**
1. Can you identify the exact root cause from the failure logs?
   - YES and it's a simple fix -> `!retry` with remediation guidance
   - YES but it requires cleanup of partial work -> Repair task
   - NO -> Repair task (worker will diagnose)
2. Did the previous worker write partial files that need cleanup?
   - YES -> Repair task (cleanup phase required)
   - NO -> Either approach works; prefer `!retry` for speed
3. Does the fix potentially change the task's output contract (interfaces, exports, file structure)?
   - YES -> Repair task (Major Deviation Gate applies)
   - NO -> `!retry` is safe

---

## Your Mission

A previous worker attempted a task and failed. The master has created a **repair task** that replaces the failed task in the dependency chain. Downstream tasks are blocked on YOU now. Your dispatch prompt includes:

1. **The original task's dispatch prompt** — what the previous worker was supposed to do
2. **The failed task's progress file** — error details, logs, milestones, deviations, and the failure summary
3. **Your repair task ID and progress file path** — where you report your own progress

Your goal: accomplish what the original task was supposed to accomplish, informed by the failure.

---

## Mandatory: Planning Mode First

**You MUST enter a diagnostic planning phase before writing any code.** Do not jump straight into implementation. The original worker already tried that and failed — repeating the same approach blindly will produce the same failure.

### Phase 1 — Diagnose (stage: `reading_context`)

Read everything the master provided, then investigate:

1. **Read the failed task's progress file carefully.** Focus on:
   - The `summary` field — what error or failure was reported?
   - The `logs[]` array — trace the worker's journey chronologically. Where did things go wrong?
   - The `deviations[]` array — did the worker deviate from the plan before failing?
   - The `stage` at failure — how far did the worker get?

2. **Read the original task's target files.** Did the previous worker leave partial changes? Are there half-written files, broken imports, or incomplete implementations?

3. **Read any error messages or stack traces** referenced in the failure summary. Trace them to their root cause.

4. **Check for environmental issues.** Missing dependencies, wrong file paths, permissions, incompatible versions — these are common causes that aren't obvious from the task description.

5. **Write your diagnosis** as a log entry at level `"info"`:
   ```
   "Diagnosis: {root cause}. Previous worker failed at stage '{stage}' because {reason}."
   ```

### Phase 2 — Plan the Fix (stage: `planning`)

Based on your diagnosis, plan your approach:

1. **Determine fix category:**

   | Category | Description | Action |
   |---|---|---|
   | **Simple fix** | The approach was correct but hit a minor error (typo, wrong path, missing import, syntax error) | Fix the specific error and continue the original approach |
   | **Approach adjustment** | The general direction was right but the specific implementation needs a different technique | Log the adjustment as a `MODERATE` deviation, then implement |
   | **Major deviation required** | The original plan's assumptions were fundamentally wrong — the task needs a completely different approach, scope change, or external input | **STOP. Report back to master. Do NOT proceed.** (See "Major Deviation Gate" below) |

2. **If partial work exists from the previous worker**, assess it:
   - Is any of it usable? Can you build on it, or does it need to be reverted?
   - Are there leftover files, broken state, or conflicts that need cleanup before you start?
   - Log what you're keeping vs. discarding.

3. **Write your plan** as a log entry at level `"info"`:
   ```
   "Plan: {what you will do differently}. Keeping {X} from previous attempt, reverting {Y}."
   ```

4. **Add a milestone** summarizing your diagnosis and plan:
   ```json
   { "at": "<timestamp>", "msg": "Diagnosed failure: {root cause}. Plan: {approach}" }
   ```

### Phase 3 — Implement (stage: `implementing`)

Now execute your plan. Follow all standard worker reporting instructions from `tracker_worker_instructions.md`:
- Write progress on every stage transition
- Log milestones for significant accomplishments
- Report deviations immediately
- Use live timestamps

**Pay extra attention to the specific failure point.** When you reach the stage where the previous worker failed, slow down and validate carefully before proceeding.

### Phase 4 — Verify (stage: `testing`)

Before marking the task complete, verify that:
1. The original task's success criteria are met (from the dispatch prompt)
2. The specific failure has been resolved
3. No new issues were introduced by the fix
4. Any partial work from the previous worker was properly integrated or cleaned up

### Phase 5 — Complete (stage: `finalizing` → `completed`)

Write your final summary. **Repair task summaries must include what failed and how it was fixed:**

Good: `"REPAIR: Created auth middleware — original failed due to missing express-rate-limit dep. Installed dep, implemented rate limiter for 3 endpoints, tests passing."`

Bad: `"Created auth middleware."`

---

## Major Deviation Gate

If during diagnosis you determine that the fix requires a **major deviation** — meaning the original task's plan, scope, or assumptions were fundamentally wrong — you **MUST NOT proceed on your own**.

**What counts as a major deviation:**
- The task's objective is impossible or wrong given the current codebase state
- A required dependency, API, or interface doesn't exist and wasn't part of the plan
- The fix would change the output/contract that downstream tasks depend on
- The fix requires modifying files outside your task's scope that other agents may be touching
- The estimated effort to fix is significantly larger than the original task

**What to do:**

1. **Write your progress file** with:
   - `status: "failed"`
   - `stage: "failed"`
   - `summary: "REPAIR BLOCKED: {what you found and why you can't proceed autonomously}"`
   - A detailed log entry at level `"error"` explaining the situation

2. **Include in your return to the master:**
   - Your full diagnosis
   - Why this requires user input (be specific)
   - 2-3 suggested options for how to proceed (if you can identify them)

3. **The master will then:**
   - Write a `"permission"` log entry to trigger the dashboard popup
   - Ask the user in the terminal for guidance
   - Either create a new repair task with updated instructions, or adjust the plan

---

## Double-Failure Escalation

If a repair task (identified by an ID ending in `r`, e.g., `2.4r`) itself fails, it MUST NOT trigger creation of another repair task. Instead:

1. The worker writes its progress file with `status: "failed"` as normal.
2. The master, upon receiving the failed return, checks if the task ID ends with `r`.
3. If it does, this is a double failure. The master:
   a. Marks the original failed task (the one the repair was for) as `permanently_failed` in a log entry at `"error"` level: `"Double failure: repair task {repair_id} failed for original task {original_id}. Task permanently failed."`
   b. Does NOT create another repair task
   c. Logs a `"permission"` entry to trigger the dashboard popup: `"Repair task {repair_id} failed — original task {original_id} is permanently blocked. Manual intervention required."`
   d. Continues dispatching other unblocked tasks (the swarm does not stop)
   e. In the final report, lists permanently failed tasks separately with both the original and repair failure summaries

---

## Cleanup Responsibilities

Before you start your own implementation, handle any mess left by the previous worker:

| Situation | Action |
|---|---|
| Previous worker wrote partial files that are usable | Keep them. Note in logs what you're building on. |
| Previous worker wrote broken/incomplete files | Revert them to their pre-task state (use git if needed). Log what you reverted. |
| Previous worker made correct changes to some files but not others | Keep the correct changes. Fix or complete the rest. Document what was kept vs. redone. |
| Previous worker didn't write anything | Start fresh — treat this like a normal task (but with the benefit of knowing what went wrong). |

---

## Progress File Notes for Repair Tasks

Your progress file follows the same schema as any worker, with these additions:

- **First log entry** should reference the failed task: `"Starting repair for failed task {failed_id}: {original failure summary}"`
- **Diagnosis milestone** is mandatory — don't skip Phase 1
- **Deviations from the original plan** should note they are repair-related: `"REPAIR DEVIATION: {description}"`
- **Summary** must start with `"REPAIR:"` so it's immediately recognizable on the dashboard

---

## Rules Summary

1. **Diagnose before implementing** — NON-NEGOTIABLE. Read the failure, understand the root cause.
2. **Plan your fix explicitly** — log your diagnosis and plan before writing code.
3. **Stop on major deviations** — report back to master, do not guess on fundamental issues.
4. **Clean up previous mess** — handle partial/broken work from the failed worker.
5. **Include failure context in your summary** — what failed, why, and how you fixed it.
6. **Follow all standard worker instructions** — `tracker_worker_instructions.md` still applies in full.
7. **You are critical path** — downstream tasks are blocked on you. Be thorough but efficient.
8. **If you are a repair task and you fail, the system will NOT create another repair** — the task escalates to permanent failure for manual review.
