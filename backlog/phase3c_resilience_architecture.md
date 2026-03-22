Strengthen Synapse's resilience architecture across four areas: worker output validation, progress file reconciliation, wave/dependency language decoupling, and master state checkpointing. Each improvement addresses a known fragility in the current system.

The target project is Synapse itself at `/Users/dean/Desktop/Working/Repos/Synapse`. All file paths below are relative to that root.

---

TASK 1 — Worker output validation in p_track.md and tracker_master_instructions.md

Files:
- `_commands/Synapse/p_track.md`
- `agent/instructions/tracker_master_instructions.md`

Currently, when a worker returns to the master, the master processes the return text but does not validate its structure. Add a validation step that runs after each worker returns and before processing the completion.

In `_commands/Synapse/p_track.md`, in the Phase 2 execution section (the part where the master processes worker returns), add a subsection titled "Worker Return Validation" between receiving the return and logging the completion. Content:

After a worker agent returns, the master must parse the return text and validate these required sections before treating it as a successful completion:

| Section | Required? | Validation |
|---|---|---|
| STATUS | Yes | Must be present. Must be one of: `COMPLETED`, `FAILED`, `PARTIAL`. If missing, treat the return as a failure — log `"error"` level: `"Worker returned without STATUS section — treating as failure."` |
| SUMMARY | Yes | Must be present and non-generic. If empty or matches generic patterns (`"Done"`, `"Completed"`, `"Finished"`, `"Task complete"`), log `"warn"` level: `"Worker returned generic summary — quality check needed."` Still count as completed, but flag for review. |
| FILES CHANGED | Conditional | If the task was expected to modify files (i.e., the task description mentions creating, modifying, or editing files), this section should list specific file paths. If empty or missing for a file-modifying task, log `"warn"` level: `"Worker reported no files changed for a task expected to modify files."` |
| DIVERGENT ACTIONS | Optional | If present, parse each deviation and log at `"deviation"` level in logs.json. This is already documented but restating here for completeness. |

If STATUS is `FAILED`, follow the existing failure recovery procedure (repair task creation). If STATUS is `PARTIAL`, treat as completed but log a `"warn"` entry and include the incomplete items in the final report.

In `agent/instructions/tracker_master_instructions.md`, add a corresponding section titled "Worker Return Validation" in the "Write Timing" area (or after the eager dispatch section). Include the same validation table and specify: "This validation runs BEFORE the eager dispatch scan. A worker that returns without a STATUS section is treated as failed — the master creates a repair task per the standard failure recovery procedure."

Read both files in full before editing. In p_track.md, the worker return handling is in Phase 2 (execution). In tracker_master_instructions.md, the relevant area is the "Eager Dispatch" section and the "Write Timing" section.

---

TASK 2 — Progress file reconciliation in WatcherService.js

Files:
- `src/server/services/WatcherService.js`
- `src/server/utils/constants.js`

`fs.watch` is known to be unreliable on some platforms (macOS sometimes misses events, NFS/network mounts drop events entirely). Add a periodic reconciliation mechanism as a safety net.

In `src/server/utils/constants.js`, add a new constant:
```javascript
const PROGRESS_RECONCILE_MS = 5000;  // Periodic reconciliation interval for progress files
```
Export it alongside the existing constants.

In `src/server/services/WatcherService.js`, implement the following changes:

1. Add a `reconcileTimer` per dashboard (or a single global timer) that fires every `PROGRESS_RECONCILE_MS` milliseconds.

2. The reconciliation function for each dashboard:
   a. Read all `.json` files in `dashboards/{dashboardId}/progress/`
   b. For each file, stat its mtime
   c. Compare against a `lastKnownMtimes` map (stored per dashboard in the `dashboardWatchers` Map entry)
   d. If any file has a newer mtime than last known, read it and broadcast an `agent_progress` SSE event
   e. If any files exist that aren't in the map (new files missed by fs.watch), read and broadcast them
   f. If any files in the map no longer exist (deleted during reset), remove them from the map
   g. Update `lastKnownMtimes` with current mtimes

3. Start the reconciliation timer when `watchDashboard()` is called. Stop it when `unwatchDashboard()` is called. Store the timer handle in the `dashboardWatchers` Map entry alongside `initFile`, `logsFile`, and `progressWatcher`.

