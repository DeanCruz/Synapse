Implement the circuit breaker and automatic replanning system for Synapse. CLAUDE.md (Core Principle 5) documents this mechanism but it has never been implemented. The goal is a master-side replanning approach (not the CLI `--print` process originally described) that detects cascading failures and automatically revises the plan.

The target project is Synapse itself at `/Users/dean/Desktop/Working/Repos/Synapse`. All file paths below are relative to that root.

---

TASK 1 — Circuit breaker detection logic in p_track.md

File: `_commands/Synapse/p_track.md`

Add a "Circuit Breaker Check" substep to the eager dispatch procedure (the section after processing each worker completion/failure). Currently the master logs failures and creates repair tasks but has no threshold-based detection. Add the following:

After every failure event, the master must evaluate three thresholds:
- Threshold A: 3+ tasks have failed within the same wave (count all progress files with `status: "failed"` grouped by the wave ID from `initialization.json` agents[])
- Threshold B: A single failed task blocks 3+ downstream tasks (scan agents[] for any task whose `depends_on` contains the failed task's ID — or the repair task ID that replaced it — and count how many are transitively blocked)
- Threshold C: A single failure blocks more than half of all remaining non-completed tasks

If ANY threshold is hit, the circuit breaker fires. The master must:
1. Log a `"warn"` level entry to `logs.json`: `"Circuit breaker triggered — threshold {A|B|C} hit. Entering replanning mode."`
2. Set a replanning flag (internal master state) that blocks all new dispatches
3. Proceed to the replanning procedure (Task 2)

Add this as a clearly marked subsection titled "Circuit Breaker Check" within the eager dispatch flow, positioned after the repair task creation step and before the "dispatch all available tasks" scan. Include a concrete example showing threshold B being triggered.

Read the current p_track.md in full before editing. The eager dispatch procedure is referenced indirectly — most of the dispatch logic lives in `agent/instructions/tracker_master_instructions.md`. Add the circuit breaker check to p_track.md as a new subsection in the "Phase 2: Execution" section (or equivalent), and cross-reference tracker_master_instructions.md for the detailed dispatch loop.

---

TASK 2 — Master-side replanning procedure in tracker_master_instructions.md

File: `agent/instructions/tracker_master_instructions.md`

Add a new top-level section titled "Circuit Breaker — Automatic Replanning" after the "On Failure — Automatic Recovery via Repair Tasks" section. This section must document the full inline replanning procedure:

When the circuit breaker fires:

Step 1 — Pause dispatches. No new workers are dispatched until replanning completes.

Step 2 — Gather failure context. Read ALL progress files. Build three lists:
- Completed tasks: ID, one-line summary
- Failed tasks: ID, summary, stage at failure, error from logs[], deviations[]
- Pending/blocked tasks: ID, depends_on list, which deps are failed vs completed

Step 3 — Analyze root cause. The master examines the failed tasks and determines:
- Are the failures related? (Same file, same pattern, same dependency?)
- Is there a shared root cause? (Missing prerequisite, wrong assumption in the plan, environmental issue?)
- Which parts of the dependency graph are salvageable?

Step 4 — Produce a revision plan. The master creates a structured revision with four categories:
- `modified`: Existing pending tasks whose descriptions or `depends_on` need updating (e.g., rewiring around a permanently failed chain)
- `added`: New repair/replacement tasks with IDs suffixed with `r` (e.g., `"2.1r"`, `"3.2r"`). Each has: id, title (prefixed "REPAIR:"), wave, depends_on, full task description
- `removed`: Pending tasks that are no longer viable (their entire dependency chain is broken). These are removed from agents[] and their IDs are cleaned from all other tasks' depends_on arrays
- `retry`: Failed tasks to re-dispatch as-is (transient failures like timeouts). Their progress files are deleted so workers start fresh.

Step 5 — Apply the revision to initialization.json. This is the documented exception to the write-once rule:
- Read initialization.json
- For `modified` tasks: update the matching agents[] entry's title, depends_on, or other fields
- For `added` tasks: append new entries to agents[], increment task.total_tasks and the relevant waves[].total
- For `removed` tasks: remove from agents[], decrement task.total_tasks and waves[].total, scan all remaining agents' depends_on arrays and remove any reference to removed task IDs
- For `retry` tasks: delete their progress files from dashboards/{dashboardId}/progress/
- Write the updated initialization.json

Step 6 — Log the replanning outcome. Write an `"info"` level entry: `"Replanning complete — modified: {N}, added: {N}, removed: {N}, retry: {N}. Resuming dispatch."`

Step 7 — Clear the replanning flag and resume the normal eager dispatch scan.

Include a concrete example: 3 tasks in wave 2 fail because they all depend on a shared utility that task 1.3 was supposed to create but created incorrectly. The replanner adds a repair task 1.4r to fix the utility, rewires the 3 failed tasks' dependencies to point at 1.4r, and retries all 3.

Reference the existing repair task creation procedure (already in the file) and note that during replanning, bulk operations replace individual repair task creation.

---

TASK 3 — Replanning UI support in the dashboard

Files:
- `src/ui/hooks/useDashboardData.js` — Update `mergeState()` to recognize a `replanning` swarm state
- `src/ui/App.jsx` — Add an amber banner component that shows when `overall_status === "replanning"`
- `src/ui/components/Header.jsx` — Show a "Replanning" badge in the header when replanning is active
- `public/styles.css` — Add styles for the replanning banner and badge

Currently, `mergeState()` in `useDashboardData.js` derives `overall_status` from progress file statuses (line ~50-59). It sets `in_progress`, `completed`, or `completed_with_errors`. Add a new derivation: if a `"warn"` log entry exists with message matching "Circuit breaker triggered", AND not all tasks are in terminal state, set `overall_status` to `"replanning"`. Alternatively (simpler approach): the master can write a small `replanning` flag file at `dashboards/{dashboardId}/replanning.json` containing `{"active": true, "triggered_at": "...", "reason": "..."}` — the server already watches the dashboard directory. The dashboard reads this file and shows the banner. When replanning completes, the master deletes the file.

For the banner: render it as a fixed amber bar below the stats section with text: "Circuit breaker triggered — replanning in progress" and a pulsing amber dot. When replanning completes (file deleted or flag cleared), the banner disappears.

Read the existing `mergeState()` function, `App.jsx`, and `Header.jsx` before editing to understand the current rendering flow.

---

TASK 4 — Update CLAUDE.md circuit breaker section

File: `CLAUDE.md`

Find the existing circuit breaker documentation in Core Principle 5 (section "Errors Don't Stop the Swarm"). Currently it describes spawning a CLI process with `--print` mode. Replace the "Automatic replanning" paragraph with the master-side approach:

Replace the description of spawning a CLI replanner with: "When the circuit breaker fires, the master performs replanning inline: (a) pauses all new dispatches, (b) reads all progress files to build a full picture of completed, failed, and blocked tasks, (c) analyzes root cause from failure patterns, (d) produces a revision plan with modified, added, removed, and retry categories, (e) applies the revision to initialization.json, and (f) resumes dispatch."

Keep the three threshold definitions exactly as they are. Keep the "Fallback" paragraph but update it: instead of "if the replanner CLI fails to spawn," change to "if replanning analysis fails to produce a valid revision (e.g., the master cannot determine root cause or all remaining tasks are blocked)." The fallback behavior is the same: pause for manual intervention.

Read the full CLAUDE.md before editing. The circuit breaker section is in "Core Principles for Efficient Parallelization" under Principle 5. Be precise with the edit — change only the automatic replanning paragraphs, not the thresholds or the fallback.

---

TASK 5 — Repair task double-failure escalation in failed_task.md

File: `agent/instructions/failed_task.md`

Add a new section titled "Double-Failure Escalation" between the "Major Deviation Gate" section and the "Cleanup Responsibilities" section. Content:

If a repair task (identified by an ID ending in `r`, e.g., `2.4r`) itself fails, it MUST NOT trigger creation of another repair task. Instead:

1. The worker writes its progress file with `status: "failed"` as normal.
2. The master, upon receiving the failed return, checks if the task ID ends with `r`.
3. If it does, this is a double failure. The master:
   a. Marks the original failed task (the one the repair was for) as `permanently_failed` in a log entry at `"error"` level: `"Double failure: repair task {repair_id} failed for original task {original_id}. Task permanently failed."`
   b. Does NOT create another repair task
   c. Logs a `"permission"` entry to trigger the dashboard popup: `"Repair task {repair_id} failed — original task {original_id} is permanently blocked. Manual intervention required."`
   d. Continues dispatching other unblocked tasks (the swarm does not stop)
   e. In the final report, lists permanently failed tasks separately with both the original and repair failure summaries

Also update the "Rules Summary" at the bottom of the file to add rule 8: "If you are a repair task and you fail, the system will NOT create another repair — the task escalates to permanent failure for manual review."

Read the current failed_task.md before editing. It currently has 7 rules in the summary.

---

TASK 6 — Add double-failure handling to tracker_master_instructions.md

File: `agent/instructions/tracker_master_instructions.md`

In the "On Failure — Automatic Recovery via Repair Tasks" section, add a Step 0 before the existing Step 1:

"Step 0 — Check for double failure. If the failed task's ID ends with `r` (it is a repair task), do NOT create another repair task. Instead: (a) log an `"error"` level entry: `"Double failure: repair task {id} failed. Original task permanently blocked."`, (b) log a `"permission"` level entry to trigger dashboard popup, (c) skip Steps 2-6 (no repair task creation), (d) proceed to Step 7 (eager dispatch scan) as normal — other unblocked tasks continue."

Also add a row to the "Common Mistakes" table at the bottom: `| Creating a repair task for a failed repair task | Infinite repair loop — each repair fails and spawns another | Check if the failed task ID ends with 'r'. If so, escalate to permanent failure — do NOT create another repair task. |`

Read the existing file before editing. The failure recovery section starts around line 72.

---

SUCCESS CRITERIA:

1. The circuit breaker detection logic is documented in p_track.md with all three thresholds and clear triggering conditions
2. The full replanning procedure is documented in tracker_master_instructions.md with: pause, gather, analyze, revise, apply, resume steps
3. The dashboard shows a visible replanning state (amber banner) when the circuit breaker is active
4. CLAUDE.md Principle 5 reflects the master-side replanning approach (no CLI spawning)
5. failed_task.md has the double-failure escalation section preventing infinite repair loops
6. tracker_master_instructions.md has the Step 0 double-failure check and the new common mistakes row
7. All changes are additive — no existing functionality is broken or removed (only the CLI spawning description in CLAUDE.md is replaced)
8. All file references use `{tracker_root}` and `{project_root}` placeholders consistently