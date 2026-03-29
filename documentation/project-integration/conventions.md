# CLAUDE.md and .synapse/ Directory Conventions

Synapse uses two project-level artifacts to understand and work with a target project: the **CLAUDE.md** file (project conventions and architecture) and the **`.synapse/` directory** (Synapse-specific metadata). This document covers what each contains, how they are created, and best practices for maintaining them.

---

## CLAUDE.md -- Project Convention File

### Purpose

`CLAUDE.md` is the authoritative reference for how a project is structured, what conventions it follows, and what patterns agents should use when writing code. The master agent reads it before every swarm to understand the project. Relevant sections are included in worker prompts so agents produce code that fits the existing codebase.

A thorough `CLAUDE.md` is the single most impactful thing you can do to improve swarm quality. Without it, agents make assumptions. With it, they follow your conventions.

### Location

```
{project_root}/CLAUDE.md
```

This is the project's own convention file, separate from Synapse's `CLAUDE.md` at `{tracker_root}/CLAUDE.md`. Projects may already have one if they use Claude Code or other AI-assisted tools.

### Recommended Structure

A well-written `CLAUDE.md` includes these sections:

```markdown
# {project_name}

> {One-line purpose statement}

## Tech Stack
- **Language:** TypeScript 5.x
- **Framework:** Next.js 14 (App Router)
- **Database:** PostgreSQL via Prisma ORM
- **Key Libraries:** Tailwind CSS, React Query, Zod

## Architecture
{2-4 paragraphs describing the architecture}
- What patterns does the codebase use? (MVC, services layer, repository pattern, etc.)
- How do the layers interact? (API routes call services, services call repositories, etc.)
- What are the key abstractions? (Service classes, custom hooks, middleware chain, etc.)
- How does data flow through the system?

## File Structure
project/
├── src/
│   ├── app/            # Next.js App Router pages and layouts
│   ├── components/     # React components (organized by feature)
│   ├── services/       # Business logic layer
│   ├── models/         # Data models and types
│   ├── hooks/          # Custom React hooks
│   └── utils/          # Shared utility functions
├── prisma/             # Database schema and migrations
└── config/             # Configuration files

## Conventions

### Naming
- Files: kebab-case for utilities, PascalCase for components
- Variables: camelCase
- Constants: UPPER_SNAKE_CASE
- Types/Interfaces: PascalCase with I-prefix for interfaces

### Imports
- Use @/ path alias for src/ imports
- Group imports: external, internal, relative, types

### Components
- Functional components only
- Props interface defined above component
- Use composition over inheritance

### Error Handling
- Services throw typed errors (AppError class)
- API routes catch and transform to HTTP responses
- Client-side errors handled by error boundaries

### Testing
- Jest for unit tests, Playwright for E2E
- Test files co-located with source: *.test.ts
- Minimum 80% coverage on services layer

## Commands
| Command | Description |
|---|---|
| npm run dev | Start development server |
| npm run build | Production build |
| npm test | Run all tests |
| npm run lint | Run ESLint |
| npm run db:migrate | Run database migrations |

## Environment
Required environment variables:
- DATABASE_URL -- PostgreSQL connection string
- JWT_SECRET -- Secret for token signing
- NEXT_PUBLIC_API_URL -- Public API base URL
```

### What Makes a Good CLAUDE.md

**Specificity matters.** Compare these two entries:

| Weak | Strong |
|---|---|
| "We use TypeScript" | "TypeScript 5.x with strict mode enabled. All files use `.ts`/`.tsx` extensions. No `any` types allowed -- use `unknown` for truly dynamic values." |
| "Components are in src/components" | "React components are organized by feature under `src/components/{feature}/`. Each feature folder contains its components, hooks, styles, and tests. Shared components live in `src/components/shared/`." |
| "We have tests" | "Jest with React Testing Library for unit tests. Test files are co-located as `*.test.ts`. Integration tests live in `tests/integration/`. Run `npm test -- --coverage` for coverage report. Target: 80% on services, 60% on components." |

**Patterns over descriptions.** Do not just list what exists -- explain the patterns so agents can create new code that fits:

```markdown
## Services Pattern

Every service follows this pattern:
1. Class-based with static methods (no instantiation)
2. Methods are async and return typed results
3. Error handling via AppError class (never raw throws)
4. Logging via the shared logger (never console.log)

Example:
  export class UserService {
    static async getById(id: string): Promise<User> {
      const user = await UserRepository.findById(id);
      if (!user) throw new AppError('USER_NOT_FOUND', 404);
      return user;
    }
  }
```

### Creating CLAUDE.md

#### Automatic Scaffolding

The `!scaffold` command generates a starter `CLAUDE.md` by scanning the project:

```bash
!scaffold
```

It detects the tech stack from config files (`package.json`, `tsconfig.json`, `requirements.txt`, etc.), scans directory structure, reads existing documentation (`README.md`, `CONTRIBUTING.md`), and produces a template with TODO sections for manual review.

