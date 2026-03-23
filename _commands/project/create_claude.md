# !create_claude — Create or Update an Opinionated CLAUDE.md

## Overview

Generates a **prescriptive** `CLAUDE.md` for the target project that establishes coding standards, architectural patterns, documentation requirements, and styling guidelines. Unlike `!scaffold` (which documents what exists), `!create_claude` sets the rules for how the project **should** be built.

Accepts an optional prompt with architecture directions. If none given, asks the user. If the user declines to provide directions, auto-detects the stack and applies best-practice defaults.

---

## Usage

```
!create_claude                              <- Interactive: asks for architecture directions
!create_claude {prompt}                     <- Uses the prompt as architecture directions
!create_claude --update                     <- Updates existing CLAUDE.md preserving user sections
!create_claude --force                      <- Overwrites existing CLAUDE.md (requires confirmation)
```

---

## Execution Steps

### Step 1: Parse Input

1. Check if a prompt was provided after `!create_claude`
2. If `--update` flag is present, set mode to UPDATE (merge with existing)
3. If `--force` flag is present, set mode to OVERWRITE (confirm first)
4. Strip flags from the prompt text

### Step 2: Resolve Architecture Directions

**If a prompt was provided:**
- Use the prompt as the user's architecture directions. Proceed to Step 3.

**If no prompt was provided:**
- Ask the user using `AskUserQuestion` with these questions:

**Question 1 — Architecture Pattern:**
| Option | Description |
|---|---|
| MVC (Model-View-Controller) | Separate data, presentation, and logic layers |
| MVVM (Model-View-ViewModel) | Reactive binding between views and data |
| Feature-based / Domain-driven | Organize by feature or domain, not layer |
| Let me describe my own | Free-form architecture description |

**Question 2 — Styling Approach:**
| Option | Description |
|---|---|
| CSS Modules | Scoped CSS files co-located with components |
| Tailwind CSS | Utility-first CSS framework |
| Styled Components / CSS-in-JS | Runtime CSS via JavaScript |
| Plain CSS / SCSS | Traditional stylesheets |

**Question 3 — Code Standards Priority:**
| Option | Description |
|---|---|
| Strict (recommended) | Enforce types, linting, testing, docs on all code |
| Balanced | Enforce on public APIs and core logic, relaxed elsewhere |
| Minimal | Light conventions, trust developer judgment |

**If the user provides no meaningful directions** (skips all questions or gives vague answers):
- Auto-detect the stack (Step 3) and apply best-practice defaults for the detected technologies.

### Step 3: Detect Project Stack

Scan `{project_root}` to understand the existing project:

1. **Config files** — Read `package.json`, `tsconfig.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `Gemfile`, etc.
2. **Directory structure** — `ls` the root and one level into source directories
3. **Existing patterns** — Quick scan for:
   - Import style (relative vs absolute vs aliases)
   - File naming (camelCase, kebab-case, PascalCase)
   - Test framework and location
   - Existing linter/formatter configs (`.eslintrc`, `.prettierrc`, `ruff.toml`, etc.)
   - CSS/styling approach in use
4. **Existing CLAUDE.md** — If one exists and mode is UPDATE, read it fully
5. **README.md** — Read for project purpose and setup

### Step 4: Determine Best Practices

Based on the detected stack + user directions (or defaults), determine the full set of guidelines. The agent must make **concrete, opinionated decisions** — not leave TODOs for style choices.

**Default decisions when the user provides no directions:**

| Decision | Default Rule |
|---|---|
| Architecture | MVC or feature-based — whichever best fits the existing structure |
| File naming | Match existing convention; if none, use `kebab-case` for files, `PascalCase` for components |
| Imports | Prefer absolute imports with path aliases when the toolchain supports it |
| Types | Strict typing — no `any`, no implicit `any`, no type assertions without comments |
| Error handling | Typed errors, no bare `catch`, always handle or propagate |
| Testing | Co-located tests in `__tests__/` or `.test.` files next to source |
| Documentation | JSDoc/docstrings on all exports; inline comments only for non-obvious logic |
| Styling | Match existing approach; if none, recommend CSS Modules or Tailwind |
| Components | Single responsibility, max ~200 lines, extract when reused 2+ times |
| State management | Match existing; if none, recommend simplest option for the framework |
| API design | RESTful conventions, consistent error response shapes, versioned endpoints |
| Git | Conventional commits, feature branches, no direct pushes to main |

### Step 5: Generate CLAUDE.md

Assemble the file using this structure. Every section must contain **specific, actionable rules** — not vague advice.

```markdown
# {Project Name}

> {One-line purpose}

## Tech Stack

- **Language:** {language} {version}
- **Framework:** {framework} {version}
- **Styling:** {approach}
- **Testing:** {framework}
- **Database:** {if applicable}
- **Key Libraries:** {3-5 most important}

## Architecture

### Pattern: {MVC / MVVM / Feature-based / etc.}

