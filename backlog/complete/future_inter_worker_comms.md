Design and implement a structured inter-worker communication protocol for Synapse that allows workers to coordinate with sibling tasks without routing all information through the master agent. Currently, workers are completely isolated — they can only receive context from the master (upstream results injected into downstream prompts via the `## UPSTREAM RESULTS` section in Step 14 of `_commands/Synapse/p_track.md`). This creates a bottleneck: the master must cache and relay all inter-task information, and workers that could benefit from knowing what a sibling task is doing (e.g., two Wave 1 tasks creating complementary APIs) have no way to coordinate during execution.

This swarm has five concrete deliverables:

---

**1. Extend the progress file schema with `shared_context` and `sibling_reads` fields**

The progress file schema is defined in two places: `agent/instructions/tracker_worker_instructions.md` (the "Progress File Schema" section starting around line 33) and `CLAUDE.md` (the "Worker Progress Protocol" section under "Progress File Schema"). Both must be updated consistently.

Add two new fields to the progress file JSON schema:

```json
{
  "shared_context": {
    "exports": [],
    "interfaces": [],
    "patterns": [],
    "notes": ""
  },
  "sibling_reads": []
}
```

Field definitions:
- `shared_context` — An object containing information this worker wants to make available to sibling tasks running in the same wave. Unlike the return format (which is only available after completion), `shared_context` is available DURING execution because it lives in the progress file that is written on every update. Sub-fields:
  - `exports` — Array of strings: new exported function/class/type names this worker has created (e.g., `["UserService", "createUser", "UserDTO"]`)
  - `interfaces` — Array of strings: new interface or type signatures relevant to sibling tasks (e.g., `["interface UserDTO { id: string; name: string; email: string; }"]`)
  - `patterns` — Array of strings: patterns or conventions this worker discovered or established that siblings should follow (e.g., `["All service methods return Promise<Result<T, AppError>>"]`)
  - `notes` — Free-form string for anything else siblings might find useful
- `sibling_reads` — Array of task ID strings (e.g., `["1.3", "1.5"]`). Populated when this worker reads another worker's progress file for coordination. Used by the dashboard to draw sibling communication lines.

Both fields should be initialized as empty (`shared_context` with empty arrays/string, `sibling_reads` as `[]`) in the worker's first progress write, and populated as the worker discovers shareable information or reads sibling files.

The schema validation function `isValidProgress()` in `src/server/utils/json.js` (line 58-63) does NOT need to require these new fields — they are optional. Existing progress files without them must remain valid.

Files to modify:
- `agent/instructions/tracker_worker_instructions.md` — Update the schema definition (around line 33-55), the field definitions table (around line 59-71), and the example lifecycle files (around line 260-337) to include the new fields
- `CLAUDE.md` — Update the "Progress File Schema" code block (in the "Worker Progress Protocol" section) and the field table below it

---

**2. Add a "Sibling Communication" section to worker instructions**

In `agent/instructions/tracker_worker_instructions.md`, add a new section after the "Reading Upstream Results" section (which ends around line 252) and before the "Example: Full Progress Lifecycle" section (around line 256). Title it `## Sibling Communication Protocol`.

This section must define the following rules:

a. **Workers MAY read sibling progress files for coordination.** Sibling tasks are same-wave tasks listed in the `## Sibling Tasks` section of the worker's dispatch prompt (if present). Workers read sibling progress files at `{tracker_root}/dashboards/{dashboardId}/progress/{sibling_task_id}.json`. This is entirely optional — workers should only do this when they believe coordination will improve their output.

b. **Workers MUST NOT depend on sibling data.** Sibling `shared_context` is supplementary information, not a requirement. If a sibling's progress file doesn't exist yet, has no `shared_context`, or contains unexpected data, the worker proceeds with its own task as planned. Workers must never block or fail because sibling data is unavailable.

c. **Workers SHOULD populate `shared_context` with useful information.** When a worker creates new exports, interfaces, or establishes patterns that sibling tasks might benefit from knowing, it should write them to `shared_context` in its progress file. The best time to populate this is during the `implementing` stage, after the worker has created its key artifacts.

