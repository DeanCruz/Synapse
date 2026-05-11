# Layout Modes and Views

The Synapse UI is organized around two top-level modes:

| Mode | Primary Component | Purpose |
|---|---|---|
| Chat | `ChatPage` | Full-page agent chat, conversation history, and dashboard-linked chat context |
| Code | `CodePage` | Developer workspace with dashboard monitoring, Code Explorer, Git Manager, and Live Preview |

Code mode has its own sidebar and subpage routing:

| Code Subpage | Component | Description |
|---|---|---|
| Dashboards | `DashboardsPage` | Swarm pipeline visualization, logs, metrics, terminal, and dashboard action bar |
| Code Explorer | `CodeExplorerPage` | File explorer, Monaco editor, search, debug, problems, and terminal panels for the selected dashboard project |
| Git Manager | `GitPage` | Git status, staging, commits, branches, remotes, history, and diffs for repositories discovered under the selected dashboard project |
| Preview | `PreviewPage` | Embedded webview preview with dev-server detection and inline text editing support |

The selected dashboard is the project context for Code Explorer, Git Manager, and Preview. Users create a Code dashboard with the sidebar `+` button, choose a folder, and can later edit the binding in `ProjectModal`.

---

## Pipeline Modes

Within `DashboardsPage`, two pipeline visualization modes render agent task pipelines. The mode is determined by `task.type` in `initialization.json`, which is set to either `"Waves"` or `"Chains"` during swarm planning.

```javascript
const taskType = task?.type ?? 'Waves';

{taskType === 'Chains'
  ? <ChainPipeline status={currentStatus} ... />
  : <WavePipeline status={currentStatus} ... />}
```

**Default:** Waves mode is the default when no type is specified.

---

## Waves Mode

**Component:** `WavePipeline` under `src/ui/pages/code/subpages/dashboards/`

**Best for:** Broad, parallel workloads with many independent tasks per wave.

### Layout Details

- Waves render as vertical columns.
- The pipeline scrolls horizontally when wave columns overflow.
- Each column has a header with name, completed/total count, and status badge.
- Agent cards stack vertically inside each wave.
- Dependency lines are drawn over the wave layout.

### Dependency and Sibling Lines

Waves mode includes an overlay for drawing:

1. **Dependency lines** between cards linked by `depends_on`.
2. **Sibling communication lines** between agents that report `sibling_reads`.

The line system is implemented in `src/ui/utils/dependencyLines.js`. It routes lines around cards with a pathway grid and BFS pathfinding, then applies hover highlights for upstream dependencies and downstream dependents.

### Unblocked Tasks Toast

When progress changes make new tasks dispatchable, the app can show a toast listing ready task IDs. The server/Electron watcher emits a `tasks_unblocked` event after dependency checks settle.

---

## Chains Mode

**Component:** `ChainPipeline` under `src/ui/pages/code/subpages/dashboards/`

**Best for:** Narrow, deep dependency pipelines where tasks flow through named chains.

### Layout Details

- Chains render as horizontal rows.
- Wave labels form the column headers.
- Chain labels are sticky on the left.
- Each cell represents one chain/wave intersection.
- Empty cells render as blank space.

Chains are defined in `initialization.json`:

```json
{
  "chains": [
    {
      "id": "auth",
      "name": "Auth Chain",
      "tasks": ["1.1", "2.1", "3.1"]
    }
  ]
}
```

Chain mode emphasizes left-to-right dependency flow; dependency line rendering is primarily used by Waves mode.

---

## Choosing Between Modes

| Criterion | Waves | Chains |
|---|---|---|
| Task independence | Many independent tasks per wave | Tasks form named dependency chains |
| Visual emphasis | Parallel breadth | Sequential depth |
| Dependency visibility | Explicit lines between cards | Implicit left-to-right flow |
| Best task count | 10-50+ tasks across 3-8 waves | 5-30 tasks in 2-6 chains |
| Scrolling | Horizontal wave columns | Horizontal wave columns with sticky chain labels |

The mode is set during planning via `task.type` in `initialization.json`.

---

## Stat Filtering

Both pipeline modes support stat-based filtering via `activeStatFilter`. When a stat card is clicked, only agents matching that status are displayed:

- **Waves:** Waves with no matching agents are hidden.
- **Chains:** Chains with no visible agents are hidden.
- **Clearing:** Clicking Total or clicking the active filter again clears the filter.

The filter state is managed in `AppContext` and consumed by dashboard subpage components.

---

## Code Explorer

**Component:** `CodeExplorerPage` under `src/ui/pages/code/subpages/code-explorer/`

Code Explorer is keyed to the selected dashboard project path. It no longer uses independent workspace tabs as the primary model.

### Key Features

- Lazy file tree loading through `ideListDir` IPC.
- Monaco editor with open file tabs and dirty-state tracking.
- Search panel and grouped search results.
- Node.js debug controls, variables/call stack/watch panels, debug console, and problems diagnostics.
- Bottom panel shared with terminal/debug/problem surfaces.

---

## Git Manager

**Component:** `GitPage` under `src/ui/pages/code/subpages/git/`

Git Manager is keyed to the selected dashboard project path. It discovers the root repository and nested repositories under that project, then lets the user switch between discovered repo tabs.

### Key Features

- Status polling and manual refresh for the active discovered repo.
- Staged, unstaged, and untracked file lists.
- Staging/unstaging, commit creation, branch management, remotes, history, and diffs.
- Git init flow for project folders without an existing repository.
- Safety dialogs for destructive actions.

---

## Preview

**Component:** `PreviewPage` under `src/ui/pages/code/subpages/preview/`

Preview is keyed to the selected dashboard project path. It embeds a webview, supports manual URL entry and dev-server detection, and can write inline text edits back to source files after instrumentation labels exist.
