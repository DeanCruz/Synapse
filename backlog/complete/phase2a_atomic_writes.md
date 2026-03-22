Implement atomic file write operations and dependency graph validation across the Synapse server codebase to eliminate race conditions and prevent invalid dependency graphs. The target project is Synapse itself at `/Users/dean/Desktop/Working/Repos/Synapse`.

This swarm addresses two reliability gaps: (1) server-side file writes use `fs.writeFileSync()` directly, which means a crash or concurrent read mid-write produces truncated/invalid JSON that silently breaks the dashboard, and (2) there is no validation of the dependency graph during planning, so circular dependencies, dangling references, or self-dependencies can slip through and cause deadlocked swarms.

---

## Task 1: Implement `writeAtomic()` utility

**File:** `src/server/utils/json.js`

Create a `writeAtomic(filePath, data)` function that:
1. Accepts a file path and a JavaScript object (or pre-stringified JSON string).
2. If `data` is an object, stringifies it with `JSON.stringify(data, null, 2)`.
3. Writes the content to `{filePath}.tmp` using `fs.writeFileSync(filePath + '.tmp', content, 'utf-8')`.
4. Renames `{filePath}.tmp` to `{filePath}` using `fs.renameSync(filePath + '.tmp', filePath)`. The `rename` syscall is atomic on POSIX and Windows NTFS — the target file is either the old version or the new version, never a partial write.
5. Returns nothing. On error, removes the `.tmp` file if it exists and rethrows.

Also create an async variant `writeAtomicAsync(filePath, data)` that uses `fsPromises.writeFile` and `fsPromises.rename`.

Export both functions from the module. The existing exports (`readJSON`, `readJSONAsync`, `readJSONWithRetry`, `isValidInitialization`, `isValidProgress`) must remain unchanged.

**Current state of json.js:** The file currently has `readJSON`, `readJSONAsync`, `readJSONWithRetry`, `isValidInitialization`, and `isValidProgress`. It requires `fs`, `fsPromises`, `path`, and `PROGRESS_RETRY_MS` from constants. Add the new functions after the existing schema validation functions and before `module.exports`.

**Success criteria:** `writeAtomic` and `writeAtomicAsync` are exported. They write to `.tmp` then rename. Error handling cleans up `.tmp` on failure. Existing functions and exports are unchanged.

---

## Task 2: Update DashboardService.js to use atomic writes

**File:** `src/server/services/DashboardService.js`

Replace all `fs.writeFileSync()` calls in DashboardService.js with the new `writeAtomic()` function from `src/server/utils/json.js`.

**Current writes in DashboardService.js that need replacing:**
- Line 32: `fs.writeFileSync(initFile, JSON.stringify(DEFAULT_INITIALIZATION, null, 2))` in `ensureDashboard()` — replace with `writeAtomic(initFile, DEFAULT_INITIALIZATION)`
- Line 37: `fs.writeFileSync(logsFile, JSON.stringify(DEFAULT_LOGS, null, 2))` in `ensureDashboard()` — replace with `writeAtomic(logsFile, DEFAULT_LOGS)`

**Import change:** Add `writeAtomic` to the require from `../utils/json`:
```javascript
const { readJSON, readJSONAsync, writeAtomic } = require('../utils/json');
```

**Important:** These are the only `writeFileSync` calls in DashboardService.js. The `copyDirSync` function uses `fs.copyFileSync` which is different and should NOT be changed. The `fs.mkdirSync`, `fs.existsSync`, `fs.readdirSync`, `fs.unlinkSync` calls are not file writes and should NOT be changed.

**Success criteria:** All JSON file writes in DashboardService.js go through `writeAtomic()`. The `fs` module import can remain since it is still used for `mkdirSync`, `existsSync`, `readdirSync`, `unlinkSync`, and `copyFileSync`. Existing behavior unchanged — `ensureDashboard()` still creates default files when they are missing.

---

## Task 3: Update worker instructions with explicit atomic write guidance

**File:** `agent/instructions/tracker_worker_instructions.md`

In the existing "Atomic Writes" section (currently at approximately line 149-152, under "## How to Write"), expand the guidance. The current text says:

```
### Atomic Writes

Write the full file every time. Since you are the sole writer, simply construct the entire JSON object in memory and write it all at once. The Write tool does this naturally.
```

Replace that subsection with:

```
### Atomic Writes

Write the full file every time. Since you are the sole writer, simply construct the entire JSON object in memory and write it all at once. The Write tool does this naturally — it writes to a temporary file and renames it into place, so the target file is never in a partially-written state.

**Always use the Write tool for progress file updates.** Do not use manual `echo` or `cat` shell commands to write JSON files — those do not guarantee atomic writes and can produce truncated files if interrupted. The Write tool is the correct and safest approach for all progress file updates.

If for any reason you must write a file via shell (e.g., in a script), use the write-then-rename pattern:
1. Write to `{filePath}.tmp`
2. Rename `{filePath}.tmp` to `{filePath}` (rename is atomic on POSIX and NTFS)
```

