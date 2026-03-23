# Git Manager IPC Handlers Reference

The Git Manager operations are handled by 28 IPC handlers registered in `electron/ipc-handlers.js`. All handlers follow the `git-*` naming convention and are exposed to the renderer via `window.electronAPI` in `electron/preload.js`.

---

## Security Model

All Git IPC handlers enforce security constraints through two mechanisms:

### Repository Path Validation

The `gitValidateRepoPath(repoPath)` helper validates every repository path before execution:

1. Rejects falsy or non-string values immediately
2. Resolves the absolute path using `path.resolve()`
3. Calls `fs.promises.stat()` to verify the path exists
4. Confirms the path is a directory (not a file)
5. Throws descriptive errors for missing paths or non-directory targets

### Command Execution via `execFile`

The `gitExec(args, repoPath, opts)` helper wraps all git commands safely:

1. Uses `child_process.execFile()` (not `exec()`) to prevent shell injection — arguments are passed as an array, never interpolated into a shell string
2. Sets `cwd` to the validated repository path
3. Enforces a default 30-second timeout (configurable per handler; network operations use 60s)
4. Caps output buffer at 10MB to prevent memory exhaustion
5. Returns a normalized `{ success, data }` or `{ success, error }` response, preferring stderr content for error messages

### Input Validation

Individual handlers perform additional validation:

- Array parameters (e.g., `files` in `git-stage`) are checked for type and non-empty length
- String parameters (e.g., `message` in `git-commit`, `branchName` in `git-checkout`) are checked for type and non-empty value
- Enum parameters (e.g., `mode` in `git-reset`) are validated against an allowlist, falling back to a safe default

---

## Response Pattern

Every git handler returns a consistent response object:

```javascript
// Success
{ success: true, data: <result> }

// Error
{ success: false, error: "Error message string" }
```

The `data` field type varies by handler: `boolean`, `string`, `null`, `object`, or `array`.

---

## Handler Reference

### Repository Setup

#### `git-is-repo`

Check if a directory is a git repository.

**Renderer API:** `electronAPI.gitIsRepo(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the directory to check |

**Returns:**

```javascript
// Is a repo
{ success: true, data: true }

// Not a repo
{ success: true, data: false }

