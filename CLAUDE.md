# Synapse — Distributed Agent Swarm Control System

Synapse is a standalone distributed control system for coordinating autonomous agent swarms. It optimizes context usage, parallelizes execution, and provides a centralized control plane for complex software development tasks.

Synapse operates on a **target project** that lives at `{project_root}` — completely separate from Synapse's own location at `{tracker_root}`. Workers do their code work in `{project_root}` and report progress back to `{tracker_root}`. Synapse does not need to be inside the project it manages.

---

## Quick Start

```bash
# 1. Point Synapse at your project (or just run from within the project directory)
!project set /path/to/your/project

# 2. Start the dashboard
node {tracker_root}/src/server/index.js

# 3. Launch the Electron app
npm start

# 4. Run a parallel task
!p_track {your prompt here}
```

If you are already working inside the target project directory, Synapse will auto-detect it as `{project_root}` — no `!project set` needed.

---

## Path Convention

Every path in Synapse uses one of two placeholders:

| Placeholder | Meaning | Example |
|---|---|---|
| `{tracker_root}` | Absolute path to the Synapse repository | `/Users/dean/tools/Synapse` |
| `{project_root}` | Absolute path to the target project being worked on | `/Users/dean/repos/my-app` |

These are always absolute paths. Workers receive **both** in their dispatch prompts. They write code in `{project_root}` and report progress to `{tracker_root}/dashboards/{dashboardId}/progress/`.

### Resolving `{project_root}`

When any Synapse command needs the target project, resolve in this order:

1. **Explicit `--project /path` flag** on the command
2. **Stored config** at `{tracker_root}/.synapse/project.json` (set via `!project set /path`)
3. **Current working directory** — the agent's CWD

---

## How It Works

```
Master Agent plans → writes initialization.json once
        │
        ▼
Workers execute tasks in {project_root} → write progress files to {tracker_root}
        │
        ▼
server.js detects file changes (fs.watch on progress/, fs.watchFile on init/logs)
        │
        ▼
SSE pushes updates to browser in real-time
        │
        ▼
Dashboard merges initialization.json + progress files → renders live status
```

The master agent (you, when running `!p_track`) is the orchestrator. Worker agents are spawned via the Task tool. The dashboard merges static plan data from `initialization.json` with dynamic lifecycle data from worker progress files to produce the combined view. All orchestration logic lives in the master agent's instructions.

---

## The Master Agent Role — NON-NEGOTIABLE

When a swarm is active, you are the **master agent**. This is not a suggestion — it is an absolute, inviolable constraint on your behavior. The master agent is the **orchestrator**. It is not a worker. It does not write code. It does not implement features. It does not fix bugs. It does not edit application files. It does not create components, functions, services, tests, or any artifact that belongs to the codebase being worked on.

### What the Master Agent Does

The master agent has exactly **five responsibilities** during a swarm. Nothing more.

#### 1. Gather Context

- Read the Synapse `CLAUDE.md` (this file) for swarm protocols
- Read `{project_root}/CLAUDE.md` for target project conventions, architecture, and constraints
- If a project TOC exists at `{project_root}/.synapse/toc.md`, read it for semantic orientation
- Use Glob/Grep within `{project_root}` for targeted file discovery
- Read source files, documentation, types, schemas, and configs needed to understand the task
- Read relevant command files from `_commands/` directories
- Build a complete mental model of the codebase, dependencies, and constraints

The master agent reads **extensively**. It reads more than any worker will. It reads documentation, code, types, and tests. This deep context gathering is what makes the plan accurate and the agent prompts self-contained. Skimping here causes cascading failures downstream.

#### 2. Plan

