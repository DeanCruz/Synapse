# PKI Schemas -- Schema Reference

The Project Knowledge Index (PKI) is a **persistent, auto-accumulating knowledge layer** that lives in the target project's `.synapse/knowledge/` directory. It gives any future Claude session rich understanding of the codebase without redundant exploration. The PKI is built incrementally by the `!learn` command and maintained by `!learn_update`, with staleness tracked by a PostToolUse hook.

This document defines the JSON schemas for all PKI data files. It is the authoritative reference for any code that reads or writes PKI data.

**Location:** `{project_root}/.synapse/knowledge/`

**Owner:** The `!learn` and `!learn_update` commands are the primary writers. The staleness hook marks files stale but does not modify content.

---

## Directory Structure

```
{project_root}/.synapse/knowledge/
├── manifest.json                  ← Master routing index (one per project)
├── annotations/                   ← Per-file deep knowledge (flat, hash-keyed)
│   ├── a1b2c3d4.json
│   ├── e5f6a7b8.json
│   └── ...
├── insights/                      ← Swarm-level lessons learned (auto-generated post-swarm)
│   ├── 2026-04-19_add-rate-limiting.json
│   └── ...
├── domains.json                   ← Auto-discovered domain taxonomy
├── patterns.json                  ← Cross-cutting patterns & conventions
└── queries/                       ← Pre-computed domain bundles (cached, gitignored)
    ├── auth.json
    └── ...
```

| File / Directory | Owner | Description |
|---|---|---|
| `manifest.json` | `!learn` / `!learn_update` / post-swarm extraction | Master routing index mapping every annotated file to its annotation hash, domains, tags, and summary. Contains reverse indexes for fast lookup by domain or tag, and `insights_index` for swarm-level knowledge. |
| `annotations/{hash}.json` | `!learn` / `!learn_update` / post-swarm extraction | Deep per-file knowledge: purpose, exports, imports, gotchas, patterns, relationships. Filename is the first 8 hex characters of the SHA-256 hash of the relative file path. Post-swarm extraction merges worker-discovered annotations into these files. |
| `insights/{date}_{slug}.json` | Post-swarm extraction (Step 17G) / `SwarmOrchestrator` | Swarm-level lessons learned: dependency insights, complexity surprises, failure patterns, effective patterns, architecture notes. Auto-generated after every swarm completion. |
| `domains.json` | `!learn` / `!learn_update` | Auto-discovered domain taxonomy grouping files by functional area (e.g., "authentication", "database", "UI components"). |
| `patterns.json` | `!learn` / `!learn_update` | Cross-cutting patterns and conventions observed across the codebase (e.g., "error handling pattern", "repository pattern", "event-driven architecture"). |
| `queries/` | `!learn` (cached output) | Pre-computed domain bundles for fast retrieval. Gitignored -- regenerated on demand. |

---

## manifest.json

The manifest is the **master routing index** for the PKI. It maps every annotated file to its metadata and provides reverse indexes for fast domain and tag lookups. Any tool that needs to find relevant knowledge starts here.

### Complete Schema

```json
{
  "version": "string",
  "generated_at": "ISO 8601 string",
  "updated_at": "ISO 8601 string",
  "stats": {
    "total_files": "number",
    "annotated_files": "number",
    "stale_files": "number",
    "domains_count": "number",
    "patterns_count": "number"
  },
  "files": {
    "{relative_path}": {
      "hash": "string",
      "content_hash": "string",
      "domains": ["string"],
      "tags": ["string"],
      "summary": "string",
      "complexity": "string",
      "stale": "boolean",
      "annotated_at": "ISO 8601 string"
    }
  },
  "domain_index": {
    "{domain_name}": ["string"]
  },
  "tag_index": {
    "{tag_name}": ["string"]
  },
  "concept_map": {
    "{concept}": {
      "files": ["string"],
      "description": "string"
    }
  }
}
```

### Field Definitions

#### Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | string | Yes | Schema version. Current: `"1.0"`. Used for forward-compatible migrations. |
| `generated_at` | ISO 8601 | Yes | Timestamp when the manifest was first created. |
| `updated_at` | ISO 8601 | Yes | Timestamp of the most recent update to the manifest. Updated on every `!learn` or `!learn_update` run. |
| `stats` | object | Yes | Aggregate statistics about the PKI. See Stats Fields below. |
| `files` | object | Yes | Map of relative file paths to their manifest entries. Keys are project-relative paths (e.g., `"src/server/index.js"`). |
| `domain_index` | object | Yes | Reverse index: domain name to array of file paths belonging to that domain. |
| `tag_index` | object | Yes | Reverse index: tag name to array of file paths with that tag. |
| `concept_map` | object | Yes | High-level concepts discovered across the codebase, each mapping to relevant files and a description. |

