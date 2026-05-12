# `!start`

**Purpose:** Start the Synapse dashboard. There are two modes: **Electron app** (recommended, embeds the server) and **standalone server** (browser-only).

**Syntax:** `!start`

---

## Steps

### Option A: Electron App (recommended)

The Electron app embeds the SSE server, so starting the app starts everything.

1. **Locate the tracker directory.** Find the Synapse directory containing `package.json` and `electron/main.js`.

2. **Launch the Electron app.**

   On macOS / Linux, keep the standard npm start path:
   ```bash
   cd {tracker_root} && npm start
   ```

   On Windows PowerShell, do not use `npm start` because the package script uses Unix `unset`. Build, clear `ELECTRON_RUN_AS_NODE`, then launch Electron directly:
   ```powershell
   Set-Location "{tracker_root}"
   npm run build
   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
   npx electron .
   ```
   This launches the Synapse desktop app, which automatically starts the embedded SSE server.

3. **Report.** Tell the user the Synapse dashboard app is running.

> **Note:** Do NOT also start the standalone server (`node src/server/index.js`) when using Electron mode -- the Electron app already runs the server internally. Running both will cause a port conflict on port 3456.

### Option B: Standalone Server (browser-only, no Electron)

Use this if the user explicitly requests the standalone server or Electron is not available.

1. **Check if already running.**

   On macOS / Linux:
   ```bash
   lsof -i :3456 -t 2>/dev/null
   ```

   On Windows PowerShell:
   ```powershell
   Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue
   ```
   If a PID is returned, the server is already running. Report this and provide the URL.

2. **Start the server.**

   On macOS / Linux:
   ```bash
   node {tracker_root}/src/server/index.js &
   ```
   Wait 1 second, then verify:
   ```bash
   curl -s http://127.0.0.1:3456/api/dashboards > /dev/null && echo "Server running" || echo "Server failed to start"
   ```

   On Windows PowerShell:
   ```powershell
   Start-Process node -ArgumentList "{tracker_root}\src\server\index.js" -WorkingDirectory "{tracker_root}"
   Start-Sleep -Seconds 1
   try {
     Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3456/api/dashboards | Out-Null
     "Server running"
   } catch {
     "Server failed to start"
   }
   ```

3. **Report.** Tell the user: "Dashboard server running at http://localhost:3456"
