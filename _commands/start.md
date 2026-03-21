# `!start`

**Purpose:** Start the Synapse dashboard server and launch the Electron app.

**Syntax:** `!start`

---

## Steps

1. **Locate the tracker directory.** Find the Synapse directory (Synapse) relative to the current working directory. It contains `src/server/index.js` and the `dashboards/` directory.

2. **Check if already running.** Run:
   ```bash
   lsof -i :3456 -t 2>/dev/null
   ```
   If a PID is returned, the server is already running. Report this to the user and skip to step 4.

3. **Start the server.** Run in the background:
   ```bash
   node {tracker_root}/src/server/index.js &
   ```
   Wait 1 second, then verify it's running:
   ```bash
   curl -s http://127.0.0.1:3456/api/dashboards > /dev/null && echo "Server running" || echo "Server failed to start"
   ```

4. **Open the Electron app.** Run:
   ```bash
   npm start
   ```
   This launches the Synapse Electron app.

5. **Report.** Tell the user the Synapse dashboard app is running.