#### Stats Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `stats.total_files` | number | Yes | Total number of files in the project (as counted during the last scan). |
| `stats.annotated_files` | number | Yes | Number of files that have annotation entries in the manifest. |
| `stats.stale_files` | number | Yes | Number of annotated files where `stale` is `true` (content changed since last annotation). |
| `stats.domains_count` | number | Yes | Number of distinct domains in `domains.json`. |
| `stats.patterns_count` | number | Yes | Number of distinct patterns in `patterns.json`. |

#### Per-File Entry Fields (`files.{path}`)

| Field | Type | Required | Description |
|---|---|---|---|
| `hash` | string | Yes | First 8 hex characters of SHA-256 of the relative file path. Used as the annotation filename (e.g., `"a1b2c3d4"` corresponds to `annotations/a1b2c3d4.json`). |
| `content_hash` | string | Yes | SHA-256 hash of the file's content at the time of annotation. Used to detect staleness -- when the file changes, its current content hash will no longer match. |
| `domains` | array of strings | Yes | Domain names this file belongs to (e.g., `["authentication", "middleware"]`). Must all exist in `domains.json`. |
| `tags` | array of strings | Yes | Freeform tags for this file (e.g., `["express", "jwt", "security"]`). Used for cross-cutting search. |
| `summary` | string | Yes | One-line summary of the file's purpose. Shown in manifest lookups without needing to read the full annotation. |
| `complexity` | string | Yes | Assessed complexity level. One of: `"low"`, `"medium"`, `"high"`. Indicates how much context a future session needs to understand this file. |
| `stale` | boolean | Yes | Whether the file has been modified since its last annotation. Set to `true` by the staleness hook; reset to `false` by `!learn_update`. |
| `annotated_at` | ISO 8601 | Yes | Timestamp when this file was last annotated. |

### Validation Rules

| Rule | Detail |
|---|---|
| `version` | Required. Must be a non-empty string. |
| `generated_at` / `updated_at` | Required. Must be valid ISO 8601 timestamps. `updated_at` must be >= `generated_at`. |
| `stats` | Required. All sub-fields must be non-negative integers. `annotated_files` must equal the number of keys in `files`. `stale_files` must equal the count of entries in `files` where `stale === true`. |
| `files` keys | Must be project-relative paths using forward slashes (e.g., `"src/index.js"`, not `"/Users/.../src/index.js"`). |
| `files.{path}.hash` | Required. Must be exactly 8 hex characters (`/^[0-9a-f]{8}$/`). Must be unique across all entries. |
| `files.{path}.content_hash` | Required. Must be a valid SHA-256 hex string (64 characters). |
| `files.{path}.domains` | Required. Must be a non-empty array. Every domain listed must exist as a key in `domains.json`. |
| `files.{path}.tags` | Required. Must be an array (may be empty). |
| `files.{path}.complexity` | Required. Must be one of: `"low"`, `"medium"`, `"high"`. |
| `files.{path}.stale` | Required. Must be a boolean. |
| `domain_index` | Every domain key must exist in `domains.json`. Every file path in the arrays must exist as a key in `files`. |
| `tag_index` | Every file path in the arrays must exist as a key in `files`. |
| `concept_map` | Each entry must have `files` (array of valid file paths) and `description` (non-empty string). |

### Example

