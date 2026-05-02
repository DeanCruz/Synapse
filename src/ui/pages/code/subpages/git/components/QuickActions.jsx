// QuickActions — Large, friendly one-click git operations for non-coders.
// Provides card-style buttons: Save My Work, Move Changes to New Branch,
// Undo Last Commit, Discard All Changes, Update from Remote, Share My Changes,
// Stash, Pop Stash, Fetch, Sync (Pull+Push).
// Clicking the Quick Actions bar opens a centered modal popup.
// Every destructive action shows a confirmation dialog via SafetyDialogs.

import React, { useState, useCallback, useEffect } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import { ConfirmDialog, DoubleConfirmDialog } from './SafetyDialogs.jsx';

// ── Helper: generate a smart auto-commit message ───────────────

function generateCommitMessage(status) {
  if (!status) return 'Update files';

  const allFiles = [
    ...(status.staged || []),
    ...(status.unstaged || []),
    ...(status.untracked || []),
  ];

  if (allFiles.length === 0) return 'Update files';

  // Extract just the file names (last path segment)
  const fileNames = allFiles.map(f => {
    const path = typeof f === 'string' ? f : (f.path || f.file || '');
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  }).filter(Boolean);

  // Deduplicate
  const unique = [...new Set(fileNames)];

  if (unique.length === 0) return 'Update files';
  if (unique.length === 1) return `Update ${unique[0]}`;
  if (unique.length === 2) return `Update ${unique[0]} and ${unique[1]}`;
  if (unique.length === 3) return `Update ${unique[0]}, ${unique[1]}, and ${unique[2]}`;
  // 4+ files — name first two, count the rest
  const remaining = unique.length - 2;
  return `Update ${unique[0]}, ${unique[1]}, and ${remaining} other file${remaining !== 1 ? 's' : ''}`;
}

// ── Helper: get the list of affected file paths for dialogs ────

function getAffectedFiles(status) {
  if (!status) return [];
  const files = [];
  (status.staged || []).forEach(f => {
    const path = typeof f === 'string' ? f : (f.path || f.file || '');
    if (path) files.push(path);
  });
  (status.unstaged || []).forEach(f => {
    const path = typeof f === 'string' ? f : (f.path || f.file || '');
    if (path) files.push(path);
  });
  (status.untracked || []).forEach(f => {
    const path = typeof f === 'string' ? f : (f.path || f.file || '');
    if (path) files.push(path);
  });
  return [...new Set(files)];
}

// ── Helper: refresh all git state after an operation ───────────

async function refreshGitData(api, repoPath, dispatch) {
  try {
    const [statusResult, branchesResult, currentBranchResult, logResult] = await Promise.all([
      api.gitStatus ? api.gitStatus(repoPath) : null,
      api.gitBranches ? api.gitBranches(repoPath) : null,
      api.gitCurrentBranch ? api.gitCurrentBranch(repoPath) : null,
      api.gitLog ? api.gitLog(repoPath) : null,
    ]);
    if (statusResult && statusResult.success) dispatch({ type: 'GIT_SET_STATUS', status: statusResult.data });
    if (branchesResult && branchesResult.success) dispatch({ type: 'GIT_SET_BRANCHES', branches: branchesResult.data });
    if (currentBranchResult && currentBranchResult.success) dispatch({ type: 'GIT_SET_CURRENT_BRANCH', branch: currentBranchResult.data });
    if (logResult && logResult.success) dispatch({ type: 'GIT_SET_LOG', log: logResult.data });
  } catch (err) {
    console.error('QuickActions: failed to refresh git data', err);
  }
}

// ── SVG Icons for each quick action ────────────────────────────

function SaveIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M5 3h11l5 5v11a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 3v5h8V3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="6" y="13" width="12" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function MoveBranchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="7" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8.5v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14.5 10.5C12 11.5 7 13 7 15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M3 7h13a5 5 0 010 10H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 3L3 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DiscardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 7v12a2 2 0 002 2h8a2 2 0 002-2V7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 4h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 11v5M14 11v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PullIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 13l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 17V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StashIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="10" width="16" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="16" width="16" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function StashPopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="12" width="16" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="18" width="16" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 9V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FetchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="19" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M17 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11V9a4 4 0 014-4h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 22l-4-4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 13v2a4 4 0 01-4 4H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── QuickActions component ─────────────────────────────────────