d. **Workers MUST log sibling reads.** When a worker reads a sibling's progress file, it must add a log entry: `{ "at": "...", "level": "info", "msg": "Read sibling {sibling_id} shared_context — found {brief description of what was useful}" }`. If the sibling's file doesn't exist or has no useful `shared_context`, log that too: `"Read sibling {sibling_id} — no shared_context available yet"`.

e. **Workers MUST record sibling reads in the `sibling_reads` array.** Every sibling task ID whose progress file was read must be added to `sibling_reads` in the worker's own progress file. This is what the dashboard uses to draw sibling communication lines.

f. **Sibling reads are only useful for same-wave tasks.** Tasks in different waves should use the formal upstream injection mechanism (the `## UPSTREAM RESULTS` section and reading upstream progress files per the existing protocol). Cross-wave "sibling reads" would create implicit dependencies that break the dependency graph.

g. **Workers must never WRITE to another worker's progress file.** Each worker owns exactly one file: its own. Reading sibling files is fine; writing to them is a protocol violation.

Include a concrete example showing a worker reading a sibling's progress file, finding a useful interface definition in `shared_context.interfaces`, and adapting its implementation to match.

Files to modify:
- `agent/instructions/tracker_worker_instructions.md`

---

**3. Update the master's dispatch prompt template with an optional `## Sibling Tasks` section**

In `_commands/Synapse/p_track.md`, the dispatch prompt template is in Step 14 (starting around line 535). Add an optional `## Sibling Tasks` section to the template, placed after the `UPSTREAM RESULTS:` section and before the `CRITICAL:` section.

The section should look like:

```
SIBLING TASKS:
{Only include for tasks where same-wave siblings have potential interaction.
The master decides whether to include this based on whether tasks in the same
wave create complementary artifacts (e.g., both creating APIs, both defining
types, both adding routes to the same service).

For each relevant sibling:
  - Task {sibling_id}: {sibling_title} — creates/modifies {key files}
  - Potential coordination: {what this task might want to know from the sibling}

To coordinate, you may read sibling progress files at:
  {tracker_root}/dashboards/{dashboardId}/progress/{sibling_id}.json
Look for the `shared_context` field. See the Sibling Communication Protocol
in your worker instructions for rules.

Omit this entire section for tasks with no same-wave interactions.}
```

Also update the Prompt Completeness Checklist table (around line 670-683) to add a new optional row:

| **Sibling tasks** | If same-wave tasks have potential interactions, the sibling task IDs and their key artifacts are listed |

In `_commands/Synapse/p.md`, add the same optional section to the worker prompt template in Step 8 (around line 127-188), placed after the `## Dependencies` section and before the `## Critical Details` section.

Files to modify:
- `_commands/Synapse/p_track.md`
- `_commands/Synapse/p.md`

---

**4. Add dashboard visualization for sibling communication lines**

When a worker's progress file contains a non-empty `sibling_reads` array, the dashboard should draw dashed lines between the reading worker's card and each sibling card it read from. These lines must be visually distinct from dependency lines (which are solid).

Implementation details:

In `src/ui/utils/dependencyLines.js`, add a new exported function `drawSiblingLines(svg, agents, agentMap, cardElements, container, progressData)`. This function:
- Iterates through all agents and checks their progress data for non-empty `sibling_reads` arrays
- For each sibling read relationship, draws a dashed line between the two cards using the same BFS pathfinding grid (reuse the cached grid from `drawDependencyLines`)
- Sibling lines use a distinct visual style: `stroke: '#60a5fa'` (blue), `stroke-width: 1.5`, `stroke-dasharray: '4 3'`, `stroke-opacity: 0.5`. On hover, they highlight with the same glow filter but in blue
- Each sibling line group gets `class: 'sibling-group'` and `data-from`/`data-to` attributes for hover interaction
- Sibling lines are drawn AFTER dependency lines (layered on top) but with lower opacity so they don't dominate

In `src/ui/components/WavePipeline.jsx`, after the existing call to `drawDependencyLines()`, add a call to `drawSiblingLines()` passing the merged progress data. The progress data is needed because `sibling_reads` lives in progress files, not in `initialization.json`.

