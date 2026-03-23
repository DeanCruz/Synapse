import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './context/AppContext.jsx';
import App from './App.jsx';
import '../ui/styles/index.css';

// ---------------------------------------------------------------------------
// Electron fetch shim — intercepts /api/* calls and routes through IPC.
// Must run before any component makes a fetch call.
// ---------------------------------------------------------------------------
if (window.electronAPI) {
  const _fetch = window.fetch.bind(window);

  function routeToIPC(api, url, method) {
    if (url === '/api/dashboards/statuses' && method === 'GET') return api.getDashboardStatuses();
    if (url === '/api/dashboards' && method === 'GET') return api.getDashboards();
    if (url === '/api/overview' && method === 'GET') return api.getOverview();
    if (url === '/api/archives' && method === 'GET') return api.getArchives();
    if (url === '/api/history/analytics' && method === 'GET') return api.getHistoryAnalytics();
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
      if (sub === 'metrics' && method === 'GET') return api.getDashboardMetrics(id);
    }

    if (url === '/api/commands' && method === 'GET') return api.listCommands();
    const cmdMatch = url.match(/^\/api\/commands\/([^/]+)$/);
    if (cmdMatch && method === 'GET') return api.getCommand(decodeURIComponent(cmdMatch[1]));

    return null;
  }

  window.fetch = function electronFetch(url, options) {
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

const root = createRoot(document.getElementById('root'));
root.render(
  <AppProvider>
    <App />
  </AppProvider>
);
