# !prompt_audit — Post-Swarm Prompt Quality Audit

## Overview

Analyzes the last swarm's worker performance and prompt quality indicators. Reads progress files to evaluate how well the master agent constructed worker prompts — checking for stage progression, log density, deviation patterns, upstream result completeness, and task outcome correlation.

This is a **post-mortem tool** — run it after a swarm completes to identify what worked, what didn't, and how to improve future prompt construction.

---

## Usage

```
!prompt_audit                  <- Audit your assigned dashboard
!prompt_audit {dashboardId}    <- Audit a specific dashboard (e.g., a3f7k2)
```

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md`

---

## Execution Steps

### Step 1: Resolve Dashboard and Read Swarm Data

Parse the optional `{dashboardId}` argument. If not provided, use your assigned dashboard per the dashboard resolution protocol.

Read the following files from `{tracker_root}/dashboards/{dashboardId}/`:

1. **`initialization.json`** — the static plan (task metadata, agents, waves, dependencies)
2. **All files in `progress/`** — worker lifecycle data
3. **`logs.json`** — master event log

If `initialization.json` has no active task (`task` is `null`), report:

```
No swarm data to audit on {dashboardId}.
```

If the `progress/` directory is empty or missing, report:

```
No progress files found on {dashboardId} — workers may not have reported progress.
```

### Step 2: Collect Per-Task Metrics

For each progress file in `progress/`, extract and compute the following metrics:

| Metric | Source | How to Compute | Notes |
|---|---|---|---|
| Template version | `progress.template_version` | Direct read | `null` if field is missing — indicates prompt did not include version tracking |
| Task duration | `completed_at` - `started_at` | Difference in seconds | `null` if task is still in progress |
| Stage progression | Count of unique `stage` values seen in `milestones[]` and current `stage` | Count unique stages mentioned across milestones + final stage | Healthy = 4+ stages out of the 6 fixed stages |
| Deviation count | `deviations[].length` | Direct count | 0 = clean execution, no plan divergence |
| Deviation severity | `deviations[].severity` | Collect severity distribution (CRITICAL / MODERATE / MINOR) | CRITICAL deviations are the most concerning |
| Log density | `logs[].length / duration_minutes` | Total log entries divided by task duration in minutes | Low density (< 1 entry/min) = sparse reporting |
| Final status | `progress.status` | Direct read | `"completed"` vs `"failed"` |
| Milestone count | `milestones[].length` | Direct count | Low count (< 3) suggests vague scope or poor granularity |
| Prompt size | `progress.prompt_size` | Direct read if present | `null` if worker did not measure — indicates prompt size tracking gap |

**Cross-reference with initialization.json:** Match each progress file's `task_id` to the corresponding agent entry in `initialization.json` to get the task title, wave, and dependency list.

### Step 3: Analyze Upstream Result Completeness

For each task that has dependencies (non-empty `depends_on` in `initialization.json`):

1. Read the task's `logs[]` array from its progress file
2. Search for log entries indicating the worker read upstream progress files — look for patterns like:
   - References to upstream task IDs (e.g., "Read upstream 1.1", "dependency 1.1")
   - Mentions of "upstream" or "dependency" in log messages
   - Log entries at `reading_context` stage that reference other task IDs

3. Score each dependent task:

| Score | Criteria |
|---|---|
| **GOOD** | Logs explicitly mention reading upstream dependencies and extracting results |
| **GAP** | Task has dependencies but logs show no evidence of reading upstream progress files |
| **N/A** | Task has no dependencies (`depends_on` is empty) |

### Step 4: Analyze Convention Relevance

Check if the master built a convention map during planning (evidence: worker prompts contain filtered CONVENTIONS sections with category-specific rules from CLAUDE.md).

- If evidence found in worker logs/prompts: report "Convention filtering active — conventions were filtered per task"
- If not found: report "No convention filtering detected — all workers may have received unfiltered conventions (potential context waste)"

This is informational only — the convention map is an in-memory structure built during planning (not a persisted file). Its presence is inferred from worker prompt quality.

### Step 5: Generate Quality Scorecard

#### Per-Task Scoring

Assign each task a letter grade based on the collected metrics:

| Grade | Criteria |
|---|---|
| **A** | Completed, 0 deviations, 4+ stages, log density >= 1/min, milestone count >= 3 |
| **B** | Completed, 0-1 MINOR/MODERATE deviations, 3+ stages, log density >= 0.5/min |
| **C** | Completed, but 2+ deviations OR sparse logging (< 0.5/min) OR < 3 stages |
| **D** | Completed with CRITICAL deviation(s) OR upstream score = GAP |
| **F** | Failed (`status: "failed"`) |

#### Output Format

```
## Prompt Audit Report — {task.name}

