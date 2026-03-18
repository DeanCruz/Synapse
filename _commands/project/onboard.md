# !onboard — Project Walkthrough

## Overview

Produces a comprehensive orientation of the project — what it does, how it's structured, how to run things, key architectural decisions, and where to find what. Designed for the start of a new session or for onboarding a new contributor.

---

## Usage

```
!onboard              <- Full project walkthrough
!onboard {area}       <- Deep-dive into a specific area (e.g., "api", "frontend", "auth")
```

---

## Execution Steps

### Step 1: Discover the Project

1. List key directories in `{project_root}`
2. Read `{project_root}/.synapse/toc.md` for the semantic overview (if it exists)
3. Read the project's `CLAUDE.md` for architecture and conventions
4. Check for `package.json`, `tsconfig.json`, or similar to identify tech stack
5. Check for `.env.example` files to understand required configuration

### Step 2: Build the Overview

For the full project walkthrough:

```
## Project Overview: {project_name}

### Structure

| Directory / Area | Purpose | Tech Stack |
|---|---|---|
| {dir} | {one-line purpose} | {key technologies} |

### Architecture

{3-5 sentences describing the overall system architecture:}
- What does this project do?
- How are the major components organized?
- What's the data flow from user action to database?
- What external services are used?

### How Things Connect

```
{component_1} --calls--> {component_2}
{component_2} --writes to--> {database}
{component_3} --provides docs for--> developers
```

### Quick Start

**Running the project:**
{Steps to get the project running locally, sourced from CLAUDE.md or package.json}

**Running the dashboard:**
{Steps to start the Synapse dashboard}

### Key Conventions

{Important conventions from the project's CLAUDE.md that a new contributor should know:}
- {Convention 1}
- {Convention 2}
- {Naming patterns, file organization rules, etc.}

### Available Commands

Run `!commands` for the full list. Key commands:
- `!p_track {task}` — Dispatch a parallel agent swarm
- `!context {topic}` — Gather project-wide context
- `!plan {task}` — Plan before coding
- `!health` — Check project health

### Environment Setup

Required environment variables:
{List from .env.example files, without actual values}

### Where to Find Things

| Looking for... | Go to... |
|---|---|
| API endpoints | `{project_root}/src/api/` or similar |
| UI components | `{project_root}/src/components/` or similar |
| Types/Interfaces | `{project_root}/src/types/` or similar |
| Agent commands | `{tracker_root}/_commands/` |
```

### For a Specific Area (`!onboard {area}`)

```
## Deep Dive: {area}

### Purpose
{Detailed description of this area's role in the project}

### Tech Stack
{Languages, frameworks, key dependencies relevant to this area}

### Architecture
{Internal architecture — patterns, layers, key abstractions}

### Directory Structure
{Key directories with descriptions}

### Key Files
{Entry points, config files, architectural backbones}

### Conventions
{Conventions relevant to this area}

### How It Connects to Other Areas
{Relationships between this area and the rest of the project}
```

---

## Rules

- **Do not modify any files.** This is read-only.
- **Source everything from actual files.** Don't invent setup steps — read them from `CLAUDE.md`, `package.json`, `README.md`, etc.
- **Keep it actionable.** A new contributor should be able to start working after reading this.
- **Run in serial mode.**
