# Git Manager Architecture Overview

The Git Manager is Synapse's built-in git UI, accessible via the "Git" tab in the sidebar alongside Dashboards and Code Explorer. It provides multi-repository management, staging/unstaging, unified diffs, commit authoring, branch management, commit history with an SVG branch graph, remote operations (push/pull/fetch), quick actions for non-coders, and safety dialogs for destructive operations.

---

## Technology Stack

| Layer | Technology |
|---|---|
| UI Framework | React 19 (functional components, hooks, Context) |
| Desktop Shell | Electron (IPC for git command execution) |
| Git Backend | `child_process.execFile('git', ...)` via Electron main process |
| State Management | React Context + useReducer (GIT_* actions in AppContext) |
| Styling | Vanilla CSS with Synapse design tokens (CSS custom properties) |
| Persistence | localStorage (open repository list) |

---

## High-Level Architecture

```
Sidebar Tab Bar
  |-- "Git" tab            --> SET_VIEW 'git'
  |-- "Code Explorer" tab  --> SET_VIEW 'ide'
  |-- "Dashboards" tab     --> SET_VIEW 'dashboard'
      |
      v
GitManagerView (main layout)
  |-- RepoTabs               -- Repository tab bar (open/switch/close repos)
  |-- GitWelcome              -- Welcome screen (no repos open)
  |-- InitFlow                -- Git init wizard (folder is not a repo)
  |-- Sidebar (resizable)
  |   |-- ChangesPanel        -- Staged/unstaged/untracked file lists
  |   |-- CommitPanel         -- Commit message + commit button
  |-- Content Tabs
  |   |-- DiffViewer          -- Unified diff with line numbers
  |   |-- HistoryPanel        -- Commit log with SVG branch graph
  |   |-- BranchPanel         -- Branch list, create, switch, delete, merge
  |-- RemotePanel             -- Push/pull/fetch with ahead/behind badges
  |-- QuickActions            -- One-click operations modal for non-coders
      |
      v
Electron IPC (git commands)
  |-- git-is-repo             -- Check if folder has .git
  |-- git-init                -- Initialize new repository
  |-- git-status              -- Porcelain status (staged/unstaged/untracked)
  |-- git-diff / git-diff-file -- Unified diff output
  |-- git-log                 -- Commit history with format parsing
  |-- git-branches            -- List all branches with tracking info
  |-- git-current-branch      -- Current branch name
  |-- git-stage / git-unstage -- Stage/unstage specific files
  |-- git-stage-all / git-unstage-all -- Bulk stage/unstage
  |-- git-commit              -- Create commit with message
  |-- git-push / git-pull / git-fetch -- Remote operations
  |-- git-checkout            -- Switch branches
  |-- git-create-branch / git-delete-branch -- Branch lifecycle
  |-- git-merge               -- Merge branch into current
  |-- git-stash / git-stash-pop -- Stash management
  |-- git-remotes             -- List remotes with URLs
  |-- git-reset / git-revert  -- Undo operations
  |-- git-ahead-behind        -- Ahead/behind counts vs upstream
  |-- git-discard-file        -- Discard changes to a single file
  |-- git-graph               -- Graph-formatted log for visualization
```

---

## Component Hierarchy

```
<App>
  <Sidebar>
    Tab Bar: [Dashboards] [Code Explorer] [Git]
  </Sidebar>

  {activeView === 'git' && (
    <GitManagerView>
      {!hasRepos ? (
        <GitWelcome />                        (empty state — open a repo)
      ) : checkingRepo ? (
        <RepoTabs />
        <LoadingSpinner />                    (checking if folder is git repo)
      ) : !isGitRepo ? (
        <RepoTabs />
        <InitFlow />                          (git init wizard)
      ) : (
        <>
          <RepoTabs />
          <git-manager-main>
            <git-manager-sidebar>              (draggable width: 220-500px)
              <ChangesPanel />
              <CommitPanel />
            </git-manager-sidebar>
            <git-manager-divider />            (drag handle)
            <git-manager-content>
              <ContentTabs>                    [Changes] [History] [Branches]
                {tab === 'changes'  && <DiffViewer />}
                {tab === 'history'  && <HistoryPanel />}
                {tab === 'branches' && <BranchPanel />}
              </ContentTabs>
            </git-manager-content>
          </git-manager-main>
          <RemotePanel />
          <QuickActions />
        </>
      )}
    </GitManagerView>
  )}
</App>
```

---

## Data Flow

### Opening a Repository

