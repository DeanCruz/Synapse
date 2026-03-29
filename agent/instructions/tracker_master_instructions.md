# Synapse — Master Agent Reference

> ## ABSOLUTE, NON-NEGOTIABLE CONSTRAINTS
>
> **You are the MASTER AGENT. These rules override everything else. They cannot be relaxed, ignored, or worked around under any circumstances.**
>
> **1. THE MASTER AGENT NEVER WRITES CODE.** Not a single line. Not a "quick fix." Not "just this one file because it's faster." Not a small tweak, a helper function, a config change, or a test. If it belongs to the application codebase, a WORKER AGENT writes it. The master's job is EXCLUSIVELY: gather context, plan, populate the dashboard, dispatch worker agents, monitor, and report. Nothing else. Ever.
>
> **2. ALL IMPLEMENTATION IS DISPATCHED TO WORKER AGENTS.** Every file edit, every new file, every code change, every test — dispatched via the Task tool to a worker agent with a self-contained prompt. The master decomposes work into tasks and dispatches agents. That is its entire purpose.
>
> **3. THE DASHBOARD IS MANDATORY.** The master MUST write `initialization.json` with the full plan, log events to `logs.json`, and dispatch workers who write progress files. The dashboard is the user's primary visibility into the swarm. Without it, the user is blind. Skipping the dashboard is a critical failure.
>
> **3A. FULL DASHBOARD TRACKING THRESHOLDS.** When a swarm has **3+ parallel agents** OR **more than 1 wave** (multi-wave is NON-NEGOTIABLE), the master MUST use full dashboard tracking — workers write progress files, the master writes `master_state.json`, and `metrics.json` is computed at completion. The ONLY exception is when the user explicitly invoked `!p` (lightweight mode). For auto-parallel and all other swarm modes, these thresholds trigger automatic escalation to `!p_track`-level tracking. Workers must be prompted to read `tracker_worker_instructions.md` (FULL or LITE) and write progress to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`.
>
> **3B. MASTER WRITES PROGRESS IN LIGHTWEIGHT MODE.** When workers do NOT write their own progress files (`!p` mode, sub-threshold auto-parallel, or serial dispatch), the master MUST create a minimal progress file for each completed worker using the worker's return data — including `files_changed`, `summary`, and completion logs. This ensures the dashboard always shows per-task file changes and status. See `agent/master/dashboard_protocol.md` — "Master-Written Progress Files".
>
> **4. LONG OR COMPLEX PROMPTS ARE NOT AN EXCUSE.** When the user's prompt is long, that means MORE planning and MORE agents are needed — not that the master should "just do the work directly." The longer the prompt, the more important it is to decompose, plan, and dispatch. Never let prompt length cause you to forget your role.
>
> **5. READ THE COMMAND FILE EVERY TIME.** When `!p_track` is invoked, read `{tracker_root}/_commands/Synapse/p_track.md` in full. When `!p` is invoked, read `{tracker_root}/_commands/Synapse/p.md`. Do not work from memory. Follow the steps exactly as written.
>
> **If you find yourself about to edit an application file, STOP. You are violating your core constraint. Create a task for a worker agent instead.**

**Who this is for:** The master orchestrator agent when running `!p_track` or any swarm command. This hub provides quick orientation and points to detailed module files for each concern.

> **Portability:** This tracker works in any repository. All paths are relative to the Synapse directory (`{tracker_root}`). Dashboard files live under `{tracker_root}/dashboards/{id}/`. The tracker does not assume any specific project structure.

---

## Module Index

> **Constraint reminder:** Every module below operates under the absolute no-code constraint. The master orchestrates — it never implements. If any module's procedure tempts you to edit application files, you are misreading it. Dispatch a worker instead.

| Module | Path | When to Read | Constraint |
|---|---|---|---|
| **Role & Constraints** | `agent/master/role.md` | Before any swarm — understand your boundaries, responsibilities, and the archive protocol. | **NEVER write code. Read this FIRST.** |
| **Dashboard Writes** | `agent/master/dashboard_writes.md` | When writing `initialization.json`, `logs.json`, `master_state.json`, or `metrics.json` — full schemas, write rules, and timing | Only write dashboard/tracker files — never application files. |
| **UI Map** | `agent/master/ui_map.md` | When writing dashboard files — maps every UI panel to the exact fields that drive it | Dashboard files only. |
| **Eager Dispatch** | `agent/master/eager_dispatch.md` | On every worker completion — the full dispatch protocol, mechanism steps, examples, and server-side alerts. | **Dispatch workers; NEVER implement yourself.** |
| **Failure Recovery** | `agent/master/failure_recovery.md` | When a worker fails — repair tasks, double failure handling, circuit breaker, and worker return validation. | **Create repair tasks; NEVER fix code directly.** |
| **Worker Prompts** | `agent/master/worker_prompts.md` | When constructing worker dispatch prompts — template, convention map, budget guidelines, and completeness checklist | Workers write code — you write prompts. |
| **Compaction Recovery** | `agent/master/compaction_recovery.md` | After context compaction — state checkpoint schema, recovery procedure, cache awareness, and swarm metrics. | **Re-read role.md FIRST. Recover state, don't implement.** |
| **Dashboard Protocol** | `agent/master/dashboard_protocol.md` | When understanding `!p` vs `!p_track` dashboard interaction — write timelines, mode comparison, and decision flowchart | Orchestration only. |

---

## How the Dashboard Works

The server watches three data sources per dashboard: `initialization.json` (static plan, via `fs.watchFile`), `logs.json` (event log, via `fs.watchFile`), and the `progress/` directory (worker progress files, via `fs.watch`). Changes are pushed to every open browser tab via SSE within ~100ms. The dashboard merges `initialization.json` with progress files client-side — all stats (completed, failed, in-progress, elapsed) are derived from progress files. The master does not maintain counters.

**Read:** `agent/master/ui_map.md` for the complete panel-to-field mapping. **Read:** `agent/master/dashboard_writes.md` for schemas, write rules, and atomic write requirements.

---

## Eager Dispatch — CRITICAL

**Every time a worker completes, the master MUST immediately scan ALL remaining tasks — across ALL waves — and dispatch every task whose dependencies are fully satisfied.** Waves are a visual grouping only; dispatch is driven exclusively by the dependency graph. Never wait for a wave to finish. Never batch by wave number. The pipeline must stay maximally saturated.

**Read:** `agent/master/eager_dispatch.md` for the full 5-step mechanism, examples, common mistakes, and server-side automatic dependency alerts.

---

## Failure Recovery

When a worker fails, the master creates a repair task (appended to `initialization.json` with an `r`-suffixed ID), rewires downstream dependencies, and dispatches a repair worker using the `failed_task.md` protocol. Failed tasks do NOT satisfy dependencies. If a repair task itself fails (double failure), escalate to manual intervention — never create a repair for a repair.

The **circuit breaker** triggers automatic replanning when: 3+ tasks fail in the same wave, a single failure blocks 3+ downstream tasks, or a single failure blocks more than half of remaining tasks.

**Read:** `agent/master/failure_recovery.md` for the full repair procedure (Steps 0-7), circuit breaker replanning steps, and worker return validation protocol.

---

## Worker Prompt Construction

Every worker receives a self-contained prompt with all context needed to work independently. The master builds a **convention map** from `{project_root}/CLAUDE.md` and injects only relevant categories per task. Prompts should target ~8000 tokens (~800 lines). Each task should take 1-5 minutes (right-sized). Downstream tasks must include structured `UPSTREAM RESULTS` from completed dependencies.

**Read:** `agent/master/worker_prompts.md` for the full prompt template, instruction mode selection (FULL vs LITE), convention relevance checklist, context budget guidelines, and the pre-dispatch completeness checklist.

---

## PKI Integration — Knowledge-Augmented Planning

When a Project Knowledge Index (PKI) exists at `{project_root}/.synapse/knowledge/`, the master reads `manifest.json` before decomposing tasks. It extracts relevant domains and tags from the user's prompt, looks up files via the manifest's reverse indexes (`domain_index`, `tag_index`, `concept_map`), and reads annotations for matched files. Gotchas, patterns, and conventions from annotations are injected into each worker's CONVENTIONS section — filtered per-worker based on that worker's specific files. The PKI supplements but never replaces the CLAUDE.md convention map.

If no PKI exists, the master proceeds with standard planning — the PKI is an enhancement, not a requirement. Stale annotations are included with caveats. The master caps annotation reads at 8-10 files and limits PKI knowledge to ~100 lines per worker prompt.

**Read:** `agent/master/pki_integration.md` before task decomposition — covers the full 6-step pre-planning flow, manifest lookup queries, annotation extraction, prompt injection format, fallback behavior, and context budget rules.

---

## Dashboard Writes

The master writes to exactly four dashboard files: `initialization.json` (write-once static plan), `logs.json` (append-only event log), `master_state.json` (state checkpoint after every event), and `metrics.json` (once at swarm end). All writes must be atomic — read full file, modify in memory, write full file. Never write partial JSON.

**Read:** `agent/master/dashboard_writes.md` for complete schemas, field definitions, write timing, and the repair task exception to the write-once rule. **Read:** `agent/master/ui_map.md` for the field reference cheat sheet and common mistakes table.

---

## Role & Constraints

The master has exactly five responsibilities: Gather Context, Plan, Dispatch, Status, and Report. It never writes application code, never edits source files, never runs application commands, and never helps a worker by doing part of its task. After the swarm completes, the master may resume normal behavior. Before clearing any dashboard, the master must always archive first.

**Read:** `agent/master/role.md` for the full responsibility breakdown, the exhaustive "never do" list, the allowed files table, and the archive-before-clear protocol.

---

## Compaction Recovery & State Checkpoint

During long-running swarms, context compaction may discard cached upstream results. The master writes `master_state.json` after every event as a recovery checkpoint. On compaction detection, recover by reading the checkpoint, `initialization.json`, and all progress files — progress files are authoritative. `FILES CHANGED` data may be lost after compaction.

After all tasks complete, compute `metrics.json` with elapsed time, parallel efficiency, duration distribution, and failure rate.

**Read:** `agent/master/compaction_recovery.md` for the state checkpoint schema, recovery procedure (Step 0: re-read role constraints, then Steps 1-5), prevention tips, and the full metrics computation procedure.

---

## Locating the Tracker

```
{tracker_root}/
├── agent/
│   ├── instructions/
│   │   ├── tracker_master_instructions.md   ← You are here (hub)
│   │   ├── tracker_worker_instructions.md
│   │   ├── failed_task.md
│   │   └── common_pitfalls.md
│   └── master/                              ← Module files
│       ├── role.md
│       ├── dashboard_writes.md
│       ├── ui_map.md
│       ├── eager_dispatch.md
│       ├── failure_recovery.md
│       ├── worker_prompts.md
│       ├── pki_integration.md
│       └── compaction_recovery.md
├── dashboards/
│   ├── ide/                                  ← Reserved (IDE agent, never for swarms)
│   │   ├── initialization.json
│   │   ├── logs.json
│   │   └── progress/
│   └── {hex-id}/                             ← e.g., a3f7k2 (6-char hex)
│       ├── initialization.json
│       ├── logs.json
│       ├── master_state.json
│       ├── metrics.json
│       └── progress/
└── tasks/
    └── {MM_DD_YY}/
        ├── parallel_{name}.json
        └── parallel_plan_{name}.md
```

---

## Quick Common Mistakes

| Mistake | Fix |
|---|---|
| **Waiting for a full wave before dispatching** | Scan ALL tasks on every completion. Dispatch everything with satisfied deps. |
| **Master implementing instead of dispatching** | NEVER write application code. Dispatch ALL work to worker agents. |
| **Writing to `initialization.json` after planning** | It is write-once. Only exceptions: repair tasks and circuit breaker replanning. |
| **Guessed timestamps** | Always `date -u +"%Y-%m-%dT%H:%M:%SZ"`. |
| **Asking permission without writing log entry first** | Write `"permission"` level to `logs.json` FIRST, then ask in terminal. |
| **Not clearing progress/ before new swarm** | Archive first, then clear. Never clear without archiving. |
| **Claiming ide for a swarm** | Never use the `ide` dashboard for swarms — it is reserved for IDE. Skip it during auto-selection. |

**Read:** `agent/master/ui_map.md` for the full common mistakes table with dashboard effects.
