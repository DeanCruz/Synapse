# Dashboard UI Architecture Overview

## Introduction

The Synapse Dashboard is a React-based single-page application that provides real-time visualization and monitoring of distributed agent swarms. It runs inside an Electron desktop application and communicates with the backend via IPC (Inter-Process Communication) channels. The dashboard merges static plan data from `initialization.json` with dynamic lifecycle data from worker progress files to produce a live, continuously-updated view of swarm execution.

## Technology Stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 (JSX, functional components, hooks) |
| State Management | React Context + `useReducer` (no external libraries) |
| Desktop Shell | Electron |
| Communication | Electron IPC (renderer-to-main process) |
| Styling | Vanilla CSS with custom properties (no CSS-in-JS) |
| Bundling | Vite (import aliases via `@/`) |
| Dependency Lines | Raw SVG + BFS pathfinding (no charting library) |

## Application Entry Point

The application boots from `/src/ui/main.jsx`:

1. **Electron fetch shim** -- Before any component mounts, `main.jsx` intercepts `window.fetch` calls to `/api/*` URLs and routes them through `window.electronAPI` IPC methods. This allows components to use standard `fetch('/api/...')` calls that transparently route through the Electron main process instead of making HTTP requests. The shim maps URL patterns to specific IPC methods (e.g., `/api/dashboards/statuses` maps to `api.getDashboardStatuses()`).

2. **React root** -- Creates a React root on `#root` and renders the `AppProvider` wrapping `App`.

```
main.jsx
  |-- Installs fetch shim (window.electronAPI -> window.fetch intercept)
  |-- createRoot(#root)
      |-- <AppProvider>          (Context + useReducer)
          |-- <App />            (Root component)
```

## Component Hierarchy

```
<AppProvider>
  <App>
    <Header />                              -- Top nav bar (logo, task badge, archive, controls)
    <div.dashboard-layout>
      <Sidebar />                           -- Dashboard selector + queue items
      <div.dashboard-content>
        {activeView === 'home' && <HomeView />}
        {activeView === 'swarmBuilder' && <SwarmBuilder />}
        {activeView === 'dashboard' && <DashboardContent />}
        {activeView === 'claude' && <DashboardContent />}   -- Claude floats on top
      </div>
    </div>

    {/* Modals (conditionally rendered) */}
    <CommandsModal />
    <ProjectModal />
    <PlanningModal />
    <SettingsModal />

    {/* Floating Claude chat panel */}
    <ClaudeFloatingPanel>
      <ClaudeFloatingHeader />
      <ClaudeView />
    </ClaudeFloatingPanel>
  </App>
</AppProvider>
```

### DashboardContent (inner component)

```
<DashboardContent>
  <dashboard-action-bar>               -- Project + Agent Chat buttons
  <ProgressSection>
    <ProgressBar />                     -- Thin fill bar
    <StatsBar />                        -- 6 stat cards
  </ProgressSection>

  {hasTask ? (
    {taskType === 'Chains'
      ? <ChainPipeline />
      : <WavePipeline />}
    <ClearDashboardSection />
  ) : (
    <EmptyState />
  )}

  <TimelinePanel />                     -- Side panel with event timeline
  <LogPanel />                          -- Fixed bottom drawer
  <AgentDetails />                      -- Modal on agent card click
</DashboardContent>
```

## Data Flow

The dashboard follows a unidirectional data flow pattern:

```
Electron Main Process
  |-- Watches file system (initialization.json, progress/, logs.json)
  |-- Sends IPC push events to renderer
      |
      v
useDashboardData() hook
  |-- Listens to IPC channels: initialization, logs, agent_progress, all_progress,
  |   dashboards_list, dashboards_changed, init_state, queue_changed, tasks_unblocked
  |-- Dispatches actions to AppContext reducer
      |
      v
AppContext (useReducer)
  |-- Holds all application state
  |-- currentInit + currentProgress merged via mergeState()
  |-- Produces currentStatus (the renderable merged object)
      |
      v
Components read from useAppState()
  |-- Header, Sidebar, StatsBar, WavePipeline, etc.
  |-- Components dispatch actions via useDispatch()
```

### The mergeState Function

The core data transformation is the `mergeState(init, progress)` function in `useDashboardData.js`. It takes:

- **init** -- Static plan data from `initialization.json` (task metadata, agent definitions, wave definitions, chain definitions)
- **progress** -- Dynamic lifecycle data from worker progress files (`{ [taskId]: progressObject }`)

And produces a merged status object:

```javascript
{
  active_task: {
    ...task,                    // From init
    completed_tasks: N,         // Derived from progress
    failed_tasks: N,            // Derived from progress
    total_tasks: N,             // From init or agent count
    started_at: ISO,            // Earliest worker started_at
    completed_at: ISO,          // Latest worker completed_at (only if all done)
    overall_status: string,     // 'pending' | 'in_progress' | 'completed' | 'completed_with_errors'
  },
  agents: [
    {
      ...agentDef,              // From init (id, title, wave, layer, directory, depends_on)
      status: string,           // From progress or 'pending'
      assigned_agent: string,   // From progress
      started_at: ISO,          // From progress
      completed_at: ISO,        // From progress
      summary: string,          // From progress
      stage: string,            // From progress
      message: string,          // From progress
      milestones: [],           // From progress
      deviations: [],           // From progress
      logs: [],                 // From progress
    }
  ],
  waves: [
    {
      id: N,
      name: string,
      total: N,
      completed: N,             // Derived
      status: string,           // Derived: 'pending' | 'in_progress' | 'completed'
    }
  ],
  chains: [],                   // Pass-through from init
  history: [],                  // Pass-through from init
}
```

