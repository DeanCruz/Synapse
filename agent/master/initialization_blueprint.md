# initialization.json Blueprint

**Authoritative schema + worked examples for the master agent.** Read this before writing `initialization.json`. The schema hook (`.claude/hooks/validate-initialization-schema.sh`) enforces the rules below — a write that violates any rule is blocked with a detailed reason.

The dashboard merges `initialization.json` (static plan) with progress files (dynamic lifecycle). If the plan is malformed, the UI may render wave headers with **no task cards** — users see an empty swarm that is in fact running correctly but cannot be displayed. This document exists to eliminate that class of bug.

---

## Write Context

Location: `{tracker_root}/dashboards/{assigned_dashboard_id}/initialization.json`

- `{assigned_dashboard_id}` comes from your `DASHBOARD ID:` directive or `SYNAPSE_DASHBOARD_ID` env var. **Never invent or scan for a dashboard.** If you have no assignment, stop and ask the user.
- Always write the full file atomically (read-parse-modify-stringify-write). A partial/invalid write silently stops all dashboard updates.
- 2-space indent.

---

## Full Schema

```jsonc
{
  "task": {
    "name":         "<kebab-case-slug>",       // REQUIRED. lowercase letters/digits/hyphens only
    "type":         "Waves" | "Chains",         // REQUIRED. exact string match
    "directory":    "<display path>",           // OPTIONAL. shown in header
    "prompt":       "<verbatim user prompt>",   // OPTIONAL but recommended
    "project":      "<project name>",           // OPTIONAL
    "project_root": "<absolute path>",          // OPTIONAL but recommended
    "created":      "<ISO 8601 timestamp>",     // REQUIRED. immutable — never rewrite
    "total_tasks":  <positive integer>,         // REQUIRED. must equal agents.length
    "total_waves":  <positive integer>          // REQUIRED. must equal waves.length
  },
  "agents": [                                   // REQUIRED. length >= 1
    {
      "id":         "<wave>.<index>",           // REQUIRED. e.g. "1.1", "2.3", or "2.1r" for repair tasks
      "title":      "<short verb phrase>",      // REQUIRED. ~40 chars
      "wave":       <integer>,                  // REQUIRED. must match a waves[j].id
      "layer":      "<category>",               // OPTIONAL. e.g. "frontend", "backend", "tests"
      "directory":  "<path>",                   // OPTIONAL. shown as blue badge
      "depends_on": [ "<agent id>", ... ]       // REQUIRED (use [] for roots). Every entry MUST reference an existing agents[].id
    }
  ],
  "waves": [                                    // REQUIRED. length >= 1 even in Chains mode
    {
      "id":    <integer>,                       // REQUIRED. referenced by agents[].wave
      "name":  "<descriptive name>",            // REQUIRED. UI prepends "Wave {id}: " automatically
      "total": <integer>                        // REQUIRED. count of agents in this wave. sum(waves[].total) == agents.length
    }
  ],
  "chains": [                                   // REQUIRED when task.type == "Chains", else []
    {
      "id":    <integer>,                       // REQUIRED. row order
      "name":  "<descriptive>",                 // REQUIRED
      "tasks": [ "<agent id>", ... ]            // REQUIRED. Every agent MUST appear in exactly one chain's tasks[]
    }
  ],
  "history": []                                 // Populated by archive-move, not at creation. [] is fine.
}
```

---

## Minimum Viable Write (Waves, 2 tasks, 1 wave)

```json
{
  "task": {
    "name": "add-health-endpoint",
    "type": "Waves",
    "created": "2026-04-18T17:00:00Z",
    "total_tasks": 2,
    "total_waves": 1
  },
  "agents": [
    { "id": "1.1", "title": "Write /health handler", "wave": 1, "depends_on": [] },
    { "id": "1.2", "title": "Register route + test", "wave": 1, "depends_on": ["1.1"] }
  ],
  "waves": [
    { "id": 1, "name": "Implementation", "total": 2 }
  ],
  "chains": [],
  "history": []
}
```

---

## Full Waves Example (3 waves, 8 tasks, layered)

```json
{
  "task": {
    "name": "refactor-auth-middleware",
    "type": "Waves",
    "directory": "src/api",
    "prompt": "Rewrite auth middleware to use async session lookup and add rate limiting.",
    "project": "api-server",
    "project_root": "/Users/me/projects/api-server",
    "created": "2026-04-18T17:00:00Z",
    "total_tasks": 8,
    "total_waves": 3
  },
  "agents": [
    { "id": "1.1", "title": "Add session store interface", "wave": 1, "layer": "backend",  "directory": "src/api/auth",       "depends_on": [] },
    { "id": "1.2", "title": "Stub in-memory adapter",      "wave": 1, "layer": "backend",  "directory": "src/api/auth",       "depends_on": [] },
    { "id": "1.3", "title": "Add rate-limit config schema", "wave": 1, "layer": "config",   "directory": "src/config",         "depends_on": [] },

    { "id": "2.1", "title": "Implement async middleware",   "wave": 2, "layer": "backend",  "directory": "src/api/auth",       "depends_on": ["1.1", "1.2"] },
    { "id": "2.2", "title": "Wire rate limiter",            "wave": 2, "layer": "backend",  "directory": "src/api/middleware", "depends_on": ["1.3"] },
    { "id": "2.3", "title": "Update route registration",    "wave": 2, "layer": "backend",  "directory": "src/api/routes",     "depends_on": ["1.1"] },

    { "id": "3.1", "title": "Integration tests",            "wave": 3, "layer": "tests",    "directory": "test/integration",   "depends_on": ["2.1", "2.2", "2.3"] },
    { "id": "3.2", "title": "Update docs",                  "wave": 3, "layer": "docs",     "directory": "docs",               "depends_on": ["2.1", "2.2"] }
  ],
  "waves": [
    { "id": 1, "name": "Foundation",       "total": 3 },
    { "id": 2, "name": "Implementation",   "total": 3 },
    { "id": 3, "name": "Verify & Document","total": 2 }
  ],
  "chains": [],
  "history": []
}
```

