# Troubleshooting -- Common Issues

This guide covers common errors, warnings, and failure modes in Synapse. Each entry includes the actual error message, what causes it, and how to fix it. Entries are grouped by system component.

See also: [`agent/instructions/common_pitfalls.md`](../../agent/instructions/common_pitfalls.md) for swarm orchestration pitfalls, and the [FAQ](./faq.md) for quick answers to common questions.

---

## Dependency Graph Validation Errors

These errors are produced by `src/server/utils/validation.js` when the master writes `initialization.json`. The dependency graph is validated using Kahn's algorithm for topological sort. Any structural issues block the swarm from starting.

### Self-Reference

**Error:** `Task {id} depends on itself`

**Cause:** An agent's `depends_on` array contains its own `id`. This creates an impossible dependency -- the task cannot start until it completes.

**Fix:** Remove the self-reference from the agent's `depends_on` array in the initialization plan. Review the task's actual dependencies and list only upstream tasks.

### Dangling Reference

**Error:** `Task {id} depends on {dep} which does not exist`

**Cause:** An agent's `depends_on` array references a task ID that is not present in the `agents[]` array. This typically happens when a task is removed from the plan without updating downstream dependencies, or when IDs are mistyped (e.g., `"1.2"` vs `"2.1"`).

**Fix:** Either add the missing dependency task to the plan, or remove the dangling reference from `depends_on`. Verify that all referenced IDs match the `{wave}.{index}` format and exist in `agents[]`.

### Circular Dependency

**Error:** `Circular dependency detected involving tasks: {id1}, {id2}, ...`

**Cause:** Two or more tasks form a dependency cycle where A depends on B, B depends on C, and C depends on A (or any chain that loops back). The topological sort cannot complete because no task in the cycle has zero in-degree.

**Fix:** Break the cycle by removing one dependency edge. Identify which tasks truly need to wait for each other and restructure the graph. Often, circular dependencies indicate that two tasks should be merged into one, or that a shared dependency should be extracted.

### Orphan Task Warning

**Warning:** `Task {id} has no dependencies and nothing depends on it`

**Cause:** A task in Wave 2+ has no `depends_on` entries and no other task depends on it. While not an error (the task can still execute), it suggests a planning issue -- the task may be in the wrong wave or missing dependency connections.

**Fix:** Either move the task to Wave 1 (where root tasks belong) or add the appropriate `depends_on` entries. Wave 1 tasks are exempt from this check by design.

---

## Progress File Validation Errors

These errors relate to worker progress files in `dashboards/{id}/progress/{task_id}.json`. Validation occurs both in hooks (`validate-progress-file.sh`) and in the watcher service (`WatcherService.js`, `json.js`).

### Task ID Mismatch

**Error (WatcherService):** `REJECTED: Progress file {dashboardId}/{filename} contains task_id "{actual}" -- expected "{expected}". Write violation.`

**Error (json.js):** `REJECTED: task_id mismatch -- file expects "{expected}" but data contains "{actual}". Possible cross-worker write violation.`

**Cause:** The `task_id` field inside the JSON file does not match the filename. For example, a file named `1.3.json` contains `"task_id": "1.2"`. This is a hard rejection -- the file is not broadcast to the dashboard.

**Fix:** Ensure the `task_id` field in your progress JSON exactly matches the filename (without the `.json` extension). Each worker must write only to its assigned file. If you see "cross-worker write violation," a worker may be writing to another worker's progress file.

### Dashboard ID Mismatch

**Error:** `REJECTED: Progress file {dashboardId}/{filename} contains dashboard_id "{actual}" -- expected "{expected}". Dashboard binding violation.`

**Cause:** The `dashboard_id` field in the progress file does not match the dashboard directory it is written to. This is a hard rejection.

**Fix:** Set `dashboard_id` in your progress file to match the dashboard directory name exactly. The dashboard ID is provided in the worker's dispatch prompt. Double-check for typos -- the ID is a 6-character hex string (e.g., `"a3f7k2"`).

### Missing Dashboard ID Warning

**Warning:** `Progress file {dashboardId}/{filename} missing dashboard_id field. Old format -- accepting but dashboard binding is unverified.`

**Cause:** The progress file does not include a `dashboard_id` field. This is accepted for backward compatibility with older progress file formats, but the dashboard binding cannot be verified.

**Fix:** Always include the `dashboard_id` field in progress files. This field is required in the current schema (`p_track_v2`).

### Missing Required Fields

**Warning (hook):** `Warning: Progress file {path} is missing required fields: {field1}, {field2}`