**Dashboard:** {dashboardId}
**Completed:** {timestamp}
**Total Tasks:** {N}

### Per-Task Scorecard

| ID | Title | Grade | Duration | Stages | Deviations | Log Density | Upstream | Status |
|---|---|---|---|---|---|---|---|---|
| 1.1 | {title} | A | 3m 12s | 5/6 | 0 | 2.1/min | N/A | completed |
| 2.1 | {title} | C | 5m 45s | 3/6 | 2 | 0.4/min | GAP | completed |
| 2.2 | {title} | F | 1m 03s | 2/6 | 0 | 1.0/min | GOOD | failed |

### Summary Statistics

| Metric | Value |
|---|---|
| Average duration | {N}m {N}s |
| Failure rate | {N}% ({failed}/{total}) |
| Deviation rate | {N}% of tasks had deviations |
| Upstream gap rate | {N}% of dependent tasks showed no upstream reading |
| Average log density | {N} entries/min |
| Template version coverage | {N}% of tasks reported template_version |
| Average prompt size | {N} tokens (from {N} tasks that reported) |
| Grade distribution | A: {N}, B: {N}, C: {N}, D: {N}, F: {N} |

### Recommendations

{2-5 actionable recommendations based on the data}
```

#### Recommendation Triggers

Generate recommendations when these thresholds are crossed:

| Condition | Recommendation |
|---|---|
| Failure rate > 20% | "High failure rate ({N}%) — review failed task prompts for missing context, unclear instructions, or unresolvable dependencies" |
| Any upstream gap (GAP > 0) | "Upstream result gaps detected — {N} dependent tasks showed no evidence of reading upstream progress files. Ensure dispatch prompts explicitly instruct workers to read upstream progress files." |
| Average log density < 1/min | "Low log density ({N}/min) — workers are under-reporting progress. Consider adding explicit logging checkpoints to dispatch prompts." |
| Deviation rate > 30% | "High deviation rate ({N}%) — {N} tasks diverged from plan. Review whether task prompts are too vague or assumptions are stale by the time workers execute." |
| Template version coverage = 0% | "No template version tracking — consider adding a template_version field to dispatch prompts for prompt iteration tracking." |
| Any CRITICAL deviations | "CRITICAL deviations found in {task IDs} — these changed interfaces or contracts. Review whether downstream tasks were affected and whether the plan needs tighter specifications." |
| Average prompt size > 10000 tokens | "Average prompt size is high ({N} tokens) — consider splitting large tasks or summarizing conventions to reduce context consumption." |
| Average prompt size < 1000 tokens | "Average prompt size is low ({N} tokens) — workers may lack sufficient context. Check if prompts include all necessary file contents and conventions." |

Include only recommendations that apply. Minimum 2, maximum 5. Prioritize by impact.

---

## Rules

- **Do not modify any files.** This is a read-only audit.
- **Read all progress files in parallel** — they have no dependencies on each other.
- **Handle missing data gracefully.** Not all fields may be present in every progress file. Use `null` or `N/A` for missing metrics rather than failing.
- **Be constructive, not punitive.** The goal is to improve future prompts, not blame past ones. Frame recommendations as actionable improvements.
- **Run in serial mode.**
