# Server Configuration

The Synapse SSE server is a zero-dependency Node.js process defined in `src/server/index.js`. All server-side configuration is centralized in a single file:

```
src/server/utils/constants.js
```

This file exports every constant the server needs: paths, ports, timing intervals, MIME types, and default data shapes. There is no separate config file, no `.env` loader, and no runtime configuration API — everything is resolved at module load time.

---

## Port

```js
const PORT = process.env.PORT || 3456;
```

| Property | Value |
|---|---|
| **Environment variable** | `PORT` |
| **Default** | `3456` |
| **Protocol** | HTTP (no TLS — the server is designed for localhost use) |

To run on a different port:

```bash
PORT=8080 node src/server/index.js
```

The Electron app connects to this port for SSE streaming.

---

## Directory Paths

All paths are derived from `ROOT`, which resolves to the Synapse repository root (three directories above `constants.js`):

```js
const ROOT = path.resolve(__dirname, '..', '..', '..');
```

| Constant | Resolved Path | Purpose |
|---|---|---|
| `ROOT` | `{tracker_root}` | Repository root — the anchor for all other paths |
| `DASHBOARDS_DIR` | `{tracker_root}/dashboards` | Contains `dashboard1/` through `dashboard5/`, each with `initialization.json`, `logs.json`, and `progress/` |
| `QUEUE_DIR` | `{tracker_root}/queue` | Overflow queue slots for swarms waiting for a dashboard |
| `ARCHIVE_DIR` | `{tracker_root}/Archive` | Archived dashboard snapshots from completed swarms |
| `HISTORY_DIR` | `{tracker_root}/history` | Summary JSON files for past swarms |
| `CONVERSATIONS_DIR` | `{tracker_root}/conversations` | Conversation data storage |

These paths are absolute and computed once at startup. They are not configurable via environment variables — relocating Synapse means the paths automatically adjust because they are relative to the module's file location.

---

## Timing Constants

The server uses several timing constants to control file-watching behavior, SSE heartbeats, and reconciliation loops. These are tuned for responsiveness without excessive CPU usage.

### File Watching

| Constant | Default | Purpose |
|---|---|---|
| `INIT_POLL_MS` | `100` ms | `fs.watchFile` polling interval for `initialization.json` and `logs.json`. These files use polling (not `fs.watch`) because they are modified by external processes (the master agent) and some platforms do not reliably deliver `fs.watch` events for external writes. |
| `PROGRESS_READ_DELAY_MS` | `30` ms | Delay before reading a progress file after a `fs.watch` change event fires. This gives the writing process time to finish the atomic write, reducing the chance of reading a partially-written file. |
| `PROGRESS_RETRY_MS` | `80` ms | If a progress file read fails (e.g., mid-write, JSON parse error), the server retries after this delay. Combined with `PROGRESS_READ_DELAY_MS`, this provides a two-stage defense against read-during-write races. |

### Reconciliation

| Constant | Default | Purpose |
|---|---|---|
| `RECONCILE_DEBOUNCE_MS` | `300` ms | When `fs.watch` fires multiple rapid events for the same directory (common on macOS), the server debounces reconciliation to avoid redundant scans. |
| `RECONCILE_INTERVAL_MS` | `5000` ms | Periodic full reconciliation of the `progress/` directory. This catches any file changes that `fs.watch` may have missed (a known reliability issue on some platforms). Acts as a safety net. |
| `DEPENDENCY_CHECK_DELAY_MS` | `100` ms | After a progress file status change (e.g., a worker completes), the server waits this long before running a dependency check. This allows batch status changes to settle before triggering downstream logic. |

### SSE

| Constant | Default | Purpose |
|---|---|---|
| `HEARTBEAT_MS` | `15000` ms | Interval between SSE heartbeat pings (`:ping` comments). Keeps the connection alive through proxies and load balancers that may terminate idle connections. |

### Timing Flow

A typical progress update flows through the timing pipeline like this:

```
Worker writes progress file
        │
        ▼
fs.watch fires change event
        │
        ▼
Wait PROGRESS_READ_DELAY_MS (30ms)
        │
        ▼
Read and parse JSON
        │
   ┌────┴──── Parse fails?
   │                │
   │          Wait PROGRESS_RETRY_MS (80ms)
   │                │
   │          Retry read
   │                │
   └────────────────┘
        │
        ▼
Broadcast SSE "agent_progress" event
        │
        ▼
If status changed: wait DEPENDENCY_CHECK_DELAY_MS (100ms), then run dependency check
```

---

## MIME Types

The server serves static files for the dashboard frontend. It uses a minimal MIME type map:

```js
const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
};
```

Files with extensions not in this map are served without a `Content-Type` header (the browser will attempt to infer the type). This is sufficient for the dashboard, which only serves HTML, CSS, JS, and JSON.

---

## Default Data Shapes

When a dashboard is reset or initialized, the server uses these default shapes:

### Default initialization.json

```js
const DEFAULT_INITIALIZATION = {
  task: null,
  agents: [],
  waves: [],
  chains: [],
  history: []
};
```

A `null` task indicates an empty dashboard with no active swarm. The master agent writes the full `initialization.json` during the planning phase, populating all fields.

### Default logs.json

```js
const DEFAULT_LOGS = {
  entries: []
};
```

An empty entries array. The master agent appends entries throughout the swarm lifecycle.

---

## Modifying Server Configuration

Because all constants are hardcoded in a single file, modifying server behavior requires editing `src/server/utils/constants.js` directly. There is no runtime configuration API.

**Common modifications:**

| Goal | Change |
|---|---|
| Change the server port | Set `PORT` environment variable (no code change needed) |
| Adjust file-watching sensitivity | Modify `PROGRESS_READ_DELAY_MS` and `PROGRESS_RETRY_MS` |
| Reduce CPU usage from polling | Increase `INIT_POLL_MS` and `RECONCILE_INTERVAL_MS` |
| Adjust SSE keepalive frequency | Modify `HEARTBEAT_MS` |

**Note:** The server is designed as a zero-dependency, single-file service. The simplicity of hardcoded constants is intentional — it avoids configuration file parsing, validation, and the associated failure modes. For most users, the defaults work without modification.

---

## Related Documentation

- [Configuration Overview](overview.md) — How all configuration layers fit together.
- [Electron Configuration](electron-config.md) — Desktop app settings that complement server configuration.