export default function QuickActions({ repoPath }) {
  const { gitStatus, gitCurrentBranch, gitRemotes, gitLog } = useAppState();
  const dispatch = useDispatch();

  // Dialog states
  const [activeDialog, setActiveDialog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const api = window.electronAPI;
  const hasRemotes = gitRemotes && gitRemotes.length > 0;
  const hasChanges = gitStatus && (
    (gitStatus.staged && gitStatus.staged.length > 0) ||
    (gitStatus.unstaged && gitStatus.unstaged.length > 0) ||
    (gitStatus.untracked && gitStatus.untracked.length > 0)
  );
  const hasCommits = gitLog && gitLog.length > 0;

  // Clear success message after a delay
  const showSuccess = useCallback((msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  }, []);

  // ── Save My Work (stage all + commit with auto message) ──────

  const handleSaveConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const freshStatus = await api.gitStatus(repoPath);
      const statusData = freshStatus?.success ? freshStatus.data : gitStatus;
      const hasAnyChanges = statusData && (
        (statusData.staged?.length > 0) ||
        (statusData.unstaged?.length > 0) ||
        (statusData.untracked?.length > 0)
      );
      if (!hasAnyChanges) {
        throw new Error('No changes to save — working directory is clean');
      }

      const stageResult = await api.gitStageAll(repoPath);
      if (!stageResult || !stageResult.success) {
        throw new Error(stageResult?.error || 'Failed to stage files');
      }

      const commitMessage = generateCommitMessage(statusData);
      const commitResult = await api.gitCommit(repoPath, commitMessage);
      if (!commitResult || !commitResult.success) {
        throw new Error(commitResult?.error || 'Failed to commit');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('Work saved successfully!');
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, gitStatus, dispatch, showSuccess]);

  // ── Move Changes to New Branch ───────────────────────────────

  const handleMoveBranchConfirm = useCallback(async () => {
    if (!api || !repoPath || !branchName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const stashResult = await api.gitStash(repoPath);
      if (!stashResult || !stashResult.success) {
        throw new Error(stashResult?.error || 'Failed to stash changes');
      }

      const branchResult = await api.gitCreateBranch(repoPath, branchName.trim());
      if (!branchResult || !branchResult.success) {
        await api.gitStashPop(repoPath).catch(() => {});
        throw new Error(branchResult?.error || 'Failed to create branch');
      }

      const popResult = await api.gitStashPop(repoPath);
      if (!popResult || !popResult.success) {
        console.warn('QuickActions: stash pop failed after branch create', popResult?.error);
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      setBranchName('');
      showSuccess(`Moved changes to branch "${branchName.trim()}"`);
    } catch (err) {
      setError(err.message || 'Move to branch failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, branchName, dispatch, showSuccess]);

  // ── Undo Last Commit (soft reset) ────────────────────────────

  const handleUndoCommitConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitReset(repoPath, 'HEAD~1', 'soft');
      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to undo last commit');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('Last commit undone — your changes are preserved');
    } catch (err) {
      setError(err.message || 'Undo failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, dispatch, showSuccess]);

  // ── Discard All Changes (hard reset — double confirm) ────────

  const handleDiscardConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitReset(repoPath, 'HEAD', 'hard');
      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to discard changes');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('All changes discarded');
    } catch (err) {
      setError(err.message || 'Discard failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, dispatch, showSuccess]);

  // ── Update from Remote (pull) ────────────────────────────────

  const handlePullConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitPull(repoPath);
      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to pull');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('Updated from remote successfully');
    } catch (err) {
      setError(err.message || 'Pull failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, dispatch, showSuccess]);

  // ── Share My Changes (push) ──────────────────────────────────

  const handlePushConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitPush(repoPath);
      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to push');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('Changes shared to remote');
    } catch (err) {
      setError(err.message || 'Push failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, dispatch, showSuccess]);

  // ── Stash Changes ────────────────────────────────────────────

  const handleStashConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitStash(repoPath);
      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to stash changes');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('Changes stashed successfully');
    } catch (err) {
      setError(err.message || 'Stash failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, dispatch, showSuccess]);

  // ── Pop Stash ────────────────────────────────────────────────

  const handleStashPopConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitStashPop(repoPath);
      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to pop stash — stash may be empty');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('Stash restored successfully');
    } catch (err) {
      setError(err.message || 'Pop stash failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, dispatch, showSuccess]);

  // ── Fetch Remote ─────────────────────────────────────────────

  const handleFetchConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitFetch(repoPath);
      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to fetch');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('Fetched from remote successfully');
    } catch (err) {
      setError(err.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, dispatch, showSuccess]);

  // ── Sync (Pull then Push) ────────────────────────────────────

  const handleSyncConfirm = useCallback(async () => {
    if (!api || !repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const pullResult = await api.gitPull(repoPath);
      if (!pullResult || !pullResult.success) {
        throw new Error(pullResult?.error || 'Failed to pull during sync');
      }

      const pushResult = await api.gitPush(repoPath);
      if (!pushResult || !pushResult.success) {
        throw new Error(pushResult?.error || 'Pull succeeded but push failed');
      }

      await refreshGitData(api, repoPath, dispatch);
      setActiveDialog(null);
      showSuccess('Synced with remote — pulled and pushed');
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setLoading(false);
    }
  }, [api, repoPath, dispatch, showSuccess]);

  // ── Close any open dialog ────────────────────────────────────

  const handleCloseDialog = useCallback(() => {
    setActiveDialog(null);
    setError(null);
    setBranchName('');
    setLoading(false);
  }, []);

  // ── Open action from modal ───────────────────────────────────

  const openAction = useCallback((actionId) => {
    setError(null);
    setActiveDialog(actionId);
    setModalOpen(false);
  }, []);

  // ── Close modal on Escape ────────────────────────────────────

  useEffect(() => {
    if (!modalOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setModalOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modalOpen]);

  // ── Define the quick action cards ────────────────────────────

  const lastCommitMsg = hasCommits ? (gitLog[0]?.message || 'Unknown') : '';
  const affectedFiles = getAffectedFiles(gitStatus);
  const commitMsg = generateCommitMessage(gitStatus);

  const actions = [
    // Common
    {
      id: 'save',
      title: 'Save My Work',
      description: 'Stage all changes and commit with a smart message',
      icon: SaveIcon,
      variant: 'primary',
      category: 'common',
      disabled: !hasChanges,
      disabledReason: 'No changes to save',
    },
    {
      id: 'pull',
      title: 'Update from Remote',
      description: 'Pull the latest changes from the remote repository',
      icon: PullIcon,
      variant: 'success',
      category: 'common',
      disabled: !hasRemotes,
      disabledReason: 'No remote configured',
    },
    {
      id: 'push',
      title: 'Share My Changes',
      description: 'Push your committed changes to the remote repository',
      icon: PushIcon,
      variant: 'primary',
      category: 'common',
      disabled: !hasRemotes || !hasCommits,
      disabledReason: !hasRemotes ? 'No remote configured' : 'No commits to share',
    },
    // Remote
    {
      id: 'fetch',
      title: 'Fetch Remote',
      description: 'Download remote changes without merging them',
      icon: FetchIcon,
      variant: 'success',
      category: 'remote',
      disabled: !hasRemotes,
      disabledReason: 'No remote configured',
    },
    {
      id: 'sync',
      title: 'Sync',
      description: 'Pull latest changes then push your commits in one step',
      icon: SyncIcon,
      variant: 'success',
      category: 'remote',
      disabled: !hasRemotes,
      disabledReason: 'No remote configured',
    },
    // Branch & Stash
    {
      id: 'moveBranch',
      title: 'Move to New Branch',
      description: 'Stash changes, create a new branch, and apply them there',
      icon: MoveBranchIcon,
      variant: 'warning',
      category: 'branch',
      disabled: !hasChanges,
      disabledReason: 'No changes to move',
    },
    {
      id: 'stash',
      title: 'Stash Changes',
      description: 'Temporarily save your work in progress for later',
      icon: StashIcon,
      variant: 'warning',
      category: 'branch',
      disabled: !hasChanges,
      disabledReason: 'No changes to stash',
    },
    {
      id: 'stashPop',
      title: 'Pop Stash',
      description: 'Restore the most recently stashed changes',
      icon: StashPopIcon,
      variant: 'warning',
      category: 'branch',
      disabled: false,
      disabledReason: '',
    },
    // Undo / Reset
    {
      id: 'undoCommit',
      title: 'Undo Last Commit',
      description: 'Undo the last commit but keep your changes intact',
      icon: UndoIcon,
      variant: 'warning',
      category: 'undo',
      disabled: !hasCommits,
      disabledReason: 'No commits to undo',
    },
    {
      id: 'discardAll',
      title: 'Discard All Changes',
      description: 'Permanently delete all uncommitted changes — cannot be undone',
      icon: DiscardIcon,
      variant: 'danger',
      category: 'undo',
      disabled: !hasChanges,
      disabledReason: 'No changes to discard',
    },
  ];

  const categoryLabels = {
    common: 'Common',
    remote: 'Remote',
    branch: 'Branch & Stash',
    undo: 'Undo / Reset',
  };

  const categories = ['common', 'remote', 'branch', 'undo'];

  return (
    <div className="git-manager-quick-actions-bar">
      {/* Clickable bar — opens centered modal */}
      <button
        className="git-manager-qa-bar-btn"
        onClick={() => setModalOpen(true)}
      >
        <div className="git-manager-qa-bar-left">
          <span className="git-manager-qa-bar-label">Quick Actions</span>
          {gitCurrentBranch && (
            <span className="git-manager-qa-bar-branch">
              <BranchSmallIcon />
              {gitCurrentBranch}
            </span>
          )}
        </div>
        <div className="git-manager-qa-bar-right-hint">
          <ChevronIcon open={false} />
        </div>
      </button>

      {/* Success toast (inline) */}
      {successMessage && (
        <div className="git-manager-qa-bar-toast success">
          <SuccessCheckIcon />
          {successMessage}
        </div>
      )}

      {/* ── Centered Modal Popup ─────────────────────────────────── */}
      {modalOpen && (
        <div className="git-manager-qa-modal-overlay" onClick={() => setModalOpen(false)}>
          <div
            className="git-manager-qa-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Quick Actions"
          >
            <div className="git-manager-qa-modal-header">
              <div className="git-manager-qa-modal-title">Quick Actions</div>
              {gitCurrentBranch && (
                <span className="git-manager-qa-modal-branch">
                  <BranchSmallIcon />
                  {gitCurrentBranch}
                </span>
              )}
              <button
                className="git-manager-qa-modal-close"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="git-manager-qa-modal-body">
              {categories.map(cat => {
                const catActions = actions.filter(a => a.category === cat);
                if (catActions.length === 0) return null;
                return (
                  <div key={cat} className="git-manager-qa-modal-category">
                    <div className="git-manager-qa-modal-category-label">
                      {categoryLabels[cat]}
                    </div>
                    <div className="git-manager-qa-modal-grid">
                      {catActions.map(action => {
                        const Icon = action.icon;
                        return (
                          <button
                            key={action.id}
                            className={`git-manager-qa-modal-card ${action.variant}${action.disabled ? ' disabled' : ''}`}
                            onClick={() => {
                              if (!action.disabled) openAction(action.id);
                            }}
                            disabled={action.disabled}
                            title={action.disabled ? action.disabledReason : undefined}
                          >
                            <span className={`git-manager-qa-modal-card-icon ${action.variant}`}>
                              <Icon />
                            </span>
                            <span className="git-manager-qa-modal-card-text">
                              <span className="git-manager-qa-modal-card-title">{action.title}</span>
                              <span className="git-manager-qa-modal-card-desc">{action.description}</span>
                            </span>
                            {action.disabled && (
                              <span className="git-manager-qa-modal-card-badge">n/a</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation Dialogs ────────────────────────────────── */}

      {/* Save My Work */}
      <ConfirmDialog
        isOpen={activeDialog === 'save'}
        title="Save My Work"
        message={`This will stage all changes and commit them with the message: "${commitMsg}"`}
        dangerLevel="safe"
        confirmLabel="Save"
        affectedItems={affectedFiles.length > 0 ? affectedFiles : undefined}
        loading={loading}
        onConfirm={handleSaveConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Move Changes to New Branch */}
      {activeDialog === 'moveBranch' && (
        <div className="git-manager-dialog-overlay" onClick={handleCloseDialog}>
          <div
            className="git-manager-dialog warning"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Move Changes to New Branch"
          >
            <div className="git-manager-dialog-header">
              <div className="git-manager-dialog-icon">
                <MoveBranchIcon />
              </div>
              <div className="git-manager-dialog-title">Move Changes to New Branch</div>
            </div>
            <div className="git-manager-dialog-body">
              <div>Your current changes will be moved to a new branch. The current branch will be left clean.</div>
              <div className="git-manager-quick-action-branch-input-wrap">
                <label className="git-manager-quick-action-branch-label">Branch name</label>
                <input
                  className="git-manager-quick-action-branch-input"
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feature/my-new-branch"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && branchName.trim()) handleMoveBranchConfirm();
                    if (e.key === 'Escape') handleCloseDialog();
                  }}
                />
              </div>
              {error && <div className="git-manager-quick-action-error">{error}</div>}
            </div>
            <div className="git-manager-dialog-footer">
              <button
                className="git-manager-dialog-btn cancel"
                onClick={handleCloseDialog}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="git-manager-dialog-btn confirm-warning"
                onClick={handleMoveBranchConfirm}
                disabled={loading || !branchName.trim()}
              >
                {loading && (
                  <span className="git-manager-spinner sm">
                    <span className="git-manager-spinner-circle" />
                  </span>
                )}
                Move to Branch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo Last Commit */}
      <ConfirmDialog
        isOpen={activeDialog === 'undoCommit'}
        title="Undo Last Commit"
        message={`This will undo the last commit ("${lastCommitMsg.length > 60 ? lastCommitMsg.substring(0, 60) + '...' : lastCommitMsg}") using a soft reset. Your changes will NOT be lost — they will appear as unstaged changes.`}
        dangerLevel="warning"
        confirmLabel="Undo Commit"
        loading={loading}
        onConfirm={handleUndoCommitConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Discard All Changes — DOUBLE confirmation */}
      <DoubleConfirmDialog
        isOpen={activeDialog === 'discardAll'}
        title="Discard All Changes"
        message="This will permanently delete ALL uncommitted changes in your working directory. This cannot be undone."
        secondTitle="This is irreversible!"
        secondMessage={`You are about to permanently delete ${affectedFiles.length} file change${affectedFiles.length !== 1 ? 's' : ''}. Type DISCARD to confirm.`}
        dangerLevel="danger"
        confirmLabel="I understand, continue"
        secondConfirmLabel="Permanently Discard All"
        confirmText="DISCARD"
        affectedItems={affectedFiles.length > 0 ? affectedFiles : undefined}
        loading={loading}
        onConfirm={handleDiscardConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Update from Remote (Pull) */}
      <ConfirmDialog
        isOpen={activeDialog === 'pull'}
        title="Update from Remote"
        message="This will pull the latest changes from the remote repository and merge them into your current branch."
        dangerLevel="safe"
        confirmLabel="Pull Changes"
        loading={loading}
        onConfirm={handlePullConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Share My Changes (Push) */}
      <ConfirmDialog
        isOpen={activeDialog === 'push'}
        title="Share My Changes"
        message={`This will push your committed changes on branch "${gitCurrentBranch || 'current'}" to the remote repository.`}
        dangerLevel="safe"
        confirmLabel="Push Changes"
        loading={loading}
        onConfirm={handlePushConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Stash Changes */}
      <ConfirmDialog
        isOpen={activeDialog === 'stash'}
        title="Stash Changes"
        message="This will temporarily save all your current changes and revert to a clean working directory. You can restore them later with Pop Stash."
        dangerLevel="safe"
        confirmLabel="Stash"
        affectedItems={affectedFiles.length > 0 ? affectedFiles : undefined}
        loading={loading}
        onConfirm={handleStashConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Pop Stash */}
      <ConfirmDialog
        isOpen={activeDialog === 'stashPop'}
        title="Pop Stash"
        message="This will restore the most recently stashed changes and apply them to your working directory."
        dangerLevel="safe"
        confirmLabel="Pop Stash"
        loading={loading}
        onConfirm={handleStashPopConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Fetch Remote */}
      <ConfirmDialog
        isOpen={activeDialog === 'fetch'}
        title="Fetch Remote"
        message="This will download the latest changes from the remote repository without merging them. Your working directory will not be modified."
        dangerLevel="safe"
        confirmLabel="Fetch"
        loading={loading}
        onConfirm={handleFetchConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Sync (Pull + Push) */}
      <ConfirmDialog
        isOpen={activeDialog === 'sync'}
        title="Sync with Remote"
        message={`This will first pull the latest changes from remote, then push your commits on branch "${gitCurrentBranch || 'current'}". A two-step operation: pull → push.`}
        dangerLevel="safe"
        confirmLabel="Sync Now"
        loading={loading}
        onConfirm={handleSyncConfirm}
        onCancel={handleCloseDialog}
      />

      {/* Show inline error for non-dialog errors */}
      {error && activeDialog && activeDialog !== 'moveBranch' && (
        <div className="git-manager-qa-bar-toast error">
          <ErrorXIcon />
          {error}
        </div>
      )}
    </div>
  );
}

// ── Small inline SVG icons ─────────────────────────────────────

function ChevronIcon({ open }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 16 16" fill="none"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BranchSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M6 2v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 14v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 10c2 0 4-1 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <circle cx="6" cy="14" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="10" cy="5" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SuccessCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ErrorXIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
