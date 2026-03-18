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

**Parallel Execution** — Go fast
| Command | What it does |
|---|---|
| `!p_track {task}` | Dispatch a full parallel agent swarm with dashboard |
| `!status` | Check current swarm status |
| `!dispatch` | Manually dispatch pending tasks |
| `!start` / `!stop` | Start/stop the dashboard server |

**Auditing** — Catch problems early
| Command | What it does |
|---|---|
| `!env_check` | Verify environment variable consistency |

**Project Management**
| Command | What it does |
|---|---|
| `!initialize` | Set up Synapse for a project |
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

---

### Workflow Patterns

**New feature (small):**
Agent builds it directly in serial mode.

**New feature (large):**
`!p_track {feature}` -> `!start` (dashboard) -> review results

**Start of session:**
`!toc_update` (if stale) -> start working

**Periodic maintenance:**
`!env_check` -> fix issues -> `!toc_update`
```

---

## Rules

- **Output the guide above.** Adapt it to the actual project state — if certain commands don't exist, omit those sections.
- **Do not modify any files.**
- **Run in serial mode.** This is instant output.
