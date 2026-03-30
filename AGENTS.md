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

# 3. Open in browser
npm start  # launches the Electron app

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

- Read the Synapse `AGENTS.md` (this file) for swarm protocols
- Read `{project_root}/AGENTS.md` for target project conventions, architecture, and constraints
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
- Include in every agent prompt: the specific files to modify, the conventions from `{project_root}/AGENTS.md`, code snippets the agent needs to see, clear success criteria, **and both `{tracker_root}` and `{project_root}` paths**
- Create the master task file documenting the full plan
- Write the strategy rationale plan file
- **Populate the dashboard before presenting the plan to the user** — clear the progress directory, write the full plan to `initialization.json` (all tasks, all waves, all dependencies — static plan data only), and write an initialization entry to `logs.json`. This gives the user a live visual representation of the plan on the dashboard while they review and approve it. **`initialization.json` is write-once — the master never updates it after planning.**

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
- Update the master task file with completion summaries, error details, and timing
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
| `tasks/{date}/parallel_{name}.json` | Master task record (plan, status, summaries) |
| `tasks/{date}/parallel_plan_{name}.md` | Strategy rationale document |

Everything else is a worker's job. The master agent writes **nothing** into `{project_root}`.

### After a Swarm Completes

Once all workers have finished and the master has compiled its final report, the swarm is over. At this point — and **only** at this point — the master agent may resume normal agent behavior (including direct code edits) if the user requests non-parallel work. The no-code restriction applies **exclusively during active swarm orchestration.**

---

## Project Discovery and Context Gathering

### Context Efficiency Principles

The master agent's most critical skill is **context efficiency** — gathering exactly the right information with minimal reads, and preserving context window space for reasoning and execution.

1. **Glob/Grep first for targeted searches.** They cost zero context tokens and are always current. Use them before reaching for the TOC.

2. **Project AGENTS.md for orientation.** `{project_root}/AGENTS.md` provides the architectural overview, conventions, and patterns for the target project. Read it before any work in the project.

3. **Project TOC for semantic discovery.** When filenames don't reveal purpose, or you need to understand how components relate, check `{project_root}/.synapse/toc.md` if one exists. If none exists and the project is large (500+ files), consider running `!toc_generate`.

4. **Read with purpose.** Before reading any file, know what you expect to find. If you're reading "just in case," you're wasting context.

5. **Parallel reads.** When you need to read multiple files, read them all in a single parallel call. Never read files sequentially when they have no dependency between them.

6. **Targeted line ranges.** For large files where you only need a specific section, use line offsets rather than reading the entire file.

7. **Cache awareness.** After context compaction, you lose file contents from earlier reads. Re-read critical files rather than working from stale memory.

8. **Summarize, don't hoard.** After reading a file for context, extract the relevant facts and move on. You don't need to keep the entire file contents in working memory.

### Project `.synapse/` Directory

Synapse stores project-scoped metadata in `{project_root}/.synapse/`:

| File / Directory | Purpose |
|---|---|
| `toc.md` | Project Table of Contents — semantic index of files and directories (generated by `!toc_generate`) |
| `fingerprints.json` | File content fingerprints for TOC change detection |
| `dep_graph.json` | File-level dependency graph from import analysis |
| `config.json` | Project-Synapse configuration (project name, paths, tech stack, initialization timestamp) |
| `knowledge/manifest.json` | PKI routing index — domain/tag/concept indexes, per-file entries with hashes and staleness flags |
| `knowledge/annotations/{hash}.json` | Per-file deep knowledge: gotchas, patterns, conventions, exports, relationships |
| `knowledge/domains.json` | Domain taxonomy for the project |
| `knowledge/patterns.json` | Pattern catalog discovered across the project |

Projects should add `.synapse/` to their `.gitignore`. This directory is optional — Synapse works without it but provides better context efficiency when it exists.

### Project Knowledge Index (PKI)

The PKI is a persistent knowledge layer at `{project_root}/.synapse/knowledge/` that accumulates deep operational understanding of the target project — gotchas, patterns, conventions, domain taxonomy, and file relationships.

**Population mechanisms:**

1. **`!learn`** — Cold-start bootstrap. Dispatches a parallel swarm to deeply annotate every significant file.
2. **Worker annotations** — Workers optionally populate an `annotations` field in progress files during swarm execution. The master merges these into the PKI post-swarm.
3. **PostToolUse staleness hook** — Automatic change detection marks annotations as stale when files are modified.
4. **`!learn_update`** — Incremental refresh. Detects stale/new files, re-scans only what changed.

**Master consumption during planning:**

1. Check if PKI exists (`manifest.json`)
2. Extract domains, tags, concepts from user prompt
3. Look up files via `domain_index`, `tag_index`, `concept_map`
4. Read annotations for matched files (cap: 8-10 files)
5. Build PKI knowledge block (max ~100 lines)
6. Inject into worker prompts under the `[PKI]` label in the CONVENTIONS section

