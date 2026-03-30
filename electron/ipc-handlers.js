// electron/ipc-handlers.js — IPC Data Bridge
// Registers all IPC handlers, bridging existing server services to the Electron renderer.
// Sets up file watchers that push real-time updates via webContents.send().

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const vm = require('vm');

// Import existing services (CommonJS — paths resolve relative to the required file)
const {
  listDashboards,
  ensureDashboard,
  getDashboardDir,
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
  getDashboardCreationTime,
} = require('../src/server/services/DashboardService');

const settings = require('./settings');

const {
  watchDashboard,
  unwatchDashboard,
  startDashboardsWatcher,
  startQueueWatcher,
  stopAll: stopAllWatchers,
} = require('../src/server/services/WatcherService');

const {
  listArchives,
  archiveDashboard,
  deleteArchive,
} = require('../src/server/services/ArchiveService');

const {
  listHistory,
  buildHistorySummary,
  saveHistorySummary,
} = require('../src/server/services/HistoryService');

const {
  listQueueSummaries,
  getQueueDir,
  readQueueInitAsync,
  readQueueLogsAsync,
  readQueueProgressAsync,
} = require('../src/server/services/QueueService');

const {
  listConversations,
  loadConversation,
  saveConversation,
  createConversation,
  deleteConversation,
  renameConversation,
} = require('./services/ConversationService');

const { readJSONAsync } = require('../src/server/utils/json');

const {
  DASHBOARDS_DIR,
  QUEUE_DIR,
  ARCHIVE_DIR,
  HISTORY_DIR,
  DEFAULT_INITIALIZATION,
  DEFAULT_LOGS,
} = require('../src/server/utils/constants');

const fsPromises = fs.promises;

// ---------------------------------------------------------------------------
// Broadcast bridge — adapts WatcherService's broadcastFn to IPC
// ---------------------------------------------------------------------------

/**
 * Create a broadcast function that sends events to the renderer via IPC.
 * Checks that the window exists and is not destroyed before sending.
 *
 * @param {Function} getMainWindow - returns the BrowserWindow instance
 * @returns {Function} broadcastFn(eventName, data)
 */
