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
  currentDashboardId: null,              // Active dashboard ID (null until first switch)
  currentInit: null,                     // initialization.json data for current dashboard
  currentProgress: {},                   // { [taskId]: progressObject } for current dashboard
  currentLogs: null,                     // logs.json data for current dashboard
  currentStatus: null,                   // Merged status (produced by mergeState)

  // Multi-dashboard state
  dashboardList: [],                     // Ordered list of dashboard IDs from server
  dashboardStates: {},                   // { [dashboardId]: statusSummary } for sidebar dots
  dashboardNames: {},                    // { [dashboardId]: customName } for user-defined names
  chatPreviews: {},                      // { [dashboardId]: { text, isStreaming } } for sidebar previews

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
  pendingPermission: null,               // { pid, toolName, toolInput, requestId, toolUseId, timestamp }

  // View routing
  activeView: 'dashboard',              // 'dashboard' | 'home' | 'swarmBuilder' | 'claude' | 'ide' | 'git'
  activeModal: null,                     // null | 'commands' | 'project' | 'settings' | 'planning' | 'taskEditor'
  modalDashboardId: null,                // Which dashboard a modal was opened for

  // Claude chat state
  claudeDashboardId: null,               // Which dashboard the Claude view is associated with
  claudeViewMode: 'expanded',            // 'minimized' | 'collapsed' | 'expanded' | 'maximized'
  claudeEverOpened: false,               // Once true, Claude panel stays mounted
  claudeMessages: [CLAUDE_WELCOME_MSG],  // Current dashboard's active tab messages
  claudeTabStash: {},                    // { [dashboardId:tabId]: messages } in-memory cache for tab/dashboard switching
  claudeProcessingStash: {},             // { [dashboardId]: { isProcessing, status, pendingAttachments, viewMode, chatOpen, ideChatOpen } }
  claudeTabs: {},                        // { [dashboardId]: [{ id, name }] } tabs per dashboard
  claudeActiveTabId: 'default',          // Active tab ID for current dashboard
  claudeActiveTabMap: {},                // { [dashboardId]: tabId } stashed active tab for non-current dashboards
  claudeIsProcessing: false,             // Whether the Claude agent is currently processing
  claudeStatus: 'Ready',                 // Status text displayed in Claude panel
  claudeActiveTaskId: null,              // Active task ID for Claude session
  claudePendingAttachments: [],          // Pending file attachments: { id, name, type, dataUrl }
  unreadChatCounts: {},                  // { [dashboardId]: number } unread message counts for sidebar glow

  // Per-dashboard caches
  allDashboardProgress: {},              // { [dashboardId]: progressMap }
  allDashboardLogs: {},                  // { [dashboardId]: logsData }

  // Connection state
  connected: false,                      // Whether IPC listeners are active

  // IDE state
  ideWorkspaces: [],                     // [{ id, path, name, dashboardId? }] persisted to localStorage
  ideActiveWorkspaceId: null,            // Active workspace ID
  ideOpenFiles: {},                      // { [workspaceId]: [{ id, path, name, isDirty }] }
  ideActiveFileId: {},                   // { [workspaceId]: string }
  ideFileTrees: {},                      // { [workspaceId]: treeData }
  ideSidebarView: 'explorer',            // Which sidebar panel is shown in IDE
  ideChatOpen: false,                    // Whether IDE inline chat is open

  // Debug state
  debugBreakpoints: {},                  // { [filePath]: [lineNumber, ...] }
  debugSession: { status: 'idle', pausedFile: null, pausedLine: null, threadId: null },
  debugCallStack: [],                    // [{ id, name, source, line, column }]
  debugVariables: {},                    // { [scopeId]: [{ name, value, type, variablesReference }] }
  debugScopes: [],                       // [{ name, variablesReference, expensive }]
  debugWatchExpressions: [],             // [{ id, expression, value, error }]

  // Diagnostics state
  diagnostics: {},                       // { [filePath]: [{ line, column, endLine, endColumn, message, severity, source }] }

  // Git Manager state
  gitRepos: [],                          // [{ id, path, name }] persisted to localStorage
  gitActiveRepoId: null,                 // Active repo ID
  gitStatus: null,                       // { staged: [], unstaged: [], untracked: [] }
  gitBranches: [],                       // [{ name, current, tracking, ahead, behind }]
  gitCurrentBranch: null,                // string — name of current branch
  gitLog: [],                            // [{ hash, abbrevHash, author, date, message, parents, refs }]
  gitDiff: null,                         // string — current diff content
  gitRemotes: [],                        // [{ name, fetchUrl, pushUrl }]
  gitLoading: false,                     // boolean — global loading indicator
  gitError: null,                        // string | null — last error message
  gitSelectedFile: null,                 // string | null — currently selected file path for diff view
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

