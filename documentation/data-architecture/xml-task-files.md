# XML Task Files -- Reference

XML task files are the **authoritative master record** for each swarm. They contain the complete plan -- task descriptions, context, critical instructions, file lists, dependencies, statuses, and completion summaries. Every worker reads the XML for context about the overall swarm and its specific task. The master updates it on every agent completion.

**Location:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{name}.xml`

**Companion file:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{name}.md` (strategy rationale document)

**Owner:** Master agent (orchestrator)

---

## Purpose and Relationship to Other Data

The XML task file serves a different purpose from the dashboard data files:

| File | Purpose | Audience |
|---|---|---|
| `initialization.json` | Drive the dashboard UI (static plan) | Dashboard rendering engine |
| `progress/{id}.json` | Live worker lifecycle data | Dashboard rendering engine, master dispatch scans |
| `logs.json` | Timestamped event log | Dashboard log panel |
| **`parallel_{name}.xml`** | **Authoritative task record with full context** | **Workers (for context), master (for tracking), future reference** |

The XML contains richer information than `initialization.json`: full task descriptions, context paragraphs, critical instructions, file lists, and completion summaries. Workers can read the XML to understand the broader swarm and their specific task in detail. The master updates the XML with completion summaries after each agent returns.

---

## File Naming Convention

| Component | Format | Example |
|---|---|---|
| Directory | `tasks/{MM_DD_YY}/` | `tasks/03_22_26/` |
| Task file | `parallel_{name}.xml` | `parallel_synapse_backlog_phase1.xml` |
| Plan file | `parallel_plan_{name}.md` | `parallel_plan_synapse_backlog_phase1.md` |

The `{name}` is derived from `task.name` in `initialization.json`, typically using underscores instead of hyphens. The date directory uses the swarm creation date.

---

## XML Structure

### Root Element

```xml
<?xml version="1.0" encoding="UTF-8"?>
<parallel_task name="{task-name}" created="{ISO 8601 timestamp}">
  <metadata>...</metadata>
  <!-- Wave comments -->
  <task>...</task>
  <task>...</task>
  ...
</parallel_task>
```

| Attribute | Description |
|---|---|
| `name` | Kebab-case or underscore-case task name (matches `task.name` in `initialization.json`) |
| `created` | ISO 8601 timestamp of swarm creation |

### Metadata Element

```xml
<metadata>
  <prompt>{Full verbatim user prompt}</prompt>
  <project>{Project name}</project>
  <project_root>{Absolute path to target project}</project_root>
  <total_tasks>{Number}</total_tasks>
  <total_waves>{Number}</total_waves>
  <dashboard>{dashboardId}</dashboard>
</metadata>
```

| Field | Description |
|---|---|
| `prompt` | The full user prompt that initiated the swarm. XML-escaped (e.g., `&amp;` for `&`). |
| `project` | Project name, matching `task.project` in initialization.json. |
| `project_root` | Absolute path to the target project. |
| `total_tasks` | Total task count across all waves. |
| `total_waves` | Total wave count. |
| `dashboard` | Which dashboard this swarm is running on (e.g., `"dashboard1"`). |

### Task Elements

Each task in the swarm gets its own `<task>` element:

```xml
<task id="{wave}.{index}" wave="{wave_number}" title="{short title}">
  <description>{Detailed task description}</description>
  <context>{Additional context the worker needs}</context>
  <critical>{Critical instructions and constraints}</critical>
  <files>
    <modify>{file path}</modify>
    <create>{file path}</create>
    <read>{file path or glob}</read>
  </files>
  <depends_on>{comma-separated task IDs}</depends_on>
  <status>{pending|in_progress|completed|failed}</status>
  <summary>{Completion summary, added after task completes}</summary>
</task>
```

### Task Element Fields

| Field | Type | Set When | Description |
|---|---|---|---|
| `id` (attribute) | string | Planning | Task identifier (e.g., `"1.1"`, `"2.3"`). Matches `agents[].id` in initialization.json. |
| `wave` (attribute) | number | Planning | Wave assignment. |
| `title` (attribute) | string | Planning | Short verb phrase describing the task. |
| `description` | element | Planning | Detailed description of what the worker must do. Can be multiple sentences. Should be self-contained -- a worker should understand the full scope from this field alone. |
| `context` | element | Planning | Background information the worker needs. File locations, line numbers, patterns to follow, related code sections. |
| `critical` | element | Planning | Non-negotiable constraints and gotchas. Things the worker must NOT do, edge cases to handle, compatibility requirements. |
| `files` | element | Planning | List of files the worker will read, modify, or create. |
| `files/modify` | sub-element | Planning | Files to be modified. Path relative to project root. |
| `files/create` | sub-element | Planning | Files to be created. Path relative to project root. |
| `files/read` | sub-element | Planning | Files to read for context. Can include glob patterns. |
| `depends_on` | element | Planning | Comma-separated task IDs that must complete first. Empty for root tasks. |
| `status` | element | Updated by master | Current status: `"pending"`, `"in_progress"`, `"completed"`, or `"failed"`. Updated by the master as workers start and finish. |
| `summary` | element | After completion | One-line summary of what was accomplished. Added by the master when the worker returns. |

