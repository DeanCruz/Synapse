// apiRoutes.js — Extracted from server.js (lines 494-728)
// All API route handlers for the Synapse dashboard server.

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const {
  listDashboards,
  getDashboardDir,
  ensureDashboard,
  readDashboardInit,
  readDashboardLogs,
  readDashboardProgress,
  readDashboardInitAsync,
  readDashboardLogsAsync,
  readDashboardProgressAsync,
  clearDashboardProgress,
  copyDirSync,
  deleteDashboard,
  nextDashboardId,
} = require('../services/DashboardService');
const { listArchives, deleteArchive } = require('../services/ArchiveService');
const { listHistory, buildHistorySummary, saveHistorySummary } = require('../services/HistoryService');
const { listQueue, listQueueSummaries, readQueueInitAsync, readQueueLogsAsync, readQueueProgressAsync, getQueueDir } = require('../services/QueueService');
const { getDispatchableTasks } = require('../services/DependencyService');
const { readJSONAsync } = require('../utils/json');
const { ARCHIVE_DIR, HISTORY_DIR, QUEUE_DIR, DEFAULT_INITIALIZATION, DEFAULT_LOGS } = require('../utils/constants');

// --- URL Routing Helpers ---

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Sanitize a path parameter to prevent path traversal attacks.
 * Rejects strings with "..", directory separators, or disallowed characters.
 * @param {*} param — the raw path parameter from the URL
 * @returns {string|null} — the sanitized value, or null if invalid
 */
function sanitizePathParam(param) {
  if (typeof param !== 'string' || param.length === 0 || param.length > 100) return null;
  if (/[.]{2}|[/\\]/.test(param)) return null;
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.\-]*$/.test(param)) return null;
  return param;
}

