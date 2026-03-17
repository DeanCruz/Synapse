// IPCClient — IPC-based replacement for SSEClient in Electron mode
// Same interface as SSEClient: { connect, disconnect }
// Uses window.electronAPI (exposed by preload.js) for push events.

/**
 * Create an IPC client that listens for push events from the Electron main
 * process and dispatches them to the same callbacks SSEClient uses.
 *
 * @param {object} appState — the AppState instance
 * @param {object} callbacks — same callback shape as SSEClient:
 *   onInitialization(dashboardId, initData)
 *   onLogs(dashboardId, logsData)
 *   onAgentProgress(dashboardId, progressData)
 *   onAllProgress(dashboardId, progressMap)
 *   onDashboardsList(dashboards)
 *   onDashboardsChanged(dashboards)
 *   onQueueChanged(queueItems)
 *   onReload()
 *   onOpen()
 *   onError()
 * @returns {{ connect: Function, disconnect: Function }}
 */
export function createIPCClient(appState, callbacks) {
  var listeners = [];

  function stripDashboardId(data) {
    var result = {};
    for (var k in data) {
      if (k !== 'dashboardId') result[k] = data[k];
    }
    return result;
  }

  function connect() {
    disconnect(); // clean up any existing listeners

    var api = window.electronAPI;
    if (!api) {
      console.error('[IPCClient] window.electronAPI not available');
      if (callbacks.onError) callbacks.onError();
      return;
    }

    // Register push event listeners

    listeners.push({
      channel: 'initialization',
      handle: api.on('initialization', function (data) {
        appState.set('lastSSEEventTime', Date.now());
        if (data.dashboardId && callbacks.onInitialization) {
          callbacks.onInitialization(data.dashboardId, stripDashboardId(data));
        }
      }),
    });

    listeners.push({
      channel: 'logs',
      handle: api.on('logs', function (data) {
        appState.set('lastSSEEventTime', Date.now());
        if (callbacks.onLogs) {
          callbacks.onLogs(data.dashboardId || null, data);
        }
      }),
    });

    listeners.push({
      channel: 'agent_progress',
      handle: api.on('agent_progress', function (data) {
        appState.set('lastSSEEventTime', Date.now());
        if (callbacks.onAgentProgress) {
          callbacks.onAgentProgress(data.dashboardId || null, data);
        }
      }),
    });

    listeners.push({
      channel: 'all_progress',
      handle: api.on('all_progress', function (data) {
        appState.set('lastSSEEventTime', Date.now());
        if (callbacks.onAllProgress) {
          callbacks.onAllProgress(data.dashboardId || null, data);
        }
      }),
    });

    listeners.push({
      channel: 'dashboards_list',
      handle: api.on('dashboards_list', function (data) {
        appState.set('lastSSEEventTime', Date.now());
        if (callbacks.onDashboardsList) callbacks.onDashboardsList(data.dashboards || []);
      }),
    });

    listeners.push({
      channel: 'dashboards_changed',
      handle: api.on('dashboards_changed', function (data) {
        appState.set('lastSSEEventTime', Date.now());
        if (callbacks.onDashboardsChanged) callbacks.onDashboardsChanged(data.dashboards || []);
      }),
    });

    listeners.push({
      channel: 'queue_changed',
      handle: api.on('queue_changed', function (data) {
        appState.set('lastSSEEventTime', Date.now());
        if (callbacks.onQueueChanged) callbacks.onQueueChanged(data.queue || []);
      }),
    });

    listeners.push({
      channel: 'reload',
      handle: api.on('reload', function () {
        appState.set('lastSSEEventTime', Date.now());
        if (callbacks.onReload) callbacks.onReload();
      }),
    });

    // Signal connected
    if (callbacks.onOpen) callbacks.onOpen();
  }

  function disconnect() {
    var api = window.electronAPI;
    if (!api) return;
    for (var i = 0; i < listeners.length; i++) {
      api.off(listeners[i].channel, listeners[i].handle);
    }
    listeners = [];
  }

  return { connect: connect, disconnect: disconnect };
}