{2-4 paragraphs explaining the architecture. Include:}
- How the codebase is organized and why
- The role of each top-level directory
- Data flow: where data enters, how it's processed, where it's rendered
- Where business logic lives vs presentation logic vs data access

### File Structure

{ASCII tree of the project structure with descriptions}

### Layer Rules

{Specific rules for each architectural layer, e.g.:}
- **Models/Data:** {where they live, what they contain, what they must NOT contain}
- **Views/UI:** {component rules, no business logic, prop drilling limits}
- **Controllers/Logic:** {where business logic lives, how it connects layers}
- **Services:** {external API calls, database access, third-party integrations}

## Coding Standards

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Files | {convention} | {example} |
| Components | {convention} | {example} |
| Functions | {convention} | {example} |
| Variables | {convention} | {example} |
| Constants | {convention} | {example} |
| Types/Interfaces | {convention} | {example} |
| CSS classes | {convention} | {example} |

### Imports

- {Specific import ordering rules}
- {Path alias rules}
- {What to avoid}

### Type Safety

- {Typing strictness rules}
- {When type assertions are acceptable}
- {Generic usage guidelines}

### Error Handling

- {Error pattern to use}
- {What must be caught vs propagated}
- {Error response shape for APIs}

### Functions & Methods

- {Max length guideline}
- {Parameter limits}
- {Return type rules}
- {Pure function preferences}

## Styling Guidelines

### Approach: {CSS Modules / Tailwind / etc.}

- {File organization for styles}
- {Naming convention for classes}
- {Responsive design approach}
- {Theme/variable usage}
- {What to avoid (inline styles, !important, etc.)}

### Component Styling Rules

- {How to scope styles}
- {Shared style patterns}
- {Animation/transition guidelines}

## Documentation Standards

### Code Documentation

- {When to write docstrings/JSDoc}
- {Comment style and when comments are required}
- {What NOT to comment (obvious code)}

### File Headers

- {Whether files need header comments}
- {What to include if so}

### README & Docs

- {When to update documentation}
- {Where documentation lives}

## Testing Standards

### Structure

- {Where tests live}
- {Naming convention for test files}
- {Test organization (describe/it blocks, etc.)}

### Coverage Requirements

- {What must be tested}
- {What can skip tests}
- {Mocking guidelines}

## Git & Workflow

- {Branch naming convention}
- {Commit message format}
- {PR requirements}
- {What should never be committed (.env, secrets, etc.)}

## Commands

{Build, test, lint, dev server commands from package.json/scripts}

| Command | Purpose |
|---|---|
| `{cmd}` | {what it does} |

## Environment

{Required environment variables from .env.example or detected config}

| Variable | Purpose | Required |
|---|---|---|
| `{VAR}` | {description} | {yes/no} |
```

### Step 6: Handle Existing CLAUDE.md

**No existing file:** Write the generated file directly.

**Existing file + UPDATE mode:**
1. Read the existing CLAUDE.md
2. Preserve any sections the user has customized (detect by comparing with scaffold-generated defaults)
3. Add new sections that don't exist
4. Update sections that appear auto-generated (contain scaffold markers)
5. Present a diff summary to the user before writing

**Existing file + no flags:** Abort with message:
```
CLAUDE.md already exists at {project_root}/CLAUDE.md.
Use --update to merge new guidelines into the existing file.
Use --force to replace it entirely.
```

**Existing file + FORCE mode:** Confirm with the user, then overwrite.

### Step 7: Write and Report

1. Write the file to `{project_root}/CLAUDE.md`
2. Report:

```
## Created: CLAUDE.md

- **Architecture:** {pattern chosen}
- **Styling:** {approach chosen}
- **Standards level:** {strict/balanced/minimal}
- **Stack detected:** {technologies}
- **Sections generated:** {N}

The CLAUDE.md is ready. All agents working in this project will follow these guidelines.
Review the file and adjust any rules that don't match your preferences.
```

---

## Rules

- **Make concrete decisions.** Every guideline must be specific and actionable. "Use good naming" is not acceptable. "Use camelCase for functions, PascalCase for components" is.
- **Respect existing patterns.** If the project already has established conventions (visible from config or code), align with them rather than imposing conflicting rules.
- **Never overwrite without consent.** Existing CLAUDE.md files require `--update` or `--force`.
- **Read only config and structure.** Scan config files, directory listings, READMEs, and linter configs. Do not deep-read source files — infer from structure and tooling.
- **Adapt to the stack.** A Python Django project gets different guidelines than a React TypeScript app. The architecture pattern, naming conventions, and styling rules must match the technology.
- **Opinionated > permissive.** When in doubt, pick the stricter, more widely-accepted convention. It's easier for users to relax rules than to add them later.
- **Run in serial mode.** This command executes directly — no parallel dispatch.
- **Differentiation from !scaffold:** `!scaffold` documents what IS. `!create_claude` prescribes what SHOULD BE. If both have been run, `!create_claude` output takes precedence as it contains actionable standards, not just descriptions.
