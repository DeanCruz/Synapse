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
];

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Push events (main → renderer) ---

  on: (channel, callback) => {
    if (!PUSH_CHANNELS.includes(channel)) return;
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    // Return the listener so it can be removed
    return listener;
  },

  off: (channel, listener) => {
    if (!PUSH_CHANNELS.includes(channel)) return;
    ipcRenderer.removeListener(channel, listener);
  },

  // --- Pull requests (renderer → main) ---

  // Dashboards
  getDashboards: () => ipcRenderer.invoke('get-dashboards'),
  getDashboardStatuses: () => ipcRenderer.invoke('get-dashboard-statuses'),
  getDashboardInit: (id) => ipcRenderer.invoke('get-dashboard-init', id),
  getDashboardLogs: (id) => ipcRenderer.invoke('get-dashboard-logs', id),
  getDashboardProgress: (id) => ipcRenderer.invoke('get-dashboard-progress', id),
  clearDashboard: (id) => ipcRenderer.invoke('clear-dashboard', id),
  archiveDashboard: (id) => ipcRenderer.invoke('archive-dashboard', id),
  saveDashboardHistory: (id) => ipcRenderer.invoke('save-dashboard-history', id),
  exportDashboard: (id) => ipcRenderer.invoke('export-dashboard', id),

  // Overview
  getOverview: () => ipcRenderer.invoke('get-overview'),

  // Archives
  getArchives: () => ipcRenderer.invoke('get-archives'),
  getArchive: (name) => ipcRenderer.invoke('get-archive', name),
  deleteArchive: (name) => ipcRenderer.invoke('delete-archive', name),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),

  // Queue
  getQueue: () => ipcRenderer.invoke('get-queue'),
  getQueueItem: (id) => ipcRenderer.invoke('get-queue-item', id),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
});