- Decompose the task into atomic, self-contained units
- Map every dependency between tasks (what blocks what)
- Determine wave groupings for visual organization
- Write each agent's prompt with **complete, self-contained context** — the agent must be able to execute without reading additional files or asking questions
- Include in every agent prompt: the specific files to modify, the conventions from `{project_root}/CLAUDE.md`, code snippets the agent needs to see, clear success criteria, **and both `{tracker_root}` and `{project_root}` paths**
- Create the master XML task file documenting the full plan
- Write the strategy rationale plan file
- **Populate the dashboard before presenting the plan to the user** — **if the dashboard contains data from a previous swarm, archive it first** by copying the full dashboard directory to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/` before clearing. Then clear the progress directory, write the full plan to `initialization.json` (all tasks, all waves, all dependencies — static plan data only), and write an initialization entry to `logs.json`. This gives the user a live visual representation of the plan on the dashboard while they review and approve it. **`initialization.json` is write-once — the master never updates it after planning, unless the circuit breaker triggers automatic replanning (see Principle 5).** **Never clear a dashboard without archiving first — previous swarm data must always be preserved.**

Planning is where the master agent earns its value. A well-planned swarm executes fast with zero confusion. A poorly-planned swarm produces broken code, conflicting edits, and wasted cycles. **Invest heavily in planning. Never rush it.**

#### 3. Dispatch

- The dashboard is already populated with the full plan from the planning phase — all tasks visible as pending cards with dependency lines
- Spawn worker agents via the Task tool with their complete prompts (the elapsed timer starts automatically when the first worker writes its progress file with a `started_at` value)
- **Every worker prompt must include `{tracker_root}` (for progress reporting) and `{project_root}` (for code work)** — workers cannot auto-detect these
- Dispatch all independent tasks in parallel — no artificial sequencing
- As workers complete, immediately scan for newly unblocked tasks and dispatch them
- Never let the pipeline stall waiting for a batch or wave to finish

#### 4. Status

- Append to `logs.json` on dispatches, completions, failures, and deviations
- Update the master XML with completion summaries, error details, and timing
- **The master does NOT update `initialization.json` after planning** — workers own all lifecycle data in their progress files. The dashboard derives all stats (completed count, failed count, wave progress, overall status, elapsed time) from progress files.
- **Do NOT output terminal status tables during execution** — the dashboard is the primary reporting channel. Output only brief one-line terminal confirmations per event.
- Workers handle their own live progress reporting via `dashboards/{dashboardId}/progress/{id}.json` files — the master does not need to relay progress updates
- The dashboard is the user's primary visibility into swarm progress — **stale data is a failure**

#### 5. Report

- When all agents have completed (or failed), compile a final summary
- Report what was accomplished, what failed, and what needs follow-up
- Update the project TOC at `{project_root}/.synapse/toc.md` if the swarm created, moved, or restructured files (and if a TOC exists)
- Move the completed swarm to history if a new swarm will start

### What the Master Agent NEVER Does During a Swarm

This list is exhaustive and absolute. There are **no exceptions**.

- **NEVER write code.** Not a single line. Not a "quick fix." Not a "small tweak." Not "just this one file." If code needs to be written, it is a task for a worker agent.
- **NEVER edit application source files.** No `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.css`, `.html`, `.json` (except `initialization.json` and `logs.json` in the dashboard directory), or any other file that belongs to the codebase being worked on.
- **NEVER create application files.** No new components, services, utilities, tests, configs, or any other artifact that a worker should create.
- **NEVER run application commands.** No `npm run build`, no `npm test`, no `python manage.py`, no application-specific CLI tools. If testing or building is needed, it is a task for a worker agent.
- **NEVER "help" a worker by doing part of its task.** If a task is too large for one agent, decompose it into smaller tasks. Do not do half the work yourself and dispatch the other half.
- **NEVER implement "just one thing" directly because "it's faster."** It is never faster. The moment you start coding, you lose your orchestrator perspective. You become a worker with half-attention on orchestration. Both suffer.

### Why This Matters

The master agent's power comes from its **elevated perspective**. It sees the full dependency graph. It holds context from the entire project. It knows what every worker is doing and what comes next. The moment it starts writing code, it loses this perspective. It gets tunnel-visioned into implementation details. It forgets to dispatch the next wave. It misses a dependency. It writes code that conflicts with what a worker is simultaneously producing.

A conductor does not pick up a violin mid-symphony. The master agent does not pick up an editor mid-swarm.

### The Only Files the Master Agent Writes

During a swarm, the master agent writes to exactly these files at `{tracker_root}` and **no others**:

| File | Purpose |
|---|---|
| `dashboards/{dashboardId}/initialization.json` | Static plan data (written ONCE during planning) |
| `dashboards/{dashboardId}/logs.json` | Timestamped event log for the dashboard |
| `dashboards/{dashboardId}/master_state.json` | State checkpoint for context compaction recovery |
| `tasks/{date}/parallel_{name}.xml` | Master task record (plan, status, summaries) |
| `tasks/{date}/parallel_plan_{name}.md` | Strategy rationale document |

Everything else is a worker's job. The master agent writes **nothing** into `{project_root}`.

### Archive Before Clear — NON-NEGOTIABLE

**The master agent must ALWAYS archive a dashboard before clearing it.** Previous swarm data is never discarded — it is moved to the Archive for future reference.

When the master needs to clear a dashboard (e.g., to start a new swarm on a dashboard that has previous data):

1. **Check if the dashboard has data** — read `initialization.json`. If `task` is not `null`, the dashboard has a previous swarm.
2. **Archive the dashboard** — copy the entire dashboard directory (`initialization.json`, `logs.json`, `progress/`) to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`.
3. **Then clear** — delete progress files, reset `initialization.json` and `logs.json` to empty state.

This applies everywhere a dashboard is cleared: `!p_track` initialization, `!reset`, `!master_plan_track` slot clearing, queue-to-dashboard promotion, and any other operation that overwrites dashboard state. **No exceptions.**

### After a Swarm Completes

Once all workers have finished and the master has compiled its final report, the swarm is over. At this point — and **only** at this point — the master agent may resume normal agent behavior (including direct code edits) if the user requests non-parallel work. The no-code restriction applies **exclusively during active swarm orchestration.**

---

## Project Discovery and Context Gathering

### Context Efficiency Principles

The master agent's most critical skill is **context efficiency** — gathering exactly the right information with minimal reads, and preserving context window space for reasoning and execution.

1. **Glob/Grep first for targeted searches.** They cost zero context tokens and are always current. Use them before reaching for the TOC.

2. **Project CLAUDE.md for orientation.** `{project_root}/CLAUDE.md` provides the architectural overview, conventions, and patterns for the target project. Read it before any work in the project.

3. **Project TOC for semantic discovery.** When filenames don't reveal purpose, or you need to understand how components relate, check `{project_root}/.synapse/toc.md` if one exists. If none exists and the project is large (500+ files), consider running `!toc_generate`.

4. **Read with purpose.** Before reading any file, know what you expect to find. If you're reading "just in case," you're wasting context.

5. **Parallel reads.** When you need to read multiple files, read them all in a single parallel call. Never read files sequentially when they have no dependency between them.

6. **Targeted line ranges.** For large files where you only need a specific section, use line offsets rather than reading the entire file.

7. **Cache awareness.** After context compaction, you lose file contents from earlier reads. Re-read critical files rather than working from stale memory.

8. **Summarize, don't hoard.** After reading a file for context, extract the relevant facts and move on. You don't need to keep the entire file contents in working memory.

9. **Budget worker prompts.** Each worker prompt should target ~8000 tokens or less. Break down the prompt into sections (description, context, conventions, upstream results, instructions) and estimate each. If total exceeds the budget, split the task or summarize conventions. Bloated prompts are the primary cause of worker context exhaustion.

10. **Filter conventions by relevance.** When injecting project CLAUDE.md content into worker prompts, include only the convention categories that apply to the specific task. A worker creating a backend utility function does not need frontend styling conventions. For large CLAUDE.md files (500+ lines), always summarize rather than quote.

### Project `.synapse/` Directory

Synapse stores project-scoped metadata in `{project_root}/.synapse/`:

| File | Purpose |
|---|---|
| `toc.md` | Project Table of Contents — semantic index of files and directories (generated by `!toc_generate`) |
| `config.json` | Project-Synapse configuration (project name, paths, tech stack, initialization timestamp) |

Projects should add `.synapse/` to their `.gitignore`. This directory is optional — Synapse works without it but provides better context efficiency when it exists.

