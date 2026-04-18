# FAQ -- Frequently Asked Questions

Answers to common questions about Synapse usage, configuration, and behavior. For error-specific troubleshooting, see [Common Issues](./common-issues.md).

---

## General

### What is the difference between `!p_track` and `!p`?

`!p_track` is the primary swarm command with full dashboard tracking. Workers write progress files, the master writes `initialization.json`, `logs.json`, `master_state.json`, and `metrics.json`. The dashboard shows live progress, dependency graphs, and statistics.

`!p` is a lightweight variant without dashboard overhead. Workers do not write progress files. The master writes minimal progress files from worker returns for file tracking. Use `!p` for simpler dispatches with fewer than 3 tasks and a single wave.

If your `!p` invocation has 3+ agents or multiple waves, consider using `!p_track` instead -- the dashboard visibility is worth the overhead at that scale.

### When should I use parallel vs serial execution?

**Serial:** The task touches 1-2 files, is a quick fix, and has no independent subtasks. Execute it directly without spawning workers.

**Parallel (`!p_track`):** The work decomposes into 3+ independent subtasks across multiple files. Use when tasks can run simultaneously without conflicting on shared files.

**Auto-escalation:** If a task clearly decomposes into 3+ independent subtasks, the master will proactively suggest parallel mode.

### What are Waves vs Chains?

**Waves** group tasks into sequential phases. Tasks within a wave run in parallel; waves execute one after another. Use when work has clear phases (e.g., "build foundation, then features, then integration").

**Chains** define linear dependency sequences (A feeds B feeds C). Multiple chains can run in parallel. Use when the dependency graph is clearly chain-shaped.

**Hybrid** mixes both. Most real swarms use a hybrid approach. Default to waves unless the dependency graph is clearly chain-shaped.

### What does the `{tracker_root}` vs `{project_root}` distinction mean?

`{tracker_root}` is the absolute path to the Synapse repository itself. All dashboard files, progress files, logs, and orchestration data live here.

`{project_root}` is the absolute path to the target project that Synapse is working on. All code modifications happen here.