```json
{
  "version": "1.0",
  "generated_at": "2026-03-24T09:00:00Z",
  "updated_at": "2026-03-24T14:30:00Z",
  "stats": {
    "total_files": 142,
    "annotated_files": 38,
    "stale_files": 3,
    "domains_count": 7,
    "patterns_count": 5
  },
  "files": {
    "src/server/index.js": {
      "hash": "a1b2c3d4",
      "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "domains": ["server", "entry-points"],
      "tags": ["express", "sse", "startup"],
      "summary": "Express server entry point -- SSE streaming, file watchers, and API routes",
      "complexity": "high",
      "stale": false,
      "annotated_at": "2026-03-24T14:30:00Z"
    },
    "src/ui/components/AgentCard.jsx": {
      "hash": "e5f6a7b8",
      "content_hash": "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
      "domains": ["ui", "dashboard"],
      "tags": ["react", "component", "agent-display"],
      "summary": "Renders individual agent status card with stage badge, timer, and deviation indicators",
      "complexity": "medium",
      "stale": true,
      "annotated_at": "2026-03-24T09:15:00Z"
    },
    "src/server/services/WatcherService.js": {
      "hash": "c9d0e1f2",
      "content_hash": "2c624232cdd221771294dfbb310aca000a0df6ac8b166e8b32c4b2b6d2a2c5b0",
      "domains": ["server", "file-watching"],
      "tags": ["fs-watch", "progress", "reconciliation"],
      "summary": "Watches progress/ and initialization.json for changes, triggers SSE broadcasts",
      "complexity": "high",
      "stale": false,
      "annotated_at": "2026-03-24T10:00:00Z"
    }
  },
  "domain_index": {
    "server": ["src/server/index.js", "src/server/services/WatcherService.js"],
    "ui": ["src/ui/components/AgentCard.jsx"],
    "dashboard": ["src/ui/components/AgentCard.jsx"],
    "entry-points": ["src/server/index.js"],
    "file-watching": ["src/server/services/WatcherService.js"]
  },
  "tag_index": {
    "express": ["src/server/index.js"],
    "sse": ["src/server/index.js"],
    "react": ["src/ui/components/AgentCard.jsx"],
    "component": ["src/ui/components/AgentCard.jsx"],
    "fs-watch": ["src/server/services/WatcherService.js"],
    "progress": ["src/server/services/WatcherService.js"]
  },
  "concept_map": {
    "real-time dashboard updates": {
      "files": ["src/server/index.js", "src/server/services/WatcherService.js", "src/ui/components/AgentCard.jsx"],
      "description": "SSE-based push from server file watchers to React dashboard components for live agent status rendering"
    },
    "progress file lifecycle": {
      "files": ["src/server/services/WatcherService.js", "src/server/index.js"],
      "description": "Worker writes progress JSON, WatcherService detects change, server validates and broadcasts via SSE"
    }
  }
}
```

---

## Annotation Files

Annotation files contain **deep per-file knowledge** about a single source file. They are stored in the `annotations/` subdirectory with filenames derived from the SHA-256 hash of the file's relative path. Each annotation is a self-contained knowledge record that a future Claude session can load to understand a file without reading and analyzing it from scratch.

**Location:** `{project_root}/.synapse/knowledge/annotations/{hash}.json`

**Filename derivation:** First 8 hex characters of `SHA-256(relative_file_path)`. For example, `SHA-256("src/server/index.js")` might produce `a1b2c3d4e5f6...`, so the annotation file is `a1b2c3d4.json`.

### Complete Schema

```json
{
  "file": "string",
  "content_hash": "string",
  "annotated_at": "ISO 8601 string",
  "annotated_by": "string",
  "purpose": "string",
  "exports": [
    {
      "name": "string",
      "type": "string",
      "description": "string"
    }
  ],
  "imports_from": [
    {
      "file": "string",
      "symbols": ["string"]
    }
  ],
  "gotchas": ["string"],
  "patterns": ["string"],
  "conventions": ["string"],
  "relationships": [
    {
      "file": "string",
      "relationship": "string",
      "description": "string"
    }
  ],
  "domains": ["string"],
  "tags": ["string"]
}
```

### Field Definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | string | Yes | Relative path to the annotated file (e.g., `"src/server/index.js"`). Must match the path used to derive the annotation filename hash. |
| `content_hash` | string | Yes | SHA-256 hash of the file's content at annotation time. Must match the corresponding entry in `manifest.json`. When these diverge, the annotation is stale. |
| `annotated_at` | ISO 8601 | Yes | Timestamp when this annotation was created or last updated. |
| `annotated_by` | string | Yes | Identifier of the command that created the annotation (e.g., `"!learn"`, `"!learn_update"`). |
| `purpose` | string | Yes | Multi-sentence description of the file's purpose, role in the architecture, and key responsibilities. More detailed than the manifest `summary`. |
| `exports` | array of objects | Yes | Symbols exported by this file (functions, classes, constants, types, etc.). May be empty for files with no exports (e.g., config files, stylesheets). |
| `exports[].name` | string | Yes | Name of the exported symbol (e.g., `"createServer"`, `"UserModel"`, `"DEFAULT_TIMEOUT"`). |
| `exports[].type` | string | Yes | Kind of export. One of: `"function"`, `"class"`, `"constant"`, `"type"`, `"interface"`, `"component"`, `"middleware"`, `"enum"`, `"object"`, `"default"`. |
| `exports[].description` | string | Yes | What this export does and how it is used by consumers. |
| `imports_from` | array of objects | Yes | Files that this file imports from (dependency edges). May be empty for leaf files. |
| `imports_from[].file` | string | Yes | Relative path of the imported file. |
| `imports_from[].symbols` | array of strings | Yes | Symbol names imported from that file. Use `["*"]` for wildcard/namespace imports. |
| `gotchas` | array of strings | Yes | Non-obvious behaviors, edge cases, foot-guns, or things a developer should know before modifying this file. May be empty. |
| `patterns` | array of strings | Yes | Design patterns used in this file (e.g., `"singleton"`, `"observer"`, `"factory"`). Must reference patterns defined in `patterns.json` when applicable. May be empty. |
| `conventions` | array of strings | Yes | Project-specific conventions this file follows (e.g., `"error-first callbacks"`, `"JSDoc on all exports"`). May be empty. |
| `relationships` | array of objects | Yes | Significant architectural relationships beyond simple imports (e.g., "serves data to", "subscribes to events from", "mirrors schema of"). May be empty. |
| `relationships[].file` | string | Yes | Relative path of the related file. |
| `relationships[].relationship` | string | Yes | Type of relationship. One of: `"serves"`, `"consumes"`, `"mirrors"`, `"extends"`, `"configures"`, `"tests"`, `"documents"`, `"subscribes"`, `"publishes"`, `"other"`. |
| `relationships[].description` | string | Yes | Human-readable description of the relationship and its significance. |
| `domains` | array of strings | Yes | Domain names this file belongs to. Must match the `domains` in the corresponding manifest entry. |
| `tags` | array of strings | Yes | Freeform tags. Must match the `tags` in the corresponding manifest entry. |