---

## Command Resolution — `!{command}` System

When the user types `!{command}`, locate and execute the corresponding command file. Commands are resolved in this priority order:

### Resolution Order

```
1. {tracker_root}/_commands/Synapse/{command}.md       ← Synapse swarm commands (highest priority)
2. {tracker_root}/_commands/project/{command}.md       ← Synapse project commands
3. {project_root}/_commands/{command}.md               ← Project-specific commands
```

### Resolution Rules

1. **Check Synapse swarm commands first.** Swarm and dashboard commands (`!p_track`, `!status`, `!dispatch`, etc.) live at `{tracker_root}/_commands/Synapse/`. Always checked first.

2. **Check Synapse project commands second.** Project analysis and management commands (`!context`, `!review`, `!health`, `!toc`, etc.) live at `{tracker_root}/_commands/project/`.

3. **Check the target project last.** Projects may define their own commands at `{project_root}/_commands/`. These allow project-specific workflows and overrides.

4. **If not found anywhere**, inform the user that `!{command}` does not exist and list available commands from all discovered locations.

5. **Once found, read the command file in full and follow it exactly.** Command files are complete specs — do not improvise, skip steps, or partially execute.

---

## Profile System — `!profile` Modifier

Profiles override the agent's default priorities, goals, tone, and output style to match a specific role. They are defined as markdown files in `{tracker_root}/_commands/profiles/` and are applied as a **modifier on top of any command**, not as a standalone command.

### How Profiles Work

A profile does not replace the agent's core instructions (this CLAUDE.md). It layers on top of them — adjusting **what the agent prioritizes**, **how it frames its output**, and **what success looks like** for the duration of the task. The agent's technical capabilities, tool access, and orchestration protocols remain unchanged. The profile shapes the agent's persona, priorities, and deliverables.

### Syntax

Profiles are invoked with `!{profile_name}` placed before or alongside other commands and prompts:

```
!{profile_name} {prompt}                         ← Profile + direct task
!{profile_name} !{command} {prompt}              ← Profile + command + task
!p !{profile_name} {prompt}                      ← Parallel + profile + task
!p_track !{profile_name} {prompt}                ← Tracked swarm + profile + task
```

### Profile Resolution

```
{tracker_root}/_commands/profiles/{profile_name}.md
```

If found, read the profile file in full and apply it. If not found, inform the user and list available profiles.

### Profile File Structure

Every profile file must define:

- **Role** — Who the agent becomes (e.g., "Senior Marketing Strategist")
- **Priorities** — What the agent optimizes for, in ranked order
- **Constraints** — What the agent avoids or deprioritizes
- **Output Style** — Tone, format, structure, and length expectations
- **Success Criteria** — What a good output looks like for this role

### Applying Profiles

When a profile is active:

1. **Read the profile file in full** before beginning any work
2. **Adopt the role's priorities and output style** for all work in the current task
3. **Combine with command protocols seamlessly** — if `!p` is also invoked, the swarm protocol still applies in full, but each agent receives the profile context in its prompt so it operates under the same role
4. **When dispatching agents with a profile**, include the full profile content in each agent's prompt — agents must adopt the same role, priorities, and output style as the master agent would
5. **Profile scope is task-scoped** — the profile applies for the duration of the current task only

### Profile + Command Interaction

| Invocation | Behavior |
|---|---|
| `!{profile} {prompt}` | Serial execution under profile persona |
| `!{profile} !{command} {prompt}` | Execute command with profile priorities applied |
| `!p !{profile} {prompt}` | Parallel dispatch — all agents adopt the profile |
| `!p_track !{profile} {prompt}` | Tracked swarm — all agents adopt the profile |

---

## Execution Mode Selection — Serial vs. Parallel

The master agent operates in two distinct modes. Choosing the right mode is critical to efficiency.

### Serial Mode (Default)

For tasks that are small, single-file, or inherently sequential, execute them directly. No swarm overhead, no agent dispatch — just do the work.

**Use serial mode when:**
- The task touches 1-2 files
- The task is a quick fix, small refactor, or minor addition
- The task has no independent subtasks that could run simultaneously
- The total effort is less than what would justify planning + dispatch overhead

### Parallel Mode (Swarm Dispatch)

For tasks that decompose into multiple independent work streams, **parallel execution via agent swarm is mandatory.** The master agent must recognize when parallel execution is more efficient and switch to swarm mode proactively — even if the user did not explicitly request it.

**Use parallel mode when:**
- The task naturally decomposes into 3+ independent subtasks
- The task involves multiple files that can be edited simultaneously by different agents
- The total wall-clock time would be significantly reduced by parallel execution
- Multiple components, features, or fixes are being requested in a single prompt

**When the master agent determines that parallel mode is more efficient, it SHOULD proactively enter swarm mode.** The agent must use its judgment — if the task would be done in half the time with 4 agents working in parallel, doing it serially is a waste of the user's time.

### Forced Parallel Mode — `!p` Commands (NON-NEGOTIABLE)

Any command prefixed with `!p` **forces the agent into master dispatch mode.** This is absolute and non-negotiable.

When any `!p` command is invoked, the following happens unconditionally:

1. **The agent enters master dispatch mode.** It becomes the orchestrator. It does NOT write code. Its only responsibilities are: gather context, plan, dispatch, status, and report. **The master agent NEVER implements anything itself — it dispatches worker agents to do ALL implementation work. No exceptions, regardless of how long the prompt is or how simple a task seems.**
2. **Reading the command file is NON-NEGOTIABLE.** For `!p_track`, the master MUST read `{tracker_root}/_commands/Synapse/p_track.md` in full and follow it step by step. For `!p`, read `{tracker_root}/_commands/Synapse/p.md`. **Do not skip this. Do not "remember" what the command does. Read the file every time.** The command resolution system searches all subdirectories under `_commands/` automatically.
3. **Reading `{tracker_root}/agent/instructions/tracker_master_instructions.md` is NON-NEGOTIABLE.** This file maps every dashboard panel to the exact fields that drive it. The master must read it before writing any dashboard files. **Do not skip this. Do not summarize from memory. Read it.**
4. **Reading this file (`{tracker_root}/CLAUDE.md`) is NON-NEGOTIABLE.** This must be done before any planning or dispatch begins.
5. **All Synapse rules apply in full.** Every principle, every constraint, every protocol defined here is binding for the duration of the swarm.
6. **The master MUST use the dashboard.** All tasks are written to `initialization.json`, all progress is tracked via worker progress files, all events are logged to `logs.json`. The dashboard is the user's primary window into the swarm. **Skipping the dashboard is never acceptable.**

