const path = require('path');

const PORT = process.env.PORT || 3456;
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DASHBOARDS_DIR = path.join(ROOT, 'dashboards');
const QUEUE_DIR = path.join(ROOT, 'queue');
const ARCHIVE_DIR = path.join(ROOT, 'Archive');
const HISTORY_DIR = path.join(ROOT, 'history');
const CONVERSATIONS_DIR = path.join(ROOT, 'conversations');
const SYNAPSE_STORAGE_DIR = '.synapse';
const WORKSPACE_STORAGE_DIR_NAMES = Object.freeze({
  dashboards: 'dashboards',
  queue: 'queue',
  archive: 'Archive',
  history: 'history',
  tasks: 'tasks',
  conversations: 'conversations',
});

function resolveWorkspaceRoot(workspaceRoot) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim() === '') return null;
  return path.resolve(workspaceRoot);
}

function resolveWorkspaceStorageRoot(workspaceRoot) {
  const root = resolveWorkspaceRoot(workspaceRoot);
  return root ? path.join(root, SYNAPSE_STORAGE_DIR) : null;
}

function resolveWorkspaceStoragePaths(workspaceRoot) {
  const root = resolveWorkspaceStorageRoot(workspaceRoot);
  if (!root) return null;

  return {
    workspaceRoot: resolveWorkspaceRoot(workspaceRoot),
    storageRoot: root,
    dashboardsDir: path.join(root, WORKSPACE_STORAGE_DIR_NAMES.dashboards),
    queueDir: path.join(root, WORKSPACE_STORAGE_DIR_NAMES.queue),
    archiveDir: path.join(root, WORKSPACE_STORAGE_DIR_NAMES.archive),
    historyDir: path.join(root, WORKSPACE_STORAGE_DIR_NAMES.history),
    tasksDir: path.join(root, WORKSPACE_STORAGE_DIR_NAMES.tasks),
    conversationsDir: path.join(root, WORKSPACE_STORAGE_DIR_NAMES.conversations),
  };
}

// --- Named Constants ---
const INIT_POLL_MS = 100;           // fs.watchFile polling interval for initialization.json and logs.json
const PROGRESS_RETRY_MS = 80;       // Retry delay for reading progress files that may be mid-write
const PROGRESS_READ_DELAY_MS = 30;  // Initial delay before reading a changed progress file
const RECONCILE_DEBOUNCE_MS = 300;  // Debounce interval for reconciling dashboard directory changes
const HEARTBEAT_MS = 15000;         // SSE heartbeat ping interval

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

const DEFAULT_INITIALIZATION = { task: null, agents: [], waves: [], chains: [], history: [] };
const DEFAULT_LOGS = { entries: [] };

module.exports = {
  PORT,
  ROOT,
  DASHBOARDS_DIR,
  QUEUE_DIR,
  ARCHIVE_DIR,
  HISTORY_DIR,
  CONVERSATIONS_DIR,
  SYNAPSE_STORAGE_DIR,
  WORKSPACE_STORAGE_DIR_NAMES,
  resolveWorkspaceRoot,
  resolveWorkspaceStorageRoot,
  resolveWorkspaceStoragePaths,
  INIT_POLL_MS,
  PROGRESS_RETRY_MS,
  PROGRESS_READ_DELAY_MS,
  RECONCILE_DEBOUNCE_MS,
  HEARTBEAT_MS,
  MIME_TYPES,
  DEFAULT_INITIALIZATION,
  DEFAULT_LOGS,
};
