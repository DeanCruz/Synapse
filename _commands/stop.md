# `!stop`

**Purpose:** Stop the Synapse dashboard server.

**Syntax:** `!stop`

---

## Steps

1. **Find the server process.** Run:
   ```bash
   lsof -i :3456 -t 2>/dev/null
   ```

2. **If running, kill it:**
   ```bash
   kill $(lsof -i :3456 -t) 2>/dev/null
   ```
   Confirm it stopped:
   ```bash
   sleep 1 && lsof -i :3456 -t 2>/dev/null && echo "Still running" || echo "Server stopped"
   ```

3. **If not running,** report that the server was not running.

4. **Report.** Confirm the server has been stopped.
