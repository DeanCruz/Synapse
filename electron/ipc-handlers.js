// electron/ipc-handlers.js — IPC Data Bridge
// Registers all IPC handlers, bridging existing server services to the Electron renderer.
// Sets up file watchers that push real-time updates via webContents.send().

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

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
} = require('../src/server/services/DashboardService');

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
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(eventName, data);
    }

    // Feed progress updates to the SwarmOrchestrator for dispatch loop
    if (eventName === 'agent_progress' && data && data.task_id && data.dashboardId) {
      try {
        const SwarmOrchestrator = require('./services/SwarmOrchestrator');
        SwarmOrchestrator.handleProgressUpdate(data.dashboardId, data.task_id, data);
      } catch (e) { /* orchestrator not initialized yet */ }
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

  // GET /api/dashboards -> get-dashboards
  ipcMain.handle('get-dashboards', async () => {
    return { dashboards: listDashboards() };
  });

  // POST /api/dashboards -> create-dashboard
  ipcMain.handle('create-dashboard', async () => {
    const id = nextDashboardId();
    ensureDashboard(id);
    watchDashboard(id, broadcastFn);
    broadcastFn('dashboards_changed', { dashboards: listDashboards() });
    return { success: true, id };
  });

  // DELETE /api/dashboards/:id -> delete-dashboard
  ipcMain.handle('delete-dashboard', async (_event, id) => {
    unwatchDashboard(id);
    const deleted = deleteDashboard(id);
    if (!deleted) return { success: false, error: 'Dashboard not found' };
    broadcastFn('dashboards_changed', { dashboards: listDashboards() });
    return { success: true };
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
  ipcMain.handle('get-chat-system-prompt', async (_event, projectDir, dashboardId) => {
    const parts = [];
    const synapseRoot = path.resolve(__dirname, '..');

    // Path reference block — agent must always know both directories AND its dashboard
    parts.push(
      '# Directory References\n\n' +
      'TRACKER ROOT (Synapse): ' + synapseRoot + '\n' +
      'PROJECT ROOT (target project): ' + (projectDir || synapseRoot) + '\n' +
      'DASHBOARD ID: ' + (dashboardId || 'dashboard1') + '\n\n' +
      'You are the agent for **' + (dashboardId || 'dashboard1') + '**. This is your PRE-ASSIGNED dashboard — ' +
      'it was set by the chat view that spawned you. This dashboard binding is AUTHORITATIVE.\n' +
      'When running !p_track or any swarm command, use this dashboard directly — do NOT scan or auto-select a different one.\n' +
      'When running !master_plan_track, use this dashboard for your primary stream (S1) and scan OTHER dashboards for additional streams.\n\n' +
      'Dashboard paths:\n' +
      '  - initialization.json: ' + synapseRoot + '/dashboards/' + (dashboardId || 'dashboard1') + '/initialization.json\n' +
      '  - logs.json: ' + synapseRoot + '/dashboards/' + (dashboardId || 'dashboard1') + '/logs.json\n' +
      '  - Progress files: ' + synapseRoot + '/dashboards/' + (dashboardId || 'dashboard1') + '/progress/{task_id}.json\n\n' +
      'When looking for commands and instructions, ALWAYS check the Synapse directory (TRACKER ROOT) first:\n' +
      '  1. {tracker_root}/_commands/{command}.md — Synapse swarm commands (highest priority)\n' +
      '  2. {tracker_root}/_commands/project/{command}.md — Synapse project commands\n' +
      '  3. {project_root}/_commands/{command}.md — Project-specific commands (lowest priority)\n\n' +
      'Agent instructions live at: {tracker_root}/agent/instructions/\n' +
      'All code work happens in PROJECT ROOT. All Synapse commands/instructions/dashboards live in TRACKER ROOT.'
    );

    // Read Synapse CLAUDE.md FIRST — Synapse context takes priority
    const synapseClaudeMd = path.join(synapseRoot, 'CLAUDE.md');
    try {
      const content = fs.readFileSync(synapseClaudeMd, 'utf-8');
      parts.push('# Synapse Context\n' + content);
    } catch (e) { /* ignore */ }

    // Read all project CLAUDE.md files (root + one-level-deep child directories)
    if (projectDir) {
      const projectContexts = ProjectService.getProjectContext(projectDir);
      for (const ctx of projectContexts) {
        const dirName = path.basename(path.dirname(ctx.path));
        const label = ctx.path === path.join(projectDir, 'CLAUDE.md')
          ? 'Project Context'
          : dirName + ' Context';
        parts.push('\n# ' + label + '\n' + ctx.content);
      }
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

    // Send list of all dashboards
    win.webContents.send('dashboards_list', { dashboards });

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