## View System

The application uses a simple view-switching model managed by the `activeView` state field:

| View | Component | Description |
|---|---|---|
| `'dashboard'` | `DashboardContent` | Main pipeline view with wave/chain visualization |
| `'home'` | `HomeView` | Overview of all dashboards, archives, history |
| `'swarmBuilder'` | `SwarmBuilder` | Visual swarm plan editor |
| `'claude'` | `DashboardContent` + `ClaudeFloatingPanel` | Dashboard with floating chat overlay |

Views are switched via `dispatch({ type: 'SET_VIEW', view: 'dashboard' })`.

## Modal System

Modals are managed by the `activeModal` state field:

| Modal | Component | Trigger |
|---|---|---|
| `'commands'` | `CommandsModal` | Header "Commands" button |
| `'project'` | `ProjectModal` | Dashboard action bar or sidebar project button |
| `'planning'` | `PlanningModal` | Swarm planning flow |
| `'settings'` | `SettingsModal` | Sidebar settings button |

Agent details are handled separately via a `selectedAgent` local state in `DashboardContent`, rendering the `AgentDetails` modal component when an agent card is clicked.

## Multi-Dashboard Architecture

The dashboard supports up to N simultaneous swarms (dynamically managed, no hardcoded limit). Each dashboard instance has:

- Its own `initialization.json` (static plan)
- Its own `progress/` directory (dynamic worker data)
- Its own `logs.json` (event log)
- Its own Claude chat message history (persisted in localStorage)
- Its own processing state for the Claude agent

The sidebar shows all active dashboards with color-coded status dots. Switching dashboards (`SWITCH_DASHBOARD` action) stashes the current dashboard's chat state and restores the target's.

## Communication Protocol

All communication between the renderer and the Electron main process uses IPC:

### Pull (renderer requests data)

| Method | Purpose |
|---|---|
| `getDashboardInit(id)` | Fetch initialization.json for a dashboard |
| `getDashboardProgress(id)` | Fetch all progress files for a dashboard |
| `getDashboardLogs(id)` | Fetch logs.json for a dashboard |
| `getDashboardStatuses()` | Fetch status summaries for all dashboards |
| `getDashboards()` | Fetch the list of dashboard IDs |
| `getOverview()` | Fetch archives + history for HomeView |
| `clearDashboard(id)` | Clear a dashboard's data |
| `archiveDashboard(id)` | Archive a dashboard before clearing |
| `createDashboard()` | Create a new dashboard slot |
| `deleteDashboard(id)` | Delete a dashboard slot |

### Push (main process pushes to renderer)

| Channel | Payload | Purpose |
|---|---|---|
| `initialization` | `{ dashboardId, ...initData }` | Plan data updated |
| `logs` | `{ dashboardId, entries }` | Log entries updated |
| `agent_progress` | `{ dashboardId, task_id, ...progressData }` | Single agent progress update |
| `all_progress` | `{ dashboardId, ...progressMap }` | Full progress snapshot |
| `dashboards_list` | `{ dashboards: [...] }` | Dashboard list changed |
| `dashboards_changed` | `{ dashboards: [...] }` | Dashboard list changed |
| `init_state` | `{ dashboardId, initialization, progress, logs }` | Full state bundle |
| `queue_changed` | `{ queue: [...] }` | Queue items changed |
| `tasks_unblocked` | `{ dashboardId, unblocked, completedTaskId }` | Tasks newly ready for dispatch |
| `heartbeat` | `{}` | Connection health heartbeat |

## Connection Health Monitoring

The `useDashboardData` hook includes a health monitoring system:

- Tracks the last time any IPC event was received
- Checks every 30 seconds whether the connection appears stale (no events for 60+ seconds)
- If stale, re-fetches all data for the current dashboard
- Prevents rapid re-fetches by resetting the timer after each recovery attempt

## Key Design Decisions

1. **No external state library** -- Uses React's built-in `useReducer` + Context instead of Redux/MobX/Zustand. This keeps the dependency footprint at zero.

2. **Client-side merge** -- The dashboard merges init + progress on the client side rather than having the server produce a merged view. This allows the server to be a simple file watcher and SSE broadcaster.

3. **Worker-owned progress** -- Workers write their own progress files directly. The master agent does not relay progress updates. This reduces the master's context consumption and gives workers direct control over their dashboard representation.

4. **Stats derived from progress** -- All stat card values (completed, failed, in progress, pending, elapsed) are derived from progress file data at render time. There are no server-maintained counters to go stale.

5. **CSS custom properties for theming** -- Status colors are defined as CSS variables and read by JavaScript via `getComputedStyle`. This allows themes to change colors without rebuilding components.

6. **Claude panel always mounted** -- Once the Claude chat is opened, the `ClaudeFloatingPanel` stays mounted (hidden via `display: none`) to preserve IPC listener state and chat history across view switches.