```
1. User clicks "Open Repository" (GitWelcome or RepoTabs + button)
2. electronAPI.ideSelectFolder() --> native OS folder picker dialog
3. User selects folder
4. Dispatch GIT_OPEN_REPO { id, path, name }
5. Repo added to gitRepos[], persisted to localStorage ('synapse-git-repos')
6. GitManagerView effect calls electronAPI.gitIsRepo(path)
7. If true: parallel fetch of status, branches, currentBranch, log, remotes
8. Results dispatched via GIT_SET_STATUS, GIT_SET_BRANCHES, etc.
9. UI renders full git layout
```

### Initializing a Non-Git Folder

```
1. gitIsRepo returns false --> InitFlow component renders
2. User clicks "Initialize Repository"
3. electronAPI.gitInit(repoPath)
4. On success: setIsGitRepo(true) triggers data load
5. GitManagerView transitions to full git layout
```

### Staging and Committing

```
1. User clicks + on a file in ChangesPanel (unstaged section)
2. electronAPI.gitStage(repoPath, [filePath])
3. ChangesPanel refreshes status via electronAPI.gitStatus()
4. Dispatch GIT_SET_STATUS with updated data
5. File moves from unstaged to staged section
6. User types commit message in CommitPanel subject textarea
7. Character counter shows 50-char soft limit
8. User presses Commit button or Cmd+Enter
9. electronAPI.gitCommit(repoPath, message)
10. On success: status + log refreshed, message cleared
```

### Viewing a Diff

```
1. User clicks a file in ChangesPanel (staged or unstaged)
2. Dispatch GIT_SET_SELECTED_FILE { filePath }
3. electronAPI.gitDiffFile(repoPath, filePath, isStaged)
4. Dispatch GIT_SET_DIFF with raw diff output
5. DiffViewer parses unified diff into hunks with line numbers
6. Renders with syntax coloring: green (+), red (-), purple (@@)
```

### Browsing Commit History

```
1. User clicks "History" content tab
2. HistoryPanel loads commits via electronAPI.gitLog(repoPath, 50, ['--parents', '--decorate=short'])
3. computeGraphLayout() assigns each commit a lane for the SVG graph
4. Commits render as rows: SVG graph cell | hash | message | author | date
5. Ref badges show branch/tag decorations on commits
6. Clicking a row expands to show: full message, metadata, files changed, diff
7. Infinite scroll loads more commits (50 per batch) on scroll
8. Filters: branch, author, date range, search term (debounced 400ms)
```

### Remote Operations

```
1. RemotePanel shows current branch, upstream tracking, ahead/behind badges
2. User clicks Push: electronAPI.gitPush(repoPath, remote, branch, setUpstream)
3. If no upstream → auto-sets upstream on first push
4. If protected branch (main/master) → warning confirmation dialog
5. If push rejected (non-fast-forward) → error with suggestion to pull first
6. Pull/Fetch follow same pattern with appropriate error handling
7. After any operation: parallel refresh of status, log, branches, ahead/behind
```

### Quick Actions (Non-Coder Flow)

```
1. User clicks "Quick Actions" bar at bottom of git view
2. Modal opens with categorized action cards:
   Common:        Save My Work, Update from Remote, Share My Changes
   Remote:        Fetch Remote, Sync (Pull+Push)
   Branch & Stash: Move to New Branch, Stash Changes, Pop Stash
   Undo / Reset:  Undo Last Commit, Discard All Changes
3. Each action opens a ConfirmDialog (or DoubleConfirmDialog for danger)
4. "Save My Work" = stage all + auto-generate commit message + commit
5. "Discard All Changes" = double confirmation + type "DISCARD" to confirm
6. All actions refresh git data on completion
```

---

## State Management

All git state lives in `AppContext.jsx` under the `GIT_*` action prefix. The git state is isolated from IDE and dashboard state.

### Git State Shape

```javascript
{
  gitRepos: [],            // [{ id, path, name }] — persisted to localStorage
  gitActiveRepoId: null,   // string — currently active repo tab
  gitStatus: null,         // { staged: [], unstaged: [], untracked: [] }
  gitBranches: [],         // [{ name, hash, upstream, current }]
  gitCurrentBranch: null,  // string — name of current branch
  gitLog: [],              // [{ hash, shortHash, author, email, date, subject, body, parents, refs }]
  gitDiff: null,           // string — raw unified diff content
  gitRemotes: [],          // [{ name, fetchUrl, pushUrl }]
  gitLoading: false,       // boolean — global loading indicator
  gitError: null,          // string | null — last error message
  gitSelectedFile: null,   // string | null — file selected for diff view
}
```

### Reducer Actions

