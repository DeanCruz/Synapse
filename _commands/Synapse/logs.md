# `!logs [dashboardId] {filter}`

**Purpose:** Display log entries from the dashboard's event log in the terminal. Supports filtering by level, task ID, or agent.

**Syntax:**
- `!logs` — Show all log entries (auto-detect dashboard)
- `!logs a3f7k2` — Show logs for a specific hex dashboard
- `!logs dashboard2` — Show logs for a specific dashboard
- `!logs --level error` — Show only error entries
- `!logs --level warn` — Show only warn entries
- `!logs --task 2.3` — Show logs for a specific task
- `!logs --agent "Agent 5"` — Show logs for a specific agent
- `!logs --last 20` — Show only the last 20 entries
- `!logs --since 14:30` — Show entries after a specific time

Filters can be combined: `!logs --level error --last 10`

> **Dashboard resolution:** See `{tracker_root}/agent/instructions/dashboard_resolution.md` for how `{dashboardId}` is determined when not explicitly specified.

---

## Steps

1. **Parse the optional `{dashboardId}` argument.** If the first argument is a valid dashboard ID (any non-flag string that is not a task ID, including 6-char hex IDs like `a3f7k2`, `ide`, and legacy `dashboardN`), use it. Otherwise, run `detectDashboard()` per `dashboard_resolution.md`.

2. **Read `{tracker_root}/dashboards/{dashboardId}/logs.json`.** Parse the `entries` array.

3. **Apply filters** (if any):
   - `--level {level}` → filter where `entry.level === level`
   - `--task {id}` → filter where `entry.task_id === id`
   - `--agent {name}` → filter where `entry.agent === name`
   - `--last {N}` → take only the last N entries (after other filters)
   - `--since {HH:MM}` → filter where timestamp is after the given time today

4. **Display results:**

```markdown
### Logs — {dashboardId} ({count} entries{filter description})

| Time | Task | Agent | Level | Message |
|---|---|---|---|---|
| 14:32:01 | 0.0 | Orchestrator | info | Task initialized: 12 tasks... |
| 14:32:02 | 1.1 | Agent 1 | info | Starting: Add auth middleware |
| 14:33:10 | 1.2 | Agent 2 | warn | Missing file: routes/index.ts |
```

5. **If no entries match**, report: "No log entries match the filter."

6. **Summary line:** `"{total} total entries, {info} info, {warn} warn, {error} error"`
