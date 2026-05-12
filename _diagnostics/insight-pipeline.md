# Diagnostic — PKI Insight Extraction Pipeline

**Task:** 1.1 of `pki-improvement-tiers-1-4` swarm (dashboard `ab9c26`)
**Date:** 2026-05-06
**Scope:** Diagnostic only — recommend fix path for task 2.1.

---

## Symptoms

1. `/Users/dean/Desktop/Synapse/.synapse/knowledge/insights/` directory **does not exist** on disk. (Verified: `ls .synapse/knowledge/` shows only `annotations/`, `domains.json`, `manifest.json`, `patterns.json`, `queries/`.)
2. `manifest.json` contains **no `insights_index` field**. (Verified: top-level keys are `version`, `last_updated`, `stats`, `files`.)
3. The PKI was bootstrapped successfully via `!learn` (333 annotated files, 331 KB manifest, `stats.annotated === 333`), so the *bootstrap* path works. The **post-swarm extraction** path has never produced output on this repository.
4. Across the full Archive (47 archived dashboards spanning 2026-03-18 → 2026-05-06), **zero `logs.json` entries** match `Knowledge extracted`, `insights captured`, `harvested`, or `17G` — including swarms that fully completed (e.g., `5f1313-20260419220316` 6/6, `2026-03-29_p-track-fix` 8/8, `2026-03-24_pki-system` 10/10). The orchestrator log line from `SwarmOrchestrator.js:1023-1029` has never been written.
5. The CLAUDE.md documentation for this repository explicitly claims: *"populated by five mechanisms: ... and post-swarm knowledge extraction (automatic after every swarm — harvests worker annotations and generates swarm-level insights)"*. Reality contradicts the documentation.

---

## Code Path Trace

### Pipeline A — `SwarmOrchestrator.extractSwarmKnowledge`

- Definition: `electron/services/SwarmOrchestrator.js:768-1030`.
- Call sites:
  - `electron/services/SwarmOrchestrator.js:115` — inside `onTaskComplete()` when `isSwarmComplete()` returns true.
  - `electron/services/SwarmOrchestrator.js:217` — inside `onTaskFailed()` when the swarm becomes terminal with failures.
- Both call sites are wrapped in `try/catch` and swallow errors as `warn` logs; they are functionally correct *if* execution ever reaches them.
- Reachability: `onTaskComplete` and `onTaskFailed` are only invoked by `handleProgressUpdate` (called for swarms registered in `activeSwarms`, which is populated by `startSwarm`). `startSwarm` is reached only via the `start-swarm` IPC handler (`electron/ipc-handlers.js:1109-1110`), which is exposed to the renderer as `electronAPI.startSwarm` (`electron/preload.js:164`).
- **`electronAPI.startSwarm` is never called from the React UI.** Project-wide grep across `src/ui/**` finds **zero** invocations. The only mentions outside of `electron/` and `documentation/` are dead references. There is no SwarmBuilder button or DashboardsPage handler that triggers it.
- Implication: in the current chat-driven workflow (`!p_track` issued in the agent chat), `SwarmOrchestrator.startSwarm` is never called, so `activeSwarms` never receives an entry, so `handleProgressUpdate` never routes through `onTaskComplete`/`onTaskFailed`, so `extractSwarmKnowledge` is **structurally unreachable** end-to-end.
- Even if the function did run, two latent schema bugs would corrupt the merge:
  1. It writes `manifest.updated_at = now` (`SwarmOrchestrator.js:1013`) but the existing manifest uses **`last_updated`** at the top level. The fresh field would be stamped while the canonical timestamp continues to drift.
  2. It writes per-annotation `existing.annotated_at` and `existing.annotated_by` (`SwarmOrchestrator.js:986-987`), but bootstrap-produced annotation files use `last_annotated`. The merge would silently introduce a parallel field name.
  3. `manifestChanged` is unconditionally set to `true` at line 1014 even when no annotations were merged (the variable mutation order makes the boolean meaningless). Not a correctness bug today, just dead logic.

