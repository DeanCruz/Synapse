# Execution Mode Selection — Serial vs. Parallel

The master agent operates in two distinct modes. Choosing the right mode is critical to efficiency.

## Serial Mode (Default)

For tasks that are small, single-file, single-repo, or inherently sequential, execute them directly. No swarm overhead, no agent dispatch — just do the work.

**Use serial mode when:**
- The task touches 1-2 files in a single repo
- The task is a quick fix, small refactor, or minor addition
- The task has no independent subtasks that could run simultaneously
- The total effort is less than what would justify planning + dispatch overhead

## Parallel Mode (Swarm Dispatch)

For tasks that decompose into multiple independent work streams, **parallel execution via agent swarm is mandatory.** The master agent must recognize when parallel execution is more efficient and switch to swarm mode proactively — even if the user did not explicitly request it.

**Use parallel mode when:**
- The task naturally decomposes into 3+ independent subtasks
- The task spans multiple repositories
- The task involves multiple files that can be edited simultaneously by different agents
- The total wall-clock time would be significantly reduced by parallel execution
- Multiple components, features, or fixes are being requested in a single prompt

**When the master agent determines that parallel mode is more efficient, it SHOULD proactively enter swarm mode.** The agent must use its judgment — if the task would be done in half the time with 4 agents working in parallel, doing it serially is a waste of the user's time.

## Forced Parallel Mode — `!p` Commands (NON-NEGOTIABLE)

Any command prefixed with `!p` **forces the agent into master dispatch mode.** This is absolute and non-negotiable.

**Triggering commands include:**
- `!p_track {prompt}` — Full swarm: plan, dispatch, track, and report
- `!p {prompt}` — Shorthand for parallel dispatch
- Any `!p_{command}` variant — All force swarm mode

When any `!p` command is invoked, the following happens unconditionally:

1. **The agent enters master dispatch mode.** It becomes the orchestrator. It does NOT write code. Its only responsibilities are: gather context, plan, dispatch, status, and report.
2. **Reading `{parent_directory}/Synapse/CLAUDE.md` is NON-NEGOTIABLE.** This must be done before any planning or dispatch begins. The Synapse CLAUDE.md contains the complete swarm orchestration protocol — parallelization principles, the master agent's role restrictions, status update requirements, data architecture, and task design rules. Skipping this read is a failure.
3. **All Synapse rules apply in full.** Every principle, every constraint, every protocol defined in `Synapse/CLAUDE.md` is binding for the duration of the swarm.

## Automatic Parallel Mode

Even without an explicit `!p` command, the master agent must escalate to parallel mode when it recognizes the opportunity. In this case:

1. **Inform the user** that you are switching to parallel execution and briefly explain why
2. **Read `{parent_directory}/Synapse/CLAUDE.md`** — this is NON-NEGOTIABLE any time agents are being dispatched, whether the user explicitly requested it or not
3. **Follow the full swarm protocol** as defined in Synapse/CLAUDE.md
4. The master agent assumes the orchestrator role — no code, only context/plan/dispatch/status/report

The only difference between automatic and forced parallel mode is the notification to the user. The protocols, restrictions, and responsibilities are identical.

## Decision Flowchart

```
User gives task
       |
       v
Is it a !p command? --YES--> FORCED PARALLEL MODE
       |                      Read Synapse/CLAUDE.md
       NO                     Enter master dispatch mode
       |                      Do NOT write code
       v
Can it decompose into 3+ independent subtasks? --YES--> AUTOMATIC PARALLEL MODE
       |                                                  Notify user
       NO                                                 Read Synapse/CLAUDE.md
       |                                                  Enter master dispatch mode
       v                                                  Do NOT write code
SERIAL MODE
Execute directly
```

---

## Agent Dispatch Protocol

Once the master agent has entered parallel mode (forced or automatic), follow this protocol exactly. All rules from `{parent_directory}/Synapse/CLAUDE.md` are binding.

### Before Dispatch

1. **Read `{parent_directory}/Synapse/CLAUDE.md`** — NON-NEGOTIABLE. Contains the complete orchestration protocol, including the master agent's role restrictions (no coding), parallelization principles, status requirements, and task design rules.
2. **Read `{parent_directory}/TableOfContentsMaster.md`** — to identify all relevant repos and directories for planning. Use Glob/Grep for file-level detail as needed.
3. **Read the `CLAUDE.md` of every child repo** that agents will work in — to include repo-specific conventions in agent prompts.
4. **Read the relevant command file** if triggered by a `!` command.

### During Planning

The master agent plans. It does not code. Every minute spent planning saves ten minutes of agent confusion.

- Decompose the task into atomic, self-contained units following Synapse principles
- For each agent task, include:
  - The specific files to read and modify (sourced from TableOfContentsMaster or Glob/Grep)
  - The relevant conventions from the target repo's `CLAUDE.md` (quoted directly, not paraphrased)
  - Any cross-repo context the agent needs (types, interfaces, API contracts)
  - Code snippets the agent needs to reference
  - Clear, verifiable success criteria
- Map all dependencies between tasks
- Identify which tasks span repos vs. which are repo-local
- Create the master XML and plan files

### During Execution

The master agent orchestrates. It does not code. It monitors, dispatches, and records.

- Follow all parallelization principles from `Synapse/CLAUDE.md`
- Update `logs.json` immediately on every state change
- Dispatch newly unblocked tasks as soon as dependencies are satisfied
- Never let the pipeline stall waiting for a batch
- If a worker fails, log the error, mark the task, and continue dispatching unblocked work

### After Completion

- Compile a final summary report for the user
- Update `TableOfContentsMaster.md` if the swarm created, moved, or restructured files
- Verify all cross-repo consistency (shared types, API contracts, etc.)
- Move the completed swarm to history
- **Only after the swarm is fully complete** may the master agent resume serial mode and direct code execution