**Cause:** The progress file is missing one or more of the required fields: `task_id`, `status`, `assigned_agent`, `stage`.

**Fix:** Include all required fields in every progress file write. The full schema is documented in [`documentation/data-architecture/progress-files.md`](../data-architecture/progress-files.md) and [`agent/instructions/tracker_worker_instructions.md`](../../agent/instructions/tracker_worker_instructions.md).

### Invalid Status Value

**Warning (hook):** `Warning: Progress file {path} has invalid status '{value}'. Must be: in_progress, completed, or failed`

**Cause:** The `status` field contains a value other than the three allowed values.

**Fix:** Use exactly one of: `"in_progress"`, `"completed"`, or `"failed"`. Common mistakes include `"complete"` (missing "d"), `"running"`, or `"pending"`.

### Invalid Stage Value

**Cause:** The `stage` field contains a value not in the allowed set. Detected by `isValidProgress()` in `json.js`.

**Allowed values:** `reading_context`, `planning`, `implementing`, `testing`, `finalizing`, `completed`, `failed`.

**Fix:** Use exactly one of the seven allowed stage values. Progress through them in order as documented in the worker protocol.

### Invalid Timestamp Types

**Cause:** `started_at` or `completed_at` is set to a non-string, non-null value (e.g., a number or object). Additionally, `completed_at` must be `null` when `status` is `"in_progress"`.

**Fix:** Use ISO 8601 strings for timestamps (e.g., `"2026-04-18T14:05:00Z"`) or `null`. Never set `completed_at` to a timestamp while the status is still `"in_progress"`.

---

## Dashboard Isolation Errors

These errors are produced by hook scripts that enforce boundaries between agents, dashboards, and project/tracker paths.

### Dashboard Isolation Violation

**Error:** `Dashboard isolation violation: you are assigned to dashboard '{assigned}' (source: {source}) but attempted to write to dashboard '{target}'. Agents can only write to their assigned dashboard.`

**Cause:** A worker or master agent attempted to write a file to a dashboard directory other than its assigned one. The assigned dashboard is determined from (1) the `SYNAPSE_DASHBOARD_ID` environment variable, or (2) the `DASHBOARD ID:` directive in the system prompt.

**Fix:** Check that you are writing to the correct dashboard path. Your dispatch prompt specifies which dashboard to use. If you are seeing this in a raw CLI session, ensure the `SYNAPSE_DASHBOARD_ID` env var or system prompt directive is set correctly.

### Tracker Root Write Violation

**Error:** `Dashboard file written to wrong location. Expected: {tracker_root}/dashboards/{subpath} -- Got: {actual_path}. Dashboard files MUST be written under {tracker_root}/dashboards/.`