### Automatic Parallel Mode

Even without an explicit `!p` command, the master agent must escalate to parallel mode when it recognizes the opportunity. In this case:

1. **Inform the user** that you are switching to parallel execution and briefly explain why
2. **Read `{tracker_root}/CLAUDE.md`** — this is NON-NEGOTIABLE any time agents are being dispatched
3. **Follow the full swarm protocol**
4. The master agent assumes the orchestrator role — no code, only context/plan/dispatch/status/report

### Decision Flowchart

```
User gives task
       │
       ▼
Is it a !p command? ──YES──→ FORCED PARALLEL MODE
       │                      Read {tracker_root}/CLAUDE.md
       NO                     Enter master dispatch mode
       │                      Do NOT write code
       ▼
Can it decompose into 3+ independent subtasks? ──YES──→ AUTOMATIC PARALLEL MODE
       │                                                  Notify user
       NO                                                 Read {tracker_root}/CLAUDE.md
       │                                                  Enter master dispatch mode
       ▼                                                  Do NOT write code
SERIAL MODE
Execute directly
```

---

## Creating New Commands and Profiles — Duplicate Detection

When the user asks to create a new command or profile, the agent **must check for duplicates before creating anything.**

### For Commands

1. Search all command locations: `{tracker_root}/_commands/Synapse/`, `{tracker_root}/_commands/project/`, `{project_root}/_commands/`
2. If a command with the same name exists, alert the user, summarize the existing command, and ask whether to overwrite, rename, or cancel
3. If no duplicate exists, proceed with creation

### For Profiles

1. Check `{tracker_root}/_commands/profiles/` for the profile name
2. Same duplicate handling as commands

This duplicate check is **mandatory** — never silently overwrite an existing command or profile.

---

## Worker Progress Protocol

Workers report their own live progress directly to the dashboard via individual progress files. This replaces the old model where only the master could update the dashboard.

### How It Works

```
Worker starts → writes {tracker_root}/dashboards/{dashboardId}/progress/{id}.json
       │
Worker progresses → overwrites progress file with new stage/status/logs
       │
server.js detects file change → broadcasts SSE "agent_progress"
       │
Dashboard merges init + progress → renders live status, stage, logs
       │
Worker completes → writes final progress file with status "completed"
       │
Master processes return → updates logs.json + XML only (NOT initialization.json)
```

**Important:** Workers do their code work in `{project_root}` but write progress files to `{tracker_root}`. These are different locations. Workers **MUST read `{tracker_root}/agent/instructions/tracker_worker_instructions.md`** before starting work.

### Progress File Location

Each worker owns exactly one file: `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` (e.g., `dashboards/dashboard1/progress/2.1.json`).

The worker writes the **full file** on every update (no read-modify-write needed — the worker is the sole writer). The server watches the `progress/` directory via `fs.watch` and broadcasts changes immediately.

### Progress File Schema

```json
{
  "task_id": "2.1",
  "status": "in_progress",
  "started_at": "2026-02-24T15:05:00Z",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "implementing",
  "message": "Creating User model — 3/4 CRUD methods done",
  "milestones": [
    { "at": "2026-02-24T15:05:35Z", "msg": "Reading CLAUDE.md and task XML" },
    { "at": "2026-02-24T15:06:01Z", "msg": "Reading existing model files for patterns" },
    { "at": "2026-02-24T15:06:45Z", "msg": "Creating User model with CRUD operations" }
  ],
  "deviations": [
    { "at": "2026-02-24T15:07:00Z", "description": "Added soft-delete — not in plan but required by existing model pattern" }
  ],
  "logs": [
    { "at": "2026-02-24T15:05:00Z", "level": "info", "msg": "Starting task" },
    { "at": "2026-02-24T15:06:01Z", "level": "info", "msg": "Created User model" }
  ]
}
```

### Fixed Stages

Workers progress through these stages in order:

| Stage | Description |
|---|---|
| `reading_context` | Reading project files, CLAUDE.md, documentation, task XML |
| `planning` | Assessing readiness, planning approach |
| `implementing` | Writing code, creating/modifying files |
| `testing` | Running tests, validating changes |
| `finalizing` | Final cleanup, preparing summary report |
| `completed` | Task completed successfully |
| `failed` | Task failed |

### When Workers Must Write

- **On task start** — mandatory (set `status`, `started_at`, `assigned_agent`, initial `stage`)
- **On every stage transition** — mandatory
- **On significant milestones** within a stage — freeform, as often as useful
- **On any deviation from the plan** — mandatory, immediately
- **On unexpected findings** — recommended
- **On log-worthy events** — append to `logs[]` array (feeds the popup log box in agent details modal)
- **On task completion/failure** — mandatory (set `status`, `completed_at`, `summary`)

### Deviation Reporting

Deviations are plan divergences — any case where the worker does something different from what the master planned. This includes: different implementation approach, additional files modified, skipped steps, changed scope, etc.

When a worker deviates:

1. **Worker writes to progress file immediately** — adds to `deviations[]` array. The dashboard shows a yellow badge on the agent card in real-time.
2. **Worker includes deviations in final return** — the `DIVERGENT ACTIONS` section of the return format.
3. **Master logs deviations to `dashboards/{dashboardId}/logs.json`** — at level `"deviation"` (displayed with yellow badge in log panel).

Deviations are not failures — they are expected in complex tasks. But they must be visible so the master and user can assess impact.

### Dashboard Rendering

The dashboard merges `initialization.json` (static plan) with progress files (dynamic lifecycle) to render agent cards:

