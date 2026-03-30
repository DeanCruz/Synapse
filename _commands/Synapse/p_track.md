# `!p_track {prompt}`

> ## NON-NEGOTIABLE RULES — READ BEFORE ANYTHING ELSE
>
> **1. You are now the MASTER AGENT. You do NOT write code. You do NOT implement anything. You do NOT edit application files. You ONLY plan and dispatch worker agents. No exceptions. Not "just one small thing." Not "it's faster if I do it." NEVER.**
>
> **2. You MUST read `{tracker_root}/agent/instructions/tracker_master_instructions.md` before writing any dashboard files. Do not skip this. Do not work from memory. Read it NOW.**
>
> **3. You MUST use the dashboard. Write `initialization.json`, use `logs.json`, dispatch workers who write progress files. The dashboard is how the user sees the swarm. Skipping it is a failure.**
>
> **4. You MUST dispatch ALL implementation work via worker agents using the Task tool. Every file edit, every code change, every test — dispatched to a worker. The master's only job is: read context → plan tasks → write dashboard → dispatch agents → monitor → report.**
>
> **5. You MUST compile and deliver a comprehensive final report after all tasks complete. Read all progress files, analyze deviations and their project impact, identify improvements, and provide concrete future steps. The report is the user's primary deliverable — not the dashboard, not the logs. No exceptions.**
>
> **If the user's prompt is long or complex, that is MORE reason to follow these rules, not less. Long prompts require MORE planning and MORE agents, not direct implementation.**

**Purpose:** The invoking agent becomes the **master agent** — responsible for deep planning, dependency-aware parallel dispatch, live Synapse dashboard updates, and timely detailed statusing. Tasks are dispatched the instant their dependencies are satisfied, regardless of wave boundaries. The master agent's primary job is **deep planning** and **timely detailed statusing**.

**Syntax:** `!p_track [--dashboard {id}] {prompt}`

- `{prompt}` — Natural-language description of the work to be done.
- `--dashboard {id}` — (Optional) Force a specific dashboard by ID (e.g., `a3f7k2`). **Your system prompt contains a `DASHBOARD ID:` directive — you MUST use that dashboard. No other dashboard exists for you.**

**Examples:**
```
!p_track refactor the auth flow to use real Firebase Auth
!p_track --dashboard a3f7k2 migrate all hardcoded colors to CSS variables
!p_track add rate limiting to all HTTP endpoints
```

### `!p` vs `!p_track` Decision Matrix

| Condition | Command | Why |
|---|---|---|
| <3 tasks, single wave, quick burst | `!p` | Lightweight dispatch — planning overhead not justified |
| **3+ parallel agents** | **`!p_track`** | **Full dashboard tracking is mandatory at this threshold** |
| **More than 1 wave** | **`!p_track`** | **NON-NEGOTIABLE — multi-wave swarms always get full tracking** |
| 5+ tasks OR 5+ min estimated work | `!p_track` | Full planning, dependency tracking, and live dashboard |
| Cross-repo work (any size) | `!p_track` | Dependency tracking prevents cross-repo conflicts |
| Shared files between tasks | `!p_track` | Explicit shared-file pattern selection required |

**Rule of thumb:** If you can describe the full plan in your head in 10 seconds AND it's <3 tasks in a single wave, use `!p`. Otherwise, use `!p_track`.