```bash
!scaffold --force    # Overwrite an existing CLAUDE.md (requires confirmation)
```

#### Via !initialize

The `!initialize` command includes CLAUDE.md scaffolding as part of full project setup. If a CLAUDE.md already exists, it is left untouched. Use `--skip-claude` to skip scaffolding during initialization.

#### Manual Creation

You can also write CLAUDE.md by hand. Place it at the project root and follow the recommended structure above.

### Rules

- **Synapse never overwrites an existing CLAUDE.md.** The `!scaffold` command only creates new files. Existing files represent manual work by the user and are always respected.
- **CLAUDE.md is committed to version control.** Unlike `.synapse/`, the CLAUDE.md is part of the project and should be versioned with the codebase.
- **Every project should have one.** Synapse works without it, but swarm quality is significantly better with it.

---

## .synapse/ Directory -- Synapse Metadata

### Purpose

The `.synapse/` directory stores Synapse-specific metadata inside the target project. It is the bridge between Synapse and the project it manages. This directory is created during `!initialize` and is maintained by Synapse commands.

### Location

```
{project_root}/.synapse/
```

### Contents

```
.synapse/
├── config.json    # Project-Synapse configuration
├── toc.md         # Table of Contents (semantic file index)
└── knowledge/     # Project Knowledge Index (persistent knowledge layer)
    ├── manifest.json
    ├── annotations/
    ├── domains.json
    ├── patterns.json
    └── queries/
```

### config.json

Links the project to Synapse with detected metadata:

```json
{
  "project_name": "my-app",
  "project_root": "/Users/dean/repos/my-app",
  "tracker_root": "/Users/dean/tools/Synapse",
  "tech_stack": ["typescript", "next.js", "postgresql"],
  "initialized_at": "2026-03-22T10:00:00Z",
  "toc_path": ".synapse/toc.md",
  "monorepo": null
}
```

#### Fields

| Field | Type | Description |
|---|---|---|
| `project_name` | string | Detected project name (from `package.json`, directory name, or manual) |
| `project_root` | string | Absolute path to the project root |
| `tracker_root` | string | Absolute path to the Synapse installation |
| `tech_stack` | string[] | Detected technologies |
| `initialized_at` | ISO 8601 | When `!initialize` was run |
| `toc_path` | string | Relative path to the TOC file |
| `monorepo` | object or null | Monorepo details if detected |

#### Monorepo Configuration

For monorepo projects, the `monorepo` field contains workspace details:

```json
{
  "monorepo": {
    "type": "pnpm",
    "packages": [
      {
        "name": "@myorg/api",
        "path": "packages/api",
        "description": "REST API server"
      },
      {
        "name": "@myorg/web",
        "path": "packages/web",
        "description": "Next.js frontend"
      },
      {
        "name": "@myorg/shared",
        "path": "packages/shared",
        "description": "Shared types and utilities"
      }
    ]
  }
}
```

Detected monorepo types include: `npm_workspaces`, `pnpm`, `lerna`, `nx`, `turbo`, `cargo`, and `go`.

For non-monorepo projects, the field is explicitly `null` (not omitted).

### toc.md

The Table of Contents is a semantic index of every significant file in the project. See the [TOC System](./toc-system.md) documentation for full details on generation, searching, and maintenance.

### knowledge/

The Project Knowledge Index (PKI) stores persistent, auto-accumulating knowledge about the codebase -- gotchas, patterns, conventions, domain taxonomy, and file relationships. Created by `!learn` and incrementally refreshed by `!learn_update`. See the [PKI Overview](./pki-overview.md) documentation for full details.

### Version Control

**The `.synapse/` directory should be added to `.gitignore`.** It contains Synapse-specific metadata that is local to the developer's machine (absolute paths, tool configuration) and should not be committed to the project's repository.

```gitignore
# Synapse metadata
.synapse/
```

**CLAUDE.md should be committed.** Unlike `.synapse/`, the CLAUDE.md file is project documentation that benefits all contributors (human and agent).

### Idempotent Creation

Running `!initialize` on a project that already has `.synapse/` is safe. The command:
- Detects the existing directory and warns
- Does not overwrite existing files (`config.json`, `toc.md`)
- Only creates missing files
- Use `--force` to reinitialize from scratch

---

## Project _commands/ Directory

### Purpose

Projects can define their own custom commands at `{project_root}/_commands/`. These extend Synapse's command system with project-specific workflows.

### Command Resolution Hierarchy

When the user types `!{command}`, Synapse resolves it in this order:

```
1. {tracker_root}/_commands/Synapse/{command}.md     <- Synapse swarm commands (highest)
2. {tracker_root}/_commands/project/{command}.md     <- Synapse project commands
3. {project_root}/_commands/{command}.md             <- Project-specific commands (lowest)
```

Project commands have the lowest priority, meaning they cannot override Synapse's built-in commands. This prevents accidental shadowing of critical swarm operations.

### Creating a Project Command