- **In-progress cards** show: stage badge (color-coded) + elapsed time + current milestone message
- **Any card with deviations** shows: yellow "deviation(s)" badge
- **Agent details popup** shows: full milestone timeline + full deviation list + **popup log box** (fed by `logs[]` array in progress file)
- **Log panel** has a "Deviation" filter button for deviation-level entries
- **Multi-dashboard sidebar** allows switching between different dashboard instances

### Context Savings

This architecture dramatically reduces master agent context consumption:

| Old Model | New Model |
|---|---|
| Single root-level `status.json` for all data | Per-dashboard `initialization.json` + `progress/` files |
| Master reads/writes full status file on every progress update | Master writes `initialization.json` once; workers own all lifecycle data in progress files |
| Master maintains counters (completed_tasks, failed_tasks) | Dashboard derives all stats from progress files — zero counter maintenance |
| Master outputs full terminal status table on every event | Master outputs one-line confirmations only |
| No visibility into worker progress during execution | Live stage + milestone + log updates on dashboard |
| Deviations only visible after completion | Deviations visible immediately |
| Single swarm at a time | Up to 5 concurrent swarms across dashboards with auto-selection |
| Cascading failures require manual intervention | Circuit breaker triggers automatic replanning via CLI |

---

## Directory Structure

```
Synapse/                            ← {tracker_root}
├── CLAUDE.md                       ← You are here
├── package.json                    ← Metadata + start script
├── .synapse/                       ← Synapse config
│   └── project.json                ← Current target project (set via !project)
├── _commands/                      ← All commands organized by folder
│   ├── Synapse/                    ← Synapse swarm commands
│   │   ├── p_track.md              ← Core: plan + dispatch + track a full swarm
│   │   ├── p.md                    ← Lightweight parallel dispatch (no tracking)
│   │   ├── master_plan_track.md    ← Multi-stream orchestration
│   │   ├── project.md              ← Set/show/clear target project
│   │   ├── start.md                ← Start the dashboard server
│   │   ├── stop.md                 ← Stop the dashboard server
│   │   ├── status.md               ← Terminal status summary
│   │   ├── reset.md                ← Clear dashboard data
│   │   ├── dispatch.md             ← Manually dispatch tasks
│   │   ├── retry.md                ← Re-run failed tasks
│   │   ├── resume.md               ← Resume a stalled/interrupted swarm
│   │   ├── cancel.md               ← Cancel the active swarm
│   │   ├── cancel-safe.md          ← Graceful shutdown
│   │   ├── logs.md                 ← View/filter log entries
│   │   ├── inspect.md              ← Deep-dive into a specific task
│   │   ├── history.md              ← View past swarm history
│   │   ├── deps.md                 ← Visualize dependency graph
│   │   ├── guide.md                ← Command decision tree
│   │   └── update_dashboard.md     ← Update dashboard config
│   ├── project/                    ← Project analysis & management commands
│   │   ├── initialize.md           ← Initialize Synapse for a project
│   │   ├── onboard.md              ← Project walkthrough
│   │   ├── context.md              ← Deep context gathering
│   │   ├── review.md               ← Code review
│   │   ├── health.md               ← Project health check
│   │   ├── scaffold.md             ← Generate CLAUDE.md for a project
│   │   ├── plan.md                 ← Implementation planning
│   │   ├── scope.md                ← Blast radius analysis
│   │   ├── trace.md                ← End-to-end code tracing
│   │   ├── contracts.md            ← API contract audit
│   │   ├── env_check.md            ← Environment variable audit
│   │   ├── toc.md                  ← Search project TOC
│   │   ├── toc_generate.md         ← Generate project TOC
│   │   ├── toc_update.md           ← Update project TOC
│   │   ├── commands.md             ← List all available commands
│   │   ├── help.md                 ← Master agent guide
│   │   └── profiles.md             ← List available profiles
│   └── profiles/                   ← Agent role profiles
│       ├── analyst.md
│       ├── architect.md
│       ├── copywriter.md
│       ├── customer-success.md
│       ├── devops.md
│       ├── founder.md
│       ├── growth.md
│       ├── legal.md
│       ├── marketing.md
│       ├── pricing.md
│       ├── product.md
│       ├── qa.md
│       ├── sales.md
│       ├── security.md
│       └── technical-writer.md
├── agent/                          ← Agent instruction files
│   └── instructions/
│       ├── dashboard_resolution.md
│       ├── tracker_master_instructions.md
│       ├── tracker_multi_plan_instructions.md
│       ├── tracker_worker_instructions.md
│       ├── failed_task.md
│       └── common_pitfalls.md
├── dashboards/                     ← Multi-dashboard support (up to 5)
│   ├── dashboard1/
│   │   ├── initialization.json
│   │   ├── logs.json
│   │   ├── master_state.json          ← Master state checkpoint (context recovery)
│   │   └── progress/
│   └── dashboard2/ ... dashboard5/
├── queue/                          ← Overflow queue slots
├── history/                        ← History summary JSON files
├── Archive/                        ← Full archived dashboard snapshots
├── tasks/                          ← Generated per swarm
│   └── {MM_DD_YY}/
│       ├── parallel_{name}.xml
│       └── parallel_plan_{name}.md
├── src/
│   ├── server/index.js             ← Node.js SSE server (zero deps)
│   └── ui/                         ← React dashboard frontend
├── electron/                       ← Desktop app (Electron)
└── public/
    └── styles.css
```

**Target project structure** (created by Synapse at `{project_root}`):

```
{project_root}/
├── .synapse/                       ← Synapse project metadata (add to .gitignore)
│   ├── toc.md                      ← Project Table of Contents (opt-in)
│   └── config.json                 ← Project-Synapse configuration
├── CLAUDE.md                       ← Project conventions (may already exist)
├── _commands/                      ← Project-specific commands (optional)
└── ... (project files)
```

---

## Commands

When the user types a command prefixed with `!`, resolve it using the command resolution hierarchy and follow it exactly.

### Project Management