**Fallback behavior:** When no PKI exists, standard CLAUDE.md-based planning works without any PKI. The system degrades gracefully at every level — empty, partial, fully stale, or missing PKI all produce functional plans.

---

## Command Resolution — `!{command}` System

When the user types `!{command}`, locate and execute the corresponding command file. Commands are resolved in this priority order:

### Resolution Order

```
1. {tracker_root}/_commands/Synapse/{command}.md      ← Synapse swarm commands (highest priority)
2. {tracker_root}/_commands/project/{command}.md      ← Synapse project commands
3. {tracker_root}/_commands/user/{command}.md         ← User-local commands (git-ignored)
4. {project_root}/_commands/{command}.md              ← Project-specific commands
```

### Resolution Rules

1. **Check Synapse swarm commands first.** Swarm and dashboard commands (`!p_track`, `!status`, `!dispatch`, etc.) live at `{tracker_root}/_commands/Synapse/`. Always checked first.

2. **Check Synapse project commands second.** Project analysis and management commands (`!context`, `!review`, `!health`, `!toc`, etc.) live at `{tracker_root}/_commands/project/`.

3. **Check user commands third.** User-local commands at `{tracker_root}/_commands/user/`. This directory is git-ignored for custom workflows.

4. **Check the target project last.** Projects may define their own commands at `{project_root}/_commands/`. These allow project-specific workflows and overrides.

5. **If not found anywhere**, inform the user that `!{command}` does not exist and list available commands from all discovered locations.

5. **Once found, read the command file in full and follow it exactly.** Command files are complete specs — do not improvise, skip steps, or partially execute.

---

## Profile System — `!profile` Modifier

Profiles override the agent's default priorities, goals, tone, and output style to match a specific role. They are defined as markdown files in `{tracker_root}/_commands/profiles/` and are applied as a **modifier on top of any command**, not as a standalone command.

### How Profiles Work

A profile does not replace the agent's core instructions (this AGENTS.md). It layers on top of them — adjusting **what the agent prioritizes**, **how it frames its output**, and **what success looks like** for the duration of the task. The agent's technical capabilities, tool access, and orchestration protocols remain unchanged. The profile shapes the agent's persona, priorities, and deliverables.

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

## Agent Definitions

Agent definitions live in `.claude/agents/*.md`. These are Claude Code agent configurations that define roles, skills, and hooks.

### master-orchestrator

- **Purpose:** Synapse swarm master agent. Plans task decomposition, dispatches worker agents, monitors progress, compiles reports.
- **Core constraint:** NEVER writes project source code.
- **Skills loaded:** `p-track`, `worker-protocol`, `master-protocol`, `failure-protocol`
- **Hooks:**
  - `PreToolUse` on `Edit|Write`: runs `.claude/hooks/validate-master-write.sh` — prevents the master from writing to project files.

### swarm-worker

- **Purpose:** Synapse swarm worker agent. Implements a single task and reports progress through dashboard files.
- **Skills loaded:** `worker-protocol`
- **Hooks:**
  - `PostToolUse` on `Write`: runs `.claude/hooks/validate-progress-file.sh` — validates progress file writes.

---

## Skills System

Skills are defined in `.claude/skills/*/SKILL.md` and provide specialized capabilities loaded on demand. There are 10 skills total — 7 user-invocable and 3 auto-loaded internal protocols.

### User-Invocable Skills

| Skill | Trigger | Context | Description |
|---|---|---|---|
| **p-track** | `!p_track` | fork, model: opus | Full Synapse swarm with live dashboard tracking |
| **p** | `!p` | fork, model: opus | Lightweight parallel dispatch |
| **master-plan-track** | `!master_plan_track` | fork, model: opus | Multi-stream orchestration across dashboards |
| **p-track-resume** | `!p_track_resume` | fork, model: opus | Resume stalled/interrupted swarm |
| **eager-dispatch** | `!eager_dispatch` | fork, model: opus | Standalone eager dispatch round |
| **dashboard-ops** | `!status`, `!logs`, `!inspect`, `!deps`, `!history`, `!cancel`, `!reset`, `!start`, `!stop`, `!guide`, `!update_dashboard` | default | Routes to dashboard operation commands |
| **project-workflow** | `!initialize`, `!onboard`, `!scaffold`, `!create_claude`, `!context`, `!review`, `!health`, `!scope`, `!trace`, `!contracts`, `!env_check`, `!plan`, `!prompt_audit`, `!learn`, `!learn_update`, `!instrument`, `!toc`, `!toc_generate`, `!toc_update`, `!commands`, `!profiles`, `!help` | default | Routes to project setup, discovery, and analysis commands |

