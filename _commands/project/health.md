# !health — Project Health Check

## Overview

Performs a comprehensive audit of project health — checking for missing docs, stale indexes, broken imports, inconsistent types, uncommitted changes, and configuration problems.

---

## Usage

```
!health               <- Full health check
!health --quick       <- Fast check (skip deep analysis)
```

---

## Execution Steps

### Step 1: Documentation Health

For the project, check:
- [ ] `CLAUDE.md` exists at `{project_root}` and is non-empty
- [ ] `CLAUDE.md` covers: tech stack, architecture, conventions, file structure
- [ ] `_commands/` directory exists (note if absent, not necessarily an error)

For the table of contents:
- [ ] `{project_root}/.synapse/toc.md` exists and is non-empty
- [ ] `{project_root}/.synapse/toc.md` lists key directories and files that actually exist on disk
- [ ] No significant directories on disk are missing from the TOC
- [ ] No entries in the TOC point to paths that no longer exist

### Step 2: Dependency Health

If the project has a `package.json`:
- [ ] Check if `node_modules/` exists (have dependencies been installed?)
- [ ] Check for outdated or missing lock file

Check for other dependency manifests (`requirements.txt`, `go.mod`, `Cargo.toml`, etc.) and verify their health similarly.

### Step 3: Cross-Layer Health (skip if `--quick`)

- [ ] Check that API endpoints referenced in frontend code exist in backend code
- [ ] Check for `.env.example` completeness
- [ ] Check for type consistency across layers (frontend types match backend contracts)

### Step 4: Report

```
## Project Health Report

### Overall: {Healthy / Warnings / Issues Found}

### Documentation
| Item | Status |
|---|---|
| CLAUDE.md | {present/missing} |
| TOC ({project_root}/.synapse/toc.md) | {present/missing/stale} |
| Commands | {N} commands found |

### Git Status
| Branch | Uncommitted | Unpushed | Conflicts |
|---|---|---|---|
| {branch} | {N} files | {N} commits | {None/Yes} |

### Dependencies
| Manager | Installed | Lock File |
|---|---|---|
| npm | {yes/no} | {present/missing} |

### Cross-Layer Issues
- {Type `UserProfile` has drifted between frontend and backend}
- {Frontend references endpoint `POST /api/events` — no backend handler found}
- {Entry in TOC points to path that no longer exists}

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
