# Plan: Convert XML Task Files to JSON

## Overview

Replace the XML-based master task file format (`parallel_{name}.xml`) with JSON (`parallel_{name}.json`) across the entire Synapse codebase. This affects ~50 documentation/instruction files and zero application code (no programmatic XML parsing exists).

---

## JSON Schema (replaces XML)

**File:** `{tracker_root}/tasks/{MM_DD_YY}/parallel_{task_name}.json`

```json
{
  "name": "task-slug",
  "created": "2026-03-22T06:54:18Z",
  "metadata": {
    "prompt": "original user prompt",
    "type": "Waves",
    "directories": ["electron", "src/server"],
    "affected_projects": "Synapse",
    "total_tasks": 7,
    "total_waves": 3,
    "overall_status": "pending",
    "project": "Synapse",
    "project_root": "/Users/dean/Desktop/Working/Repos/Synapse",
    "dashboard": "a3f7k2"
  },
  "waves": [
    {
      "id": 1,
      "name": "Infrastructure",
      "status": "pending",
      "tasks": [
        {
          "id": "1.1",
          "title": "Remove static ide dashboard backend",
          "description": "Detailed description...",
          "directory": "electron, src/server",
          "depends_on": [],
          "context": "Context the worker needs...",
          "critical": "Critical constraints...",
          "tags": ["backend", "config"],
          "files": [
            { "action": "modify", "path": "electron/main.js" },
            { "action": "read", "path": "src/server/index.js" }
          ],
          "status": "pending",
          "assigned_agent": null,
          "started_at": null,
          "completed_at": null,
          "summary": null,
          "logs": []
        }
      ]
    }
  ],
  "dependency_chains": [
    { "id": 1, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 2, "tasks": ["1.2", "2.2"] }
  ]
}
```

Key differences from XML:
- `depends_on` is a proper JSON array `[]` instead of comma-separated string
- `files` is an array of `{action, path}` objects
- `tags` is a proper array instead of comma-separated string
- No XML escaping needed for special characters in `prompt`, `context`, `critical`
- Waves contain their tasks directly (nested structure)
- Null values instead of empty strings for unset fields

---

## Files to Edit (grouped by priority)

### Group 1: Core Instruction Files (7 files)
These define the format and are the most critical.

1. **`CLAUDE.md`** — Root instructions. Update file references, data architecture table, directory structure.
2. **`AGENTS.md`** — Agent instructions. Update XML references to JSON throughout.
3. **`_commands/Synapse/p_track.md`** — Primary swarm command. Update output files, rules, timestamp protocol.
4. **`agent/_commands/p_track_planning.md`** — **Biggest change.** Replace full XML schema (Step 9) with JSON schema. Update Steps 8-10 references.
5. **`agent/_commands/p_track_execution.md`** — Update dispatch and completion handling to reference JSON.
6. **`agent/_commands/p_track_completion.md`** — Update Step 17A from "Update master XML" to "Update master task file".
7. **`_commands/Synapse/p.md`** — Update references that contrast p vs p_track (mentions "no XML").

### Group 2: Agent Protocol Files (10 files)
These reference the task file format in instructions.

8. **`agent/instructions/tracker_master_instructions.md`** — Directory structure.
9. **`agent/instructions/common_pitfalls.md`** — "Reconstruct from XML summaries".
10. **`agent/instructions/tracker_multi_plan_instructions.md`** — Multi-stream XML references.
11. **`agent/instructions/dashboard_resolution.md`** — Tasks directory reference.
12. **`agent/master/role.md`** — Master file list, responsibilities.
13. **`agent/master/dashboard_protocol.md`** — "Master XML task file" row.
14. **`agent/master/worker_prompts.md`** — Worker prompt template referencing XML.
15. **`agent/core/data_architecture.md`** — "Master XML" section.
16. **`agent/core/parallel_principles.md`** — "XML updates only" reference.
17. **`agent/worker/progress_reporting.md`** — "task XML" in stage names.

### Group 3: Command Files (6 files)