**Cause:** A dashboard-pattern file (initialization.json, logs.json, master_state.json, metrics.json, or progress/*.json) was written to a location outside `{tracker_root}/dashboards/`. This typically happens when `{tracker_root}` and `{project_root}` are confused, and the agent writes dashboard files into the project directory instead.

**Fix:** Always use the absolute `{tracker_root}` path for dashboard files. Both paths are provided in every worker dispatch prompt. Dashboard files go to `{tracker_root}/dashboards/{id}/`. Code changes go to `{project_root}/`.

### Master Agent Write Blocked

**Error:** `Master agent cannot write to project files during an active swarm. File: {path}. Create a worker task instead.`

**Cause:** The master agent attempted to write a file in `{project_root}` while a swarm is active. Masters orchestrate -- they never write application code. This is enforced by `validate-master-write.sh`.

**Fix:** Create a worker task to perform the file modification. The master should dispatch a worker with the appropriate instructions. This hook only activates when a swarm is active (a non-ide dashboard has a non-null `task` in `initialization.json`) and `{project_root}` differs from `{tracker_root}`.

---

## Initialization Schema Errors

These errors are produced by `validate-initialization-schema.sh` when writing `initialization.json`. They prevent malformed dashboard configurations that would render incorrectly.

### Missing or Invalid task.name

**Error:** `task.name is missing or empty (required: kebab-case slug)`

**Error:** `task.name='{value}' is not kebab-case (lowercase letters/digits/hyphens only)`

**Fix:** Set `task.name` to a kebab-case string (e.g., `"auth-refactor"`, `"api-endpoints"`). Only lowercase letters, digits, and hyphens are allowed. The name must start with a letter or digit.

### Invalid task.type

**Error:** `task.type='{value}' is invalid (must be exactly "Waves" or "Chains")`

**Fix:** Set `task.type` to exactly `"Waves"` or `"Chains"` (case-sensitive). These are the only two layout modes.

### Empty agents[] or waves[]

**Error:** `agents[] is empty or missing -- the dashboard will render wave headers with NO task cards.`

**Error:** `waves[] is empty or missing -- required even for Chains type.`

**Cause:** The initialization file was written with wave definitions but no agent entries, or vice versa. This produces a dashboard that shows structure but no content.

**Fix:** Ensure both `agents[]` and `waves[]` are populated. Every agent must have a corresponding wave, and `waves[]` is required even for Chains-type swarms.

### Count Mismatches

**Error:** `task.total_tasks ({N}) does not equal agents[].length ({M})`

**Error:** `task.total_waves ({N}) does not equal waves[].length ({M})`

**Error:** `sum of waves[].total ({N}) does not equal agents[].length ({M})`

**Cause:** The summary counts in the `task` object do not match the actual array lengths. This indicates an inconsistency in the initialization data.

**Fix:** Ensure `task.total_tasks` equals the number of entries in `agents[]`, `task.total_waves` equals the number of entries in `waves[]`, and the sum of all `waves[].total` values equals the number of agents.

### Invalid Agent ID Format

**Error:** `agents[].id format invalid for: {ids} (must match "{wave}.{index}" or "{wave}.{index}r")`

**Fix:** Agent IDs must follow the pattern `{wave_number}.{index_within_wave}` (e.g., `"1.1"`, `"2.3"`). Repair tasks use the `r` suffix (e.g., `"2.1r"`). No other formats are accepted.

### Duplicate Agent IDs

**Error:** `agents[].id has duplicates: {ids}`

**Fix:** Every agent must have a unique ID. Check for copy-paste errors in the initialization plan.

### Orphaned Wave References

**Error:** `agents reference non-existent wave IDs: {id}->wave={wave_id}. Every agents[i].wave must match a waves[j].id exactly.`

**Fix:** Ensure every agent's `wave` field corresponds to a `waves[].id` entry. If you added agents to a new wave, add the wave definition to `waves[]` first.

### Orphaned Dependency References

**Error:** `depends_on references non-existent agent IDs: {agent_id}->{dep_id}`

**Fix:** Every entry in an agent's `depends_on` array must reference an existing agent ID. Remove or correct any references to non-existent agents.

### Chains Coverage Errors

**Error:** `{agent_id} missing from chains` or `{agent_id} in multiple chains`

**Cause:** When `task.type` is `"Chains"`, every agent must appear in exactly one chain's `tasks[]` array.

**Fix:** Verify that each agent ID appears in one and only one chain. Agents cannot be shared across chains or omitted.

### Initialization Immutability

**Error:** `initialization.json is write-once -- task.name cannot change after planning. Existing: '{old}', attempted: '{new}'.`

**Cause:** An attempt was made to overwrite `initialization.json` with a different `task.name` after the initial write. The initialization file is write-once for task identity.

**Fix:** Do not change `task.name` after the initial write. Only repair tasks, circuit breaker replanning, and `!add_task` may modify this file, and they must preserve `task.name`. If you need a different task name, create a new dashboard.

---

## Circuit Breaker

The circuit breaker halts swarm execution when failures indicate a systemic problem rather than isolated issues. See [`documentation/swarm-lifecycle/circuit-breaker.md`](../swarm-lifecycle/circuit-breaker.md) for full details.

### Wave Failure Threshold

**Log message:** `Circuit breaker triggered -- 3+ failures in Wave {N}. Entering replan mode.`

**Cause:** Three or more tasks in the same wave failed. This suggests a shared root cause (wrong assumption, missing dependency, environment issue).

**What happens:** The swarm enters `replanning` state. No new tasks are dispatched. The master analyzes the failures and produces a revised plan.

**What to do:** Review the failed task summaries. Look for a common pattern -- same error message, same file, same environment issue. Fix the root cause, then use `!p_track_resume` to resume the swarm with a corrected plan.

### Blast Radius Threshold

**Log message:** `Circuit breaker triggered -- task {id} blocks {N}/{M} remaining tasks. Entering replan mode.`

**Cause:** A single failed task blocks 3+ downstream tasks, or blocks more than 50% of remaining tasks. The failure has too large a blast radius for a simple retry.

**What to do:** Same as above -- review the failure, fix the root cause, and resume. Consider whether the dependency structure is too centralized (too many tasks depending on a single bottleneck).

---

## JSON and File I/O Issues

### Malformed JSON

**Error:** `Malformed JSON in {filename}: {parse_error}`

**Cause:** A JSON file could not be parsed. This usually happens when a file is read while still being written (partial write), or when a manual edit introduced a syntax error.

**How Synapse handles it:** For progress files, the watcher retries once after a short delay (configured by `PROGRESS_RETRY_MS`). If the retry also fails, the file is silently skipped until the next write.

**Fix:** If the error persists, check the file for syntax errors (missing commas, unclosed braces, trailing commas). Use `jq . < file.json` to validate.

### Invalid Schema

**Error (initialization):** `Invalid initialization.json schema in {id} -- task type: {type}, agents type: {type}, agents count: {count}`

**Error (progress):** `Invalid progress schema in {id}/{filename} -- task_id: {value}, status: {value}, stage: {value}`

**Error (logs):** `Invalid logs.json schema in {id} -- entries type: {type}, is array: {boolean}`

**Cause:** The file is valid JSON but does not conform to the expected schema. The watcher logs the types and values of key fields to help diagnose the mismatch.

**Fix:** Compare your file structure against the schema documentation:
- Initialization: [`documentation/data-architecture/initialization-json.md`](../data-architecture/initialization-json.md)
- Progress: [`documentation/data-architecture/progress-files.md`](../data-architecture/progress-files.md)
- Logs: [`documentation/data-architecture/logs-json.md`](../data-architecture/logs-json.md)

---

## Path Confusion: tracker_root vs project_root

One of the most common swarm failures is confusing `{tracker_root}` (Synapse's directory) with `{project_root}` (the target project's directory).

### Symptoms

- Workers write code to `{tracker_root}` instead of `{project_root}` -- the code ends up in Synapse's directory tree
- Workers write progress files to `{project_root}/dashboards/` instead of `{tracker_root}/dashboards/` -- the dashboard shows no progress
- Master uses wrong paths in worker prompts -- workers cannot find the files they need

### How to Diagnose

1. Check `.synapse/project.json` for the configured `project_root`
2. Verify worker prompts include both `{tracker_root}` and `{project_root}` explicitly
3. Look for the `enforce-tracker-root-writes.sh` hook rejection message (see [Tracker Root Write Violation](#tracker-root-write-violation) above)

### How to Fix

- Always include both absolute paths in worker dispatch prompts
- Use the `!project` command to verify the current project configuration
- When `{tracker_root}` equals `{project_root}` (Synapse targeting itself), path hooks are relaxed, but workers should still use explicit absolute paths

---

## Worker Context Exhaustion

### Symptoms

- Worker output is truncated mid-file
- Worker forgets earlier instructions partway through execution
- Worker silently drops files it was supposed to modify
- Progress file shows `completed` but work is incomplete

### Cause

The worker's context window was exhausted. This happens when a task requires reading too many files (10+) or modifying too many files (5+).

### Fix

Decompose the task into smaller subtasks. A well-sized task reads 2-3 files and modifies 1-2 files. If a task needs to touch more than 5 files, split it. See [`agent/instructions/common_pitfalls.md`](../../agent/instructions/common_pitfalls.md) for the "Large tasks that exhaust worker context" pitfall.

---

## Stale Progress Files (Ghost Agents)

### Symptoms

- Dashboard shows completed cards from a previous swarm
- Stats are wrong (more agents shown than planned)
- Phantom "in_progress" indicators for tasks that are not running

### Cause

Progress files from the previous swarm were not cleared before starting a new one.

### Fix

Always archive before clearing:

1. Copy the dashboard to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`
2. Remove old progress files: `rm -f {tracker_root}/dashboards/{id}/progress/*.json`

The `!reset` command handles this automatically. The `validate-archive-before-clear.sh` hook enforces that progress files are not deleted without archiving first.

---

## Shared File Conflicts

### Symptoms

- One worker's changes are silently overwritten by another worker running in the same wave
- Merge conflicts in files that multiple workers modified
- Corrupted or incomplete file content

### Cause

Two parallel workers modified the same file simultaneously. This is the most common planning error in swarms.

### Fix

Use one of the three shared file patterns:

- **Pattern A (Owner):** One task owns the file; others depend on it
- **Pattern B (Integration):** Tasks write separate files; a later task merges them
- **Pattern C (Separate):** Restructure so each task writes its own file

Prefer C > B > A. Check for file overlaps before dispatching -- no two concurrent agents may modify the same file. See the [planning guidance in CLAUDE.md](../../CLAUDE.md) for details.
