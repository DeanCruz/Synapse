# XML Task Files -- Reference

XML task files are the **authoritative master record** for each swarm. They contain the complete plan -- task descriptions, context, critical instructions, file lists, dependencies, statuses, and completion summaries. Every worker reads the XML for context about the overall swarm and its specific task. The master updates it on every completion.

**Location:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{name}.xml`

**Example:** `tasks/03_22_26/parallel_synapse_backlog_phase1.xml`

---

## Purpose

The XML task file serves a different purpose than the dashboard data files:

| File | Purpose | Audience | Lifecycle |
|---|---|---|---|
| `initialization.json` | Drive the dashboard UI with static plan data | Dashboard (browser) | Active swarm only (cleared between swarms) |
| `logs.json` | Event log for the dashboard log panel | Dashboard (browser) | Active swarm only |
| `progress/{id}.json` | Live worker state for dashboard cards | Dashboard (browser) | Active swarm only (ephemeral) |
| **`parallel_{name}.xml`** | **Complete, persistent task record** | **Master agent, worker agents, post-mortem review** | **Permanent (archived by date)** |

The XML file is the only data artifact that persists permanently after a swarm completes. Dashboard data is archived and eventually cleared; the XML task file remains in the `tasks/` directory organized by date.

---

## Directory Structure

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
  03_22_26/
    parallel_synapse_backlog_phase1.xml
    parallel_synapse_backlog_phase2.xml
    parallel_dependency-tracker.xml
    parallel_synapse_documentation.xml
```

Each date directory (`MM_DD_YY`) groups all swarms that ran on that day. The filename follows the pattern `parallel_{kebab-case-name}.xml`.

An accompanying strategy document is stored alongside the XML:
- `parallel_plan_{name}.md` -- the strategy rationale document explaining the master's planning decisions

---

## File Structure

The XML task file uses a structured format with nested elements for each task:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<parallel_task name="{task-name}" created="{ISO 8601 timestamp}">
  <metadata>
    <prompt>{full user prompt}</prompt>
    <project>{project name}</project>
    <project_root>{absolute path to project}</project_root>
    <total_tasks>{number}</total_tasks>
    <total_waves>{number}</total_waves>
    <dashboard>{dashboardId}</dashboard>
  </metadata>

  <!-- Wave comments for visual grouping -->

  <task id="{wave}.{index}" wave="{wave number}" title="{short title}">
    <description>{detailed task description}</description>
    <context>{relevant context the worker needs}</context>
    <critical>{critical constraints and warnings}</critical>
    <files>
      <modify>{file path}</modify>
      <create>{file path}</create>
      <read>{file path or description}</read>
    </files>
    <depends_on>{comma-separated task IDs or empty}</depends_on>
    <status>{pending|in_progress|completed|failed}</status>
    <summary>{completion summary, added after task completes}</summary>
  </task>

  <!-- More tasks... -->

</parallel_task>
```

---

## Element Reference

### `<parallel_task>` (Root Element)

| Attribute | Type | Description |
|---|---|---|
| `name` | string | Kebab-case slug identifying the swarm. Matches `task.name` in `initialization.json`. |
| `created` | ISO 8601 string | When the swarm was created. Matches `task.created` in `initialization.json`. |

### `<metadata>`

Contains swarm-level information. Written once during planning.

| Element | Type | Description |
|---|---|---|
| `<prompt>` | string | The full verbatim user prompt. XML special characters (`&`, `<`, `>`) are escaped (e.g., `&amp;`, `&lt;`, `&gt;`). |
| `<project>` | string | Project name. Matches `task.project` in `initialization.json`. |
| `<project_root>` | string | Absolute path to the target project. Matches `task.project_root` in `initialization.json`. |
| `<total_tasks>` | number | Total task count. |
| `<total_waves>` | number | Total wave count. |
| `<dashboard>` | string | Dashboard ID this swarm uses (e.g., `"dashboard1"`). |

### `<task>` (One Per Agent)

Each `<task>` element represents one unit of work in the swarm.

**Attributes:**

| Attribute | Type | Description |
|---|---|---|
| `id` | string | Unique task identifier. Format: `"{wave}.{index}"` (e.g., `"1.1"`, `"2.3"`). For repair tasks: `"{wave}.{index}r"`. |
| `wave` | number | Wave number this task belongs to. |
| `title` | string | Short verb phrase describing the task. |

**Child Elements:**

| Element | Type | Required | Description |
|---|---|---|---|
| `<description>` | string | Yes | Detailed task description. Provides the worker with full context about what needs to be done. Should be self-contained -- a worker should be able to execute the task from this description alone. |
| `<context>` | string | Yes | Relevant context the worker needs to understand the task. Includes file locations, line numbers, existing patterns, upstream task results, and any other information that prevents the worker from having to discover things on its own. |
| `<critical>` | string | Yes | Critical constraints, warnings, and edge cases. Things the worker must NOT do, boundary conditions, compatibility requirements, and anything that could cause the task to fail if ignored. |
| `<files>` | container | Yes | Lists all files the task will interact with. See **File Operations** below. |
| `<depends_on>` | string | Yes | Comma-separated list of task IDs this task depends on. Empty if the task has no dependencies (root/wave-1 tasks). |
| `<status>` | string | Yes | Current task status: `"pending"`, `"in_progress"`, `"completed"`, or `"failed"`. Updated by the master as the swarm progresses. |
| `<summary>` | string | No | Completion summary added by the master after the worker returns. Includes what was accomplished, key results, and any notable deviations. Not present on pending tasks. |

### `<files>` Container

Lists all files the task will interact with, categorized by operation type:

| Element | Description |
|---|---|
| `<modify>` | An existing file that will be edited. One element per file. |
| `<create>` | A new file that will be created. One element per file. |
| `<read>` | A file that will be read for context but not modified. Can contain a description instead of a path (e.g., `"All .md files containing .synapse/ references"`). |

Example:
```xml
<files>
  <modify>CLAUDE.md</modify>
  <modify>AGENTS.md</modify>
  <read>_commands/project/initialize.md</read>
