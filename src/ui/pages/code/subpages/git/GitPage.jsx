// GitPage — main Git Manager layout component
// Sidebar (ChangesPanel + CommitPanel), content area (DiffViewer / HistoryPanel
// / BranchPanel), and QuickActions. The dashboard's projectPath is scanned
// for nested .git directories; each discovered repo appears as a tab and the
// active repo drives all git operations.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';
import InitFlow from './components/InitFlow.jsx';
import ChangesPanel from './components/ChangesPanel.jsx';
import DiffViewer from './components/DiffViewer.jsx';
import CommitPanel from './components/CommitPanel.jsx';
import RemotePanel from './components/RemotePanel.jsx';
import BranchPanel from './components/BranchPanel.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import QuickActions from './components/QuickActions.jsx';
import {
  getDashboardProject,
  saveDashboardProject,
  getDashboardActiveRepo,
  saveDashboardActiveRepo,
} from '@/utils/dashboardProjects.js';
import '@/pages/code/subpages/git/styles/git-manager.css';

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 300;

function basename(p) {
  if (!p) return '';
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p;
}

// Compute a short label for a repo relative to the project root.
// Root repo → repo name. Nested repo → relative path from root.
function repoLabel(repo, projectPath) {
  if (!repo) return '';
  if (repo.isRoot) return basename(repo.path);
  if (!projectPath) return basename(repo.path);
  const root = projectPath.replace(/[/\\]+$/, '');
  if (repo.path.startsWith(root + '/') || repo.path.startsWith(root + '\\')) {
    return repo.path.slice(root.length + 1);
  }
  return basename(repo.path);
}