### Claude Tab Management Actions

| Action | Payload | Effect |
|---|---|---|
| `CLAUDE_NEW_TAB` | -- | Creates a new chat tab in the current dashboard, stashes current tab messages, switches to new tab with welcome message |
| `CLAUDE_SWITCH_TAB` | `{ tabId }` | Stashes current tab messages, restores target tab messages |
| `CLAUDE_CLOSE_TAB` | `{ tabId }` | Closes a tab, removes stashed messages, switches to adjacent tab if closing the active one. Cannot close the last tab. |
| `CLAUDE_RENAME_TAB` | `{ tabId, name }` | Renames a tab |
| `CLAUDE_TAB_STASH_APPEND_MSG` | `{ tabId, msg }` | Appends a message to a non-active tab's stash on the same dashboard (for background worker output) |

### Stashed Dashboard Chat Actions

These actions update chat state for non-active dashboards (e.g., when a worker sends output to a background dashboard):

| Action | Payload | Effect |
|---|---|---|
| `CLAUDE_STASH_APPEND_MSG` | `{ dashboardId, msg }` | Appends message to stashed chat for a specific dashboard. Tracks unread counts for assistant messages. |
| `CLAUDE_STASH_UPDATE_MESSAGES` | `{ dashboardId, updater }` | Functional update on stashed messages |
| `CLAUDE_STASH_SET_PROCESSING` | `{ dashboardId, value, status? }` | Updates stashed processing state |

### Permission Request Actions

| Action | Payload | Effect |
|---|---|---|
| `PERMISSION_REQUEST` | `{ permission }` | Sets `pendingPermission` with `{ pid, toolName, toolInput, requestId, toolUseId, timestamp }` |
| `PERMISSION_RESOLVED` | `{ requestId }` | Clears `pendingPermission` (only if requestId matches) |

### Dashboard Management Actions

| Action | Payload | Effect |
|---|---|---|
| `SET_DASHBOARDS_LIST` | `{ value, names? }` | Updates `dashboardList` and optionally merges `dashboardNames`. Does not auto-switch dashboards. |
| `SET_DASHBOARD_NAMES` | `{ names }` | Sets all dashboard names |
| `REORDER_DASHBOARDS` | `{ orderedIds }` | Reorders `dashboardList` |
| `RENAME_DASHBOARD` | `{ id, name }` | Sets or clears a custom name for a dashboard |
| `SET_CHAT_PREVIEW` | `{ dashboardId, text, isStreaming? }` | Sets a chat preview for sidebar display |
| `CLEAR_CHAT_PREVIEW` | `{ dashboardId }` | Clears a chat preview |

### Task Dispatch Actions

| Action | Payload | Effect |
|---|---|---|
| `SET_UNBLOCKED_TASKS` | `{ tasks }` | Sets `unblockedTasks` array |
| `CLEAR_UNBLOCKED_TASKS` | -- | Clears `unblockedTasks` to `[]` |

### IDE State Actions

| Action | Payload | Effect |
|---|---|---|
| `IDE_OPEN_WORKSPACE` | `{ id?, path, name }` | Opens a workspace (or switches to it if already open). Persists to localStorage. |
| `IDE_CLOSE_WORKSPACE` | `{ workspaceId }` | Closes a workspace, cleans up open files, file tree, active file. Auto-switches if closing active. |
| `IDE_SWITCH_WORKSPACE` | `{ workspaceId }` | Switches to a different workspace |
| `IDE_LINK_WORKSPACE_DASHBOARD` | `{ workspaceId, dashboardId }` | Associates a workspace with a dashboard ID |
| `IDE_SET_FILE_TREE` | `{ workspaceId, tree }` | Sets the file tree for a workspace |
| `IDE_UPDATE_FILE_TREE_NODE` | `{ workspaceId, nodePath, children }` | Updates children of a specific tree node (lazy loading) |
| `IDE_OPEN_FILE` | `{ workspaceId, file: { path, name } }` | Opens a file (or switches to it if already open) |
| `IDE_CLOSE_FILE` | `{ workspaceId, fileId }` | Closes a file tab, auto-switches to adjacent tab |
| `IDE_SWITCH_FILE` | `{ workspaceId, fileId }` | Switches to a different open file |
| `IDE_MARK_FILE_DIRTY` | `{ workspaceId, fileId }` | Marks a file as having unsaved changes |
| `IDE_MARK_FILE_CLEAN` | `{ workspaceId, fileId }` | Marks a file as saved |
| `IDE_OPEN_CHAT` | -- | Opens inline chat in IDE, sets `claudeViewMode` to expanded |
| `IDE_CLOSE_CHAT` | -- | Closes inline IDE chat |

