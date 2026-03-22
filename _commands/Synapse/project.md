# !project — Manage Target Project

## Purpose

Set, display, or clear the target project that Synapse operates on. The target project is the codebase where worker agents do their actual work — separate from Synapse's own location.

## Syntax

```
!project                     # Show current project and how it was resolved
!project set /path/to/repo   # Store a target project path
!project clear               # Clear stored project, revert to CWD detection
```

## How It Works

### Resolution Order for `{project_root}`

When any Synapse command needs `{project_root}`, resolve it in this order:

1. **Explicit `--project` flag** — If the command was invoked with `--project /path/to/repo`, use that path.
2. **Stored config** — Check `{tracker_root}/.synapse/project.json` for a `current_project` field. If present, use it.
3. **Current working directory** — Use the agent's CWD as `{project_root}`.

### `!project` (no arguments)

Display:
- The resolved `{project_root}` path
- How it was resolved (explicit flag / stored config / CWD)
- Whether `{project_root}/CLAUDE.md` exists
- Whether `{project_root}/.synapse/` exists (with contents summary if so)
- Tech stack indicators found (package.json, tsconfig.json, Cargo.toml, go.mod, requirements.txt, etc.)

### `!project set /path/to/repo`

1. Validate the path exists and is a directory.
2. Write `{tracker_root}/.synapse/project.json`:
   ```json
   {
     "current_project": "/absolute/path/to/repo",
     "set_at": "ISO 8601 timestamp"
   }
   ```
3. Create `{project_root}/.synapse/` directory if it doesn't exist.
4. Display confirmation with project summary (same info as `!project` show).

### `!project clear`

1. Remove the `current_project` field from `{tracker_root}/.synapse/project.json` (or delete the file).
2. Confirm that `{project_root}` will now resolve from CWD.

## Validation

When resolving `{project_root}`, warn (but don't block) if:
- The directory has no `.git/` directory
- The directory has no recognizable project markers (package.json, CLAUDE.md, src/, etc.)
- The directory appears to be empty or a home directory

## Notes

- `{project_root}` is always an absolute path. Relative paths provided to `!project set` must be resolved to absolute.
- The `.synapse/` directory inside the target project is where Synapse stores project-scoped data (TOC, configuration). Projects should add `.synapse/` to their `.gitignore`.
- Different dashboard slots can serve different projects. The resolved `{project_root}` is stored in `initialization.json` at `task.project_root` when a swarm starts.