### Auto-Loaded Protocol Skills

| Skill | Loaded By | Description |
|---|---|---|
| **master-protocol** | Master agents | Master orchestrator protocol — role constraints, dashboard writes, dispatch rules, common pitfalls |
| **worker-protocol** | Worker agents | Worker progress reporting, deviation tracking, stage progression, structured returns |
| **failure-protocol** | Master agents | Failure recovery — repair tasks, dependency rewiring, circuit breaker, double failure escalation |

Skills that spawn swarm orchestrators (`p-track`, `p`, `master-plan-track`, `p-track-resume`, `eager-dispatch`) use `context: fork` and `model: opus` — they need their own agent thread and the strongest model. Protocol skills are loaded automatically when an agent operates in master or worker mode.

---

## Available Profiles

Profiles are defined in `_commands/profiles/*.md`. There are 15 profiles covering engineering, business, and operations roles:

| Profile | Focus Area |
|---|---|
| **analyst** | Data Analyst — SaaS metrics, KPI frameworks, cohort analysis, dashboard design |
| **architect** | Systems Architect — distributed systems, API architecture, database modeling, scalability |
| **copywriter** | Conversion Copywriter — SaaS landing pages, email sequences, CTAs, microcopy |
| **customer-success** | Customer Success Lead — onboarding, retention, health scoring, churn prevention |
| **devops** | Platform Engineer (DevOps) — CI/CD, IaC, containers, monitoring, deployment automation |
| **founder** | Startup Strategist — go-to-market, competitive analysis, fundraising, positioning |
| **growth** | Growth Engineer — acquisition, conversion optimization, SEO, viral loops, experiments |
| **legal** | Legal & Compliance Advisor — GDPR, CCPA, HIPAA, ToS, DPAs, compliance roadmaps |
| **marketing** | Marketing Strategist — positioning, copywriting, audience psychology, go-to-market |
| **pricing** | Pricing Strategist — SaaS pricing models, packaging, tier design, value metrics |
| **product** | Product Manager — strategy, user research, feature prioritization, requirements |
| **qa** | QA Engineer — test strategy, edge cases, regression prevention, quality frameworks |
| **sales** | Sales Strategist — B2B SaaS sales, outreach, objection handling, deal enablement |
| **security** | Security Engineer — app security, threat modeling, SOC2/GDPR/HIPAA, secure dev |
| **technical-writer** | Technical Writer — API docs, developer guides, tutorials, changelogs, knowledge base |

---

## Multi-Provider Support

Synapse supports multiple AI providers for worker agents. Workers can be spawned using either Claude Code CLI or Codex CLI.

| Aspect | Claude | Codex |
|---|---|---|
| CLI command | `claude` | `codex` |
| Output format | `--output-format stream-json` | `--json` |
| Skip permissions | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` |
| Project directory | `--add-dir {dir}` | `-C {dir}` |
| Session resume | `--resume {id}` | `exec resume {id}` |
| System prompt | `--append-system-prompt` | Prepended to prompt text |

**Provider selection:** The `agentProvider` setting determines which CLI is used for spawning workers. Both providers maintain independent worker tracking. The IPC layer unifies them — `kill-worker` tries both services, `get-active-workers` concatenates both lists.

**Worker tracking:** Both `ClaudeCodeService` and `CodexService` maintain independent `activeWorkers` maps keyed by PID. Each worker gets a `SYNAPSE_DASHBOARD_ID` environment variable for dashboard isolation.

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

1. **The agent enters master dispatch mode.** It becomes the orchestrator. It does NOT write code. Its only responsibilities are: gather context, plan, dispatch, status, and report.
2. **Reading this file (`{tracker_root}/AGENTS.md`) is NON-NEGOTIABLE.** This must be done before any planning or dispatch begins.
3. **All Synapse rules apply in full.** Every principle, every constraint, every protocol defined here is binding for the duration of the swarm.

### Automatic Parallel Mode

Even without an explicit `!p` command, the master agent must escalate to parallel mode when it recognizes the opportunity. In this case:

1. **Inform the user** that you are switching to parallel execution and briefly explain why
2. **Read `{tracker_root}/AGENTS.md`** — this is NON-NEGOTIABLE any time agents are being dispatched
3. **Follow the full swarm protocol**
4. The master agent assumes the orchestrator role — no code, only context/plan/dispatch/status/report

### Decision Flowchart

```
User gives task
       │
       ▼
Is it a !p command? ──YES──→ FORCED PARALLEL MODE
       │                      Read {tracker_root}/AGENTS.md
       NO                     Enter master dispatch mode
       │                      Do NOT write code
       ▼
