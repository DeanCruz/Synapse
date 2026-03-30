# Git Manager Components Reference

All Git Manager components live in `src/ui/components/git/`. They use React Context (`useAppState()` and `useDispatch()`) for state management via `GIT_*` prefixed actions -- no prop drilling required except where noted.

---

## GitManagerView

**File:** `src/ui/components/git/GitManagerView.jsx` (436 lines)

The root layout component for the Git Manager. Assembles RepoTabs, the sidebar (ChangesPanel + CommitPanel), content area (DiffViewer / HistoryPanel / BranchPanel), RemotePanel, and QuickActions. Manages the draggable split panel between the sidebar and content area.

**Props:** None (context only)

**Local State:**

| State | Default | Description |
|---|---|---|
| `sidebarWidth` | `300` | Sidebar panel width in pixels |
| `isDragging` | `false` | Whether the divider is actively being dragged |
| `isGitRepo` | `null` | Whether active repo has `.git` (`null` = unknown, `true`/`false`) |
| `checkingRepo` | `false` | Whether the git repo check is in progress |
| `contentTab` | `'changes'` | Active content tab: `'changes'`, `'history'`, or `'branches'` |

**Derived Data from Context:**

| Variable | Source | Description |
|---|---|---|
| `activeRepo` | `gitRepos.find(r => r.id === gitActiveRepoId)` | Current repository object |
| `hasRepos` | `gitRepos.length > 0` | Whether any repositories are open |

**Context Fields Used:**

`gitRepos`, `gitActiveRepoId`, `gitStatus`, `gitBranches`, `gitCurrentBranch`, `gitLog`, `gitDiff`, `gitRemotes`, `gitLoading`, `gitError`, `gitSelectedFile`

**Effects:**

1. **Check git repo on active repo change** -- When `activeRepo` changes, calls `electronAPI.gitIsRepo()` to determine if the folder has a `.git` directory. Sets `isGitRepo` accordingly. Includes cancellation cleanup.

2. **Load git data on valid repo** -- When `activeRepo` changes and `isGitRepo` is true, fetches status, branches, current branch, log, and remotes in parallel via `Promise.all`. Dispatches `GIT_SET_STATUS`, `GIT_SET_BRANCHES`, `GIT_SET_CURRENT_BRANCH`, `GIT_SET_LOG`, `GIT_SET_REMOTES`.

3. **Poll git status** -- Every 3 seconds while the view is active and a valid repo is selected, polls `gitStatus()` and dispatches `GIT_SET_STATUS` to keep the changes panel fresh.

4. **Keyboard shortcut** -- Listens for Ctrl/Cmd+Enter to focus the commit message input (`.git-manager-commit-input`).

5. **Draggable divider** -- Attaches global `mousemove`/`mouseup` listeners during drag. Constrains width between 220px and 500px. Applies `.git-manager-dragging` class to `document.body` for global `col-resize` cursor.

**Key Functions:**

| Function | Description |
|---|---|
| `refreshGitData()` | Re-fetches all git data (status, branches, current branch, log, remotes) in parallel. Used after commits, pushes, etc. |
| `handleInitComplete()` | Callback passed to InitFlow; sets `isGitRepo` to `true` after successful `git init`. |

**Render Logic:**

- If no repos open: renders `<GitWelcome />`
- If checking repo: renders loading spinner with "Checking repository..."
- If not a git repo: renders `<RepoTabs />` + `<InitFlow />`
- If valid git repo: renders full layout with sidebar (ChangesPanel + CommitPanel), content tabs (Changes/History/Branches), RemotePanel, and QuickActions

**Content Tab Mapping:**

| Tab | Component |
|---|---|
| `changes` | `<DiffViewer />` |
| `history` | `<HistoryPanel repoPath={...} />` |
| `branches` | `<BranchPanel repoPath={...} />` |

**IPC Calls:**

- `electronAPI.gitIsRepo(path)` -- Check if folder is a git repository
- `electronAPI.gitStatus(path)` -- Get working tree status
- `electronAPI.gitBranches(path)` -- List all branches
- `electronAPI.gitCurrentBranch(path)` -- Get current branch name
- `electronAPI.gitLog(path)` -- Get commit log
- `electronAPI.gitRemotes(path)` -- List configured remotes

---

## RepoTabs

**File:** `src/ui/components/git/RepoTabs.jsx` (105 lines)

Horizontal tab bar showing all open git repositories. Each tab displays the repo name with a branch badge (for the active tab) and a close button. A "+" button opens new repositories via native folder picker. Mirrors the `WorkspaceTabs.jsx` pattern from the IDE view.

**Props:** None (context only)

**Tab Features:**

| Feature | Description |
|---|---|
| Active indicator | Different styling class (`.active`) on the active tab |
| Branch badge | Shows `gitCurrentBranch` on the active tab only |
| Close button | `x` button on each tab, stops propagation to prevent tab switch |
| Add button | `+` button at end of tab bar, opens native folder picker |
| Repo icon | Git branch SVG icon on each tab |
| Tooltip | Full repo path shown on hover via `title` attribute |

