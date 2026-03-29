// GitManagerView — main Git Manager layout component
// Assembles RepoTabs, sidebar (ChangesPanel + CommitPanel), content area
// (DiffViewer / HistoryPanel / BranchPanel), and QuickActions.
// Follows the IDEView.jsx container pattern with resizable sidebar.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import RepoTabs from './RepoTabs.jsx';
import GitWelcome from './GitWelcome.jsx';
import InitFlow from './InitFlow.jsx';
import ChangesPanel from './ChangesPanel.jsx';
import DiffViewer from './DiffViewer.jsx';
import CommitPanel from './CommitPanel.jsx';
import RemotePanel from './RemotePanel.jsx';
import BranchPanel from './BranchPanel.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import QuickActions from './QuickActions.jsx';
import '../../styles/git-manager.css';

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 300;

export default function GitManagerView() {
  const {
    gitRepos,
    gitActiveRepoId,
    gitStatus,
    gitBranches,
    gitCurrentBranch,
    gitLog,
    gitDiff,
    gitRemotes,
    gitLoading,
    gitError,
    gitSelectedFile,
  } = useAppState();
  const dispatch = useDispatch();

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(null); // null = unknown, true/false
  const [checkingRepo, setCheckingRepo] = useState(false);
  const [contentTab, setContentTab] = useState('changes');
  const dragRef = useRef({ startX: 0, startWidth: 0 });
  const autoFetchedFileRef = useRef(null);

  // Derive current repo
  const activeRepo = gitRepos.find(r => r.id === gitActiveRepoId) || null;
  const hasRepos = gitRepos.length > 0;

  // Check whether the active repo has a .git directory
  useEffect(() => {
    if (!activeRepo) {
      setIsGitRepo(null);
      return;
    }

    let cancelled = false;
    setCheckingRepo(true);

    (async () => {
      try {
        const api = window.electronAPI;
        if (api && api.gitIsRepo) {
          const result = await api.gitIsRepo(activeRepo.path);
          if (!cancelled) {
            setIsGitRepo(result && result.success ? result.data : false);
            setCheckingRepo(false);
          }
        } else {
          if (!cancelled) {
            setIsGitRepo(false);
            setCheckingRepo(false);
          }
        }
      } catch (err) {
        console.error('GitManagerView: failed to check git repo', err);
        if (!cancelled) {
          setIsGitRepo(false);
          setCheckingRepo(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeRepo]);

  // Load git data when active repo changes and is a valid repo
  useEffect(() => {
    if (!activeRepo || !isGitRepo) return;

    let cancelled = false;
    const api = window.electronAPI;
    if (!api) return;

    dispatch({ type: 'GIT_SET_LOADING', value: true });

    (async () => {
      try {
        // Fetch status, branches, log, and remotes in parallel
        const [statusResult, branchesResult, currentBranchResult, logResult, remotesResult] = await Promise.all([
          api.gitStatus ? api.gitStatus(activeRepo.path) : null,
          api.gitBranches ? api.gitBranches(activeRepo.path) : null,
          api.gitCurrentBranch ? api.gitCurrentBranch(activeRepo.path) : null,
          api.gitLog ? api.gitLog(activeRepo.path) : null,
          api.gitRemotes ? api.gitRemotes(activeRepo.path) : null,
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
        console.error('GitManagerView: failed to load git data', err);
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
  }, [activeRepo, isGitRepo, dispatch]);

  // Re-fetch all git data (used after commits, pushes, etc.)
  const refreshGitData = useCallback(async () => {
    if (!activeRepo || !isGitRepo) return;
    const api = window.electronAPI;
    if (!api) return;

    try {
      const [statusResult, branchesResult, currentBranchResult, logResult, remotesResult] = await Promise.all([
        api.gitStatus ? api.gitStatus(activeRepo.path) : null,
        api.gitBranches ? api.gitBranches(activeRepo.path) : null,
        api.gitCurrentBranch ? api.gitCurrentBranch(activeRepo.path) : null,
        api.gitLog ? api.gitLog(activeRepo.path) : null,
        api.gitRemotes ? api.gitRemotes(activeRepo.path) : null,
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
      console.error('GitManagerView: refreshGitData failed', err);
    }
  }, [activeRepo, isGitRepo, dispatch]);

  // Auto-fetch diff when a file is pre-selected (e.g. via GIT_NAVIGATE_TO_FILE)
  // Only fires once per selected file — manual clicks in ChangesPanel handle their own diff fetch.
  useEffect(() => {
    if (!gitSelectedFile || !gitStatus || !activeRepo) return;
    if (autoFetchedFileRef.current === gitSelectedFile) return;

    autoFetchedFileRef.current = gitSelectedFile;
    const api = window.electronAPI;
    if (!api || !api.gitDiffFile) return;

    const isStaged = gitStatus.staged?.some(f => f.path === gitSelectedFile);

    (async () => {
      try {
        const result = await api.gitDiffFile(activeRepo.path, gitSelectedFile, isStaged);
        if (result && result.success) {
          dispatch({ type: 'GIT_SET_DIFF', diff: result.data });
        }
      } catch (_) {}
    })();
  }, [gitSelectedFile, gitStatus, activeRepo, dispatch]);

  // Poll git status every 3 seconds while the view is active
  useEffect(() => {
    if (!activeRepo || !isGitRepo) return;
    const interval = setInterval(async () => {
      const api = window.electronAPI;
      if (!api) return;
      try {
        const statusResult = await api.gitStatus(activeRepo.path);
        if (statusResult && statusResult.success) {
          dispatch({ type: 'GIT_SET_STATUS', status: statusResult.data });
        }
      } catch (_) {}
    }, 3000);
    return () => clearInterval(interval);
  }, [activeRepo, isGitRepo, dispatch]);

  // Keyboard shortcut: Ctrl+Enter to focus commit (bubbles to CommitPanel)
  useEffect(() => {
    if (!activeRepo || !isGitRepo) return;
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
  }, [activeRepo, isGitRepo]);

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

  // Callback for InitFlow — when git init succeeds, re-check the repo
  const handleInitComplete = useCallback(() => {
    setIsGitRepo(true);
  }, []);

  // When no repos are open, show the welcome screen
  if (!hasRepos) {
    return (
      <div className="git-manager-view">
        <GitWelcome />
      </div>
    );
  }

  // While checking if the folder is a git repo, show a loading state
  if (checkingRepo || isGitRepo === null) {
    return (
      <div className="git-manager-view">
        <RepoTabs />
        <div className="git-manager-main">
          <div className="git-manager-content">
            <div className="git-manager-content-body">
              <div className="git-manager-loading">
                <GitSpinnerIcon />
                Checking repository...
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not a git repo — show init flow
  if (!isGitRepo) {
    return (
      <div className="git-manager-view">
        <RepoTabs />
        <div className="git-manager-main">
          <div className="git-manager-content">
            <div className="git-manager-content-body">
              <InitFlow
                repoPath={activeRepo.path}
                repoName={activeRepo.name}
                onInitComplete={handleInitComplete}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active git repo — show the full layout with panel slots
  return (
    <div className="git-manager-view">
      <RepoTabs />
      <div className="git-manager-main">
        <div
          className="git-manager-sidebar"
          style={{ width: sidebarWidth }}
        >
          <div className="git-manager-sidebar-scroll">
            <ChangesPanel repoPath={activeRepo.path} />
          </div>
          <CommitPanel repoPath={activeRepo.path} onCommitComplete={refreshGitData} />
        </div>

        {/* Draggable Divider */}
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
            {contentTab === 'history' && <HistoryPanel repoPath={activeRepo.path} />}
            {contentTab === 'branches' && <BranchPanel repoPath={activeRepo.path} />}
          </div>
        </div>
      </div>

      <RemotePanel repoPath={activeRepo.path} />
      <QuickActions repoPath={activeRepo.path} />
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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="12" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 6v4M9 6.5C7.5 7 5 8 5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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