**Do not modify any other section of this file.** The rest of the worker instructions must remain exactly as they are.

**Success criteria:** The "Atomic Writes" subsection under "## How to Write" is expanded with the guidance above. All other content in the file is unchanged. The line count of the file increases by approximately 8-10 lines.

---

## Task 4: Create `validateDependencyGraph()` function

**File:** `src/server/utils/validation.js` (new file)

Create a new utility module that exports a `validateDependencyGraph(agents)` function. It accepts the `agents[]` array from `initialization.json` and performs these checks:

**Check A — No circular dependencies (topological sort):**
Build an adjacency list from `depends_on` arrays. Run Kahn's algorithm (BFS topological sort). If the result set has fewer nodes than the total node count, a cycle exists. Return an error object identifying which task IDs are in the cycle (the remaining nodes not processed by Kahn's algorithm).

**Check B — All `depends_on` references point to existing task IDs:**
Build a set of all `agents[].id` values. For each agent, check that every entry in its `depends_on` array exists in the ID set. Return an error listing every dangling reference with the format `{task_id} depends on {missing_id} which does not exist`.

**Check C — No task depends on itself:**
For each agent, check that its own `id` does not appear in its `depends_on` array. Return an error listing any self-referencing task.

**Check D — No orphan tasks (optional warning, not error):**
A task is an orphan if it has no dependencies (empty `depends_on`) AND no other task depends on it. Wave 1 tasks (where `wave === 1`) are exempt from this check — they are root tasks by design. Return a warning (not an error) listing any orphan tasks.

**Return format:**
```javascript
{
  valid: true|false,
  errors: [{ type: 'cycle'|'dangling_ref'|'self_ref', message: '...' }],
  warnings: [{ type: 'orphan', message: '...' }]
}
```

If `errors` is empty, `valid` is `true`. Warnings do not affect `valid`.

**Module structure:**
```javascript
const validateDependencyGraph = (agents) => { ... };
module.exports = { validateDependencyGraph };
```

No external dependencies. Use only Node.js built-ins. Follow the same code style as `src/server/utils/json.js` (CommonJS, no semicolons after function declarations, JSDoc comments on the exported function).

**Success criteria:** The function correctly detects cycles, dangling references, and self-references. Orphan detection works with Wave 1 exemption. Return format is as specified. The file is self-contained with no external dependencies.

---

## Task 5: Document `validateDependencyGraph` in p_track.md as a planning-phase validation step

**File:** `_commands/Synapse/p_track.md`

This is a large command file. Find the section where the master writes `initialization.json` during planning — this is Step 11B (approximately line 370-432 in the full file), specifically after the master writes the `agents[]` array to `initialization.json` and before Step 11C (writing logs.json).

Insert a new substep between 11B and 11C:

```
#### 11B-validate. Validate the dependency graph

Before writing `initialization.json`, validate the planned `agents[]` array:

1. Run `validateDependencyGraph(agents)` (from `src/server/utils/validation.js`) mentally — or if the server provides a validation endpoint, call it.
2. **Check for cycles:** If any circular dependency is detected, STOP. Do not write initialization.json. Report the cycle to the user and re-plan the affected tasks to break the cycle.
3. **Check for dangling references:** If any task's `depends_on` references a non-existent task ID, STOP. Fix the reference before writing.
4. **Check for self-references:** If any task depends on itself, STOP. Remove the self-reference.
5. **Check for orphans (warning only):** If non-Wave-1 tasks have no dependencies and nothing depends on them, warn the user but proceed — orphans may be intentional standalone tasks.

The master agent performs these checks by inspecting the planned `agents[]` array before writing it to `initialization.json`. This is a mental/logical check, not a code execution step — the master reviews the dependency graph it constructed and verifies these invariants hold. The `validateDependencyGraph` function in `src/server/utils/validation.js` documents the exact rules.
```

**Do not modify any other step or section of p_track.md.** This is a large, critical command file and changes must be minimal and surgical.

**Success criteria:** The validation step is inserted in the correct location within the planning phase. The rest of p_track.md is unchanged. The new text is clear about what the master should check and what to do on failure.

---

## Task 6: Add reconciliation scan to WatcherService.js

**File:** `src/server/services/WatcherService.js`
**File:** `src/server/utils/constants.js`

**In constants.js:** Add a new constant:
```javascript
const RECONCILE_INTERVAL_MS = 5000;  // Periodic reconciliation interval for progress file scan
```
Export it alongside the other constants. Insert it after the existing `RECONCILE_DEBOUNCE_MS` line to keep related constants grouped. The existing `RECONCILE_DEBOUNCE_MS` (300ms) is for debouncing directory watcher events and is unrelated — do not modify or rename it.