</files>
```

---

## How the Master Updates the XML

The master updates the XML at specific points during swarm execution:

| Event | Update |
|---|---|
| **Planning complete** | Write the entire XML file with all tasks in `"pending"` status |
| **Worker dispatched** | Update the task's `<status>` to `"in_progress"` |
| **Worker completes** | Update `<status>` to `"completed"`, add `<summary>` element with the worker's result |
| **Worker fails** | Update `<status>` to `"failed"`, add `<summary>` element with the error description |
| **Worker reports deviation** | Optionally annotate the task with deviation details |

---

## Wave Comments

The master uses XML comments to visually separate waves in the file:

```xml
<!-- ═══ WAVE 1: Foundation -- Independent edits (6 tasks) ═══ -->

<task id="1.1" ...> ... </task>
<task id="1.2" ...> ... </task>

<!-- ═══ WAVE 2: Sequential deps -- File overlap guards (3 tasks) ═══ -->

<task id="2.1" ...> ... </task>
```

These comments are purely for human readability and have no programmatic significance.

---

## Relationship to Dashboard Data

The XML task file and dashboard data files serve complementary purposes:

| Aspect | XML Task File | Dashboard Files |
|---|---|---|
| **Audience** | Agents (master + workers) | Browser (dashboard UI) |
| **Detail level** | Full task descriptions, context, critical constraints | Minimal plan metadata for card rendering |
| **Updated during execution** | Yes (status, summaries) | initialization.json: write-once; progress files: continuous |
| **Persistence** | Permanent (stored by date) | Ephemeral (archived, then cleared) |
| **Live updates** | Not watched by the server | Watched by the server, broadcast via SSE |

Workers receive the XML file path in their dispatch prompts and read their specific `<task>` element for context, the `<metadata>` for project information, and other tasks for understanding dependencies and overall swarm scope.

---

## Complete Real-World Example

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

  <!-- ═══ WAVE 1: Foundation -- Independent edits (6 tasks) ═══ -->

  <task id="1.1" wave="1" title="Remove context_cache.json references">
    <description>Remove all references to .synapse/context_cache.json from
    CLAUDE.md and AGENTS.md. This is a dead feature -- no command creates,
    reads, or writes this file.</description>
    <context>CLAUDE.md line 208 has the table row, line 604 has the tree
    entry. AGENTS.md line 196 has the table row, line 585 has the tree
    entry.</context>
    <critical>Do NOT remove the .synapse/ directory itself or toc.md or
    profile.json entries. Only remove context_cache.json rows/lines.</critical>
    <files>
      <modify>CLAUDE.md</modify>
      <modify>AGENTS.md</modify>
    </files>
    <depends_on></depends_on>
    <status>completed</status>
    <summary>Removed all 4 context_cache.json references from CLAUDE.md and
    AGENTS.md -- table rows deleted, directory tree entries removed with
    correct connectors</summary>
  </task>

  <task id="1.2" wave="1" title="Add retry vs repair decision tree">
    <description>Add a "When to Use Retry vs Repair" decision tree to
    agent/instructions/failed_task.md.</description>
    <context>failed_task.md describes the repair worker diagnostic-first
    protocol. retry.md describes the !retry command.</context>
    <critical>The decision tree must cover: transient failures, clear fixable
    root cause, unknown root cause, partial/broken state, and downstream
    contract changes.</critical>
    <files>
      <modify>agent/instructions/failed_task.md</modify>
      <modify>_commands/Synapse/retry.md</modify>
    </files>
    <depends_on></depends_on>
    <status>completed</status>
    <summary>Added decision tree table + 3-step flow to failed_task.md and
    cross-reference to retry.md</summary>
  </task>

  <!-- ═══ WAVE 2: Sequential deps (3 tasks) ═══ -->

  <task id="2.1" wave="2" title="Fix profile.json to config.json refs">
    <description>Update CLAUDE.md and AGENTS.md to reference
    .synapse/config.json instead of .synapse/profile.json.</description>
    <context>The !initialize command creates .synapse/config.json (not
    profile.json). Task 1.1 will have already removed context_cache.json
    from these same sections.</context>
    <critical>Do NOT modify _commands/project/initialize.md -- it is
    already correct.</critical>
    <files>
      <modify>CLAUDE.md</modify>
      <modify>AGENTS.md</modify>
    </files>
    <depends_on>1.1</depends_on>
    <status>completed</status>
    <summary>Replaced all 4 profile.json references with config.json in
    CLAUDE.md and AGENTS.md</summary>
  </task>

</parallel_task>
```

---

## Strategy Rationale Document

Alongside each XML task file, the master writes a strategy rationale document:

**Location:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_plan_{name}.md`

This Markdown file explains the master's planning decisions:
- Why the task was decomposed the way it was
- Why certain tasks depend on others
- Risk areas and mitigation strategies
- Wave grouping rationale
- Any tradeoffs made during planning

The strategy document is for human review and post-mortem analysis. It has no programmatic significance.

---

## Related Documentation

- [Data Architecture Overview](./overview.md)
- [initialization.json Schema Reference](./initialization-json.md)
- [logs.json Schema Reference](./logs-json.md)
- [Progress Files Schema Reference](./progress-files.md)