| Command | Description |
|---|---|
| `!project` | Show, set, or clear the target project path. |
| `!initialize` | Initialize Synapse for a target project — create `.synapse/`, detect tech stack, optionally scaffold `CLAUDE.md`. |
| `!onboard` | Project walkthrough — read CLAUDE.md, TOC, key files and present a structured orientation. |
| `!scaffold` | Generate a `CLAUDE.md` for a project that doesn't have one. |

### Swarm Lifecycle

| Command | Description |
|---|---|
| `!p_track {prompt}` | **Primary command.** Plan, dispatch, track, and report a full parallel agent swarm with live dashboard updates. |
| `!p {prompt}` | Lightweight parallel dispatch (no dashboard tracking). |
| `!master_plan_track {prompt}` | Multi-stream orchestration — decompose into independent swarms across dashboards. |
| `!dispatch {id}` | Manually dispatch a specific pending task. `!dispatch --ready` dispatches all unblocked tasks. |
| `!retry {id}` | Re-dispatch a failed task with a fresh agent. |
| `!resume` | Resume a stalled/interrupted swarm — re-dispatch all incomplete tasks with full context. |
| `!cancel` | Cancel the active swarm. `!cancel --force` skips confirmation. |
| `!cancel-safe` | Graceful shutdown — let running tasks finish, cancel pending. |

### Monitoring

| Command | Description |
|---|---|
| `!status` | Quick terminal summary of current swarm state. |
| `!logs` | View log entries. Supports `--level`, `--task`, `--agent`, `--last`, `--since` filters. |
| `!inspect {id}` | Deep-dive into a specific task — context, dependencies, timeline, logs. |
| `!deps` | Visualize the full dependency graph. `!deps {id}` for a single task. `!deps --critical` for critical path. |
| `!history` | View past swarm history. `!history --last 5` for recent only. |

### Project Analysis

| Command | Description |
|---|---|
| `!context {query}` | Deep context gathering within `{project_root}`. |
| `!review` | Code review of recent changes or specified files. |
| `!health` | Project health check — CLAUDE.md quality, dependency health, TOC consistency. |
| `!scope {change}` | Blast radius analysis — what would be affected by a proposed change. |
| `!trace {endpoint}` | End-to-end code tracing of an endpoint, function, or data flow. |
| `!contracts` | API contract audit — consistency between interfaces and implementations. |
| `!env_check` | Environment variable audit — consistency across configs. |
| `!plan {task}` | Implementation planning based on project context. |

### Table of Contents

| Command | Description |
|---|---|
| `!toc {query}` | Search the project TOC at `{project_root}/.synapse/toc.md`. |
| `!toc_generate` | Generate a full project TOC via parallel agent swarm. |
| `!toc_update` | Incrementally update the TOC for changed files. |

### Profiles & Discovery

| Command | Description |
|---|---|
| `!profiles` | List all available agent role profiles. |
| `!commands` | List all available commands from all locations. |
| `!help` | Master agent guide — when to use each command. |
| `!guide` | Interactive command decision tree. |

### Server Control

| Command | Description |
|---|---|
| `!start` | Start the dashboard server and open the browser. |
| `!stop` | Stop the dashboard server. |
| `!reset` | Clear all tracker data. `!reset --keep-history` preserves past tasks. |

---

## Core Principles for Efficient Parallelization

These principles govern how the master agent should plan and execute parallel work. They apply universally regardless of the project being worked on.

### 1. Always Parallelize Independent Work

If two or more tasks have no dependency between them, they **must** run in parallel. This applies to everything — file reads, file writes, searches, edits, agent dispatches. Sequential execution of independent tasks is a failure mode.

### 2. Dependency-Driven Dispatch, Not Wave-Driven

Waves are a visual grouping for humans. The dispatch engine looks **only** at individual task dependencies. If task 2.3 depends only on 1.1 and 1.1 is done, dispatch 2.3 immediately — even if tasks 1.2 through 1.8 are still running. Never wait for a full wave to complete.

### 3. Pipeline Must Flow Continuously

When an agent completes:
1. Record the completion
2. Immediately scan ALL pending tasks for newly satisfied dependencies
3. Dispatch every unblocked task in the same update cycle
4. Never let the pipeline stall waiting for a batch

### 4. No Artificial Concurrency Cap

Send as many agents as there are ready tasks. The bottleneck should be dependencies, not artificial limits.

**Practical note:** The Task tool dispatches agents via tool calls. If a wave has more tasks than can be dispatched in a single message (~8-10 simultaneous tool calls), batch them into back-to-back dispatch rounds — but never wait for the first batch to complete before sending the second. Dispatch all ready tasks as fast as the tool allows.

### 5. Errors Don't Stop the Swarm (But Cascading Failures Trigger Automatic Replanning)

A failed task blocks only its direct dependents. Everything else continues. Log the error, mark the task, keep dispatching.

**Circuit breaker:** The orchestrator automatically enters replanning mode when any of these conditions are met:
- **3+ tasks fail within the same wave** — suggests a shared root cause, not isolated failures
- **A single failure blocks 3+ downstream tasks** — the failure is cascading through the dependency graph
- **A single failure blocks more than half of all remaining tasks** — critical-path failure

Whichever threshold is hit first triggers the circuit breaker.

**Automatic replanning:** When the circuit breaker fires, the master performs replanning inline: (a) pauses all new dispatches, (b) reads all progress files to build a full picture of completed, failed, and blocked tasks, (c) analyzes root cause from failure patterns, (d) produces a revision plan with four categories — `modified` (updated pending tasks), `added` (new repair tasks with `r`-suffixed IDs), `removed` (no longer viable tasks), and `retry` (re-dispatch as-is) — (e) applies the revision to `initialization.json` (the documented exception to write-once), and (f) resumes dispatch.

**Fallback:** If replanning analysis fails to produce a valid revision (e.g., the master cannot determine root cause or all remaining tasks are blocked), the swarm pauses for manual intervention rather than pushing through blind. The user can then manually retry tasks or cancel the swarm.

Never blindly push through cascading failures.

### 6. Plan Deep, Execute Fast

Invest time upfront in thorough planning:
- Read all relevant code and documentation before decomposing
- Identify every dependency between tasks
- Give each agent a self-contained prompt with full context
- Verify the dependency graph has no cycles or missing references