export default function GitPage() {
  const {
    currentDashboardId,
    gitStatus,
    gitSelectedFile,
    gitCurrentBranch,
  } = useAppState();
  const dispatch = useDispatch();

  // Resolve the project root from the current dashboard's binding.
  const projectPath = currentDashboardId ? getDashboardProject(currentDashboardId) : null;
  const projectName = basename(projectPath);

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [discoveredRepos, setDiscoveredRepos] = useState([]); // [{ path, name, isRoot }]
  const [discovering, setDiscovering] = useState(false);
  const [activeRepoPath, setActiveRepoPath] = useState(null);
  const [contentTab, setContentTab] = useState('changes');
  const dragRef = useRef({ startX: 0, startWidth: 0 });
  const autoFetchedFileRef = useRef(null);

  // Discover all git repos under the project root whenever it changes.
  useEffect(() => {
    if (!currentDashboardId || !projectPath) {
      setDiscoveredRepos([]);
      setActiveRepoPath(null);
      return;
    }

    let cancelled = false;
    setDiscovering(true);

    (async () => {
      try {
        const api = window.electronAPI;
        if (!api || !api.gitDiscoverRepos) {
          if (!cancelled) {
            setDiscoveredRepos([]);
            setDiscovering(false);
          }
          return;
        }
        const result = await api.gitDiscoverRepos(projectPath);
        if (cancelled) return;
        const repos = (result && result.success && Array.isArray(result.data)) ? result.data : [];
        setDiscoveredRepos(repos);

        // Pick active repo: previously-saved choice if still valid, else first discovered.
        const saved = getDashboardActiveRepo(currentDashboardId);
        const valid = saved && repos.some(r => r.path === saved);
        const next = valid ? saved : (repos[0] ? repos[0].path : null);
        setActiveRepoPath(next);
        if (next && next !== saved) {
          saveDashboardActiveRepo(currentDashboardId, next);
        }
        setDiscovering(false);
      } catch (err) {
        console.error('GitPage: failed to discover repos', err);
        if (!cancelled) {
          setDiscoveredRepos([]);
          setDiscovering(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [currentDashboardId, projectPath]);

  // Switch active repo — clears stale git state so the new repo's data loads cleanly.
  const handleSwitchRepo = useCallback((repoPath) => {
    if (!repoPath || repoPath === activeRepoPath) return;
    setActiveRepoPath(repoPath);
    if (currentDashboardId) {
      saveDashboardActiveRepo(currentDashboardId, repoPath);
    }
    dispatch({ type: 'GIT_SET_STATUS', status: null });
    dispatch({ type: 'GIT_SET_BRANCHES', branches: [] });
    dispatch({ type: 'GIT_SET_CURRENT_BRANCH', branch: null });
    dispatch({ type: 'GIT_SET_LOG', log: [] });
    dispatch({ type: 'GIT_SET_DIFF', diff: null });
    dispatch({ type: 'GIT_SET_REMOTES', remotes: [] });
    dispatch({ type: 'GIT_SET_SELECTED_FILE', filePath: null });
    autoFetchedFileRef.current = null;
  }, [activeRepoPath, currentDashboardId, dispatch]);

  // Load git data when the active repo changes.
  useEffect(() => {
    if (!activeRepoPath) return;

    let cancelled = false;
    const api = window.electronAPI;
    if (!api) return;

    dispatch({ type: 'GIT_SET_LOADING', value: true });

    (async () => {
      try {
        const [statusResult, branchesResult, currentBranchResult, logResult, remotesResult] = await Promise.all([
          api.gitStatus ? api.gitStatus(activeRepoPath) : null,
          api.gitBranches ? api.gitBranches(activeRepoPath) : null,
          api.gitCurrentBranch ? api.gitCurrentBranch(activeRepoPath) : null,
          api.gitLog ? api.gitLog(activeRepoPath) : null,
          api.gitRemotes ? api.gitRemotes(activeRepoPath) : null,
        ]);

        if (cancelled) return;

        if (statusResult && statusResult.success) {
          dispatch({ type: 'GIT_SET_STATUS', status: statusResult.data });
        }
        if (branchesResult && branchesResult.success) {
          dispatch({ type: 'GIT_SET_BRANCHES', branches: branchesResult.data });
        }
        if (currentBranchResult && currentBranchResult.success) {
          dispatch({ type: 'GIT_SET_CURRENT_BRANCH', branch: currentBranchResult.data });
        }
        if (logResult && logResult.success) {
          dispatch({ type: 'GIT_SET_LOG', log: logResult.data });
        }
        if (remotesResult && remotesResult.success) {
          dispatch({ type: 'GIT_SET_REMOTES', remotes: remotesResult.data });
        }
        dispatch({ type: 'GIT_SET_ERROR', error: null });
      } catch (err) {
        console.error('GitPage: failed to load git data', err);
        if (!cancelled) {
          dispatch({ type: 'GIT_SET_ERROR', error: err.message || 'Failed to load git data' });
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: 'GIT_SET_LOADING', value: false });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeRepoPath, dispatch]);

  // Re-fetch all git data (used after commits, pushes, etc.)
  const refreshGitData = useCallback(async () => {
    if (!activeRepoPath) return;
    const api = window.electronAPI;
    if (!api) return;

    try {
      const [statusResult, branchesResult, currentBranchResult, logResult, remotesResult] = await Promise.all([
        api.gitStatus ? api.gitStatus(activeRepoPath) : null,
        api.gitBranches ? api.gitBranches(activeRepoPath) : null,
        api.gitCurrentBranch ? api.gitCurrentBranch(activeRepoPath) : null,
        api.gitLog ? api.gitLog(activeRepoPath) : null,
        api.gitRemotes ? api.gitRemotes(activeRepoPath) : null,
      ]);

      if (statusResult && statusResult.success) {
        dispatch({ type: 'GIT_SET_STATUS', status: statusResult.data });
      }
      if (branchesResult && branchesResult.success) {
        dispatch({ type: 'GIT_SET_BRANCHES', branches: branchesResult.data });
      }
      if (currentBranchResult && currentBranchResult.success) {
        dispatch({ type: 'GIT_SET_CURRENT_BRANCH', branch: currentBranchResult.data });
      }
      if (logResult && logResult.success) {
        dispatch({ type: 'GIT_SET_LOG', log: logResult.data });
      }
      if (remotesResult && remotesResult.success) {
        dispatch({ type: 'GIT_SET_REMOTES', remotes: remotesResult.data });
      }
      dispatch({ type: 'GIT_SET_ERROR', error: null });
    } catch (err) {
      console.error('GitPage: refreshGitData failed', err);
    }
  }, [activeRepoPath, dispatch]);

  // Auto-fetch diff when a file is pre-selected (e.g. via GIT_NAVIGATE_TO_FILE)
  useEffect(() => {
    if (!gitSelectedFile || !gitStatus || !activeRepoPath) return;
    if (autoFetchedFileRef.current === gitSelectedFile) return;

    autoFetchedFileRef.current = gitSelectedFile;
    const api = window.electronAPI;
    if (!api || !api.gitDiffFile) return;

    const isStaged = gitStatus.staged?.some(f => f.path === gitSelectedFile);

    (async () => {
      try {
        const result = await api.gitDiffFile(activeRepoPath, gitSelectedFile, isStaged);
        if (result && result.success) {
          dispatch({ type: 'GIT_SET_DIFF', diff: result.data });
        }
      } catch (_) {}
    })();
  }, [gitSelectedFile, gitStatus, activeRepoPath, dispatch]);

  // Poll git status every 3 seconds while the active repo is set.
  useEffect(() => {
    if (!activeRepoPath) return;
    const interval = setInterval(async () => {
      const api = window.electronAPI;
      if (!api) return;
      try {
        const statusResult = await api.gitStatus(activeRepoPath);
        if (statusResult && statusResult.success) {
          dispatch({ type: 'GIT_SET_STATUS', status: statusResult.data });
        }
      } catch (_) {}
    }, 3000);
    return () => clearInterval(interval);
  }, [activeRepoPath, dispatch]);

  // Keyboard shortcut: Ctrl+Enter to focus commit input
  useEffect(() => {
    if (!activeRepoPath) return;
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const commitInput = document.querySelector('.git-manager-commit-input');
        if (commitInput) {
          commitInput.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeRepoPath]);

  // "Set Project" button handler — opens folder picker, persists per-dashboard.
  const handleSetProject = useCallback(async () => {
    try {
      const api = window.electronAPI;
      if (!api || !api.ideSelectFolder) {
        console.error('GitPage: ideSelectFolder not available');
        return;
      }
      const folderPath = await api.ideSelectFolder();
      if (!folderPath) return;
      const pathStr = typeof folderPath === 'string' ? folderPath : folderPath.path;
      if (!pathStr || !currentDashboardId) return;
      saveDashboardProject(currentDashboardId, pathStr);
      dispatch({ type: 'SET', key: 'gitError', value: null });
    } catch (err) {
      console.error('GitPage: handleSetProject failed', err);
    }
  }, [currentDashboardId, dispatch]);

  // Draggable divider handlers
  const handleDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    dragRef.current.startX = e.clientX;
    dragRef.current.startWidth = sidebarWidth;
    setIsDragging(true);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const delta = e.clientX - dragRef.current.startX;
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, dragRef.current.startWidth + delta)
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add('git-manager-dragging');

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('git-manager-dragging');
    };
  }, [isDragging]);

  // Callback for InitFlow — when git init succeeds on the project root, re-discover.
  const handleInitComplete = useCallback(async () => {
    if (!projectPath) return;
    const api = window.electronAPI;
    if (!api || !api.gitDiscoverRepos) return;
    try {
      const result = await api.gitDiscoverRepos(projectPath);
      if (result && result.success && Array.isArray(result.data)) {
        setDiscoveredRepos(result.data);
        if (result.data[0]) {
          setActiveRepoPath(result.data[0].path);
          if (currentDashboardId) {
            saveDashboardActiveRepo(currentDashboardId, result.data[0].path);
          }
        }
      }
    } catch (_) {}
  }, [projectPath, currentDashboardId]);

  // Empty state: no dashboard selected
  if (!currentDashboardId) {
    return (
      <div className="git-manager-view">
        <div className="git-manager-main">
          <div className="git-manager-content">
            <div className="git-manager-content-body">
              <div className="git-manager-empty-state">
                <GitRepoIcon />
                <div className="git-manager-empty-title">Select or create a dashboard</div>
                <div className="git-manager-empty-message">
                  Open a dashboard to manage its project's git repository.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Empty state: dashboard has no project bound
  if (!projectPath) {
    return (
      <div className="git-manager-view">
        <div className="git-manager-main">
          <div className="git-manager-content">
            <div className="git-manager-content-body">
              <div className="git-manager-empty-state">
                <GitRepoIcon />
                <div className="git-manager-empty-title">Set a project for this dashboard</div>
                <div className="git-manager-empty-message">
                  Choose a folder to use as this dashboard's project. Git operations will run against that folder.
                </div>
                <button
                  type="button"
                  className="git-manager-set-project-btn"
                  onClick={handleSetProject}
                >
                  Set Project
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // While discovering, show a loading state
  if (discovering) {
    return (
      <div className="git-manager-view">
        <div className="git-manager-main">
          <div className="git-manager-content">
            <div className="git-manager-content-body">
              <div className="git-manager-loading">
                <GitSpinnerIcon />
                Scanning for repositories...
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No git repos found anywhere under the project — offer to init the root.
  if (discoveredRepos.length === 0) {
    return (
      <div className="git-manager-view">
        <div className="git-manager-main">
          <div className="git-manager-content">
            <div className="git-manager-content-body">
              <InitFlow
                repoPath={projectPath}
                repoName={projectName}
                onInitComplete={handleInitComplete}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-manager-view">
      {discoveredRepos.length > 0 && (
        <RepoTabs
          repos={discoveredRepos}
          activeRepoPath={activeRepoPath}
          projectPath={projectPath}
          currentBranch={gitCurrentBranch}
          onSwitch={handleSwitchRepo}
        />
      )}

      <div className="git-manager-main">
        <div
          className="git-manager-sidebar"
          style={{ width: sidebarWidth }}
        >
          <div className="git-manager-sidebar-scroll">
            <ChangesPanel repoPath={activeRepoPath} />
          </div>
          <CommitPanel repoPath={activeRepoPath} onCommitComplete={refreshGitData} />
        </div>

        <div
          className={`git-manager-divider${isDragging ? ' dragging' : ''}`}
          onMouseDown={handleDividerMouseDown}
        />

        <div className="git-manager-content">
          <div className="git-manager-content-tabs">
            <button
              className={`git-manager-content-tab${contentTab === 'changes' ? ' active' : ''}`}
              onClick={() => setContentTab('changes')}
            >
              <span className="git-manager-content-tab-icon">
                <DiffIcon />
              </span>
              Changes
            </button>
            <button
              className={`git-manager-content-tab${contentTab === 'history' ? ' active' : ''}`}
              onClick={() => setContentTab('history')}
            >
              <span className="git-manager-content-tab-icon">
                <HistoryIcon />
              </span>
              History
            </button>
            <button
              className={`git-manager-content-tab${contentTab === 'branches' ? ' active' : ''}`}
              onClick={() => setContentTab('branches')}
            >
              <span className="git-manager-content-tab-icon">
                <BranchIcon />
              </span>
              Branches
            </button>
          </div>
          <div className="git-manager-content-body">
            {contentTab === 'changes' && <DiffViewer />}
            {contentTab === 'history' && <HistoryPanel repoPath={activeRepoPath} />}
            {contentTab === 'branches' && <BranchPanel repoPath={activeRepoPath} />}
          </div>
        </div>
      </div>

      <RemotePanel repoPath={activeRepoPath} />
      <QuickActions repoPath={activeRepoPath} />
    </div>
  );
}

// ── Repo Tabs ─────────────────────────────────────────────────
// Horizontal tab bar listing every discovered repo. Clicking a tab
// swaps the active repo. Each tab shows the repo's relative path
// (or name if it's the root) and the current branch on the active tab.

function RepoTabs({ repos, activeRepoPath, projectPath, currentBranch, onSwitch }) {
  if (!repos || repos.length === 0) return null;
  return (
    <div className="git-manager-repo-tabs" role="tablist">
      {repos.map(repo => {
        const active = repo.path === activeRepoPath;
        const label = repoLabel(repo, projectPath);
        return (
          <button
            key={repo.path}
            type="button"
            role="tab"
            aria-selected={active}
            className={`git-manager-repo-tab${active ? ' active' : ''}${repo.isRoot ? ' is-root' : ''}`}
            onClick={() => onSwitch(repo.path)}
            title={repo.path}
          >
            <span className="git-manager-repo-tab-icon">
              <RepoIcon />
            </span>
            <span className="git-manager-repo-tab-label">{label}</span>
            {active && currentBranch && (
              <span className="git-manager-repo-tab-branch">
                <BranchIcon />
                {currentBranch}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────

function GitSpinnerIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="25 25" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function DiffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4h4M3 8h10M3 12h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12 3v4M10 5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="12" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 6v4M9 6.5C7.5 7 5 8 5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function RepoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.5 2.5h9a1 1 0 0 1 1 1V13l-2-1.5L8.5 13l-2-1.5L4.5 13l-2-1.5V3.5a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 5h5M5.5 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function GitRepoIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="14" r="5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="24" cy="34" r="5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="36" cy="22" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M24 19v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M31.5 23C28 24 24 27 24 29" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