**Event Handlers:**

| Handler | Description |
|---|---|
| `handleAddRepo()` | Opens native folder picker via `ideSelectFolder()`, extracts folder name from path, generates a timestamp-based ID, dispatches `GIT_OPEN_REPO` |
| `handleSwitchRepo(repoId)` | Dispatches `GIT_SWITCH_REPO` |
| `handleCloseRepo(e, repoId)` | Stops propagation, dispatches `GIT_CLOSE_REPO` |

**Dispatch Actions:**

- `GIT_OPEN_REPO` -- Open a new repository (with `id`, `path`, `name`)
- `GIT_SWITCH_REPO` -- Switch active repository
- `GIT_CLOSE_REPO` -- Close a repository tab

**IPC Calls:**

- `electronAPI.ideSelectFolder()` -- Open native folder picker (reuses IDE's folder picker)

---

## GitWelcome

**File:** `src/ui/components/git/GitWelcome.jsx` (78 lines)

Welcome/empty state screen displayed when no repositories are open. Shows a centered card with a git branch icon, title, description, and an "Open Repository" button.

**Props:** None (context only -- uses `useDispatch()`)

**Actions:**

| Button | Behavior |
|---|---|
| **Open Repository** | Opens native folder picker, extracts folder name, generates timestamp-based ID, dispatches `GIT_OPEN_REPO` |

**Render Structure:**

```
git-manager-empty
  |-- Git branch icon (48x48px SVG)
  |-- "Git Manager" title
  |-- "Open a repository to manage branches, commits, and changes" subtitle
  |-- [Open Repository] button (primary, with folder icon)
```

**IPC Calls:**

- `electronAPI.ideSelectFolder()` -- Native folder picker

---

## InitFlow

**File:** `src/ui/components/git/InitFlow.jsx` (103 lines)

Wizard UI for folders that do not have `.git` initialized. Displays a friendly prompt with an "Initialize Repository" button. On success, shows a check mark and transitions to the full git view.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `repoPath` | `string` | Absolute path to the folder to initialize |
| `repoName` | `string` | Display name of the folder |
| `onInitComplete` | `function` | Callback fired after successful `git init` (called after 800ms delay) |

**Local State:**

| State | Default | Description |
|---|---|---|
| `initializing` | `false` | Whether `git init` is in progress |
| `error` | `null` | Error message if init failed |
| `success` | `false` | Whether init completed successfully |

**Render Logic:**

- Default: shows `GitInitIcon`, "Not a Git Repository" title, description with repo name, and "Initialize Repository" button
- During init: button shows spinner + "Initializing..."
- On success: shows `CheckIcon`, "Repository Initialized" title, loading message, then calls `onInitComplete` after 800ms
- On error: shows error message in red

**IPC Calls:**

- `electronAPI.gitInit(repoPath)` -- Initialize a new git repository

---

## ChangesPanel

**File:** `src/ui/components/git/ChangesPanel.jsx` (362 lines)

Sidebar panel displaying the working tree status organized into three collapsible sections: Staged Changes, Unstaged Changes, and Untracked Files. Supports file-level staging, unstaging, discarding, and selecting files to view diffs.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `repoPath` | `string` | Absolute path to the active repository |

**Local State:**

| State | Default | Description |
|---|---|---|
| `stagedOpen` | `true` | Whether the Staged Changes section is expanded |
| `unstagedOpen` | `true` | Whether the Unstaged Changes section is expanded |
| `untrackedOpen` | `true` | Whether the Untracked Files section is expanded |

**Derived Data from Context:**

| Variable | Source | Description |
|---|---|---|
| `staged` | `gitStatus?.staged \|\| []` | Array of staged file objects |
| `unstaged` | `gitStatus?.unstaged \|\| []` | Array of unstaged file objects |
| `untracked` | `gitStatus?.untracked \|\| []` | Array of untracked file paths |
| `totalChanges` | `staged.length + unstaged.length + untracked.length` | Total change count |

**Event Handlers:**

| Handler | Description |
|---|---|
| `handleSelectFile(filePath, isStaged)` | Dispatches `GIT_SET_SELECTED_FILE`, then calls `gitDiffFile()` and dispatches `GIT_SET_DIFF` |
| `handleStageFile(filePath)` | Calls `gitStage(repoPath, [filePath])`, refreshes status |
| `handleUnstageFile(filePath)` | Calls `gitUnstage(repoPath, [filePath])`, refreshes status |
| `handleDiscardFile(filePath)` | Shows `window.confirm()` warning (irreversible), calls `gitDiscardFile()`, refreshes status, clears selection if the discarded file was selected |
| `handleStageAll()` | Calls `gitStageAll(repoPath)`, refreshes status |
| `handleUnstageAll()` | Calls `gitUnstageAll(repoPath)`, refreshes status |
| `handleDiscardAll()` | Shows `window.confirm()` with file count warning, discards all unstaged files sequentially, refreshes status |

**Status Code Map:**

| Code | Label | CSS Class |
|---|---|---|
| `M` | M | `modified` |
| `A` | A | `added` |
| `D` | D | `deleted` |
| `R` | R | `renamed` |
| `U` | U | `untracked` |
| `C` | C | `conflicted` |
| `?` | U | `untracked` |
| `T` | T | `modified` |

**Section Header Actions:**

| Section | Actions |
|---|---|
| Staged Changes | Unstage All (`-` icon button) |
| Unstaged Changes | Stage All (`+` icon button), Discard All (trash icon, danger) |
| Untracked Files | Stage All Untracked (`+` icon button) |

**Internal Component -- FileItem:**

| Prop | Type | Description |
|---|---|---|
| `filePath` | `string` | Path to the file |
| `status` | `string` | Git status code (M, A, D, etc.) |
| `isStaged` | `boolean` | Whether file is staged |
| `isUntracked` | `boolean` | Whether file is untracked |
| `isSelected` | `boolean` | Whether file is currently selected |
| `onSelect` | `function` | Click handler to select the file |
| `onStage` | `function` | Stage button handler |
| `onUnstage` | `function` | Unstage button handler |
| `onDiscard` | `function` | Discard button handler |

**IPC Calls:**

- `electronAPI.gitStatus(repoPath)` -- Refresh working tree status
- `electronAPI.gitDiffFile(repoPath, filePath, isStaged)` -- Get diff for a specific file
- `electronAPI.gitStage(repoPath, [filePath])` -- Stage a single file
- `electronAPI.gitUnstage(repoPath, [filePath])` -- Unstage a single file
- `electronAPI.gitDiscardFile(repoPath, filePath)` -- Discard changes to a file
- `electronAPI.gitStageAll(repoPath)` -- Stage all files
- `electronAPI.gitUnstageAll(repoPath)` -- Unstage all files

---

## DiffViewer

**File:** `src/ui/components/git/DiffViewer.jsx` (169 lines)

Unified diff viewer that parses raw git diff output and renders it with syntax-colored lines (additions in green, deletions in red), dual line numbers, hunk headers, and per-file addition/deletion stats.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `diff` | `string` (optional) | Raw diff text. Falls back to `state.gitDiff` from context if not provided |
| `filePath` | `string` (optional) | File path to display. Falls back to `state.gitSelectedFile` |
| `fileStatus` | `string` (optional) | Git status code for the file header badge |

**Key Functions:**

| Function | Description |
|---|---|
| `parseDiff(raw)` | Parses raw unified diff text into `{ hunks, additions, deletions }`. Each hunk contains a header, context string, and array of line objects with `type` (added/removed/context/info), `oldNum`, `newNum`, and `content`. |
| `isBinaryDiff(raw)` | Checks if the diff contains "Binary files", "GIT binary patch", or "Binary file" markers. |
| `statusCls(code)` | Maps status codes to CSS classes for the file header badge. |

**Exports:**

- Default: `DiffViewer` component
- Named: `parseDiff` function (reusable diff parser)

**Render Logic:**

- No file selected: shows "No file selected" empty state
- Binary file: shows file header + "Binary file" notice
- No diff content or empty hunks: shows file header + "No changes to display"
- Valid diff: shows file header with stats (+N/-N), then hunk-by-hunk rendering with colored lines

**Diff Line Types:**

| Type | Prefix | CSS Class | Description |
|---|---|---|---|
| `added` | `+` | `added` | New line (green) |
| `removed` | `-` | `removed` | Deleted line (red) |
| `context` | ` ` | `context` | Unchanged context line |
| `info` | (none) | `context` (italic) | "No newline at end of file" type markers |

---

## CommitPanel

**File:** `src/ui/components/git/CommitPanel.jsx` (405 lines)

Commit composition panel providing a subject line textarea with a 50-character soft limit, an optional extended description field with a 72-character wrap guideline, an amend checkbox with history-rewrite warning, and a commit button that shows the staged file count.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `repoPath` | `string` | Absolute path to the active repository |
| `onCommitComplete` | `function` | Callback fired after a successful commit |

**Local State:**

| State | Default | Description |
|---|---|---|
| `subject` | `''` | Commit message subject line |
| `body` | `''` | Extended description text |
| `showBody` | `false` | Whether the extended description field is visible |
| `amend` | `false` | Whether amend mode is enabled |
| `amendWarningDismissed` | `false` | Whether the amend warning banner has been acknowledged |
| `committing` | `false` | Whether a commit is in progress |
| `commitResult` | `null` | Result toast: `{ type: 'success'\|'error', text }` |

**Constants:**

| Constant | Value | Description |
|---|---|---|
| `SUBJECT_SOFT_LIMIT` | `50` | Character soft limit for the subject line |
| `BODY_WRAP_LIMIT` | `72` | Character wrap guideline for the description body |

**Commit Validation:**

The commit button (`canCommit`) is enabled when all of: subject is non-empty, staged files exist (or amend is checked), not currently committing, and git is not loading.

**Key Features:**

| Feature | Description |
|---|---|
| Subject character counter | Shows `N/50` in the bottom-right corner, turns red when over the limit |
| Subject newline prevention | Enter key in subject field is blocked (newlines only allowed in body) |
| Extended description toggle | "Add description" button toggles the body textarea |
| Body wrap indicator | Shows "wrap at 72" in bottom-right, turns red if any line exceeds 72 chars |
| Amend warning banner | Orange banner explaining history rewrite risks, with "I understand" dismiss button |
| Commit result toast | Success (green) or error (red) message that auto-dismisses after 4 seconds |
| Staged file count badge | Shows count in commit button when not amending |
| Keyboard shortcut | Cmd/Ctrl+Enter triggers commit from either textarea |

**Amend Limitation:**

The current IPC handler does not support `--amend`. If amend is checked, the panel displays an error message rather than proceeding.

**IPC Calls:**

- `electronAPI.gitCommit(repoPath, message)` -- Create a commit
- `electronAPI.gitStatus(repoPath)` -- Refresh status after commit
- `electronAPI.gitLog(repoPath)` -- Refresh log after commit

---

## RemotePanel

**File:** `src/ui/components/git/RemotePanel.jsx` (645 lines)

Remote operations panel handling push, pull, and fetch with comprehensive safety features. Displays current branch tracking info, ahead/behind counts, remote selector, and action buttons with loading spinners. Includes protection for pushes to main/master and a double-confirmation flow for force push.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `repoPath` | `string` | Absolute path to the active repository |

**Local State:**

| State | Default | Description |
|---|---|---|
| `selectedRemote` | `'origin'` | Currently selected remote name |
| `aheadBehind` | `{ ahead: 0, behind: 0, upstream: null }` | Tracking info for current branch |
| `pushing` | `false` | Whether a push is in progress |
| `pulling` | `false` | Whether a pull is in progress |
| `fetching` | `false` | Whether a fetch is in progress |
| `result` | `null` | Operation result: `{ type: 'success'\|'error'\|'warning', text }` |
| `confirmDialog` | `null` | Confirmation dialog state: `{ type, title, message, confirmLabel, onConfirm }` |
| `forceConfirmStep` | `0` | Force push confirmation step (0 = none, 1 = first, 2 = second) |

**Protected Branches:**

`['main', 'master']` -- Pushing to these branches triggers a warning confirmation dialog.

**UI Elements:**

| Element | Description |
|---|---|
| Branch name | Monospace display of current branch with upstream info |
| Ahead badge | Green badge with up-arrow showing commits ahead of remote |
| Behind badge | Orange badge with down-arrow showing commits behind remote |
| Synced indicator | Gray "Synced" badge when ahead=0 and behind=0 |
| No upstream indicator | Gray "No upstream" badge when no tracking branch is set |
| Remote selector | Dropdown (only visible when multiple remotes exist) |
| Fetch button | Default style, downloads remote state |
| Pull button | Primary style (purple), shows behind count badge |
| Push button | Success style (or warning for protected branches), shows ahead count badge |
| Force Push button | Danger style, only appears after a push rejection mentioning "force push" |
| Result message | Auto-dismissing (5s) colored text for operation results |

**Safety Features:**

| Feature | Description |
|---|---|
| Protected branch warning | Confirmation dialog before pushing to main/master |
| Upstream auto-set | If no upstream exists, automatically passes `setUpstream=true` to push |
| Set upstream prompt | If push fails with "no upstream", offers a dialog to set upstream and retry |
| Pull conflict detection | Detects merge conflicts and uncommitted changes in pull error messages |
| Force push double confirmation | Two-step dialog: first acknowledges the risk, second confirms the action |

**Force Push Limitation:**

The current IPC handler does not support force push. The double-confirmation flow surfaces an error message noting this limitation.

**IPC Calls:**

- `electronAPI.gitAheadBehind(repoPath, branchName)` -- Get ahead/behind counts
- `electronAPI.gitPush(repoPath, remote, branch, setUpstream)` -- Push to remote
- `electronAPI.gitPull(repoPath, remote, branch)` -- Pull from remote
- `electronAPI.gitFetch(repoPath, remote)` -- Fetch from remote
- `electronAPI.gitStatus(repoPath)` -- Refresh status after operations
- `electronAPI.gitLog(repoPath)` -- Refresh log after operations
- `electronAPI.gitBranches(repoPath)` -- Refresh branches after operations

---

## BranchPanel

**File:** `src/ui/components/git/BranchPanel.jsx` (1567 lines)

Full-featured branch management panel with a visual SVG branch graph, collapsible local/remote branch lists, search filtering, and actions for creating, switching, deleting, merging, and moving changes to new branches. The largest component in the git manager.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `repoPath` | `string` (optional) | Repository path. Falls back to deriving from `gitActiveRepoId` in context. |

**Local State:**

| State | Default | Description |
|---|---|---|
| `searchFilter` | `''` | Branch name search filter text |
| `showCreateForm` | `false` | Whether the create-branch form is visible |
| `localCollapsed` | `false` | Whether the local branches section is collapsed |
| `remoteCollapsed` | `true` | Whether the remote branches section is collapsed (collapsed by default) |
| `selectedBranch` | `null` | Currently selected branch for actions |
| `aheadBehindMap` | `{}` | Map of branch names to `{ ahead, behind, upstream }` |
| `dialog` | `null` | Active confirmation dialog: `{ type: 'delete'\|'switch'\|'merge'\|'moveChanges', ...context }` |
| `mergePreview` | `null` | Merge preview state: `{ sourceBranch, loading, commits }` |
| `operationLoading` | `false` | Whether any branch operation is in progress |
| `operationError` | `null` | Error message from the last operation |
| `moveNewBranchName` | `''` | Branch name input for the "move changes" dialog |
| `moveStep` | `null` | Progress tracking for move-changes operation: `null\|'stashing'\|'creating'\|'applying'\|'done'\|'error'` |
| `moveError` | `null` | Error message from the move-changes operation |

**Key Functions:**

| Function | Description |
|---|---|
| `classifyBranches(branches)` | Splits branches into `{ local, remote }` arrays based on name format (remote branches contain `/`) |
| `handleSwitchBranch(name)` | Checks for uncommitted changes before switching; shows warning dialog if dirty |
| `performSwitchBranch(name, stashFirst)` | Executes branch switch via `gitCheckout()`, optionally stashing first with rollback on failure |
| `handleDeleteBranch(name)` | Attempts safe delete (`-d`); on failure (unmerged commits), shows force-delete confirmation dialog |
| `performForceDeleteBranch(name)` | Force-deletes a branch (`-D`) after user confirmation |
| `handleMergeBranch(source)` | Loads merge preview (commits in source not in current), shows MergePreviewDialog |
| `performMerge()` | Executes `gitMerge()` for the previewed branch |
| `handleMoveChanges()` | Opens the "move changes to new branch" dialog |
| `performMoveChanges(name)` | Three-step operation: stash, create+checkout branch, pop stash. Includes rollback on failure at each step. |
| `refreshBranches()` | Refreshes branches and current branch from git |
| `refreshAll()` | Refreshes branches, current branch, and status |

**Internal Components:**

| Component | Description |
|---|---|
| `BranchGraph` | SVG visualization of the branch/merge history. Loads up to 80 commits via `gitGraph()`, computes lane layout with `buildGraphLayout()`, renders colored commit dots, connection lines, merge curves, branch/tag labels, and commit messages. Collapsible section. |
| `CreateBranchForm` | Inline form with branch name input, validation (no spaces, special characters, or invalid patterns), Create/Cancel buttons. Calls `gitCreateBranch()` with `checkout=true`. |
| `ConfirmDialog` | Local confirmation dialog (separate from SafetyDialogs) with danger levels: `danger`, `warning`, `safe`. Used for branch delete and switch confirmations. |
| `MergePreviewDialog` | Shows the list of commits that will be merged (with short hashes and subjects), a loading state, and Merge/Cancel buttons. |

**Branch Graph Colors:**

10 lane colors: purple, green, amber, blue, pink, emerald, orange, violet, sky, yellow.

**Branch List Features:**

| Feature | Description |
|---|---|
| Search filter | Filters both local and remote branches by name substring |
| Current branch indicator | Dot icon and bold text for the checked-out branch |
| Ahead/behind badges | Green (ahead) and orange (behind) count badges per branch |
| Upstream indicator | Cloud icon showing the tracking remote branch |
| Action buttons | Switch, Merge, Move Changes, Delete (visible on hover/selection) |
| Protected branch delete | Cannot delete the currently checked-out branch |

**IPC Calls:**

- `electronAPI.gitBranches(repoPath)` -- List branches
- `electronAPI.gitCurrentBranch(repoPath)` -- Get current branch
- `electronAPI.gitAheadBehind(repoPath, branchName)` -- Get ahead/behind for each branch
- `electronAPI.gitCheckout(repoPath, branchName)` -- Switch to a branch
- `electronAPI.gitCreateBranch(repoPath, name, checkout)` -- Create a new branch (optionally checkout)
- `electronAPI.gitDeleteBranch(repoPath, name, force)` -- Delete a branch (`-d` or `-D`)
- `electronAPI.gitMerge(repoPath, sourceBranch)` -- Merge a branch into the current branch
- `electronAPI.gitStash(repoPath, message)` -- Stash changes (for move-changes flow)
- `electronAPI.gitStashPop(repoPath)` -- Pop stash (for move-changes flow)
- `electronAPI.gitGraph(repoPath, limit)` -- Get commit graph data for visualization
- `electronAPI.gitLog(repoPath, limit, extraArgs)` -- Get commits for merge preview
- `electronAPI.gitStatus(repoPath)` -- Refresh status after operations

---

## HistoryPanel

**File:** `src/ui/components/git/HistoryPanel.jsx` (1097 lines)

Commit history viewer with an SVG branch/merge graph, expandable commit rows, filtering by branch/author/date, lazy loading via infinite scroll, and per-commit detail views with file changes and on-demand diffs.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `repoPath` | `string` | Absolute path to the active repository |

**Local State:**

| State | Default | Description |
|---|---|---|
| `commits` | `[]` | Array of parsed commit objects |
| `loading` | `false` | Whether commits are being loaded |
| `hasMore` | `true` | Whether there are more commits to load |
| `expandedHash` | `null` | Hash of the currently expanded commit row |
| `searchInput` | `''` | Raw search input text |
| `searchTerm` | `''` | Debounced (400ms) search term applied to git log `--grep` |
| `branchFilter` | `''` | Selected branch to filter commits by |
| `authorInput` | `''` | Raw author filter input |
| `authorFilter` | `''` | Debounced (400ms) author filter applied to git log `--author` |
| `dateFrom` | `''` | Start date filter (`--after`) |
| `dateTo` | `''` | End date filter (`--before`) |
| `showFilters` | `false` | Whether the filter panel is expanded |

**Constants:**

| Constant | Value | Description |
|---|---|---|
| `BATCH_SIZE` | `50` | Commits to load per batch |
| `ROW_HEIGHT` | `36` | Pixel height per commit row |
| `LANE_WIDTH` | `14` | Pixel width per graph lane |
| `NODE_RADIUS` | `4` | Pixel radius for regular commit dots |
| `MERGE_NODE_RADIUS` | `5` | Pixel radius for merge commit dots |
| `GRAPH_PADDING` | `8` | Pixel padding around the graph area |

**Graph Lane Colors:**

10 colors: purple, green, amber, blue, red, cyan, pink, orange, violet, teal (at 0.85 opacity).

**Key Functions:**

| Function | Description |
|---|---|
| `computeGraphLayout(commits)` | Assigns each commit a lane (column) and computes vertical pass-through lines, merge curves, and converging lines. Returns array of layout entries with `lane`, `isMerge`, `lines`, `mergeLines`, `convergingLines`, `laneCount`. |
| `parseDiff` (not the same as DiffViewer's) | N/A -- diff rendering is inline within CommitDetails |
| `parseRefs(refStr)` | Parses decoration strings like `"HEAD -> main, origin/main, tag: v1.0"` into `[{ name, type }]` where type is `'head'`, `'tag'`, or `'branch'`. |
| `relativeDate(dateStr)` | Converts ISO date strings to human-readable relative times: "just now", "5m ago", "3h ago", "2d ago", "1w ago", "6mo ago", "2y ago". |
| `loadCommits(offset, replace)` | Fetches commits from git log with the current filters, handles parent hash parsing (from `--parents` flag), deduplication, and `hasMore` tracking. |

**Internal Components:**

| Component | Description |
|---|---|
| `GraphCell` | Renders the SVG graph column for a single commit row: vertical pass-through lines, merge bezier curves, and the commit node circle. |
| `RefBadges` | Renders branch/tag decoration badges next to commit messages. Combines inline refs from commit data with a branch-to-hash map for cross-referencing. |
| `CommitDetails` | Expanded detail view for a selected commit. Shows full commit body, metadata (hash, parents, author, date), file changes list (loaded via `--name-status`), and an on-demand diff viewer (loaded via `-p`). |

**Toolbar Elements:**

| Element | Description |
|---|---|
| Search input | Debounced 400ms, searches commit messages via `--grep` |
| Filters button | Toggles the filter panel, shows active-filter dot indicator |
| Refresh button | Reloads commits from scratch |

**Filter Panel:**

| Filter | Type | Git Flag |
|---|---|---|
| Branch | Select dropdown (local branches) | Branch name passed as arg |
| Author | Select dropdown (unique authors from loaded commits) | `--author=` |
| Date From | Date input | `--after=` |
| Date To | Date input | `--before=` |
| Clear button | Button (visible only when filters are active) | Resets all filters |

**Infinite Scroll:**

Triggers when `scrollTop + clientHeight >= scrollHeight - 100`. Also provides a manual "Load more commits" button as a fallback.

**IPC Calls:**

- `electronAPI.gitLog(repoPath, limit, extraArgs)` -- Load commit history with filters and pagination

---

## QuickActions

**File:** `src/ui/components/git/QuickActions.jsx` (962 lines)

Large, friendly one-click git operations designed for non-coders. Provides a clickable bar at the bottom of the git manager that opens a centered modal popup with categorized action cards. Each action triggers a confirmation dialog (via SafetyDialogs) before executing.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `repoPath` | `string` | Absolute path to the active repository |

**Local State:**

| State | Default | Description |
|---|---|---|
| `activeDialog` | `null` | ID of the currently open confirmation dialog |
| `loading` | `false` | Whether an operation is in progress |
| `branchName` | `''` | Branch name input for the "Move to New Branch" dialog |
| `error` | `null` | Error message for the current operation |
| `successMessage` | `null` | Success toast message (auto-dismisses after 3s) |
| `modalOpen` | `false` | Whether the quick actions modal popup is open |

**Action Cards (10 total):**

| ID | Title | Category | Variant | Operation |
|---|---|---|---|---|
| `save` | Save My Work | Common | `primary` | Stage all + commit with auto-generated message |
| `pull` | Update from Remote | Common | `success` | Git pull |
| `push` | Share My Changes | Common | `primary` | Git push |
| `fetch` | Fetch Remote | Remote | `success` | Git fetch |
| `sync` | Sync | Remote | `success` | Pull then push |
| `moveBranch` | Move to New Branch | Branch & Stash | `warning` | Stash, create branch, pop stash |
| `stash` | Stash Changes | Branch & Stash | `warning` | Git stash |
| `stashPop` | Pop Stash | Branch & Stash | `warning` | Git stash pop |
| `undoCommit` | Undo Last Commit | Undo / Reset | `warning` | Soft reset to HEAD~1 |
| `discardAll` | Discard All Changes | Undo / Reset | `danger` | Hard reset to HEAD (double confirmation) |

**Action Categories:**

| Category | Label |
|---|---|
| `common` | Common |
| `remote` | Remote |
| `branch` | Branch & Stash |
| `undo` | Undo / Reset |

**Key Helper Functions:**

| Function | Description |
|---|---|
| `generateCommitMessage(status)` | Generates a smart auto-commit message from the file status. Single file: "Update filename". Two files: "Update a and b". Three: "Update a, b, and c". Four+: "Update a, b, and N other files". |
| `getAffectedFiles(status)` | Extracts deduplicated file paths from staged, unstaged, and untracked arrays for dialog display. |
| `refreshGitData(api, repoPath, dispatch)` | Module-level helper that refreshes status, branches, current branch, and log in parallel. |

**Modal Structure:**

The quick actions bar is always visible at the bottom. Clicking it opens a centered modal overlay with:
- Header: "Quick Actions" title, current branch badge, close button
- Body: Actions grouped by category, each as a card with icon, title, description
- Disabled actions show "n/a" badge and disabled reason on hover

**Confirmation Dialogs:**

Most actions use `<ConfirmDialog>` from SafetyDialogs. "Discard All Changes" uses `<DoubleConfirmDialog>` with a typed confirmation ("DISCARD"). "Move to New Branch" uses a custom inline dialog with a branch name input field.

**IPC Calls:**

- `electronAPI.gitStageAll(repoPath)` -- Stage all files
- `electronAPI.gitCommit(repoPath, message)` -- Create a commit
- `electronAPI.gitPull(repoPath)` -- Pull from remote
- `electronAPI.gitPush(repoPath)` -- Push to remote
- `electronAPI.gitFetch(repoPath)` -- Fetch from remote
- `electronAPI.gitStash(repoPath)` -- Stash changes
- `electronAPI.gitStashPop(repoPath)` -- Pop stash
- `electronAPI.gitCreateBranch(repoPath, name)` -- Create a new branch
- `electronAPI.gitReset(repoPath, target, mode)` -- Reset (`HEAD~1` soft for undo, `HEAD` hard for discard)
- `electronAPI.gitStatus(repoPath)` -- Refresh status
- `electronAPI.gitBranches(repoPath)` -- Refresh branches
- `electronAPI.gitCurrentBranch(repoPath)` -- Refresh current branch
- `electronAPI.gitLog(repoPath)` -- Refresh log

---

## SafetyDialogs

**File:** `src/ui/components/git/SafetyDialogs.jsx` (247 lines)

Reusable confirmation dialog components with three danger levels, optional typed confirmation, and affected file lists. Used by QuickActions and other components that need user confirmation before destructive operations.

**Exports:**

- Default: `ConfirmDialog`
- Named: `ConfirmDialog`, `DoubleConfirmDialog`

### ConfirmDialog

Generic confirmation dialog with level-based styling (safe/warning/danger), optional typed confirmation input, and an affected items list.

**Props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `isOpen` / `open` | `boolean` | `false` | Whether the dialog is visible (supports both prop names) |
| `title` | `string` | -- | Dialog title text |
| `message` | `string` | -- | Dialog body message |
| `dangerLevel` / `level` | `string` | `'warning'` | Danger level: `'safe'`, `'warning'`, or `'danger'` |
| `confirmLabel` | `string` | `'Confirm'` | Text on the confirm button |
| `cancelLabel` | `string` | `'Cancel'` | Text on the cancel button |
| `confirmText` | `string\|null` | `null` | If set, user must type this exact string to enable the confirm button |
| `affectedItems` | `string[]` | -- | List of file paths or items displayed in a scrollable area |
| `loading` | `boolean` | `false` | Shows spinner on confirm button and disables cancel |
| `onConfirm` | `function` | -- | Called when confirm is clicked |
| `onCancel` | `function` | -- | Called when cancel is clicked or Escape is pressed |

**Danger Level Icons:**

| Level | Icon | Description |
|---|---|---|
| `danger` | Triangle with exclamation | Red/destructive styling |
| `warning` | Circle with exclamation | Orange/caution styling |
| `safe` | Circle with checkmark | Blue/green safe styling |

**Key Behaviors:**

- Escape key dismisses the dialog
- Clicking the overlay background dismisses the dialog
- When `confirmText` is set, an input field appears and the confirm button is disabled until the typed text matches exactly
- Enter key in the typed confirmation input triggers confirm (if text matches and not loading)
- The `typed` state resets when the dialog opens

### DoubleConfirmDialog

Two-step confirmation dialog for highly destructive operations. Step 1 shows a standard ConfirmDialog; on confirm, step 2 shows a second dialog (optionally with typed confirmation).

**Props (extends ConfirmDialog):**

| Prop | Type | Default | Description |
|---|---|---|---|
| `secondTitle` | `string` | `'Are you absolutely sure?'` | Title for the second confirmation step |
| `secondMessage` | `string` | (generic warning) | Message for the second step |
| `secondConfirmLabel` | `string` | `'Yes, I am sure'` | Confirm button text for the second step |
| `confirmText` | `string\|null` | `null` | Typed confirmation applied to the **second** step only |

**Behavior:**

- Step 1: Standard ConfirmDialog (no typed confirmation). Clicking confirm advances to step 2.
- Step 2: ConfirmDialog with the second title/message and optional `confirmText` requirement. Clicking confirm calls `onConfirm`.
- Cancel at either step resets to step 1 and calls `onCancel`.

---

## Component Relationship Map

```
GitManagerView (root)
  |
  |-- GitWelcome                  (no repos open)
  |-- RepoTabs                    (always, when repos exist)
  |-- InitFlow                    (non-git folder)
  |
  |-- [Sidebar]
  |   |-- ChangesPanel            (staged/unstaged/untracked files)
  |   |-- CommitPanel             (commit message + commit button)
  |
  |-- [Content Area - tabbed]
  |   |-- DiffViewer              (tab: Changes)
  |   |-- HistoryPanel            (tab: History)
  |   |   |-- GraphCell           (SVG graph per row)
  |   |   |-- RefBadges           (branch/tag decorations)
  |   |   |-- CommitDetails       (expanded row detail)
  |   |-- BranchPanel             (tab: Branches)
  |       |-- BranchGraph         (SVG commit visualization)
  |       |-- CreateBranchForm    (inline branch creation)
  |       |-- ConfirmDialog       (local, for branch ops)
  |       |-- MergePreviewDialog  (merge commit preview)
  |
  |-- RemotePanel                 (push/pull/fetch bar)
  |-- QuickActions                (bottom bar + modal popup)
      |-- ConfirmDialog           (from SafetyDialogs)
      |-- DoubleConfirmDialog     (from SafetyDialogs)
```

---

## Dispatch Actions Used

All actions dispatched by git manager components use the `GIT_*` prefix:

| Action | Dispatched By | Description |
|---|---|---|
| `GIT_OPEN_REPO` | RepoTabs, GitWelcome | Open a new repository |
| `GIT_SWITCH_REPO` | RepoTabs | Switch to a different repo tab |
| `GIT_CLOSE_REPO` | RepoTabs | Close a repo tab |
| `GIT_SET_LOADING` | GitManagerView | Set global git loading state |
| `GIT_SET_STATUS` | GitManagerView, ChangesPanel, CommitPanel, RemotePanel, BranchPanel, QuickActions | Update working tree status |
| `GIT_SET_BRANCHES` | GitManagerView, RemotePanel, BranchPanel, QuickActions | Update branch list |
| `GIT_SET_CURRENT_BRANCH` | GitManagerView, BranchPanel, QuickActions | Update current branch name |
| `GIT_SET_LOG` | GitManagerView, CommitPanel, HistoryPanel, QuickActions | Update commit log |
| `GIT_SET_REMOTES` | GitManagerView | Update remote list |
| `GIT_SET_ERROR` | GitManagerView, ChangesPanel | Set/clear error state |
| `GIT_SET_SELECTED_FILE` | ChangesPanel | Set the selected file for diff viewing |
| `GIT_SET_DIFF` | ChangesPanel | Set the diff content for the selected file |
