Optimize worker efficiency by creating lightweight instructions for simple tasks, improve upstream result injection with size caps, replace vague self-assessment with a falsifiable checklist, and add SSE reconnection with full state catch-up. The target project is Synapse itself at `/Users/dean/Desktop/Working/Repos/Synapse`.

This swarm modifies both instruction/command markdown files and server-side JavaScript code. The markdown changes affect how workers are instructed and how the master prepares dispatch prompts. The JavaScript changes affect SSE client connection handling and dashboard reconnection resilience.

---

## Task 1: Create lite worker instructions

**File to create:** `agent/instructions/tracker_worker_instructions_lite.md` (new file, max 80 lines)

**Problem:** The full worker instructions at `agent/instructions/tracker_worker_instructions.md` are approximately 390 lines. Every worker agent must read them in full before starting work. For simple tasks (no dependencies, 1-2 files), this is excessive overhead — the agent spends significant context tokens learning protocols it will never use (upstream dependency reading, detailed deviation severity classification, ambiguity handling decision trees, partial completion protocol).

**Solution:** Create a stripped-down version that covers only the essentials for simple, independent tasks.

**Content of the lite file (target: 60-80 lines):**

The file must include ONLY these sections:

1. **Header** (3-4 lines): Who this is for, that it is the lite version for simple tasks, and the key location distinction (`{tracker_root}` for progress, `{project_root}` for code work).

2. **Progress file location and schema** (15-20 lines): The file path pattern `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`. The complete JSON schema with all fields (task_id, status, started_at, completed_at, summary, assigned_agent, stage, message, milestones, deviations, logs). One compact example showing a complete progress file in the `completed` state.

3. **Fixed stages** (8-10 lines): The 7 stages in order: `reading_context`, `planning`, `implementing`, `testing`, `finalizing`, `completed`, `failed`. One-line description for each.

4. **Mandatory write points** (8-10 lines): Write on task start (status, started_at, assigned_agent, stage). Write on every stage transition. Write on completion (status, completed_at, summary). Write on failure. Use live timestamps via `date -u +"%Y-%m-%dT%H:%M:%SZ"`.

5. **Return format** (10-12 lines): The exact return format (STATUS, SUMMARY, FILES CHANGED, DIVERGENT ACTIONS, WARNINGS, ERRORS) matching the full version.

**What to OMIT (these are in the full version but not needed for simple tasks):**
- The "Reading Upstream Results" section (4 steps, ~55 lines) — lite tasks have no dependencies
- The "Handling Ambiguity" section (~15 lines) — lite tasks are simple enough to not need this
- The "Partial Completion Protocol" section (~15 lines) — lite tasks either complete or fail
- Detailed deviation severity classification (CRITICAL/MODERATE/MINOR definitions) — lite tasks just report deviations as strings
- The full log narrative guidance ("Good logs tell a narrative...") — lite tasks just need basic logs
- The 3 full lifecycle examples (initial, mid-task, final) — one compact example is sufficient
- The "Dashboard Rendering" section — workers don't need to know how the UI renders their data

**Style:** Match the tone of the full instructions (direct, imperative, no fluff). Use markdown headers and tables. Include the `NON-NEGOTIABLE` emphasis on the initial progress write.

**Success criteria:** File exists at `agent/instructions/tracker_worker_instructions_lite.md`. It is 80 lines or fewer. It includes the progress file schema, stages, mandatory write points, and return format. It does NOT include upstream dependency reading, ambiguity handling, partial completion protocol, or detailed deviation severity definitions. A simple worker agent can follow it and produce correct progress files and return values.

---

## Task 2: Add complexity-based instruction selection to p_track.md

**File:** `_commands/Synapse/p_track.md`

**Problem:** Currently, Step 14 (the swarm agent prompt template) always directs workers to read the full `tracker_worker_instructions.md`. For simple tasks, this wastes context.

**Changes to p_track.md:**

Find **Step 14** (approximately line 535-538 in the full file). The current template contains this block:

