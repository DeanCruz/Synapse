# Worker Agent — Return Format

When a worker agent completes (or fails) its task, it must return a structured summary to the master agent. This return format is what the master reads to assess task outcome, log results, and construct upstream context for downstream workers.

---

## Return Format Template

Every worker agent must return this exact structure when completing a task:

```
STATUS: completed | failed
SUMMARY: {one-line description of what was accomplished or why it failed}
FILES CHANGED: {list of files created, modified, or deleted}
EXPORTS: {list of new public exports — omit section entirely if none}
WARNINGS: {optional — any non-blocking issues the master should know about}
ERRORS: {if failed — what went wrong and why}
DIVERGENT ACTIONS: {any deviations from the original plan}
```

### Field Descriptions

| Field | Required | Description |
|---|---|---|
| `STATUS` | Always | Either `completed` or `failed`. Use `completed` even for partial completion (80%+ done). |
| `SUMMARY` | Always | One-line description. Be specific: "Created auth middleware with rate limiting — 3 endpoints" not "Done". |
| `FILES CHANGED` | Always | List every file created, modified, or deleted. One per line, with action prefix (`created`, `modified`, `deleted`). |
| `EXPORTS` | Only if new exports exist | New public functions, types, interfaces, endpoints, constants, or files that downstream tasks may depend on. |
| `WARNINGS` | Optional | Non-blocking issues, unexpected findings, or things the master should review. |
| `ERRORS` | Only if failed | What went wrong, what was attempted, and why recovery was not possible. |
| `DIVERGENT ACTIONS` | Only if deviations occurred | Any divergence from the planned task — different approach, extra files, skipped steps, changed scope. |

### Good vs Bad Summaries

The `SUMMARY` field is the single most important piece of your return. The master agent uses it to log completion, report to the user, and construct upstream context for downstream workers. A bad summary forces the master to re-read your progress file to understand what happened.

**Good summaries are specific, quantified, and action-oriented:**
- "Created auth middleware with rate limiting — 3 endpoints protected, tests added"
- "Refactored UserService to async/await pattern — 12 methods converted, 0 test failures"
- "Created 3/4 API endpoints — /users/delete blocked by missing soft-delete migration"
- "Fixed pagination off-by-one in ProductList — was returning N+1 items per page"

**Bad summaries are vague, generic, or uninformative:**
- "Done"
- "Task completed"
- "Made the changes"
- "Updated the files"
- "Implemented the feature"

The test: could someone understand what was accomplished from your summary alone, without reading any other context? If not, rewrite it.

---

## EXPORTS Field

When your task introduces new public functions, types, interfaces, endpoints, constants, or files that downstream tasks may depend on, include an `EXPORTS:` section in your return format between `FILES CHANGED:` and `DIVERGENT ACTIONS:`.

### What Qualifies as an Export

- New public functions, methods, or classes
- New TypeScript/JSDoc types or interfaces
- New API endpoints or routes
- New constants or configuration values
- New files that other tasks will import from

### Format

```
EXPORTS:
  - {type: function|type|interface|endpoint|constant|file} {name} — {brief description}
```

### Examples

```
EXPORTS:
  - function validateAuthToken — validates JWT and returns decoded payload
  - type UserProfile — user profile interface with avatar, bio, settings fields
  - endpoint POST /api/auth/refresh — refreshes expired access tokens
  - constant MAX_RETRY_COUNT — maximum retry attempts for failed API calls
  - file src/utils/sanitize.ts — input sanitization utilities
```

### Rules for EXPORTS

- Omit the EXPORTS section entirely if no new exports were introduced
- Only include exports that downstream tasks might need — internal helpers don't qualify
- The master uses EXPORTS to construct the UPSTREAM RESULTS section of downstream worker prompts

---

## Complete Return Examples

### Successful completion with exports

```
STATUS: completed
SUMMARY: Created User model with full CRUD operations and validation
FILES CHANGED:
  - created src/models/User.ts
  - created src/models/__tests__/User.test.ts
  - modified src/models/index.ts (added User export)
EXPORTS:
  - function createUser — creates a new user with validation
  - function getUser — retrieves user by ID
  - function updateUser — updates user fields with partial input
  - function deleteUser — soft-deletes user by setting deletedAt
  - type UserProfile — { id: string; name: string; email: string; role: Role }
  - interface CreateUserInput — { name: string; email: string; password: string }
DIVERGENT ACTIONS:
  - Added soft-delete instead of hard delete — existing model pattern requires deletedAt field (severity: MODERATE)
```

### Successful completion without exports

```
STATUS: completed
SUMMARY: Updated dashboard CSS to support dark mode toggle — 14 color variables converted
FILES CHANGED:
  - modified src/ui/styles/theme.css (added dark mode variables)
  - modified src/ui/styles/dashboard.css (converted hardcoded colors to variables)
  - modified src/ui/styles/cards.css (converted hardcoded colors to variables)
```

### Partial completion

```
STATUS: completed
SUMMARY: Created 3/4 API endpoints — /users/delete blocked by missing soft-delete migration
FILES CHANGED:
  - created src/routes/users/create.ts
  - created src/routes/users/read.ts
  - created src/routes/users/update.ts
  - modified src/routes/index.ts (added 3 user routes)
EXPORTS:
  - endpoint POST /api/users — creates a new user
  - endpoint GET /api/users/:id — retrieves user by ID
  - endpoint PATCH /api/users/:id — updates user fields
WARNINGS: /users/delete endpoint not created — requires soft-delete migration that does not exist yet
DIVERGENT ACTIONS:
  - Skipped DELETE endpoint — soft-delete migration not available, would require schema change outside task scope (severity: MODERATE)
```

### Failed task

```
STATUS: failed
SUMMARY: Cannot create auth middleware — express package not installed and no package.json found
FILES CHANGED: (none)
ERRORS: Task requires express middleware pattern but the project has no express dependency. Checked package.json — file does not exist. Checked node_modules — directory does not exist. Cannot proceed without the express framework.
```