### Debug State Actions

| Action | Payload | Effect |
|---|---|---|
| `DEBUG_SET_SESSION` | `{ session }` | Merges session data into `debugSession` |
| `DEBUG_TOGGLE_BREAKPOINT` | `{ filePath, line }` | Toggles a breakpoint at a specific line |
| `DEBUG_SET_BREAKPOINTS` | `{ filePath, breakpoints }` | Sets all breakpoints for a file |
| `DEBUG_SET_CALL_STACK` | `{ callStack }` | Sets the debug call stack |
| `DEBUG_SET_VARIABLES` | `{ scopeId, variables }` | Sets variables for a scope |
| `DEBUG_SET_SCOPES` | `{ scopes }` | Sets available scopes |
| `DEBUG_CLEAR_SESSION` | -- | Resets debug session, call stack, variables, and scopes to defaults |

### Diagnostics Actions

| Action | Payload | Effect |
|---|---|---|
| `DIAGNOSTICS_SET` | `{ filePath, diagnostics }` | Sets diagnostics for a file |
| `DIAGNOSTICS_CLEAR` | -- | Clears all diagnostics |
| `DIAGNOSTICS_CLEAR_FILE` | `{ filePath }` | Clears diagnostics for a specific file |

### Git Manager Actions

| Action | Payload | Effect |
|---|---|---|
| `GIT_OPEN_REPO` | `{ id?, path, name }` | Opens a repo (or switches to it if already open). Persists to localStorage. |
| `GIT_CLOSE_REPO` | `{ repoId }` | Closes a repo tab, auto-switches if closing active |
| `GIT_SWITCH_REPO` | `{ repoId }` | Switches to a different repo, resets git data |
| `GIT_SET_STATUS` | `{ status }` | Sets `gitStatus` (staged/unstaged/untracked) |
| `GIT_SET_BRANCHES` | `{ branches }` | Sets `gitBranches` array |
| `GIT_SET_CURRENT_BRANCH` | `{ branch }` | Sets `gitCurrentBranch` |
| `GIT_SET_LOG` | `{ log }` | Sets `gitLog` (commit history) |
| `GIT_SET_DIFF` | `{ diff }` | Sets `gitDiff` content |
| `GIT_SET_REMOTES` | `{ remotes }` | Sets `gitRemotes` array |
| `GIT_SET_LOADING` | `{ value }` | Sets global loading indicator |
| `GIT_SET_ERROR` | `{ error }` | Sets last error message |
| `GIT_SET_SELECTED_FILE` | `{ filePath }` | Sets selected file for diff view |
| `GIT_NAVIGATE_TO_FILE` | `{ projectRoot, filePath }` | Switches to git view, opens repo at projectRoot, highlights filePath |

---

## Persistence

### Claude Chat Messages

Chat messages are persisted to localStorage with debounced writes, now with per-tab granularity:

- **Message key format:** `synapse-claude-messages-{dashboardId}` (default tab) or `synapse-claude-messages-{dashboardId}-{tabId}` (non-default tabs)
- **Tab key format:** `synapse-claude-tabs-{dashboardId}` -- stores the tab list `[{ id, name }]`
- **Trigger actions:** `CLAUDE_SET_MESSAGES`, `CLAUDE_APPEND_MSG`, `CLAUDE_UPDATE_MESSAGES`
- **Debounce:** 500ms delay to avoid serializing on every streaming delta
- **Migration:** Old global key `synapse-claude-messages` is migrated to `dashboard1` default tab on first load
- **Max messages:** Hard cap of 200 messages per tab. When exceeded, older messages are trimmed and a `[N older messages trimmed]` system notice is inserted.

The persistence layer wraps `appReducerCore` in `appReducer`:

```javascript
function appReducer(state, action) {
  const newState = appReducerCore(state, action);
  if (CLAUDE_PERSIST_ACTIONS.has(action.type)) {
    schedulePersist(newState.currentDashboardId, newState.claudeActiveTabId, newState.claudeMessages);
  }
  return newState;
}
```

### IDE Workspaces

Saved to `localStorage.getItem('synapse-ide-workspaces')` as JSON array of `[{ id, path, name }]`. Updated on open/close/link workspace actions.

### Git Repos

Saved to `localStorage.getItem('synapse-git-repos')` as JSON array of `[{ id, path, name }]`. Updated on open/close repo actions.

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
