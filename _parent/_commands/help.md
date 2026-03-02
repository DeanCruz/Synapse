# !help — Master Agent Guide & Tips

## Overview

Displays a practical guide to getting the most out of the master agent — available commands, workflow tips, and power-user patterns.

---

## Output the Following

```
## Master Agent — Quick Reference

### What Is This?

You're working with a **master agent** that coordinates across all repositories in this workspace. Unlike a single-repo agent, it can:
- Read and modify files across multiple repos in one task
- Dispatch parallel agent swarms for large tasks
- Track cross-repo dependencies (shared types, API contracts, config)
- Maintain a semantic index of the entire workspace

---

### Commands by Category

**📍 Context & Discovery** — Understand before you code
| Command | What it does |
|---|---|
| `!context {topic}` | Deep cross-repo context gather (e.g., `!context auth`) |
| `!trace {target}` | Trace an endpoint/type/function across all repos |
| `!scope {task}` | Analyze blast radius before starting a task |
| `!onboard` | Full workspace walkthrough |

**📋 Planning & Review** — Think before you act
| Command | What it does |
|---|---|
| `!plan {task}` | Full implementation plan without writing code |
| `!review` | Cross-repo code review of recent changes |
| `!migrate {desc}` | Step-by-step cross-repo migration checklist |

**🔍 Auditing** — Catch problems early
| Command | What it does |
|---|---|
| `!sync_types` | Check shared types for drift between repos |
| `!contracts` | Audit API contracts between frontend and backend |
| `!env_check` | Verify environment variable consistency |
| `!health` | Full workspace health check |

**⚡ Parallel Execution** — Go fast
| Command | What it does |
|---|---|
| `!p_track {task}` | Dispatch a full parallel agent swarm with dashboard |
| `!status` | Check current swarm status |
| `!dispatch` | Manually dispatch pending tasks |
| `!start` / `!stop` | Start/stop the dashboard server |

**🗂️ Workspace Management**
| Command | What it does |
|---|---|
| `!generate_toc` | Full rebuild of workspace index (swarm) |
| `!update_toc` | Quick incremental index update |
| `!commands` | List all available commands |
| `!help` | This guide |

---

### Tips for Best Results

**1. Start with context, not code.**
Before asking the agent to build something, run `!context {topic}` or `!scope {task}` first. The agent works best when it understands the full picture before writing code.

**2. Use `!plan` for anything non-trivial.**
If a task touches more than 2-3 files, run `!plan {task}` first. Review the plan, adjust if needed, then approve. This prevents wasted work and gives you control over the approach.

**3. Let the agent go parallel when it makes sense.**
For large tasks, use `!p_track {task}` to dispatch a swarm. The agent will break the work into independent pieces and run them simultaneously. Open the dashboard (`!start`) to watch progress in real-time.

**4. Trust the cross-repo commands.**
`!sync_types`, `!contracts`, and `!env_check` catch bugs that no linter can find — inconsistencies between repos that only surface at runtime. Run them periodically or after any cross-repo change.

**5. Run `!health` at the start of sessions.**
Quick way to see if anything is broken, stale, or missing across the workspace.

**6. Be specific in your prompts.**
"Fix the bug" → bad. "Fix the checkout total calculation — it's not applying the discount before tax in the CartSummary component" → good. The more specific you are, the fewer files the agent needs to read and the faster it works.

**7. Cross-repo tasks are the master agent's superpower.**
Any task that spans frontend + backend + knowledge base is where this system shines. Single-repo tasks work fine too, but you're not leveraging the full power of the orchestration system.

**8. Keep CLAUDE.md files up to date.**
The agent reads your repo's CLAUDE.md before every task. If the conventions in there are wrong or outdated, the agent will follow them anyway. Keep them current.

---

### Workflow Patterns

**New feature (small):**
`!plan {feature}` → approve → agent builds it → `!review`

**New feature (large):**
`!scope {feature}` → `!plan {feature}` → approve → `!p_track {feature}` → `!start` (dashboard) → `!review`

**Bug fix:**
`!context {area}` → `!trace {endpoint/function}` → fix the bug → `!review`

**Cross-repo change:**
`!migrate {change}` → review checklist → execute steps → `!sync_types` → `!contracts`

**Start of session:**
`!health` → `!update_toc` (if stale) → start working

**Periodic maintenance:**
`!health` → `!sync_types` → `!contracts` → `!env_check` → fix issues
```

---

## Rules

- **Output the guide above.** Adapt it to the actual workspace state — if certain repos or commands don't exist, omit those sections.
- **Do not modify any files.**
- **Run in serial mode.** This is instant output.