In `src/ui/utils/dependencyLines.js`, update `setupCardHoverEffects()` to also handle `.sibling-group` elements. When hovering a card:
- Sibling lines connected to the hovered card get class `sibling-highlight` (brighter blue)
- Unrelated sibling lines get class `sibling-dimmed`

In `public/styles.css`, add CSS rules for `sibling-group`, `sibling-highlight`, and `sibling-dimmed` classes, following the same pattern as the existing `dep-highlight-needs`, `dep-highlight-blocks`, and `dep-dimmed` classes.

Files to modify:
- `src/ui/utils/dependencyLines.js` — Add `drawSiblingLines()` export and update `setupCardHoverEffects()`
- `src/ui/components/WavePipeline.jsx` — Call `drawSiblingLines()` after dependency lines
- `public/styles.css` — Add sibling line CSS classes

---

**5. Add write-guard validation to WatcherService**

In `src/server/services/WatcherService.js`, the progress directory watcher (around line 59-74) fires on any `.json` file change in the `progress/` directory. Add validation that the `task_id` field inside the progress file matches the filename.

Specifically, in the `fs.watch` callback for the progress directory, after reading and validating the progress file with `isValidProgress()`, add a check:

```javascript
// Extract expected task_id from filename (e.g., "2.1.json" -> "2.1")
const expectedId = filename.replace('.json', '');
if (data.task_id !== expectedId) {
  console.warn(`[watcher] GUARD: Progress file ${id}/${filename} contains task_id "${data.task_id}" — expected "${expectedId}". Possible cross-worker write violation.`);
  // Still broadcast the data (don't block it — the worker might have a legitimate reason)
  // but log the warning prominently so the master can investigate
}
```

This is a soft guard — it logs a warning but does not reject the write. The reason: a hard rejection could cause data loss if there's a legitimate edge case (e.g., a replanned task with a different ID writing to the same file). The warning is sufficient to surface violations during debugging.

Also update the `isValidProgress()` function in `src/server/utils/json.js` (around line 58-63) to optionally accept an `expectedTaskId` parameter. If provided, it checks that `data.task_id === expectedTaskId`. If not provided, it behaves as today (backward compatible).

Files to modify:
- `src/server/services/WatcherService.js` — Add task_id-to-filename validation in the progress watcher callback
- `src/server/utils/json.js` — Update `isValidProgress()` to optionally validate task_id against expected value

---

**6. Update CLAUDE.md documentation**

In `CLAUDE.md`, update the following sections to document the new inter-worker communication protocol:

a. In the "Worker Progress Protocol" section, under "Progress File Schema" — add `shared_context` and `sibling_reads` to the schema example and field documentation.

b. In the "Worker Progress Protocol" section, under "When Workers Must Write" — add a bullet: "On populating shared_context — recommended when the worker creates exports, interfaces, or patterns that sibling tasks may benefit from."

c. In the "Dashboard Rendering" section — add a bullet: "Sibling communication lines — dashed blue lines between cards when `sibling_reads` is non-empty in a worker's progress file."

d. In the "Context Savings" table — add a row: old model "Workers cannot see sibling state during execution" vs new model "Workers can read sibling `shared_context` for optional coordination."

Files to modify:
- `CLAUDE.md`

---

Success criteria:
- Progress file schema includes `shared_context` (with `exports`, `interfaces`, `patterns`, `notes` sub-fields) and `sibling_reads` fields, documented consistently in both `tracker_worker_instructions.md` and `CLAUDE.md`
- Worker instructions contain a complete "Sibling Communication Protocol" section with all seven rules (a-g) and a concrete example
- Master dispatch prompt template in both `p_track.md` and `p.md` has an optional `## Sibling Tasks` section with clear guidance on when the master should include it
- Dashboard draws dashed blue sibling communication lines between cards when `sibling_reads` is non-empty, with hover highlighting
- WatcherService logs a warning when a progress file's `task_id` doesn't match its filename
- `isValidProgress()` optionally validates `task_id` against expected value
- All existing functionality continues to work unchanged — the new fields are additive and optional
