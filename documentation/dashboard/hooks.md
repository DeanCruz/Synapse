# Hooks Reference

The Synapse Dashboard uses two custom hooks to manage data flow and API access. Both are located in `/src/ui/hooks/`.

---

## useDashboardData

**File:** `/src/ui/hooks/useDashboardData.js`

The primary data hook. Connects to Electron IPC push events, fetches dashboard data on mount and dashboard switches, merges static plan data with dynamic progress data, and monitors connection health.

### Usage

```javascript
// Must be called ONCE at the App level
useDashboardData();
```

This hook does not return a value. It reads from and writes to the AppContext via `useAppState()` and `useDispatch()`.

### Responsibilities

1. **IPC Listener Setup** -- Registers listeners for all push event channels on mount
2. **Initial Data Fetch** -- Fetches dashboard list and statuses eagerly on mount
3. **Dashboard Switch Handling** -- Re-fetches all data when `currentDashboardId` changes
4. **State Merging** -- Calls `mergeState()` when `currentInit` or `currentProgress` changes
5. **Connection Health Monitoring** -- Detects stale connections and triggers recovery

### mergeState Function

```javascript
export function mergeState(init, progress) -> mergedStatus
```

The core data transformation function. Exported for use by the hook and potentially by tests.

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `init` | `object \| null` | Static plan data from `initialization.json` |
| `progress` | `object` | Dynamic progress data: `{ [taskId]: progressObject }` |

**Returns:** A merged status object:

```javascript
{
  active_task: {
    ...init.task,              // All task metadata from init
    completed_tasks: number,   // Count of agents with status 'completed'
    failed_tasks: number,      // Count of agents with status 'failed'
    total_tasks: number,       // From init or agent count
    started_at: string,        // Earliest agent started_at
    completed_at: string,      // Latest agent completed_at (only when all done)
    overall_status: string,    // Derived: 'pending' | 'in_progress' | 'completed' | 'completed_with_errors'
  },
  agents: [                    // One per agent in init
    {
      // Static fields from init:
      id, title, wave, layer, directory, depends_on,
      // Dynamic fields from progress (or defaults):
      status, assigned_agent, started_at, completed_at,
      summary, stage, message, milestones, deviations, logs,
    }
  ],
  waves: [
    {
      id, name,
      total: number,           // From init or agent count
      completed: number,       // Derived from agent statuses
      status: string,          // 'pending' | 'in_progress' | 'completed'
    }
  ],
  chains: [],                  // Pass-through from init
  history: [],                 // Pass-through from init
}
```

**Merge logic for `overall_status`:**

```
if all agents are completed/failed:
  if any failed -> 'completed_with_errors'
  else -> 'completed'
else if any in_progress or completed:
  -> 'in_progress'
else:
  -> existing overall_status or 'pending'
```

**Wave status derivation:**

```
if all wave agents completed -> 'completed'
else if any wave agent active -> 'in_progress'
else -> 'pending'
```

### IPC Push Event Handlers

The hook registers listeners for these channels:

| Channel | Handler Behavior |
|---|---|
| `initialization` | If `dashboardId` matches current, dispatches `SET_INIT` |
| `logs` | Dispatches `SET_DASHBOARD_LOGS` (always) + `SET_LOGS` (if current dashboard) |
| `agent_progress` | Updates per-dashboard progress cache, dispatches `SET_DASHBOARD_PROGRESS` + `SET_PROGRESS` (if current) |
| `all_progress` | Same as `agent_progress` but for the full progress map |
| `dashboards_list` | Updates `dashboardList` |
| `dashboards_changed` | Updates `dashboardList` |
| `init_state` | Full state bundle: updates init, progress, and logs for a dashboard |
| `queue_changed` | Updates `queueItems` |
| `tasks_unblocked` | Sets `unblockedTasks` for the current dashboard |

### Stale Closure Prevention

The hook uses a `currentDashboardIdRef` (a `useRef`) to track the current dashboard ID. IPC push handlers compare incoming `dashboardId` against this ref instead of the stale `state.currentDashboardId` captured in the closure. This prevents updates for one dashboard from being applied to another after a switch.

### Connection Health Monitor

```javascript
// Configuration
HEALTH_CHECK_INTERVAL = 30000  // Check every 30 seconds
STALE_THRESHOLD = 60000        // 60 seconds without any event

// Tracked events for freshness
'heartbeat', 'agent_progress'
```

When the connection appears stale:
1. Logs a warning to console
2. Re-fetches all data for the current dashboard
3. Resets the timer to prevent rapid re-fetches

### Dashboard Status Derivation

The `deriveDashboardStatus` function (internal to the hook) determines the sidebar status dot color for each dashboard:

```javascript
function deriveDashboardStatus(init, progress) -> 'idle' | 'in_progress' | 'completed' | 'error'
```

| Condition | Result |
|---|---|
| No task in init | `'idle'` |
| No progress files yet | `'in_progress'` |
| All tasks done, some failed | `'error'` |
| All tasks done, none failed | `'completed'` |
| Some tasks have progress | `'in_progress'` |
| Default | `'idle'` |

### Cleanup

On unmount, the hook removes all registered IPC listeners via the stored handles:

```javascript
return () => {
  listenersRef.current.forEach(({ channel, handle }) => api.off(channel, handle));
  listenersRef.current = [];
};
```

---

## useElectronAPI

**File:** `/src/ui/hooks/useElectronAPI.js`

Simple convenience hook for accessing the Electron API.

### useElectronAPI

```javascript
const api = useElectronAPI();
// api is window.electronAPI or null
```

Returns a memoized reference to `window.electronAPI`. Returns `null` when not running in Electron.

### useIsElectron

```javascript
const isElectron = useIsElectron();
// boolean
```

Returns `true` if `window.electronAPI` exists, `false` otherwise. Used to conditionally render Electron-only features (e.g., the Commands button in the Header).

---

## Utility Modules

These are not hooks but are imported by components alongside the hooks:

### dashboardProjects (`src/ui/utils/dashboardProjects.js`)

Per-dashboard project path storage using localStorage.

```javascript
// Get the project path for a dashboard
const path = getDashboardProject('dashboard1');  // string | null

// Save a project path for a dashboard
saveDashboardProject('dashboard1', '/path/to/project');

// Get all dashboard-to-project mappings
const map = getAllDashboardProjects();  // { [dashboardId]: path }
```

**Storage key:** `'synapse-dashboard-projects'`

### format (`src/ui/utils/format.js`)

Time and duration formatting utilities.

```javascript
// Live elapsed time from a start timestamp
formatElapsed('2026-03-22T14:00:00Z');  // "5m 23s" or "1h 5m"

// Format ISO timestamp to HH:MM:SS (local time)
formatTime('2026-03-22T14:05:30Z');  // "14:05:30"

// Calculate duration between two timestamps
calcDuration('2026-03-22T14:00:00Z', '2026-03-22T14:05:30Z');  // "5m 30s" or "30s"
```

| Function | Input | Output |
|---|---|---|
| `formatElapsed(startISO)` | ISO string | `"Xm Ys"` or `"Xh Ym"` |
| `formatTime(isoString)` | ISO string | `"HH:MM:SS"` |
| `calcDuration(startISO, endISO)` | Two ISO strings | `"Xm Ys"` or `"Xs"` |

### constants (`src/ui/utils/constants.js`)

Shared constants for colors, timing, and labels. See [Styling](./styling.md) for detailed color tables.
