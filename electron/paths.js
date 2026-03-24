// electron/paths.js — Centralized path resolver for dev and packaged modes
//
// Dev mode:        All paths resolve relative to repo root (PROJECT_ROOT).
// Packaged mode:   Read-only resources from process.resourcesPath/synapse/,
//                  writable data from app.getPath('userData')/synapse-data/.
//
// The packaged layout uses a FLAT synapse/ structure under extraResources
// (e.g. synapse/agent, synapse/dashboards, synapse/CLAUDE.md). There are
// NO readonly/ or writable/ subdirectories.
//
// Exports: init(electronApp), getResourcesRoot(), getDataRoot(), getProjectRoot(), initDataDir()

const fs = require('fs');
const path = require('path');

// --- State ---

let electronApp = null;
let isPackaged = false;
let resourcesRoot = null; // Read-only assets (agent/, documentation/, CLAUDE.md)
let dataRoot = null;       // Writable data (dashboards/, _commands/, tasks/, etc.)
let projectRoot = null;    // The Synapse repo root (tracker_root for worker agents)

// Repo root — works in both dev and standalone server contexts
const REPO_ROOT = path.resolve(__dirname, '..');

// --- Electron detection ---

let electronAvailable = false;
try {
  require('electron');
  electronAvailable = true;
} catch (_e) {
  // Not running in Electron (e.g. standalone server mode)
}

// --- Public API ---

/**
 * Initialize the paths module. Must be called after app.whenReady() in the
 * Electron main process. Sets up resourcesRoot, dataRoot, projectRoot and
 * exports them as environment variables for the server process.
 *
 * @param {Electron.App} appInstance — the Electron app object
 */
function init(appInstance) {
  electronApp = appInstance;
  isPackaged = electronApp.isPackaged;

  if (isPackaged) {
    // Packaged: read-only resources bundled via extraResources (flat synapse/ dir)
    resourcesRoot = path.join(process.resourcesPath, 'synapse');

    // Packaged: writable data lives in the user-data directory
    dataRoot = path.join(electronApp.getPath('userData'), 'synapse-data');

    // projectRoot in packaged mode is the writable data root — this is what
    // worker agents reference as {tracker_root}. It contains dashboards/,
    // tasks/, _commands/, etc. alongside copies of read-only files.
    projectRoot = dataRoot;
  } else {
    // Dev: everything resolves to the repo root
    resourcesRoot = REPO_ROOT;
    dataRoot = REPO_ROOT;
    projectRoot = REPO_ROOT;
  }

  // Export as env vars so src/server/utils/constants.js can consume them
  // without a direct require of this Electron module.
  process.env.SYNAPSE_RESOURCES_ROOT = resourcesRoot;
  process.env.SYNAPSE_DATA_ROOT = dataRoot;

  return { resourcesRoot, dataRoot, projectRoot };
}

/**
 * Returns the root directory for read-only resources.
 * In dev: repo root. In packaged: process.resourcesPath/synapse/.
 */
function getResourcesRoot() {
  if (resourcesRoot) return resourcesRoot;
  // Fallback when init() hasn't been called (standalone server mode)
  return process.env.SYNAPSE_RESOURCES_ROOT || REPO_ROOT;
}

/**
 * Returns the root directory for writable data.
 * In dev: repo root. In packaged: app.getPath('userData')/synapse-data/.
 */
function getDataRoot() {
  if (dataRoot) return dataRoot;
  // Fallback when init() hasn't been called (standalone server mode)
  return process.env.SYNAPSE_DATA_ROOT || REPO_ROOT;
}

/**
 * Returns the Synapse project root that workers reference as {tracker_root}.
 * In dev: repo root. In packaged: the writable data root.
 */
function getProjectRoot() {
  if (projectRoot) return projectRoot;
  // Fallback: use DATA_ROOT env var, then repo root
  return process.env.SYNAPSE_DATA_ROOT || REPO_ROOT;
}

/**
 * Seed writable data directory on first launch in packaged mode.
 * Copies template writable directories from the flat synapse/ resources
 * to the userData synapse-data/ directory.
 *
 * Idempotent: only copies directories/files that do NOT already exist
 * in the target location. Never overwrites existing user data.
 *
 * Should be called after init() and before starting the server.
 */
function initDataDir() {
  if (!isPackaged) {
    // In dev mode, all data is already in the repo root — nothing to seed.
    return;
  }

  // Flat synapse/ structure — everything lives directly under synapse/
  const writableSourceRoot = path.join(process.resourcesPath, 'synapse');

  // Ensure the data root directory exists
  _ensureDir(dataRoot);

  // Writable directories to seed from the flat synapse/ bundle
  const writableDirs = [
    'dashboards',
    '_commands',
    'tasks',
    'Archive',
    'queue',
    'history',
    'conversations',
  ];

  for (const dirName of writableDirs) {
    const source = path.join(writableSourceRoot, dirName);
    const target = path.join(dataRoot, dirName);

    if (fs.existsSync(target)) {
      // Target already exists — do NOT overwrite user data
      continue;
    }

    if (fs.existsSync(source)) {
      _copyDirRecursive(source, target);
    } else {
      // Source template doesn't exist — just create an empty directory
      _ensureDir(target);
    }
  }

  // Also copy read-only resources that workers expect to find at projectRoot.
  // These are referenced as {tracker_root}/agent/, {tracker_root}/CLAUDE.md, etc.
  // In packaged mode projectRoot === dataRoot, so copy them there.
  const readonlyItems = [
    { name: 'agent', isDir: true },
    { name: 'documentation', isDir: true },
    { name: 'CLAUDE.md', isDir: false },
  ];

  for (const item of readonlyItems) {
    const source = path.join(resourcesRoot, item.name);
    const target = path.join(dataRoot, item.name);

    if (fs.existsSync(target)) {
      // Already exists — skip (symlink or prior copy)
      continue;
    }

    if (!fs.existsSync(source)) {
      continue;
    }

    if (item.isDir) {
      _copyDirRecursive(source, target);
    } else {
      _ensureDir(path.dirname(target));
      fs.copyFileSync(source, target);
    }
  }
}

// --- Internal Helpers ---

/**
 * Recursively copy a directory, skipping dotfiles and node_modules.
 * Only copies entries that don't already exist at the target.
 */
function _copyDirRecursive(source, target) {
  _ensureDir(target);

  let entries;
  try {
    entries = fs.readdirSync(source, { withFileTypes: true });
  } catch (e) {
    // Source unreadable — skip silently
    return;
  }

  for (const entry of entries) {
    // Skip dotfiles and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }

    const srcPath = path.join(source, entry.name);
    const destPath = path.join(target, entry.name);

    if (fs.existsSync(destPath)) {
      // Already exists — never overwrite
      continue;
    }

    if (entry.isDirectory()) {
      _copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        // Copy failed — skip this file (non-fatal)
        console.error('[paths] Failed to copy', srcPath, '->', destPath, e.message);
      }
    }
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function _ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (e) {
      console.error('[paths] Failed to create directory', dirPath, e.message);
    }
  }
}

module.exports = { init, getResourcesRoot, getDataRoot, getProjectRoot, initDataDir };