These are typically two different directories. Workers must receive both paths in their dispatch prompts. Code goes to `{project_root}`; progress reporting goes to `{tracker_root}`. Confusing them is one of the most common swarm failures. See [Path Confusion](./common-issues.md#path-confusion-tracker_root-vs-project_root) in Common Issues.

---

## Project Setup

### How do I point Synapse at my project?

Use the `!project set /path/to/your/project` command. This writes the path to `{tracker_root}/.synapse/project.json`. You can verify the current setting with `!project` (no arguments).

In the Electron app, you can also use the Project modal to browse and select a directory.

### Does my project need a CLAUDE.md?

Not strictly required, but strongly recommended. The CLAUDE.md file tells workers about your project's conventions, file structure, naming patterns, and testing approach. Without it, workers may produce code that does not follow your project's style.

Use `!scaffold` to generate a basic CLAUDE.md, or `!create_claude` for a more opinionated version based on codebase analysis.

### What is the PKI (Project Knowledge Index)?

The PKI is a persistent knowledge layer at `{project_root}/.synapse/knowledge/` that accumulates deep understanding of your project -- gotchas, patterns, conventions, domain taxonomy, and file relationships. It is populated by:

- `!learn` -- Cold-start bootstrap (initial deep scan)
- Worker annotations -- Knowledge discovered during swarm execution
- PostToolUse staleness hook -- Automatic change detection
- `!learn_update` -- Incremental refresh for stale/new files

Masters use the PKI during pre-planning to inject relevant knowledge into worker prompts. Run `!learn` on a new project to bootstrap it.

---

## Swarm Execution

### How many workers can run in parallel?

There is no hard-coded limit. The practical limit depends on your system's resources and API rate limits. Each worker is a separate Claude Code process. Most swarms use 3-6 parallel workers per wave.

### Can I add tasks to a running swarm?

Yes. Use `!add_task {description}` to add tasks to the active swarm mid-flight. The new tasks are appended to the initialization plan and can depend on existing tasks.

### How do I retry a failed task?

Use `!retry {task_id}` to re-dispatch a failed task. The retry creates a new worker with the original task description plus context about the previous failure (error messages, partial work).

### What happens when a task fails?

1. The worker writes `status: "failed"` to its progress file with an error summary
2. The orchestrator logs the failure and checks the circuit breaker thresholds
3. If the failure is isolated (not triggering the circuit breaker), the master can create a repair task or retry
4. If 3+ tasks in the same wave fail, or the failure blocks >50% of remaining tasks, the circuit breaker triggers and the swarm enters replanning mode

See [Circuit Breaker](./common-issues.md#circuit-breaker) in Common Issues for details.

### What does "replanning mode" mean?

When the circuit breaker triggers, the swarm enters replanning mode. No new tasks are dispatched. The master analyzes the pattern of failures, identifies the root cause, and produces a revised plan. Use `!p_track_resume` to resume after the root cause is fixed.

### How do I resume a stalled swarm?

Use `!p_track_resume` to resume a stalled or interrupted swarm. It reconstructs state from dashboard files, checks agent health, re-dispatches stuck or failed tasks, and runs the full execution-to-completion lifecycle.

For simpler resumption (e.g., after a network interruption), `!resume` resumes the chat session, and `!track_resume` resumes the swarm tracking.

### Why is my dashboard not updating?

Common causes:

1. **Workers are not writing progress files.** Check that workers received the correct `{tracker_root}` path and dashboard ID.
2. **Progress files have validation errors.** Check the server logs for "REJECTED" or "Invalid progress schema" messages. See [Progress File Validation Errors](./common-issues.md#progress-file-validation-errors).
3. **The SSE server is not running.** Start it with `!start`. In the Electron app, the server starts automatically.
4. **Dashboard ID mismatch.** The worker's `dashboard_id` field does not match the dashboard directory. The server rejects the file silently.
5. **Stale browser cache.** Hard-refresh the dashboard page.

### Can two swarms run on different dashboards simultaneously?

Yes. Each dashboard is independent. Use `!master_plan_track` for multi-stream orchestration across multiple dashboards. Each dashboard has its own `initialization.json`, `logs.json`, progress directory, and lifecycle.

---

## Dashboard and Monitoring

### How do I check swarm status from the terminal?

Use `!status` for a summary view. Use `!logs` to view log entries (supports filtering). Use `!inspect {task_id}` for a deep-dive into a specific task. Use `!deps` to visualize the dependency graph.

### How do I cancel a running swarm?

Use `!cancel` for immediate cancellation, or `!cancel-safe` for a graceful shutdown that waits for in-progress workers to finish.

### What does `!reset` do?

`!reset` clears all tracker data: dashboard files, progress files, logs, and metrics. It archives the current state before clearing (enforced by the `validate-archive-before-clear.sh` hook). Use this to start fresh.

### Where are archived swarms stored?

Archived dashboards are stored in `{tracker_root}/Archive/`. Each archive is named `{YYYY-MM-DD}_{task_name}/` and contains a snapshot of the dashboard directory at the time of archival. Use `!history` to browse past swarms.

---

## Hooks and Validation

### What are hooks?

Hooks are shell scripts in `.claude/hooks/` that run before (PreToolUse) or after (PostToolUse) Claude Code tool invocations. They enforce guardrails:

- **PreToolUse hooks** can BLOCK a tool call (e.g., preventing a master from writing project files)
- **PostToolUse hooks** can WARN about issues (e.g., a progress file missing required fields)

Hooks fail open by default -- if `jq` is missing or the script encounters an error, the tool call is allowed.

### Why is my write being blocked?

Check which hook is blocking:

| Error pattern | Hook | Cause |
|---|---|---|
| "Master agent cannot write to project files" | `validate-master-write.sh` | Master trying to write code during active swarm |
| "Dashboard isolation violation" | `enforce-dashboard-isolation.sh` | Writing to wrong dashboard |
| "Dashboard file written to wrong location" | `enforce-tracker-root-writes.sh` | Dashboard file outside tracker_root |
| "initialization.json schema violations" | `validate-initialization-schema.sh` | Malformed initialization data |
| "initialization.json is write-once" | `validate-initialization-immutable.sh` | Changing task.name after initial write |

### Can I bypass a hook?

The `validate-initialization-schema.sh` hook supports `SYNAPSE_SKIP_SCHEMA=1` as an explicit bypass for scratch/repair work. Other hooks do not have bypass mechanisms -- they enforce critical invariants. If a hook is blocking legitimate work, review whether your approach follows the expected patterns rather than bypassing the guard.

---

## Configuration

### Where are Synapse settings stored?

- **Agent settings:** `.claude/settings.json` (project-level Claude Code configuration)
- **Project binding:** `.synapse/project.json` (target project path)
- **App settings:** Managed by `electron/settings.js` (persistent JSON store)
- **Server config:** `src/server/utils/constants.js` (timing values, directories)

### How do I change server timing values?

Edit `src/server/utils/constants.js`. Key values include:

- `INIT_POLL_MS` -- Polling interval for initialization.json changes
- `PROGRESS_RETRY_MS` -- Retry delay for malformed progress file reads
- `PROGRESS_READ_DELAY_MS` -- Delay before reading a changed progress file
- `RECONCILE_DEBOUNCE_MS` -- Debounce interval for directory change events
- `RECONCILE_INTERVAL_MS` -- Periodic reconciliation interval

### How do I use the Live Preview?

1. Run `!instrument` on your project to add `data-synapse-label` attributes to text elements
2. Start your dev server (e.g., `npm run dev`)
3. Click the Preview tab in the sidebar and enter your dev server URL
4. Double-click any labeled text element to edit it inline

The preview supports React, Next.js, Vite, and any HTML/JS project.

---

## Profiles and Commands

### What are profiles?

Profiles are role-based agent configurations in `_commands/profiles/`. They adapt Claude's behavior for specific domains (analyst, architect, QA, security, etc.). Use `!profiles` to list available profiles.

### How do I create a custom command?

Create a markdown file in `_commands/Synapse/` (for swarm commands) or `_commands/project/` (for project commands). The file name (without extension) becomes the command name. See [`documentation/commands/creating-commands.md`](../commands/creating-commands.md) for the full guide.

### How do I list all available commands?

Use `!commands` to discover all available commands, or `!guide` for a decision tree that helps you pick the right command for your situation.