### Wave Comments

Waves are visually separated by XML comments:

```xml
<!-- ═══ WAVE 1: Foundation — Independent edits (6 tasks) ═══ -->

<task id="1.1" ...>...</task>
<task id="1.2" ...>...</task>

<!-- ═══ WAVE 2: Sequential deps — File overlap guards (3 tasks) ═══ -->

<task id="2.1" ...>...</task>
```

These comments aid human readability but have no programmatic effect.

---

## Write Timing

### During Planning (Write-Once for Structure)

The master creates the XML file with the full task structure during the planning phase:
- All `<task>` elements with description, context, critical, files, depends_on
- All `<status>` elements set to `"pending"`
- All `<summary>` elements empty or absent
- `<metadata>` fully populated

### During Execution (Updated Per Completion)

| Moment | What the Master Updates |
|---|---|
| Worker dispatched | `<status>` changed from `"pending"` to `"in_progress"` |
| Worker completes | `<status>` changed to `"completed"`, `<summary>` added with result detail |
| Worker fails | `<status>` changed to `"failed"`, `<summary>` added with error description |
| Repair task created | New `<task>` element appended (with `id` suffix `"r"`) |

Unlike `initialization.json` (which is write-once except for repairs), the XML is updated on every agent return to maintain a complete record with results.

---

## Real Example

From `tasks/03_22_26/parallel_synapse_backlog_phase1.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<parallel_task name="synapse-backlog-phase1" created="2026-03-22T06:54:18Z">
  <metadata>
    <prompt>Complete phase1a (dead features &amp; docs cleanup), phase1b (prompt
    template upgrades), and phase1c (server validation hardening) from the
    Synapse backlog.</prompt>
    <project>Synapse</project>
    <project_root>/Users/dean/Desktop/Working/Repos/Synapse</project_root>
    <total_tasks>12</total_tasks>
    <total_waves>3</total_waves>
    <dashboard>dashboard1</dashboard>
  </metadata>

  <!-- ═══ WAVE 1: Foundation — Independent edits (6 tasks) ═══ -->

  <task id="1.1" wave="1" title="Remove context_cache.json references">
    <description>Remove all references to .synapse/context_cache.json from
    CLAUDE.md and AGENTS.md. This is a dead feature — no command creates,
    reads, or writes this file. Remove from: (1) the .synapse/ directory
    table in each file, (2) the target project directory tree in each file.
    Verify tables and trees render correctly after removal.</description>
    <context>CLAUDE.md line 208 has the table row, line 604 has the tree
    entry. AGENTS.md line 196 has the table row, line 585 has the tree
    entry.</context>
    <critical>Do NOT remove the .synapse/ directory itself or toc.md or
    profile.json entries. Only remove context_cache.json rows/lines.
    Verify markdown renders correctly (no trailing pipes, no blank
    rows).</critical>
    <files>
      <modify>CLAUDE.md</modify>
      <modify>AGENTS.md</modify>
    </files>
    <depends_on></depends_on>
    <status>pending</status>
  </task>

  <task id="1.4" wave="1" title="Add path parameter sanitization">
    <description>Add a sanitizePathParam() function to
    src/server/routes/apiRoutes.js and apply it to all routes that extract
    path parameters (dashboard ID, archive name, queue ID). Reject path
    traversal attempts with HTTP 400.</description>
    <context>parseDashboardRoute() at line 36 extracts dashboardId without
    validation. Archive route at line 217 extracts archive name. Queue route
    at line 401 extracts queue ID. All pass directly to path.join()
    calls.</context>
    <critical>The sanitizePathParam function must: reject strings with "..",
    "/" or "\"; allow alphanumeric, hyphens, underscores, and single dots;
    enforce max 100 chars. Return 400 with descriptive error for invalid
    inputs.</critical>
    <files>
      <modify>src/server/routes/apiRoutes.js</modify>
    </files>
    <depends_on></depends_on>
    <status>pending</status>
  </task>

  <!-- ═══ WAVE 2: Sequential deps — File overlap guards (3 tasks) ═══ -->

  <task id="2.1" wave="2" title="Fix profile.json to config.json refs">
    <description>Update CLAUDE.md and AGENTS.md to reference
    .synapse/config.json instead of .synapse/profile.json.</description>
    <context>The !initialize command creates .synapse/config.json (not
    profile.json). Task 1.1 will have already removed context_cache.json
    from these same sections.</context>
    <critical>Do NOT modify _commands/project/initialize.md — it is already
    correct. After 1.1's edits, the table will have 2 rows.</critical>
    <files>
      <modify>CLAUDE.md</modify>
      <modify>AGENTS.md</modify>
    </files>
    <depends_on>1.1</depends_on>
    <status>pending</status>
  </task>

  <!-- ═══ WAVE 3: Integration — Multi-file & audit (3 tasks) ═══ -->

  <task id="3.1" wave="3" title="Add EXPORTS to worker return format">
    <description>Add an EXPORTS: section to the worker return format in both
    p_track.md and p.md, placed between FILES CHANGED and DIVERGENT ACTIONS.
    Also add a "Return Format — EXPORTS Field" subsection to
    tracker_worker_instructions.md.</description>
    <context>When workers create new functions, types, endpoints, the master
    must manually extract this from summaries. An explicit EXPORTS field
    automates this.</context>
    <critical>EXPORTS should include type, name, and brief description.
    Workers omit the section if no new exports. Include 3 concrete
    examples.</critical>
    <files>
      <modify>_commands/Synapse/p_track.md</modify>
      <modify>_commands/Synapse/p.md</modify>
      <modify>agent/instructions/tracker_worker_instructions.md</modify>
    </files>
    <depends_on>2.2,1.6</depends_on>
    <status>pending</status>
  </task>
</parallel_task>
```