```
FIRST: Read the worker instructions file:
  {tracker_root}/agent/instructions/tracker_worker_instructions.md

Follow those instructions EXACTLY. They contain the full progress file schema,
required reporting points, log format, and examples.
```

Add a complexity assessment section BEFORE the worker instructions reference. Insert this between the `LIVE PROGRESS REPORTING` header and the `FIRST: Read the worker instructions file:` line:

```
INSTRUCTION MODE:
{If this task has dependencies (non-empty depends_on) OR touches 3+ files OR has CRITICAL context:
  FULL — Read {tracker_root}/agent/instructions/tracker_worker_instructions.md
If this task has NO dependencies AND touches ≤2 files AND has no CRITICAL context:
  LITE — Read {tracker_root}/agent/instructions/tracker_worker_instructions_lite.md}
```

Then update the existing `FIRST:` line to be conditional:

```
FIRST: Read the worker instructions file:
  {tracker_root}/agent/instructions/tracker_worker_instructions{_lite if LITE mode}.md
```

Also add a note to the **Prompt Completeness Checklist** (the table after the template, approximately line 670-683) with a new row:

```
| **Instruction mode** | FULL for tasks with dependencies, 3+ files, or CRITICAL context. LITE for simple independent tasks (≤2 files, no deps). |
```

**Important:** This is a large, critical command file. Do NOT modify any other steps, sections, or content. The change is limited to Step 14's prompt template and the completeness checklist.

**Success criteria:** The prompt template includes conditional instruction mode selection. Simple tasks (no deps, ≤2 files) reference `tracker_worker_instructions_lite.md`. Complex tasks reference the full `tracker_worker_instructions.md`. The completeness checklist documents the selection criteria. All other content in p_track.md is unchanged.

---

## Task 3: Add upstream result summarization guidance

**Files:** `_commands/Synapse/p_track.md`, `agent/instructions/tracker_master_instructions.md`

**Problem:** When the master injects upstream task results into downstream worker prompts (the `UPSTREAM RESULTS` section in the Step 14 template), there is no guidance on size limits. A completed upstream task might have 20 milestones, 15 log entries, and 3 deviations. Injecting all of that bloats the downstream worker's prompt, wasting context on information that is mostly irrelevant to the downstream task.

**Changes to p_track.md:**

In **Step 14**, find the `UPSTREAM RESULTS` section of the prompt template (approximately line 566-573). The current content is:

```
UPSTREAM RESULTS:
{Only include for downstream tasks that depend on completed upstream work.
For each completed dependency:
  - Task {dep_id}: {dep_title} — {dep_summary}
  - Files changed: {list of files the upstream task created/modified}
  - New interfaces/exports: {any new types, functions, or APIs the upstream task introduced}
  - Deviations: {any deviations from the plan that affect this task}
Omit this entire section for Wave 1 tasks with no dependencies.}
```

Replace it with:

```
UPSTREAM RESULTS:
{Only include for downstream tasks that depend on completed upstream work.
For each completed dependency, summarize to these fields ONLY:
  - Task {dep_id}: {dep_title} — {one-line summary from worker return}
  - Files created/modified: {list of file paths, one per line}
  - New exports/APIs: {function names, type names, endpoint paths introduced}
  - CRITICAL deviations: {only deviations with severity CRITICAL that change interfaces or contracts this task depends on}

OMIT from upstream injection:
  - Full milestone timelines (milestones[] array)
  - Full log arrays (logs[] array)
  - MINOR and MODERATE deviations (unless they directly affect this task's inputs)
  - Stage transition history
  - Timing data (started_at, completed_at, elapsed)

Cap upstream injection at ~30 lines per dependency. If an upstream task modified many files,
list only the files relevant to this downstream task.

Omit this entire section for Wave 1 tasks with no dependencies.}
```

**Changes to tracker_master_instructions.md:**

Find the "Eager dispatch write points" section (approximately line 536-547). After Step 5 ("Dispatch all available"), add a note:

