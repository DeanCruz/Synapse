// index.js — New modular entry point for the Synapse server.
// Extracted from server.js — wires together services, routes, and SSE management.

const http = require('http');
const fs = require('fs');
const path = require('path');

const {
  PORT,
  DASHBOARDS_DIR,
  QUEUE_DIR,
  ARCHIVE_DIR,
  HISTORY_DIR,
  INIT_POLL_MS,
} = require('./utils/constants');

const {
  broadcast,
  addClient,
  removeClient,
  startHeartbeat,
  stopHeartbeat,
  closeAll: closeAllSSE,
} = require('./SSEManager');

const {
  listDashboards,
  ensureDashboard,
  readDashboardInit,
  readDashboardProgress,
  readDashboardLogs,
} = require('./services/DashboardService');

const {
  watchDashboard,
  startDashboardsWatcher,
  startQueueWatcher,
  startReconciliation,
  stopAll: stopAllWatchers,
} = require('./services/WatcherService');

const { listQueueSummaries } = require('./services/QueueService');

const { handleApiRoute } = require('./routes/apiRoutes');

// --- HTTP Server ---

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Request logging — log method + URL + status on response finish
  const startTime = Date.now();
  res.on('finish', () => {
    // Skip SSE connections (long-lived) and OPTIONS preflight
    if (req.method === 'OPTIONS') return;
    if (req.url && req.url.startsWith('/events')) return;
    console.log(`  [http] ${req.method} ${req.url} ${res.statusCode} (${Date.now() - startTime}ms)`);
  });

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // --- SSE Endpoint ---
  if (url.pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const dashboards = listDashboards();
    const filterDashboard = url.searchParams.get('dashboard');

    // Send list of all dashboards
    res.write(`event: dashboards_list\ndata: ${JSON.stringify({ dashboards })}\n\n`);

    // Send initial data for each dashboard (or just the filtered one)
    const dashboardsToSend = filterDashboard
      ? dashboards.filter(d => d === filterDashboard)
      : dashboards;

    for (const id of dashboardsToSend) {
      const init = readDashboardInit(id);
      if (init) {
        res.write(`event: initialization\ndata: ${JSON.stringify({ dashboardId: id, ...init })}\n\n`);
      }

      const progress = readDashboardProgress(id);
      if (Object.keys(progress).length > 0) {
        res.write(`event: all_progress\ndata: ${JSON.stringify({ dashboardId: id, ...progress })}\n\n`);
      }
    }

    // Send combined init_state for reconnection catch-up
    for (const id of dashboardsToSend) {
      const init = readDashboardInit(id);
      const progress = readDashboardProgress(id);
      const logs = readDashboardLogs(id);
      if (init) {
        res.write(`event: init_state\ndata: ${JSON.stringify({
          dashboardId: id,
          initialization: init,
          progress: progress || {},
          logs: logs || { entries: [] }
        })}\n\n`);
      }
    }

    // Send initial queue data
    const queueSummaries = listQueueSummaries();
    if (queueSummaries.length > 0) {
      res.write(`event: queue_changed\ndata: ${JSON.stringify({ queue: queueSummaries })}\n\n`);
    }

    addClient(res);
    req.on('close', () => removeClient(res));
    return;
  }

  // --- API Routes ---
  if (handleApiRoute(req, res, url)) {
    return;
  }

  // --- Unknown route ---
  res.writeHead(404);
  res.end('Not Found');
});

// --- Startup ---

function startup() {
  // 1. Ensure dashboards/ directory exists
  if (!fs.existsSync(DASHBOARDS_DIR)) {
    fs.mkdirSync(DASHBOARDS_DIR, { recursive: true });
  }

  // 2. Ensure at least one default dashboard exists
  let dashboards = listDashboards();
  if (dashboards.length === 0) {
    ensureDashboard('dashboard1');
    dashboards = listDashboards();
  }

  // 3. Ensure Archive, History, and Queue directories exist
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
  if (!fs.existsSync(QUEUE_DIR)) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
  }

  // 4. Start watchers for all found dashboards
  for (const id of dashboards) {
    watchDashboard(id, broadcast);
  }

  // 5. Start the dashboards directory watcher
  startDashboardsWatcher(broadcast);

  // 5b. Start the queue directory watcher
  startQueueWatcher(broadcast);

  // 5c. Start periodic reconciliation for missed fs.watch events
  startReconciliation(broadcast);

  // 6. Start heartbeat
  startHeartbeat();

  console.log(`\n  Synapse Dashboard (Multi-Dashboard)`);
  console.log(`  Synapse server listening on port ${PORT}\n`);
  console.log(`  Dashboards directory: ${DASHBOARDS_DIR}`);
  console.log(`  Active dashboards: ${dashboards.join(', ')}`);
  console.log(`  Watching per dashboard: initialization.json (${INIT_POLL_MS}ms), logs.json (${INIT_POLL_MS}ms), progress/ (fs.watch)`);
  console.log(`  Watching: dashboards/ directory for new/removed dashboards`);
  console.log(`  Watching: queue/ directory for queued tasks`);
  console.log(`  SSE clients: /events`);
  console.log(`  API: /api/dashboards, /api/dashboards/:id/{initialization,logs,progress,clear,archive,export}`);
  console.log(`  API: /api/archives, /api/archives/:name`);
  console.log(`  API: /api/queue, /api/queue/:id`);
  console.log(`  API: /api/history`);
  console.log(`  Archive directory: ${ARCHIVE_DIR}`);
  console.log(`  History directory: ${HISTORY_DIR}\n`);
}

server.listen(PORT, startup);

// --- Graceful Shutdown ---

function shutdown() {
  console.log('\n  Shutting down Synapse...');

  // Stop all watchers (dashboard watchers, directory watcher, live reload)
  stopAllWatchers();

  // Stop heartbeat
  stopHeartbeat();

  // Close all SSE clients
  closeAllSSE();

  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
