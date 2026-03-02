# !env_check — Environment Variable Consistency Audit

## Overview

Verifies that all environment variables referenced in code across every repo actually exist in the corresponding `.env` files, and that shared config values (like Firebase project IDs) match across repos.

---

## Usage

```
!env_check           ← Full audit across all repos
!env_check firebase  ← Check only Firebase-related env vars
```

---

## Execution Steps

### Step 1: Find All Env Var References in Code

Search across all repos for environment variable access patterns:

- `process.env.{VAR}` (Node.js)
- `import.meta.env.{VAR}` (Vite)
- `NEXT_PUBLIC_{VAR}` / `process.env.NEXT_PUBLIC_{VAR}` (Next.js)
- `Deno.env.get("{VAR}")` (Deno)
- `os.environ["{VAR}"]` / `os.getenv("{VAR}")` (Python)
- `defineString("{VAR}")` / `defineInt("{VAR}")` (Firebase Functions config)
- Any config files that reference `${VAR}` or `$VAR`

Record each variable name, the file it's referenced in, and how it's used.

### Step 2: Find All Env Files

Locate all environment files across repos:
- `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.example`, `.env.template`
- `firebase.json`, `firebaseConfig` objects
- Any config files that set environment values

**Do NOT read or output the actual values** — only check for key existence and flag mismatches.

### Step 3: Cross-Reference

For each env var referenced in code:
1. Does it exist in the corresponding `.env` file?
2. If it's shared across repos (e.g., Firebase project ID), is the key name consistent?
3. Does an `.env.example` or `.env.template` document it?

### Step 4: Report

```
## Environment Variable Audit

### Summary
- **Variables referenced in code:** {N}
- **Present in .env:** {N}
- **Missing from .env:** {N}
- **Missing from .env.example:** {N}
- **Cross-repo shared vars:** {N}

### Missing Variables

| Variable | Referenced In | Expected .env File | Status |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `backend/src/payments.ts:12` | `backend/.env` | MISSING |
| `NEXT_PUBLIC_API_URL` | `frontend/src/api/client.ts:3` | `frontend/.env.local` | MISSING |

### Cross-Repo Consistency

| Shared Config | Repos | Status |
|---|---|---|
| Firebase Project ID | frontend, backend | ✓ Both use `FIREBASE_PROJECT_ID` |
| API Base URL | frontend, backend | ⚠ Frontend uses `NEXT_PUBLIC_API_URL`, backend uses `API_BASE_URL` — verify values match |

### Undocumented Variables

Variables present in `.env` but not in `.env.example`:
- `backend/.env`: `SENDGRID_API_KEY`, `REDIS_URL`

### Recommendations
- {Add missing vars to .env.example for team documentation}
- {Standardize key names across repos where possible}
```

---

## Rules

- **NEVER output env var values.** Only report key names, existence, and consistency.
- **Do not modify .env files.** Report only. The user manages secrets.
- **Check .env.example completeness.** Every var in code should have a documented template entry.
- **Run in serial mode.**
