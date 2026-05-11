# Git Manager Architecture Overview

The Git Manager is the Git subpage inside Synapse's Code page. It is rendered by `src/ui/pages/code/subpages/git/GitPage.jsx` when `activeView === 'git'` and operates on the project folder bound to the currently selected dashboard.

The current model is project-discovery based: Synapse scans the dashboard project for Git repositories, shows the project root plus discovered nested repositories as selectable tabs, and runs Git commands against the active repository path.

---

## Technology Stack

| Layer | Technology |
|---|---|
| UI Framework | React 19 |
| Desktop Shell | Electron IPC |
| Git Backend | `git` CLI through Electron main-process services |
| State Management | React Context + reducer actions for Git state |
| Styling | `src/ui/pages/code/subpages/git/styles/git-manager.css` |
| Persistence | Dashboard project binding plus per-dashboard active repository |

---

## Current Layout

```
CodePage
  |-- CodeSidebar
  |-- GitPage

GitPage
  |-- Project/repository tab strip
  |-- InitFlow (when selected path is not a Git repo)
  |-- ChangesPanel
  |-- CommitPanel
  |-- DiffViewer
  |-- HistoryPanel
  |-- BranchPanel
  |-- RemotePanel
  |-- QuickActions
```

`GitPage` resolves the dashboard project with `getDashboardProject(currentDashboardId)`. It calls `gitDiscoverRepos(projectPath)` to find nested repositories and saves the active repository with `saveDashboardActiveRepo(currentDashboardId, repoPath)`.

---

## Data Flow

### Discovering Repositories

1. User selects a dashboard in the Code sidebar.
2. `GitPage` resolves the dashboard-bound project path.
3. Electron runs repository discovery below that project.
4. The page builds a tab list from the project root and discovered repositories.
5. The saved active repository for that dashboard is restored if still valid.

### Loading Repository State

1. Active repository changes.
2. Git state is cleared to avoid showing stale data.
3. Git status, branches, current branch, log, and remotes load in parallel.
4. Results update shared Git state in `AppContext`.

### Mutating Repository State

Actions such as stage, unstage, commit, branch checkout, merge, push, pull, fetch, reset, revert, stash, and discard call Electron IPC handlers with the active repository path. After a mutation, `GitPage` refreshes the current repository state.

### Non-Repo Project Roots

If the selected project root is not a Git repository, the root tab remains selectable and `InitFlow` lets the user initialize Git in that folder. Nested Git repositories discovered below the project can still be selected independently.

---

## Key Files

| Area | File |
|---|---|
| Code shell | `src/ui/pages/code/CodePage.jsx` |
| Git page | `src/ui/pages/code/subpages/git/GitPage.jsx` |
| Changes | `src/ui/pages/code/subpages/git/components/ChangesPanel.jsx` |
| Commit form | `src/ui/pages/code/subpages/git/components/CommitPanel.jsx` |
| Diffs | `src/ui/pages/code/subpages/git/components/DiffViewer.jsx` |
| History | `src/ui/pages/code/subpages/git/components/HistoryPanel.jsx` |
| Branches | `src/ui/pages/code/subpages/git/components/BranchPanel.jsx` |
| Remotes | `src/ui/pages/code/subpages/git/components/RemotePanel.jsx` |
| Guided actions | `src/ui/pages/code/subpages/git/components/QuickActions.jsx` |
| Project/repo persistence | `src/ui/utils/dashboardProjects.js` |
| IPC handlers | `electron/ipc-handlers.js` |

---

## Current Constraints

- Git Manager requires a selected dashboard and a dashboard-bound project path.
- Repository tabs are derived from discovery under the dashboard project, not from a global open-repository list.
- Active repository selection is saved per dashboard.
- Git command results must be refreshed after mutating operations to keep status, history, remotes, and selected diff in sync.