### Validation Rules

| Rule | Detail |
|---|---|
| `file` | Required. Must be a project-relative path using forward slashes. |
| `content_hash` | Required. Must be a valid SHA-256 hex string (64 characters). Must match `manifest.json` entry for this file when the annotation is fresh (not stale). |
| `annotated_at` | Required. Must be a valid ISO 8601 timestamp. |
| `annotated_by` | Required. Must be a non-empty string. |
| `purpose` | Required. Must be a non-empty string. Minimum recommended length: 50 characters. |
| `exports` | Required. Must be an array. Each entry must have `name`, `type`, and `description` -- all non-empty strings. `type` must be one of the allowed values. |
| `imports_from` | Required. Must be an array. Each entry must have `file` (non-empty string) and `symbols` (non-empty array of strings). |
| `gotchas` | Required. Must be an array of strings. |
| `patterns` | Required. Must be an array of strings. |
| `conventions` | Required. Must be an array of strings. |
| `relationships` | Required. Must be an array. Each entry must have `file`, `relationship`, and `description` -- all non-empty strings. `relationship` must be one of the allowed values. |
| `domains` / `tags` | Required. Must be arrays of strings. `domains` must be non-empty. Must match the corresponding manifest entry. |
| Filename consistency | The annotation filename (minus `.json`) must equal the `hash` field in the manifest entry for `file`. |

### Example

```json
{
  "file": "src/server/index.js",
  "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "annotated_at": "2026-03-24T14:30:00Z",
  "annotated_by": "!learn",
  "purpose": "Express server entry point for the Synapse dashboard. Creates the HTTP server, sets up SSE streaming endpoints for real-time dashboard updates, initializes file watchers for progress and initialization files, and registers all API routes. This is the first file loaded when the server starts and orchestrates all server-side subsystems.",
  "exports": [
    {
      "name": "app",
      "type": "object",
      "description": "Express application instance, exported for testing"
    },
    {
      "name": "startServer",
      "type": "function",
      "description": "Initializes watchers, registers routes, and begins listening on the configured port"
    }
  ],
  "imports_from": [
    {
      "file": "src/server/services/WatcherService.js",
      "symbols": ["WatcherService"]
    },
    {
      "file": "src/server/utils/json.js",
      "symbols": ["safeParseJSON", "isValidProgress"]
    }
  ],
  "gotchas": [
    "SSE connections are not authenticated -- any client on the network can subscribe",
    "The reconciliation interval (5s) means there can be a brief delay between file write and dashboard update if the OS watcher misses an event",
    "Port defaults to 4000 but can be overridden via PORT env var -- Electron app hardcodes 4000"
  ],
  "patterns": [
    "event-driven-architecture",
    "singleton-service"
  ],
  "conventions": [
    "All routes registered in a single setup function rather than separate route files",
    "Error responses use { error: string } shape consistently"
  ],
  "relationships": [
    {
      "file": "src/server/services/WatcherService.js",
      "relationship": "consumes",
      "description": "Receives file change events from WatcherService and broadcasts them as SSE events to connected clients"
    },
    {
      "file": "src/ui/hooks/useDashboardData.js",
      "relationship": "serves",
      "description": "Provides SSE stream consumed by the React dashboard's useDashboardData hook"
    },
    {
      "file": "electron/main.js",
      "relationship": "configures",
      "description": "Electron main process spawns this server as a child process and connects to it on port 4000"
    }
  ],
  "domains": ["server", "entry-points"],
  "tags": ["express", "sse", "startup"]
}
```

---

## domains.json

