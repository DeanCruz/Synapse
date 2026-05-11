# Git Manager Components

This page documents the current Git Manager component set under `src/ui/pages/code/subpages/git/`.

---

## `GitPage.jsx`

Root page for Git Manager. It resolves the selected dashboard's project path, discovers Git repositories under that project, tracks the active repository for that dashboard, and coordinates status, branch, history, remote, and diff refreshes.

Key responsibilities:

- Reads the active project with `getDashboardProject(currentDashboardId)`.
- Discovers repositories with `gitDiscoverRepos(projectPath)`.
- Saves active repository selection with `saveDashboardActiveRepo(currentDashboardId, repoPath)`.
- Loads status, branches, current branch, log, and remotes in parallel.
- Refreshes Git data after mutating operations.

---

## Repository Tabs

The tab strip is built inside `GitPage.jsx` from the project root and discovered nested repositories. The root project path is included even when it is not currently a Git repository so `InitFlow` can initialize it.

---

## `InitFlow.jsx`

Renders when the active path is not a Git repository. It offers initialization for the selected project/root path and then triggers a refresh when initialization succeeds.

---

## `ChangesPanel.jsx`

Shows staged, unstaged, and untracked files for the active repository. It stages, unstages, discards, and selects files for diff viewing through Git IPC calls and shared app-state actions.

---

## `CommitPanel.jsx`

Captures commit messages and creates commits against the active repository path. It refreshes repository state after successful commits.

---

## `DiffViewer.jsx`

Parses and renders unified diffs for the selected file. It supports staged and unstaged diff views based on the current file state.

---

## `HistoryPanel.jsx`

Loads commit history and renders commit metadata and changed files. It works from the active repository path supplied by `GitPage`.

---

## `BranchPanel.jsx`

Lists branches and provides branch lifecycle operations such as checkout, create, delete, and merge. Mutations refresh the active repository state.

---

## `RemotePanel.jsx`

Shows remotes, ahead/behind information, and push/pull/fetch operations for the active repository.

---

## `QuickActions.jsx`

Provides guided Git actions for common operations. It delegates actual command execution to the same Electron IPC handlers used by the lower-level panels.

---

## IPC and State Boundary

Git components do not run shell commands directly. They call Electron IPC handlers, and `GitPage` writes the resulting status, branches, current branch, log, remotes, selected file, diff, loading, and error state into `AppContext`.