Can it decompose into 3+ independent subtasks? ──YES──→ AUTOMATIC PARALLEL MODE
       │                                                  Notify user
       NO                                                 Read {tracker_root}/AGENTS.md
       │                                                  Enter master dispatch mode
       ▼                                                  Do NOT write code
SERIAL MODE
Execute directly
```

---

## Creating New Commands and Profiles — Duplicate Detection

When the user asks to create a new command or profile, the agent **must check for duplicates before creating anything.**

### For Commands

1. Search all command locations: `{tracker_root}/_commands/`, `{tracker_root}/_commands/project/`, `{project_root}/_commands/`
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
Master processes return → updates logs.json + task file only (NOT initialization.json)
```

**Important:** Workers do their code work in `{project_root}` but write progress files to `{tracker_root}`. These are different locations. Workers **MUST read `{tracker_root}/agent/instructions/tracker_worker_instructions.md`** before starting work.

### Progress File Location

Each worker owns exactly one file: `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` (e.g., `dashboards/a3f7k2/progress/2.1.json`).

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
    { "at": "2026-02-24T15:05:35Z", "msg": "Reading AGENTS.md and task file" },
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
| `reading_context` | Reading project files, AGENTS.md, documentation, task file |
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
| Single swarm at a time | Multiple concurrent swarms across dashboards (each chat bound to its own dashboard) |

---

## Directory Structure