### Pipeline B — Master-driven `Step 17G` in `agent/_commands/p_track_completion.md`

- Definition: `agent/_commands/p_track_completion.md:299-440` (six sub-steps `17G-1` through `17G-6`).
- Trigger: a post-swarm checklist instruction the master agent is supposed to follow after writing the final report (Step 17F → 17G).
- Reachability: every step is plain instructional prose; nothing in the runtime forces the master to execute it. There is no PostToolUse hook, no `validate-step-17g.sh`, and no log/state field the orchestrator inspects to verify completion. The only enforcement is the prose preamble: *"This step runs automatically after every swarm. ... The master does NOT skip this step."*
- Empirical evidence: master agents skip it. **Zero of 47 archived swarms** have any of the canonical 17G log lines. The `2026-03-24_pki-system` swarm (which itself built the PKI feature) and the `2026-04-18_passive-pki-enrichment` swarm (which extended it) both completed without firing 17G. Combined with the orchestrator path being structurally unreachable, this means **neither pipeline has ever produced an insight file on this repository**.

### How `!p_track` actually executes today

`!p_track` is a chat-spawned skill (`.claude/skills/p-track/`). The master agent runs in the chat session. Workers are dispatched via the Task tool (or sub-agents). Worker progress files write to `dashboards/{id}/progress/`. Completion detection is handled in agent prose (the master polls progress files and renders the final report). The Electron `SwarmOrchestrator` is *not* in the loop — it exists as the would-be GUI-driven engine but is currently dormant.

### Permission / path checks

- `path.join(projectPath, '.synapse', 'knowledge', 'insights')` resolves to `/Users/dean/Desktop/Synapse/.synapse/knowledge/insights` for self-targeted swarms — a writable path under the user's `~/Desktop`.
- The parent `.synapse/knowledge/` is writable (the existing manifest, `domains.json`, `patterns.json`, and `annotations/` were all written there during `!learn`).
- `mkdirSync(..., { recursive: true })` is wrapped in `try/catch` and silently `return`s on failure (`SwarmOrchestrator.js:782-785`). If `projectPath` were undefined the function early-returns at line 769, but Pipeline A never gets that far given the unreachability above.
- No filesystem permission issue. The directory simply has never been created because no writer has ever run.

---

## Root Cause Hypothesis

**There is exactly one root cause with two independent failure modes that compound it.**

**Root cause:** Both pipelines that are *supposed* to populate `insights/` are inactive in the current chat-driven workflow.

- **Failure mode 1 (Pipeline A — orchestrator):** `SwarmOrchestrator.extractSwarmKnowledge` is unreachable because no UI surface invokes `electronAPI.startSwarm`. All swarms run via the chat-spawned `!p_track` master, which bypasses the orchestrator entirely.
- **Failure mode 2 (Pipeline B — master prose):** The master-driven `Step 17G` in `agent/_commands/p_track_completion.md` is unenforced and is empirically being skipped 100% of the time. There is no hook, schema validation, or runtime check that ensures the master ran it.

A correct fix must address Pipeline B (the master path) because that is the path actual swarms take. Fixing only Pipeline A would leave reality unchanged. Pipeline A also has latent schema bugs that should be fixed at the same time so the two writers don't fight when one of them runs.

Secondary contributors (not root causes, but they will bite once a fix lands):
- Manifest field-name drift between `last_updated` (bootstrap) and `updated_at` (orchestrator code) — both pipelines will end up writing different keys.
- Annotation field-name drift between `last_annotated` (bootstrap) and `annotated_at` (orchestrator + 17G prose).
- Worker progress files in this repository's `dashboards/` (sample size: 2026-05-03_aec-ai-augmentation-tools, 2026-04-18_passive-pki-enrichment) carry empty `annotations` fields — workers are encouraged but not required to annotate, so even a working extraction would harvest very little. Out of scope for 2.1 but flag for tier 3 if it stays empty.

