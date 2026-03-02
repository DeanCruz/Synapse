const { HEARTBEAT_MS } = require('./utils/constants');

// --- SSE Client Management ---

const sseClients = new Set();

/**
 * Broadcast an SSE event to all connected clients.
 * Cleans up destroyed/ended connections automatically.
 */
function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    if (res.destroyed || res.writableEnded) {
      sseClients.delete(res);
      continue;
    }
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

/**
 * Add an SSE client response to the tracked set.
 */
function addClient(res) {
  sseClients.add(res);
}

/**
 * Remove an SSE client response from the tracked set.
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
    for (const res of sseClients) {
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
  for (const client of sseClients) {
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
