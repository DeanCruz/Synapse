# !help — Synapse Guide & Tips

## Overview

Displays a practical guide to getting the most out of Synapse — available commands, workflow tips, and power-user patterns.

---

## Output the Following

```
## Synapse — Quick Reference

### What Is This?

You're working with **Synapse**, a distributed agent swarm control system. It can:
- Dispatch parallel agent swarms for large tasks
- Track progress in real-time via a live dashboard
- Manage dependencies between tasks automatically
- Maintain a semantic index of your project

---

### Commands by Category

**Context & Discovery** — Understand before you code
| Command | What it does |
|---|---|
| `!toc {query}` | Search the project's semantic index for files |
| `!toc_update` | Incrementally update the project index |
| `!toc_generate` | Full rebuild of the project index (swarm) |
| `!context {query}` | Deep context gathering within the project |
| `!learn` | Bootstrap the Project Knowledge Index (PKI) |
| `!learn_update` | Incrementally refresh the PKI |

**Parallel Execution** — Go fast
| Command | What it does |
|---|---|
| `!p_track {task}` | Dispatch a full parallel agent swarm with dashboard |
| `!p {task}` | Lightweight parallel dispatch (no live progress tracking) |
| `!master_plan_track {task}` | Multi-stream orchestration across dashboards |
| `!status` | Check current swarm status |
| `!dispatch` | Manually dispatch pending tasks |
| `!start` / `!stop` | Launch the Electron app / stop the server |

**Auditing & Analysis** — Catch problems early
| Command | What it does |
|---|---|
| `!review` | Code review of recent changes |
| `!health` | Project health check |
| `!scope {change}` | Blast radius analysis |
| `!trace {endpoint}` | End-to-end code tracing |
| `!contracts` | API contract audit |
| `!env_check` | Verify environment variable consistency |
| `!prompt_audit` | Post-swarm prompt quality audit |

**Monitoring**
| Command | What it does |
|---|---|
| `!logs` | View/filter event log entries |
| `!inspect {id}` | Deep-dive into a specific task |
| `!deps` | Visualize the dependency graph |
| `!history` | View past swarm history |
| `!export` | Export swarm state as markdown or JSON |

**Project Management**
| Command | What it does |
|---|---|
| `!project` | Show, set, or clear the target project path |
| `!initialize` | Set up Synapse for a project |
| `!onboard` | Project walkthrough and orientation |
| `!scaffold` | Generate a CLAUDE.md for a project |
| `!create_claude` | Create/update an opinionated CLAUDE.md |
| `!instrument` | Add Live Preview labels to project files |
| `!commands` | List all available commands |
| `!profiles` | List available agent profiles |
| `!help` | This guide |

---

### Tips for Best Results

**1. Start with context, not code.**
Before asking the agent to build something, use `!toc {topic}` to understand the existing codebase first. The agent works best when it understands the full picture before writing code.

**2. Let the agent go parallel when it makes sense.**
For large tasks, use `!p_track {task}` to dispatch a swarm. The agent will break the work into independent pieces and run them simultaneously. Open the dashboard (`!start`) to watch progress in real-time.

**3. Be specific in your prompts.**
"Fix the bug" -> bad. "Fix the checkout total calculation — it's not applying the discount before tax in the CartSummary component" -> good. The more specific you are, the fewer files the agent needs to read and the faster it works.

**4. Keep CLAUDE.md up to date.**
The agent reads your project's CLAUDE.md before every task. If the conventions in there are wrong or outdated, the agent will follow them anyway. Keep it current.

**5. Run `!env_check` periodically.**
Catches missing or inconsistent environment variables that only surface at runtime.

**6. Use `!toc_update` after structural changes.**
After adding new files or directories, run `!toc_update` so the semantic index stays current.

**7. Bootstrap project knowledge with `!learn`.**
Run once per project to build the PKI, then `!learn_update` to keep it current. Workers get better context when PKI exists.

---

### Workflow Patterns

**New feature (small):**
Agent builds it directly in serial mode.

**New feature (large):**
`!p_track {feature}` -> `!start` (dashboard) -> review results

**Very large feature (multiple swarms):**
`!master_plan_track {feature}` -> review plans -> approve dispatch

**First time on a project:**
`!project set /path` -> `!initialize` -> `!learn` -> `!onboard`

**Start of session:**
`!toc_update` (if stale) -> start working

**Code review workflow:**
`!review` -> `!scope {change}` -> `!contracts`

**Blast radius analysis:**
`!scope {proposed change}` -> review affected files -> plan accordingly

**Periodic maintenance:**
`!env_check` -> fix issues -> `!toc_update` -> `!learn_update`
```

---

## Rules

- **Output the guide above.** Adapt it to the actual project state — if certain commands don't exist, omit those sections.
- **Do not modify any files.**
- **Run in serial mode.** This is instant output.
