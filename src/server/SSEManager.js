const { HEARTBEAT_MS } = require('./utils/constants');

// --- SSE Client Management ---

// Map<response, { dashboardFilter: string|null }>
const sseClients = new Map();

/**
 * Broadcast an SSE event to all connected clients.
 * If a client has a dashboard filter set, only sends events that either:
 *   - contain a matching dashboardId in the data payload, OR
 *   - have no dashboardId (global events like dashboards_list, queue_changed)
 * Clients without a filter receive all events (backward-compatible).
 * Cleans up destroyed/ended connections automatically.
 */
function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const eventDashboardId = data && data.dashboardId ? data.dashboardId : null;

  for (const [res, meta] of sseClients) {
    if (res.destroyed || res.writableEnded) {
      sseClients.delete(res);
      continue;
    }

    // Per-client dashboard filtering
    if (meta.dashboardFilter && eventDashboardId && meta.dashboardFilter !== eventDashboardId) {
      continue; // Skip — this event is for a different dashboard
    }

    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

/**
 * Add an SSE client response to the tracked map.
 * @param {http.ServerResponse} res - The SSE response object
 * @param {object} [options] - Optional configuration
 * @param {string|null} [options.dashboardFilter] - If set, only receive events for this dashboard ID
 */
function addClient(res, options = {}) {
  sseClients.set(res, {
    dashboardFilter: options.dashboardFilter || null,
  });
}

/**
 * Remove an SSE client response from the tracked map.
 */
function removeClient(res) {
  sseClients.delete(res);
}

// --- SSE Heartbeat ---

let heartbeatTimer = null;

/**
 * Start the SSE heartbeat — sends a ping comment to all clients
 * at HEARTBEAT_MS intervals to keep connections alive.
 */
function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    for (const [res] of sseClients) {
      if (res.destroyed || res.writableEnded) {
        sseClients.delete(res);
        continue;
      }
      try {
        res.write(': ping\n\n');
      } catch {
        sseClients.delete(res);
      }
    }
  }, HEARTBEAT_MS);
}

/**
 * Stop the SSE heartbeat timer.
 */
function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/**
 * Close all SSE client connections.
 */
function closeAll() {
  for (const [client] of sseClients) {
    client.end();
  }
  sseClients.clear();
}

module.exports = {
  sseClients,
  broadcast,
  addClient,
  removeClient,
  startHeartbeat,
  stopHeartbeat,
  closeAll,
};
