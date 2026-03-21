# `!deps [dashboardId] [task_id] [--critical] [--blocked]`

**Purpose:** Visualize the dependency graph for a specific task or the entire swarm. Shows what blocks what, the critical path, and current bottlenecks.

**Syntax:**
- `!deps` — Show the full dependency graph (auto-detect dashboard)
- `!deps dashboard3` — Show graph for a specific dashboard
- `!deps 2.3` — Show dependencies for a specific task (auto-detect dashboard)
- `!deps dashboard1 2.3` — Show dependencies for a task on a specific dashboard
- `!deps --critical` — Highlight the critical path
- `!deps --blocked` — Show only blocked or failing dependency chains

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## `!deps [dashboardId]` (full graph)

### Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument matches `dashboard[1-5]`, use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** Extract all agents and their `depends_on` arrays.

3. **Read all progress files** from `{tracker_root}/dashboards/{dashboardId}/progress/`. Build a status map for each agent.

4. **Build and display the dependency graph** as an ASCII visualization:

```markdown
## Dependency Graph: {task.name} [{dashboardId}]

### Wave 1 → Wave 2 → Wave 3
```
```
1.1 ──→ 2.1 ──→ 3.1
1.2 ──→ 2.2 ──┘
1.3 ──→ 2.3
1.4
```

Use status indicators on each node:
- ✅ completed (from progress file)
- 🔵 in progress (from progress file)
- ⚪ pending (no progress file, or status "pending")
- 🔴 failed (from progress file)

5. **Identify the critical path** — the longest chain from any root task to any terminal task. Mark it.

6. **Identify bottlenecks** — in-progress tasks that have the most downstream dependents waiting.

```markdown
### Critical Path
1.1 → 2.1 → 3.1 (3 tasks deep)

### Current Bottlenecks
- **2.1** (in progress) — blocks 3.1, 3.2 (2 tasks waiting)
```

---

## `!deps [dashboardId] {task_id}` (single task)

### Steps

1. **Parse `{dashboardId}` and `{task_id}`.** Read initialization + progress as above.

2. **Trace upstream** — recursively follow `depends_on` (from initialization.json) to find all ancestor tasks.

3. **Trace downstream** — find all agents in initialization.json that list this task in their `depends_on`.

4. **Display:**

```markdown
## Dependencies for {task_id}: {title} [{dashboardId}]

### Needs (upstream)
{task_id} ← {dep_id} ({status from progress}) ← {dep_dep_id} ({status})

### Blocks (downstream)
{task_id} → {downstream_id} ({status}) → {further_id} ({status})

### Full Chain
{root} → ... → {task_id} → ... → {terminal}
```
