// electron/preload.js — Context bridge exposing IPC API to renderer
// Exposes window.electronAPI with push event listeners and pull request methods.

const { contextBridge, ipcRenderer } = require('electron');

// Channel whitelist for push events (main → renderer)
const PUSH_CHANNELS = [
  'initialization',
  'logs',
  'agent_progress',
  'all_progress',
  'dashboards_list',
  'dashboards_changed',
  'queue_changed',
  'reload',
  'worker-output',
  'worker-complete',
  'worker-error',
  'swarm-state',
  'terminal-output',
  'terminal-exit',
  'ide-file-change',
  'heartbeat',
  'init_state',
  'tasks_unblocked',
];

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Push events (main → renderer) ---

  on: (channel, callback) => {
    if (!PUSH_CHANNELS.includes(channel)) return;
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return listener;
  },

  off: (channel, listener) => {
    if (!PUSH_CHANNELS.includes(channel)) return;
    ipcRenderer.removeListener(channel, listener);
  },

  // --- Pull requests (renderer → main) ---

  // Dashboards
  getDashboards: () => ipcRenderer.invoke('get-dashboards'),
  createDashboard: () => ipcRenderer.invoke('create-dashboard'),
  deleteDashboard: (id) => ipcRenderer.invoke('delete-dashboard', id),
  getDashboardStatuses: () => ipcRenderer.invoke('get-dashboard-statuses'),
  getDashboardInit: (id) => ipcRenderer.invoke('get-dashboard-init', id),
  getDashboardLogs: (id) => ipcRenderer.invoke('get-dashboard-logs', id),
  getDashboardProgress: (id) => ipcRenderer.invoke('get-dashboard-progress', id),
  clearDashboard: (id) => ipcRenderer.invoke('clear-dashboard', id),
  archiveDashboard: (id) => ipcRenderer.invoke('archive-dashboard', id),
  reorderDashboards: (orderedIds) => ipcRenderer.invoke('reorder-dashboards', orderedIds),
  renameDashboard: (id, displayName) => ipcRenderer.invoke('rename-dashboard', id, displayName),
  getDashboardMeta: () => ipcRenderer.invoke('get-dashboard-meta'),
  saveDashboardHistory: (id) => ipcRenderer.invoke('save-dashboard-history', id),
  exportDashboard: (id) => ipcRenderer.invoke('export-dashboard', id),
  getDashboardMetrics: (id) => ipcRenderer.invoke('get-dashboard-metrics', id),

  // Overview
  getOverview: () => ipcRenderer.invoke('get-overview'),

  // Archives
  getArchives: () => ipcRenderer.invoke('get-archives'),
  getArchive: (name) => ipcRenderer.invoke('get-archive', name),
  deleteArchive: (name) => ipcRenderer.invoke('delete-archive', name),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  getHistoryAnalytics: () => ipcRenderer.invoke('get-history-analytics'),

  // Queue
  getQueue: () => ipcRenderer.invoke('get-queue'),
  getQueueItem: (id) => ipcRenderer.invoke('get-queue-item', id),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),

  // Project
  selectProjectDirectory: () => ipcRenderer.invoke('select-project-directory'),
  loadProject: (dirPath) => ipcRenderer.invoke('load-project', dirPath),
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  addRecentProject: (project) => ipcRenderer.invoke('add-recent-project', project),
  getProjectContext: (dirPath) => ipcRenderer.invoke('get-project-context', dirPath),
  scanProjectDirectory: (dirPath, depth) => ipcRenderer.invoke('scan-project-directory', dirPath, depth),
  detectClaudeCli: () => ipcRenderer.invoke('detect-claude-cli'),
  detectAgentCli: (provider) => ipcRenderer.invoke('detect-agent-cli', provider),

  // Task Editor
  createSwarm: (dashboardId, opts) => ipcRenderer.invoke('create-swarm', dashboardId, opts),
  addTask: (dashboardId, task) => ipcRenderer.invoke('add-task', dashboardId, task),
  updateTask: (dashboardId, taskId, updates) => ipcRenderer.invoke('update-task', dashboardId, taskId, updates),
  removeTask: (dashboardId, taskId) => ipcRenderer.invoke('remove-task', dashboardId, taskId),
  addWave: (dashboardId, wave) => ipcRenderer.invoke('add-wave', dashboardId, wave),
  removeWave: (dashboardId, waveId) => ipcRenderer.invoke('remove-wave', dashboardId, waveId),
  nextTaskId: (dashboardId, waveNum) => ipcRenderer.invoke('next-task-id', dashboardId, waveNum),
  validateDependencies: (dashboardId) => ipcRenderer.invoke('validate-dependencies', dashboardId),

  // Commands
  listCommands: (commandsDir) => ipcRenderer.invoke('list-commands', commandsDir),
  getCommand: (name, commandsDir) => ipcRenderer.invoke('get-command', name, commandsDir),
  saveCommand: (name, content, commandsDir) => ipcRenderer.invoke('save-command', name, content, commandsDir),
  deleteCommand: (name, commandsDir) => ipcRenderer.invoke('delete-command', name, commandsDir),
  createCommandFolder: (folderName) => ipcRenderer.invoke('create-command-folder', folderName),
  saveCommandInFolder: (name, content, folderName) => ipcRenderer.invoke('save-command-in-folder', name, content, folderName),
  generateCommand: (description, folderName, commandName, opts) => ipcRenderer.invoke('generate-command', description, folderName, commandName, opts),
  loadProjectClaudeMd: (projectDir) => ipcRenderer.invoke('load-project-claude-md', projectDir),
  listProjectCommands: (projectDir) => ipcRenderer.invoke('list-project-commands', projectDir),

  // Chat context
  getChatSystemPrompt: (projectDir, dashboardId, additionalContextDirs) => ipcRenderer.invoke('get-chat-system-prompt', projectDir, dashboardId, additionalContextDirs),
  logChatEvent: (dashboardId, entry) => ipcRenderer.invoke('log-chat-event', dashboardId, entry),

  // Attachments
  saveTempImages: (attachments) => ipcRenderer.invoke('save-temp-images', attachments),

  // Workers
  spawnWorker: (opts) => ipcRenderer.invoke('spawn-worker', opts),
  killWorker: (pid) => ipcRenderer.invoke('kill-worker', pid),
  killAllWorkers: () => ipcRenderer.invoke('kill-all-workers'),
  getActiveWorkers: () => ipcRenderer.invoke('get-active-workers'),

  // Terminals
  spawnTerminal: (opts) => ipcRenderer.invoke('spawn-terminal', opts),
  writeTerminal: (id, data) => ipcRenderer.invoke('write-terminal', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke('resize-terminal', id, cols, rows),
  killTerminal: (id) => ipcRenderer.invoke('kill-terminal', id),
  killAllTerminals: () => ipcRenderer.invoke('kill-all-terminals'),
  getActiveTerminals: () => ipcRenderer.invoke('get-active-terminals'),

  // Orchestration
  startSwarm: (dashboardId, opts) => ipcRenderer.invoke('start-swarm', dashboardId, opts),
  pauseSwarm: (dashboardId) => ipcRenderer.invoke('pause-swarm', dashboardId),
  resumeSwarm: (dashboardId) => ipcRenderer.invoke('resume-swarm', dashboardId),
  cancelSwarm: (dashboardId) => ipcRenderer.invoke('cancel-swarm', dashboardId),
  retryTask: (dashboardId, taskId) => ipcRenderer.invoke('retry-task', dashboardId, taskId),
  getSwarmStates: () => ipcRenderer.invoke('get-swarm-states'),

  // Conversation management
  listConversations: (dashboardId) => ipcRenderer.invoke('list-conversations', dashboardId),
  loadConversation: (filename) => ipcRenderer.invoke('load-conversation', filename),
  saveConversation: (conv) => ipcRenderer.invoke('save-conversation', conv),
  createConversation: (name) => ipcRenderer.invoke('create-conversation', name),
  deleteConversation: (filename) => ipcRenderer.invoke('delete-conversation', filename),
  renameConversation: (filename, newName) => ipcRenderer.invoke('rename-conversation', filename, newName),

  // File/image handling for chat attachments
  saveTempFile: (base64, mimeType, name) => ipcRenderer.invoke('save-temp-file', base64, mimeType, name),
  selectImageFile: () => ipcRenderer.invoke('select-image-file'),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('read-file-as-base64', filePath),

  // IDE File System
  ideReadFile: (filePath, workspaceRoot) => ipcRenderer.invoke('ide-read-file', filePath, workspaceRoot),
  ideWriteFile: (filePath, content, workspaceRoot) => ipcRenderer.invoke('ide-write-file', filePath, content, workspaceRoot),
  ideReadDir: (dirPath, options) => ipcRenderer.invoke('ide-read-dir', dirPath, options),
  ideCreateFile: (filePath, content, workspaceRoot) => ipcRenderer.invoke('ide-create-file', filePath, content, workspaceRoot),
  ideCreateFolder: (dirPath, workspaceRoot) => ipcRenderer.invoke('ide-create-folder', dirPath, workspaceRoot),
  ideRename: (oldPath, newPath, workspaceRoot) => ipcRenderer.invoke('ide-rename', oldPath, newPath, workspaceRoot),
  ideDelete: (targetPath, workspaceRoot) => ipcRenderer.invoke('ide-delete', targetPath, workspaceRoot),
  ideSelectFolder: () => ipcRenderer.invoke('ide-select-folder'),
});
