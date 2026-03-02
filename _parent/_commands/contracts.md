# !contracts — API Contract Audit

## Overview

Audits all API contracts between frontend and backend. Lists every endpoint the frontend calls, verifies each has a backend handler, checks that request/response shapes match, and flags orphaned or undocumented endpoints.

---

## Usage

```
!contracts               ← Full audit of all API contracts
!contracts /api/users    ← Audit a specific endpoint group
```

---

## Execution Steps

### Step 1: Find All Frontend API Calls

Search the frontend repo for all outbound API calls:

- `fetch(`, `axios.`, `useSWR(`, `useQuery(` and similar patterns
- API client/wrapper files (often in `api/`, `services/`, or `lib/`)
- GraphQL queries/mutations if applicable

For each call, extract:
- HTTP method (GET, POST, PUT, DELETE, PATCH)
- Endpoint path
- Request body shape / query params
- Expected response type

### Step 2: Find All Backend Route Handlers

Search the backend repo for all route definitions:

- Express/Hono/Fastify route handlers
- Firebase Cloud Functions HTTP triggers (`onRequest`, `onCall`)
- API route files
- Middleware chains applied to each route

For each handler, extract:
- HTTP method
- Endpoint path
- Expected request body / params
- Response shape
- Authentication requirements
- Validation schema

### Step 3: Match and Compare

For each frontend call, find the matching backend handler. Then compare:

1. **Endpoint exists?** Does the backend have a handler for this path + method?
2. **Request shape matches?** Do the fields the frontend sends match what the backend expects?
3. **Response shape matches?** Does the backend return what the frontend expects to receive?
4. **Auth requirements clear?** Does the frontend send auth tokens where the backend requires them?
5. **Error handling?** Does the frontend handle the error codes the backend can return?

### Step 4: Find Orphans

- **Backend endpoints with no frontend caller** — might be unused, or called by external services
- **Frontend calls to endpoints that don't exist** — broken features waiting to happen

### Step 5: Report

```
## API Contract Audit

### Summary
- **Frontend API calls found:** {N}
- **Backend endpoints found:** {N}
- **Matched contracts:** {N}
- **Mismatched contracts:** {N}
- **Orphaned backend endpoints:** {N}
- **Broken frontend calls:** {N}

### Contract Status

| Method | Endpoint | Frontend | Backend | Status |
|---|---|---|---|---|
| POST | /api/auth/login | `src/api/auth.ts:15` | `functions/src/auth/login.ts:8` | ✓ Match |
| GET | /api/users/:id | `src/api/users.ts:22` | `functions/src/users/get.ts:12` | ⚠ Response drift |
| POST | /api/events | `src/api/events.ts:30` | — | ✗ No backend handler |
| DELETE | /api/admin/purge | — | `functions/src/admin/purge.ts:5` | Orphan (no frontend caller) |

### Mismatches

#### GET /api/users/:id — Response Drift
- Frontend expects: `{ id, name, email, avatarUrl }`
- Backend returns: `{ id, name, email, avatar_url, role }`
- Issues: key casing mismatch (`avatarUrl` vs `avatar_url`), missing `role` in frontend type

### Recommendations
- {Fix the response type mismatch on /api/users/:id}
- {Investigate orphaned endpoint /api/admin/purge — remove or document}
- {Add backend handler for POST /api/events or remove frontend call}
```

---

## Rules

- **Do not modify any files.** This command is read-only.
- **Check actual code, not documentation.** Documentation lies. Code is truth.
- **Include auth/middleware context.** An endpoint that requires admin auth should be flagged if the frontend doesn't send admin tokens.
- **Run in serial mode.**