4. On SSE client connect (this requires a small change): add an export `getFullDashboardState(id)` that reads `initialization.json` + all progress files for a dashboard and returns the merged data. This can be called from `index.js` or `SSEManager.js` when a new client connects to send the full initial state. Currently, the SSE connection sends events only on changes — a client that connects mid-swarm may miss earlier progress updates.

Read the current `WatcherService.js` in full before editing. It currently has:
- `watchDashboard(id, broadcastFn)` — watches init, logs, and progress via fs.watch
- `unwatchDashboard(id)` — cleanup
- `startDashboardsWatcher(broadcastFn)` — watches the dashboards/ directory
- `startQueueWatcher(broadcastFn)` — watches the queue/ directory
- `stopAll()` — cleanup

The `dashboardWatchers` Map stores `{ initFile, logsFile, progressWatcher }` per dashboard. You need to add `reconcileTimer` and `lastKnownMtimes` to this entry.

Also read `src/server/SSEManager.js` and `src/server/index.js` to understand how SSE events are broadcast and where `getFullDashboardState` would be called on client connect.

---

TASK 3 — Decouple wave-based language from dispatch logic

Files to audit and update:
- `_commands/Synapse/p_track.md`
- `_commands/Synapse/resume.md`
- `_commands/Synapse/dispatch.md`
- `_commands/Synapse/retry.md`
- `agent/instructions/tracker_master_instructions.md`

Read ALL five files in full. Search for any language that implies wave-based dispatch ordering. Common patterns to look for:
- "dispatch Wave N" or "dispatch wave N"
- "after Wave N completes"
- "when all wave N tasks are done"
- "proceed to the next wave"
- "wave-by-wave"
- Any sentence that uses wave completion as a dispatch gate

For each instance found:
1. Replace with explicit dependency-driven language. Example: "dispatch Wave 2 after Wave 1 completes" becomes "dispatch any task whose `depends_on` list is fully satisfied — this may include tasks from any wave."
2. If the sentence describes a legitimate visual grouping (e.g., "Wave 1 contains the foundation tasks"), keep it — waves as a visual concept are fine. Only change language that implies waves control dispatch ordering.

In `_commands/Synapse/p_track.md`, add a prominent callout box at the beginning of the Phase 2 (Execution) section:

> **WAVES ARE VISUAL ONLY.** Dispatch is driven exclusively by individual task dependencies (`depends_on` arrays), not by wave boundaries. A task in wave 5 with all dependencies satisfied is dispatchable immediately — even if waves 2, 3, and 4 still have running tasks. If you removed the `wave` field from every agent, the dispatch logic should not change at all.

In `agent/instructions/tracker_master_instructions.md`, there is already a section titled "Waves Are Visual, Not Execution Barriers." Verify it is strong enough. If any other part of the same file contradicts it (e.g., wave-dispatch log messages like "Dispatching Wave 2"), update those to dependency-driven language like "Dispatching 4 newly unblocked tasks (2.1, 2.2, 2.3, 2.4)."

Check the logs.json write points table in tracker_master_instructions.md — it currently has "Wave dispatched" as an event pattern: `"Dispatching Wave {N}: {M} agents — {wave name}"`. Change this to: `"Dispatching {M} tasks: {task IDs} — dependencies satisfied"`. The wave information can be included parenthetically: `"Dispatching 4 tasks (2.1, 2.2, 2.3, 2.4) — dependencies satisfied (Wave 2: Services)"`.

---

TASK 4 — Master state checkpoint for context compaction recovery

Files:
- `_commands/Synapse/p_track.md`
- `agent/instructions/tracker_master_instructions.md`
- `CLAUDE.md`

The master agent loses all cached state when context compaction occurs (the LLM context window fills up and earlier messages are summarized/dropped). Currently the master must re-read initialization.json and all progress files to reconstruct its state. Add a lightweight checkpoint mechanism.

In `_commands/Synapse/p_track.md`, add a subsection to the Phase 2 (Execution) section titled "Master State Checkpoint":

After every dispatch event (worker dispatched, worker completed, worker failed), the master should write a state checkpoint to:
```
{tracker_root}/dashboards/{dashboardId}/master_state.json
```

