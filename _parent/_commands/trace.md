# !trace {target} — End-to-End Cross-Repo Trace

## Overview

Traces a specific API endpoint, function, type, or data flow across the entire workspace, from origin to destination. Outputs a linear chain showing every file and transformation the target passes through.

---

## Usage

```
!trace POST /api/users
!trace getUserProfile
!trace UserProfile type
!trace "user submits signup form"
```

The `{target}` can be an endpoint, function name, type name, or a natural language description of a flow.

---

## Execution Steps

### Step 1: Identify the Target Type

Determine what kind of trace this is:

| Target Type | Example | Trace Strategy |
|---|---|---|
| **API endpoint** | `POST /api/users` | Frontend call site → route → middleware → handler → database → response |
| **Function** | `getUserProfile` | Definition → all call sites → what calls those → up the chain |
| **Type/Interface** | `UserProfile` | Definition (source of truth) → all consumers → all transformations |
| **Data flow** | "user submits form" | UI component → form handler → API call → backend → database → any triggers |

### Step 2: Find the Origin

Search for the target across all repos:

1. **Grep for the exact term** (function name, endpoint path, type name)
2. **Find the definition** — where is it originally defined/declared?
3. **Find all references** — where is it imported, called, or consumed?

### Step 3: Walk the Chain

Starting from the origin, trace forward through every step:

- Read each file in the chain
- Follow imports, function calls, API requests, and event emissions
- Cross repo boundaries (frontend → backend, backend → database, etc.)
- Note every transformation, validation, or side effect along the way

### Step 4: Output the Trace

```
## Trace: {target}

### Chain

1. **[my-frontend]** `src/components/UserForm.tsx:45`
   → User clicks submit → calls `createUser()` from `src/api/users.ts`

2. **[my-frontend]** `src/api/users.ts:12`
   → `POST /api/users` with `{ email, name, password }` body

3. **[my-backend]** `src/routes/users.ts:28`
   → Route handler validates input with `UserCreateSchema`

4. **[my-backend]** `src/services/userService.ts:55`
   → Creates user record → writes to database `users/{uid}`

5. **[my-backend]** `src/triggers/onUserCreate.ts:10`
   → Database trigger sends welcome email, creates default settings

### Type Flow

- `UserCreateRequest` defined in `my-backend/types/user.ts:8` → used by frontend as `CreateUserPayload` in `my-frontend/src/types/api.ts:22`
- **Drift detected:** Frontend type has optional `phone` field not present in backend type

### Notes

- {Any observations: missing error handling, type mismatches, undocumented side effects, etc.}
```

---

## Rules

- **Do not modify any files.** This command is read-only.
- **Follow the chain completely.** Don't stop at repo boundaries — the whole point is cross-repo tracing.
- **Flag inconsistencies.** Type mismatches, missing error handling, undocumented side effects — call them out.
- **Run in serial mode.** This is a read-only investigation.