The domains file defines the **auto-discovered domain taxonomy** for the project. Domains are functional areas of the codebase (e.g., "authentication", "database", "UI components"). They are discovered during `!learn` by analyzing file purposes, directory structure, and import graphs, then refined over time by `!learn_update`.

**Location:** `{project_root}/.synapse/knowledge/domains.json`

### Complete Schema

```json
{
  "version": "string",
  "updated_at": "ISO 8601 string",
  "domains": {
    "{domain_name}": {
      "description": "string",
      "files": ["string"],
      "auto_discovered": "boolean",
      "parent": "string | null",
      "keywords": ["string"]
    }
  }
}
```

### Field Definitions

#### Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | string | Yes | Schema version. Current: `"1.0"`. |
| `updated_at` | ISO 8601 | Yes | Timestamp of the most recent update. |
| `domains` | object | Yes | Map of domain names to domain definitions. Keys are lowercase, hyphenated identifiers (e.g., `"file-watching"`, `"ui-components"`). |

#### Per-Domain Fields (`domains.{name}`)

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | string | Yes | Human-readable description of the domain's scope and responsibility. Should clearly delineate what belongs in this domain versus adjacent domains. |
| `files` | array of strings | Yes | File paths belonging to this domain. Must be project-relative paths that also exist in `manifest.json`. |
| `auto_discovered` | boolean | Yes | Whether this domain was automatically discovered by `!learn` (`true`) or manually defined/refined by the user (`false`). |
| `parent` | string or null | No | Parent domain name for hierarchical taxonomy (e.g., `"ui"` might be the parent of `"ui-components"`). `null` for top-level domains. If present, must reference an existing domain key. |
| `keywords` | array of strings | No | Additional keywords that help classify files into this domain during future scans. Used by `!learn_update` to auto-assign domains to new files. |

### Validation Rules

| Rule | Detail |
|---|---|
| `version` | Required. Must be a non-empty string. |
| `updated_at` | Required. Must be a valid ISO 8601 timestamp. |
| `domains` | Required. Must be an object with at least one entry. |
| Domain keys | Must be lowercase, hyphenated identifiers (`/^[a-z][a-z0-9-]*$/`). |
| `description` | Required. Must be a non-empty string. |
| `files` | Required. Must be an array of project-relative paths. Every path must exist as a key in `manifest.json`. |
| `auto_discovered` | Required. Must be a boolean. |
| `parent` | If present and non-null, must reference an existing domain key. No circular references allowed. |
| `keywords` | If present, must be an array of non-empty strings. |
| Consistency | Every file path in `files` must list this domain in its `manifest.json` entry's `domains` array. Conversely, every file in the manifest that lists this domain must appear in this domain's `files` array. |

### Example

```json
{
  "version": "1.0",
  "updated_at": "2026-03-24T14:30:00Z",
  "domains": {
    "server": {
      "description": "Backend Express server including HTTP endpoints, SSE streaming, and server-side utilities. Handles all API requests and real-time dashboard communication.",
      "files": [
        "src/server/index.js",
        "src/server/services/WatcherService.js",
        "src/server/utils/json.js"
      ],
      "auto_discovered": true,
      "parent": null,
      "keywords": ["express", "http", "api", "endpoint", "route"]
    },
    "file-watching": {
      "description": "File system observation layer that detects changes to progress files and initialization data, triggering SSE broadcasts to the dashboard.",
      "files": [
        "src/server/services/WatcherService.js"
      ],
      "auto_discovered": true,
      "parent": "server",
      "keywords": ["fs.watch", "chokidar", "file-change", "watcher"]
    },
    "ui": {
      "description": "React-based dashboard frontend including components, hooks, context providers, and styles. Renders real-time swarm status from SSE data.",
      "files": [
        "src/ui/App.jsx",
        "src/ui/components/AgentCard.jsx",
        "src/ui/hooks/useDashboardData.js",
        "src/ui/context/AppContext.jsx"
      ],
      "auto_discovered": true,
      "parent": null,
      "keywords": ["react", "component", "jsx", "hook", "context"]
    },
    "dashboard": {
      "description": "Dashboard-specific UI components and logic for rendering agent cards, stats, and swarm progress. Subset of UI focused on the monitoring experience.",
      "files": [
        "src/ui/components/AgentCard.jsx",
        "src/ui/hooks/useDashboardData.js"
      ],
      "auto_discovered": true,
      "parent": "ui",
      "keywords": ["agent-card", "stats", "progress", "dashboard"]
    },
    "entry-points": {
      "description": "Application entry points -- the files that bootstrap major subsystems (server, Electron app, CLI).",
      "files": [
        "src/server/index.js",
        "electron/main.js"
      ],
      "auto_discovered": true,
      "parent": null,
      "keywords": ["main", "entry", "bootstrap", "startup"]
    },
    "electron": {
      "description": "Electron desktop application shell including main process, preload scripts, and IPC handlers.",
      "files": [
        "electron/main.js",
        "electron/preload.js",
        "electron/services/PromptBuilder.js"
      ],
      "auto_discovered": true,
      "parent": null,
      "keywords": ["electron", "ipc", "preload", "browserwindow"]
    },
    "commands": {
      "description": "Synapse command definitions (markdown files in _commands/) that define the prompts, flows, and behaviors for each ! command.",
      "files": [
        "_commands/project/learn.md",
        "_commands/project/learn_update.md"
      ],
      "auto_discovered": false,
      "parent": null,
      "keywords": ["command", "prompt", "workflow"]
    }
  }
}
```

