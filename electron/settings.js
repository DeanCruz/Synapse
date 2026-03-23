// electron/settings.js — JSON-backed settings store
// Stores settings in {userData}/synapse-settings.json.

const fs = require('fs');
const path = require('path');

let settingsPath = null;
let cache = {};

const DEFAULTS = {
  // Window
  windowWidth: 1400,
  windowHeight: 900,
  windowX: null,
  windowY: null,
  windowMaximized: false,

  // Behavior
  dashboardCount: 5,

  // Performance / Polling
  initPollMs: 100,
  progressRetryMs: 80,
  progressReadDelayMs: 30,
  reconcileDebounceMs: 300,

  // Theme (synced with renderer)
  theme: 'original',
  customColors: null,

  // Dashboard metadata (sidebar order + custom display names)
  dashboardMeta: { order: [], names: {} },

  // Project
  recentProjects: [],
  activeProjectPath: null,
  agentProvider: 'claude',
  claudeCliPath: null,
  codexCliPath: null,
  defaultModel: '',
  dangerouslySkipPermissions: false,
};

function init(electronApp) {
  settingsPath = path.join(electronApp.getPath('userData'), 'synapse-settings.json');
  cache = _load();
}

function get(key) {
  if (key in cache) return cache[key];
  if (key in DEFAULTS) return DEFAULTS[key];
  return undefined;
}

function set(key, value) {
  if (!(key in DEFAULTS)) {
    // Allow storing unknown keys for extensibility (e.g. recentProjects items)
    console.warn('[settings] Unknown setting key:', key);
  }
  cache[key] = value;
  _save();
}

function getAll() {
  var merged = {};
  for (var k in DEFAULTS) {
    merged[k] = (k in cache) ? cache[k] : DEFAULTS[k];
  }
  return merged;
}

function reset() {
  cache = {};
  if (settingsPath) {
    try { fs.unlinkSync(settingsPath); } catch (e) { /* ignore */ }
  }
  return getAll();
}

function _load() {
  if (!settingsPath) return {};
  try {
    var raw = fs.readFileSync(settingsPath, 'utf-8');
    var parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) { /* missing or corrupt — start fresh */ }
  return {};
}

function _save() {
  if (!settingsPath) return;
  try {
    var dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[settings] Failed to save:', e.message);
  }
}

module.exports = { init, get, set, getAll, reset, DEFAULTS };