function createBroadcastFn(getMainWindow) {
  return function broadcast(eventName, data) {
    // Intercept dashboard list events to apply persisted ordering + names
    if ((eventName === 'dashboards_changed' || eventName === 'dashboards_list') && data && data.dashboards) {
      data = { ...data, dashboards: getOrderedDashboards(), names: getDashboardNames() };
    }

    const win = getMainWindow();
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      try {
        win.webContents.send(eventName, data);
      } catch (err) {
        console.warn('[IPC] broadcast failed for', eventName, ':', err.message);
      }
    }

    // Feed progress updates to the SwarmOrchestrator for dispatch loop
    if (eventName === 'agent_progress' && data && data.task_id && data.dashboardId) {
      try {
        const SwarmOrchestrator = require('./services/SwarmOrchestrator');
        SwarmOrchestrator.handleProgressUpdate(data.dashboardId, data.task_id, data);
      } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
          console.warn('[IPC] SwarmOrchestrator progress feed error:', e.message);
        }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Status computation — shared logic (mirrors apiRoutes.js)
// ---------------------------------------------------------------------------

/**
 * Derive a dashboard's status from its initialization and progress data.
 *
 * @param {Object|null} init - parsed initialization.json
 * @param {Object} progress - keyed by task_id
 * @returns {string} 'idle' | 'in_progress' | 'completed' | 'error'
 */
function deriveDashboardStatus(init, progress) {
  const hasTask = init && init.task && init.task.name;
  if (!hasTask) return 'idle';

  const progressValues = Object.values(progress);
  if (progressValues.length === 0) return 'in_progress';

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

  if (allDone && hasFailed) return 'error';
  if (allDone) return 'completed';
  if (hasInProgress || progressValues.length > 0) return 'in_progress';
  return 'idle';
}

// ---------------------------------------------------------------------------
// Directory initialization — mirrors server startup()
// ---------------------------------------------------------------------------

/**
 * Ensure all required directories and default dashboards exist.
 */
function ensureDirectories() {
  if (!fs.existsSync(DASHBOARDS_DIR)) {
    fs.mkdirSync(DASHBOARDS_DIR, { recursive: true });
  }

  // Ensure at least one default dashboard exists
  if (listDashboards().length === 0) {
    ensureDashboard('dashboard1');
  }

  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
  if (!fs.existsSync(QUEUE_DIR)) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Dashboard ordering — reconciles filesystem truth with persisted order
// ---------------------------------------------------------------------------

/**
 * Get dashboards in persisted order, appending newly-discovered ones by creation time.
 * IDE is always pinned at index 0.
 *
 * @returns {string[]} ordered dashboard IDs
 */
function getOrderedDashboards() {
  const meta = settings.get('dashboardMeta') || { order: [], names: {} };
  const existingIds = new Set(listDashboards());

  // Filter persisted order to only existing dashboards
  const validOrder = (meta.order || []).filter(id => existingIds.has(id));
  const orderedSet = new Set(validOrder);

  // Find new dashboards not yet in order, sort by creation time (oldest first, newest last)
  const newIds = [...existingIds].filter(id => !orderedSet.has(id));
  newIds.sort((a, b) => {
    if (a === 'ide') return -1;
    if (b === 'ide') return 1;
    return getDashboardCreationTime(a) - getDashboardCreationTime(b);
  });

  // Merge: persisted order + new dashboards appended at end
  let result = [...validOrder, ...newIds];

  // Ensure 'ide' is always first
  result = result.filter(id => id !== 'ide');
  if (existingIds.has('ide')) {
    result.unshift('ide');
  }

  // Persist the reconciled order
  meta.order = result;
  settings.set('dashboardMeta', meta);

  return result;
}

/**
 * Get the custom display names from dashboard metadata.
 * @returns {Object} { [dashboardId]: displayName }
 */
function getDashboardNames() {
  const meta = settings.get('dashboardMeta') || { order: [], names: {} };
  return meta.names || {};
}

// ---------------------------------------------------------------------------
// IPC Handler registration
// ---------------------------------------------------------------------------

/**
 * Register all IPC handlers and start file watchers.
 * Called once from main.js during app initialization.
 *
 * @param {Function} getMainWindow - returns the BrowserWindow (may be null during startup)
 */
function registerIPCHandlers(getMainWindow) {
  const broadcastFn = createBroadcastFn(getMainWindow);

  // --- 1. Ensure directories exist ---
  ensureDirectories();

  // --- 2. Register all ipcMain.handle() handlers ---

  // IPC heartbeat — renderer polls to verify bridge is alive
  ipcMain.handle('ipc-heartbeat', () => ({ alive: true, timestamp: Date.now() }));

  // GET /api/dashboards -> get-dashboards
  ipcMain.handle('get-dashboards', async () => {
    return { dashboards: getOrderedDashboards(), names: getDashboardNames() };
  });

  // POST /api/dashboards -> create-dashboard
  ipcMain.handle('create-dashboard', async () => {
    const id = nextDashboardId();
    ensureDashboard(id);
    watchDashboard(id, broadcastFn);
    // Append to persisted order
    const meta = settings.get('dashboardMeta') || { order: [], names: {} };
    if (!meta.order.includes(id)) {
      meta.order.push(id);
    }
    settings.set('dashboardMeta', meta);
    broadcastFn('dashboards_changed', { dashboards: listDashboards() });
    return { success: true, id };
  });

  // DELETE /api/dashboards/:id -> delete-dashboard
  ipcMain.handle('delete-dashboard', async (_event, id) => {
    unwatchDashboard(id);
    const deleted = deleteDashboard(id);
    if (!deleted) return { success: false, error: 'Dashboard not found' };
    // Clean up metadata
    const meta = settings.get('dashboardMeta') || { order: [], names: {} };
    meta.order = (meta.order || []).filter(oid => oid !== id);
    delete meta.names[id];
    settings.set('dashboardMeta', meta);
    broadcastFn('dashboards_changed', { dashboards: listDashboards() });
    return { success: true };
  });

  // PUT /api/dashboards/reorder -> reorder-dashboards
  ipcMain.handle('reorder-dashboards', async (_event, orderedIds) => {
    const meta = settings.get('dashboardMeta') || { order: [], names: {} };
    const existingIds = new Set(listDashboards());
    // Validate: only accept IDs that actually exist
    let newOrder = orderedIds.filter(id => existingIds.has(id));
    // Ensure ide stays first
    newOrder = newOrder.filter(id => id !== 'ide');
    if (existingIds.has('ide')) newOrder.unshift('ide');
    // Append any existing dashboards missing from the reorder request
    for (const id of existingIds) {
      if (!newOrder.includes(id)) newOrder.push(id);
    }
    meta.order = newOrder;
    settings.set('dashboardMeta', meta);
    broadcastFn('dashboards_changed', { dashboards: newOrder });
    return { success: true };
  });

  // PUT /api/dashboards/:id/rename -> rename-dashboard
  ipcMain.handle('rename-dashboard', async (_event, id, displayName) => {
    const meta = settings.get('dashboardMeta') || { order: [], names: {} };
    if (displayName && displayName.trim()) {
      meta.names[id] = displayName.trim();
    } else {
      delete meta.names[id];
    }
    settings.set('dashboardMeta', meta);
    broadcastFn('dashboards_changed', { dashboards: getOrderedDashboards(), names: meta.names });
    return { success: true };
  });

  // GET /api/dashboards/meta -> get-dashboard-meta
  ipcMain.handle('get-dashboard-meta', async () => {
    return settings.get('dashboardMeta') || { order: [], names: {} };
  });

  // GET /api/dashboards/statuses -> get-dashboard-statuses
  ipcMain.handle('get-dashboard-statuses', async () => {
    const dashboards = listDashboards();
    const statuses = {};
    for (const id of dashboards) {
      const init = readDashboardInit(id);
      const progress = readDashboardProgress(id);
      statuses[id] = deriveDashboardStatus(init, progress);
    }
    return { statuses };
  });

  // GET /api/overview -> get-overview
  ipcMain.handle('get-overview', async () => {
    const dashboards = listDashboards();
    const dashboardSummaries = [];
    const allLogEntries = [];

    for (const id of dashboards) {
      const init = readDashboardInit(id);
      const progress = readDashboardProgress(id);
      const hasTask = init && init.task && init.task.name;
      const status = deriveDashboardStatus(init, progress);

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

    const archives = listArchives().slice(0, 10);
    const history = listHistory().slice(0, 10);

    return { dashboards: dashboardSummaries, archives, history, recentLogs };
  });

  // GET /api/dashboards/:id/initialization -> get-dashboard-init
  ipcMain.handle('get-dashboard-init', async (_event, id) => {
    const data = await readDashboardInitAsync(id);
    return data || { ...DEFAULT_INITIALIZATION };
  });

  // GET /api/dashboards/:id/logs -> get-dashboard-logs
  ipcMain.handle('get-dashboard-logs', async (_event, id) => {
    const data = await readDashboardLogsAsync(id);
    return data || { ...DEFAULT_LOGS };
  });

  // GET /api/dashboards/:id/progress -> get-dashboard-progress
  ipcMain.handle('get-dashboard-progress', async (_event, id) => {
    return await readDashboardProgressAsync(id);
  });

  // POST /api/dashboards/:id/clear -> clear-dashboard
  ipcMain.handle('clear-dashboard', async (_event, id) => {
    // Build and save history summary before clearing
    const init = readDashboardInit(id);
    if (init && init.task && init.task.name) {
      const summary = buildHistorySummary(id);
      if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
      }
      const today = new Date().toISOString().slice(0, 10);
      const historyFile = path.join(HISTORY_DIR, `${today}_${summary.task_name}.json`);
      fs.writeFileSync(historyFile, JSON.stringify(summary, null, 2));
    }

    // Reset dashboard
    const dashboardDir = getDashboardDir(id);
    ensureDashboard(id);
    clearDashboardProgress(id);
    const initFile = path.join(dashboardDir, 'initialization.json');
    const logsFile = path.join(dashboardDir, 'logs.json');
    fs.writeFileSync(initFile, JSON.stringify(DEFAULT_INITIALIZATION, null, 2));
    fs.writeFileSync(logsFile, JSON.stringify(DEFAULT_LOGS, null, 2));

    return { success: true };
  });

  // POST /api/dashboards/:id/archive -> archive-dashboard
  ipcMain.handle('archive-dashboard', async (_event, id) => {
    const dashboardDir = getDashboardDir(id);
    const init = readDashboardInit(id);
    const taskName = (init && init.task && init.task.name) ? init.task.name : 'unnamed';
    const today = new Date().toISOString().slice(0, 10);
    const archiveName = `${today}_${taskName}`;
    const archiveDir = path.join(ARCHIVE_DIR, archiveName);

    // Copy dashboard contents to archive
    try {
      copyDirSync(dashboardDir, archiveDir);
    } catch (err) {
      return { success: false, error: 'Failed to archive: ' + err.message };
    }

    // Clear the dashboard after archiving
    ensureDashboard(id);
    clearDashboardProgress(id);
    const initFile = path.join(dashboardDir, 'initialization.json');
    const logsFile = path.join(dashboardDir, 'logs.json');
    fs.writeFileSync(initFile, JSON.stringify(DEFAULT_INITIALIZATION, null, 2));
    fs.writeFileSync(logsFile, JSON.stringify(DEFAULT_LOGS, null, 2));

    return { success: true, archiveName };
  });

  // POST /api/dashboards/:id/save-history -> save-dashboard-history
  ipcMain.handle('save-dashboard-history', async (_event, id) => {
    const init = readDashboardInit(id);
    if (!init || !init.task || !init.task.name) {
      return { success: false, error: 'No active task to save history for' };
    }
    const summary = buildHistorySummary(id);
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    const safeName = summary.task_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const historyFile = path.join(HISTORY_DIR, `${today}_${safeName}.json`);
    // Prevent duplicates
    if (fs.existsSync(historyFile)) {
      return { success: true, alreadySaved: true, task_name: summary.task_name };
    }
    fs.writeFileSync(historyFile, JSON.stringify(summary, null, 2));
    return { success: true, task_name: summary.task_name };
  });

  // GET /api/dashboards/:id/export -> export-dashboard
  ipcMain.handle('export-dashboard', async (_event, id) => {
    const initialization = (await readDashboardInitAsync(id)) || { ...DEFAULT_INITIALIZATION };
    const logs = (await readDashboardLogsAsync(id)) || { ...DEFAULT_LOGS };
    const progress = await readDashboardProgressAsync(id);
    const summary = buildHistorySummary(id);
    // Remove cleared_at — only relevant when actually clearing
    delete summary.cleared_at;

    return {
      exported_at: new Date().toISOString(),
      summary,
      initialization,
      logs,
      progress,
    };
  });

  // GET /api/dashboards/:id/metrics -> get-dashboard-metrics
  ipcMain.handle('get-dashboard-metrics', async (_event, id) => {
    const metricsFile = path.join(getDashboardDir(id), 'metrics.json');
    const data = await readJSONAsync(metricsFile);
    if (data) return data;
    return { metrics: null };
  });

  // GET /api/archives -> get-archives
  ipcMain.handle('get-archives', async () => {
    return { archives: listArchives() };
  });

  // GET /api/archives/:name -> get-archive
  ipcMain.handle('get-archive', async (_event, name) => {
    const archiveDir = path.join(ARCHIVE_DIR, name);
    if (!fs.existsSync(archiveDir)) {
      return { error: 'Archive not found' };
    }
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
    } catch { /* progress dir may not exist */ }
    return { initialization, logs, progress };
  });

  // DELETE /api/archives/:name -> delete-archive
  ipcMain.handle('delete-archive', async (_event, name) => {
    const deleted = deleteArchive(name);
    if (!deleted) {
      return { success: false, error: 'Archive not found' };
    }
    return { success: true };
  });

  // GET /api/history -> get-history
  ipcMain.handle('get-history', async () => {
    return { history: listHistory() };
  });

  // GET /api/history/analytics -> get-history-analytics
  ipcMain.handle('get-history-analytics', async () => {
    const analyticsFile = path.join(HISTORY_DIR, 'analytics.json');
    const data = await readJSONAsync(analyticsFile);
    if (data) return data;
    return { analytics: null };
  });

  // GET /api/queue -> get-queue
  ipcMain.handle('get-queue', async () => {
    return { queue: listQueueSummaries() };
  });

  // GET /api/queue/:id -> get-queue-item
  ipcMain.handle('get-queue-item', async (_event, queueId) => {
    const queueDir = getQueueDir(queueId);
    if (!fs.existsSync(queueDir)) {
      return { error: 'Queue item not found' };
    }
    const initialization = (await readQueueInitAsync(queueId)) || { ...DEFAULT_INITIALIZATION };
    const logs = (await readQueueLogsAsync(queueId)) || { ...DEFAULT_LOGS };
    const progress = await readQueueProgressAsync(queueId);
    return { initialization, logs, progress };
  });

  // --- Settings handlers ---
  ipcMain.handle('get-settings', async () => {
    const settings = require('./settings');
    return settings.getAll();
  });

  ipcMain.handle('set-setting', async (_event, key, value) => {
    const settings = require('./settings');
    settings.set(key, value);
    return { success: true };
  });

  ipcMain.handle('reset-settings', async () => {
    const settings = require('./settings');
    return settings.reset();
  });

  // --- Project handlers ---
  const ProjectService = require('./services/ProjectService');
  const { dialog } = require('electron');

  ipcMain.handle('select-project-directory', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Project Directory',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('load-project', async (_event, dirPath) => {
    return ProjectService.loadProject(dirPath);
  });

  ipcMain.handle('get-recent-projects', async () => {
    const settings = require('./settings');
    return settings.get('recentProjects') || [];
  });

  ipcMain.handle('add-recent-project', async (_event, project) => {
    const settings = require('./settings');
    var recents = settings.get('recentProjects') || [];
    // Remove duplicate
    recents = recents.filter(function (p) { return p.path !== project.path; });
    recents.unshift({ path: project.path, name: project.name, lastOpened: new Date().toISOString() });
    if (recents.length > 10) recents = recents.slice(0, 10);
    settings.set('recentProjects', recents);
    return recents;
  });

  ipcMain.handle('get-project-context', async (_event, dirPath) => {
    return ProjectService.getProjectContext(dirPath);
  });

  ipcMain.handle('scan-project-directory', async (_event, dirPath, depth) => {
    return ProjectService.scanDirectory(dirPath, depth || 2);
  });

  ipcMain.handle('detect-claude-cli', async () => {
    return ProjectService.detectClaudeCLI();
  });

  ipcMain.handle('detect-agent-cli', async (_event, provider) => {
    return ProjectService.detectAgentCLI(provider);
  });

  // --- Task Editor handlers ---
  const TaskEditorService = require('./services/TaskEditorService');

  ipcMain.handle('create-swarm', async (_event, dashboardId, opts) => {
    return TaskEditorService.createSwarm(dashboardId, opts);
  });

  ipcMain.handle('add-task', async (_event, dashboardId, task) => {
    return TaskEditorService.addTask(dashboardId, task);
  });

  ipcMain.handle('update-task', async (_event, dashboardId, taskId, updates) => {
    return TaskEditorService.updateTask(dashboardId, taskId, updates);
  });

  ipcMain.handle('remove-task', async (_event, dashboardId, taskId) => {
    return TaskEditorService.removeTask(dashboardId, taskId);
  });

  ipcMain.handle('add-wave', async (_event, dashboardId, wave) => {
    return TaskEditorService.addWave(dashboardId, wave);
  });

  ipcMain.handle('remove-wave', async (_event, dashboardId, waveId) => {
    return TaskEditorService.removeWave(dashboardId, waveId);
  });

  ipcMain.handle('next-task-id', async (_event, dashboardId, waveNum) => {
    return TaskEditorService.nextTaskId(dashboardId, waveNum);
  });

  ipcMain.handle('validate-dependencies', async (_event, dashboardId) => {
    return TaskEditorService.validateDependencies(dashboardId);
  });

  // --- Worker handlers ---
  const ClaudeCodeService = require('./services/ClaudeCodeService');
  const CodexService = require('./services/CodexService');
  const TerminalService = require('./services/TerminalService');
  ClaudeCodeService.init(broadcastFn);
  CodexService.init(broadcastFn);
  TerminalService.init(broadcastFn);

  // Build system prompt for in-app agent chat — reads Synapse CLAUDE.md + project CLAUDE.md
  ipcMain.handle('get-chat-system-prompt', async (_event, projectDir, dashboardId, additionalContextDirs) => {
    if (!dashboardId) throw new Error('dashboardId is required for system prompt generation — received: ' + dashboardId);
    const parts = [];
    const synapseRoot = path.resolve(__dirname, '..');
    const ctxDirs = Array.isArray(additionalContextDirs) ? additionalContextDirs : [];

    // Path reference block — agent must always know both directories AND its dashboard
    let dirRef =
      '# Directory References\n\n' +
      'TRACKER ROOT (Synapse): ' + synapseRoot + '\n' +
      'PROJECT ROOT (target project): ' + (projectDir || synapseRoot) + '\n' +
      '===DASHBOARD_BINDING_START===\n' +
      'DASHBOARD ID: ' + dashboardId + '\n' +
      '===DASHBOARD_BINDING_END===\n';

    // Include additional context directories in the reference block
    if (ctxDirs.length > 0) {
      dirRef += '\nADDITIONAL CONTEXT (read-only):\n';
      for (const dir of ctxDirs) {
        dirRef += '  - ' + dir + '\n';
      }
      dirRef +=
        '\n**IMPORTANT:** Additional context directories are READ-ONLY reference material. ' +
        'You may read files in these directories for knowledge and context, but you must NEVER ' +
        'create, modify, or delete any files in them. All code changes happen in PROJECT ROOT only.\n';
    }

    dirRef +=
      '\nYou are the agent for **' + dashboardId + '**. This is your PRE-ASSIGNED dashboard — ' +
      'it was set by the chat view that spawned you. This dashboard binding is AUTHORITATIVE.\n' +
      'When running !p_track or any swarm command, use this dashboard directly — do NOT scan or auto-select a different one.\n' +
      'When running !master_plan_track, use this dashboard for your primary stream (S1) and scan OTHER dashboards for additional streams.\n\n' +
      'Dashboard paths:\n' +
      '  - initialization.json: ' + synapseRoot + '/dashboards/' + dashboardId + '/initialization.json\n' +
      '  - logs.json: ' + synapseRoot + '/dashboards/' + dashboardId + '/logs.json\n' +
      '  - Progress files: ' + synapseRoot + '/dashboards/' + dashboardId + '/progress/{task_id}.json\n\n' +
      'When looking for commands and instructions, ALWAYS check the Synapse directory (TRACKER ROOT) first:\n' +
      '  1. {tracker_root}/_commands/{command}.md — Synapse swarm commands (highest priority)\n' +
      '  2. {tracker_root}/_commands/project/{command}.md — Synapse project commands\n' +
      '  3. {project_root}/_commands/{command}.md — Project-specific commands (lowest priority)\n\n' +
      'Agent instructions live at: {tracker_root}/agent/instructions/\n' +
      'All code work happens in PROJECT ROOT. All Synapse commands/instructions/dashboards live in TRACKER ROOT.\n' +
      'Dashboard IDs are assigned dynamically. IDE dashboards are auto-created when workspaces open and auto-deleted when closed.';

    parts.push(dirRef);

    // Read Synapse CLAUDE.md FIRST — Synapse context takes priority
    const synapseClaudeMd = path.join(synapseRoot, 'CLAUDE.md');
    try {
      const content = fs.readFileSync(synapseClaudeMd, 'utf-8');
      parts.push('# Synapse Context\n' + content);
    } catch (e) { /* ignore */ }

    // Read project CLAUDE.md files — falls back to additional context dirs if none found
    const projectContexts = ProjectService.getProjectContextWithFallback(projectDir, ctxDirs);
    const isFallback = projectDir
      ? ProjectService.getProjectContext(projectDir).length === 0 && projectContexts.length > 0
      : false;
    for (const ctx of projectContexts) {
      const dirName = path.basename(path.dirname(ctx.path));
      let label;
      if (isFallback) {
        const ctxRoot = path.basename(path.dirname(ctx.path));
        label = ctx.path.endsWith(path.sep + 'CLAUDE.md') || path.basename(ctx.path) === 'CLAUDE.md'
          ? 'Project Context (from additional context: ' + ctxRoot + ')'
          : ctxRoot + ' Context (fallback)';
      } else {
        label = ctx.path === path.join(projectDir, 'CLAUDE.md')
          ? 'Project Context'
          : dirName + ' Context';
      }
      parts.push('\n# ' + label + '\n' + ctx.content);
    }

    return parts.join('\n\n');
  });

  // Log a chat event to a dashboard's logs.json
  ipcMain.handle('log-chat-event', async (_event, dashboardId, entry) => {
    const logsFile = path.join(DASHBOARDS_DIR, dashboardId, 'logs.json');
    let logs;
    try {
      logs = JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
    } catch (e) {
      logs = { entries: [] };
    }
    logs.entries.push({
      timestamp: new Date().toISOString(),
      task_id: entry.task_id || null,
      agent: entry.agent || 'agent-chat',
      level: entry.level || 'info',
      message: entry.message,
      task_name: entry.task_name || 'Agent Chat',
    });
    fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2));
    return { success: true };
  });

  // --- Image attachment handlers ---
  ipcMain.handle('save-temp-images', async (_event, attachments) => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const results = [];
    for (const att of attachments) {
      try {
        const ext = att.mimeType ? '.' + att.mimeType.split('/')[1].split('+')[0] : '.png';
        const filename = 'synapse_attach_' + Date.now() + '_' + Math.random().toString(36).slice(2) + ext;
        const filepath = path.join(os.tmpdir(), filename);
        const base64Data = att.base64.replace(/^data:[^;]+;base64,/, '');
        fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
        results.push({ path: filepath, name: att.name || filename });
      } catch (err) {
        console.error('[save-temp-images] Failed to save attachment:', err.message);
        results.push({ path: null, name: att.name || 'unknown', error: err.message });
      }
    }
    return results;
  });

  ipcMain.handle('spawn-worker', async (_event, opts) => {
    console.log('[spawn-worker] Called with opts:', JSON.stringify({
      provider: opts.provider,
      taskId: opts.taskId,
      model: opts.model,
      cliPath: opts.cliPath,
      projectDir: opts.projectDir,
      promptLen: opts.prompt ? opts.prompt.length : 0,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
    }));
    try {
      if (opts.dashboardId) {
        const dashDir = path.join(DASHBOARDS_DIR, opts.dashboardId);
        if (!fs.existsSync(dashDir)) {
          throw new Error('Dashboard directory does not exist: ' + dashDir);
        }
      }
      const service = opts.provider === 'codex' ? CodexService : ClaudeCodeService;
      const result = service.spawnWorker(opts);
      console.log('[spawn-worker] Spawned PID:', result.pid);
      return result;
    } catch (err) {
      console.error('[spawn-worker] ERROR:', err.message);
      throw err;
    }
  });

  ipcMain.handle('kill-worker', async (_event, pid) => {
    return ClaudeCodeService.killWorker(pid) || CodexService.killWorker(pid);
  });

  ipcMain.handle('kill-all-workers', async () => {
    return ClaudeCodeService.killAllWorkers() + CodexService.killAllWorkers();
  });

  ipcMain.handle('get-active-workers', async () => {
    return ClaudeCodeService.getActiveWorkers().concat(CodexService.getActiveWorkers());
  });

  ipcMain.handle('write-worker', async (_event, pid, data) => {
    return ClaudeCodeService.writeToWorker(pid, data);
  });

  // --- Terminal handlers ---
  ipcMain.handle('spawn-terminal', async (_event, opts) => {
    try {
      const result = TerminalService.spawnTerminal(opts);
      return result;
    } catch (err) {
      console.error('[spawn-terminal] ERROR:', err.message);
      return { error: err.message };
    }
  });

  ipcMain.handle('write-terminal', async (_event, id, data) => {
    return TerminalService.writeTerminal(id, data);
  });

  ipcMain.handle('resize-terminal', async (_event, id, cols, rows) => {
    return TerminalService.resizeTerminal(id, cols, rows);
  });

  ipcMain.handle('kill-terminal', async (_event, id) => {
    return TerminalService.killTerminal(id);
  });

  ipcMain.handle('kill-all-terminals', async () => {
    return TerminalService.killAllTerminals();
  });

  ipcMain.handle('get-active-terminals', async () => {
    return TerminalService.getActiveTerminals();
  });

  // --- Commands handlers ---
  const CommandsService = require('./services/CommandsService');

  ipcMain.handle('list-commands', async (_event, commandsDir) => {
    return CommandsService.listCommands(commandsDir || undefined);
  });

  ipcMain.handle('get-command', async (_event, name, commandsDir) => {
    return CommandsService.getCommand(name, commandsDir || undefined);
  });

  ipcMain.handle('save-command', async (_event, name, content, commandsDir) => {
    return CommandsService.saveCommand(name, content, commandsDir || undefined);
  });

  ipcMain.handle('delete-command', async (_event, name, commandsDir) => {
    return CommandsService.deleteCommand(name, commandsDir || undefined);
  });

  ipcMain.handle('create-command-folder', async (_event, folderName) => {
    return CommandsService.createCommandFolder(folderName);
  });

  ipcMain.handle('save-command-in-folder', async (_event, name, content, folderName) => {
    return CommandsService.saveCommandInFolder(name, content, folderName);
  });

  ipcMain.handle('generate-command', async (_event, description, folderName, commandName, opts) => {
    return CommandsService.generateCommand(description, folderName, commandName, opts || {});
  });

  ipcMain.handle('load-project-claude-md', async (_event, projectDir) => {
    return CommandsService.loadProjectClaudeMd(projectDir);
  });

  ipcMain.handle('list-project-commands', async (_event, projectDir) => {
    return CommandsService.listProjectCommands(projectDir);
  });

  ipcMain.handle('list-user-commands', async () => {
    return CommandsService.listUserCommands();
  });

  ipcMain.handle('get-user-command', async (_event, name, folderName) => {
    return CommandsService.getUserCommand(name, folderName || undefined);
  });

  ipcMain.handle('save-user-command', async (_event, name, content, folderName) => {
    return CommandsService.saveUserCommand(name, content, folderName || undefined);
  });

  ipcMain.handle('delete-user-command', async (_event, name, folderName) => {
    return CommandsService.deleteUserCommand(name, folderName || undefined);
  });

  ipcMain.handle('generate-user-command', async (_event, description, folderName, commandName, opts) => {
    return CommandsService.generateUserCommand(description, folderName, commandName, opts || {});
  });

  // --- Orchestration handlers ---
  const SwarmOrchestrator = require('./services/SwarmOrchestrator');
  SwarmOrchestrator.init(broadcastFn);

  ipcMain.handle('start-swarm', async (_event, dashboardId, opts) => {
    return SwarmOrchestrator.startSwarm(dashboardId, opts);
  });

  ipcMain.handle('pause-swarm', async (_event, dashboardId) => {
    return SwarmOrchestrator.pauseSwarm(dashboardId);
  });

  ipcMain.handle('resume-swarm', async (_event, dashboardId) => {
    return SwarmOrchestrator.resumeSwarm(dashboardId);
  });

  ipcMain.handle('cancel-swarm', async (_event, dashboardId) => {
    return SwarmOrchestrator.cancelSwarm(dashboardId);
  });

  ipcMain.handle('retry-task', async (_event, dashboardId, taskId) => {
    return SwarmOrchestrator.retryTask(dashboardId, taskId);
  });

  ipcMain.handle('get-swarm-states', async () => {
    return SwarmOrchestrator.getSwarmStates();
  });

  // --- Conversation Handlers ---

  // GET conversations -> list-conversations (optional dashboardId filter)
  ipcMain.handle('list-conversations', async (_event, dashboardId) => {
    return { conversations: listConversations(dashboardId || undefined) };
  });

  // POST create-conversation
  ipcMain.handle('create-conversation', async (_event, name) => {
    return createConversation(name);
  });

  // GET conversation -> load-conversation
  ipcMain.handle('load-conversation', async (_event, filename) => {
    const conv = loadConversation(filename);
    if (!conv) return { error: 'Conversation not found' };
    return conv;
  });

  // POST save-conversation
  ipcMain.handle('save-conversation', async (_event, conv) => {
    try {
      const result = saveConversation(conv);
      return { success: true, filename: result.filename, id: result.id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // DELETE delete-conversation
  ipcMain.handle('delete-conversation', async (_event, filename) => {
    return deleteConversation(filename);
  });

  // PATCH rename-conversation
  ipcMain.handle('rename-conversation', async (_event, filename, newName) => {
    return renameConversation(filename, newName);
  });

  // --- File/image handling for chat attachments ---
  ipcMain.handle('save-temp-file', async (_event, base64, mimeType, name) => {
    const os = require('os');
    const ext = mimeType ? mimeType.split('/')[1] || 'png' : 'png';
    const safeName = (name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = safeName.endsWith('.' + ext) ? safeName : safeName + '.' + ext;
    const tempPath = path.join(os.tmpdir(), 'synapse_' + Date.now() + '_' + fileName);
    const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    fs.writeFileSync(tempPath, buffer);
    return { path: tempPath };
  });

  ipcMain.handle('select-image-file', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      title: 'Select Image or File',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeTypes = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    const base64 = 'data:' + mimeType + ';base64,' + data.toString('base64');
    return { path: filePath, base64, mimeType, name: path.basename(filePath) };
  });

  ipcMain.handle('read-file-as-base64', async (_event, filePath) => {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeTypes = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    return { base64: 'data:' + mimeType + ';base64,' + data.toString('base64'), mimeType, name: path.basename(filePath) };
  });

  // ---------------------------------------------------------------------------
  // IDE File System handlers — namespaced with 'ide-' prefix
  // ---------------------------------------------------------------------------

  /**
   * Validate that a file path is within the given workspace root.
   * Rejects directory traversal attempts.
   */
  function ideValidatePath(filePath, workspaceRoot) {
    const resolved = path.resolve(filePath);
    const resolvedRoot = path.resolve(workspaceRoot);
    if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
      throw new Error('Path escapes workspace root: ' + filePath);
    }
    return resolved;
  }

  /**
   * Detect if a file is binary by reading the first 8KB and checking for null bytes.
   */
  function isBinaryFile(buffer) {
    const sampleSize = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleSize; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  }

  /**
   * Default filter for directory entries: skip hidden files and node_modules.
   */
  const IDE_DEFAULT_IGNORE = ['.git', 'node_modules', '.DS_Store', '__pycache__', '.next', '.cache', 'dist', 'build', '.venv', 'venv'];

  /**
   * Read a directory recursively into a tree structure.
   * Uses lstat to avoid following symlinks.
   */
  async function ideReadDirRecursive(dirPath, ignore, maxDepth, currentDepth) {
    if (currentDepth >= maxDepth) return [];

    let entries;
    try {
      entries = await fsPromises.readdir(dirPath);
    } catch (err) {
      return [];
    }

    // Filter out ignored entries and hidden files
    entries = entries.filter(name => {
      if (name.startsWith('.') && ignore.includes(name)) return false;
      if (name.startsWith('.')) return false;
      if (ignore.includes(name)) return false;
      return true;
    });

    // Sort: directories first, then alphabetical
    const results = [];
    for (const name of entries) {
      const fullPath = path.join(dirPath, name);
      try {
        const stat = await fsPromises.lstat(fullPath);
        if (stat.isSymbolicLink()) continue; // skip symlinks entirely
        results.push({
          name,
          path: fullPath,
          type: stat.isDirectory() ? 'directory' : 'file',
          _isDir: stat.isDirectory(),
        });
      } catch (err) {
        // Skip entries we can't stat
        continue;
      }
    }

    // Sort: directories first, then alphabetical case-insensitive
    results.sort((a, b) => {
      if (a._isDir && !b._isDir) return -1;
      if (!a._isDir && b._isDir) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    // Recursively read children for directories
    const tree = [];
    for (const entry of results) {
      const node = { name: entry.name, path: entry.path, type: entry.type };
      if (entry._isDir) {
        node.children = await ideReadDirRecursive(entry.path, ignore, maxDepth, currentDepth + 1);
      }
      tree.push(node);
    }

    return tree;
  }

  // --- ide-read-file: Read file contents, detect binary ---
  ipcMain.handle('ide-read-file', async (_event, filePath, workspaceRoot) => {
    try {
      if (workspaceRoot) ideValidatePath(filePath, workspaceRoot);
      const buffer = await fsPromises.readFile(filePath);
      if (isBinaryFile(buffer)) {
        return { success: true, binary: true, path: filePath, name: path.basename(filePath) };
      }
      return {
        success: true,
        binary: false,
        content: buffer.toString('utf-8'),
        path: filePath,
        name: path.basename(filePath),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-write-file: Write content to a file ---
  ipcMain.handle('ide-write-file', async (_event, filePath, content, workspaceRoot) => {
    try {
      if (workspaceRoot) ideValidatePath(filePath, workspaceRoot);
      await fsPromises.writeFile(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-read-dir: Recursive directory tree ---
  ipcMain.handle('ide-read-dir', async (_event, dirPath, options) => {
    try {
      const opts = options || {};
      const ignore = opts.ignore || IDE_DEFAULT_IGNORE;
      const maxDepth = opts.maxDepth || 20;
      const tree = await ideReadDirRecursive(dirPath, ignore, maxDepth, 0);
      return {
        success: true,
        tree: {
          name: path.basename(dirPath),
          path: dirPath,
          type: 'directory',
          children: tree,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-list-dir: Single-level directory listing (lazy load) ---
  ipcMain.handle('ide-list-dir', async (_event, dirPath, options) => {
    try {
      const opts = options || {};
      const ignore = opts.ignore || IDE_DEFAULT_IGNORE;

      let entries = await fsPromises.readdir(dirPath);

      // Only filter specific ignored names, not all dotfiles
      entries = entries.filter(name => !ignore.includes(name));

      const results = [];
      for (const name of entries) {
        const fullPath = path.join(dirPath, name);
        try {
          const stat = await fsPromises.lstat(fullPath);
          if (stat.isSymbolicLink()) continue;
          const isDir = stat.isDirectory();
          results.push({
            name,
            path: fullPath,
            type: isDir ? 'directory' : 'file',
            ...(isDir ? { children: null } : {}),
          });
        } catch (err) {
          continue;
        }
      }

      // Sort: directories first, then alphabetical case-insensitive
      results.sort((a, b) => {
        const aDir = a.type === 'directory';
        const bDir = b.type === 'directory';
        if (aDir && !bDir) return -1;
        if (!aDir && bDir) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      return { success: true, entries: results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-create-file: Create a new file ---
  ipcMain.handle('ide-create-file', async (_event, filePath, content, workspaceRoot) => {
    try {
      if (workspaceRoot) ideValidatePath(filePath, workspaceRoot);
      // Ensure parent directory exists
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      // Fail if file already exists
      try {
        await fsPromises.access(filePath);
        return { success: false, error: 'File already exists: ' + filePath };
      } catch (_) {
        // File doesn't exist — good, proceed
      }
      await fsPromises.writeFile(filePath, content || '', 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-create-folder: Create a new directory ---
  ipcMain.handle('ide-create-folder', async (_event, dirPath, workspaceRoot) => {
    try {
      if (workspaceRoot) ideValidatePath(dirPath, workspaceRoot);
      await fsPromises.mkdir(dirPath, { recursive: true });
      return { success: true, path: dirPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-rename: Rename a file or folder ---
  ipcMain.handle('ide-rename', async (_event, oldPath, newPath, workspaceRoot) => {
    try {
      if (workspaceRoot) {
        ideValidatePath(oldPath, workspaceRoot);
        ideValidatePath(newPath, workspaceRoot);
      }
      await fsPromises.rename(oldPath, newPath);
      return { success: true, oldPath, newPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-delete: Delete a file or folder ---
  ipcMain.handle('ide-delete', async (_event, targetPath, workspaceRoot) => {
    try {
      if (workspaceRoot) ideValidatePath(targetPath, workspaceRoot);
      const stat = await fsPromises.lstat(targetPath);
      if (stat.isDirectory()) {
        await fsPromises.rm(targetPath, { recursive: true, force: true });
      } else {
        await fsPromises.unlink(targetPath);
      }
      return { success: true, path: targetPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-select-folder: Native folder picker dialog for IDE ---
  ipcMain.handle('ide-select-folder', async () => {
    const { dialog } = require('electron');
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Open Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });



  // ---------------------------------------------------------------------------
  // IDE Diagnostics — Syntax checking for JSON, JS/JSX, CSS
  // ---------------------------------------------------------------------------

  /**
   * Map file extension to a language identifier.
   */
  function ideDiagLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.json': return 'json';
      case '.js': case '.jsx': case '.mjs': case '.cjs': return 'javascript';
      case '.ts': case '.tsx': case '.mts': case '.cts': return 'typescript';
      case '.css': return 'css';
      default: return null;
    }
  }

  /**
   * Check JSON syntax. Returns diagnostics array.
   */
  function ideDiagJSON(content, filePath) {
    try {
      JSON.parse(content);
      return [];
    } catch (err) {
      const msg = err.message || 'Invalid JSON';
      // JSON.parse errors include "at position N" — derive line/col from that
      let line = 1;
      let column = 1;
      const posMatch = msg.match(/position\s+(\d+)/i);
      if (posMatch) {
        const pos = parseInt(posMatch[1], 10);
        let offset = 0;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (offset + lines[i].length + 1 > pos) {
            line = i + 1;
            column = pos - offset + 1;
            break;
          }
          offset += lines[i].length + 1; // +1 for newline
        }
      } else {
        // Some environments use "at line N column M"
        const lineMatch = msg.match(/line\s+(\d+)/i);
        const colMatch = msg.match(/column\s+(\d+)/i);
        if (lineMatch) line = parseInt(lineMatch[1], 10);
        if (colMatch) column = parseInt(colMatch[1], 10);
      }
      return [{
        file: filePath,
        line,
        column,
        endLine: line,
        endColumn: column + 1,
        message: msg.replace(/^JSON\.parse:\s*/i, '').replace(/\n.*/s, ''),
        severity: 'error',
        source: 'json',
      }];
    }
  }

  /**
   * Check JavaScript/JSX syntax using Node.js vm module. Returns diagnostics array.
   */
  function ideDiagJS(content, filePath) {
    try {
      // Use vm.compileFunction which gives better error reporting than new vm.Script
      vm.compileFunction(content, [], { filename: filePath });
      return [];
    } catch (err) {
      const msg = err.message || 'Syntax error';
      // V8 SyntaxError format: "filename:line\n<code>\n<pointer>\n\nSyntaxError: message"
      // or the err object has .lineNumber and .columnNumber in some versions
      let line = 1;
      let column = 1;

      // Try the stack trace first — it often has the line info
      if (err.stack) {
        // Pattern: "filename:LINE\n" at the start
        const stackMatch = err.stack.match(/:(\d+)\n/);
        if (stackMatch) {
          line = parseInt(stackMatch[1], 10);
        }
      }

      // Some V8 errors include a pointer line with caret
      if (err.stack) {
        const lines = err.stack.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().startsWith('^')) {
            // The caret position indicates the column
            column = lines[i].indexOf('^') + 1;
            break;
          }
        }
      }

      // Clean the message — extract just the SyntaxError description
      let cleanMsg = msg;
      const syntaxMatch = msg.match(/SyntaxError:\s*(.+)/);
      if (syntaxMatch) cleanMsg = syntaxMatch[1];
      // Remove trailing context lines
      cleanMsg = cleanMsg.split('\n')[0].trim();

      return [{
        file: filePath,
        line,
        column,
        endLine: line,
        endColumn: column + 1,
        message: cleanMsg || 'Syntax error',
        severity: 'error',
        source: 'javascript',
      }];
    }
  }

  /**
   * Check CSS syntax (basic bracket/brace/string matching). Returns diagnostics array.
   */
  function ideDiagCSS(content, filePath) {
    const diagnostics = [];
    const stack = []; // track open brackets/braces/parens
    let inString = false;
    let stringChar = '';
    let inComment = false;
    let inLineComment = false;
    let line = 1;
    let col = 1;

    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      const next = content[i + 1];

      if (ch === '\n') {
        if (inLineComment) inLineComment = false;
        line++;
        col = 1;
        continue;
      }

      // Handle comments
      if (!inString && !inComment && !inLineComment && ch === '/' && next === '*') {
        inComment = true;
        i++; col += 2;
        continue;
      }
      if (inComment && ch === '*' && next === '/') {
        inComment = false;
        i++; col += 2;
        continue;
      }
      if (inComment || inLineComment) {
        col++;
        continue;
      }

      // Handle strings
      if (inString) {
        if (ch === '\\') {
          i++; col += 2; // skip escaped char
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
        col++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        col++;
        continue;
      }

      // Track brackets
      if (ch === '{' || ch === '(' || ch === '[') {
        stack.push({ ch, line, col });
      } else if (ch === '}' || ch === ')' || ch === ']') {
        const expected = ch === '}' ? '{' : ch === ')' ? '(' : '[';
        if (stack.length === 0) {
          diagnostics.push({
            file: filePath,
            line,
            column: col,
            endLine: line,
            endColumn: col + 1,
            message: `Unexpected '${ch}' — no matching opening bracket`,
            severity: 'error',
            source: 'css',
          });
        } else {
          const top = stack[stack.length - 1];
          if (top.ch !== expected) {
            diagnostics.push({
              file: filePath,
              line,
              column: col,
              endLine: line,
              endColumn: col + 1,
              message: `Mismatched bracket: expected closing for '${top.ch}' (opened at line ${top.line}:${top.col}) but found '${ch}'`,
              severity: 'error',
              source: 'css',
            });
          }
          stack.pop();
        }
      }

      col++;
    }

    // Check unclosed brackets
    for (const open of stack) {
      const closeChar = open.ch === '{' ? '}' : open.ch === '(' ? ')' : ']';
      diagnostics.push({
        file: filePath,
        line: open.line,
        column: open.col,
        endLine: open.line,
        endColumn: open.col + 1,
        message: `Unclosed '${open.ch}' — expected '${closeChar}'`,
        severity: 'error',
        source: 'css',
      });
    }

    // Check unclosed strings
    if (inString) {
      diagnostics.push({
        file: filePath,
        line,
        column: col,
        endLine: line,
        endColumn: col + 1,
        message: `Unclosed string (started with ${stringChar})`,
        severity: 'error',
        source: 'css',
      });
    }

    // Check unclosed comments
    if (inComment) {
      diagnostics.push({
        file: filePath,
        line,
        column: col,
        endLine: line,
        endColumn: col + 1,
        message: 'Unclosed block comment (missing */)',
        severity: 'warning',
        source: 'css',
      });
    }

    return diagnostics;
  }

  /**
   * Run diagnostics on a single file's content.
   * Returns an array of diagnostics objects.
   */
  function ideDiagCheck(content, filePath) {
    const lang = ideDiagLanguage(filePath);
    switch (lang) {
      case 'json':       return ideDiagJSON(content, filePath);
      case 'javascript': return ideDiagJS(content, filePath);
      case 'typescript': return ideDiagJS(content, filePath); // vm.compileFunction catches basic syntax errors
      case 'css':        return ideDiagCSS(content, filePath);
      default:           return [];
    }
  }

  // --- ide-check-syntax: Check syntax of a single file ---
  ipcMain.handle('ide-check-syntax', async (_event, filePath, workspaceRoot) => {
    try {
      if (workspaceRoot) ideValidatePath(filePath, workspaceRoot);
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const diagnostics = ideDiagCheck(content, filePath);
      return { success: true, diagnostics };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-check-syntax-batch: Check syntax of multiple files ---
  ipcMain.handle('ide-check-syntax-batch', async (_event, filePaths, workspaceRoot) => {
    try {
      if (!Array.isArray(filePaths)) {
        return { success: false, error: 'filePaths must be an array' };
      }
      const results = {};
      // Process all files concurrently
      await Promise.all(filePaths.map(async (filePath) => {
        try {
          if (workspaceRoot) ideValidatePath(filePath, workspaceRoot);
          const content = await fsPromises.readFile(filePath, 'utf-8');
          results[filePath] = ideDiagCheck(content, filePath);
        } catch (err) {
          results[filePath] = [{
            file: filePath,
            line: 1,
            column: 1,
            endLine: 1,
            endColumn: 1,
            message: err.message,
            severity: 'error',
            source: 'system',
          }];
        }
      }));
      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });



  // ---------------------------------------------------------------------------
  // IDE Search — ripgrep-powered workspace search with Node.js fallback
  // ---------------------------------------------------------------------------

  /**
   * Execute ripgrep with given args. Returns { success, data } or { success: false, error }.
   * Exit code 1 = no matches (not an error).
   */
  function rgExec(args, cwd, opts = {}) {
    return new Promise((resolve) => {
      const options = {
        cwd,
        maxBuffer: opts.maxBuffer || 20 * 1024 * 1024,
        timeout: opts.timeout || 60000,
      };
      execFile('rg', args, options, (error, stdout, stderr) => {
        if (error && error.code === 1) {
          resolve({ success: true, data: '' });
        } else if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true, data: stdout });
        }
      });
    });
  }

  /**
   * Build ripgrep CLI args from search query and options.
   */
  function buildRgArgs(query, options) {
    const args = ['--json', '--max-filesize', '1M', '--max-count', '500'];

    for (const pattern of IDE_DEFAULT_IGNORE) {
      args.push('--glob', '!' + pattern);
    }
    // Also skip hidden files/dirs
    args.push('--glob', '!.*');

    if (!options.caseSensitive) args.push('-i');
    if (options.wholeWord) args.push('-w');
    if (options.regex) {
      args.push('-e', query);
    } else {
      args.push('-F', '--', query);
    }

    if (options.includeGlob) {
      options.includeGlob.split(',').map(function(g) { return g.trim(); }).filter(Boolean).forEach(function(g) {
        args.push('--glob', g);
      });
    }
    if (options.excludeGlob) {
      options.excludeGlob.split(',').map(function(g) { return g.trim(); }).filter(Boolean).forEach(function(g) {
        args.push('--glob', '!' + g);
      });
    }

    return args;
  }

  /**
   * Parse ripgrep --json output into structured results.
   */
  function parseRgOutput(output, workspacePath, maxResults) {
    var results = {};
    var totalMatches = 0;
    var truncated = false;

    var lines = output.split('\n').filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      var parsed;
      try { parsed = JSON.parse(lines[i]); } catch (e) { continue; }

      if (parsed.type === 'match') {
        if (totalMatches >= maxResults) { truncated = true; break; }

        var filePath = parsed.data.path.text;
        var relativePath = path.relative(workspacePath, filePath);

        if (!results[filePath]) {
          results[filePath] = { file: filePath, relativePath: relativePath, matches: [] };
        }

        var submatches = parsed.data.submatches || [];
        for (var j = 0; j < submatches.length; j++) {
          totalMatches++;
          if (totalMatches > maxResults) { truncated = true; break; }
          results[filePath].matches.push({
            line: parsed.data.line_number,
            column: submatches[j].start + 1,
            lineContent: (parsed.data.lines.text || '').replace(/\n$/, ''),
            matchStart: submatches[j].start,
            matchLength: submatches[j].end - submatches[j].start,
          });
        }
      }
    }

    return {
      results: Object.values(results),
      totalMatches: totalMatches,
      truncated: truncated,
    };
  }

  /**
   * Node.js fallback search — recursive walk + line-by-line regex matching.
   * Used when ripgrep is not installed.
   */
  async function nodeSearch(workspacePath, query, options, maxResults) {
    var results = {};
    var totalMatches = 0;
    var truncated = false;

    // Build matcher
    var pattern;
    if (options.regex) {
      var flags = options.caseSensitive ? 'g' : 'gi';
      try { pattern = new RegExp(query, flags); } catch (e) {
        return { results: [], totalMatches: 0, truncated: false, error: 'Invalid regex: ' + e.message };
      }
    } else {
      var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var wrapped = options.wholeWord ? '\\b' + escaped + '\\b' : escaped;
      var regFlags = options.caseSensitive ? 'g' : 'gi';
      pattern = new RegExp(wrapped, regFlags);
    }

    // Simple glob matcher for include/exclude
    function matchesGlob(fileName, globStr) {
      if (!globStr) return true;
      var globs = globStr.split(',').map(function(g) { return g.trim(); }).filter(Boolean);
      if (globs.length === 0) return true;
      return globs.some(function(g) {
        // Simple wildcard: *.ext or **/*.ext
        var re = g.replace(/\./g, '\\.').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*');
        return new RegExp('^' + re + '$').test(fileName);
      });
    }

    async function walk(dirPath) {
      if (truncated) return;
      var entries;
      try { entries = await fsPromises.readdir(dirPath); } catch (e) { return; }

      for (var i = 0; i < entries.length; i++) {
        if (truncated) return;
        var name = entries[i];
        if (IDE_DEFAULT_IGNORE.includes(name)) continue;
        if (name.startsWith('.')) continue;
        var fullPath = path.join(dirPath, name);
        var stat;
        try { stat = await fsPromises.lstat(fullPath); } catch (e) { continue; }
        if (stat.isSymbolicLink()) continue;

        if (stat.isDirectory()) {
          await walk(fullPath);
        } else if (stat.isFile() && stat.size < 1048576) {
          // Check include/exclude
          if (options.includeGlob && !matchesGlob(name, options.includeGlob)) continue;
          if (options.excludeGlob && matchesGlob(name, options.excludeGlob)) continue;

          var content;
          try { content = await fsPromises.readFile(fullPath, 'utf-8'); } catch (e) { continue; }

          // Skip binary files
          if (content.indexOf('\0') !== -1) continue;

          var fileLines = content.split('\n');
          for (var li = 0; li < fileLines.length; li++) {
            var line = fileLines[li];
            pattern.lastIndex = 0;
            var match;
            while ((match = pattern.exec(line)) !== null) {
              if (totalMatches >= maxResults) { truncated = true; return; }
              totalMatches++;
              var relativePath = path.relative(workspacePath, fullPath);
              if (!results[fullPath]) {
                results[fullPath] = { file: fullPath, relativePath: relativePath, matches: [] };
              }
              results[fullPath].matches.push({
                line: li + 1,
                column: match.index + 1,
                lineContent: line,
                matchStart: match.index,
                matchLength: match[0].length,
              });
              // Prevent infinite loops on zero-length matches
              if (match[0].length === 0) { pattern.lastIndex++; }
            }
          }
        }
      }
    }

    await walk(workspacePath);
    return { results: Object.values(results), totalMatches: totalMatches, truncated: truncated };
  }

  // --- ide-search-check-rg: Detect ripgrep availability ---
  ipcMain.handle('ide-search-check-rg', async () => {
    try {
      return await new Promise((resolve) => {
        execFile('rg', ['--version'], { timeout: 5000 }, (error, stdout) => {
          if (error) {
            resolve({ available: false });
          } else {
            resolve({ available: true, version: (stdout || '').trim().split('\n')[0] });
          }
        });
      });
    } catch (err) {
      return { available: false };
    }
  });

  // --- ide-search: Search workspace files ---
  ipcMain.handle('ide-search', async (_event, workspacePath, query, options) => {
    try {
      if (!workspacePath || !query) {
        return { success: true, results: [], totalMatches: 0, truncated: false };
      }

      var resolvedPath = path.resolve(workspacePath);
      var opts = options || {};
      var maxResults = opts.maxResults || 5000;

      // Try ripgrep first
      var rgArgs = buildRgArgs(query, opts);
      var rgResult = await rgExec(rgArgs, resolvedPath);

      if (rgResult.success) {
        var parsed = parseRgOutput(rgResult.data, resolvedPath, maxResults);
        return { success: true, results: parsed.results, totalMatches: parsed.totalMatches, truncated: parsed.truncated };
      }

      // If rg not found, fall back to Node.js search
      if (rgResult.error && (rgResult.error.includes('ENOENT') || rgResult.error.includes('not found') || rgResult.error.includes('No such file'))) {
        var nodeResult = await nodeSearch(resolvedPath, query, opts, maxResults);
        if (nodeResult.error) {
          return { success: false, error: nodeResult.error };
        }
        return { success: true, results: nodeResult.results, totalMatches: nodeResult.totalMatches, truncated: nodeResult.truncated };
      }

      return { success: false, error: rgResult.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- ide-search-replace: Replace matches in files ---
  ipcMain.handle('ide-search-replace', async (_event, workspacePath, replacements) => {
    try {
      if (!Array.isArray(replacements) || replacements.length === 0) {
        return { success: true, filesModified: 0, replacementsMade: 0 };
      }

      var filesModified = 0;
      var replacementsMade = 0;

      for (var i = 0; i < replacements.length; i++) {
        var r = replacements[i];
        if (!r.file || !r.matches || r.matches.length === 0) continue;

        if (workspacePath) ideValidatePath(r.file, workspacePath);

        var content = await fsPromises.readFile(r.file, 'utf-8');
        var lines = content.split('\n');

        // Sort matches in reverse order (bottom-up) to preserve positions
        var sortedMatches = r.matches.slice().sort(function(a, b) {
          if (b.line !== a.line) return b.line - a.line;
          return b.column - a.column;
        });

        for (var j = 0; j < sortedMatches.length; j++) {
          var m = sortedMatches[j];
          var lineIdx = m.line - 1;
          if (lineIdx < 0 || lineIdx >= lines.length) continue;
          var lineStr = lines[lineIdx];
          var colIdx = m.matchStart != null ? m.matchStart : (m.column - 1);
          lines[lineIdx] = lineStr.substring(0, colIdx) + r.replacement + lineStr.substring(colIdx + m.matchLength);
          replacementsMade++;
        }

        await fsPromises.writeFile(r.file, lines.join('\n'), 'utf-8');
        filesModified++;
      }

      return { success: true, filesModified: filesModified, replacementsMade: replacementsMade };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });


  // ---------------------------------------------------------------------------
  // Debug Service — Node.js debugging via Chrome DevTools Protocol
  // ---------------------------------------------------------------------------

  const DebugService = require('./services/DebugService');
  DebugService.init(broadcastFn);

  // --- debug-launch: Start a debug session for a Node.js script ---
  ipcMain.handle('debug-launch', async (_event, opts) => {
    try {
      return await DebugService.launch(opts);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-stop: Stop the active debug session ---
  ipcMain.handle('debug-stop', async () => {
    try {
      return DebugService.stop();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-set-breakpoint: Set a breakpoint at a file:line ---
  ipcMain.handle('debug-set-breakpoint', async (_event, filePath, lineNumber, condition) => {
    try {
      return await DebugService.setBreakpoint(filePath, lineNumber, condition);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-remove-breakpoint: Remove a breakpoint by ID ---
  ipcMain.handle('debug-remove-breakpoint', async (_event, breakpointId) => {
    try {
      return await DebugService.removeBreakpoint(breakpointId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-continue: Resume execution ---
  ipcMain.handle('debug-continue', async () => {
    try {
      return await DebugService.resume();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-pause: Pause execution ---
  ipcMain.handle('debug-pause', async () => {
    try {
      return await DebugService.pause();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-step-over: Step over the current statement ---
  ipcMain.handle('debug-step-over', async () => {
    try {
      return await DebugService.stepOver();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-step-into: Step into the next function call ---
  ipcMain.handle('debug-step-into', async () => {
    try {
      return await DebugService.stepInto();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-step-out: Step out of the current function ---
  ipcMain.handle('debug-step-out', async () => {
    try {
      return await DebugService.stepOut();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-evaluate: Evaluate an expression in the debug context ---
  ipcMain.handle('debug-evaluate', async (_event, expression, callFrameId) => {
    try {
      return await DebugService.evaluate(expression, callFrameId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-get-variables: Get variables for a scope/object ---
  ipcMain.handle('debug-get-variables', async (_event, objectId) => {
    try {
      return await DebugService.getVariables(objectId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-get-scopes: Get scopes for the current paused state ---
  ipcMain.handle('debug-get-scopes', async (_event, callFrameId) => {
    try {
      return await DebugService.getScopes(callFrameId);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- debug-session-info: Get current debug session info ---
  ipcMain.handle('debug-session-info', async () => {
    try {
      return { success: true, ...DebugService.getSessionInfo() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------------------------
  // Git Operations — IPC handlers using execFile for security
  // ---------------------------------------------------------------------------

  /**
   * Execute a git command safely using execFile (not exec) to prevent injection.
   * All operations run in the given repoPath directory.
   *
   * @param {string[]} args - git subcommand and arguments
   * @param {string} repoPath - working directory for the git command
   * @param {Object} [opts] - additional options (maxBuffer, etc.)
   * @returns {Promise<{success: boolean, data?: string, error?: string}>}
   */
  function gitExec(args, repoPath, opts = {}) {
    return new Promise((resolve) => {
      const options = {
        cwd: repoPath,
        maxBuffer: opts.maxBuffer || 10 * 1024 * 1024, // 10MB default
        timeout: opts.timeout || 30000, // 30s default
      };
      execFile('git', args, options, (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error: stderr ? stderr.trim() : error.message,
          });
        } else {
          resolve({
            success: true,
            data: stdout,
          });
        }
      });
    });
  }

  /**
   * Validate that a repoPath exists and is a directory.
   * @param {string} repoPath
   */
  async function gitValidateRepoPath(repoPath) {
    if (!repoPath || typeof repoPath !== 'string') {
      throw new Error('repoPath is required and must be a string');
    }
    const resolved = path.resolve(repoPath);
    try {
      const stat = await fsPromises.stat(resolved);
      if (!stat.isDirectory()) {
        throw new Error('repoPath is not a directory: ' + resolved);
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new Error('repoPath does not exist: ' + resolved);
      }
      throw err;
    }
    return resolved;
  }

  // --- git-is-repo: Check if a directory is a git repository ---
  ipcMain.handle('git-is-repo', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(['rev-parse', '--is-inside-work-tree'], resolved);
      return { success: true, data: result.success && result.data.trim() === 'true' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-init: Initialize a new git repository ---
  ipcMain.handle('git-init', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(['init'], resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-status: Get working tree status (porcelain v1 for parsing) ---
  ipcMain.handle('git-status', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(['status', '--porcelain', '-uall'], resolved);
      if (!result.success) return result;

      const staged = [];
      const unstaged = [];
      const untracked = [];

      const lines = result.data.split('\n').filter(Boolean);
      for (const line of lines) {
        const x = line[0]; // index (staging area) status
        const y = line[1]; // worktree status
        const filePath = line.substring(3);

        if (x === '?' && y === '?') {
          untracked.push(filePath);
        } else if (x === '!' && y === '!') {
          // ignored — skip
        } else {
          if (x !== ' ' && x !== '?') {
            staged.push({ status: x, path: filePath });
          }
          if (y !== ' ' && y !== '?') {
            unstaged.push({ status: y, path: filePath });
          }
        }
      }

      return { success: true, data: { staged, unstaged, untracked } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-diff: Get unstaged diff (or staged with --cached) ---
  ipcMain.handle('git-diff', async (_event, repoPath, staged) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const args = staged ? ['diff', '--cached'] : ['diff'];
      const result = await gitExec(args, resolved);
      if (!result.success) return result;
      return { success: true, data: result.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-diff-file: Get diff for a specific file ---
  ipcMain.handle('git-diff-file', async (_event, repoPath, filePath, staged) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath];
      const result = await gitExec(args, resolved);
      if (!result.success) return result;
      return { success: true, data: result.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-log: Get commit log ---
  ipcMain.handle('git-log', async (_event, repoPath, maxCount, extraArgs) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const count = maxCount || 50;
      const args = [
        'log',
        `--max-count=${count}`,
        '--format=%H%n%h%n%an%n%ae%n%aI%n%s%n%b%n---END---',
      ];
      if (Array.isArray(extraArgs)) {
        args.push(...extraArgs);
      }
      const result = await gitExec(args, resolved);
      if (!result.success) return result;
      const commits = [];
      const entries = result.data.split('---END---\n').filter(Boolean);
      for (const entry of entries) {
        const lines = entry.trim().split('\n');
        if (lines.length < 6) continue;
        commits.push({
          hash: lines[0],
          shortHash: lines[1],
          author: lines[2],
          email: lines[3],
          date: lines[4],
          subject: lines[5],
          body: lines.slice(6).join('\n').trim(),
        });
      }
      return { success: true, data: commits };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-branches: List all branches ---
  ipcMain.handle('git-branches', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(
        ['branch', '-a', '--format=%(refname:short)|||%(objectname:short)|||%(upstream:short)|||%(HEAD)'],
        resolved
      );
      if (!result.success) return result;
      const branches = result.data
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, hash, upstream, head] = line.split('|||');
          return {
            name: name.trim(),
            hash: hash.trim(),
            upstream: upstream.trim() || null,
            current: head.trim() === '*',
          };
        });
      return { success: true, data: branches };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-current-branch: Get current branch name ---
  ipcMain.handle('git-current-branch', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-stage: Stage specific files ---
  ipcMain.handle('git-stage', async (_event, repoPath, files) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!Array.isArray(files) || files.length === 0) {
        return { success: false, error: 'files must be a non-empty array' };
      }
      const result = await gitExec(['add', '--', ...files], resolved);
      return result.success
        ? { success: true, data: null }
        : result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-unstage: Unstage specific files ---
  ipcMain.handle('git-unstage', async (_event, repoPath, files) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!Array.isArray(files) || files.length === 0) {
        return { success: false, error: 'files must be a non-empty array' };
      }
      const result = await gitExec(['reset', 'HEAD', '--', ...files], resolved);
      return result.success
        ? { success: true, data: null }
        : result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-stage-all: Stage all changes ---
  ipcMain.handle('git-stage-all', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(['add', '-A'], resolved);
      return result.success
        ? { success: true, data: null }
        : result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-unstage-all: Unstage all changes ---
  ipcMain.handle('git-unstage-all', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(['reset', 'HEAD'], resolved);
      return result.success
        ? { success: true, data: null }
        : result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-commit: Create a commit ---
  ipcMain.handle('git-commit', async (_event, repoPath, message) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return { success: false, error: 'Commit message is required' };
      }
      const result = await gitExec(['commit', '-m', message], resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-push: Push to remote ---
  ipcMain.handle('git-push', async (_event, repoPath, remote, branch, setUpstream) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const args = ['push'];
      if (setUpstream) args.push('-u');
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      const result = await gitExec(args, resolved, { timeout: 60000 });
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-pull: Pull from remote ---
  ipcMain.handle('git-pull', async (_event, repoPath, remote, branch) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const args = ['pull'];
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      const result = await gitExec(args, resolved, { timeout: 60000 });
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-fetch: Fetch from remote ---
  ipcMain.handle('git-fetch', async (_event, repoPath, remote) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const args = ['fetch'];
      if (remote) args.push(remote);
      else args.push('--all');
      const result = await gitExec(args, resolved, { timeout: 60000 });
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-checkout: Checkout a branch or commit ---
  ipcMain.handle('git-checkout', async (_event, repoPath, target) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!target || typeof target !== 'string') {
        return { success: false, error: 'Checkout target is required' };
      }
      const result = await gitExec(['checkout', target], resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-create-branch: Create and optionally checkout a new branch ---
  ipcMain.handle('git-create-branch', async (_event, repoPath, branchName, checkout) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!branchName || typeof branchName !== 'string') {
        return { success: false, error: 'Branch name is required' };
      }
      const args = checkout !== false
        ? ['checkout', '-b', branchName]
        : ['branch', branchName];
      const result = await gitExec(args, resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-delete-branch: Delete a branch ---
  ipcMain.handle('git-delete-branch', async (_event, repoPath, branchName, force) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!branchName || typeof branchName !== 'string') {
        return { success: false, error: 'Branch name is required' };
      }
      const flag = force ? '-D' : '-d';
      const result = await gitExec(['branch', flag, branchName], resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-merge: Merge a branch into the current branch ---
  ipcMain.handle('git-merge', async (_event, repoPath, branchName) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!branchName || typeof branchName !== 'string') {
        return { success: false, error: 'Branch name is required' };
      }
      const result = await gitExec(['merge', branchName], resolved, { timeout: 60000 });
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-stash: Stash current changes ---
  ipcMain.handle('git-stash', async (_event, repoPath, message) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const args = ['stash', 'push'];
      if (message && typeof message === 'string') {
        args.push('-m', message);
      }
      const result = await gitExec(args, resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-stash-pop: Pop the most recent stash ---
  ipcMain.handle('git-stash-pop', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(['stash', 'pop'], resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-remotes: List remotes with URLs ---
  ipcMain.handle('git-remotes', async (_event, repoPath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const result = await gitExec(['remote', '-v'], resolved);
      if (!result.success) return result;
      const remotes = {};
      result.data
        .split('\n')
        .filter(Boolean)
        .forEach((line) => {
          const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
          if (match) {
            const [, name, url, type] = match;
            if (!remotes[name]) remotes[name] = {};
            remotes[name][type] = url;
          }
        });
      const remoteList = Object.entries(remotes).map(([name, urls]) => ({
        name,
        fetchUrl: urls.fetch || null,
        pushUrl: urls.push || null,
      }));
      return { success: true, data: remoteList };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-reset: Reset to a specific commit ---
  ipcMain.handle('git-reset', async (_event, repoPath, target, mode) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const validModes = ['--soft', '--mixed', '--hard'];
      const resetMode = validModes.includes(mode) ? mode : '--mixed';
      const args = ['reset', resetMode];
      if (target) args.push(target);
      const result = await gitExec(args, resolved);
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-revert: Revert a specific commit ---
  ipcMain.handle('git-revert', async (_event, repoPath, commitHash) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!commitHash || typeof commitHash !== 'string') {
        return { success: false, error: 'Commit hash is required' };
      }
      const result = await gitExec(['revert', '--no-edit', commitHash], resolved, { timeout: 60000 });
      if (!result.success) return result;
      return { success: true, data: result.data.trim() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-ahead-behind: Count commits ahead/behind upstream ---
  ipcMain.handle('git-ahead-behind', async (_event, repoPath, branch) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      // Get current branch if not specified
      let branchName = branch;
      if (!branchName) {
        const brRes = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], resolved);
        if (!brRes.success) return brRes;
        branchName = brRes.data.trim();
      }
      // Get upstream tracking branch
      const upRes = await gitExec(
        ['rev-parse', '--abbrev-ref', `${branchName}@{upstream}`],
        resolved
      );
      if (!upRes.success) {
        return { success: true, data: { ahead: 0, behind: 0, upstream: null } };
      }
      const upstream = upRes.data.trim();
      // Count ahead/behind
      const countRes = await gitExec(
        ['rev-list', '--left-right', '--count', `${branchName}...${upstream}`],
        resolved
      );
      if (!countRes.success) return countRes;
      const parts = countRes.data.trim().split(/\s+/);
      return {
        success: true,
        data: {
          ahead: parseInt(parts[0], 10) || 0,
          behind: parseInt(parts[1], 10) || 0,
          upstream,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-discard-file: Discard changes to a specific file ---
  ipcMain.handle('git-discard-file', async (_event, repoPath, filePath) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'File path is required' };
      }
      // Check if file is untracked
      const statusRes = await gitExec(['status', '--porcelain', '--', filePath], resolved);
      if (statusRes.success && statusRes.data.trim().startsWith('??')) {
        // Untracked file — remove it
        const fullPath = path.join(resolved, filePath);
        await fsPromises.unlink(fullPath);
        return { success: true, data: 'Untracked file removed' };
      }
      // Tracked file — checkout from HEAD
      const result = await gitExec(['checkout', 'HEAD', '--', filePath], resolved);
      if (!result.success) return result;
      return { success: true, data: 'Changes discarded' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- git-graph: Get commit graph with parent info and branch refs for visualization ---
  ipcMain.handle('git-graph', async (_event, repoPath, maxCount) => {
    try {
      const resolved = await gitValidateRepoPath(repoPath);
      const count = maxCount || 150;
      const SEP = '\x01'; // SOH — safe delimiter that won't appear in git data
      const result = await gitExec(
        [
          'log', '--all', '--topo-order',
          `--max-count=${count}`,
          `--format=%H${SEP}%P${SEP}%D${SEP}%s${SEP}%an${SEP}%aI`,
        ],
        resolved
      );
      if (!result.success) return result;

      const commits = [];
      const lines = result.data.split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.split(SEP);
        if (parts.length < 6) continue;
        const hash = parts[0];
        const parents = parts[1] ? parts[1].split(' ').filter(Boolean) : [];
        const refsRaw = parts[2] ? parts[2].trim() : '';
        const refs = refsRaw ? refsRaw.split(',').map(r => r.trim()).filter(Boolean) : [];
        const subject = parts[3];
        const author = parts[4];
        const date = parts[5];
        commits.push({ hash, parents, refs, subject, author, date });
      }

      return { success: true, data: commits };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });


  // --- 3. Set up file watchers with IPC broadcast ---

  const dashboards = listDashboards();

  // Start watchers for all existing dashboards
  for (const id of dashboards) {
    watchDashboard(id, broadcastFn);
  }

  // Start dashboards directory watcher (detects new/removed dashboards)
  startDashboardsWatcher(broadcastFn);

  // Start queue watcher
  startQueueWatcher(broadcastFn);

  // NOTE: Live reload is NOT started — it was for the web dev server, not needed in Electron

  // --- 4. Send initial data once the window is ready ---
  sendInitialData(getMainWindow, dashboards);
}

// ---------------------------------------------------------------------------
// Initial data push — mirrors the SSE /events connection handler
// ---------------------------------------------------------------------------

/**
 * Send initial data to the renderer once the window is available.
 * Mirrors the SSE /events endpoint's initial data burst.
 *
 * @param {Function} getMainWindow - returns the BrowserWindow
 * @param {string[]} dashboards - list of dashboard IDs
 */
function sendInitialData(getMainWindow, dashboards) {
  const trySend = () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      // Window not ready yet — retry shortly
      setTimeout(trySend, 100);
      return;
    }

    // Send list of all dashboards (ordered, with custom names)
    const orderedDashboards = getOrderedDashboards();
    win.webContents.send('dashboards_list', { dashboards: orderedDashboards, names: getDashboardNames() });

    // Send initial data for each dashboard
    for (const id of dashboards) {
      const init = readDashboardInit(id);
      if (init) {
        win.webContents.send('initialization', { dashboardId: id, ...init });
      }

      const progress = readDashboardProgress(id);
      if (Object.keys(progress).length > 0) {
        win.webContents.send('all_progress', { dashboardId: id, ...progress });
      }
    }

    // Send initial queue data
    const queueSummaries = listQueueSummaries();
    if (queueSummaries.length > 0) {
      win.webContents.send('queue_changed', { queue: queueSummaries });
    }
  };

  // Start trying after a short delay to let the window finish loading
  setTimeout(trySend, 200);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Stop all file watchers. Call on app quit.
 */
function stopWatchers() {
  stopAllWatchers();
}

module.exports = { registerIPCHandlers, stopWatchers };