```
Synapse/                            ← {tracker_root}
├── AGENTS.md                       ← You are here
├── CLAUDE.md                       ← Codebase instructions (for when Synapse is the target project)
├── Synapse.md                      ← Product overview and feature documentation
├── package.json                    ← Metadata + start script
├── .synapse/                       ← Synapse config
│   └── project.json                ← Current target project (set via !project)
├── .claude/                        ← Claude Code agent configuration
│   ├── agents/                     ← Agent definitions
│   │   ├── master-orchestrator.md  ← Master agent: plans, dispatches, monitors (never writes code)
│   │   └── swarm-worker.md         ← Worker agent: implements tasks, reports progress
│   ├── skills/                     ← Skill definitions (10 total)
│   │   ├── p-track/                ← Full swarm with dashboard tracking
│   │   ├── p/                      ← Lightweight parallel dispatch
│   │   ├── master-plan-track/      ← Multi-stream orchestration
│   │   ├── p-track-resume/         ← Resume stalled swarm
│   │   ├── eager-dispatch/         ← Standalone dispatch round
│   │   ├── dashboard-ops/          ← Dashboard operation command router
│   │   ├── project-workflow/       ← Project command router
│   │   ├── master-protocol/        ← Auto-loaded master protocol
│   │   ├── worker-protocol/        ← Auto-loaded worker protocol
│   │   └── failure-protocol/       ← Auto-loaded failure recovery protocol
│   └── hooks/                      ← Validation hooks
│       ├── validate-master-write.sh ← Prevents master from writing project files
│       └── validate-progress-file.sh ← Validates worker progress file writes
├── _commands/                      ← Synapse commands (46 total)
│   ├── Synapse/                    ← Swarm and dashboard commands (24)
│   │   ├── p_track.md, p.md, master_plan_track.md, add_task.md
│   │   ├── dispatch.md, eager_dispatch.md, retry.md
│   │   ├── resume.md, p_track_resume.md, track_resume.md
│   │   ├── status.md, logs.md, inspect.md, deps.md, history.md
│   │   ├── update_dashboard.md, export.md
│   │   ├── cancel.md, cancel-safe.md
│   │   ├── start.md, stop.md, reset.md, guide.md, project.md
│   │   └── ...
│   ├── project/                    ← Project analysis & management commands (22)
│   │   ├── initialize.md, onboard.md, scaffold.md, create_claude.md
│   │   ├── learn.md, learn_update.md, instrument.md
│   │   ├── context.md, review.md, health.md, scope.md, trace.md
│   │   ├── contracts.md, env_check.md, plan.md, prompt_audit.md
│   │   ├── toc.md, toc_generate.md, toc_update.md
│   │   ├── commands.md, help.md, profiles.md
│   │   └── ...
│   ├── user/                       ← User-local commands (git-ignored)
│   └── profiles/                   ← Agent role profiles (15)
│       ├── analyst.md, architect.md, copywriter.md, customer-success.md
│       ├── devops.md, founder.md, growth.md, legal.md
│       ├── marketing.md, pricing.md, product.md, qa.md
│       ├── sales.md, security.md, technical-writer.md
│       └── ...
├── agent/                          ← Agent instruction files and documentation
│   ├── instructions/               ← Hub reference files
│   │   ├── tracker_master_instructions.md   ← Master agent hub reference
│   │   ├── tracker_worker_instructions.md   ← Full worker protocol (8 mandatory writes)
│   │   ├── tracker_worker_instructions_lite.md ← Lite worker protocol (5 mandatory writes)
│   │   ├── tracker_multi_plan_instructions.md ← Meta-planner reference
│   │   ├── failed_task.md                   ← Repair worker protocol (5-phase repair)
│   │   ├── common_pitfalls.md               ← Common swarm mistakes and fixes
│   │   └── dashboard_resolution.md          ← Dashboard ID resolution, status derivation
│   ├── master/                     ← Master agent documentation (9 files)
│   │   ├── role.md                 ← Master role definition, "never do" list
│   │   ├── dashboard_writes.md     ← initialization.json, logs.json, metrics.json schemas
│   │   ├── ui_map.md               ← Dashboard UI field mapping
│   │   ├── eager_dispatch.md       ← 5-step eager dispatch mechanism
│   │   ├── failure_recovery.md     ← Repair tasks, circuit breaker, replanning
│   │   ├── worker_prompts.md       ← Worker dispatch prompt template, context budget
│   │   ├── compaction_recovery.md  ← Master state checkpoint and recovery
│   │   ├── dashboard_protocol.md   ← !p vs !p_track mode comparison
│   │   └── pki_integration.md      ← PKI pre-planning flow and context injection
│   ├── worker/                     ← Worker agent documentation (5 files)
│   │   ├── progress_reporting.md   ← Full progress file schema, mandatory writes
│   │   ├── return_format.md        ← Structured return template and examples
│   │   ├── deviations.md           ← Deviation severity levels and examples
│   │   ├── upstream_deps.md        ← 4-step upstream dependency handling
│   │   └── sibling_comms.md        ← Sibling communication protocol
│   ├── core/                       ← Core documentation (7 files)
│   │   ├── command_resolution.md   ← Command resolution hierarchy
│   │   ├── parallel_principles.md  ← 12 core parallelization principles
│   │   ├── profile_system.md       ← Profile modifier system
│   │   ├── project_discovery.md    ← Context efficiency principles
│   │   ├── path_convention.md      ← Path placeholders and resolution
│   │   ├── dashboard_features.md   ← Dashboard layout modes and UI features
│   │   └── data_architecture.md    ← Data file schemas
│   └── _commands/                  ← Internal p_track phase documentation
│       ├── p_track_planning.md     ← Phase 1: Planning (Steps 1-11)
│       ├── p_track_execution.md    ← Phase 2: Execution (Steps 12-16)
│       └── p_track_completion.md   ← Phase 3: Completion (Step 17)
├── dashboards/                     ← Multi-dashboard support (dynamic hex IDs)
│   └── {hex_id}/
│       ├── initialization.json     ← Static plan (written once during planning)
│       ├── logs.json               ← Timestamped event log
│       ├── metrics.json            ← Post-swarm performance metrics
│       └── progress/
│           └── {task_id}.json      ← Worker-owned progress files
├── queue/                          ← Overflow queue slots for !master_plan_track
├── history/                        ← History summary JSON files
├── Archive/                        ← Full archived dashboard snapshots
├── conversations/                  ← Chat conversation history JSON files
├── tasks/                          ← Generated per swarm
│   └── {MM_DD_YY}/
│       ├── parallel_{name}.json    ← Master task record
│       └── parallel_plan_{name}.md ← Strategy rationale document
├── src/
│   ├── server/                     ← Node.js SSE server (zero deps, ~2300 lines)
│   │   ├── index.js                ← HTTP server, SSE endpoint, startup/shutdown
│   │   ├── SSEManager.js           ← SSE client management, broadcast, heartbeat
│   │   ├── routes/apiRoutes.js     ← All API route handlers (20+ endpoints)
│   │   ├── services/
│   │   │   ├── DashboardService.js ← Dashboard CRUD, file I/O
│   │   │   ├── WatcherService.js   ← File watching, reconciliation, validation
│   │   │   ├── DependencyService.js ← Dependency resolution, dispatch readiness
│   │   │   ├── ArchiveService.js   ← Archive CRUD
│   │   │   ├── HistoryService.js   ← History summary building
│   │   │   └── QueueService.js     ← Queue read operations
│   │   └── utils/
│   │       ├── constants.js        ← Named constants and defaults
│   │       ├── json.js             ← JSON I/O, retry logic, schema validators
│   │       └── validation.js       ← Dependency graph validation (Kahn's algorithm)
│   ├── ui/                         ← React dashboard frontend (~6000 lines)
│   │   ├── main.jsx                ← Entry point, IPC fetch shim
│   │   ├── App.jsx                 ← Root component, view router
│   │   ├── context/AppContext.jsx  ← Global state (useReducer, ~80 state keys)
│   │   ├── hooks/
│   │   │   └── useDashboardData.js ← Central data hook, IPC listeners
│   │   ├── components/
│   │   │   ├── Header.jsx, Sidebar.jsx
│   │   │   ├── WavePipeline.jsx, ChainPipeline.jsx, AgentCard.jsx
│   │   │   ├── StatsBar.jsx, ProgressBar.jsx, LogPanel.jsx
│   │   │   ├── ClaudeView.jsx      ← Chat interface (~1500 lines)
│   │   │   ├── SwarmBuilder.jsx    ← Visual task graph editor
│   │   │   ├── ide/                ← Code Explorer (IDE) components
│   │   │   ├── git/                ← Git Manager components
│   │   │   ├── preview/            ← Live Preview components
│   │   │   └── modals/             ← 14 modal components
│   │   └── utils/
│   └── preview/
│       └── inject-overlay.js       ← Webview injection script for Live Preview
├── electron/                       ← Desktop app (Electron, ~7000 lines)
│   ├── main.js                     ← App lifecycle, window management
│   ├── preload.js                  ← IPC bridge (~140 methods, 33 push channels)
│   ├── ipc-handlers.js             ← Central IPC registration (~2200 lines)
│   ├── settings.js                 ← Settings persistence
│   └── services/
│       ├── SwarmOrchestrator.js     ← Dispatch engine, circuit breaker, replanning
│       ├── ClaudeCodeService.js     ← Claude CLI process management
│       ├── CodexService.js          ← Codex CLI process management
│       ├── PromptBuilder.js         ← Worker prompt construction
│       ├── ConversationService.js   ← Chat history persistence
│       ├── ProjectService.js        ← Project/CLI detection
│       ├── CommandsService.js       ← Command CRUD and AI generation
│       ├── TaskEditorService.js     ← Swarm builder backend
│       ├── TerminalService.js       ← PTY terminal sessions
│       ├── DebugService.js          ← Node.js debugger (CDP)
│       ├── InstrumentService.js     ← Live Preview instrumentation
│       ├── PreviewService.js        ← Label-to-source mapping
│       └── PreviewTextWriter.js     ← Text update writer, dev server detection
└── public/
    └── styles.css
```