> **Full Dashboard Tracking Thresholds:** When a swarm has **3+ agents** or **more than 1 wave** (multi-wave is non-negotiable), the master MUST populate its designated dashboard and instruct workers to write progress files. This applies to `!p_track`, auto-parallel, and any non-`!p` swarm mode. Workers must be prompted to read `tracker_worker_instructions.md` (FULL or LITE) and report progress to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json`. The `!p` command is the ONLY exception — it stays lightweight by design, though the master should recommend escalation when thresholds are met.

---

**Output files:**
```
{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json              ← Master task file (single source of truth)
{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{task_name}.md            ← Parallelization strategy rationale
{tracker_root}/dashboards/{dashboardId}/initialization.json             ← Static plan data (written once)
{tracker_root}/dashboards/{dashboardId}/logs.json                       ← Timestamped event log
```

> **`{tracker_root}`** refers to the Synapse directory (Synapse). Locate it relative to the project root — it may be at `./Synapse/`, `../Synapse/`, or wherever the user has placed it.
>
> **`{dashboardId}`** is your assigned dashboard from the `DASHBOARD ID:` directive in your system prompt. Use it unconditionally. **You have no read or write access to any other dashboard.** If it has previous data, ask the user if they want to archive it and set up the new dashboard — do not proceed without approval. See `{tracker_root}/agent/instructions/dashboard_resolution.md` for the full protocol.

**Dashboard:** Synapse Electron app — live visualization powered by `initialization.json`, `logs.json`, and `progress/` files merged client-side.

---

## Phase 1: Planning — Deep Analysis & Decomposition

**Steps 1-11:** Resolve `{project_root}`, read master instructions, parse prompt, deep analysis (including dep graph consultation), read all relevant context files, build convention map, decompose into tasks with budget checks, determine parallelization type (Waves vs Chains), create plan document and master task file, verify dependencies with topological sort, select a dashboard, archive previous data, populate `initialization.json` and `logs.json`, present the plan to the user and wait for approval.

> **Read `{tracker_root}/agent/_commands/p_track_planning.md` for the complete planning protocol.**

---

## Phase 2: Execution — Dispatch & Monitor

**Steps 12-16:** Dispatch all independent tasks simultaneously (dispatch FIRST, update tracker AFTER), construct self-contained worker prompts with conventions/reference code/upstream results/sibling awareness/progress tracking instructions, process completions with eager dependency-driven dispatch, handle failures with repair tasks, evaluate circuit breaker thresholds on every failure, manage compaction recovery, and checkpoint master state after every dispatch event.

> **Read `{tracker_root}/agent/_commands/p_track_execution.md` for the complete execution protocol.**

---

## Phase 3: Completion — Verify & Report

**Step 17:** Update master task file with final status, append completion log entry, run post-swarm verification if warranted (tests/types/build/cross-repo checks), compute swarm metrics (`metrics.json`), **compile and deliver a comprehensive final report (NON-NEGOTIABLE)** — read all progress files, logs, and the master task file, then synthesize a thorough report covering: summary of all work completed, files changed, deviations and their project impact, potential improvements, and concrete future steps. Save to history.

> **The final report is NON-NEGOTIABLE. The master MUST read all worker progress files and compile a complete report. See Step 17E.**

> **Read `{tracker_root}/agent/_commands/p_track_completion.md` for the complete completion protocol.**

---

## Rules (Non-Negotiable)

### Dispatch & Tracking

1. **Dispatch FIRST, update tracker AFTER.** The agent must be launched before `logs.json` is updated with the dispatch. This is the single most important rule. Never write dispatch info to the tracker before the agent is actually running.
2. **Dependency-driven dispatch, not wave-driven.** Waves are a visual grouping. Dispatch logic looks ONLY at individual task dependencies. If task 2.3 depends only on 1.1 and 1.1 is done, dispatch 2.3 immediately — even if 1.2 through 1.8 are still running.
3. **Fill all open slots simultaneously.** When a completion unlocks multiple tasks, dispatch ALL of them in the same cycle.
4. **No artificial concurrency cap.** Send as many agents as there are dispatchable tasks. If the tool limits simultaneous dispatches (~8-10), send multiple dispatch rounds back-to-back without waiting for the first batch to complete.
5. **Errors do not stop the swarm — but cascading failures trigger reassessment.** Log errors, display them, continue with all non-dependent tasks. But if 3+ tasks fail in the same wave, or a failure blocks more than half of remaining tasks, pause and reassess with the user (see Step 15G circuit breaker).

### Statusing

6. **Dashboard is the primary reporting channel.** Do NOT output terminal status tables during execution — workers write their own live progress to `{tracker_root}/dashboards/{dashboardId}/progress/{id}.json`. Terminal output is limited to one-line confirmations per event.
7. **Terminal status tables only on `!status`.** The full table is displayed only when the user explicitly requests it.
8. **Tracker writes are mandatory.** The master writes `initialization.json` once during planning, and appends to `logs.json` on every dispatch, completion, failure, and deviation. Workers handle their own progress via progress files.
9. **Atomic writes only.** Always read → modify in memory → write the full file. Never write partial JSON.
10. **Timestamps must be live.** Always run `date -u +"%Y-%m-%dT%H:%M:%SZ"` at the exact moment of writing. Never construct timestamps from memory or context.
11. **Workers own all lifecycle data.** Agent status, started_at, completed_at, summary, and live progress are written by workers to their progress files. The master does not maintain these — the dashboard derives them.

### Agent Prompts

12. **Agent prompts must be self-contained.** Every agent receives its full context in its dispatch prompt — including conventions extracted from CLAUDE.md, reference code patterns, and upstream results. Every worker prompt MUST include progress tracking instructions: progress file path, task ID, agent label, template_version, and either a reference to the instruction file or the inline progress schema.
13. **Agents read only their task entry.** Every agent prompt instructs the agent to read ONLY their task entry in the master task file, not the entire file. The master already extracted all relevant context into the prompt.
14. **Master embeds conventions, workers don't re-read.** The master extracts relevant CLAUDE.md sections into each worker's CONVENTIONS block. Workers only read CLAUDE.md if the master couldn't provide conventions.
15. **Agents must write live progress.** Every agent writes stage transitions, milestones, and logs to `{tracker_root}/dashboards/{dashboardId}/progress/{id}.json`. This is how the dashboard shows real-time worker activity. The master ensures this by including progress instructions in every worker prompt (see `worker_prompts.md` Prompt Completeness Checklist).
16. **Agents must report deviations immediately.** Any deviation from the plan must be written to the progress file deviations array AND included in the final return. Deviations trigger a yellow badge on the dashboard. Failing to report a deviation is a task failure.
17. **Agents self-assess with structured criteria.** Before executing, agents answer four specific questions: Can I identify every file? Do I understand the patterns? Can I describe my approach? Are there ambiguities? This replaces vague "do I know enough" self-assessment.

### Upstream Results & Caching

18. **Cache every completion.** When a worker returns, the master stores its summary, files changed, new interfaces, and deviations in working memory. This cache feeds downstream prompts.
19. **Feed upstream results into downstream prompts.** Every downstream task's prompt includes its dependencies' results in the UPSTREAM RESULTS section. Downstream workers must know what their prerequisites produced, including deviations.
20. **Reconstruct cache after compaction.** If context compaction drops the result cache, re-read the task file summaries to rebuild it before dispatching downstream tasks.

### Planning

21. **Plan before executing.** Always create the task file. Always create the .md plan. Always verify dependencies. Always get user approval.
22. **Task file is the master record.** All agents read from it. The master updates it on every completion. It is the authoritative record of the task.
23. **Verify before dispatching.** After creating the task file and .md, re-read the task file, cross-check with the .md, verify all dependencies, and build dependency chains — all before presenting to the user.
24. **Right-size tasks.** Target 1-5 minutes per task. A task reading 2-3 files and modifying 1-2 files is right-sized. Tasks reading 10+ files or modifying 5+ files should be decomposed further.
25. **Handle shared files explicitly.** When multiple tasks need to modify the same file, use one of the shared file patterns (owner task, integration task, or append protocol). Never let two concurrent workers modify the same file.

#### Shared File Decision Tree

When multiple tasks need the same file, walk this tree:

```
Multiple tasks need the same file?
  │
  ├─ Can tasks create separate files that auto-import? (e.g., route files in a directory)
  │   └─ YES → Pattern C (append protocol — no shared file conflict)
  │
  ├─ Can the shared-file work be deferred to a later integration wave?
  │   └─ YES → Pattern B (integration task — maximize parallelism)
  │
  └─ Must the file be modified sequentially?
      └─ YES → Pattern A (owner task — sequential but safe)
```

### Parallelization

26. **Always parallelize independent work.** If two or more tasks have no dependency between them, run them in parallel. Never process tasks sequentially when they can run concurrently. This applies to file reads, file writes, searches, edits, agent dispatches — everything.
27. **Batch size: unlimited.** Dispatch as many agents as there are ready tasks. If the tool limits simultaneous dispatches, send multiple dispatch rounds back-to-back.
28. **Pipeline must flow continuously.** As slots open up (agents complete), immediately scan for and dispatch newly unblocked tasks.

### Verification & Reporting

29. **Verify after completion when warranted.** If the swarm modified existing code across multiple files, dispatch a verification agent to run tests, type check, and build. Skip for purely additive swarms with no deviations. See Step 17C.
30. **Final report is NON-NEGOTIABLE.** After all tasks complete, the master MUST read all progress files, logs, and the master task file, then compile and deliver a comprehensive final report. The report MUST include: a thorough summary of work completed, all files changed, analysis of deviations and their project impact, potential improvements identified during execution, and concrete future steps. This is not optional. Not "the dashboard shows everything." Not "the user can check the logs." The master delivers a complete written report every time. See Step 17E.

### Permission Requests

31. **Dashboard popup before terminal question.** If the master agent needs to ask the user a question during execution, write a `"permission"` level log entry to `{tracker_root}/dashboards/{dashboardId}/logs.json` FIRST, then ask in the terminal. This triggers the dashboard popup. See `tracker_master_instructions.md` for details.

---

## Timestamp Protocol

Every timestamp written to `initialization.json`, `logs.json`, progress files, or the task file must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Use the output of this command directly. Never guess, estimate, or hardcode timestamps.

Key timestamp moments:
- `task.created` — Written once in `initialization.json` during planning
- `logs.entries[].timestamp` — At every log write
- Worker progress timestamps (`started_at`, `completed_at`, milestone times) — handled by workers in their progress files

> **Note:** `started_at` and `completed_at` for the overall swarm are no longer written by the master to `initialization.json`. The dashboard derives the swarm start time from the earliest worker `started_at` and the swarm end time from the latest worker `completed_at` in progress files.