---

## patterns.json

The patterns file captures **cross-cutting patterns and conventions** observed across the codebase. Unlike domains (which group files by functional area), patterns describe recurring structural or behavioral approaches that span multiple domains. They help future sessions understand "how things are done here" without re-discovering conventions.

**Location:** `{project_root}/.synapse/knowledge/patterns.json`

### Complete Schema

```json
{
  "version": "string",
  "updated_at": "ISO 8601 string",
  "patterns": {
    "{pattern_name}": {
      "description": "string",
      "files": ["string"],
      "examples": [
        {
          "file": "string",
          "description": "string",
          "line_range": "string | null"
        }
      ],
      "category": "string"
    }
  }
}
```

### Field Definitions

#### Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | string | Yes | Schema version. Current: `"1.0"`. |
| `updated_at` | ISO 8601 | Yes | Timestamp of the most recent update. |
| `patterns` | object | Yes | Map of pattern names to pattern definitions. Keys are lowercase, hyphenated identifiers (e.g., `"event-driven-architecture"`, `"singleton-service"`). |

#### Per-Pattern Fields (`patterns.{name}`)

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | string | Yes | Human-readable description of the pattern: what it is, why it is used, and how to apply it correctly. Should be detailed enough for a new developer or Claude session to follow the pattern without seeing an example. |
| `files` | array of strings | Yes | File paths where this pattern is implemented. Must be project-relative paths. |
| `examples` | array of objects | Yes | Concrete examples of the pattern in the codebase, with pointers to specific files and descriptions of how the pattern manifests. Must contain at least one example. |
| `examples[].file` | string | Yes | Relative path to the file containing the example. Must be in the `files` array. |
| `examples[].description` | string | Yes | What this example demonstrates about the pattern and how the implementation follows it. |
| `examples[].line_range` | string or null | No | Approximate line range where the pattern is most visible (e.g., `"45-78"`). `null` if the pattern spans the entire file. Line ranges are advisory and may drift as the file changes. |
| `category` | string | Yes | Classification of the pattern. One of: `"structural"`, `"behavioral"`, `"creational"`, `"architectural"`, `"convention"`, `"error-handling"`, `"testing"`, `"data-flow"`. |

### Validation Rules

| Rule | Detail |
|---|---|
| `version` | Required. Must be a non-empty string. |
| `updated_at` | Required. Must be a valid ISO 8601 timestamp. |
| `patterns` | Required. Must be an object with at least one entry. |
| Pattern keys | Must be lowercase, hyphenated identifiers (`/^[a-z][a-z0-9-]*$/`). |
| `description` | Required. Must be a non-empty string. Minimum recommended length: 80 characters. |
| `files` | Required. Must be a non-empty array of project-relative paths. |
| `examples` | Required. Must be a non-empty array (at least one example per pattern). |
| `examples[].file` | Required. Must be a file path that exists in the pattern's `files` array. |
| `examples[].description` | Required. Must be a non-empty string. |
| `examples[].line_range` | If present and non-null, must match the format `"N-M"` where N and M are positive integers and N <= M. |
| `category` | Required. Must be one of: `"structural"`, `"behavioral"`, `"creational"`, `"architectural"`, `"convention"`, `"error-handling"`, `"testing"`, `"data-flow"`. |

### Example