| Action | Purpose |
|---|---|
| `GIT_OPEN_REPO` | Add a repo to the tab bar (deduplicates by path) |
| `GIT_CLOSE_REPO` | Remove a repo tab and clean up state |
| `GIT_SWITCH_REPO` | Switch active repo (resets all git data for fresh load) |
| `GIT_SET_STATUS` | Update working tree status |
| `GIT_SET_BRANCHES` | Update branch list |
| `GIT_SET_CURRENT_BRANCH` | Update current branch name |
| `GIT_SET_LOG` | Update commit history |
| `GIT_SET_DIFF` | Update diff content |
| `GIT_SET_REMOTES` | Update remote list |
| `GIT_SET_LOADING` | Toggle global loading state |
| `GIT_SET_ERROR` | Set or clear error message |
| `GIT_SET_SELECTED_FILE` | Set the file selected for diff viewing |

### Persistence

Repository list persists to `localStorage` under the key `synapse-git-repos`. On app startup, `loadSavedGitRepos()` restores the list and sets the first repo as active. The `saveGitRepos()` function is called on every `GIT_OPEN_REPO` and `GIT_CLOSE_REPO` action.

Git data (status, branches, log, etc.) is **not** persisted — it is fetched fresh from the git binary on every repo activation and refreshed after operations.

---

## Electron IPC Integration

### Execution Model

All git commands execute through `gitExec()`, a helper that wraps `child_process.execFile('git', args, { cwd: repoPath })`. Key properties:

- **`execFile` over `exec`** — Prevents shell injection by not invoking a shell. Arguments are passed as an array, not a string.
- **Path validation** — Every handler calls `gitValidateRepoPath()` first, which resolves the path, checks it exists, and confirms it is a directory.
- **Timeout** — 30 second default per command.
- **Buffer** — 10 MB default max buffer for large diffs/logs.
- **Consistent return** — All handlers return `{ success: boolean, data?: any, error?: string }`.

### Handler Count

28 IPC handlers registered on `git-*` channels, covering:

| Category | Handlers |
|---|---|
| Repository | `git-is-repo`, `git-init` |
| Status & Diff | `git-status`, `git-diff`, `git-diff-file` |
| History | `git-log`, `git-graph` |
| Branches | `git-branches`, `git-current-branch`, `git-checkout`, `git-create-branch`, `git-delete-branch`, `git-merge` |
| Staging | `git-stage`, `git-unstage`, `git-stage-all`, `git-unstage-all` |
| Commit | `git-commit` |
| Remote | `git-push`, `git-pull`, `git-fetch`, `git-remotes`, `git-ahead-behind` |
| Stash | `git-stash`, `git-stash-pop` |
| Undo | `git-reset`, `git-revert`, `git-discard-file` |

### Preload Bridge

The `electron/preload.js` file exposes 28 git methods via `contextBridge.exposeInMainWorld('electronAPI', { ... })`. Each method maps 1:1 to an IPC handler via `ipcRenderer.invoke()`. The renderer accesses git operations through `window.electronAPI.gitStatus(repoPath)`, etc.

---

## Auto-Refresh & Polling

GitManagerView implements a 3-second polling interval for `git-status` while the view is active:

```javascript
useEffect(() => {
  if (!activeRepo || !isGitRepo) return;
  const interval = setInterval(async () => {
    const statusResult = await api.gitStatus(activeRepo.path);
    if (statusResult && statusResult.success) {
      dispatch({ type: 'GIT_SET_STATUS', status: statusResult.data });
    }
  }, 3000);
  return () => clearInterval(interval);
}, [activeRepo, isGitRepo, dispatch]);
```

This ensures the changes panel stays current even when files are modified externally (e.g., by a text editor or agent).

A `refreshGitData()` callback performs a full parallel refresh of status, branches, currentBranch, log, and remotes. It is called after every mutating operation (commit, push, pull, stage, checkout, etc.).

---

## Security Model

- **`execFile` not `exec`** — All git commands use `child_process.execFile`, which bypasses the shell entirely. Arguments are passed as an array, preventing shell injection attacks.
- **Path validation** — `gitValidateRepoPath()` resolves the path with `path.resolve()`, then verifies it exists and is a directory via `fsPromises.stat()`. Invalid paths are rejected before any git command runs.
- **Context isolation** — All IPC goes through Electron's `contextBridge`. The renderer has no direct access to `child_process`, `fs`, or Node.js APIs.
- **Channel whitelisting** — Push channels are whitelisted in `preload.js`. Only pre-defined channels can send events from main to renderer.
- **No arbitrary command execution** — Each IPC handler constructs its own git argument array. The renderer cannot inject arbitrary git subcommands.
- **Confirmation dialogs** — Destructive operations (discard, reset, force push) require explicit user confirmation. `DoubleConfirmDialog` requires a two-step confirmation with typed confirmation text for the most dangerous operations (e.g., "Discard All Changes" requires typing "DISCARD").
- **Protected branch warnings** — Pushing to `main` or `master` triggers a warning dialog before proceeding.

