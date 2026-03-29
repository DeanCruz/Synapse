# Archive and History

Synapse preserves swarm data through two complementary systems: **archives** (full dashboard snapshots) and **history** (lightweight JSON summaries). Together, they ensure no swarm data is ever lost when dashboards are cleared for reuse.

---

## The Archive-Before-Clear Rule

**This is non-negotiable.** The master agent must ALWAYS archive a dashboard before clearing it. Previous swarm data is never discarded -- it is preserved for future reference.

Every operation that clears a dashboard must follow this sequence:

1. **Check if the dashboard has data** -- read `initialization.json`. If `task` is not `null`, the dashboard has a previous swarm.
2. **Archive the dashboard** -- copy the entire dashboard directory to `{tracker_root}/Archive/{YYYY-MM-DD}_{task_name}/`.
3. **Save a history summary** -- build and write a lightweight summary to `{tracker_root}/history/`.
4. **Then clear** -- delete progress files, reset `initialization.json` and `logs.json` to empty state.

This applies everywhere a dashboard is cleared:
- `!p_track` initialization (when auto-selecting a finished dashboard)
- `!reset` command
- `!master_plan_track` slot clearing
- Queue-to-dashboard promotion
- Any other operation that overwrites dashboard state

---

## Archives

### What Archives Contain

An archive is a **complete snapshot** of a dashboard directory at the time of archiving. It preserves everything:

```
{tracker_root}/Archive/
├── 2026-03-15_auth-refactor/
│   ├── initialization.json    # Full plan data
│   ├── logs.json              # Complete event log
│   └── progress/              # All worker progress files
│       ├── 1.1.json
│       ├── 1.2.json
│       ├── 2.1.json
│       └── ...
├── 2026-03-18_dark-mode/
│   └── ...
└── 2026-03-20_db-migration/
    └── ...
```

### Archive Naming Convention

Archives are named using the pattern `{YYYY-MM-DD}_{task_name}`:

- The date is the **archive date** (when the dashboard was cleared), not the swarm start date.
- The task name comes from `initialization.json` at `task.name`.
- If no task name is available, the fallback is `unnamed`.

**Examples:**
```
2026-03-15_auth-refactor
2026-03-18_implement-search
2026-03-20_unnamed
```

### Creating Archives

The `ArchiveService.archiveDashboard(id)` function handles archive creation:

```javascript
const archiveName = archiveDashboard('a1b2c3');
// Copies a1b2c3/ to Archive/2026-03-22_task-name/
// Returns: "2026-03-22_task-name"
```

Under the hood, this:
1. Reads the dashboard's `initialization.json` to extract the task name.
2. Constructs the archive name from today's date and the task name.
3. Recursively copies the entire dashboard directory to `{tracker_root}/Archive/{archiveName}/`.

### Listing Archives

The `ArchiveService.listArchives()` function returns all archived dashboards, sorted newest-first:

```javascript
listArchives()
// Returns:
[
  {
    name: '2026-03-22_auth-refactor',
    task: { name: 'auth-refactor', type: 'Waves', ... },
    agentCount: 12
  },
  {
    name: '2026-03-20_dark-mode',
    task: { name: 'dark-mode', type: 'Chains', ... },
    agentCount: 8
  }
]
```

### Deleting Archives

Archives can be deleted when no longer needed:

```javascript
deleteArchive('2026-03-15_auth-refactor');
// Removes the entire archive directory
// Returns: true (deleted) or false (not found)
```

---

## History

### What History Contains

History entries are **lightweight JSON summaries** that capture the essential metrics of a completed swarm without the full payload of progress files and logs. They are designed for quick browsing and comparison.

History files live at `{tracker_root}/history/`:

```
{tracker_root}/history/
├── 2026-03-15_auth-refactor.json
├── 2026-03-18_dark-mode.json
└── 2026-03-20_db-migration.json
```

### History Summary Schema

Each history JSON file contains:

```json
{
  "task_name": "auth-refactor",
  "task_type": "Waves",
  "project": "my-app",
  "directory": "/Users/dean/repos/my-app",
  "prompt": "Refactor the authentication flow to use JWT tokens...",
  "overall_status": "completed",
  "total_tasks": 12,
  "completed_tasks": 11,
  "failed_tasks": 1,
  "in_progress_tasks": 0,
  "pending_tasks": 0,
  "total_waves": 4,
  "started_at": "2026-03-15T10:05:00Z",
  "completed_at": "2026-03-15T10:18:30Z",
  "duration": "13m 30s",
  "cleared_at": "2026-03-15T10:25:00Z",
  "dashboard_id": "a1b2c3",
  "agents": [
    {
      "id": "1.1",
      "title": "Create JWT token service",
      "wave": 1,
      "status": "completed",
      "assigned_agent": "Agent 1",
      "started_at": "2026-03-15T10:05:00Z",
      "completed_at": "2026-03-15T10:08:15Z",
      "summary": "Created JWT service with sign, verify, and refresh methods"
    },
    {
      "id": "1.2",
      "title": "Update auth middleware",
      "wave": 1,
      "status": "failed",
      "assigned_agent": "Agent 2",
      "started_at": "2026-03-15T10:05:00Z",
      "completed_at": "2026-03-15T10:07:45Z",
      "summary": "Failed: existing middleware uses incompatible session format"
    }
  ],
  "log_count": 47
}
```

