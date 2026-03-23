const fs = require('fs');
const path = require('path');
const {
  DASHBOARDS_DIR,
  QUEUE_DIR,
  INIT_POLL_MS,
  PROGRESS_RETRY_MS,
  PROGRESS_READ_DELAY_MS,
  RECONCILE_DEBOUNCE_MS,
  RECONCILE_INTERVAL_MS,
  DEPENDENCY_CHECK_DELAY_MS,
} = require('../utils/constants');
const { readJSON, readJSONWithRetry, isValidInitialization, isValidProgress, isValidLogs } = require('../utils/json');
const { getDashboardDir, ensureDashboard, listDashboards } = require('./DashboardService');
const { listQueueSummaries } = require('./QueueService');
const { computeNewlyUnblocked } = require('./DependencyService');

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
      console.error(`[watcher] Invalid initialization.json schema in ${id} — task type: ${typeof data.task}, agents type: ${typeof data.agents}, agents count: ${Array.isArray(data.agents) ? data.agents.length : 'N/A'}`);
    }
  });

  // Watch logs.json — fs.watchFile polling
  fs.watchFile(logsFile, { persistent: true, interval: INIT_POLL_MS }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    const data = readJSON(logsFile);
    if (data && isValidLogs(data)) {
      broadcastFn('logs', { dashboardId: id, ...data });
    } else if (data) {
      console.error(`[watcher] Invalid logs.json schema in ${id} — entries type: ${typeof data.entries}, is array: ${Array.isArray(data.entries)}`);
    }
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
            // Write-guard: warn if task_id inside the file doesn't match the filename
            const expectedId = filename.replace('.json', '');
            if (data.task_id !== expectedId) {
              console.warn(`[watcher] GUARD: Progress file ${id}/${filename} contains task_id "${data.task_id}" — expected "${expectedId}". Possible cross-worker write violation.`);
              // Still broadcast — soft guard, warn only
            }
            broadcastFn('agent_progress', { dashboardId: id, ...data });

            // Dependency check: when a task completes, check if new tasks are unblocked
            if (data.status === 'completed') {
              setTimeout(() => {
                try {
                  const result = computeNewlyUnblocked(id, data.task_id);
                  console.log(`[watcher] Dependency check: ${result.length} tasks unblocked by ${data.task_id} in ${id}`);
                  if (result.length > 0) {
                    broadcastFn('tasks_unblocked', { dashboardId: id, completedTaskId: data.task_id, unblocked: result });
                  }
                } catch (err) {
                  console.error(`[watcher] Dependency check error for ${data.task_id} in ${id}:`, err);
                }
              }, DEPENDENCY_CHECK_DELAY_MS);
            }
          } else if (data) {
            console.error(`[watcher] Invalid progress schema in ${id}/${filename} — task_id: ${JSON.stringify(data.task_id)}, status: ${JSON.stringify(data.status)}, stage: ${JSON.stringify(data.stage)}`);
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

// --- Queue Directory Watcher ---

let queueDirWatcher = null;
let queueReconcileTimer = null;

/**
 * Start watching the queue/ directory for new/removed queue items.
 * Broadcasts a 'queue_changed' SSE event with updated queue summaries.
 *
 * @param {Function} broadcastFn - Function(eventName, data) to broadcast SSE events
 */
function startQueueWatcher(broadcastFn) {
  if (!fs.existsSync(QUEUE_DIR)) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
  }

  queueDirWatcher = fs.watch(QUEUE_DIR, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    // Debounce — fires once after events settle
    clearTimeout(queueReconcileTimer);
    queueReconcileTimer = setTimeout(() => {
      const summaries = listQueueSummaries();
      broadcastFn('queue_changed', { queue: summaries });
    }, RECONCILE_DEBOUNCE_MS);
  });
}

// --- Periodic Reconciliation ---

const lastKnownProgress = new Map(); // Map<dashboardId, Map<filename, mtimeMs>>
let reconcileIntervalTimer = null;

function reconcileProgressFiles(id, broadcastFn) {
  const progressDir = path.join(getDashboardDir(id), 'progress');
  try {
    if (!fs.existsSync(progressDir)) return;
    const files = fs.readdirSync(progressDir);

    if (!lastKnownProgress.has(id)) {
      lastKnownProgress.set(id, new Map());
    }
    const known = lastKnownProgress.get(id);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(progressDir, file);
      try {
        const stat = fs.statSync(filePath);
        const lastMtime = known.get(file);
        if (lastMtime !== undefined && stat.mtimeMs <= lastMtime) continue;

        known.set(file, stat.mtimeMs);
        const data = readJSON(filePath);
        if (data && isValidProgress(data)) {
          // Write-guard: warn if task_id inside the file doesn't match the filename
          const expectedId = file.replace('.json', '');
          if (data.task_id !== expectedId) {
            console.warn(`[watcher] GUARD: Progress file ${id}/${file} contains task_id "${data.task_id}" — expected "${expectedId}". Possible cross-worker write violation.`);
            // Still broadcast — soft guard, warn only
          }
          broadcastFn('agent_progress', { dashboardId: id, ...data });

          // Dependency check: when a task completes, check if new tasks are unblocked
          if (data.status === 'completed') {
            try {
              const result = computeNewlyUnblocked(id, data.task_id);
              console.log(`[watcher] Dependency check: ${result.length} tasks unblocked by ${data.task_id} in ${id}`);
              if (result.length > 0) {
                broadcastFn('tasks_unblocked', { dashboardId: id, completedTaskId: data.task_id, unblocked: result });
              }
            } catch (err) {
              console.error(`[watcher] Dependency check error for ${data.task_id} in ${id}:`, err);
            }
          }
        }
      } catch { /* ignore individual file errors */ }
    }

    // Clean up stale entries for deleted progress files
    const currentFiles = new Set(files.filter(f => f.endsWith('.json')));
    for (const trackedFile of known.keys()) {
      if (!currentFiles.has(trackedFile)) {
        known.delete(trackedFile);
      }
    }
  } catch { /* ignore directory errors */ }
}

function startReconciliation(broadcastFn) {
  reconcileIntervalTimer = setInterval(() => {
    for (const id of dashboardWatchers.keys()) {
      reconcileProgressFiles(id, broadcastFn);
    }
  }, RECONCILE_INTERVAL_MS);
}

function stopReconciliation() {
  clearInterval(reconcileIntervalTimer);
  reconcileIntervalTimer = null;
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

  // Stop queue directory watcher
  if (queueDirWatcher) {
    queueDirWatcher.close();
    queueDirWatcher = null;
  }
  clearTimeout(queueReconcileTimer);
  queueReconcileTimer = null;

  // Stop periodic reconciliation
  stopReconciliation();
}

module.exports = {
  watchDashboard,
  unwatchDashboard,
  startDashboardsWatcher,
  startQueueWatcher,
  startReconciliation,
  stopReconciliation,
  stopAll,
};
