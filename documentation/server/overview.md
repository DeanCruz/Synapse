# Server Architecture Overview

The Synapse server is a lightweight, zero-dependency Node.js HTTP server that provides real-time dashboard updates via Server-Sent Events (SSE) and a REST API for managing dashboards, archives, history, and queues. It uses only Node.js built-in modules (`http`, `fs`, `path`) with no external npm dependencies.

---

## Entry Point

**File:** `src/server/index.js`

The server entry point wires together all services, routes, and SSE management. It creates a standard `http.createServer` instance, configures CORS headers, and delegates requests to the SSE endpoint (`/events`) or the API route handler.

### Server Creation

```javascript
const server = http.createServer((req, res) => {
  // CORS headers applied to every request
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Request logging on response finish (skips OPTIONS and SSE)
  // Routes to /events for SSE, handleApiRoute() for REST, or 404
});
```

### Request Routing Flow

```
Incoming Request
       |
       v
OPTIONS? --> 204 No Content (CORS preflight)
       |
       v
GET /events? --> SSE connection setup
       |
       v
API route match? --> handleApiRoute() handles it
       |
       v
404 Not Found
```

---

## Module Architecture

The server is organized into a clean modular structure with separation of concerns:

```
src/server/
  index.js              (218 lines) -- HTTP server entry point, startup, shutdown
  SSEManager.js         (108 lines) -- SSE client tracking, broadcast, heartbeat
  routes/
    apiRoutes.js        (507 lines) -- All REST API endpoint handlers
  services/
    ArchiveService.js    (72 lines) -- Archive management
    DashboardService.js (232 lines) -- Dashboard CRUD and file I/O
    DependencyService.js(198 lines) -- Task dependency graph resolution
    HistoryService.js   (140 lines) -- History summary generation
    QueueService.js     (162 lines) -- Queue management
    WatcherService.js   (364 lines) -- File system watchers for live updates
  utils/
    constants.js         (48 lines) -- All configuration constants
    json.js             (194 lines) -- JSON read/write utilities with validation
    validation.js        (88 lines) -- Dependency graph validation (cycles, dangling refs)
```

### Module Dependency Graph

```
index.js
  |-- SSEManager.js
  |     |-- constants.js
  |-- DashboardService.js
  |     |-- constants.js
  |     |-- json.js
  |-- WatcherService.js
  |     |-- DashboardService.js
  |     |-- QueueService.js
  |     |-- DependencyService.js
  |     |-- json.js
  |     |-- constants.js
  |-- QueueService.js
  |     |-- constants.js
  |     |-- json.js
  |-- apiRoutes.js
        |-- DashboardService.js
        |-- ArchiveService.js
        |-- HistoryService.js
        |-- QueueService.js
        |-- DependencyService.js
        |-- json.js
        |-- constants.js

validation.js (standalone utility — not imported by server, used by master agent)
```

---

## Startup Sequence

The `startup()` function executes the following steps in order:

| Step | Action | Description |
|------|--------|-------------|
| 1 | Ensure `dashboards/` directory | Creates the dashboards root directory if missing |
| 2 | Ensure default dashboard | If no dashboards exist, creates `dashboard1` with default files |
| 3 | Ensure system directories | Creates `Archive/`, `history/`, and `queue/` directories if missing |
| 4 | Start dashboard watchers | Calls `watchDashboard()` for each existing dashboard |
| 5 | Start dashboards directory watcher | Watches for new/removed dashboard subdirectories |
| 5b | Start queue directory watcher | Watches for new/removed queue items |
| 5c | Start periodic reconciliation | Polls for missed `fs.watch` events at `RECONCILE_INTERVAL_MS` |
| 6 | Start SSE heartbeat | Sends keep-alive pings at `HEARTBEAT_MS` intervals |

The server then begins listening on the configured `PORT` (default: 3456).

### Startup Console Output

```
Synapse Dashboard (Multi-Dashboard)
Synapse server listening on port 3456

Dashboards directory: /path/to/Synapse/dashboards
Active dashboards: dashboard1, dashboard2
Watching per dashboard: initialization.json (100ms), logs.json (100ms), progress/ (fs.watch)
Watching: dashboards/ directory for new/removed dashboards
Watching: queue/ directory for queued tasks
SSE clients: /events
API: /api/dashboards, /api/dashboards/:id/{initialization,logs,progress,clear,archive,export}
API: /api/archives, /api/archives/:name
API: /api/queue, /api/queue/:id
API: /api/history
Archive directory: /path/to/Synapse/Archive
History directory: /path/to/Synapse/history
```

---

## Graceful Shutdown

The server handles `SIGINT` and `SIGTERM` signals for clean shutdown:

| Step | Action |
|------|--------|
| 1 | Stop all watchers (dashboard file watchers, directory watchers, reconciliation timers) |
| 2 | Stop SSE heartbeat timer |
| 3 | Close all SSE client connections |
| 4 | Close the HTTP server |
| 5 | Exit process with code 0 |

```javascript
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

---

## CORS Configuration

The server applies permissive CORS headers to every response:

| Header | Value |
|--------|-------|
| `Access-Control-Allow-Origin` | `*` |
| `Access-Control-Allow-Methods` | `GET, POST, DELETE, OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type` |

`OPTIONS` preflight requests receive a `204 No Content` response immediately.

---

## Request Logging

Every non-SSE, non-OPTIONS request is logged on response completion:

```
[http] GET /api/dashboards 200 (3ms)
[http] POST /api/dashboards/dashboard1/clear 200 (12ms)
```

The log format includes: HTTP method, URL path, response status code, and elapsed time in milliseconds.

---

## Real-Time Data Flow

The server acts as a bridge between the file system and the browser dashboard:

```
Worker agents write files to dashboards/{id}/progress/
        |
        v
WatcherService detects file changes
  - fs.watch on progress/ directories
  - fs.watchFile on initialization.json and logs.json (polling)
  - Periodic reconciliation catches missed events
        |
        v
SSEManager broadcasts events to all connected clients
        |
        v
Browser dashboard receives SSE events and updates UI in real-time
```

### Key Design Decisions

1. **Zero dependencies.** The server uses only Node.js built-in modules. No Express, no Socket.io, no npm packages. This makes it portable and eliminates version conflicts.

2. **SSE over WebSockets.** Server-Sent Events provide unidirectional server-to-client streaming, which is all the dashboard needs. SSE is simpler, works over standard HTTP, and auto-reconnects natively in browsers.

3. **File-based state.** All state lives in JSON files on disk. There is no database. Workers write progress files; the server watches them and broadcasts changes. This makes the system debuggable (inspect files directly) and resilient (restart without data loss).

4. **Hybrid watching strategy.** The server uses `fs.watch` (event-driven, low latency) for progress directories and `fs.watchFile` (polling) for `initialization.json` and `logs.json`. Periodic reconciliation catches any events missed by `fs.watch`, which can be unreliable on some platforms.

5. **Multi-dashboard support.** Up to 5 concurrent dashboards, each an independent swarm with its own `initialization.json`, `logs.json`, and `progress/` directory. The server auto-discovers new dashboards and starts watchers dynamically.
