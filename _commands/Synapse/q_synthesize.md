# `!q_synthesize [topic-filter]`

> **Lightweight version of `!p_synthesize`.** Same synthesis quality and output artifacts. One task card per wave, no worker progress files, master aggregates returns.
>
> **Read `!p_synthesize` for:** output schemas, cluster planning, dedup/stitch/integration/verification protocols, `_open_issues.md` lifecycle, quality rules. This file ONLY describes what's different.

**Syntax:** `!q_synthesize [--mode {full|incremental|verify-only}] [--topics "slug1,slug2,..."] [--depth {standard|deep}] [topic-filter]`

---

## Non-Negotiable Rules

1. **You are the MASTER AGENT.** Same constraints as `!p_synthesize` — you do NOT modify per-topic research.
2. **Read `{tracker_root}/agent/instructions/tracker_master_instructions.md`** before writing dashboard files.
3. **Workers do NOT write progress files.** Workers return structured reports; master updates dashboard.
4. **One task card per wave.** `initialization.json` has one agent entry per wave.
5. **Verification wave is still mandatory and always last.** The lightweight model does NOT eliminate the verifier.
6. **Same output quality.** All synthesis artifacts are identical to `!p_synthesize` output.

---

## Dashboard Model

Same one-agent-per-wave model as `!q_research`. `initialization.json` has agents like:

```json
{
  "agents": [
    { "id": "wave-1", "label": "Wave 1 — Dedup Detection", "task_id": "wave-1", "status": "pending", "wave": 1, "worker_count": 5 },
    { "id": "wave-2", "label": "Wave 2 — Cluster Stitching", "task_id": "wave-2", "status": "pending", "wave": 2, "worker_count": 5, "depends_on": ["wave-1"] },
    { "id": "wave-3", "label": "Wave 3 — Cross-Cluster Integration", "task_id": "wave-3", "status": "pending", "wave": 3, "worker_count": 4, "depends_on": ["wave-2"] },
    { "id": "wave-4", "label": "Wave 4 — Issues Consolidation", "task_id": "wave-4", "status": "pending", "wave": 4, "worker_count": 1, "depends_on": ["wave-3"] },
    { "id": "wave-5", "label": "Wave 5 — Master Synthesis Assembly", "task_id": "wave-5", "status": "pending", "wave": 5, "worker_count": 1, "depends_on": ["wave-4"] },
    { "id": "wave-6", "label": "Wave 6 — Verification", "task_id": "wave-6", "status": "pending", "wave": 6, "worker_count": 1, "depends_on": ["wave-5"] }
  ]
}
```

Progress files follow the same `progress/wave-{N}.json` schema as `!q_research`.

---

## Execution Flow

### Phase 1 — Discovery & Cluster Plan

**Identical to `!p_synthesize` Phase 1** — same topic scan, same cluster computation, same `plan.json` schema. Only difference: `initialization.json` uses one-agent-per-wave model.

Present the plan to the user and wait for approval.

### Phase 2 — Wave Execution (Waves 1-6)

For each wave, follow the same loop as `!q_research`:

1. **Mark wave card `in_progress` (NON-NEGOTIABLE — ENFORCED BY HOOK).** Write `progress/wave-{N}.json` with `status: "in_progress"` and `started_at` BEFORE any worker dispatch. The `validate-wave-lifecycle.sh` PreToolUse hook will **BLOCK** Agent tool calls if no wave is marked `in_progress`.
2. Dispatch ALL workers for this wave in parallel using the Agent tool.
   - Worker prompts are identical to `!p_synthesize` per-wave worker prompts EXCEPT: remove all progress file instructions, add return-only instruction.
   - **Wave 1 (Dedup):** One worker per cluster. Returns dedup report (same schema as `!p_synthesize`).
   - **Wave 2 (Stitch):** One worker per cluster. Writes `synthesis/topics/{slug}.md`. Returns stitch report.
   - **Wave 3 (Cross-cluster):** Workers 3A-3D in parallel. Return structured findings.
   - **Wave 4 (Issues):** Single worker. Writes/updates `_open_issues.md`. Returns issue summary.
   - **Wave 5 (Assembly):** Single worker. Writes `_master_synthesis.md`, `_claims.json`, `_graph.json`, `_index.md`, `_coverage.md`. Returns assembly summary.
   - **Wave 6 (Verification):** Single fresh worker. Writes `_verification_report.md`. Returns verification status.
3. As workers return, update wave card with summaries and aggregated metrics.
4. **Mark wave card `completed` (NON-NEGOTIABLE — ENFORCED BY HOOK).** When all workers have returned, **immediately** set `status: "completed"` and `completed_at` in `progress/wave-{N}.json`. The hook will **BLOCK** the next wave's dispatch if this wave isn't marked `completed` first. Extract upstream context for next wave.
5. Dispatch next wave.

### Master Upstream Context Extraction

Between waves, the master extracts and condenses the key findings that downstream waves need:

- **Wave 1 → Wave 2:** Per-cluster dedup reports (duplicate groups, complementary pairs, contradictions).
- **Wave 2 → Wave 3:** Cluster page paths, cross-cluster entity mentions from stitch returns.
- **Wave 3 → Wave 4:** All contradiction and gap findings from cross-cluster workers.
- **Wave 4 → Wave 5:** `_open_issues.md` path + issue count summary.
- **Wave 5 → Wave 6:** Full synthesis layer file paths for verification.

### Phase 3 — Completion

Same as `!q_research` Phase 5: inline final report, `metrics.json`, history save.

---

## What's Preserved / What's Removed

Same categories as `!q_research`:
- **Preserved:** All output artifacts, all quality rules, Pattern B enforcement for Waves 4/5/6, stable issue IDs, append-only history, verification mandate, user approval gate.
- **Removed:** Worker progress files, worker reading `tracker_worker_instructions.md`, per-worker agent entries, per-worker log entries.
