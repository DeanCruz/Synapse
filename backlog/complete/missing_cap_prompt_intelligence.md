Add three missing capabilities to Synapse that improve prompt construction quality and master agent resilience: prompt template versioning, automated context compaction recovery, and convention relevance filtering. Also add a new `!prompt_audit` command for post-swarm prompt quality analysis. The target project is Synapse itself at {tracker_root} = /Users/dean/Desktop/Working/Repos/Synapse (also {project_root} for this swarm, since we are working on Synapse's own codebase).

This swarm addresses gaps in how the master agent constructs worker prompts and recovers from context compaction during long swarms. Each task has clear scope and verifiable success criteria.

---

TASK 1: Add prompt template versioning to worker prompts

Currently, worker prompts have no version identifier. When template changes are made to `p_track.md` or `p.md`, there is no way to correlate which template version produced which worker results. This makes A/B comparison of template improvements impossible.

Changes required:

(A) In `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md`, Step 14 ("Swarm agent prompt template", starting at line 535), add a `TEMPLATE_VERSION: p_track_v2` field at the very top of the worker prompt template, immediately after the opening line. The template currently begins with:

```
You are a worker agent in the "{task-slug}" swarm, executing task {id}.
```

Add this immediately after that first line:

```
TEMPLATE_VERSION: p_track_v2
```

This field is static — the master copies it verbatim into every worker prompt. It identifies which version of the p_track prompt template was used.

(B) In `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p.md`, Step 8 ("Worker prompt construction", starting at line 123), add `TEMPLATE_VERSION: p_v2` at the top of the worker prompt template. The `!p` template currently begins with:

```
You are executing task {id}: {title}
```

Add `TEMPLATE_VERSION: p_v2` immediately after that first line.

(C) In `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/tracker_worker_instructions.md`, add `template_version` to the progress file schema. In the schema example JSON (around line 33-54), add `"template_version": "p_track_v2"` as a new field. In the "Field Definitions" table (around lines 59-71), add a new row:

| `template_version` | string \| null | The version identifier from the dispatch prompt's TEMPLATE_VERSION field. Set on first write. |

Also add to the "When You MUST Write" section under the initial write (around line 101): workers should extract the TEMPLATE_VERSION from their dispatch prompt and include it in their progress file on the first write.

(D) Add a brief note to the p_track.md Step 14 prompt template, in the "LIVE PROGRESS REPORTING" section (around line 613-628), instructing the worker to include the TEMPLATE_VERSION value from the top of their prompt as `template_version` in their progress file.

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md` — Add TEMPLATE_VERSION field to Step 14 template and progress reporting instruction
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p.md` — Add TEMPLATE_VERSION field to Step 8 template
- `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/tracker_worker_instructions.md` — Add template_version to schema, field definitions table, and mandatory write instructions

Do NOT modify any server code, UI code, or dashboard rendering logic. The template_version field is purely for progress file recording and later analysis.

Success criteria: The p_track.md Step 14 template includes `TEMPLATE_VERSION: p_track_v2` at the top. The p.md Step 8 template includes `TEMPLATE_VERSION: p_v2` at the top. The worker instructions document `template_version` in the schema, field definitions, and mandatory writes. A worker following the updated instructions would include `template_version` in their progress file.

---

TASK 2: Add automated context compaction recovery protocol

During long swarms, the master agent's context window may be compacted, causing it to lose its cached upstream results (task summaries, files changed, exports introduced). Currently, the master has no recovery protocol — it either works from stale memory or fails to inject upstream results into downstream prompts.

Changes required:

(A) In `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md`, add a new section titled "Compaction Recovery Protocol" between Step 15 ("Process completions and dispatch immediately", ending around line 793) and Step 16 ("Terminal output during execution", starting at line 795). This section should be titled "### Compaction Recovery" (not a numbered step — it's a protocol triggered conditionally during Step 15). Content:

```markdown
### Compaction Recovery

During long-running swarms, context compaction may discard the master's cached upstream results. When this happens, downstream tasks receive incomplete `UPSTREAM RESULTS` sections — the #1 cause of downstream worker confusion.

**Detection:** Before constructing any downstream worker prompt (Step 15.E), verify that cached results exist for all completed upstream tasks. If the master's working memory contains no cached result for a task that has a progress file with `status: "completed"`, compaction has occurred.

**Recovery procedure:**

1. List all files in `{tracker_root}/dashboards/{dashboardId}/progress/`. Read every progress file where `status === "completed"`.

2. For each completed progress file, extract:
   - `task_id`, `summary` — what the task accomplished
   - `milestones[]` — what was built, in order (look for file creation/modification milestones)
   - `deviations[]` — any plan divergences that affect downstream work
   - `logs[]` — scan for `"warn"` and `"error"` entries that may indicate partial issues

3. Rebuild the upstream result cache: for each completed task, reconstruct the cache entry with `task_id`, `summary`, and `deviations`. Note: progress files do not contain `FILES CHANGED` data (that comes from the worker's return). After compaction, file change data is lost unless the summary or milestones mention specific files. Include what can be recovered and note the gap.

4. Log a `"warn"` entry to `{tracker_root}/dashboards/{dashboardId}/logs.json`:
   ```json
   {
     "timestamp": "{ISO 8601}",
     "task_id": "0.0",
     "agent": "Orchestrator",
     "level": "warn",
     "message": "Context compaction detected — rebuilt upstream cache from {N} progress files. File change data may be incomplete.",
     "task_name": "{task-slug}"
   }
   ```

5. Resume normal dispatch with the rebuilt cache. Downstream prompts will include recovered summaries and deviations. If file change data is missing, include a note in the `UPSTREAM RESULTS` section: "Note: File change details unavailable due to context compaction — check milestones for partial file information."

**Prevention:** To reduce compaction impact, keep terminal output minimal (Step 16) and avoid re-reading large files unnecessarily during dispatch loops.
```

(B) In `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/tracker_master_instructions.md`, add a "Compaction Recovery" section after the "Common Mistakes" table (end of file, around line 672). Content should be a condensed version of the protocol above — 10-15 lines summarizing: detection (check for missing cached results vs completed progress files), recovery (read progress files, rebuild cache), logging (warn entry), and the limitation (file change data may be incomplete).

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md` — Add Compaction Recovery section between Step 15 and Step 16
- `/Users/dean/Desktop/Working/Repos/Synapse/agent/instructions/tracker_master_instructions.md` — Add condensed Compaction Recovery section after Common Mistakes

Do NOT modify any server code, UI code, or progress file schema. This is purely a master agent protocol addition.

Success criteria: The p_track.md file contains a "Compaction Recovery" section with detection logic, recovery procedure (5 steps), and a warning log entry template. The tracker_master_instructions.md file contains a condensed version. Both describe the same protocol consistently.

---

TASK 3: Add convention relevance filtering with cached convention map

Currently, the master agent embeds the entire project CLAUDE.md into every worker prompt, regardless of whether all sections are relevant to the worker's task. This wastes worker context tokens and buries the relevant conventions in noise. A worker modifying CSS does not need to read API endpoint conventions.

Changes required:

(A) In `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md`, add a "Convention Mapping" subsection inside Step 5 ("Read all relevant context files", starting at line 94). After reading the project CLAUDE.md, the master should create a "convention map" — a structured mapping of convention categories to the specific CLAUDE.md sections that cover them.

The convention map uses these fixed categories:
- `naming` — Variable, function, class, file naming conventions
- `file_structure` — Directory layout, file organization, module boundaries
- `testing` — Test file locations, test patterns, coverage requirements
- `imports` — Import ordering, path conventions, barrel exports
- `error_handling` — Error patterns, logging, error types
- `styling` — CSS conventions, theme system, design tokens
- `api_patterns` — Endpoint structure, request/response shapes, middleware
- `state_management` — State libraries, store patterns, data flow
- `security` — Auth patterns, input validation, secrets handling
- `performance` — Optimization rules, lazy loading, caching patterns

Each category maps to the specific line ranges or section headers from the project CLAUDE.md where that topic is covered. If a category has no coverage in the CLAUDE.md, it maps to null.

(B) Store the convention map in `{tracker_root}/dashboards/{dashboardId}/convention_map.json` so it persists across context compaction. Schema:

```json
{
  "project_root": "{project_root}",
  "claude_md_path": "{project_root}/CLAUDE.md",
  "generated_at": "{ISO 8601}",
  "categories": {
    "naming": { "sections": ["## Naming Conventions"], "content": "extracted text..." },
    "file_structure": { "sections": ["## Project Structure"], "content": "extracted text..." },
    "testing": null,
    ...
  }
}
```

(C) Update the Step 14 prompt template's CONVENTIONS section (around line 556-558) to reference the convention map. Change the guidance from "Relevant sections extracted from CLAUDE.md" to:

```
CONVENTIONS:
{For each convention category relevant to THIS task, include the extracted content
from the convention map (stored at {tracker_root}/dashboards/{dashboardId}/convention_map.json).

Select categories based on the task's nature:
- Task modifies UI components → include: naming, file_structure, styling, imports, state_management
- Task modifies API endpoints → include: naming, api_patterns, error_handling, security
- Task modifies tests → include: naming, testing, imports
- Task modifies config/build → include: file_structure, imports, performance
- Task creates new files → include: naming, file_structure, imports + any domain-specific categories

If no convention map exists (no project CLAUDE.md), omit this section entirely.
Quote the extracted content directly — do not paraphrase.}
```

(D) Add a note in Step 1 ("Resolve {project_root} and read project context", around line 60-64) that after reading the project CLAUDE.md, the master should create the convention map if one does not already exist for this dashboard. If a convention_map.json already exists for this dashboard and references the same project_root, reuse it.

Files to modify:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/Synapse/p_track.md` — Add convention mapping to Step 5, update Step 14 CONVENTIONS guidance, add convention map creation note to Step 1

Do NOT modify server code, UI components, or worker instructions. The convention map is a master-agent-only optimization. Workers receive the filtered conventions in their prompt — they never read the convention map file directly.

Success criteria: Step 5 describes creating a convention map with 10 categories. Step 14 CONVENTIONS section references the convention map and provides category selection guidance. Step 1 mentions convention map creation. The convention_map.json schema is documented with all 10 categories.

---

TASK 4: Create the `!prompt_audit` command

Create a new command at `/Users/dean/Desktop/Working/Repos/Synapse/_commands/project/prompt_audit.md` that analyzes the last swarm's worker prompts for quality. This is a post-mortem tool — it runs after a swarm completes and evaluates how well the master constructed worker prompts.

The command file should follow the same structure as existing command files in `_commands/project/` (e.g., `review.md`, `health.md`). Use this structure:

```markdown
# `!prompt_audit [dashboardId]`

**Purpose:** Analyze the last swarm's worker performance and prompt quality indicators. Reads progress files to evaluate how well worker prompts were constructed — checking for template version tracking, convention relevance, upstream result completeness, and task outcome correlation.

**Syntax:**
- `!prompt_audit` — Audit the active dashboard (auto-detect)
- `!prompt_audit dashboard3` — Audit a specific dashboard

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

### Step 1: Resolve dashboard and read swarm data

Parse the optional `{dashboardId}` argument. Read:
- `{tracker_root}/dashboards/{dashboardId}/initialization.json` — task metadata and agent plan
- All files in `{tracker_root}/dashboards/{dashboardId}/progress/` — worker progress files
- `{tracker_root}/dashboards/{dashboardId}/logs.json` — event log

If no active task exists (task is null), report: "No swarm data to audit."

### Step 2: Collect per-task metrics

For each progress file, extract:

| Metric | Source | Notes |
|---|---|---|
| Template version | `progress.template_version` | null if field is missing (pre-versioning swarm) |
| Task duration | `completed_at - started_at` | In seconds |
| Stage progression | Count of unique stages reached | Healthy tasks hit 4+ stages |
| Deviation count | `deviations[].length` | 0 = clean execution |
| Deviation severity | Max severity in `deviations[]` | CRITICAL > MODERATE > MINOR |
| Log density | `logs[].length / duration_minutes` | Low density (<1/min) suggests sparse reporting |
| Final status | `progress.status` | completed vs failed |
| Milestone count | `milestones[].length` | Low count may indicate vague task scope |

### Step 3: Analyze upstream result completeness

For each task with dependencies (non-empty `depends_on` in initialization.json):
- Check if the task's progress file logs mention reading upstream progress files (look for log entries containing "upstream" or dependency task IDs)
- If the task failed or deviated, check whether the failure/deviation relates to missing upstream context (scan log entries for "missing", "not found", "unexpected", "assumed")
- Score: tasks that read upstream files and completed cleanly = GOOD. Tasks that failed with upstream-related errors = upstream result gap detected.

### Step 4: Analyze convention relevance

If `{tracker_root}/dashboards/{dashboardId}/convention_map.json` exists:
- Check whether convention categories were filtered per task (requires the map to exist)
- Report which categories were available

If no convention map exists:
- Report: "Convention map not found — convention filtering was not active for this swarm."

### Step 5: Generate quality scorecard

Output the audit as a structured report:

```
## Prompt Audit: {task.name}

**Swarm:** {total_tasks} tasks across {total_waves} waves
**Template Version:** {most common template_version, or "Not tracked" if all null}
**Convention Map:** {Available | Not found}

### Per-Task Scores

| Task | Status | Duration | Stages | Deviations | Log Density | Upstream Check | Score |
|---|---|---|---|---|---|---|---|
| {id} {title} | {status} | {duration} | {stages}/6 | {count} | {density}/min | {GOOD/GAP/N/A} | {A/B/C/D/F} |

### Scoring Criteria

- **A** — Completed, no deviations, read upstream deps, 4+ stages, good log density
- **B** — Completed, minor deviations only, adequate logging
- **C** — Completed with moderate deviations or sparse logging
- **D** — Completed with critical deviations or missing upstream reads
- **F** — Failed

### Summary Statistics

- Average task duration: {avg}
- Failure rate: {failed}/{total} ({pct}%)
- Deviation rate: {tasks_with_deviations}/{total} ({pct}%)
- Upstream gap rate: {tasks_with_upstream_gaps}/{tasks_with_deps} ({pct}%)
- Average log density: {avg_density} entries/min
- Template version coverage: {tasks_with_version}/{total} ({pct}%)

### Recommendations

{Based on the analysis, provide 2-5 specific recommendations:
- If failure rate > 20%: "High failure rate suggests task decomposition issues — consider smaller, more focused tasks"
- If upstream gap rate > 0: "Upstream result gaps detected — ensure Step 15.E injects complete upstream data"
- If log density < 1/min average: "Sparse worker logging — worker prompts may need stronger logging emphasis"
- If deviation rate > 30%: "High deviation rate suggests plans diverge from reality — invest more in Step 4 deep analysis"
- If template version is not tracked: "Template versioning not active — update to latest p_track template for tracking"}
```
```

File to create:
- `/Users/dean/Desktop/Working/Repos/Synapse/_commands/project/prompt_audit.md` (new file)

Do NOT modify any existing files for this task. The command is self-contained and reads from existing data sources (progress files, initialization.json, logs.json, convention_map.json).

Success criteria: The file exists at `_commands/project/prompt_audit.md`. It follows the standard command file structure (header, purpose, syntax, steps). It reads progress files, initialization.json, and logs.json. It produces a per-task scorecard with the metrics listed above. It includes scoring criteria and recommendation templates.