---

## Recommended Fix

The fix must guarantee that **for every chat-spawned `!p_track` completion, an insights file is written and the manifest is updated** — without relying on master agents remembering to follow prose instructions.

The cleanest path is to make Pipeline A reachable from the chat-driven flow, then have the master prose call it instead of duplicating logic. Concretely:

### Primary fix (target file for task 2.1): `electron/services/SwarmOrchestrator.js`

1. **Make `extractSwarmKnowledge` callable as a one-shot, swarm-state-independent helper.** It already accepts `dashboardId` + `projectPath` and rebuilds everything from the on-disk progress files, so it does not require an entry in `activeSwarms`. The Pipeline A call sites at lines 115 and 217 already pass these — keep them. The required change is wiring up an additional invocation surface (next bullet).

2. **Add an IPC handler that masters can call from the chat session** to trigger extraction post-swarm. Two viable approaches; pick (a):
   - **(a) preferred — new IPC handler `extract-swarm-knowledge`** in `electron/ipc-handlers.js` (new handler, slot it next to the other `SwarmOrchestrator.*` handlers around line 1106-1130) that proxies to `SwarmOrchestrator.extractSwarmKnowledge(dashboardId, projectPath)`. Expose via `electronAPI.extractSwarmKnowledge` in `electron/preload.js` (new line near line 164). The master can be instructed in `p_track_completion.md` Step 17G to call it via the renderer bridge that the chat agent already uses.
   - **(b) alternative — auto-fire from `WatcherService`** when it observes the dashboard transition to a terminal state. Lower-friction for masters but harder to reason about because the trigger is implicit. Mention as a fallback only if (a) is impractical.

3. **Fix the schema drift in `extractSwarmKnowledge` (lines 985-1014):**
   - Line 986: change `existing.annotated_at = now;` to `existing.last_annotated = now;` to match the bootstrap convention used by `!learn` annotation files.
   - Line 1013: change `manifest.updated_at = now;` to `manifest.last_updated = now;` to match bootstrap manifest convention.
   - Line 1014: remove the unconditional `manifestChanged = true;` (it makes the surrounding `if (manifestChanged)` always truthy and obscures intent). Set `manifestChanged = true` only inside the branches that actually modify the manifest.
   - Line 997-1011: keep the `insights_index` push and 50-entry cap. (The bootstrap manifest does not currently have this field, so first run will create it — desired.)

4. **Optional hardening (cheap, recommend including in 2.1):** at the top of `extractSwarmKnowledge` (around line 769), if `projectPath` is empty, also check the resolved tracker root via `.synapse/project.json` so self-targeted Synapse swarms still work when `projectPath` is not explicitly passed.

### Secondary fix (target file for task 2.1 OR a tier-2 follow-up): `agent/_commands/p_track_completion.md`

5. **Replace the prose-only Step 17G implementation with a single-line directive that calls the new IPC handler.** In `agent/_commands/p_track_completion.md` lines 299-440, collapse the six sub-steps into:
   - "After Step 17F, the master MUST call `electronAPI.extractSwarmKnowledge(dashboardId, projectPath)` (or the equivalent CLI fallback). The IPC handler returns `{ success, annotation_count, insight_count }`. If the call returns `success: false`, log a warn-level entry and continue."
   - This removes the silent-skip surface area: the master's only job becomes invoking one function, which is far easier to enforce than six sub-steps.
   - For chat sessions where IPC isn't available, document a CLI fallback (e.g., `node -e "require('./electron/services/SwarmOrchestrator').extractSwarmKnowledge(...)"` from the tracker root). This is necessary because chat-spawned masters don't always have IPC reach.

### Enforcement (target for tier 2 or 3, NOT 2.1): `.claude/hooks/`

6. Add a PostToolUse hook (e.g., `enforce-knowledge-extraction.sh`) that fires when the master writes the final report, checks for the existence of `{project_root}/.synapse/knowledge/insights/{date}_{slug}.json`, and injects a reminder if the file is missing. This is the only durable way to prevent regressions of failure mode 2.

