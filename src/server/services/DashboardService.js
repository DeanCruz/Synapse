const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { DASHBOARDS_DIR, DEFAULT_INITIALIZATION, DEFAULT_LOGS } = require('../utils/constants');
const { readJSON, readJSONAsync, writeAtomic } = require('../utils/json');

// --- Dashboard Directory Helpers ---

/**
 * Get the absolute path to a dashboard directory.
 */
function getDashboardDir(id) {
  return path.join(DASHBOARDS_DIR, id);
}

/**
 * Ensure a dashboard directory exists with all required subdirectories
 * and default JSON files (initialization.json, logs.json).
 */
function ensureDashboard(id) {
  const dir = getDashboardDir(id);
  const progressDir = path.join(dir, 'progress');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(progressDir)) {
    fs.mkdirSync(progressDir, { recursive: true });
  }
  // Ensure initialization.json exists (required by listDashboards validation)
  const initFile = path.join(dir, 'initialization.json');
  if (!fs.existsSync(initFile)) {
    writeAtomic(initFile, DEFAULT_INITIALIZATION);
  }
  // Ensure logs.json exists
  const logsFile = path.join(dir, 'logs.json');
  if (!fs.existsSync(logsFile)) {
    writeAtomic(logsFile, DEFAULT_LOGS);
  }
}

/**
 * Read and parse a dashboard's initialization.json (sync).
 */
function readDashboardInit(id) {
  const filePath = path.join(getDashboardDir(id), 'initialization.json');
  return readJSON(filePath);
}

/**
 * Read and parse a dashboard's logs.json (sync).
 */
function readDashboardLogs(id) {
  const filePath = path.join(getDashboardDir(id), 'logs.json');
  return readJSON(filePath);
}

/**
 * Read all progress files from a dashboard's progress/ directory (sync).
 * Returns an object keyed by task_id.
 */
function readDashboardProgress(id) {
  const progressDir = path.join(getDashboardDir(id), 'progress');
  const result = {};
  try {
    if (!fs.existsSync(progressDir)) return result;
    const files = fs.readdirSync(progressDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const data = readJSON(path.join(progressDir, file));
      if (data && data.task_id) {
        result[data.task_id] = data;
      }
    }
  } catch { /* ignore */ }
  return result;
}

/**
 * Read and parse a dashboard's initialization.json (async).
 */
async function readDashboardInitAsync(id) {
  return readJSONAsync(path.join(getDashboardDir(id), 'initialization.json'));
}

/**
 * Read and parse a dashboard's logs.json (async).
 */
async function readDashboardLogsAsync(id) {
  return readJSONAsync(path.join(getDashboardDir(id), 'logs.json'));
}

/**
 * Read all progress files from a dashboard's progress/ directory (async).
 * Returns an object keyed by task_id.
 */
async function readDashboardProgressAsync(id) {
  const progressDir = path.join(getDashboardDir(id), 'progress');
  const result = {};
  try {
    const files = await fsPromises.readdir(progressDir);
    const reads = files
      .filter(f => f.endsWith('.json'))
      .map(async (file) => {
        const data = await readJSONAsync(path.join(progressDir, file));
        if (data && data.task_id) result[data.task_id] = data;
      });
    await Promise.all(reads);
  } catch { /* dir may not exist */ }
  return result;
}

/**
 * Delete all .json files from a dashboard's progress/ directory.
 */
function clearDashboardProgress(id) {
  const progressDir = path.join(getDashboardDir(id), 'progress');
  try {
    if (!fs.existsSync(progressDir)) return;
    const files = fs.readdirSync(progressDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(progressDir, file));
      }
    }
  } catch { /* ignore */ }
}

/**
 * List all valid dashboard IDs (directories with initialization.json).
 * Returns a sorted array of dashboard ID strings.
 */
function listDashboards() {
  try {
    if (!fs.existsSync(DASHBOARDS_DIR)) return [];
    const entries = fs.readdirSync(DASHBOARDS_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() &&
        fs.existsSync(path.join(DASHBOARDS_DIR, e.name, 'initialization.json')))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Recursively copy a directory from src to dest (sync).
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Delete a dashboard directory entirely (removes dir, init, logs, progress).
 * Returns true if deleted, false if it didn't exist.
 */
function deleteDashboard(id) {
  const dir = getDashboardDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Generate a new unique dashboard ID as a 6-character hex string.
 * Uses crypto.randomBytes for collision-resistant ID generation.
 * Loops until the generated ID is not already in use.
 */
function nextDashboardId() {
  const existing = new Set(listDashboards());
  let id;
  do {
    id = crypto.randomBytes(3).toString('hex');
  } while (existing.has(id));
  return id;
}

/**
 * Get the creation time (birthtime) of a dashboard directory.
 * Used for initial ordering of dashboards not yet in the persisted order array.
 * Returns epoch ms, or Infinity if unreadable.
 */
function getDashboardCreationTime(id) {
  try {
    const stat = fs.statSync(getDashboardDir(id));
    return stat.birthtimeMs || stat.ctimeMs || Infinity;
  } catch {
    return Infinity;
  }
}

/**
 * Get the complete state of a dashboard: initialization, progress, and logs.
 * Convenience wrapper consolidating the individual read functions.
 *
 * @param {string} id - Dashboard ID
 * @returns {{ initialization: object|null, progress: object, logs: object|null }}
 */
function getFullDashboardState(id) {
  return {
    initialization: readDashboardInit(id),
    progress: readDashboardProgress(id),
    logs: readDashboardLogs(id),
  };
}
module.exports = {
  getDashboardDir,
  ensureDashboard,
  readDashboardInit,
  readDashboardLogs,
  readDashboardProgress,
  readDashboardInitAsync,
  readDashboardLogsAsync,
  readDashboardProgressAsync,
  clearDashboardProgress,
  listDashboards,
  copyDirSync,
  deleteDashboard,
  nextDashboardId,
  getFullDashboardState,
  getDashboardCreationTime,
};
