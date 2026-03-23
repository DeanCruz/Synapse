# Path Convention & Project Integration

This module defines how Synapse resolves paths, integrates with target projects, supports multi-project workflows, and handles timestamps. Every path in Synapse uses one of two placeholders that are always absolute paths.

---

## Path Convention

Every path in Synapse uses one of two placeholders:

| Placeholder | Meaning | Example |
|---|---|---|
| `{tracker_root}` | Absolute path to the Synapse repository | `/Users/dean/tools/Synapse` |
| `{project_root}` | Absolute path to the target project being worked on | `/Users/dean/repos/my-app` |

These are always absolute paths. Workers receive **both** in their dispatch prompts. They write code in `{project_root}` and report progress to `{tracker_root}/dashboards/{dashboardId}/progress/`.

### Resolving `{project_root}`

When any Synapse command needs the target project, resolve in this order:

1. **Explicit `--project /path` flag** on the command
2. **Stored config** at `{tracker_root}/.synapse/project.json` (set via `!project set /path`)
3. **Current working directory** — the agent's CWD

---

## How It Works

```
Master Agent plans → writes initialization.json once
        │
        ▼
Workers execute tasks in {project_root} → write progress files to {tracker_root}
        │
        ▼
server.js detects file changes (fs.watch on progress/, fs.watchFile on init/logs)
        │
        ▼
SSE pushes updates to browser in real-time
        │
        ▼
Dashboard merges initialization.json + progress files → renders live status
```

The master agent (you, when running `!p_track`) is the orchestrator. Worker agents are spawned via the Task tool. The dashboard merges static plan data from `initialization.json` with dynamic lifecycle data from worker progress files to produce the combined view. All orchestration logic lives in the master agent's instructions.

---

## Integration with Any Project

Synapse is project-agnostic and fully standalone. To use it with any project:

1. **Synapse can live anywhere.** It does not need to be inside the target project. Keep it in a tools directory, home folder, or wherever is convenient.

2. **Point Synapse at your project** using one of:
   - Run `!project set /path/to/project` to store the target
   - Run from within the project directory (auto-detected as CWD)
   - Pass `--project /path` to any command

3. **Project-specific context** comes from the project's own `CLAUDE.md`, documentation, and code. Synapse reads `{project_root}/CLAUDE.md` for conventions and uses Glob/Grep for file discovery.

4. **Project-specific commands** can be defined at `{project_root}/_commands/`. These are checked after Synapse's own commands in the resolution hierarchy.

5. **The `.synapse/` directory** is created inside the target project for TOC and configuration. Add it to `.gitignore`.

6. **All Synapse data** (dashboards, tasks, history, logs) stays at `{tracker_root}`. Nothing except `.synapse/` is written to the target project.

---

## Multi-Project Support

Each of the 5 dashboard slots can serve a different project simultaneously. The `task.project_root` field in `initialization.json` identifies which project each swarm belongs to.

When working across multiple projects:
- Use `!project set` to switch the active project, or pass `--project` to individual commands
- Each swarm's dashboard shows which project it's targeting
- Commands like `!status` and `!logs` auto-detect the active dashboard regardless of which project it serves
- Workers always receive explicit `{project_root}` in their prompts — they never need to auto-detect

---

## Portability Checklist

- [x] Zero npm dependencies for the server — works with any Node.js installation
- [x] Fully standalone — does not need to be inside the target project
- [x] No hardcoded paths — all paths use `{tracker_root}` and `{project_root}` placeholders
- [x] No project-specific assumptions — works with monorepos, single projects, or any layout
- [x] Self-contained commands — each `_commands/*.md` file is a complete spec
- [x] Dashboard reads `initialization.json` + `progress/` files, merging them client-side
- [x] Server configurable via `PORT` env var
- [x] Works offline — no external API calls, no CDN dependencies

---

## Timestamp Protocol

Every timestamp in `initialization.json`, `logs.json`, progress files, and the XML must be captured live:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

**Never** guess, estimate, or hardcode timestamps. The elapsed timer calculates durations from these values — a bad timestamp shows wildly wrong elapsed times.