# State Management

The Synapse Dashboard uses React's built-in `useReducer` + Context API for centralized state management. There are no external state libraries. The implementation lives in `/src/ui/context/AppContext.jsx`.

---

## Architecture

```
AppContext (state)          -- Read-only state access via useAppState()
DispatchContext (dispatch)  -- Dispatch function access via useDispatch()
    |
    v
appReducer()               -- Core reducer + persistence side effects
    |
    v
appReducerCore()           -- Pure state transitions (switch/case)
```

Two separate contexts are used to prevent unnecessary re-renders: components that only dispatch actions don't re-render when state changes.

---

## Context Providers

### AppProvider

```jsx
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </AppContext.Provider>
  );
}
```

### Hooks

```javascript
// Read state (will re-render when state changes)
const state = useAppState();

// Get dispatch function (stable reference, no re-renders)
const dispatch = useDispatch();
```

Both hooks throw errors if used outside `AppProvider`.

---

## Initial State

```javascript
const initialState = {
  // Dashboard navigation
  currentDashboardId: 'dashboard1',     // Active dashboard ID
  currentInit: null,                     // initialization.json data for current dashboard
  currentProgress: {},                   // { [taskId]: progressObject } for current dashboard
  currentLogs: null,                     // logs.json data for current dashboard
  currentStatus: null,                   // Merged status (produced by mergeState)

  // Multi-dashboard state
  dashboardList: [],                     // Ordered list of dashboard IDs from server
  dashboardStates: {},                   // { [dashboardId]: statusSummary } for sidebar dots

  // View state
  homeViewActive: false,
  archiveViewActive: false,
  queueViewActive: false,
  queueItems: [],                        // Queue overflow items
  unblockedTasks: [],                    // Tasks newly ready for dispatch
  priorDashboardId: null,

  // Filters
  activeLogFilter: 'all',               // Log panel filter: 'all' | 'info' | 'warn' | 'error' | 'deviation'
  activeStatFilter: null,                // Stats bar filter: null | 'completed' | 'in_progress' | 'failed' | 'pending'
  seenPermissionCount: 0,               // Permission popup tracking

  // View routing
  activeView: 'dashboard',              // 'dashboard' | 'home' | 'swarmBuilder' | 'claude'
  activeModal: null,                     // null | 'commands' | 'project' | 'settings' | 'planning' | 'taskEditor'
  modalDashboardId: null,                // Which dashboard a modal was opened for

  // Claude chat state
  claudeDashboardId: null,               // Which dashboard the Claude view is associated with
  claudeViewMode: 'expanded',            // 'minimized' | 'collapsed' | 'expanded' | 'maximized'
  claudeEverOpened: false,               // Once true, Claude panel stays mounted
  claudeMessages: [CLAUDE_WELCOME_MSG],  // Current dashboard's chat messages
  claudeChatStash: {},                   // { [dashboardId]: messages } for fast switching
  claudeProcessingStash: {},             // { [dashboardId]: { isProcessing, status, pendingAttachments } }
  claudeIsProcessing: false,             // Whether the Claude agent is currently processing
  claudeStatus: 'Ready',                 // Status text displayed in Claude panel
  claudeActiveTaskId: null,              // Active task ID for Claude session
  claudePendingAttachments: [],          // Pending file attachments: { id, name, type, dataUrl }

  // Per-dashboard caches
  allDashboardProgress: {},              // { [dashboardId]: progressMap }
  allDashboardLogs: {},                  // { [dashboardId]: logsData }

  // Connection state
  connected: false,                      // Whether IPC listeners are active
};
```

---

## Reducer Actions

### Generic Actions

| Action | Payload | Effect |
|---|---|---|
| `SET` | `{ key, value }` | Sets a single top-level state field |
| `UPDATE` | `{ partial }` | Merges a partial object into state |

### Dashboard Data Actions

| Action | Payload | Effect |
|---|---|---|
| `SET_INIT` | `{ data }` | Sets `currentInit` |
| `SET_PROGRESS` | `{ data }` | Sets `currentProgress` |
| `SET_LOGS` | `{ data }` | Sets `currentLogs` |
| `SET_STATUS` | `{ data }` | Sets `currentStatus` (merged result) |
| `SET_DASHBOARD_STATE` | `{ id, status }` | Updates `dashboardStates[id]` |
| `SET_DASHBOARD_PROGRESS` | `{ dashboardId, progress }` | Updates `allDashboardProgress[dashboardId]` |
| `SET_DASHBOARD_LOGS` | `{ dashboardId, logs }` | Updates `allDashboardLogs[dashboardId]` |

### Navigation Actions

| Action | Payload | Effect |
|---|---|---|
| `SWITCH_DASHBOARD` | `{ id }` | Switches active dashboard. Stashes current chat state, restores target's. Resets filters, clears current data. |
| `SET_VIEW` | `{ view, dashboardId? }` | Sets `activeView`. Records `claudeEverOpened` if opening claude. |
| `OPEN_MODAL` | `{ modal, dashboardId? }` | Opens a modal, records which dashboard it's for |
| `CLOSE_MODAL` | -- | Closes the active modal |
| `REMOVE_DASHBOARD` | `{ id }` | Removes all state for a deleted dashboard (states, progress, logs, chat, processing) |