---

## Full Chains Example (3 chains, 6 tasks)

```json
{
  "task": {
    "name": "three-platform-release",
    "type": "Chains",
    "created": "2026-04-18T17:00:00Z",
    "total_tasks": 6,
    "total_waves": 1
  },
  "agents": [
    { "id": "1.1", "title": "iOS build",    "wave": 1, "layer": "mobile", "depends_on": [] },
    { "id": "1.2", "title": "iOS publish",  "wave": 1, "layer": "mobile", "depends_on": ["1.1"] },
    { "id": "1.3", "title": "Android build","wave": 1, "layer": "mobile", "depends_on": [] },
    { "id": "1.4", "title": "Android publish","wave": 1, "layer": "mobile","depends_on": ["1.3"] },
    { "id": "1.5", "title": "Web build",    "wave": 1, "layer": "web",    "depends_on": [] },
    { "id": "1.6", "title": "Web publish",  "wave": 1, "layer": "web",    "depends_on": ["1.5"] }
  ],
  "waves": [
    { "id": 1, "name": "Release", "total": 6 }
  ],
  "chains": [
    { "id": 1, "name": "iOS",     "tasks": ["1.1", "1.2"] },
    { "id": 2, "name": "Android", "tasks": ["1.3", "1.4"] },
    { "id": 3, "name": "Web",     "tasks": ["1.5", "1.6"] }
  ],
  "history": []
}
```

---

## Pre-Write Checklist (run mentally before Write)

Run every item. A single violation will block the write.

1. `task.name` is kebab-case? (lowercase letters/digits/hyphens, starts with alphanum)
2. `task.type` is exactly `"Waves"` or `"Chains"`?
3. `task.created` is an ISO 8601 timestamp?
4. `task.total_tasks == agents.length`?
5. `task.total_waves == waves.length`?
6. `agents.length >= 1` and `waves.length >= 1`?
7. Every `agents[i].id` matches `^\d+\.\d+r?$` (e.g. `"1.1"`, `"2.3"`, `"2.1r"`)?
8. Every `agents[i].id` is unique?
9. Every `agents[i].wave` matches some `waves[j].id`?
10. Every `agents[i].depends_on[k]` references an existing `agents[].id`?
11. `sum(waves[].total) == agents.length`?
12. If `task.type == "Chains"`: `chains.length >= 1`, every agent appears in exactly one chain's `tasks[]`, no duplicates across chains?
13. You are writing to `{tracker_root}/dashboards/{your_assigned_id}/initialization.json` — not a made-up path, not the `ide` dashboard?

---

## Failure Modes Mapped to Symptoms

| Violation | UI symptom |
|---|---|
| `agents[]` empty but `waves[]` populated | Wave headers render with zero task cards underneath — the "waves visible but no cards" bug |
| `agents[i].wave` references a non-existent `waves[j].id` | Dependency lines render wrong or cards appear disconnected; wave grouping may silently drop cards |
| `agents[i].depends_on` references a non-existent agent | Dispatch readiness calculation is unstable; downstream task may never dispatch |
| Duplicate `agents[i].id` | Merge with progress files is ambiguous — one agent's progress may overwrite another's card state |
| `task.total_tasks` ≠ `agents.length` | Stats bar reports wrong completion counts ("3/5 done" when only 3 tasks exist) |
| Missing `task.created` | Dashboard cannot compute elapsed time or order swarms in history |
| Invalid JSON (missing comma, trailing comma, unescaped quote) | Server drops the file silently — dashboard freezes at last valid state until corrected |
| Writing to wrong dashboard directory | Swarm runs but the user's open dashboard panel stays empty — they see no progress despite workers executing |

---

## Escape Hatch

If you need to write a scratch/non-standard `initialization.json` outside a real swarm, set `SYNAPSE_SKIP_SCHEMA=1` in the environment before the write. Use sparingly — this bypasses all schema validation.

---

## Related

- [agent/master/dashboard_writes.md](./dashboard_writes.md) — Full data-protocol reference (all master-written files)
- [agent/instructions/dashboard_resolution.md](../instructions/dashboard_resolution.md) — How to resolve your assigned dashboard
- [.claude/hooks/validate-initialization-schema.sh](../../.claude/hooks/validate-initialization-schema.sh) — The hook that enforces this blueprint
