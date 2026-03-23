# `!deps [dashboardId] [task_id] [--critical] [--blocked] | validate`

**Purpose:** Visualize the dependency graph for a specific task or the entire swarm. Shows what blocks what, the critical path, and current bottlenecks. Can also validate the dependency graph for structural issues.

**Syntax:**
- `!deps` — Show the full dependency graph (auto-detect dashboard)
- `!deps dashboard3` — Show graph for a specific dashboard
- `!deps 2.3` — Show dependencies for a specific task (auto-detect dashboard)
- `!deps dashboard1 2.3` — Show dependencies for a task on a specific dashboard
- `!deps --critical` — Highlight the critical path
- `!deps --blocked` — Show only blocked or failing dependency chains
- `!deps validate` — Validate the dependency graph for structural issues (auto-detect dashboard)
- `!deps validate dashboard2` — Validate a specific dashboard's dependency graph

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

---

## `!deps validate [dashboardId]`

**Purpose:** Validate the dependency graph for structural issues — circular references, broken links, wave inconsistencies, disconnected tasks, and wave/agent count mismatches. Run this after planning (or anytime) to catch graph problems before dispatch.

### Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument after `validate` matches `dashboard[1-5]`, use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/initialization.json`.** Extract `agents[]` and `waves[]`. If `task` is `null` or `agents` is empty, report "No active swarm on {dashboardId}" and exit.

3. **Build the full dependency graph** from `agents[].depends_on` arrays. Create an adjacency list mapping each task ID to its dependents (forward edges) and its dependencies (backward edges).

4. **Run all five validation checks:**

#### Check 1: Circular Dependency Detection

Run a topological sort (Kahn's algorithm or DFS-based cycle detection) on the dependency graph.

- **PASS:** Graph is a valid DAG — no cycles detected.
- **FAIL:** Circular dependency detected. Report the full cycle path.

```
FAIL: Circular dependency detected: 2.1 → 3.2 → 2.1
```

#### Check 2: Broken References

For every task ID referenced in any `depends_on` array, verify that a matching entry exists in `agents[]`.

- **PASS:** All dependency references resolve to existing tasks.
- **FAIL:** One or more `depends_on` entries reference non-existent task IDs.

```
FAIL: Task 2.3 depends on 1.9 which does not exist
FAIL: Task 3.1 depends on 2.7 which does not exist
```

#### Check 3: Wave Consistency

For every dependency edge, verify that the dependency's wave number is strictly less than the dependent task's wave number. A task in Wave N should only depend on tasks in Waves 1 through N-1.

- **PASS:** All dependency edges flow from lower waves to higher waves.
- **WARN:** One or more dependencies violate wave ordering (same-wave or reverse-wave dependencies).

```
WARN: Task 2.3 (Wave 2) depends on task 2.1 (Wave 2) — expected dep wave < task wave
WARN: Task 1.5 (Wave 1) depends on task 2.2 (Wave 2) — expected dep wave < task wave
```

#### Check 4: Island Detection

Identify tasks that are completely disconnected from the graph — they have no dependencies AND nothing depends on them AND they are not in Wave 1. Wave 1 tasks are expected to have no dependencies (they are roots). Tasks in later waves with no connections in either direction are likely planning errors.

- **PASS:** No disconnected non-root tasks found.
- **WARN:** One or more tasks are islands.

```
WARN: Task 3.4 (Wave 3) is disconnected — no dependencies and nothing depends on it
WARN: Task 2.6 (Wave 2) is disconnected — no dependencies and nothing depends on it
```

#### Check 5: Completeness

Verify structural consistency between `agents[]` and `waves[]`:
- Every `agent.wave` value must have a corresponding entry in `waves[]` with a matching `id`.
- Each `waves[].total` must equal the actual count of agents assigned to that wave.

- **PASS:** All wave references are valid and counts match.
- **FAIL:** Missing wave definitions or count mismatches.

```
FAIL: Agent 4.1 references wave 4 but no waves[] entry with id 4 exists
FAIL: Wave 2 declares total=3 but has 4 agents assigned
```

### Output

Display a structured validation report:

```markdown
## Dependency Validation: {task.name} [{dashboardId}]

| # | Check                        | Result |
|---|------------------------------|--------|
| 1 | Circular dependency detection | PASS   |
| 2 | Broken references             | PASS   |
| 3 | Wave consistency              | WARN   |
| 4 | Island detection              | PASS   |
| 5 | Completeness                  | PASS   |

**Overall: PASS** (1 warning)
```

**Result values:**
- **PASS** — No issues found for this check.
- **WARN** — Non-blocking issues found. The swarm can proceed but the plan may have suboptimal structure.
- **FAIL** — Blocking issues found. The dependency graph has structural errors that should be fixed before dispatch.

**Overall status logic:**
- **PASS** — All checks passed (no WARN or FAIL).
- **WARN** — One or more checks produced warnings, but no failures.
- **FAIL** — One or more checks failed. List all failure details below the table.

If any checks produced WARN or FAIL results, list the detail messages below the summary table grouped by check number:

```markdown
### Warnings

**Check 3 — Wave consistency:**
- Task 2.3 (Wave 2) depends on task 2.1 (Wave 2) — expected dep wave < task wave

### Failures

**Check 2 — Broken references:**
- Task 3.1 depends on 2.7 which does not exist
```