// Error (e.g., path doesn't exist)
{ success: false, error: "Error message" }
```

**Implementation:** Runs `git rev-parse --is-inside-work-tree` and checks if the trimmed output equals `"true"`.

---

#### `git-init`

Initialize a new git repository.

**Renderer API:** `electronAPI.gitInit(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the directory to initialize |

**Returns:**

```javascript
{ success: true, data: "Initialized empty Git repository in /path/.git/" }
// or
{ success: false, error: "Error message" }
```

**Implementation:** Runs `git init` in the target directory.

---

### Working Tree Status

#### `git-status`

Get the working tree status with parsed staging information.

**Renderer API:** `electronAPI.gitStatus(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |

**Returns:**

```javascript
{
  success: true,
  data: {
    staged: [
      { status: "M", path: "src/index.js" },
      { status: "A", path: "src/new-file.js" }
    ],
    unstaged: [
      { status: "M", path: "README.md" }
    ],
    untracked: [
      "temp.log"
    ]
  }
}
```

**Implementation:**
1. Runs `git status --porcelain -uall`
2. Parses each line's two-character status code:
   - `x` (index column): staging area status
   - `y` (worktree column): working directory status
3. Routes files into three arrays:
   - `??` entries go to `untracked[]` (path only)
   - `!!` entries (ignored) are silently skipped
   - Non-space/non-`?` in `x` column: added to `staged[]` with `{ status, path }`
   - Non-space/non-`?` in `y` column: added to `unstaged[]` with `{ status, path }`

**Status codes:** `M` = modified, `A` = added, `D` = deleted, `R` = renamed, `C` = copied, `U` = unmerged.

---

#### `git-diff`

Get the full diff output (unstaged or staged).

**Renderer API:** `electronAPI.gitDiff(repoPath, staged)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `staged` | `boolean` | No | If `true`, shows staged (cached) diff; otherwise shows unstaged diff |

**Returns:**

```javascript
{ success: true, data: "diff --git a/file.js b/file.js\n..." }
// or (no changes)
{ success: true, data: "" }
```

**Implementation:** Runs `git diff` or `git diff --cached` depending on the `staged` flag.

---

#### `git-diff-file`

Get the diff for a specific file.

**Renderer API:** `electronAPI.gitDiffFile(repoPath, filePath, staged)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `filePath` | `string` | Yes | Relative path to the file within the repo |
| `staged` | `boolean` | No | If `true`, shows staged diff; otherwise shows unstaged diff |

**Returns:**

```javascript
{ success: true, data: "diff --git a/file.js b/file.js\n..." }
// or
{ success: false, error: "Error message" }
```

**Implementation:** Runs `git diff [--cached] -- <filePath>`.

---

### Commit History

#### `git-log`

Get the commit log with parsed commit objects.

**Renderer API:** `electronAPI.gitLog(repoPath, maxCount, extraArgs)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `maxCount` | `number` | No | Maximum number of commits to return (default: 50) |
| `extraArgs` | `string[]` | No | Additional git log arguments (e.g., `['--all']`) |

**Returns:**

```javascript
{
  success: true,
  data: [
    {
      hash: "abc123def456...",
      shortHash: "abc123d",
      author: "Jane Doe",
      email: "jane@example.com",
      date: "2026-03-23T08:00:00+00:00",
      subject: "Fix dashboard rendering bug",
      body: "Extended description if present"
    }
  ]
}
```

**Implementation:**
1. Runs `git log --max-count=N --format=%H%n%h%n%an%n%ae%n%aI%n%s%n%b%n---END---`
2. Splits output on `---END---` delimiter
3. Parses each entry into a structured commit object with: `hash`, `shortHash`, `author`, `email`, `date` (ISO 8601), `subject`, and `body`
4. Appends any `extraArgs` to the git command

---

#### `git-graph`

Get the commit graph with parent references and branch decorations for visualization.

**Renderer API:** `electronAPI.gitGraph(repoPath, maxCount)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `maxCount` | `number` | No | Maximum number of commits (default: 150) |

**Returns:**

```javascript
{
  success: true,
  data: [
    {
      hash: "abc123def456...",
      parents: ["def789..."],
      refs: ["HEAD -> main", "origin/main"],
      subject: "Fix dashboard rendering bug",
      author: "Jane Doe",
      date: "2026-03-23T08:00:00+00:00"
    }
  ]
}
```

**Implementation:**
1. Runs `git log --all --topo-order --max-count=N` with a custom format using SOH (`\x01`) as a safe delimiter
2. Format: `%H<SOH>%P<SOH>%D<SOH>%s<SOH>%an<SOH>%aI`
3. Parses parent hashes into an array (merge commits have multiple parents)
4. Parses decoration refs (`%D`) into an array of trimmed ref strings
5. Used by the HistoryPanel to render the SVG commit graph

---

### Staging Operations

#### `git-stage`

Stage specific files.

**Renderer API:** `electronAPI.gitStage(repoPath, files)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `files` | `string[]` | Yes | Array of file paths to stage (must be non-empty) |

**Returns:**

```javascript
{ success: true, data: null }
// or
{ success: false, error: "files must be a non-empty array" }
```

**Implementation:** Runs `git add -- <file1> <file2> ...`. Validates that `files` is a non-empty array before execution.

---

#### `git-unstage`

Unstage specific files.

**Renderer API:** `electronAPI.gitUnstage(repoPath, files)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `files` | `string[]` | Yes | Array of file paths to unstage (must be non-empty) |

**Returns:**

```javascript
{ success: true, data: null }
// or
{ success: false, error: "files must be a non-empty array" }
```

**Implementation:** Runs `git reset HEAD -- <file1> <file2> ...`. Validates that `files` is a non-empty array.

---

#### `git-stage-all`

Stage all changes (tracked and untracked).

**Renderer API:** `electronAPI.gitStageAll(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |

**Returns:**

```javascript
{ success: true, data: null }
// or
{ success: false, error: "Error message" }
```

**Implementation:** Runs `git add -A`.

---

#### `git-unstage-all`

Unstage all staged changes.

**Renderer API:** `electronAPI.gitUnstageAll(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |

**Returns:**

```javascript
{ success: true, data: null }
// or
{ success: false, error: "Error message" }
```

**Implementation:** Runs `git reset HEAD`.

---

### Committing

#### `git-commit`

Create a commit with the staged changes.

**Renderer API:** `electronAPI.gitCommit(repoPath, message)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `message` | `string` | Yes | Commit message (must be non-empty) |

**Returns:**

```javascript
{ success: true, data: "[main abc1234] Fix bug\n 1 file changed, 2 insertions(+)" }
// or
{ success: false, error: "Commit message is required" }
```

**Implementation:** Runs `git commit -m <message>`. Validates that the message is a non-empty string.

---

### Remote Operations

#### `git-push`

Push commits to a remote repository.

**Renderer API:** `electronAPI.gitPush(repoPath, remote, branch, setUpstream)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `remote` | `string` | No | Remote name (e.g., `"origin"`) |
| `branch` | `string` | No | Branch name to push |
| `setUpstream` | `boolean` | No | If `true`, adds `-u` flag to set upstream tracking |

**Returns:**

```javascript
{ success: true, data: "..." }
// or
{ success: false, error: "Error message" }
```

**Implementation:** Builds `git push [-u] [remote] [branch]`. Uses 60-second timeout for network operations.

---

#### `git-pull`

Pull changes from a remote repository.

**Renderer API:** `electronAPI.gitPull(repoPath, remote, branch)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `remote` | `string` | No | Remote name (e.g., `"origin"`) |
| `branch` | `string` | No | Branch name to pull |

**Returns:**

```javascript
{ success: true, data: "Already up to date." }
// or
{ success: false, error: "Error message" }
```

**Implementation:** Builds `git pull [remote] [branch]`. Uses 60-second timeout.

---

#### `git-fetch`

Fetch changes from a remote without merging.

**Renderer API:** `electronAPI.gitFetch(repoPath, remote)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `remote` | `string` | No | Specific remote to fetch from; if omitted, fetches `--all` |

**Returns:**

```javascript
{ success: true, data: "..." }
// or
{ success: false, error: "Error message" }
```

**Implementation:** Runs `git fetch <remote>` or `git fetch --all` if no remote specified. Uses 60-second timeout.

---

#### `git-remotes`

List all configured remotes with their URLs.

**Renderer API:** `electronAPI.gitRemotes(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |

**Returns:**

```javascript
{
  success: true,
  data: [
    {
      name: "origin",
      fetchUrl: "https://github.com/user/repo.git",
      pushUrl: "https://github.com/user/repo.git"
    }
  ]
}
```

**Implementation:**
1. Runs `git remote -v`
2. Parses each line with regex: `/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/`
3. Groups fetch and push URLs by remote name
4. Returns an array of `{ name, fetchUrl, pushUrl }` objects

---

#### `git-ahead-behind`

Count commits ahead and behind the upstream tracking branch.

**Renderer API:** `electronAPI.gitAheadBehind(repoPath, branch)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `branch` | `string` | No | Branch to check; defaults to current branch (via `rev-parse --abbrev-ref HEAD`) |

**Returns:**

```javascript
// With upstream configured
{
  success: true,
  data: {
    ahead: 3,
    behind: 1,
    upstream: "origin/main"
  }
}

// No upstream configured
{
  success: true,
  data: {
    ahead: 0,
    behind: 0,
    upstream: null
  }
}
```

**Implementation:**
1. If no branch specified, resolves current branch via `git rev-parse --abbrev-ref HEAD`
2. Resolves upstream tracking branch via `git rev-parse --abbrev-ref <branch>@{upstream}`
3. If no upstream exists, returns `{ ahead: 0, behind: 0, upstream: null }`
4. Runs `git rev-list --left-right --count <branch>...<upstream>` to get ahead/behind counts

---

### Branch Operations

#### `git-branches`

List all local and remote branches.

**Renderer API:** `electronAPI.gitBranches(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |

**Returns:**

```javascript
{
  success: true,
  data: [
    {
      name: "main",
      hash: "abc123d",
      upstream: "origin/main",
      current: true
    },
    {
      name: "feature/login",
      hash: "def456a",
      upstream: null,
      current: false
    },
    {
      name: "origin/main",
      hash: "abc123d",
      upstream: null,
      current: false
    }
  ]
}
```

**Implementation:**
1. Runs `git branch -a --format=%(refname:short)|||%(objectname:short)|||%(upstream:short)|||%(HEAD)`
2. Splits each line on `|||` delimiter
3. Parses into `{ name, hash, upstream, current }` objects
4. Includes both local and remote-tracking branches (`-a` flag)

---

#### `git-current-branch`

Get the name of the current branch.

**Renderer API:** `electronAPI.gitCurrentBranch(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |

**Returns:**

```javascript
{ success: true, data: "main" }
// or (detached HEAD)
{ success: true, data: "HEAD" }
```

**Implementation:** Runs `git rev-parse --abbrev-ref HEAD`.

---

#### `git-checkout`

Checkout a branch, tag, or commit.

**Renderer API:** `electronAPI.gitCheckout(repoPath, target)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `target` | `string` | Yes | Branch name, tag, or commit hash to checkout |

**Returns:**

```javascript
{ success: true, data: "Switched to branch 'feature/login'" }
// or
{ success: false, error: "Checkout target is required" }
```

**Implementation:** Runs `git checkout <target>`. Validates that `target` is a non-empty string.

---

#### `git-create-branch`

Create a new branch, optionally checking it out immediately.

**Renderer API:** `electronAPI.gitCreateBranch(repoPath, branchName, checkout)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `branchName` | `string` | Yes | Name for the new branch |
| `checkout` | `boolean` | No | If `false`, creates without switching; otherwise creates and checks out (default behavior) |

**Returns:**

```javascript
{ success: true, data: "Switched to a new branch 'feature/login'" }
// or
{ success: false, error: "Branch name is required" }
```

**Implementation:**
- If `checkout !== false`: runs `git checkout -b <branchName>` (create + switch)
- If `checkout === false`: runs `git branch <branchName>` (create only)

---

#### `git-delete-branch`

Delete a branch.

**Renderer API:** `electronAPI.gitDeleteBranch(repoPath, branchName, force)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `branchName` | `string` | Yes | Branch to delete |
| `force` | `boolean` | No | If `true`, uses `-D` (force delete); otherwise uses `-d` (safe delete) |

**Returns:**

```javascript
{ success: true, data: "Deleted branch feature/login (was abc123d)." }
// or
{ success: false, error: "Branch name is required" }
```

**Implementation:** Runs `git branch -d <branchName>` (safe) or `git branch -D <branchName>` (force). Safe delete fails if the branch has unmerged changes.

---

#### `git-merge`

Merge a branch into the current branch.

**Renderer API:** `electronAPI.gitMerge(repoPath, branchName)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `branchName` | `string` | Yes | Branch to merge into the current branch |

**Returns:**

```javascript
{ success: true, data: "Merge made by the 'ort' strategy.\n..." }
// or
{ success: false, error: "Branch name is required" }
```

**Implementation:** Runs `git merge <branchName>`. Uses 60-second timeout for large merges.

---

### Stash Operations

#### `git-stash`

Stash current working directory changes.

**Renderer API:** `electronAPI.gitStash(repoPath, message)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `message` | `string` | No | Optional message describing the stash |

**Returns:**

```javascript
{ success: true, data: "Saved working directory and index state WIP on main: abc123d Fix bug" }
// or
{ success: false, error: "Error message" }
```

**Implementation:** Runs `git stash push [-m <message>]`. The `-m` flag is only added when a non-empty message string is provided.

---

#### `git-stash-pop`

Pop (apply and remove) the most recent stash entry.

**Renderer API:** `electronAPI.gitStashPop(repoPath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |

**Returns:**

```javascript
{ success: true, data: "On main\nChanges not staged for commit:\n..." }
// or
{ success: false, error: "No stash entries found." }
```

**Implementation:** Runs `git stash pop`.

---

### History Rewriting

#### `git-reset`

Reset the current branch to a specific commit.

**Renderer API:** `electronAPI.gitReset(repoPath, target, mode)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `target` | `string` | No | Commit hash or ref to reset to |
| `mode` | `string` | No | Reset mode: `"--soft"`, `"--mixed"` (default), or `"--hard"` |

**Returns:**

```javascript
{ success: true, data: "..." }
// or
{ success: false, error: "Error message" }
```

**Implementation:**
1. Validates `mode` against allowlist `['--soft', '--mixed', '--hard']`
2. Falls back to `--mixed` if an invalid mode is provided
3. Runs `git reset <mode> [target]`

---

#### `git-revert`

Revert a specific commit by creating a new inverse commit.

**Renderer API:** `electronAPI.gitRevert(repoPath, commitHash)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `commitHash` | `string` | Yes | Hash of the commit to revert |

**Returns:**

```javascript
{ success: true, data: "[main def456a] Revert \"Fix bug\"\n..." }
// or
{ success: false, error: "Commit hash is required" }
```

**Implementation:** Runs `git revert --no-edit <commitHash>`. Uses `--no-edit` to auto-generate the revert commit message. Uses 60-second timeout.

---

### File Operations

#### `git-discard-file`

Discard all changes to a specific file, restoring it to HEAD.

**Renderer API:** `electronAPI.gitDiscardFile(repoPath, filePath)`

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | `string` | Yes | Absolute path to the repository |
| `filePath` | `string` | Yes | Relative path to the file within the repo |

**Returns:**

```javascript
{ success: true, data: "Changes discarded" }
// or (untracked file)
{ success: true, data: "Untracked file removed" }
// or
{ success: false, error: "File path is required" }
```

**Implementation:**
1. Checks if the file is untracked via `git status --porcelain -- <filePath>`
2. If untracked (`??` status): deletes the file using `fs.promises.unlink()`
3. If tracked: runs `git checkout HEAD -- <filePath>` to restore from HEAD

---

## Context Bridge Summary

All Git methods exposed in `electron/preload.js` via `window.electronAPI`:

```javascript
// Repository setup
gitIsRepo:        (repoPath) => invoke('git-is-repo', repoPath)
gitInit:          (repoPath) => invoke('git-init', repoPath)

// Working tree status
gitStatus:        (repoPath) => invoke('git-status', repoPath)
gitDiff:          (repoPath, staged) => invoke('git-diff', repoPath, staged)
gitDiffFile:      (repoPath, filePath, staged) => invoke('git-diff-file', repoPath, filePath, staged)

// Commit history
gitLog:           (repoPath, maxCount, extraArgs) => invoke('git-log', repoPath, maxCount, extraArgs)
gitGraph:         (repoPath, maxCount) => invoke('git-graph', repoPath, maxCount)

// Staging
gitStage:         (repoPath, files) => invoke('git-stage', repoPath, files)
gitUnstage:       (repoPath, files) => invoke('git-unstage', repoPath, files)
gitStageAll:      (repoPath) => invoke('git-stage-all', repoPath)
gitUnstageAll:    (repoPath) => invoke('git-unstage-all', repoPath)

// Committing
gitCommit:        (repoPath, message) => invoke('git-commit', repoPath, message)

// Remote operations
gitPush:          (repoPath, remote, branch, setUpstream) => invoke('git-push', repoPath, remote, branch, setUpstream)
gitPull:          (repoPath, remote, branch) => invoke('git-pull', repoPath, remote, branch)
gitFetch:         (repoPath, remote) => invoke('git-fetch', repoPath, remote)
gitRemotes:       (repoPath) => invoke('git-remotes', repoPath)
gitAheadBehind:   (repoPath, branch) => invoke('git-ahead-behind', repoPath, branch)

// Branch operations
gitBranches:      (repoPath) => invoke('git-branches', repoPath)
gitCurrentBranch: (repoPath) => invoke('git-current-branch', repoPath)
gitCheckout:      (repoPath, target) => invoke('git-checkout', repoPath, target)
gitCreateBranch:  (repoPath, branchName, checkout) => invoke('git-create-branch', repoPath, branchName, checkout)
gitDeleteBranch:  (repoPath, branchName, force) => invoke('git-delete-branch', repoPath, branchName, force)
gitMerge:         (repoPath, branchName) => invoke('git-merge', repoPath, branchName)

// Stash operations
gitStash:         (repoPath, message) => invoke('git-stash', repoPath, message)
gitStashPop:      (repoPath) => invoke('git-stash-pop', repoPath)

// History rewriting
gitReset:         (repoPath, target, mode) => invoke('git-reset', repoPath, target, mode)
gitRevert:        (repoPath, commitHash) => invoke('git-revert', repoPath, commitHash)

// File operations
gitDiscardFile:   (repoPath, filePath) => invoke('git-discard-file', repoPath, filePath)
```

---

## Handler Summary Table

| Channel | Category | Git Command | Timeout |
|---|---|---|---|
| `git-is-repo` | Setup | `rev-parse --is-inside-work-tree` | 30s |
| `git-init` | Setup | `init` | 30s |
| `git-status` | Status | `status --porcelain -uall` | 30s |
| `git-diff` | Status | `diff [--cached]` | 30s |
| `git-diff-file` | Status | `diff [--cached] -- <file>` | 30s |
| `git-log` | History | `log --max-count=N --format=...` | 30s |
| `git-graph` | History | `log --all --topo-order --max-count=N --format=...` | 30s |
| `git-stage` | Staging | `add -- <files>` | 30s |
| `git-unstage` | Staging | `reset HEAD -- <files>` | 30s |
| `git-stage-all` | Staging | `add -A` | 30s |
| `git-unstage-all` | Staging | `reset HEAD` | 30s |
| `git-commit` | Commit | `commit -m <msg>` | 30s |
| `git-push` | Remote | `push [-u] [remote] [branch]` | 60s |
| `git-pull` | Remote | `pull [remote] [branch]` | 60s |
| `git-fetch` | Remote | `fetch [remote\|--all]` | 60s |
| `git-remotes` | Remote | `remote -v` | 30s |
| `git-ahead-behind` | Remote | `rev-list --left-right --count` | 30s |
| `git-branches` | Branch | `branch -a --format=...` | 30s |
| `git-current-branch` | Branch | `rev-parse --abbrev-ref HEAD` | 30s |
| `git-checkout` | Branch | `checkout <target>` | 30s |
| `git-create-branch` | Branch | `checkout -b` / `branch` | 30s |
| `git-delete-branch` | Branch | `branch -d/-D` | 30s |
| `git-merge` | Branch | `merge <branch>` | 60s |
| `git-stash` | Stash | `stash push [-m]` | 30s |
| `git-stash-pop` | Stash | `stash pop` | 30s |
| `git-reset` | Rewrite | `reset <mode> [target]` | 30s |
| `git-revert` | Rewrite | `revert --no-edit <hash>` | 60s |
| `git-discard-file` | File | `checkout HEAD -- <file>` / `unlink` | 30s |
