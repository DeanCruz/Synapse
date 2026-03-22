// webview-main.jsx — Dedicated entry point for VSCode webview context.
// Mirrors main.jsx but boots with the webview bridge instead of Electron IPC.
// No dependency on window.electronAPI — uses useWebviewAPI bridge from task 1.3.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './context/AppContext.jsx';
import App from './App.jsx';
import { createWebviewAPI } from './hooks/useWebviewAPI.js';
import '../ui/styles/index.css';

// ---------------------------------------------------------------------------
// Webview bridge initialisation — create the bridge API and expose it as
// window.electronAPI so every existing component works without modification.
// The bridge's legacy methods (getDashboardStatuses, getDashboards, etc.)
// mirror the Electron preload API surface exactly.
// ---------------------------------------------------------------------------
const webviewAPI = createWebviewAPI();

if (webviewAPI) {
  // Expose on both globals so components using either path find the API.
  window.electronAPI = webviewAPI;

  // Signal to the host extension that the React app is ready.
  webviewAPI.sendReady();
}

// ---------------------------------------------------------------------------
// Fetch shim — identical to the Electron shim in main.jsx, except the
// routing target is the webview bridge API (which is now on window.electronAPI).
// This keeps components that use raw fetch('/api/...') working inside the
// webview just as they do inside Electron.
// ---------------------------------------------------------------------------
if (window.electronAPI) {
  const _fetch = window.fetch.bind(window);

  function routeToIPC(api, url, method) {
    if (url === '/api/dashboards/statuses' && method === 'GET') return api.getDashboardStatuses();
    if (url === '/api/dashboards' && method === 'GET') return api.getDashboards();
    if (url === '/api/overview' && method === 'GET') return api.getOverview();
    if (url === '/api/archives' && method === 'GET') return api.getArchives();
    if (url === '/api/history' && method === 'GET') return api.getHistory();
    if (url === '/api/queue' && method === 'GET') return api.getQueue();

    const archiveMatch = url.match(/^\/api\/archives\/([^/]+)$/);
    if (archiveMatch) {
      const name = decodeURIComponent(archiveMatch[1]);
      if (method === 'GET') return api.getArchive(name);
      if (method === 'DELETE') return api.deleteArchive(name);
    }

    const queueMatch = url.match(/^\/api\/queue\/([^/]+)$/);
    if (queueMatch && method === 'GET') return api.getQueueItem(decodeURIComponent(queueMatch[1]));

    const dashMatch = url.match(/^\/api\/dashboards\/([^/]+)\/(.+)$/);
    if (dashMatch) {
      const id = dashMatch[1];
      const sub = dashMatch[2];
      if (sub === 'initialization' && method === 'GET') return api.getDashboardInit(id);
      if (sub === 'logs' && method === 'GET') return api.getDashboardLogs(id);
      if (sub === 'progress' && method === 'GET') return api.getDashboardProgress(id);
      if (sub === 'clear' && method === 'POST') return api.clearDashboard(id);
      if (sub === 'archive' && method === 'POST') return api.archiveDashboard(id);
      if (sub === 'save-history' && method === 'POST') return api.saveDashboardHistory(id);
      if (sub === 'export' && method === 'GET') return api.exportDashboard(id);
    }

    if (url === '/api/commands' && method === 'GET') return api.listCommands();
    const cmdMatch = url.match(/^\/api\/commands\/([^/]+)$/);
    if (cmdMatch && method === 'GET') return api.getCommand(decodeURIComponent(cmdMatch[1]));

    return null;
  }

  window.fetch = function webviewFetch(url, options) {
    if (typeof url !== 'string' || !url.startsWith('/api/')) {
      return _fetch(url, options);
    }
    const method = (options && options.method) ? options.method.toUpperCase() : 'GET';
    const promise = routeToIPC(window.electronAPI, url, method);
    if (!promise) return _fetch(url, options);
    return promise.then(data => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    }));
  };
}

// ---------------------------------------------------------------------------
// Mount React — identical to main.jsx.
// ---------------------------------------------------------------------------
const root = createRoot(document.getElementById('root'));
root.render(
  <AppProvider>
    <App />
  </AppProvider>
);