```
**Upstream result injection:** When building the dispatch prompt for a newly unblocked task, summarize each upstream dependency's results to: (a) one-line summary, (b) files created/modified, (c) new exports/APIs, (d) CRITICAL deviations only. Omit milestone timelines, log arrays, MINOR/MODERATE deviations, and timing data. Cap at ~30 lines per upstream dependency. See the UPSTREAM RESULTS template in `_commands/Synapse/p_track.md` Step 14.
```

**Important:** These are both large, critical files. Make only the specified changes. Do not modify any other sections.

**Success criteria:** The UPSTREAM RESULTS template in p_track.md has explicit inclusion/exclusion criteria and a ~30 line cap per dependency. tracker_master_instructions.md references the summarization rules in its eager dispatch section. Both changes are minimal and do not affect surrounding content.

---

## Task 4: Replace self-assessment with falsifiable checklist

**File:** `_commands/Synapse/p_track.md`

**Problem:** Step 14's PREPARATION section includes a self-assessment with 4 yes/no questions (approximately line 603-610):

```
3. SELF-ASSESSMENT — answer these specific questions before proceeding:
   a. Can I identify EVERY file I need to modify? (If no → read the project structure)
   b. Do I understand the PATTERNS I need to follow? (If no → read the reference files listed above)
   c. Can I describe my implementation approach in one sentence? (If no → re-read the context)
   d. Are there any AMBIGUITIES in the task description? (If yes → make the most reasonable
      choice, document it as a deviation, and proceed)
   If after reading 3 additional files you still lack clarity, report the specific gap
   as a blocker in your return rather than reading the entire codebase.
```

These questions are well-intentioned but unfalsifiable — a worker can answer "yes" to all of them without actually verifying anything. They produce no observable output that the master or dashboard can inspect.

**Replace** the self-assessment block (item 3 in the PREPARATION section) with:

```
3. READINESS CHECKLIST — fill in every blank before proceeding:
   a. Files I will modify: [list every file path]
   b. Files I will create: [list every file path, or "none"]
   c. The primary function/component/module I am building or changing is called: [name]
   d. My task's output will be consumed by task(s): [list downstream task IDs, or "none — no dependents"]
   e. The single most likely failure mode for this task is: [describe in one sentence]

   If you cannot fill in any blank after reading the provided context + 2 additional files,
   report the specific gap as a blocker in your return rather than reading the entire codebase.

   Log your completed checklist as a milestone in your progress file at stage "planning".
```

The key improvements:
- Every item requires a concrete, specific answer (not yes/no)
- Item (a) and (b) force the worker to enumerate its file scope
- Item (c) forces the worker to name what it is building
- Item (d) forces awareness of downstream consumers
- Item (e) forces pre-mortem thinking about failure modes
- The checklist is logged to the progress file, making it visible on the dashboard

**Important:** Only replace item 3 in the PREPARATION section. Do not modify items 1 or 2, and do not modify anything else in Step 14 or elsewhere in p_track.md.

**Success criteria:** The 4 yes/no self-assessment questions are replaced with 5 fill-in-the-blank checklist items. The new checklist requires concrete answers. Workers are instructed to log the checklist as a milestone. Items 1 and 2 of the PREPARATION section are unchanged. All other content in p_track.md is unchanged.

---

## Task 5: Add SSE reconnection with state catch-up (server side)

**Files:** `src/server/index.js`, `src/server/SSEManager.js`

**Problem:** When an SSE client disconnects and reconnects (browser tab sleep, network blip, Electron app backgrounded), it receives no data about what happened during the disconnect. The current `/events` endpoint sends initial state on first connect, but there is no explicit `init_state` event type, and the reconnection behavior depends on the client re-requesting `/events` from scratch.

The server-side already handles most of this correctly. When a new SSE client connects to `/events`, the server sends `initialization` and `all_progress` events for each dashboard (lines 70-108 in `src/server/index.js`). This is already the correct behavior for reconnection catch-up.

