# Hooks Reference

Synapse uses Claude Code hooks to enforce constraints on agent behavior at runtime. Hooks are shell scripts (`.claude/hooks/*.sh`) that fire before or after specific tool invocations, intercepting tool calls to validate, block, or annotate agent actions.

All hook configurations are defined in `.claude/settings.json` under the `hooks` key.

---

## Hook Lifecycle Events

Claude Code supports four hook events. Synapse uses all four:

| Event | When It Fires | Can Block? | Output Format |
|---|---|---|---|
| **PreToolUse** | Before a tool executes | Yes | `{"decision":"allow"}` or `{"decision":"block","reason":"..."}` |
| **PostToolUse** | After a tool executes | No (warn only) | `{"message":"..."}` or silent exit |
| **Notification** | When a background agent sends a notification | No | `{"message":"..."}` or silent exit |
| **Stop** | When the agent session ends | No | `{"message":"..."}` or silent exit |

### Fail-Open Convention

All Synapse hooks follow a **fail-open** design: if `jq` is unavailable, stdin is empty, or any unexpected error occurs, the hook outputs `{"decision":"allow"}` (for PreToolUse) or exits silently (for PostToolUse). This prevents hooks from breaking normal CLI usage outside of swarm contexts.

---

## Hook Configuration in settings.json