**In WatcherService.js:** Add a periodic reconciliation mechanism that catches `fs.watch` missed events. `fs.watch` is documented as unreliable on some platforms (network filesystems, some Linux configurations, macOS edge cases with rapid writes).

Implementation:
1. Import `RECONCILE_INTERVAL_MS` from constants (add to existing destructured require on line 7).
2. Import `readJSON` and `isValidProgress` (already imported on line 11).
3. Add a module-level `Map` called `lastKnownProgress` that stores `Map<dashboardId, Map<filename, mtimeMs>>` — the last known mtime for each progress file per dashboard.
4. Create a function `reconcileProgressFiles(id, broadcastFn)` that:
   a. Reads the `progress/` directory for the given dashboard using `fs.readdirSync`.
   b. For each `.json` file, gets its `fs.statSync().mtimeMs`.
   c. Compares against `lastKnownProgress` for that dashboard. If the mtime is newer than the last known value (or the file is new), read it with `readJSON`, validate with `isValidProgress`, and broadcast via `broadcastFn('agent_progress', { dashboardId: id, ...data })`.
   d. Updates `lastKnownProgress` with the new mtime.
   e. Wraps everything in try/catch — reconciliation must never crash the server.
5. Add a module-level `reconcileIntervalTimer` variable.
6. Create a function `startReconciliation(broadcastFn)` that sets up `setInterval` calling `reconcileProgressFiles` for every tracked dashboard at `RECONCILE_INTERVAL_MS`.
7. Create a function `stopReconciliation()` that clears the interval.
8. Call `stopReconciliation()` in the existing `stopAll()` function.
9. Export `startReconciliation` and `stopReconciliation`.

**Current state of WatcherService.js:** The file has `watchDashboard`, `unwatchDashboard`, `startDashboardsWatcher`, `startQueueWatcher`, and `stopAll`. The progress watcher uses `fs.watch` (line 59) which fires on file changes but can miss events. The reconciliation scan is a safety net that catches anything `fs.watch` missed.

**Important:** The reconciliation scan should NOT re-broadcast files that have not changed. Only broadcast when the mtime is newer than the last known value. This prevents duplicate SSE events for files that were already caught by `fs.watch`.

**Caller integration:** The caller (`src/server/index.js`) will need to call `startReconciliation(broadcast)` during startup — but this task should NOT modify index.js. Instead, just export the functions and document in a comment that `startReconciliation(broadcastFn)` should be called after `startDashboardsWatcher(broadcastFn)` in the server startup sequence. A separate integration task or manual step will wire it in.

Actually, to make this fully functional: also modify `src/server/index.js` to call `startReconciliation(broadcast)` during startup. In the `startup()` function, after `startQueueWatcher(broadcast)` (line 155), add:
```javascript
// 5c. Start periodic reconciliation for missed fs.watch events
startReconciliation(broadcast);
```
And in the `shutdown()` function, call `stopReconciliation()` is not needed since `stopAll()` in WatcherService already handles it (you added the call there). But add `startReconciliation` to the destructured import from WatcherService at line 36-38.

**Success criteria:** `RECONCILE_INTERVAL_MS` is exported from constants.js. `reconcileProgressFiles` runs every 5 seconds per dashboard. Only changed files (by mtime comparison) are re-broadcast. The interval is cleaned up on shutdown. `index.js` calls `startReconciliation(broadcast)` during startup. Existing `fs.watch` behavior is unchanged — the reconciliation is purely additive.

---

## Dependencies between tasks

- Task 1 (writeAtomic utility) has no dependencies — Wave 1
- Task 2 (DashboardService update) depends on Task 1
- Task 3 (worker instructions) has no dependencies — Wave 1
- Task 4 (validateDependencyGraph) has no dependencies — Wave 1
- Task 5 (p_track.md documentation) depends on Task 4
- Task 6 (reconciliation scan) has no dependencies — Wave 1

## Success criteria for the swarm

1. `writeAtomic()` and `writeAtomicAsync()` exist in `src/server/utils/json.js` and use the write-then-rename pattern.
2. All `fs.writeFileSync` calls for JSON files in `DashboardService.js` are replaced with `writeAtomic()`.
3. Worker instructions explicitly document atomic write best practices.
4. `validateDependencyGraph()` correctly detects cycles, dangling references, self-references, and orphans.
5. `p_track.md` includes a dependency validation step in the planning phase.
6. Reconciliation scan runs every 5 seconds, catches missed `fs.watch` events, and is wired into server startup/shutdown.
7. The server starts and runs without errors after all changes.
8. No existing behavior is broken — all changes are additive or drop-in replacements.