```json
{
  "version": "1.0",
  "updated_at": "2026-03-24T14:30:00Z",
  "patterns": {
    "event-driven-architecture": {
      "description": "Components communicate through events rather than direct calls. The server uses SSE (Server-Sent Events) to push file change notifications to the browser. File watchers emit events that the server translates into SSE broadcasts. This decouples the file-watching layer from the HTTP layer and allows multiple clients to receive updates simultaneously.",
      "files": [
        "src/server/index.js",
        "src/server/services/WatcherService.js",
        "src/ui/hooks/useDashboardData.js"
      ],
      "examples": [
        {
          "file": "src/server/services/WatcherService.js",
          "description": "WatcherService uses fs.watch to detect file changes, then emits events that the server listens to and re-broadcasts as SSE events to connected clients",
          "line_range": "25-80"
        },
        {
          "file": "src/ui/hooks/useDashboardData.js",
          "description": "useDashboardData hook subscribes to the SSE EventSource and updates React state when agent_progress events arrive",
          "line_range": "10-45"
        }
      ],
      "category": "architectural"
    },
    "singleton-service": {
      "description": "Service classes are instantiated once and shared across the application. Rather than creating new instances per request, services like WatcherService maintain state across the server's lifetime. This is essential for file watchers (which hold OS handles) and SSE connections (which persist across requests).",
      "files": [
        "src/server/services/WatcherService.js"
      ],
      "examples": [
        {
          "file": "src/server/services/WatcherService.js",
          "description": "WatcherService is instantiated once in index.js and passed to route handlers, maintaining a single set of file watchers for the entire server lifecycle",
          "line_range": null
        }
      ],
      "category": "creational"
    },
    "full-file-overwrite": {
      "description": "When updating JSON data files (progress files, initialization files), the writer constructs the complete object in memory and writes the entire file. No read-modify-write cycle. This avoids race conditions and ensures atomic writes when combined with temp-file-then-rename. Workers, the master, and the server all follow this pattern for any file they own.",
      "files": [
        "src/server/services/WatcherService.js",
        "src/server/utils/json.js"
      ],
      "examples": [
        {
          "file": "src/server/utils/json.js",
          "description": "safeParseJSON reads the entire file and parses it atomically, complementing the full-file-overwrite pattern by ensuring reads never see partial state",
          "line_range": null
        }
      ],
      "category": "convention"
    },
    "safe-json-parsing": {
      "description": "All JSON file reads go through a safe parsing utility that handles file-not-found, partial writes, and malformed JSON gracefully. Rather than letting JSON.parse throw, the utility returns null or a default value, and callers check the result. This is critical because files may be mid-write when read (OS watcher fires before write completes).",
      "files": [
        "src/server/utils/json.js",
        "src/server/services/WatcherService.js"
      ],
      "examples": [
        {
          "file": "src/server/utils/json.js",
          "description": "safeParseJSON wraps fs.readFile + JSON.parse in try/catch, returning null on any error, with optional retry logic for transient failures",
          "line_range": "1-30"
        }
      ],
      "category": "error-handling"
    },
    "context-provider-pattern": {
      "description": "React application state is managed through Context providers at the top of the component tree. Components consume context via custom hooks rather than prop drilling. Each major feature area (dashboard data, app settings) has its own context + provider + hook triad.",
      "files": [
        "src/ui/context/AppContext.jsx",
        "src/ui/App.jsx"
      ],
      "examples": [
        {
          "file": "src/ui/context/AppContext.jsx",
          "description": "AppContext provides global application state (project path, dashboard selection) to all child components via useContext",
          "line_range": null
        }
      ],
      "category": "structural"
    }
  }
}
```

---

## insights/{date}_{slug}.json

The insights directory contains **swarm-level lessons learned** — knowledge that transcends individual file annotations. Each file captures what a swarm discovered about the project's architecture, dependencies, and failure modes. Insights are generated automatically after every swarm completion (Step 17G) and indexed in the manifest's `insights_index`.

**Location:** `{project_root}/.synapse/knowledge/insights/{YYYY-MM-DD}_{task-slug}.json`

**Owner:** Post-swarm knowledge extraction (Step 17G in `p_track_completion.md`) and `SwarmOrchestrator.extractSwarmKnowledge()`.

### Complete Schema

```json
{
  "swarm_name": "string",
  "completed_at": "ISO 8601 string",
  "dashboard_id": "string",
  "total_tasks": "number",
  "completed_tasks": "number",
  "failed_tasks": "number",
  "files_changed": ["string"],
  "insights": {
    "dependency_insights": [
      {
        "description": "string",
        "discovered_by": "string (task_id)",
        "severity": "string (CRITICAL | MODERATE | MINOR)",
        "affected_files": ["string"]
      }
    ],
    "complexity_surprises": [
      {
        "description": "string",
        "discovered_by": "string (task_id)",
        "affected_files": ["string"]
      }
    ],
    "failure_patterns": [
      {
        "description": "string",
        "task_id": "string",
        "stage": "string"
      }
    ],
    "effective_patterns": [
      {
        "description": "string",
        "tasks_involved": ["string"]
      }
    ],
    "architecture_notes": [
      {
        "description": "string",
        "discovered_by": "string (task_id)",
        "severity": "string"
      }
    ]
  },
  "worker_annotations_harvested": "number"
}
```

