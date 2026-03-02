# !onboard — Workspace Walkthrough

## Overview

Produces a comprehensive orientation of the entire workspace — what each repo does, how they connect, how to run things, key architectural decisions, and where to find what. Designed for the start of a new session or for onboarding a new contributor.

---

## Usage

```
!onboard              ← Full workspace walkthrough
!onboard {repo_name}  ← Deep-dive into a specific repo
```

---

## Execution Steps

### Step 1: Discover the Workspace

1. List all child directories in `{parent_directory}`
2. Read `TableOfContentsMaster.md` for the semantic overview
3. Read each repo's `CLAUDE.md` for architecture and conventions
4. Check for `package.json`, `tsconfig.json`, or similar to identify tech stacks
5. Check for `.env.example` files to understand required configuration

### Step 2: Build the Overview

For the full workspace walkthrough:

```
## Workspace Overview: {parent_directory_name}

### Repositories

| Repo | Purpose | Tech Stack | Has CLAUDE.md | Has Commands |
|---|---|---|---|---|
| {repo} | {one-line purpose} | {key technologies} | ✓/✗ | {N} commands |

### Architecture

{3-5 sentences describing the overall system architecture:}
- What does this workspace build?
- How do the repos relate to each other?
- What's the data flow from user action to database?
- What external services are used?

### How Things Connect

```
{repo_1} ──API calls──→ {repo_2}
{repo_2} ──Firestore triggers──→ {repo_3}
{repo_4} ──provides docs for──→ all repos
```

### Quick Start

**Running the frontend:**
{Steps to get the frontend running locally, sourced from its CLAUDE.md or package.json}

**Running the backend:**
{Steps to get the backend running locally}

**Running the dashboard:**
{Steps to start the Synapse dashboard}

### Key Conventions

{Important conventions from child CLAUDE.md files that a new contributor should know:}
- {Convention 1 from repo A}
- {Convention 2 from repo B}
- {Naming patterns, file organization rules, etc.}

### Available Commands

Run `!commands` for the full list. Key commands:
- `!p_track {task}` — Dispatch a parallel agent swarm
- `!context {topic}` — Gather cross-repo context
- `!plan {task}` — Plan before coding
- `!health` — Check workspace health

### Environment Setup

Required environment variables across repos:
{List from .env.example files, without actual values}

### Where to Find Things

| Looking for... | Go to... |
|---|---|
| API endpoints | `{backend_repo}/functions/src/` |
| UI components | `{frontend_repo}/src/components/` |
| Shared types | `{repo}/src/types/` |
| Documentation | `{knowledge_base}/` |
| Agent commands | `Synapse/_commands/` |
```

### For a Specific Repo (`!onboard {repo_name}`)

```
## Deep Dive: {repo_name}

### Purpose
{Detailed description from its CLAUDE.md}

### Tech Stack
{Languages, frameworks, key dependencies}

### Architecture
{Internal architecture — patterns, layers, key abstractions}

### Directory Structure
{Key directories with descriptions}

### Key Files
{Entry points, config files, architectural backbones}

### Conventions
{All conventions from its CLAUDE.md}

### Available Commands
{Commands from its _commands/ directory}

### How It Connects to Other Repos
{Cross-repo relationships involving this repo}
```

---

## Rules

- **Do not modify any files.** This is read-only.
- **Source everything from actual files.** Don't invent setup steps — read them from `CLAUDE.md`, `package.json`, `README.md`, etc.
- **Keep it actionable.** A new contributor should be able to start working after reading this.
- **Run in serial mode.**