Key observations:
- XML-escaped characters in prompts (`&amp;` for `&`)
- `<description>` provides enough detail for a worker to execute independently
- `<context>` includes specific line numbers and file locations
- `<critical>` states constraints and "do NOT" instructions
- `<depends_on>` uses comma-separated IDs (not JSON array syntax)
- Wave comments provide visual structure

---

## XML vs initialization.json

The XML and initialization.json serve complementary purposes:

| Aspect | XML Task File | initialization.json |
|---|---|---|
| **Primary audience** | Workers (context), master (record), humans (review) | Dashboard rendering engine |
| **Detail level** | Full descriptions, context, critical instructions, file lists | Minimal: id, title, wave, layer, directory, depends_on |
| **Updated after planning** | Yes -- status and summary on every completion | No (write-once, except repair tasks) |
| **Lifecycle data** | `<status>` and `<summary>` updated by master | None -- all lifecycle in progress files |
| **File lists** | Yes (`<files>` with modify/create/read) | No |
| **Context/critical** | Yes (detailed paragraphs) | No |
| **Layout data** | No (no layer, directory badges, chain definitions) | Yes (layer, directory, chains[]) |

---

## Plan Rationale Document

Every swarm also produces a strategy document:

**Location:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{name}.md`

This Markdown file documents:
- The master's analysis of the task
- Why tasks were decomposed the way they were
- Dependency reasoning (why task A must precede task B)
- Risk assessment and mitigation strategies
- Wave grouping rationale

It is a human-readable companion to the XML that explains the "why" behind the plan structure.

---

## Directory Organization

Task files are organized by date:

```
tasks/
  03_01_26/
    parallel_frontend-core-fixes.xml
    parallel_frontend-core-pages.xml
    parallel_frontend-marketing-components.xml
    parallel_frontend-page-subdirs.xml
  03_02_26/
    parallel_frontend-api-layer.xml
    parallel_ui-modernization.xml
  03_21_26/
    parallel_synapse-weakness-analysis.xml
  03_22_26/
    parallel_synapse_backlog_phase1.xml
    parallel_synapse_backlog_phase2.xml
    parallel_dependency-tracker.xml
    parallel_synapse_documentation.xml
```

Each date directory contains all swarms created on that date. Multiple swarms on the same day each get their own XML and plan file.

---

## Relationship to History and Archive

| Storage | What It Contains | When Created |
|---|---|---|
| **XML task file** | Full task record with descriptions, context, statuses, summaries | During planning, updated throughout execution |
| **History file** | Lightweight summary: task metadata, agent results (no descriptions/context) | When swarm completes and is moved to history |
| **Archive** | Full copy of dashboard directory (init + logs + progress files) | When dashboard is cleared before a new swarm |

The XML task file persists indefinitely in `tasks/`. It is the most complete record of what was planned, what happened, and what was accomplished. History files are summaries for quick reference. Archive copies preserve the full dashboard state including real-time progress data.

---

## Related Documentation

- [Data Architecture Overview](./overview.md) -- High-level data model and ownership
- [initialization.json Schema](./initialization-json.md) -- Dashboard plan data
- [logs.json Schema](./logs-json.md) -- Event log format
- [Progress Files Schema](./progress-files.md) -- Worker progress lifecycle
