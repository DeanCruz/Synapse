const fs = require('fs');
const path = require('path');
const {
  DASHBOARDS_DIR,
  PUBLIC_DIR,
  INIT_POLL_MS,
  PROGRESS_RETRY_MS,
  PROGRESS_READ_DELAY_MS,
  RECONCILE_DEBOUNCE_MS,
} = require('../utils/constants');
const { readJSON, readJSONWithRetry, isValidInitialization, isValidProgress } = require('../utils/json');
const { getDashboardDir, ensureDashboard, listDashboards } = require('./DashboardService');

// --- Dashboard Watcher Management ---

// Map<string, { initFile, logsFile, progressWatcher }>
const dashboardWatchers = new Map();

/**
 * Watch a single dashboard's initialization.json, logs.json, and progress/ directory.
 * Broadcasts SSE events via the provided broadcastFn on file changes.
 *
 * @param {string} id - Dashboard ID
 * @param {Function} broadcastFn - Function(eventName, data) to broadcast SSE events
 */
function watchDashboard(id, broadcastFn) {
  if (dashboardWatchers.has(id)) return; // already watching

  const dir = getDashboardDir(id);
  const initFile = path.join(dir, 'initialization.json');
  const logsFile = path.join(dir, 'logs.json');
  const progressDir = path.join(dir, 'progress');

  // Ensure files exist for watchFile (it needs stat-able targets)
  ensureDashboard(id);

  // Watch initialization.json — fs.watchFile polling
  fs.watchFile(initFile, { persistent: true, interval: INIT_POLL_MS }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    const data = readJSON(initFile);
    if (data && isValidInitialization(data)) {
      broadcastFn('initialization', { dashboardId: id, ...data });
    } else if (data) {
      console.error(`[watcher] Invalid initialization.json schema in ${id}`);
    }
  });

  // Watch logs.json — fs.watchFile polling
  fs.watchFile(logsFile, { persistent: true, interval: INIT_POLL_MS }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    const data = readJSON(logsFile);
    if (data) broadcastFn('logs', { dashboardId: id, ...data });
  });

  // Watch progress/ directory — fs.watch for file changes
  let progressWatcher = null;
  try {
    progressWatcher = fs.watch(progressDir, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      const filePath = path.join(progressDir, filename);
      // Read with retry — first attempt after delay, retry if JSON is malformed
      setTimeout(async () => {
        try {
          if (!fs.existsSync(filePath)) return; // file was deleted (reset)
          const data = await readJSONWithRetry(filePath, PROGRESS_RETRY_MS);
          if (data && isValidProgress(data)) {
            broadcastFn('agent_progress', { dashboardId: id, ...data });
          } else if (data) {
            console.error(`[watcher] Invalid progress schema in ${id}/${filename}`);
          }
        } catch { /* ignore transient read errors */ }
      }, PROGRESS_READ_DELAY_MS);
    });
  } catch { /* progress dir may not exist yet */ }

  dashboardWatchers.set(id, {
    initFile,
    logsFile,
    progressWatcher,
  });

  console.log(`  [watcher] Watching dashboard: ${id}`);
}

/**
 * Stop watching a single dashboard. Cleans up all watchers for it.
 *
 * @param {string} id - Dashboard ID
 */
function unwatchDashboard(id) {
  const entry = dashboardWatchers.get(id);
  if (!entry) return;

  fs.unwatchFile(entry.initFile);
  fs.unwatchFile(entry.logsFile);
  if (entry.progressWatcher) entry.progressWatcher.close();

  dashboardWatchers.delete(id);
  console.log(`  [watcher] Unwatched dashboard: ${id}`);
}

// --- Top-Level Dashboards Directory Watcher ---

let dashboardsDirWatcher = null;
let reconcileTimer = null;

/**
 * Reconcile tracked watchers against the current dashboard directories.
 * Starts watchers for new dashboards, stops watchers for removed ones.
 *
 * @param {Function} broadcastFn - Function(eventName, data) to broadcast SSE events
 */
function reconcileDashboards(broadcastFn) {
  const currentDirs = new Set(listDashboards());
  const trackedIds = new Set(dashboardWatchers.keys());

  // Start watchers for new dashboards
  for (const id of currentDirs) {
    if (!trackedIds.has(id)) {
      watchDashboard(id, broadcastFn);
    }
  }

  // Stop watchers for removed dashboards
  for (const id of trackedIds) {
    if (!currentDirs.has(id)) {
      unwatchDashboard(id);
    }
  }

  // Broadcast updated list
  broadcastFn('dashboards_changed', { dashboards: Array.from(currentDirs).sort() });
}

/**
 * Start watching the dashboards/ directory for new/removed dashboard subdirectories.
 * Changes are debounced with RECONCILE_DEBOUNCE_MS.
 *
 * @param {Function} broadcastFn - Function(eventName, data) to broadcast SSE events
 */
function startDashboardsWatcher(broadcastFn) {
  if (!fs.existsSync(DASHBOARDS_DIR)) {
    fs.mkdirSync(DASHBOARDS_DIR, { recursive: true });
  }

  dashboardsDirWatcher = fs.watch(DASHBOARDS_DIR, (_eventType, filename) => {
    if (!filename) return;
    // Debounce: clear pending timer and restart — fires once after events settle
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      reconcileDashboards(broadcastFn);
    }, RECONCILE_DEBOUNCE_MS);
  });
}

// --- Live Reload (watches public/ for code changes) ---

let reloadWatcher = null;

/**
 * Start watching public/ for file changes to trigger live reload.
 *
 * @param {Function} broadcastFn - Function(eventName, data) to broadcast SSE events
 */
function startLiveReload(broadcastFn) {
  if (!fs.existsSync(PUBLIC_DIR)) return;
  reloadWatcher = fs.watch(PUBLIC_DIR, { recursive: true }, (_, filename) => {
    if (!filename) return;
    console.log(`  [live-reload] ${filename} changed — reloading clients`);
    broadcastFn('reload', { file: filename });
  });
}

/**
 * Stop all watchers — dashboard watchers, directory watcher, live reload, and pending timers.
 */
function stopAll() {
  // Stop all dashboard watchers
  for (const id of dashboardWatchers.keys()) {
    unwatchDashboard(id);
  }

  // Stop dashboards directory watcher and pending reconcile
  if (dashboardsDirWatcher) {
    dashboardsDirWatcher.close();
    dashboardsDirWatcher = null;
  }
  clearTimeout(reconcileTimer);
  reconcileTimer = null;

  // Stop live reload
  if (reloadWatcher) {
    reloadWatcher.close();
    reloadWatcher = null;
  }
}

module.exports = {
  watchDashboard,
  unwatchDashboard,
  startDashboardsWatcher,
  startLiveReload,
  stopAll,
};