// Parse dashboard ID and sub-path from URL like /api/dashboards/dashboard1/initialization
function parseDashboardRoute(pathname) {
  const match = pathname.match(/^\/api\/dashboards\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  return { id: match[1], subpath: match[2] || null };
}

/**
 * Handle an API route request.
 * Returns true if the route was handled, false if not (caller should fall through).
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {URL} url — parsed URL object
 * @returns {boolean}
 */
function handleApiRoute(req, res, url) {
  // --- API: List dashboards ---
  if (url.pathname === '/api/dashboards' && req.method === 'GET') {
    sendJSON(res, 200, { dashboards: listDashboards() });
    return true;
  }

  // --- API: Create a new dashboard ---
  if (url.pathname === '/api/dashboards' && req.method === 'POST') {
    const id = nextDashboardId();
    ensureDashboard(id);
    sendJSON(res, 201, { success: true, id });
    return true;
  }

  // --- API: Delete a dashboard ---
  const deleteRoute = url.pathname.match(/^\/api\/dashboards\/([^/]+)$/);
  if (deleteRoute && req.method === 'DELETE') {
    const id = sanitizePathParam(deleteRoute[1]);
    if (!id) {
      sendJSON(res, 400, { error: 'Invalid dashboard ID — must be alphanumeric with hyphens, underscores, or dots (max 100 chars, no path traversal)' });
      return true;
    }
    const deleted = deleteDashboard(id);
    if (!deleted) {
      sendJSON(res, 404, { error: 'Dashboard not found' });
      return true;
    }
    sendJSON(res, 200, { success: true });
    return true;
  }

  // --- API: Get status summary for ALL dashboards (lightweight, for sidebar dots) ---
  if (url.pathname === '/api/dashboards/statuses' && req.method === 'GET') {
    const dashboards = listDashboards();
    const statuses = {};
    for (const id of dashboards) {
      const init = readDashboardInit(id);
      const progress = readDashboardProgress(id);
      const hasTask = init && init.task && init.task.name;
      if (!hasTask) {
        statuses[id] = 'idle';
        continue;
      }
      const progressValues = Object.values(progress);
      if (progressValues.length === 0) {
        statuses[id] = 'in_progress';
        continue;
      }
      let allDone = true;
      let hasFailed = false;
      let hasInProgress = false;
      for (const p of progressValues) {
        if (p.status === 'in_progress') hasInProgress = true;
        if (p.status === 'failed') hasFailed = true;
        if (p.status !== 'completed' && p.status !== 'failed') allDone = false;
      }
      const totalTasks = (init.task && init.task.total_tasks) || 0;
      if (totalTasks > 0 && progressValues.length < totalTasks) allDone = false;
      if (allDone && hasFailed) {
        statuses[id] = 'error';
      } else if (allDone) {
        statuses[id] = 'completed';
      } else if (hasInProgress || progressValues.length > 0) {
        statuses[id] = 'in_progress';
      } else {
        statuses[id] = 'idle';
      }
    }
    sendJSON(res, 200, { statuses });
    return true;
  }

  // --- API: Overview (home dashboard meta-view) ---
  if (url.pathname === '/api/overview' && req.method === 'GET') {
    const dashboards = listDashboards();
    const dashboardSummaries = [];
    const allLogEntries = [];

    for (const id of dashboards) {
      const init = readDashboardInit(id);
      const progress = readDashboardProgress(id);
      const hasTask = init && init.task && init.task.name;

      // Derive status (same logic as /api/dashboards/statuses)
      let status = 'idle';
      if (hasTask) {
        const progressValues = Object.values(progress);
        if (progressValues.length === 0) {
          status = 'in_progress';
        } else {
          let allDone = true;
          let hasFailed = false;
          let hasInProgress = false;
          let completed = 0;
          for (const p of progressValues) {
            if (p.status === 'in_progress') hasInProgress = true;
            if (p.status === 'failed') hasFailed = true;
            if (p.status === 'completed') completed++;
            if (p.status !== 'completed' && p.status !== 'failed') allDone = false;
          }
          const totalTasks = (init.task && init.task.total_tasks) || 0;
          if (totalTasks > 0 && progressValues.length < totalTasks) allDone = false;
          if (allDone && hasFailed) status = 'error';
          else if (allDone) status = 'completed';
          else if (hasInProgress || progressValues.length > 0) status = 'in_progress';
        }
      }

      // Build task summary
      let taskSummary = null;
      if (hasTask) {
        const progressValues = Object.values(progress);
        let completedCount = 0;
        let failedCount = 0;
        for (const p of progressValues) {
          if (p.status === 'completed') completedCount++;
          if (p.status === 'failed') failedCount++;
        }
        taskSummary = {
          name: init.task.name,
          type: init.task.type || null,
          directory: init.task.directory || null,
          total_tasks: init.task.total_tasks || (init.agents ? init.agents.length : 0),
          completed_tasks: completedCount,
          failed_tasks: failedCount,
          created: init.task.created || null,
        };
      }

      dashboardSummaries.push({ id, status, task: taskSummary });

      // Collect log entries from dashboards with active tasks
      if (hasTask) {
        const logs = readDashboardLogs(id);
        if (logs && logs.entries) {
          for (const entry of logs.entries) {
            allLogEntries.push(Object.assign({ dashboardId: id }, entry));
          }
        }
      }
    }

    // Sort logs newest-first, take top 30
    allLogEntries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const recentLogs = allLogEntries.slice(0, 30);

    // Get archives and history (limited to 10)
    const archives = listArchives().slice(0, 10);
    const history = listHistory().slice(0, 10);

    sendJSON(res, 200, { dashboards: dashboardSummaries, archives, history, recentLogs });
    return true;
  }

  // --- API: List history summaries ---
  if (url.pathname === '/api/history' && req.method === 'GET') {
    const summaries = listHistory();
    sendJSON(res, 200, { history: summaries });
    return true;
  }

  // --- API: Get history analytics ---
  if (url.pathname === '/api/history/analytics' && req.method === 'GET') {
    const analyticsFile = path.join(HISTORY_DIR, 'analytics.json');
    (async () => {
      const data = await readJSONAsync(analyticsFile);
      if (data) {
        sendJSON(res, 200, data);
      } else {
        sendJSON(res, 200, { analytics: null });
      }
    })();
    return true;
  }

  // --- API: List archives ---
  if (url.pathname === '/api/archives' && req.method === 'GET') {
    const archives = listArchives();
    sendJSON(res, 200, { archives });
    return true;
  }

  // --- API: Get single archive ---
  const archiveRoute = url.pathname.match(/^\/api\/archives\/([^/]+)$/);
  if (archiveRoute && req.method === 'GET') {
    const name = sanitizePathParam(archiveRoute[1]);
    if (!name) {
      sendJSON(res, 400, { error: 'Invalid archive name — must be alphanumeric with hyphens, underscores, or dots (max 100 chars, no path traversal)' });
      return true;
    }
    const archiveDir = path.join(ARCHIVE_DIR, name);
    if (!fs.existsSync(archiveDir)) {
      sendJSON(res, 404, { error: 'Archive not found' });
      return true;
    }
    (async () => {
      const initialization = (await readJSONAsync(path.join(archiveDir, 'initialization.json'))) || { ...DEFAULT_INITIALIZATION };
      const logs = (await readJSONAsync(path.join(archiveDir, 'logs.json'))) || { ...DEFAULT_LOGS };
      const progress = {};
      const progressDir = path.join(archiveDir, 'progress');
      try {
        const files = await fsPromises.readdir(progressDir);
        const reads = files.filter(f => f.endsWith('.json')).map(async (file) => {
          const data = await readJSONAsync(path.join(progressDir, file));
          if (data && data.task_id) progress[data.task_id] = data;
        });
        await Promise.all(reads);
      } catch { /* dir may not exist */ }
      sendJSON(res, 200, { initialization, logs, progress });
    })();
    return true;
  }

  // --- API: Delete single archive ---
  if (archiveRoute && req.method === 'DELETE') {
    const name = sanitizePathParam(archiveRoute[1]);
    if (!name) {
      sendJSON(res, 400, { error: 'Invalid archive name — must be alphanumeric with hyphens, underscores, or dots (max 100 chars, no path traversal)' });
      return true;
    }
    const deleted = deleteArchive(name);
    if (!deleted) {
      sendJSON(res, 404, { error: 'Archive not found' });
      return true;
    }
    sendJSON(res, 200, { success: true });
    return true;
  }

  // --- API: Dashboard-specific routes ---
  const route = parseDashboardRoute(url.pathname);

  if (route) {
    const id = sanitizePathParam(route.id);
    if (!id) {
      sendJSON(res, 400, { error: 'Invalid dashboard ID — must be alphanumeric with hyphens, underscores, or dots (max 100 chars, no path traversal)' });
      return true;
    }
    const { subpath } = route;
    const dashboardDir = getDashboardDir(id);

    // GET /api/dashboards/:id/initialization
    if (subpath === 'initialization' && req.method === 'GET') {
      readDashboardInitAsync(id).then(data => {
        sendJSON(res, 200, data || { ...DEFAULT_INITIALIZATION });
      });
      return true;
    }

    // GET /api/dashboards/:id/logs
    if (subpath === 'logs' && req.method === 'GET') {
      readDashboardLogsAsync(id).then(data => {
        sendJSON(res, 200, data || { ...DEFAULT_LOGS });
      });
      return true;
    }

    // GET /api/dashboards/:id/progress
    if (subpath === 'progress' && req.method === 'GET') {
      readDashboardProgressAsync(id).then(data => {
        sendJSON(res, 200, data);
      });
      return true;
    }

    // GET /api/dashboards/:id/dispatchable
    if (subpath === 'dispatchable' && req.method === 'GET') {
      const result = getDispatchableTasks(id);
      sendJSON(res, 200, { dispatchable: result });
      return true;
    }

    // POST /api/dashboards/:id/archive
    if (subpath === 'archive' && req.method === 'POST') {
      const init = readDashboardInit(id);
      const taskName = (init && init.task && init.task.name) ? init.task.name : 'unnamed';
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const archiveName = `${today}_${taskName}`;
      const archiveDir = path.join(ARCHIVE_DIR, archiveName);

      // Copy dashboard contents to archive
      try {
        copyDirSync(dashboardDir, archiveDir);
      } catch (err) {
        sendJSON(res, 500, { error: 'Failed to archive: ' + err.message });
        return true;
      }

      // Clear the dashboard
      ensureDashboard(id);
      clearDashboardProgress(id);
      const initFile = path.join(dashboardDir, 'initialization.json');
      const logsFile = path.join(dashboardDir, 'logs.json');
      fs.writeFileSync(initFile, JSON.stringify(DEFAULT_INITIALIZATION, null, 2));
      fs.writeFileSync(logsFile, JSON.stringify(DEFAULT_LOGS, null, 2));

      sendJSON(res, 200, { success: true, archiveName });
      return true;
    }

    // POST /api/dashboards/:id/save-history — save history summary without clearing
    if (subpath === 'save-history' && req.method === 'POST') {
      const init = readDashboardInit(id);
      if (!init || !init.task || !init.task.name) {
        sendJSON(res, 400, { error: 'No active task to save history for' });
        return true;
      }
      const summary = buildHistorySummary(id);
      if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
      }
      const today = new Date().toISOString().slice(0, 10);
      const safeName = summary.task_name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const historyFile = path.join(HISTORY_DIR, `${today}_${safeName}.json`);
      // Only save if this exact history file doesn't already exist (prevent duplicates)
      if (fs.existsSync(historyFile)) {
        sendJSON(res, 200, { success: true, alreadySaved: true, task_name: summary.task_name });
        return true;
      }
      fs.writeFileSync(historyFile, JSON.stringify(summary, null, 2));
      sendJSON(res, 200, { success: true, task_name: summary.task_name });
      return true;
    }

    // POST /api/dashboards/:id/clear — archive, save history summary, then clear
    if (subpath === 'clear' && req.method === 'POST') {
      const init = readDashboardInit(id);
      let archiveName = null;

      // Archive and save history ONLY if dashboard has an active task
      if (init && init.task && init.task.name) {
        // 1. Archive the dashboard directory
        const taskName = init.task.name;
        const today = new Date().toISOString().slice(0, 10);
        archiveName = `${today}_${taskName}`;
        const archiveDir = path.join(ARCHIVE_DIR, archiveName);
        try {
          copyDirSync(dashboardDir, archiveDir);
        } catch (err) {
          sendJSON(res, 500, { error: 'Failed to archive before clear: ' + err.message });
          return true;
        }

        // 2. Save history summary
        const summary = buildHistorySummary(id);
        if (!fs.existsSync(HISTORY_DIR)) {
          fs.mkdirSync(HISTORY_DIR, { recursive: true });
        }
        const historyFile = path.join(HISTORY_DIR, `${today}_${summary.task_name}.json`);
        fs.writeFileSync(historyFile, JSON.stringify(summary, null, 2));
      }

      // 3. Clear the dashboard
      ensureDashboard(id);
      clearDashboardProgress(id);

      const initFile = path.join(dashboardDir, 'initialization.json');
      const logsFile = path.join(dashboardDir, 'logs.json');
      fs.writeFileSync(initFile, JSON.stringify(DEFAULT_INITIALIZATION, null, 2));
      fs.writeFileSync(logsFile, JSON.stringify(DEFAULT_LOGS, null, 2));

      sendJSON(res, 200, { success: true, archived: !!archiveName, archiveName });
      return true;
    }

    // GET /api/dashboards/:id/metrics — read metrics.json for a dashboard
    if (subpath === 'metrics' && req.method === 'GET') {
      const metricsFile = path.join(dashboardDir, 'metrics.json');
      (async () => {
        const data = await readJSONAsync(metricsFile);
        if (data) {
          sendJSON(res, 200, data);
        } else {
          sendJSON(res, 200, { metrics: null });
        }
      })();
      return true;
    }

    // GET /api/dashboards/:id/export — read-only export of all swarm data
    if (subpath === 'export' && req.method === 'GET') {
      (async () => {
        try {
          const initialization = (await readDashboardInitAsync(id)) || { ...DEFAULT_INITIALIZATION };
          const logs = (await readDashboardLogsAsync(id)) || { ...DEFAULT_LOGS };
          const progress = await readDashboardProgressAsync(id);
          const summary = buildHistorySummary(id);
          // Remove cleared_at from summary — it's only relevant when actually clearing
          delete summary.cleared_at;

          const exportData = {
            exported_at: new Date().toISOString(),
            summary: summary,
            initialization: initialization,
            logs: logs,
            progress: progress,
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(exportData, null, 2));
        } catch (err) {
          sendJSON(res, 500, { error: 'Failed to export: ' + err.message });
        }
      })();
      return true;
    }
  }

  // --- API: List queue summaries ---
  if (url.pathname === '/api/queue' && req.method === 'GET') {
    const summaries = listQueueSummaries();
    sendJSON(res, 200, { queue: summaries });
    return true;
  }

  // --- API: Get single queue item (full data for dashboard view) ---
  const queueRoute = url.pathname.match(/^\/api\/queue\/([^/]+)$/);
  if (queueRoute && req.method === 'GET') {
    const queueId = sanitizePathParam(queueRoute[1]);
    if (!queueId) {
      sendJSON(res, 400, { error: 'Invalid queue ID — must be alphanumeric with hyphens, underscores, or dots (max 100 chars, no path traversal)' });
      return true;
    }
    const queueDir = getQueueDir(queueId);
    if (!fs.existsSync(queueDir)) {
      sendJSON(res, 404, { error: 'Queue item not found' });
      return true;
    }
    (async () => {
      const initialization = (await readQueueInitAsync(queueId)) || { ...DEFAULT_INITIALIZATION };
      const logs = (await readQueueLogsAsync(queueId)) || { ...DEFAULT_LOGS };
      const progress = await readQueueProgressAsync(queueId);
      sendJSON(res, 200, { initialization, logs, progress });
    })();
    return true;
  }

  // Route not handled
  return false;
}

module.exports = { handleApiRoute };