**Server-side changes:**

In `src/server/index.js`, the `/events` endpoint handler (lines 70-108): Add a new `init_state` event that sends a single combined payload containing initialization + progress + logs for the requested dashboard. This gives the client a single atomic state snapshot on connect/reconnect instead of multiple separate events that could be processed out of order.

After the existing initial data sending (after line 98 `}` and before the queue data sending), add:

```javascript
// Send combined init_state for reconnection catch-up
for (const id of dashboardsToSend) {
  const init = readDashboardInit(id);
  const progress = readDashboardProgress(id);
  const logs = readDashboardLogs(id);
  if (init) {
    res.write(`event: init_state\ndata: ${JSON.stringify({
      dashboardId: id,
      initialization: init,
      progress: progress || {},
      logs: logs || { entries: [] }
    })}\n\n`);
  }
}
```

Import `readDashboardLogs` from DashboardService (add to the existing destructured import on line 29-32).

**In `src/server/SSEManager.js`:** No changes needed. The SSEManager handles client tracking and broadcasting correctly. The `init_state` event is just another event that gets written to the response stream.

**Success criteria:** The `/events` endpoint sends an `init_state` event on every new SSE connection containing the full dashboard state (initialization + progress + logs) as a single payload. The existing `initialization`, `all_progress`, and `queue_changed` events still fire as before (backward compatibility). `readDashboardLogs` is imported and used. No other changes to server files.

---

## Task 6: Add SSE reconnection with state catch-up (client side)

**File:** `src/ui/hooks/useDashboardData.js`

**Problem:** The dashboard's React hook `useDashboardData` connects to Electron IPC push events but has no reconnection logic. If the SSE connection drops (which happens when the Electron app is backgrounded, the machine sleeps, or the server restarts), the dashboard goes stale with no recovery mechanism. The user must manually refresh the app.

The current architecture uses Electron IPC — the React app communicates with the Electron main process, which in turn maintains the SSE connection to the server. The reconnection logic needs to work within this IPC architecture.

**Changes to `useDashboardData.js`:**

### Change A: Add `init_state` event handler

In the `useEffect` that sets up IPC push listeners (lines 139-204), add a new listener for the `init_state` event. This event carries the full dashboard state snapshot (initialization + progress + logs) and is sent by the server on every SSE (re)connection:

```javascript
addListener('init_state', (data) => {
  if (!data.dashboardId) return;
  const { dashboardId, initialization, progress, logs } = data;

  // Update progress cache
  if (progress) {
    progressRef.current[dashboardId] = progress;
    dispatch({ type: 'SET_DASHBOARD_PROGRESS', dashboardId, progress });
  }

  if (dashboardId === currentDashboardIdRef.current) {
    if (initialization) dispatch({ type: 'SET_INIT', data: initialization });
    if (progress) dispatch({ type: 'SET_PROGRESS', data: progress });
    if (logs) dispatch({ type: 'SET_LOGS', data: logs });
  }
});
```

Place this listener after the existing `all_progress` listener and before the `dashboards_list` listener.

### Change B: Add connection health monitoring and reconnection

Add a connection health monitor that detects when the IPC/SSE connection has gone stale and triggers a data refetch. After the existing `useEffect` for IPC listeners (the one that starts at line 139), add a new `useEffect`:

```javascript
// Connection health monitor — refetch data if no events received for 30 seconds
useEffect(() => {
  const api = window.electronAPI;
  if (!api) return;

  let lastEventTime = Date.now();
  const STALE_THRESHOLD_MS = 30000; // 30 seconds with no events = stale
  const CHECK_INTERVAL_MS = 5000;   // Check every 5 seconds

  // Track last event time via a lightweight listener
  const heartbeatHandle = api.on('heartbeat', () => {
    lastEventTime = Date.now();
  });

  // Also count any data event as proof of connection
  const proofHandle = api.on('agent_progress', () => {
    lastEventTime = Date.now();
  });

  const intervalId = setInterval(() => {
    if (Date.now() - lastEventTime > STALE_THRESHOLD_MS) {
      console.log('[useDashboardData] Connection appears stale, refetching...');
      fetchDashboardData(currentDashboardIdRef.current);
      lastEventTime = Date.now(); // Reset to avoid rapid refetches
    }
  }, CHECK_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    if (heartbeatHandle) api.off('heartbeat', heartbeatHandle);
    if (proofHandle) api.off('agent_progress', proofHandle);
  };
}, [fetchDashboardData]);
```