**Target project structure** (created by Synapse at `{project_root}`):

```
{project_root}/
├── .synapse/                       ← Synapse project metadata (add to .gitignore)
│   ├── config.json                 ← Project-Synapse configuration
│   ├── toc.md                      ← Project Table of Contents (generated by !toc_generate)
│   ├── fingerprints.json           ← File content fingerprints for TOC change detection
│   ├── dep_graph.json              ← File-level dependency graph
│   └── knowledge/                  ← Project Knowledge Index (generated by !learn)
│       ├── manifest.json           ← Routing index with domain/tag/concept indexes
│       ├── annotations/{hash}.json ← Per-file deep knowledge
│       ├── domains.json            ← Domain taxonomy
│       └── patterns.json           ← Pattern catalog
├── AGENTS.md                       ← Project conventions (may already exist)
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
| `!initialize` | Initialize Synapse for a target project — create `.synapse/`, detect tech stack, optionally scaffold `AGENTS.md`. |
| `!onboard` | Project walkthrough — read AGENTS.md, TOC, key files and present a structured orientation. |
| `!scaffold` | Generate a `AGENTS.md` for a project that doesn't have one. |
| `!create_claude` | Create or update an opinionated CLAUDE.md for a project. Sets rules for how the project should be built. |
| `!learn` | Bootstrap the Project Knowledge Index (PKI) from scratch via parallel swarm. |
| `!learn_update` | Incrementally refresh the PKI — re-scans only stale/new files. |
| `!instrument` | Add `data-synapse-label` attributes to project files for Live Preview inline editing. |

### Swarm Lifecycle

| Command | Description |
|---|---|
| `!p_track {prompt}` | **Primary command.** Plan, dispatch, track, and report a full parallel agent swarm with live dashboard updates. |
| `!p {prompt}` | Lightweight parallel dispatch — no progress files, minimal dashboard overhead. |
| `!master_plan_track {prompt}` | Multi-stream orchestration — decompose into independent swarms across dashboards. |
| `!add_task {prompt}` | Inject new tasks into an active swarm mid-flight. Resolves dependencies bidirectionally. |
| `!dispatch {id}` | Manually dispatch a specific pending task. `!dispatch --ready` dispatches all unblocked tasks. |
| `!eager_dispatch` | Run a standalone eager dispatch round. Identifies and dispatches all tasks with satisfied dependencies. |
| `!retry {id}` | Re-dispatch a failed task with a fresh agent. |
| `!resume` | Resume a chat session after interruption. Reviews history, reconstructs context. |
| `!p_track_resume` | Resume a stalled/interrupted `!p_track` swarm. Reconstructs state, re-dispatches incomplete tasks. |
| `!track_resume` | Resume a stalled/interrupted swarm (generic). Analyzes state, dispatches workers. |
| `!cancel` | Cancel the active swarm. `!cancel --force` skips confirmation. |
| `!cancel-safe` | Graceful shutdown — let running tasks finish, cancel pending. |

### Monitoring

| Command | Description |
|---|---|
| `!status` | Quick terminal summary of current swarm state. |
| `!logs` | View log entries. Supports `--level`, `--task`, `--agent`, `--last`, `--since` filters. |
| `!inspect {id}` | Deep-dive into a specific task — context, dependencies, timeline, logs. |
| `!deps` | Visualize the full dependency graph. `!deps {id}` for a single task. `!deps --critical` for critical path. |
| `!history` | View past swarm history. `!history --last 5` for recent only. `!history --analytics` for aggregate stats. |
| `!update_dashboard` | Generate a visual progress report of the current swarm. |
| `!export` | Export a dashboard's full swarm state as markdown or JSON for post-mortems or sharing. |

### Project Analysis

| Command | Description |
|---|---|
| `!context {query}` | Deep context gathering within `{project_root}`. Queries PKI if available, supplements with grep/glob. |
| `!review` | Code review of recent changes or specified files. |
| `!health` | Project health check — AGENTS.md quality, dependency health, TOC consistency. |
| `!scope {change}` | Blast radius analysis — what would be affected by a proposed change. |
| `!trace {endpoint}` | End-to-end code tracing of an endpoint, function, or data flow. |
| `!contracts` | API contract audit — consistency between interfaces and implementations. |
| `!env_check` | Environment variable audit — consistency across configs. |
| `!plan {task}` | Implementation planning based on project context. |
| `!prompt_audit` | Post-swarm prompt quality audit. Analyzes worker performance and prompt quality indicators. |

### Table of Contents

| Command | Description |
|---|---|
| `!toc {query}` | Search the project TOC at `{project_root}/.synapse/toc.md`. Sub-commands: `depends-on`, `depended-by`, `cluster`, `changes-since`. |
| `!toc_generate` | Generate a full project TOC via parallel agent swarm. Produces `toc.md`, `fingerprints.json`, `dep_graph.json`. |
| `!toc_update` | Incrementally update the TOC for changed files. Uses `fingerprints.json` for semantic shift detection. |

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
| `!start` | Start the dashboard server and launch the Electron app. |
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

### 5. Errors Don't Stop the Swarm (But Cascading Failures Trigger Reassessment)

A failed task blocks only its direct dependents. Everything else continues. Log the error, mark the task, keep dispatching.

**Circuit breaker:** If 3+ tasks fail within the same wave, or if a failed task blocks more than half of all remaining tasks, the master must **pause dispatching** and assess:
- Is there a shared root cause (bad assumption, missing dependency, environment issue)?
- Does the plan need revision?
- Should the swarm be cancelled?

Present the assessment to the user. Either continue with justification, revise the plan, or cancel. Never blindly push through cascading failures.

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

**Master handles event logging and task file updates only:**
- Agent dispatched → append to `logs.json`
- Agent completed → append to `logs.json` + update task file
- Agent failed → append to `logs.json` + update task file
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

The static plan store, written once during planning and never updated after. Located at `{tracker_root}/dashboards/{dashboardId}/initialization.json`. Every field maps to UI elements on the dashboard, combined with progress file data. See `agent/instructions/tracker_master_instructions.md` for the complete field-to-UI mapping.

**Key objects:**
- `task` — The swarm metadata (name, type, directory, prompt, project, project_root, created, total_tasks, total_waves)
- `agents[]` — One entry per task (id, title, wave, layer, directory, depends_on — plan data only, no lifecycle fields)
- `waves[]` — One entry per wave (id, name, total — structure only, no status or completed counts)
- `chains[]` — Optional, for chain layout mode
- `history[]` — Previous swarm records

**Write rules:**
- Write-once during planning — **never update after the planning phase** (3 exceptions: repair task insertion, `!add_task` mid-flight injection, and circuit breaker replanning)
- Always atomic: read → modify in memory → write full file
- Never write partial JSON
- No lifecycle fields: `status`, `started_at`, `completed_at`, `summary`, `assigned_agent`, `completed_tasks`, `failed_tasks`, `overall_status` are all absent — they are derived from progress files by the dashboard
- `task.project_root` stores the resolved `{project_root}` so the dashboard and commands know which project this swarm serves

### logs.json

The timestamped event log, located at `{tracker_root}/dashboards/{dashboardId}/logs.json`. Every entry becomes a row in the dashboard log panel.

**Entry fields:** `timestamp`, `task_id`, `agent`, `level`, `message`, `task_name`

**Levels:** `info` (general), `warn` (unexpected), `error` (failure), `debug` (verbose), `permission` (triggers popup), `deviation` (plan divergence)

### master_state.json

Master state checkpoint at `{tracker_root}/dashboards/{dashboardId}/master_state.json`. Written by the master on every dispatch event for compaction recovery. Contains the master's internal state so it can be reconstructed if the context window compacts.

### metrics.json

Post-swarm performance metrics at `{tracker_root}/dashboards/{dashboardId}/metrics.json`. Written once by the master at swarm completion. Contains: elapsed time, efficiency ratio, duration distribution, failure rate, and per-agent timing.

### Master Task File

The authoritative task record at `{tracker_root}/tasks/{date}/parallel_{name}.json`. Contains everything: task descriptions, context, critical details, file lists, dependencies, status, summaries, and logs. Every agent reads it for context. The master updates it on every completion.

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

---

## Failure Recovery

### Repair Tasks

When a worker fails:
1. Master logs the failure to `logs.json`
2. Creates a repair task in `initialization.json` with an `r`-suffixed ID (e.g., `2.4r`)
3. Rewires downstream `depends_on` references to point at the repair task
4. Dispatches a repair worker with `agent/instructions/failed_task.md` protocol
5. Repair worker executes a 5-phase process: Diagnose, Plan, Implement, Verify, Complete

### Double Failure Escalation

If a repair task (ID ending in `r`) itself fails:
- NO further repair tasks are created
- Task is marked as `permanently_failed`
- A `permission` log entry triggers a dashboard popup for manual intervention
- The swarm continues for all other unblocked tasks

### Circuit Breaker

The circuit breaker triggers automatic replanning when:
- 3+ tasks fail in the same wave
- A single failure blocks 3+ downstream tasks
- A single failure blocks >50% of remaining tasks

When triggered, the system transitions to `replanning` state:
1. Spawns a replanner agent with full context (completed tasks, failed tasks, pending tasks)
2. Replanner produces a revision with four categories: `modified`, `added`, `removed`, `retry`
3. Revision is applied to `initialization.json`
4. Dispatch resumes with the updated plan

### Major Deviation Gate

During repair diagnosis, if the fix requires a major deviation from the original plan:
- Repair worker reports back (status: failed, summary: "REPAIR BLOCKED: ...")
- Master writes a `permission` log entry
- User provides guidance via the permission popup
- A new repair task is created with updated instructions

### Retry vs Repair Decision Flow

| Scenario | Approach |
|---|---|
| Transient failure (timeout, flaky test) | `!retry` — same approach + failure context |
| Clear, fixable root cause | `!retry` with remediation guidance |
| Unknown root cause | Repair task — worker diagnoses first |
| Partial/broken state left | Repair task — needs cleanup phase |
| Failure affects downstream contracts | Repair task — Major Deviation Gate |

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

The dashboard supports multiple simultaneous swarms via a sidebar that lists all dashboard instances. Each dashboard directory is an independent swarm with its own `initialization.json`, `logs.json`, and `progress/` directory. Dashboards use dynamic 6-character hex IDs (e.g., `a3f7k2`). Different dashboards can serve different projects — the `task.project_root` field identifies which project each swarm belongs to.

**Each chat is bound to exactly one dashboard.** When an agent is spawned from a chat view, its system prompt contains a `DASHBOARD ID:` directive — the agent uses that dashboard unconditionally and has no access to any other dashboard. If the dashboard has previous data, the agent asks the user before archiving and reusing it. There is no scanning or auto-selection. See `agent/instructions/dashboard_resolution.md` for the full protocol.

**Workers always know their dashboard.** The master includes `{dashboardId}` in every worker dispatch prompt. Workers write progress files to `{tracker_root}/dashboards/{dashboardId}/progress/{task_id}.json` — they never auto-detect.

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

Every timestamp in `initialization.json`, `logs.json`, progress files, and the task file must be captured live:

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

3. **Project-specific context** comes from the project's own `AGENTS.md`, documentation, and code. Synapse reads `{project_root}/AGENTS.md` for conventions and uses Glob/Grep for file discovery.

4. **Project-specific commands** can be defined at `{project_root}/_commands/`. These are checked after Synapse's own commands in the resolution hierarchy.

5. **The `.synapse/` directory** is created inside the target project for TOC and configuration. Add it to `.gitignore`.

6. **All Synapse data** (dashboards, tasks, history, logs) stays at `{tracker_root}`. Nothing except `.synapse/` is written to the target project.

---

## Multi-Project Support

Multiple dashboards can serve different projects simultaneously. The `task.project_root` field in `initialization.json` identifies which project each swarm belongs to.

When working across multiple projects:
- Use `!project set` to switch the active project, or pass `--project` to individual commands
- Each swarm's dashboard shows which project it's targeting
- Commands like `!status` and `!logs` use the agent's assigned dashboard
- Workers always receive explicit `{project_root}` in their prompts

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