### Key Fields

| Field | Description |
|---|---|
| `task_name` | Name of the swarm task |
| `overall_status` | Derived status: `completed`, `completed_with_errors`, `in_progress`, `pending` |
| `total_tasks` / `completed_tasks` / `failed_tasks` | Task counts derived from progress files |
| `started_at` | Earliest `started_at` across all agents |
| `completed_at` | Latest `completed_at` across all agents |
| `duration` | Human-readable duration string (e.g., "13m 30s") |
| `cleared_at` | When the dashboard was cleared (history creation time) |
| `dashboard_id` | Which dashboard slot the swarm ran on |
| `agents[]` | Per-agent summary with id, title, status, timing, and result |
| `log_count` | Number of log entries in `logs.json` at time of clearing |

### Building History Summaries

The `HistoryService.buildHistorySummary(id)` function constructs a summary by:

1. Reading the dashboard's `initialization.json` for plan data.
2. Reading all progress files from `progress/` for lifecycle data.
3. Reading `logs.json` for the log count.
4. Deriving statistics (completed count, failed count, timing) from the progress data.
5. Constructing per-agent summaries from both plan and progress data.

### Saving History

The `HistoryService.saveHistorySummary(id)` function builds the summary and writes it to disk:

```javascript
const summary = saveHistorySummary('a1b2c3');
// Builds summary from dashboard a1b2c3's data
// Writes to history/2026-03-22_task-name.json
// Returns the summary object
```

### Viewing History

The `!history` command displays all past swarm summaries:

```
!history              # Show all past tasks
!history --last 5     # Show only the last 5 tasks
```

History is global across all dashboards. The output includes task names, project, completion stats, duration, and status. Entries are sorted by `cleared_at` (newest first).

---

## Archive vs. History Comparison

| Aspect | Archive | History |
|---|---|---|
| **Location** | `{tracker_root}/Archive/` | `{tracker_root}/history/` |
| **Format** | Full directory snapshot | Single JSON file |
| **Contains** | `initialization.json` + `logs.json` + all `progress/*.json` | Derived summary with key metrics |
| **Size** | Can be large (many progress files) | Small (one file per swarm) |
| **Purpose** | Complete data recovery | Quick browsing and comparison |
| **Naming** | `{YYYY-MM-DD}_{task_name}/` (directory) | `{YYYY-MM-DD}_{task_name}.json` (file) |
| **Created by** | `ArchiveService.archiveDashboard()` | `HistoryService.saveHistorySummary()` |
| **Deletable** | Yes, via `deleteArchive()` | Manual file deletion |

---

## The `!reset` Command

The `!reset` command triggers both archiving and history saving before clearing:

```
!reset                  # Reset auto-detected active dashboard
!reset a1b2c3           # Reset a specific dashboard
!reset --all            # Reset all dashboards
```

### Single Dashboard Reset Flow

1. Parse the optional `{dashboardId}` argument (or auto-detect).
2. Read `initialization.json`. If `task` is `null`, report "already empty" and stop.
3. **Save history summary** to `{tracker_root}/history/`.
4. **Archive the dashboard** to `{tracker_root}/Archive/`.
5. **Clear the dashboard**: delete progress files, reset `initialization.json` and `logs.json` to empty state.
6. Report: "Dashboard {id} cleared. Archived and history saved."

### Reset All (`--all`)

For each dashboard returned by `listDashboards()`:
- If `task` is `null`, skip (already empty).
- Otherwise, archive, save history, and clear.

Report: "All dashboards cleared. {N} archived and history summaries saved."

---

## Extended History: Lessons Learned

When using `!reset`, the history summary includes an additional `lessons_learned` object that captures patterns and issues from the swarm:

```json
{
  "lessons_learned": {
    "deviations": [
      { "task_id": "2.1", "description": "Used async API instead of sync" }
    ],
    "failure_causes": [
      { "task_id": "1.2", "cause": "Incompatible session format" }
    ],
    "warnings": [
      "Task 3.1 encountered rate limiting on API calls"
    ],
    "patterns": "Right-sizing at 3 files per task worked well. Shared file deps in wave 2 caused minor conflicts."
  }
}
```

This data helps inform future swarm planning by documenting what went well and what caused problems.

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/server/services/ArchiveService.js` | `archiveDashboard()`, `listArchives()`, `deleteArchive()` |
| `src/server/services/HistoryService.js` | `buildHistorySummary()`, `saveHistorySummary()`, `listHistory()` |
| `src/server/services/DashboardService.js` | `clearDashboardProgress()`, `copyDirSync()` |
| `_commands/Synapse/reset.md` | Full reset command specification |
| `_commands/Synapse/history.md` | History viewing command specification |
