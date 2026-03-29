# Hooks Reference

The Synapse Dashboard uses three custom hooks to manage data flow, API access, and UI interactions. All are located in `/src/ui/hooks/`.

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

## useResize

**File:** `/src/ui/hooks/useResize.js`

Custom resize hook using pointer events and `requestAnimationFrame`. Replaces native CSS `resize: both` with a custom drag system for a bottom-right-anchored floating panel (`position: fixed; bottom: 20px; right: 20px`). Used by the `ClaudeFloatingPanel` in `App.jsx`.

### Usage

```javascript
import { useResize } from './hooks/useResize.js';

// Inside a component
const panelRef = useRef(null);
useResize(panelRef, viewMode);

// Or with custom options
useResize(panelRef, viewMode, { minWidth: 400, minHeight: 350, maxHeight: 900 });
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `panelRef` | `React.RefObject<HTMLElement>` | Ref to the floating panel container element |
| `viewMode` | `string` | Current view mode: `'minimized'`, `'collapsed'`, `'expanded'`, `'maximized'` |
| `options` | `object` | Optional sizing constraints |

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `minWidth` | `number` | `360` | Minimum panel width in pixels |
| `minHeight` | `number` | `300` | Minimum panel height in pixels |
| `maxHeight` | `number` | `800` | Maximum panel height in pixels |

### Behavior

- **Only active in `expanded` mode** -- In other modes, the hook cleans up any active drag state and returns early
- **Resize handles** -- Listens for `pointerdown` events on child elements that have a `data-resize-edge` attribute:
  - `data-resize-edge="left"` -- Horizontal resize (width only, cursor: `ew-resize`)
  - `data-resize-edge="top"` -- Vertical resize (height only, cursor: `ns-resize`)
  - `data-resize-edge="top-left"` -- Diagonal resize (both dimensions, cursor: `nwse-resize`)
- **Pointer capture** -- Uses `setPointerCapture()` so resize continues even if the cursor leaves the browser window
- **Performance** -- All dimension changes are batched inside `requestAnimationFrame` callbacks for smooth 60fps updates. No React state is involved -- dimensions are written directly to `element.style`
- **Cleanup** -- Removes all event listeners and cancels any pending animation frames on unmount or mode change

### Integration with ClaudeFloatingPanel

The `ClaudeFloatingPanel` component renders three resize handle elements when in expanded mode:

```jsx
{viewMode === 'expanded' && (
  <>
    <div className="claude-resize-handle claude-resize-left" data-resize-edge="left" />
    <div className="claude-resize-handle claude-resize-top" data-resize-edge="top" />
    <div className="claude-resize-handle claude-resize-corner" data-resize-edge="top-left" />
  </>
)}
```

When the mode changes away from `expanded`, a `useEffect` clears inline `width`/`height` styles to prevent them from bleeding into other layout modes.

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
