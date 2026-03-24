# `!eager_dispatch [--dashboard {id}]`

**Purpose:** Run a standalone eager dispatch round on an active swarm. Reads current dashboard state, identifies all tasks whose dependencies are satisfied but haven't been dispatched, builds complete worker prompts, and dispatches them all immediately.

**Syntax:**
- `!eager_dispatch` — Auto-detect the active dashboard and dispatch all ready tasks
- `!eager_dispatch --dashboard {id}` — Target a specific dashboard

> **Dashboard resolution:** Auto-selects the first dashboard with an active/stalled swarm (excluding `ide`). Override with `--dashboard {id}`.

---

## When to Use

| Scenario | Command | Why |
|---|---|---|
| Swarm stalled, master died | `!eager_dispatch` | One-shot dispatch of all ready tasks with full prompts |
| After circuit breaker pause | `!eager_dispatch` | Resume dispatching after plan review |
| Suspect missed dispatch | `!eager_dispatch` | Scan and dispatch anything idle |
| Plan approved, execution never started | `!eager_dispatch` | Kick off the first wave |
| Full lifecycle recovery | `!p_track_resume` | Use resume instead — includes completion monitoring |
| Single task dispatch | `!dispatch {id}` | Use dispatch for one specific task |
| Retry a failed task | `!retry {id}` | Use retry for failed tasks |

## What This Does

1. Reads `initialization.json`, all progress files, `master_state.json`, and the master task file
2. Builds completed/in-progress/failed sets from progress files
3. Identifies every task where ALL `depends_on` are completed and the task is not yet dispatched
4. Presents the dispatch summary and waits for user approval
5. Builds complete, self-contained worker prompts (with upstream results, conventions, reference code)
6. Dispatches all ready tasks simultaneously
7. Updates `logs.json` and `master_state.json`

## What This Does NOT Do

- Monitor worker completions (use `!p_track_resume` for that)
- Retry failed tasks (use `!retry {id}`)
- Run the circuit breaker
- Produce a final report
- Handle replanning

## Differences from `!dispatch --ready`

| Feature | `!dispatch --ready` | `!eager_dispatch` |
|---|---|---|
| Worker prompt quality | Basic — task info + paths | Full — conventions, upstream results, reference code, KEY DETAILS |
| Reads master task file | Yes | Yes |
| Reads project CLAUDE.md | No | Yes — builds convention_map |
| Upstream result injection | No | Yes — structured per-dependency summaries |
| Writes master_state.json | No | Yes |
| Approval gate | No | Yes — presents summary before dispatching |

**Rule of thumb:** Use `!dispatch --ready` for quick, simple dispatches. Use `!eager_dispatch` when you need production-quality worker prompts with full context injection.