**Important context about the current code:**
- `useDashboardData` is a custom hook in `src/ui/hooks/useDashboardData.js`
- It uses `useAppState()` and `useDispatch()` from `src/ui/context/AppContext.jsx`
- It communicates via `window.electronAPI` (Electron IPC bridge)
- The `fetchDashboardData` callback (lines 113-131) already does a full pull of init + progress + logs via IPC — the reconnection logic can reuse it
- The hook already handles `initialization`, `logs`, `agent_progress`, `all_progress`, `dashboards_list`, `dashboards_changed`, and `queue_changed` events
- The `progressRef` is used as a cache to track progress data per dashboard

**Success criteria:** The `init_state` event is handled and restores full dashboard state. Connection health monitoring detects stale connections after 30 seconds and triggers a refetch. The existing event handlers are unchanged. The `fetchDashboardData` function is reused for reconnection recovery. No regressions in existing dashboard behavior.

---

## Dependencies between tasks

- Task 1 (lite worker instructions) has no dependencies — Wave 1
- Task 2 (complexity-based instruction selection in p_track.md) depends on Task 1
- Task 3 (upstream result summarization) has no dependencies — Wave 1
- Task 4 (falsifiable checklist) has no dependencies — Wave 1
- Task 5 (SSE server-side init_state) has no dependencies — Wave 1
- Task 6 (SSE client-side reconnection) depends on Task 5

Note: Tasks 2, 3, and 4 all modify `_commands/Synapse/p_track.md` but they touch different, non-overlapping sections of the file:
- Task 2 modifies the LIVE PROGRESS REPORTING block in Step 14 and the Prompt Completeness Checklist
- Task 3 modifies the UPSTREAM RESULTS block in Step 14 and tracker_master_instructions.md
- Task 4 modifies the SELF-ASSESSMENT block (item 3) in the PREPARATION section of Step 14

These sections are separated by 30+ lines each, so concurrent modification is safe as long as each task modifies ONLY its specified lines. However, to be conservative, Tasks 3 and 4 should depend on Task 2 completing first (sequential within p_track.md). Reorder dependencies:
- Task 3 depends on Task 2 (both touch p_track.md)
- Task 4 depends on Task 3 (both touch p_track.md)

This serializes all p_track.md changes to avoid merge conflicts.

**Revised dependency graph:**
- Wave 1: Task 1, Task 5 (parallel)
- Wave 2: Task 2 (depends on Task 1), Task 6 (depends on Task 5)
- Wave 3: Task 3 (depends on Task 2)
- Wave 4: Task 4 (depends on Task 3)

## Success criteria for the swarm

1. `agent/instructions/tracker_worker_instructions_lite.md` exists, is 80 lines or fewer, and covers the essential progress reporting protocol.
2. `p_track.md` Step 14 template selects lite vs full instructions based on task complexity (deps, file count, critical context).
3. Upstream result injection in dispatch prompts is capped at ~30 lines per dependency with explicit inclusion/exclusion criteria.
4. Self-assessment questions are replaced with a 5-item fill-in-the-blank checklist that workers log as a milestone.
5. The server sends an `init_state` SSE event on every new client connection with the full dashboard state.
6. The client handles `init_state` events and monitors connection health with automatic refetch after 30 seconds of silence.
7. No existing behavior is broken — all changes are additive or replace specific blocks with improved versions.
8. The server starts and the Electron app loads without errors after all changes.