Hooks are organized by event and matcher. The `matcher` field specifies which tool names trigger the hook (supports `|` for multiple tools):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": ".claude/hooks/some-hook.sh" }
        ]
      }
    ]
  }
}
```

Agent definitions (`.claude/agents/*.md`) can also declare hooks in their YAML frontmatter, scoped to that agent type only.

---

## PreToolUse Hooks

### On Edit|Write (6 hooks)

These fire before any `Edit` or `Write` tool call.

#### enforce-dashboard-isolation.sh

**Purpose:** Prevents an agent from writing to any dashboard other than its assigned one.

**Assignment resolution order:**
1. `SYNAPSE_DASHBOARD_ID` environment variable (set by Electron when spawning CLI agents)
2. `DASHBOARD ID:` directive parsed from the transcript system prompt (between `===DASHBOARD_BINDING_START===` / `===DASHBOARD_BINDING_END===` markers)

**Behavior:**
- If no assignment is discoverable, the hook **allows** the write (fail-open for raw CLI usage).
- Only intercepts writes under `{tracker_root}/dashboards/`.
- Validates that the target dashboard ID in the file path matches the assigned ID.
- Blocks with a message identifying the isolation violation if there is a mismatch.

**Valid dashboard ID shapes:** `ide`, 6-character hex (e.g., `a3f7k2`), or legacy `dashboardN` format.

---

#### enforce-tracker-root-writes.sh

**Purpose:** Blocks dashboard-pattern files from being written outside `{tracker_root}`. Prevents agents from accidentally writing `initialization.json`, `logs.json`, `master_state.json`, `metrics.json`, or `progress/*.json` to `{project_root}/dashboards/` instead of the correct `{tracker_root}/dashboards/`.

**Behavior:**
- If the file is already under `{tracker_root}/dashboards/`, allows immediately.
- If the file matches a dashboard file pattern (`*/dashboards/*/initialization.json`, etc.) but is NOT under `{tracker_root}`, blocks with the correct path in the error message.
- Non-dashboard files are always allowed.

---

#### validate-master-write.sh

**Purpose:** Blocks the master agent from writing application source files in `{project_root}` during an active swarm. Enforces the core constraint that "the master never writes code."

**Behavior:**
- Reads `{project_root}` from `.synapse/project.json`.
- If `{project_root}` equals `{tracker_root}` (Synapse targeting itself), allows all writes.
- Always allows writes to tracker directories: `dashboards/`, `tasks/`, `Archive/`, `.claude/`, `.synapse/`.
- Checks for active swarms by scanning `initialization.json` files for non-null `task` objects (skipping the `ide` dashboard).
- If no swarm is active, allows the write.
- If a swarm IS active and the file is in `{project_root}`, blocks with instructions to create a worker task instead.

---

#### validate-plan-required.sh

**Purpose:** Blocks writing `initialization.json` unless a properly structured `plan.json` exists in the same dashboard directory. Enforces the planning-before-execution gate.

**Validation checks on plan.json:**
1. File must exist and be valid JSON.
2. Required top-level fields: `name` (kebab-case slug), `created` (ISO 8601 timestamp).
3. `context.prompt` must be non-empty (the verbatim user prompt).
4. `tasks[]` array must have at least one entry.
5. Each task must have: `id`, `title`, `description`, `approach`, and a non-empty `files` list.
6. Cross-check: if writing via `Write` tool, the agent count in `initialization.json` must match the task count in `plan.json`.

**Exceptions:** Allows `Edit` operations on an already-populated `initialization.json` (for repair tasks, `!add_task`, etc.).

---

#### validate-initialization-immutable.sh

**Purpose:** Prevents unauthorized changes to `initialization.json` that would mutate `task.name` after initial creation. The initialization file is write-once for task identity.

**Behavior:**
- If the file does not exist yet, allows (first write).
- If the existing file has no `task.name`, allows (nothing to protect).
- `Edit` tool calls are always allowed (legitimate repair/rewire operations).
- `Write` tool calls are checked: if the new content has a different `task.name` than the existing file, the write is blocked.

---

#### validate-initialization-schema.sh

**Purpose:** Validates the full schema of `initialization.json` before a `Write` lands. Catches structural errors that would produce a broken dashboard (e.g., waves with no agents, orphaned dependencies).

**Bypass:** Set `SYNAPSE_SKIP_SCHEMA=1` in the environment to skip validation (for scratch/repair work).

**Validation checks:**
- Content must be valid JSON.
- The default empty template (from `ensureDashboard`) is always allowed.
- `task.name` must be kebab-case.
- `task.type` must be exactly `"Waves"` or `"Chains"`.
- `task.created` must be present.
- `task.total_tasks` and `task.total_waves` must be positive integers.
- `agents[]` and `waves[]` must be non-empty.
- `task.total_waves` must equal `waves[].length`.
- `task.total_tasks` must equal `agents[].length`.
- Sum of `waves[].total` must equal `agents[].length`.
- Agent IDs must match format `{wave}.{index}` or `{wave}.{index}r` (repair tasks).
- No duplicate agent IDs.
- Every `agents[i].wave` must reference an existing `waves[j].id`.
- Every `depends_on` entry must reference an existing agent ID.
- For `Chains` type: `chains[]` must be present, and every agent must appear in exactly one chain.

---

### On Task (2 hooks)

These fire before the `Task` tool (used to dispatch worker agents).

#### validate-worker-prompt.sh

**Purpose:** Blocks worker dispatch prompts that are missing required metadata sections. Prompt quality is the primary determinant of worker success.

**Template versions:**
- `p_track_v2` (full tracking) -- requires 7 sections: `YOUR PROGRESS FILE:`, `YOUR TASK ID:`, `YOUR AGENT LABEL:`, `RETURN FORMAT`, `PROJECT ROOT:`, `TRACKER ROOT:`, `INSTRUCTION MODE:`.
- `p_v2` (lightweight) -- requires 4 sections: `RETURN FORMAT`, `PROJECT ROOT:`, `TRACKER ROOT:`, `INSTRUCTION MODE:`.

**Behavior:**
- Only fires if the prompt contains `TEMPLATE_VERSION:`. Regular Task calls (research, exploration) are not gated.
- Unknown template versions are allowed (fail-open).

---

#### validate-approval-gate.sh

**Purpose:** Blocks worker dispatch until the user has explicitly approved the plan. Enforces the mandatory approval gate before execution begins.

**Required sequence in logs.json:**
1. Master writes a `permission`-level log entry containing "Plan ready for review".
2. Master halts and waits for user response.
3. On user approval, master writes an `info`-level log entry containing "Approval granted".
4. Only then can workers be dispatched.

**Behavior:**
- Only gates prompts containing `TEMPLATE_VERSION:` (worker dispatches).
- Extracts dashboard ID from the worker prompt's progress-file path.
- Checks `logs.json` for the latest `permission` entry with "Plan ready for review".
- Checks that an `info` entry with "Approval granted" exists after that permission entry.
- Repair dispatches and Phase 3 verification dispatches inherit the original approval.

---

### On Bash (3 hooks)

These fire before `Bash` tool calls.

#### enforce-dashboard-isolation-bash.sh

**Purpose:** Companion to `enforce-dashboard-isolation.sh` for Bash commands. Blocks shell commands (mkdir, cp, rm, echo redirects, etc.) that reference a different dashboard than the agent's assigned one.

**Behavior:**
- Uses the same assignment resolution as the Edit|Write version.
- Scans the command string for `dashboards/{id}` references.
- All referenced dashboard IDs must match the assigned one.
- Only validates IDs matching real dashboard-ID shapes to avoid false positives from source paths.

---

#### enforce-tracker-root-writes-bash.sh

**Purpose:** Companion to `enforce-tracker-root-writes.sh` for Bash commands. Blocks shell commands that write dashboard files to `{project_root}` instead of `{tracker_root}`.

**Behavior:**
- Only checks commands referencing dashboard file patterns.
- If the command references `{tracker_root}/dashboards/`, allows.
- If the command references `{project_root}/dashboards/`, blocks with the correct path.
- If `{tracker_root}` equals `{project_root}`, no conflict is possible.

---

#### validate-archive-before-clear.sh

**Purpose:** Blocks `rm` commands targeting dashboard directories unless the data has been archived first.

**Behavior:**
- Only checks commands containing `rm` and targeting `dashboards/*/progress` or `dashboards/*`.
- Skips the `ide` dashboard (permanent, no archiving needed).
- Checks if the dashboard has an active task (non-null `task` in `initialization.json`).
- If no active task, allows the clear.
- If active, searches `Archive/` for a directory whose name contains the dashboard ID or task name.
- Blocks if no archive is found, with a suggested archive command.

---

## PostToolUse Hooks

### On Write (6 hooks)

These fire after a `Write` tool call completes. They cannot block -- only warn.

#### validate-progress-file.sh

**Purpose:** Validates that worker progress files have required fields and valid status values.

**Checks:**
- Only triggers for files matching `*/progress/*.json`.
- Required fields: `task_id`, `status`, `assigned_agent`, `stage`.
- Valid `status` values: `in_progress`, `completed`, `failed`.

---

#### validate-progress-log-detail.sh

**Purpose:** Enforces rich, narrative log entries in progress files. Prevents vague placeholders like "Starting..." or "Done."

**Checks (8 total):**
1. `logs[]` must be non-empty.
2. `message` field must be at least 15 characters.
3. Latest log entry must be at least 20 characters.
4. No lazy/vague log patterns ("Starting...", "Done", "Working on it", etc.).
5. Minimum log count per stage: `planning` >= 2, `implementing` >= 3, `testing` >= 4, `finalizing`/`completed` >= 5.
6. No consecutive duplicate log messages.
7. Milestones required for `implementing` stage and beyond.
8. `files_changed` must be populated during `implementing`+ stages.

---

#### mark-annotation-stale.sh

**Purpose:** Marks Project Knowledge Index (PKI) annotations as stale when an agent writes to a project file that has an entry in the PKI manifest.

**Behavior:**
- Skips Synapse internal files (progress files, `.synapse/knowledge/` files).
- Looks up the file's relative path in `{project_root}/.synapse/knowledge/manifest.json`.
- If found and not already stale, sets `stale: true` and recomputes the stale count.
- Uses atomic write-then-rename for manifest updates.

---

#### validate-log-entry.sh

**Purpose:** Validates that `logs.json` entries have required fields and valid level values.

**Checks:**
- Only triggers for files matching `*/logs.json`.
- Validates the last entry in `entries[]`.
- Required fields: `timestamp`, `task_id`, `agent`, `level`, `message`.
- Valid `level` values: `info`, `warn`, `error`, `deviation`, `permission`, `debug`.

---

#### validate-master-state.sh

**Purpose:** Validates that `master_state.json` has required fields and correct types. A malformed checkpoint makes compaction recovery impossible.

**Required fields and types:**
- `last_updated` -- string (ISO 8601 timestamp)
- `completed` -- array
- `in_progress` -- array
- `failed` -- array
- `upstream_results` -- object
- `next_agent_number` -- number (> 0)

---

#### validate-chat-dashboard.sh

**Purpose:** Warns when agents write to mismatched dashboard types. Detects two scenarios:
1. A chat agent (`chat-agent-*` dashboard) writing to a different dashboard than assigned.
2. A code agent (non-chat dashboard) writing to a chat dashboard (possible routing error).

**Behavior:**
- Only fires for writes to `dashboards/` directories.
- Requires `SYNAPSE_DASHBOARD_ID` environment variable to be set.

---

### On Edit|Write (1 hook)

#### nudge-progress-update.sh

**Purpose:** Reminds workers to update their progress file after editing/creating project files. Helps workers maintain accurate `files_changed` tracking.

**Conditions for firing:**
1. The changed file must be a project file (not a Synapse internal file).
2. An active swarm must exist (at least one `in_progress` progress file).
3. No progress file was updated in the last ~1 minute (avoids nagging diligent workers).

**Output:** A message suggesting the worker add the file to `files_changed[]` and write a detailed log entry.

---

### On Agent (1 hook)

#### worker-status-on-dispatch.sh

**Purpose:** Returns a compact swarm status summary after the master dispatches a worker. Gives the master continuous visibility into swarm state.

**Behavior:**
- Only fires for background agent dispatches (`run_in_background: true`).
- Finds the most recently active dashboard by progress file modification time.
- Counts completed, active, and failed workers.
- Returns a one-line summary: "Worker dispatched. Swarm ({id}): X/Y completed, Z active, W failed."

---

## Notification Hook

#### worker-status-on-notify.sh

**Purpose:** Fires when a background agent sends a notification (typically on completion or failure). Returns a detailed swarm status summary.

**Output includes:**
- Completion count, active count, failed count out of total dispatched.
- Stale worker detection: workers with no progress update in 10+ minutes.
- Failed task IDs.
- Active worker detail: task ID, agent name, stage, and time since last update.

---

## Stop Hook

#### verify-final-report.sh

**Purpose:** Checks if an active swarm exists without a completion report when the agent session ends. Warns the user to run `!status` or complete the swarm before exiting.

**Behavior:**
- Scans all non-`ide` dashboards for active tasks.
- Checks `logs.json` for completion messages (patterns: "swarm complete", "all tasks completed", "swarm finished", "completion report").
- Warns if an active swarm has no completion evidence.

---

## Hook Summary Table

| Hook Script | Event | Matcher | Action | Purpose |
|---|---|---|---|---|
| `enforce-dashboard-isolation.sh` | PreToolUse | Edit\|Write | Block | Prevent cross-dashboard writes |
| `enforce-tracker-root-writes.sh` | PreToolUse | Edit\|Write | Block | Prevent dashboard files in project root |
| `validate-master-write.sh` | PreToolUse | Edit\|Write | Block | Prevent master from writing project code |
| `validate-plan-required.sh` | PreToolUse | Edit\|Write | Block | Require plan.json before initialization.json |
| `validate-initialization-immutable.sh` | PreToolUse | Edit\|Write | Block | Prevent task.name mutation |
| `validate-initialization-schema.sh` | PreToolUse | Edit\|Write | Block | Full initialization.json schema validation |
| `validate-worker-prompt.sh` | PreToolUse | Task | Block | Require metadata sections in worker prompts |
| `validate-approval-gate.sh` | PreToolUse | Task | Block | Require user approval before dispatch |
| `enforce-dashboard-isolation-bash.sh` | PreToolUse | Bash | Block | Prevent cross-dashboard bash commands |
| `enforce-tracker-root-writes-bash.sh` | PreToolUse | Bash | Block | Prevent dashboard bash writes to project root |
| `validate-archive-before-clear.sh` | PreToolUse | Bash | Block | Require archive before rm on dashboards |
| `validate-progress-file.sh` | PostToolUse | Write | Warn | Validate progress file schema |
| `validate-progress-log-detail.sh` | PostToolUse | Write | Warn | Enforce detailed progress logs |
| `mark-annotation-stale.sh` | PostToolUse | Write | Silent | Mark PKI annotations stale on project file change |
| `validate-log-entry.sh` | PostToolUse | Write | Warn | Validate logs.json entry schema |
| `validate-master-state.sh` | PostToolUse | Write | Warn | Validate master_state.json schema |
| `validate-chat-dashboard.sh` | PostToolUse | Write | Warn | Detect chat/code agent dashboard mismatches |
| `nudge-progress-update.sh` | PostToolUse | Edit\|Write | Message | Remind worker to update progress file |
| `worker-status-on-dispatch.sh` | PostToolUse | Agent | Message | Swarm status after dispatch |
| `worker-status-on-notify.sh` | Notification | (all) | Message | Swarm status on worker notification |
| `verify-final-report.sh` | Stop | (all) | Warn | Check for completion report on exit |

---

## Troubleshooting

### Hook is blocking unexpectedly

1. **Check the error message.** Hook block reasons always include specific details (expected path, actual path, missing fields, etc.).
2. **Verify dashboard assignment.** Run `echo $SYNAPSE_DASHBOARD_ID` to check the environment variable. If unset, the transcript `DASHBOARD ID:` directive is used.
3. **Bypass schema validation.** Set `SYNAPSE_SKIP_SCHEMA=1` for scratch/repair work on `initialization.json`.
4. **Check jq availability.** All hooks require `jq` for JSON parsing. If `jq` is not installed, hooks fail open (allow all).

### Hook is not firing

1. **Check the matcher.** The hook only fires for tools matching the `matcher` pattern in `settings.json`. `Edit|Write` matches both tools; `Bash` matches only Bash, etc.
2. **Check file path patterns.** Most hooks early-exit based on file path patterns (e.g., `*/progress/*.json`, `*/logs.json`). Verify the file being written matches the expected pattern.
3. **Check for fail-open exits.** If jq fails, stdin is empty, or any guard condition is not met, hooks exit silently.

### PostToolUse warnings not appearing

PostToolUse hooks output `{"message":"..."}` to inject warnings into the agent's context. If no message is printed (the hook exits with `ok()`), the agent receives no feedback. This is by design for files that pass validation.

### Adding a new hook

1. Create the script in `.claude/hooks/` with `#!/bin/bash` and `set -o pipefail`.
2. Define `allow()`/`block()` (PreToolUse) or `ok()`/`warn()` (PostToolUse) helper functions.
3. Read stdin as JSON, extract fields with `jq`, validate, and output the appropriate response.
4. Register the hook in `.claude/settings.json` under the correct event and matcher.
5. Make the script executable: `chmod +x .claude/hooks/your-hook.sh`.

### Common patterns in hook scripts

All hooks follow a consistent structure:

```bash
#!/bin/bash
set -o pipefail

# Helper functions
allow() { echo '{"decision":"allow"}'; exit 0; }
block() { echo "{\"decision\":\"block\",\"reason\":\"$1\"}"; exit 0; }

# Fail-open if jq missing
command -v jq &>/dev/null || allow

# Read stdin
INPUT=$(cat 2>/dev/null) || allow
[ -z "$INPUT" ] && allow

# Extract tool input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty') || allow
[ -z "$FILE_PATH" ] && allow

# Resolve tracker root (two levels up from script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ... validation logic ...

allow
```

**Key stdin fields available to hooks:**
- `.tool_name` -- The tool being invoked (`Edit`, `Write`, `Bash`, `Task`, `Agent`)
- `.tool_input.file_path` -- File path for Edit/Write
- `.tool_input.command` -- Command string for Bash
- `.tool_input.prompt` -- Prompt text for Task/Agent
- `.tool_input.run_in_background` -- Boolean for Agent (background dispatch)
- `.transcript_path` -- Path to the conversation transcript file
