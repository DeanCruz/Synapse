# !health — Workspace Health Check

## Overview

Performs a comprehensive audit of workspace health — checking for missing docs, stale indexes, broken imports, inconsistent types, uncommitted changes, and configuration problems across all repos.

---

## Usage

```
!health               ← Full health check
!health --quick       ← Fast check (skip cross-repo analysis)
```

---

## Execution Steps

### Step 1: Documentation Health

For each child repo, check:
- [ ] `CLAUDE.md` exists and is non-empty
- [ ] `CLAUDE.md` covers: tech stack, architecture, conventions, file structure
- [ ] `_commands/` directory exists (note if absent, not necessarily an error)

For the workspace:
- [ ] `TableOfContentsMaster.md` exists and is non-empty
- [ ] `TableOfContentsMaster.md` lists all child repos that actually exist on disk
- [ ] No repos on disk are missing from `TableOfContentsMaster.md`
- [ ] No repos in `TableOfContentsMaster.md` are missing from disk

### Step 2: Dependency Health

For each repo with a `package.json`:
- [ ] Check if `node_modules/` exists (have dependencies been installed?)
- [ ] Check for outdated or missing lock file

### Step 3: Cross-Repo Health (skip if `--quick`)

- [ ] Check that API endpoints referenced in frontend exist in backend
- [ ] Check for `.env.example` completeness in each repo

### Step 4: Report

```
## Workspace Health Report

### Overall: {🟢 Healthy / 🟡 Warnings / 🔴 Issues Found}

### Documentation
| Repo | CLAUDE.md | Commands | In TOC |
|---|---|---|---|
| {repo} | ✓ | {N} commands | ✓ |
| {repo} | ✗ MISSING | — | ✗ MISSING |

### Git Status
| Repo | Branch | Uncommitted | Unpushed | Conflicts |
|---|---|---|---|---|
| {repo} | main | 3 files | 0 | None |
| {repo} | feature/x | 0 files | 2 commits | None |

### Dependencies
| Repo | node_modules | Lock File |
|---|---|---|
| {repo} | ✓ | ✓ package-lock.json |
| {repo} | ✗ NOT INSTALLED | ✓ |

### Cross-Repo Issues
- ⚠ Type `UserProfile` has drifted between frontend and backend
- ⚠ Frontend references endpoint `POST /api/events` — no backend handler found
- ✗ `{repo}` exists on disk but is not in `TableOfContentsMaster.md`

### Recommendations
1. {Most important fix}
2. {Second most important}
3. {Third}
```

---

## Rules

- **Do not modify any files.** Report only.
- **Be thorough but fast.** Check everything but don't deep-read files unnecessarily. Use Glob/Grep for quick checks.
- **Prioritize findings.** Critical issues (missing CLAUDE.md, broken imports, merge conflicts) first. Minor warnings (stale TOC, missing .env.example) last.
- **Run in serial mode.**