### Field Definitions

#### Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `swarm_name` | string | Yes | The task slug identifying this swarm run. |
| `completed_at` | ISO 8601 | Yes | When the swarm completed. |
| `dashboard_id` | string | Yes | Dashboard ID for traceability back to dashboard data. |
| `total_tasks` | number | Yes | Total tasks in the swarm. |
| `completed_tasks` | number | Yes | Successfully completed tasks. |
| `failed_tasks` | number | Yes | Failed tasks. |
| `files_changed` | array of strings | Yes | All project-relative file paths changed during this swarm. |
| `insights` | object | Yes | Categorized insights extracted from swarm execution data. |
| `worker_annotations_harvested` | number | Yes | Count of individual annotations harvested from worker progress files. |

#### Insight Categories

| Category | What It Captures | Source Data |
|---|---|---|
| `dependency_insights` | Dependencies not in the original plan — discovered during execution | CRITICAL deviations from workers |
| `complexity_surprises` | Files/areas harder than expected | Task duration anomalies, worker warnings |
| `failure_patterns` | Recurring failure modes and root causes | Failed task progress files |
| `effective_patterns` | Approaches that worked well — worth repeating | Successful tasks with clean execution |
| `architecture_notes` | Discovered architectural constraints or design decisions | MODERATE deviations, worker logs |

### Manifest Integration

The manifest's `insights_index` array tracks all insight files:

```json
{
  "insights_index": [
    {
      "file": "insights/2026-04-19_add-rate-limiting.json",
      "swarm_name": "add-rate-limiting",
      "date": "2026-04-19",
      "insight_count": 3,
      "files_changed_count": 5
    }
  ]
}
```

**Rules:**
- Append-only — never overwrite previous entries
- Capped at 50 entries (FIFO — oldest entries dropped when cap is reached)
- `insight_count` is the sum of all items across all insight categories
- `files_changed_count` is the length of `files_changed` in the insight file

---

## Queries Directory

The `queries/` directory contains **pre-computed domain bundles** -- cached aggregations of annotations by domain for fast retrieval. These files are generated on demand by `!learn` and should be gitignored (they can be regenerated from the manifest and annotations).

**Location:** `{project_root}/.synapse/knowledge/queries/{domain_name}.json`

Query files are not governed by a strict schema as they are cached output derived from the primary schemas above. Their format may evolve without a version bump. They should be treated as disposable cache.

---

## Cross-Schema Consistency Rules

The four PKI files form an interconnected data model. These consistency rules must hold across all files simultaneously:

| Rule | Enforcement |
|---|---|
| Every file in `manifest.json` `files` that lists a domain must appear in that domain's `files` array in `domains.json` | `!learn` and `!learn_update` maintain bidirectional consistency |
| Every domain referenced in a manifest `files.{path}.domains` must exist as a key in `domains.json` | Write-time validation |
| Every annotation file's `domains` and `tags` must match its manifest entry | `!learn_update` reconciles discrepancies |
| Annotation filename (minus `.json`) must equal the `hash` in the corresponding manifest entry | Derived deterministically from file path |
| `manifest.json` `domain_index` must be the exact inverse of individual file `domains` arrays | Rebuilt on every manifest write |
| `manifest.json` `tag_index` must be the exact inverse of individual file `tags` arrays | Rebuilt on every manifest write |
| `stats.annotated_files` must equal `Object.keys(files).length` | Computed on write |
| `stats.stale_files` must equal the count of files where `stale === true` | Computed on write |
| `manifest.json` `content_hash` and annotation `content_hash` must match for non-stale files | Staleness hook sets `stale: true` when they diverge |

---

## Staleness Model

The PKI uses a **content-hash-based staleness model** to track when annotations are outdated:

1. When `!learn` annotates a file, it computes `SHA-256(file_contents)` and stores it as `content_hash` in both the manifest entry and the annotation file.
2. When a file is modified (detected by the PostToolUse staleness hook), the hook computes the new content hash and compares it to the manifest's `content_hash`.
3. If they differ, the hook sets `stale: true` on the manifest entry and increments `stats.stale_files`.
4. When `!learn_update` runs, it re-annotates stale files: updates the annotation, recomputes the content hash, and resets `stale` to `false`.

This model avoids false positives from timestamp-only checks (which fire on `touch` or file copy) and false negatives from format-only changes (which change content but not behavior).

---

## Related Documentation

- [Data Architecture Overview](./overview.md) -- High-level data model and ownership for all Synapse data files
- [Progress Files Schema](./progress-files.md) -- Worker progress file format (the pattern this document follows)
- [initialization.json Schema](./initialization-json.md) -- Swarm plan data
- [logs.json Schema](./logs-json.md) -- Event log format