18. **`_commands/Synapse/dispatch.md`** — "Read the master XML".
19. **`_commands/Synapse/resume.md`** — Heavy XML references throughout resume flow.
20. **`_commands/Synapse/retry.md`** — "Read the master XML".
21. **`_commands/Synapse/inspect.md`** — "Read the master XML".
22. **`_commands/Synapse/cancel-safe.md`** — "Update the master XML".
23. **`_commands/Synapse/master_plan_track.md`** — Multi-stream XML references.

### Group 4: Documentation (22 files)

24. **`documentation/data-architecture/xml-task-files.md`** — **Rewrite entirely** → rename to `task-files.md` (or rewrite in-place).
25. **`documentation/data-architecture/overview.md`** — XML references in data flow.
26. **`documentation/data-architecture/initialization-json.md`** — Link to XML reference.
27. **`documentation/data-architecture/logs-json.md`** — Link to XML reference.
28. **`documentation/data-architecture/progress-files.md`** — "task XML" stage name, link.
29. **`documentation/master-agent/overview.md`** — XML references.
30. **`documentation/master-agent/planning.md`** — XML creation section.
31. **`documentation/master-agent/statusing.md`** — Large "XML Updates" section.
32. **`documentation/master-agent/dispatch-protocol.md`** — XML references.
33. **`documentation/swarm-lifecycle/overview.md`** — XML lifecycle references.
34. **`documentation/swarm-lifecycle/planning-phase.md`** — XML creation.
35. **`documentation/swarm-lifecycle/dispatch-phase.md`** — XML context.
36. **`documentation/swarm-lifecycle/completion-phase.md`** — "Update the Master XML".
37. **`documentation/swarm-lifecycle/monitoring-phase.md`** — "task XML".
38. **`documentation/worker-protocol/progress-reporting.md`** — "task XML" stage.
39. **`documentation/worker-protocol/overview.md`** — Worker reads task XML.
40. **`documentation/architecture/overview.md`** — XML file references.
41. **`documentation/architecture/directory-structure.md`** — "Generated XML task files".
42. **`documentation/architecture/data-flow.md`** — XML in data flow.
43. **`documentation/commands/swarm-commands.md`** — XML in command descriptions.
44. **`documentation/README.md`** — Master index XML references.

### Group 5: Other Files (3 files)

45. **`skills/synapse-swarm-orchestrator/SKILL.md`** — "task XML" mention.
46. **`skills/synapse-swarm-orchestrator/references/command-map.md`** — XML plan reference.
47. **`Synapse.md`** — "Master XML" row.

### Excluded
- `documentation/electron/services.md` — references `pom.xml` (Java build file, unrelated)
- `_commands/project/scaffold.md` — references `pom.xml` (unrelated)
- Existing `.xml` files in `tasks/` — historical artifacts, leave as-is

---

## Terminology Change

Throughout all files:
- "master XML" / "XML task file" / "task XML" → "master task file" / "task file"
- `parallel_{name}.xml` → `parallel_{name}.json`
- "XML schema" → "JSON schema"
- "XML section" → "task entry" or "task section"
- "Read the master XML" → "Read the master task file"
- "Update the master XML" → "Update the master task file"
- `reading_context` stage description: "task XML" → "task file"

---

## Execution Strategy

Given ~47 files, I'll process them in parallel batches using subagents:

1. **Batch 1** (Core — 7 files): The schema-defining files. Must be done carefully as they establish the new format. Sequential since they cross-reference each other.
2. **Batch 2** (Agent + Commands — 16 files): Can be parallelized across multiple agents.
3. **Batch 3** (Documentation — 22 files): Can be parallelized across multiple agents.
4. **Batch 4** (Other — 3 files): Quick updates.

Each edit is a terminology/format replacement — no logic changes, no app code changes. The existing XML files in `tasks/` are left untouched as historical records.

---

## What Does NOT Change

- **No application code** — No JS/JSX files are affected. The XML was never parsed programmatically.
- **No `initialization.json` schema** — Already JSON, unchanged.
- **No `logs.json` schema** — Already JSON, unchanged.
- **No progress file schema** — Already JSON, unchanged.
- **No existing task XML files** — Historical records left as-is.
- **The `.md` plan file** (`parallel_plan_{name}.md`) — Stays as Markdown, unchanged.