1. Create the `_commands/` directory in the project root:
   ```bash
   mkdir -p {project_root}/_commands
   ```

2. Write a markdown file for each command:
   ```
   {project_root}/_commands/deploy.md
   {project_root}/_commands/seed.md
   {project_root}/_commands/test-e2e.md
   ```

3. Each command file is a complete specification. When the user types `!deploy`, Synapse reads `deploy.md` in full and follows it exactly.

### Command File Structure

A project command file should include:

```markdown
# !{command_name} -- Brief Description

## Purpose
What this command does and when to use it.

## Syntax
!{command_name} [options]

## Execution Steps
### Step 1: {action}
{details}

### Step 2: {action}
{details}

## Rules
- {constraint}
- {constraint}
```

### Examples

**Deploy command** (`{project_root}/_commands/deploy.md`):
```markdown
# !deploy -- Deploy to Production

## Purpose
Build and deploy the application to the production environment.

## Steps
1. Run npm run build and verify it succeeds.
2. Run npm run test and verify all tests pass.
3. Deploy via npm run deploy:prod.
4. Verify the deployment health check passes.
```

**Database seed command** (`{project_root}/_commands/seed.md`):
```markdown
# !seed -- Seed Development Database

## Purpose
Reset and seed the development database with test data.

## Steps
1. Run npm run db:reset to drop and recreate tables.
2. Run npm run db:seed to populate with test fixtures.
3. Report the number of records created per table.
```

### Duplicate Detection

When creating a new command, Synapse checks all command locations for duplicates before creating anything. If a command with the same name exists at a higher priority level, the user is alerted and asked whether to proceed, rename, or cancel.

---

## Context Gathering Priorities

When the master agent gathers context about a project, it follows these efficiency principles:

### Priority Order

1. **Glob/Grep first for targeted searches.** They cost zero context tokens and return immediate results. Use them before reaching for the TOC.

2. **Project CLAUDE.md for orientation.** Read `{project_root}/CLAUDE.md` before any work in the project. It provides the architectural overview, conventions, and patterns.

3. **Project TOC for semantic discovery.** When filenames do not reveal purpose, or you need to understand how components relate, check `{project_root}/.synapse/toc.md` if one exists.

4. **Read with purpose.** Before reading any file, know what you expect to find. If you are reading "just in case," you are wasting context.

5. **Parallel reads.** When you need to read multiple files, read them all in a single parallel call. Never read files sequentially when they have no dependency between them.

6. **Targeted line ranges.** For large files where you only need a specific section, use line offsets rather than reading the entire file.

7. **Cache awareness.** After context compaction, you lose file contents from earlier reads. Re-read critical files rather than working from stale memory.

8. **Summarize, do not hoard.** After reading a file for context, extract the relevant facts and move on. You do not need to keep the entire file contents in working memory.

---

## Relationship Between CLAUDE.md and Swarm Quality

The CLAUDE.md directly impacts every stage of the swarm lifecycle:

### Planning

The master agent reads CLAUDE.md to understand the codebase before decomposing a task. A detailed architecture section helps the master identify dependencies between files, understand the project's patterns, and create accurate task definitions.

### Worker Prompts

Relevant CLAUDE.md excerpts are included in every worker's dispatch prompt. Workers use these excerpts to:
- Follow the project's naming conventions
- Use the correct patterns (e.g., service class style, error handling approach)
- Understand the file organization
- Know which tools and commands are available

### Verification

After a swarm completes, verification agents reference CLAUDE.md to ensure all changes follow the project's conventions.

### Without CLAUDE.md

When no CLAUDE.md exists, agents:
- Must infer conventions from reading source files (costly and error-prone)
- May produce code that works but does not match existing patterns
- Cannot know about unwritten rules (e.g., "we never use Class X, always use Y")
- Have no knowledge of project-specific commands or workflows

---

## Summary of Project Artifacts

| Artifact | Location | Version Control | Created By | Purpose |
|---|---|---|---|---|
| `CLAUDE.md` | `{project_root}/CLAUDE.md` | Yes (commit) | `!scaffold`, `!initialize`, or manual | Project conventions for agents |
| `.synapse/config.json` | `{project_root}/.synapse/config.json` | No (gitignore) | `!initialize` | Links project to Synapse |
| `.synapse/toc.md` | `{project_root}/.synapse/toc.md` | No (gitignore) | `!toc_generate` | Semantic file index |
| `.synapse/knowledge/` | `{project_root}/.synapse/knowledge/` | No (gitignore) | `!learn` | Persistent knowledge layer (PKI) |
| `_commands/*.md` | `{project_root}/_commands/` | Optional | Manual | Project-specific commands |

---

## Related Documentation

- [Project Setup](./project-setup.md) -- Step-by-step initialization guide
- [TOC System](./toc-system.md) -- Table of Contents generation and management
- [Project Integration Overview](./overview.md) -- How Synapse integrates with any project
- [Multi-Dashboard Overview](../multi-dashboard/overview.md) -- Running multiple concurrent swarms