### Claude Chat Actions

| Action | Payload | Effect |
|---|---|---|
| `CLAUDE_SET_MESSAGES` | `{ messages }` | Replaces all messages |
| `CLAUDE_APPEND_MSG` | `{ msg }` | Appends a message (auto-generates ID) |
| `CLAUDE_UPDATE_MESSAGES` | `{ updater(prev) }` | Functional update on messages array |
| `CLAUDE_CLEAR_MESSAGES` | -- | Resets to welcome message, clears localStorage |
| `CLAUDE_SET_VIEW_MODE` | `{ mode }` | Sets `claudeViewMode` |
| `CLAUDE_SET_PROCESSING` | `{ value }` | Sets `claudeIsProcessing` |
| `CLAUDE_SET_STATUS` | `{ value }` | Sets `claudeStatus` text |
| `CLAUDE_SET_TASK_ID` | `{ value }` | Sets `claudeActiveTaskId` |
| `CLAUDE_ADD_ATTACHMENT` | `{ attachment }` | Adds to `claudePendingAttachments` |
| `CLAUDE_REMOVE_ATTACHMENT` | `{ id }` | Removes attachment by ID |
| `CLAUDE_CLEAR_ATTACHMENTS` | -- | Clears all pending attachments |

### Stashed Dashboard Chat Actions

These actions update chat state for non-active dashboards (e.g., when a worker sends output to a background dashboard):

| Action | Payload | Effect |
|---|---|---|
| `CLAUDE_STASH_APPEND_MSG` | `{ dashboardId, msg }` | Appends message to stashed chat for a specific dashboard |
| `CLAUDE_STASH_UPDATE_MESSAGES` | `{ dashboardId, updater }` | Functional update on stashed messages |
| `CLAUDE_STASH_SET_PROCESSING` | `{ dashboardId, value, status? }` | Updates stashed processing state |

### Task Dispatch Actions

| Action | Payload | Effect |
|---|---|---|
| `SET_UNBLOCKED_TASKS` | `{ tasks }` | Sets `unblockedTasks` array |
| `CLEAR_UNBLOCKED_TASKS` | -- | Clears `unblockedTasks` to `[]` |

---

## Persistence

### Claude Chat Messages

Chat messages are persisted to localStorage with debounced writes:

- **Key format:** `synapse-claude-messages-{dashboardId}` (e.g., `synapse-claude-messages-dashboard1`)
- **Trigger actions:** `CLAUDE_SET_MESSAGES`, `CLAUDE_APPEND_MSG`, `CLAUDE_UPDATE_MESSAGES`
- **Debounce:** 500ms delay to avoid serializing on every streaming delta
- **Migration:** Old global key `synapse-claude-messages` is migrated to `dashboard1` on first load

The persistence layer wraps `appReducerCore` in `appReducer`:

```javascript
function appReducer(state, action) {
  const newState = appReducerCore(state, action);
  if (CLAUDE_PERSIST_ACTIONS.has(action.type)) {
    schedulePersist(newState.currentDashboardId, newState.claudeMessages);
  }
  return newState;
}
```

### Theme

Saved to `localStorage.getItem('synapse-theme')` and restored on App mount.

### Custom Colors

Saved to `localStorage.getItem('synapse-custom-colors')` as JSON.

### Dashboard Projects

Saved to `localStorage.getItem('synapse-dashboard-projects')` as a JSON map of `{ [dashboardId]: projectPath }`.

---

## Dashboard Switching Flow

When `SWITCH_DASHBOARD` is dispatched:

1. **Stash current chat** -- Current `claudeMessages` saved to `claudeChatStash[currentDashboardId]`
2. **Stash current processing state** -- `claudeIsProcessing`, `claudeStatus`, `claudePendingAttachments` saved to `claudeProcessingStash[currentDashboardId]`
3. **Restore target chat** -- Load from `claudeChatStash[targetId]` or localStorage or welcome message
4. **Restore target processing** -- Load from `claudeProcessingStash[targetId]` or defaults
5. **Reset transient state** -- `currentInit`, `currentProgress`, `currentLogs`, `currentStatus` set to null/empty
6. **Reset filters** -- `activeLogFilter` reset to `'all'`, `seenPermissionCount` to 0
7. **Preserve view** -- If currently in Claude view, stays in Claude view; otherwise switches to dashboard view

The `useDashboardData` hook detects the `currentDashboardId` change and fetches fresh data for the new dashboard.

---

## Merge Cycle

The state update cycle for dashboard data follows this path:

```
IPC event arrives (e.g., agent_progress)
  |
  v
useDashboardData handler dispatches:
  SET_INIT, SET_PROGRESS, SET_LOGS, SET_DASHBOARD_PROGRESS, etc.
  |
  v
Reducer updates currentInit / currentProgress / currentLogs
  |
  v
useEffect in useDashboardData detects change in currentInit or currentProgress
  |
  v
Calls mergeState(currentInit, currentProgress)
  |
  v
Dispatches SET_STATUS with the merged result
  |
  v
Components re-render with new currentStatus
```

This two-phase approach (raw data in -> merged data out) keeps the reducer pure and the merge logic centralized.
