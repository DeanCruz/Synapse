// SSEClient — Server-Sent Events connection manager
// ES module. Handles EventSource lifecycle, event parsing, dashboard filtering,
// and reconnection. Replicates the original connectSSE() logic from dashboard.js.

/**
 * Create an SSE client that connects to the /events endpoint and
 * dispatches parsed events to the provided callbacks.
 *
 * @param {object} appState — the AppState instance (used to read currentDashboardId
 *   and to set lastSSEEventTime on each event)
 * @param {object} callbacks — event handler callbacks:
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
export function createSSEClient(appState, callbacks) {
  var evtSource = null;

  function connect() {
    if (evtSource) {
      evtSource.close();
      evtSource = null;
    }
    // Connect without dashboard filter so we receive events for ALL dashboards.
    // This allows the sidebar status dots to update in real-time for every dashboard.
    var sseUrl = '/events';
    evtSource = new EventSource(sseUrl);

    evtSource.addEventListener('initialization', function (e) {
      appState.set('lastSSEEventTime', Date.now());
      var data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      if (data.dashboardId && callbacks.onInitialization) {
        callbacks.onInitialization(data.dashboardId, stripDashboardId(data));
      }
    });

    evtSource.addEventListener('logs', function (e) {
      appState.set('lastSSEEventTime', Date.now());
      var data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      if (callbacks.onLogs) {
        callbacks.onLogs(data.dashboardId || null, data);
      }
    });

    evtSource.addEventListener('agent_progress', function (e) {
      appState.set('lastSSEEventTime', Date.now());
      var data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      if (callbacks.onAgentProgress) {
        callbacks.onAgentProgress(data.dashboardId || null, data);
      }
    });

    evtSource.addEventListener('all_progress', function (e) {
      appState.set('lastSSEEventTime', Date.now());
      var data;
      try { data = JSON.parse(e.data); } catch (err) { return; }
      if (callbacks.onAllProgress) {
        callbacks.onAllProgress(data.dashboardId || null, data);
      }
    });

    evtSource.addEventListener('dashboards_list', function (e) {
      appState.set('lastSSEEventTime', Date.now());
      try {
        var data = JSON.parse(e.data);
        if (callbacks.onDashboardsList) callbacks.onDashboardsList(data.dashboards || []);
      } catch (err) { return; }
    });

    evtSource.addEventListener('dashboards_changed', function (e) {
      appState.set('lastSSEEventTime', Date.now());
      try {
        var data = JSON.parse(e.data);
        if (callbacks.onDashboardsChanged) callbacks.onDashboardsChanged(data.dashboards || []);
      } catch (err) { return; }
    });

    evtSource.addEventListener('queue_changed', function (e) {
      appState.set('lastSSEEventTime', Date.now());
      try {
        var data = JSON.parse(e.data);
        if (callbacks.onQueueChanged) callbacks.onQueueChanged(data.queue || []);
      } catch (err) { return; }
    });

    evtSource.addEventListener('reload', function () {
      appState.set('lastSSEEventTime', Date.now());
      if (callbacks.onReload) callbacks.onReload();
    });

    evtSource.onopen = function () { if (callbacks.onOpen) callbacks.onOpen(); };
    evtSource.onerror = function () { if (callbacks.onError) callbacks.onError(); };
  }

  function disconnect() {
    if (evtSource) {
      evtSource.close();
      evtSource = null;
    }
  }

  return { connect: connect, disconnect: disconnect };
}

/**
 * Strip the dashboardId key from a data object.
 * Used to pass clean initialization data downstream.
 *
 * @param {object} data
 * @returns {object}
 */
function stripDashboardId(data) {
  var result = {};
  for (var k in data) {
    if (k !== 'dashboardId') result[k] = data[k];
  }
  return result;
}
