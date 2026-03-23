# Worker Guide — Sibling Communication Protocol

**Who this is for:** Worker agents dispatched during a `!p_track` swarm executing in the same wave as other workers. This document is your complete reference for optional, non-blocking coordination with sibling tasks (tasks in the same wave with no dependency relationship).

---

## Sibling Communication Protocol

Same-wave workers execute in parallel and may benefit from lightweight coordination. The `shared_context` and `sibling_reads` fields in the progress file enable **optional, non-blocking** communication between sibling tasks (tasks in the same wave with no dependency relationship).

---

## Rules

### a. Workers MAY read sibling progress files for coordination.

Your dispatch prompt includes a `SIBLING TASKS` section listing same-wave task IDs. You may read their progress files at `{tracker_root}/dashboards/{dashboardId}/progress/{sibling_task_id}.json` to check for useful context. This is entirely optional.

### b. Workers MUST NOT depend on sibling data.

Sibling communication is **supplementary, not required**. Your task must be completable without any sibling data. If a sibling's progress file does not exist yet, is empty, or lacks `shared_context`, proceed without it. Never block or retry waiting for sibling data.

### c. Workers SHOULD populate `shared_context` when creating exports, interfaces, or patterns useful to siblings.

If your task creates public functions, types, interfaces, or establishes patterns that a same-wave sibling might benefit from, populate `shared_context` as early as possible — ideally during the `implementing` stage, as soon as the relevant artifacts are created.

#### `shared_context` Sub-Fields

| Sub-Field | Type | Description |
|---|---|---|
| `exports` | array of strings | Export names (functions, constants, classes) your task creates |
| `interfaces` | array of strings | Interface/type signatures your task defines |
| `patterns` | array of strings | Brief pattern descriptions (e.g., "error handling uses Result<T, E> pattern") |
| `notes` | string | Free-form string with any other context siblings might find useful |

### d. Workers MUST log sibling reads with info-level log entries.

Every time you read a sibling's progress file, add a log entry documenting what you read and whether you found anything useful:

```json
{ "at": "...", "level": "info", "msg": "Read sibling 2.3 progress — found shared_context with UserProfile interface, adapting import" }
```

### e. Workers MUST record sibling reads in the `sibling_reads` array.

Add the task ID string of every sibling progress file you read, regardless of whether it contained useful data:

```json
"sibling_reads": ["2.3", "2.5"]
```

### f. Sibling reads are only useful for same-wave tasks.

Cross-wave coordination uses the formal upstream dependency mechanism (see the **upstream_deps.md** document). Do not use sibling reads for tasks in different waves — those tasks have explicit dependency relationships and the master includes upstream results in your dispatch prompt.

### g. Workers must NEVER write to another worker's progress file.

Each worker owns exactly one file: its own `{task_id}.json`. Reading sibling files is allowed; writing to them is absolutely forbidden. This invariant ensures no write conflicts and no data corruption.

---

## Example: Sibling Communication in Practice

Consider a wave with three parallel tasks:
- **Task 2.1** — Create User model with CRUD operations
- **Task 2.2** — Create Permission model with role-based access
- **Task 2.3** — Create API middleware for request validation

Task 2.3 (middleware) is implementing request validation and wants to know if Task 2.1 has defined a `UserProfile` interface it can validate against. Task 2.3 reads Task 2.1's progress file:

```
{tracker_root}/dashboards/{dashboardId}/progress/2.1.json
```

### Task 2.1's Progress File (written during its `implementing` stage)

```json
{
  "task_id": "2.1",
  "status": "in_progress",
  "stage": "implementing",
  "shared_context": {
    "exports": ["createUser", "getUser", "updateUser", "deleteUser"],
    "interfaces": ["UserProfile { id: string; name: string; email: string; role: Role }"],
    "patterns": ["All CRUD functions return Promise<Result<T, AppError>>"],
    "notes": "Role type imported from permissions module — Task 2.2 may define it"
  }
}
```

### Task 2.3's Updated Progress File (after reading sibling 2.1)

Task 2.3 finds the `UserProfile` interface in `shared_context.interfaces` and uses it to type its validation middleware. It then updates its own progress file:

```json
{
  "task_id": "2.3",
  "status": "in_progress",
  "stage": "implementing",
  "message": "Creating validation middleware — using UserProfile interface from sibling 2.1",
  "sibling_reads": ["2.1"],
  "logs": [
    { "at": "...", "level": "info", "msg": "Read sibling 2.1 progress — found UserProfile interface in shared_context, using for request body validation" }
  ],
  "shared_context": {
    "exports": ["validateRequest", "validateBody", "validateParams"],
    "interfaces": ["ValidationResult { valid: boolean; errors: string[] }"],
    "patterns": ["Middleware returns 400 with ValidationResult on failure"],
    "notes": ""
  }
}
```

### Key Points from This Example

- Task 2.3 did not *need* sibling data — it could have defined its own type or used `any`. The sibling read made the implementation more consistent.
- Task 2.3 logged the sibling read and recorded it in `sibling_reads`.
- Task 2.3 also populated its own `shared_context` so Task 2.1 or 2.2 could benefit if they read it.
- If Task 2.1's progress file had not existed yet (Task 2.1 hadn't started), Task 2.3 would have proceeded without it.