This front-loaded investment pays off in execution speed — agents work independently without needing to ask questions or make assumptions.

### 7. Atomic Task Design

Each task should be:
- **Self-contained** — An agent can complete it with only the context provided
- **Small** — Takes a single agent one focused effort (not hours of work)
- **Verifiable** — The master can confirm success from the summary
- **Non-overlapping** — No two tasks modify the same file (or if they must, they're sequential)

### 8. Statusing Is Non-Negotiable

Status reporting is split between master and workers:

**Workers handle ALL status — lifecycle, live progress, and detailed logs:**
- Write `dashboards/{dashboardId}/progress/{id}.json` with full lifecycle: `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`
- Write live progress: `stage`, `message`, `milestones[]`, `deviations[]`
- Write detailed logs: `logs[]` array (feeds the popup log box in agent details modal)
- Dashboard picks up changes in real-time via `fs.watch` + SSE

**Master handles event logging and XML updates only:**
- Agent dispatched → append to `logs.json`
- Agent completed → append to `logs.json` + update XML
- Agent failed → append to `logs.json` + update XML
- Agent deviated → append to `logs.json` at level `"deviation"`
- Master does NOT update `initialization.json` after planning

**Master does NOT output terminal status tables** during execution. Terminal output is limited to one-line confirmations. The dashboard is the user's primary window into swarm progress.

### 9. Right-Size Tasks

Each task should take a single agent **1-5 minutes** to complete. This range balances parallelism against orchestration overhead.

| Too small (< 1 min) | Right-sized (1-5 min) | Too large (> 5 min) |
|---|---|---|
| Orchestration overhead dominates | Good parallelism/overhead ratio | Risk of context exhaustion |
| Many dispatch cycles for little work | Workers stay focused | Worker may lose track of scope |
| Log noise drowns signal | Each completion is meaningful | Long waits between status updates |

When estimating: a task that reads 2-3 files and modifies 1-2 files is typically right-sized. A task that reads 10+ files or modifies 5+ files should be decomposed further.

### 10. Shared File Accumulation Patterns

When multiple tasks need to add entries to the same file (routes to a router, exports to an index, entries to a config), **two tasks must never modify the same file simultaneously.** Use one of these patterns:

**Pattern A — Owner Task:** One task "owns" the shared file. Other tasks that need it depend on the owner. The owner creates/modifies the file; downstream tasks append to it sequentially.

**Pattern B — Integration Task:** All tasks that produce content for the shared file are independent, but a dedicated "integration task" in a later wave collects their outputs and writes the shared file. This maximizes parallelism.

**Pattern C — Append Protocol:** If a shared file supports independent additions (e.g., adding new route files to a directory that auto-imports), design tasks to create new files rather than modifying an existing one.

Always prefer Pattern C (no shared file at all) > Pattern B (maximize parallelism) > Pattern A (simplest but least parallel).

### 11. Feed Upstream Results to Downstream Tasks

When a task completes and its dependents become dispatchable, the master **must include the upstream task's results** in the downstream worker's prompt:

- What the upstream task accomplished (summary)
- What files it created or modified
- Any new interfaces, types, exports, or APIs it introduced
- Any deviations from the plan that affect downstream work

This is critical because the downstream worker's prompt was written during planning — before the upstream work was done. Without upstream results, the downstream worker operates on stale assumptions.

### 12. Verify After Completion

After all tasks complete (or all remaining are blocked), the master should assess whether a **verification step** is warranted:

- If the swarm modified code across multiple files → dispatch a verification agent to run tests, type checking, or build validation
- If the swarm was purely additive (new files, no modifications to existing code) → verification may be optional
- If any tasks reported deviations → verification is strongly recommended

The verification agent gets a prompt listing ALL files changed across the swarm and runs the project's standard validation commands. Its job is to catch integration issues that individual workers can't see.

---

## Data Architecture

### initialization.json

The static plan store, written once during planning. Located at `{tracker_root}/dashboards/{dashboardId}/initialization.json`. Every field maps to UI elements on the dashboard, combined with progress file data. See `agent/instructions/tracker_master_instructions.md` for the complete field-to-UI mapping. The only exception to write-once is **automatic replanning** — when the circuit breaker triggers, the orchestrator updates `initialization.json` with modified, added, or removed tasks from the replanner output.

**Key objects:**
- `task` — The swarm metadata (name, type, directory, prompt, project, project_root, created, total_tasks, total_waves)
- `agents[]` — One entry per task (id, title, wave, layer, directory, depends_on — plan data only, no lifecycle fields)
- `waves[]` — One entry per wave (id, name, total — structure only, no status or completed counts)
- `chains[]` — Optional, for chain layout mode
- `history[]` — Previous swarm records

**Write rules:**
- Write-once during planning — **never update after the planning phase** unless the circuit breaker triggers automatic replanning (see Principle 5)
- Always atomic: read → modify in memory → write full file
- Never write partial JSON
- No lifecycle fields: `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`, `completed_tasks`, `failed_tasks`, `overall_status` are all absent — they are derived from progress files by the dashboard
- `task.project_root` stores the resolved `{project_root}` so the dashboard and commands know which project this swarm serves

### logs.json

The timestamped event log, located at `{tracker_root}/dashboards/{dashboardId}/logs.json`. Every entry becomes a row in the dashboard log panel.

**Entry fields:** `timestamp`, `task_id`, `agent`, `level`, `message`, `task_name`

**Levels:** `info` (general), `warn` (unexpected), `error` (failure), `debug` (verbose), `permission` (triggers popup), `deviation` (plan divergence)

### Master XML

The authoritative task record at `{tracker_root}/tasks/{date}/parallel_{name}.xml`. Contains everything: task descriptions, context, critical details, file lists, dependencies, status, summaries, and logs. Every agent reads it for context. The master updates it on every completion.

### progress/ Directory

Worker-owned progress files. Each worker writes to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` exclusively.

**Key fields:** `task_id`, `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`, `stage`, `message`, `milestones[]`, `deviations[]`, `logs[]`

The progress file now contains the **full lifecycle** for each agent. The `logs[]` array feeds the popup log box in the agent details modal. The `status`, `started_at`, `completed_at`, `summary`, and `assigned_agent` fields live exclusively in progress files — the dashboard derives all stats from these files.

**Stages:** `reading_context` → `planning` → `implementing` → `testing` → `finalizing` → `completed` | `failed`

**Write rules:**
- Workers write the full file on every update (no read-modify-write — sole owner)
- The server watches the directory via `fs.watch` and broadcasts `agent_progress` SSE events
- The master clears this directory when initializing a new swarm
- Progress files are ephemeral — they exist only during the active swarm

### master_state.json

The master's state checkpoint, written after every dispatch event. Contains: completed task IDs and summaries, in-progress task IDs, failed tasks with repair IDs, ready-to-dispatch tasks, upstream result summaries, and the next agent number. Used for recovery after context compaction. Not watched by the server — purely for master self-recovery. Located at `{tracker_root}/dashboards/{dashboardId}/master_state.json`.

---

## Dashboard Features

### Layout Modes

**Waves** — Vertical columns per dependency level. Cards within a column are independent peers. Best for broad, parallel workloads.

**Chains** — Horizontal rows per dependency chain. Cards flow left to right through dependency levels. Best for narrow, deep pipelines.

Choose based on the shape of your dependency graph. Set via `task.type` in `initialization.json` (`"Waves"` or `"Chains"`).

### Dependency Lines

In Wave mode, dependency lines are drawn between cards using BFS pathfinding through corridor gaps. Lines never cross through cards or title headers.

**Interaction:**
- **Hover a line** → highlights blue with glow
- **Hover a card** → its needs highlight blue, tasks it blocks highlight red, unrelated lines dim

### Multi-Dashboard Sidebar

The dashboard supports up to 5 simultaneous swarms via a sidebar that lists all dashboard instances (`dashboard1` through `dashboard5`). Each dashboard directory is an independent swarm with its own `initialization.json`, `logs.json`, and `progress/` directory. Different dashboards can serve different projects — the `task.project_root` field identifies which project each swarm belongs to.

**Dashboard selection follows a priority chain.** When an agent is spawned from the Synapse chat view, its system prompt contains a `DASHBOARD ID:` directive binding it to that chat's dashboard — this is always authoritative and the agent uses it unconditionally. If no pre-assigned dashboard exists, `--dashboard dashboardN` can force a specific slot. As a final fallback, the master scans dashboards 1-5 for the first available slot. The agent will never overwrite an in-progress swarm. All commands (`!status`, `!logs`, `!inspect`, etc.) auto-detect the active dashboard when no dashboard is specified. See `agent/instructions/dashboard_resolution.md` for the full selection and detection protocol.

**Every agent always knows its dashboard.** Chat-spawned agents receive their dashboard ID via the system prompt. The master includes `{dashboardId}` in every worker dispatch prompt. Workers write progress files to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` — they never auto-detect.

### Stat Cards

Six stat cards show Total, Completed, In Progress, Failed, Pending, and Elapsed time. All stats are derived from progress files — the dashboard counts progress files by status. The elapsed timer starts from the earliest worker `started_at` and freezes when all workers have `completed_at` set.

### Log Panel

Collapsible bottom drawer showing all log entries with level filtering (All, Info, Warn, Error, Deviation). Auto-scrolls to newest entries.

### Popup Log Box

Agent detail modals include a popup log box showing the worker's `logs[]` array from its progress file. This provides detailed, per-agent logging independent of the main event log panel.

### Permission Popup

When the master writes a `"permission"` level log entry, the dashboard shows an amber popup alerting the user to check their terminal. This bridges the gap between the dashboard (visual) and terminal (interactive).

---

## Timestamp Protocol

Every timestamp in `initialization.json`, `logs.json`, progress files, and the XML must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

**Never** guess, estimate, or hardcode timestamps. The elapsed timer calculates durations from these values — a bad timestamp shows wildly wrong elapsed times.

---

## Integration with Any Project

Synapse is project-agnostic and fully standalone. To use it with any project:

1. **Synapse can live anywhere.** It does not need to be inside the target project. Keep it in a tools directory, home folder, or wherever is convenient.

2. **Point Synapse at your project** using one of:
   - Run `!project set /path/to/project` to store the target
   - Run from within the project directory (auto-detected as CWD)
   - Pass `--project /path` to any command

3. **Project-specific context** comes from the project's own `CLAUDE.md`, documentation, and code. Synapse reads `{project_root}/CLAUDE.md` for conventions and uses Glob/Grep for file discovery.

4. **Project-specific commands** can be defined at `{project_root}/_commands/`. These are checked after Synapse's own commands in the resolution hierarchy.

5. **The `.synapse/` directory** is created inside the target project for TOC and configuration. Add it to `.gitignore`.

6. **All Synapse data** (dashboards, tasks, history, logs) stays at `{tracker_root}`. Nothing except `.synapse/` is written to the target project.

---

## Multi-Project Support

Each of the 5 dashboard slots can serve a different project simultaneously. The `task.project_root` field in `initialization.json` identifies which project each swarm belongs to.

When working across multiple projects:
- Use `!project set` to switch the active project, or pass `--project` to individual commands
- Each swarm's dashboard shows which project it's targeting
- Commands like `!status` and `!logs` auto-detect the active dashboard regardless of which project it serves
- Workers always receive explicit `{project_root}` in their prompts — they never need to auto-detect

---

## Portability Checklist

- [x] Zero npm dependencies for the server — works with any Node.js installation
- [x] Fully standalone — does not need to be inside the target project
- [x] No hardcoded paths — all paths use `{tracker_root}` and `{project_root}` placeholders
- [x] No project-specific assumptions — works with monorepos, single projects, or any layout
- [x] Self-contained commands — each `_commands/*.md` file is a complete spec
- [x] Dashboard reads `initialization.json` + `progress/` files, merging them client-side
- [x] Server configurable via `PORT` env var
- [x] Works offline — no external API calls, no CDN dependencies
