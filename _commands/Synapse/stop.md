# `!stop`

**Purpose:** Stop the Synapse dashboard server.

**Syntax:** `!stop`

---

## Steps

1. **Find the server process.**

   On macOS / Linux:
   ```bash
   lsof -i :3456 -t 2>/dev/null
   ```

   On Windows PowerShell:
   ```powershell
   Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue |
     Select-Object -ExpandProperty OwningProcess -Unique
   ```

2. **If running, kill it.**

   On macOS / Linux:
   ```bash
   kill $(lsof -i :3456 -t) 2>/dev/null
   ```
   Confirm it stopped:
   ```bash
   sleep 1 && lsof -i :3456 -t 2>/dev/null && echo "Still running" || echo "Server stopped"
   ```

   On Windows PowerShell:
   ```powershell
   Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue |
     Select-Object -ExpandProperty OwningProcess -Unique |
     ForEach-Object { Stop-Process -Id $_ -Force }

   Start-Sleep -Seconds 1
   if (Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue) {
     "Still running"
   } else {
     "Server stopped"
   }
   ```

3. **If not running,** report that the server was not running.

4. **Report.** Confirm the server has been stopped.