The checkpoint contains:
```json
{
  "last_updated": "2026-03-21T15:30:00Z",
  "completed": [
    { "id": "1.1", "summary": "Created auth middleware — 3 endpoints protected" },
    { "id": "1.2", "summary": "Set up database schema — 4 tables created" }
  ],
  "in_progress": ["2.1", "2.3"],
  "failed": [
    { "id": "2.2", "summary": "Failed: missing dependency express-rate-limit", "repair_id": "2.4r" }
  ],
  "ready_to_dispatch": ["3.1"],
  "upstream_results": {
    "1.1": "Created auth middleware with rate limiting for /api/auth, /api/users, /api/admin. Exports: authMiddleware, rateLimiter.",
    "1.2": "Created User, Session, Permission, AuditLog tables. Migration file: 001_initial_schema.sql."
  },
  "next_agent_number": 5,
  "permanently_failed": []
}
```

**Write rules:**
- Write the full file on every update (atomic, like progress files)
- This is the master's own state file — workers never read or write it
- `upstream_results` stores one-line summaries per completed task, used for injecting into downstream worker prompts
- `next_agent_number` tracks the agent numbering counter so re-dispatch after compaction uses the right numbers
- Keep summaries short (one line each) — this file should stay under 2000 tokens

**Recovery procedure:** If the master experiences context compaction (detected by losing track of which tasks are dispatched), it should:
1. Read `dashboards/{dashboardId}/master_state.json`
2. Read `dashboards/{dashboardId}/initialization.json` (for the full plan)
3. Read all files in `dashboards/{dashboardId}/progress/` (for ground truth)
4. Cross-reference checkpoint against progress files (progress files are authoritative if they conflict)
5. Resume the eager dispatch loop

In `agent/instructions/tracker_master_instructions.md`, add a section titled "Master State Checkpoint" near the end (before the Common Mistakes table). Include:
- The file path: `{tracker_root}/dashboards/{dashboardId}/master_state.json`
- The schema (same as above)
- When to write: after every dispatch, completion, or failure event
- When to read: on context compaction recovery, or when the master loses track of state
- Note: this file is NOT watched by the server and NOT broadcast via SSE — it is purely for master self-recovery

In `CLAUDE.md`, in the "Directory Structure" section, add `master_state.json` to the dashboard directory listing:
```
├── dashboards/
│   ├── dashboard1/
│   │   ├── initialization.json
│   │   ├── logs.json
│   │   ├── master_state.json          ← Master state checkpoint (context recovery)
│   │   └── progress/
```

Also in the "Data Architecture" section, add a brief subsection titled "master_state.json":
"The master's state checkpoint, written after every dispatch event. Contains: completed task IDs and summaries, in-progress task IDs, failed tasks with repair IDs, ready-to-dispatch tasks, upstream result summaries, and the next agent number. Used for recovery after context compaction. Not watched by the server — purely for master self-recovery. Located at `{tracker_root}/dashboards/{dashboardId}/master_state.json`."

Also add `master_state.json` to the "The Only Files the Master Agent Writes" table in the master agent role section:
| `dashboards/{dashboardId}/master_state.json` | State checkpoint for context compaction recovery |

Read all three files in full before editing. The directory structure in CLAUDE.md is in the "Directory Structure" section. The "Only Files the Master Agent Writes" table is in the "Master Agent Role" section. The "Data Architecture" section is near the end of CLAUDE.md.

---

SUCCESS CRITERIA:

1. Worker return validation is documented in both p_track.md and tracker_master_instructions.md with the validation table and handling for missing STATUS, generic SUMMARY, and empty FILES CHANGED
2. WatcherService.js has a periodic reconciliation mechanism that catches missed fs.watch events, with configurable interval via PROGRESS_RECONCILE_MS constant
3. WatcherService.js exports a `getFullDashboardState(id)` function for initial SSE client state
4. No command file implies wave-based dispatch ordering — all dispatch language is dependency-driven
5. p_track.md has the "WAVES ARE VISUAL ONLY" callout box
6. tracker_master_instructions.md log patterns use task-ID-based dispatch messages instead of wave-based
7. master_state.json checkpoint is documented in p_track.md, tracker_master_instructions.md, and CLAUDE.md with full schema and recovery procedure
8. CLAUDE.md directory structure and data architecture sections include master_state.json
9. CLAUDE.md "Only Files the Master Agent Writes" table includes master_state.json
10. All changes are backward-compatible — existing swarm execution is not broken by any of these additions
11. WatcherService.js changes maintain zero-dependency constraint (only Node.js built-in `fs` and `path`)