---

## File Structure

```
src/ui/
  components/git/
    GitManagerView.jsx       -- Main layout orchestrator (436 lines)
    RepoTabs.jsx             -- Repository tab bar (105 lines)
    GitWelcome.jsx           -- Welcome screen / empty state (78 lines)
    InitFlow.jsx             -- Git init wizard (103 lines)
    ChangesPanel.jsx         -- Staged/unstaged/untracked file lists (362 lines)
    DiffViewer.jsx           -- Unified diff renderer with line numbers (169 lines)
    CommitPanel.jsx          -- Commit message composer (405 lines)
    RemotePanel.jsx          -- Push/pull/fetch with remote management (645 lines)
    BranchPanel.jsx          -- Branch management UI (1,567 lines)
    HistoryPanel.jsx         -- Commit history + SVG graph (1,097 lines)
    QuickActions.jsx         -- Quick action modal for non-coders (962 lines)
    SafetyDialogs.jsx        -- ConfirmDialog + DoubleConfirmDialog (247 lines)
  context/
    AppContext.jsx            -- GIT_* reducer actions + git state (~90 lines of git code)
  styles/
    git-manager.css           -- All git manager styling (2,403 lines)

electron/
  ipc-handlers.js             -- 28 git-* IPC handlers (~580 lines of git code)
  preload.js                  -- 28 git methods exposed via contextBridge
```

**Total:** ~8,800 lines of code across 14 files (12 components + CSS + IPC handlers).

---

## Key Design Decisions

1. **`execFile` over git libraries** — Rather than using a Node.js git library (e.g., `simple-git`, `isomorphic-git`), all git operations shell out to the user's installed `git` binary via `execFile`. This ensures compatibility with any git version, supports all git features without abstraction gaps, and avoids a large dependency. The `execFile` call prevents shell injection by design.

2. **Multi-repository tabs** — Follows the same pattern as IDE workspace tabs (`WorkspaceTabs.jsx` / `RepoTabs.jsx`). Users can have multiple repositories open simultaneously with independent state per repo. Switching repos resets all git data and triggers a fresh fetch, keeping memory usage bounded.

3. **Resizable sidebar layout** — The changes/commit sidebar uses a draggable divider (220-500px range), matching the IDE's split-panel pattern. This gives users control over how much space is allocated to the file list vs. the content area.

4. **3-second status polling** — The working tree status auto-refreshes every 3 seconds while the git view is active. This provides a near-real-time view of file changes without requiring a file watcher, keeping the implementation simple and avoiding the complexity of `fs.watch` on arbitrary external repositories.

5. **SVG branch graph** — The history panel computes a lane-based graph layout (`computeGraphLayout()`) that assigns each commit to a column. Vertical lines represent active branches, cubic bezier curves represent merges and forks. Ten distinct colors cycle across lanes. This provides git-GUI-grade visualization without any third-party dependencies.

6. **Quick Actions for non-coders** — The QuickActions component provides high-level one-click operations ("Save My Work", "Update from Remote", "Discard All Changes") with clear descriptions and appropriate safety dialogs. The "Save My Work" action auto-generates a commit message from the list of changed files.

7. **Safety-first destructive operations** — All destructive operations use a tiered confirmation system:
   - **Safe** (pull, fetch, stash): single ConfirmDialog with a description
   - **Warning** (undo commit, move to branch): single ConfirmDialog with warning styling
   - **Danger** (discard all changes): DoubleConfirmDialog — first confirm, then type a confirmation word

8. **Synapse design token integration** — All git manager styles use CSS custom properties (`--bg`, `--surface`, `--border`, `--text`, `--color-in-progress`, `--color-completed`, `--color-failed`, `--color-blocked`) to match Synapse's dark theme automatically. All CSS classes are prefixed with `.git-manager-*` to avoid collisions.

9. **Parallel data fetching** — On repo activation, `GitManagerView` fetches status, branches, current branch, log, and remotes in parallel via `Promise.all()`. The same pattern is used in `refreshGitData()` after every mutating operation. This minimizes wait time for the user.

10. **Commit message conventions** — The CommitPanel enforces the 50/72 rule with a soft character counter on the subject line and a wrap indicator on the body. Newlines are stripped from the subject field to prevent multi-line subjects.