### Files NOT to modify in 2.1

- `electron/services/SwarmOrchestrator.js` is owned by **sibling task 1.2 (Manifest split — write side)** in this same wave. Coordinate ordering: 2.1 should run AFTER 1.2 lands, or the two should merge their changes. If 1.2 changes manifest write semantics, items (3) above must be reconciled with that work.
- Annotation-file shape and `_commands/project/` schema docs are owned by sibling 1.3.

---

## Test Plan

After 2.1 lands, verify the fix end-to-end:

1. **Smoke — Pipeline A reachable:**
   - From a Node REPL or quick script in the tracker root: `require('./electron/services/SwarmOrchestrator').extractSwarmKnowledge('<some_completed_dashboard_id>', '/Users/dean/Desktop/Synapse')`.
   - Pick a dashboard with completed progress files (e.g., archive a fresh test run first).
   - Expected: `.synapse/knowledge/insights/{YYYY-MM-DD}_<slug>.json` exists; `manifest.json` has `insights_index` array with one entry; `manifest.last_updated` updated.

2. **Schema fields match bootstrap:**
   - `jq 'keys' .synapse/knowledge/manifest.json` returns `["files", "last_updated", "insights_index", "stats", "version"]` — note `last_updated`, not `updated_at`.
   - `jq '.last_annotated' .synapse/knowledge/annotations/<some_hash>.json` returns the new timestamp after a worker re-annotates a file in a swarm. There must be no `annotated_at` key in that file.

3. **Master-driven invocation:**
   - Run a tiny `!p_track` swarm (2-3 trivial tasks against this repo).
   - Confirm the master's final-report turn calls the new IPC/CLI handler and that `logs.json` for the dashboard contains the line `Knowledge extracted: N annotations harvested, M insights captured, PKI updated at /Users/dean/Desktop/Synapse/.synapse/knowledge`.
   - Confirm the insights file exists and contains one entry per completed task that emitted annotations or deviations.

4. **Failure tolerance:**
   - Run a swarm where one worker fails. Confirm `extractSwarmKnowledge` still runs (call site at line 217), populates `insights.failure_patterns`, and does not block the final report.

5. **Negative test — no projectPath:**
   - Call `extractSwarmKnowledge(dashboardId, '')`. Expected: silent early-return (line 769), no exceptions, no partial files written.

6. **Idempotence:**
   - Call extraction twice on the same dashboard. Expected: `insights_index` does not duplicate entries (current code does push duplicates — flag if observed; not blocking but worth noting).

7. **Archive sweep regression check:**
   - After 2-3 swarms have completed under the new pipeline, confirm the count of insight files in `.synapse/knowledge/insights/` matches the count of completed swarms in `dashboards/` (or `Archive/`) for the same date range.

---

## File:line index for task 2.1

| Where | Line(s) | Action |
|---|---|---|
| `electron/services/SwarmOrchestrator.js` | 986 | `annotated_at` → `last_annotated` |
| `electron/services/SwarmOrchestrator.js` | 1013 | `updated_at` → `last_updated` |
| `electron/services/SwarmOrchestrator.js` | 1014 | move `manifestChanged = true` inside the branches that actually mutate the manifest (lines 985-1006) |
| `electron/services/SwarmOrchestrator.js` | 1063-1074 | `module.exports` already exposes `extractSwarmKnowledge`. No change needed unless adding helpers. |
| `electron/ipc-handlers.js` | ~1106-1130 | Add new `ipcMain.handle('extract-swarm-knowledge', ...)` |
| `electron/preload.js` | ~164 | Add `extractSwarmKnowledge: (dashboardId, projectPath) => ipcRenderer.invoke('extract-swarm-knowledge', dashboardId, projectPath)` |
| `agent/_commands/p_track_completion.md` | 299-440 | Replace Step 17G prose with a single directive to call the new handler |

End of report.
