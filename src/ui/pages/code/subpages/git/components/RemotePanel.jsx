// RemotePanel — push/pull/fetch operations with remote management
// Shows: current branch tracking info, ahead/behind counts, Push/Pull/Fetch
// buttons with loading spinners, remote selector if multiple remotes exist.
// Safety: warns on push to main/master, handles merge conflicts on pull,
// force push requires double confirmation.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/git-manager.css';

const PROTECTED_BRANCHES = ['main', 'master'];

export default function RemotePanel({ repoPath }) {
  const { gitCurrentBranch, gitRemotes, gitLoading } = useAppState();
  const dispatch = useDispatch();

  // Local state
  const [selectedRemote, setSelectedRemote] = useState('origin');
  const [aheadBehind, setAheadBehind] = useState({ ahead: 0, behind: 0, upstream: null });
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success'|'error'|'warning', text }
  const [confirmDialog, setConfirmDialog] = useState(null); // null | { type, message, onConfirm }
  const [forceConfirmStep, setForceConfirmStep] = useState(0); // 0 = none, 1 = first, 2 = second
  const resultTimeoutRef = useRef(null);

  const remoteList = Array.isArray(gitRemotes) ? gitRemotes : [];
  const hasRemotes = remoteList.length > 0;
  const isProtectedBranch = PROTECTED_BRANCHES.includes(gitCurrentBranch);
  const anyOperationRunning = pushing || pulling || fetching || gitLoading;

  // Fetch ahead/behind on mount and when branch/remotes change
  useEffect(() => {
    if (!repoPath || !gitCurrentBranch) return;

    let cancelled = false;
    const api = window.electronAPI;
    if (!api || !api.gitAheadBehind) return;

    (async () => {
      try {
        const result = await api.gitAheadBehind(repoPath, gitCurrentBranch);
        if (!cancelled && result && result.success) {
          setAheadBehind(result.data);
        }
      } catch (err) {
        // Silently fail — no upstream is okay
      }
    })();

    return () => { cancelled = true; };
  }, [repoPath, gitCurrentBranch, gitRemotes]);

  // Auto-select first remote
  useEffect(() => {
    if (remoteList.length > 0) {
      const hasOrigin = remoteList.some(r => r.name === 'origin');
      if (hasOrigin) {
        setSelectedRemote('origin');
      } else {
        setSelectedRemote(remoteList[0].name);
      }
    }
  }, [remoteList]);

  // Show result with auto-dismiss
  const showResult = useCallback((type, text) => {
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    setResult({ type, text });
    resultTimeoutRef.current = setTimeout(() => {
      setResult(null);
      resultTimeoutRef.current = null;
    }, 5000);
  }, []);

  // Refresh git data after remote operations
  const refreshAfterRemoteOp = useCallback(async () => {
    const api = window.electronAPI;
    if (!api || !repoPath) return;

    const refreshPromises = [];
    if (api.gitStatus) {
      refreshPromises.push(
        api.gitStatus(repoPath).then(r => {
          if (r && r.success) dispatch({ type: 'GIT_SET_STATUS', status: r.data });
        })
      );
    }
    if (api.gitLog) {
      refreshPromises.push(
        api.gitLog(repoPath).then(r => {
          if (r && r.success) dispatch({ type: 'GIT_SET_LOG', log: r.data });
        })
      );
    }
    if (api.gitAheadBehind) {
      refreshPromises.push(
        api.gitAheadBehind(repoPath, gitCurrentBranch).then(r => {
          if (r && r.success) setAheadBehind(r.data);
        })
      );
    }
    if (api.gitBranches) {
      refreshPromises.push(
        api.gitBranches(repoPath).then(r => {
          if (r && r.success) dispatch({ type: 'GIT_SET_BRANCHES', branches: r.data });
        })
      );
    }
    await Promise.all(refreshPromises);
  }, [repoPath, gitCurrentBranch, dispatch]);

  // ── Push ──────────────────────────────────────────────────────
  const executePush = useCallback(async (setUpstream = false) => {
    const api = window.electronAPI;
    if (!api || !api.gitPush || !repoPath) return;

    setPushing(true);
    setResult(null);

    try {
      const pushResult = await api.gitPush(repoPath, selectedRemote, gitCurrentBranch, setUpstream);
      if (pushResult && pushResult.success) {
        showResult('success', 'Push successful');
        await refreshAfterRemoteOp();
      } else {
        const errorMsg = (pushResult && pushResult.error) || 'Push failed';
        // Check if it's a non-fast-forward (needs pull first)
        if (errorMsg.includes('non-fast-forward') || errorMsg.includes('rejected')) {
          showResult('error', 'Push rejected — remote has changes. Pull first or force push.');
        } else if (errorMsg.includes('no upstream') || errorMsg.includes('no tracking')) {
          // Offer to set upstream
          setConfirmDialog({
            type: 'safe',
            title: 'Set upstream?',
            message: `No upstream tracking branch set. Push and set ${selectedRemote}/${gitCurrentBranch} as upstream?`,
            confirmLabel: 'Push & Set Upstream',
            onConfirm: () => {
              setConfirmDialog(null);
              executePush(true);
            },
          });
        } else {
          showResult('error', errorMsg);
        }
      }
    } catch (err) {
      showResult('error', err.message || 'Push failed');
    } finally {
      setPushing(false);
    }
  }, [repoPath, selectedRemote, gitCurrentBranch, showResult, refreshAfterRemoteOp]);

  const handlePush = useCallback(() => {
    if (anyOperationRunning) return;

    // Warn about pushing to protected branches
    if (isProtectedBranch) {
      setConfirmDialog({
        type: 'warning',
        title: `Push to ${gitCurrentBranch}?`,
        message: `You are about to push directly to "${gitCurrentBranch}". This is a protected branch. Consider using a feature branch and pull request instead.`,
        confirmLabel: `Push to ${gitCurrentBranch}`,
        onConfirm: () => {
          setConfirmDialog(null);
          // Check if upstream exists
          if (!aheadBehind.upstream) {
            executePush(true);
          } else {
            executePush(false);
          }
        },
      });
      return;
    }

    // No upstream — auto set
    if (!aheadBehind.upstream) {
      executePush(true);
    } else {
      executePush(false);
    }
  }, [anyOperationRunning, isProtectedBranch, gitCurrentBranch, aheadBehind.upstream, executePush]);

  // ── Pull ──────────────────────────────────────────────────────
  const handlePull = useCallback(async () => {
    if (anyOperationRunning) return;

    const api = window.electronAPI;
    if (!api || !api.gitPull || !repoPath) return;

    setPulling(true);
    setResult(null);

    try {
      const pullResult = await api.gitPull(repoPath, selectedRemote, gitCurrentBranch);
      if (pullResult && pullResult.success) {
        const data = pullResult.data || '';
        if (data.includes('Already up to date')) {
          showResult('success', 'Already up to date');
        } else {
          showResult('success', 'Pull successful');
        }
        await refreshAfterRemoteOp();
      } else {
        const errorMsg = (pullResult && pullResult.error) || 'Pull failed';
        // Check for merge conflicts
        if (errorMsg.includes('CONFLICT') || errorMsg.includes('Merge conflict') || errorMsg.includes('not possible because you have unmerged files')) {
          showResult('warning', 'Merge conflicts detected. Resolve conflicts in affected files, then stage and commit.');
        } else if (errorMsg.includes('uncommitted changes') || errorMsg.includes('local changes')) {
          showResult('error', 'Pull aborted — you have uncommitted changes. Commit or stash them first.');
        } else {
          showResult('error', errorMsg);
        }
        // Refresh status anyway to show conflict state
        if (api.gitStatus) {
          const statusResult = await api.gitStatus(repoPath);
          if (statusResult && statusResult.success) {
            dispatch({ type: 'GIT_SET_STATUS', status: statusResult.data });
          }
        }
      }
    } catch (err) {
      showResult('error', err.message || 'Pull failed');
    } finally {
      setPulling(false);
    }
  }, [anyOperationRunning, repoPath, selectedRemote, gitCurrentBranch, showResult, refreshAfterRemoteOp, dispatch]);

  // ── Fetch ─────────────────────────────────────────────────────
  const handleFetch = useCallback(async () => {
    if (anyOperationRunning) return;

    const api = window.electronAPI;
    if (!api || !api.gitFetch || !repoPath) return;

    setFetching(true);
    setResult(null);

    try {
      const fetchResult = await api.gitFetch(repoPath, selectedRemote);
      if (fetchResult && fetchResult.success) {
        showResult('success', 'Fetch complete');
        // Refresh ahead/behind after fetch
        if (api.gitAheadBehind) {
          const abResult = await api.gitAheadBehind(repoPath, gitCurrentBranch);
          if (abResult && abResult.success) setAheadBehind(abResult.data);
        }
      } else {
        showResult('error', (fetchResult && fetchResult.error) || 'Fetch failed');
      }
    } catch (err) {
      showResult('error', err.message || 'Fetch failed');
    } finally {
      setFetching(false);
    }
  }, [anyOperationRunning, repoPath, selectedRemote, gitCurrentBranch, showResult]);

  // ── Force push (double confirmation) ──────────────────────────
  const handleForcePush = useCallback(() => {
    if (anyOperationRunning) return;

    // First confirmation
    setForceConfirmStep(1);
    setConfirmDialog({
      type: 'danger',
      title: 'Force Push',
      message: `Force pushing overwrites the remote history on "${selectedRemote}/${gitCurrentBranch}". This can permanently destroy commits for other collaborators.`,
      confirmLabel: 'I understand the risk',
      onConfirm: () => {
        // Second confirmation
        setForceConfirmStep(2);
        setConfirmDialog({
          type: 'danger',
          title: 'Confirm Force Push',
          message: `Are you absolutely sure? This will overwrite "${selectedRemote}/${gitCurrentBranch}" with your local history. This action cannot be undone.`,
          confirmLabel: 'Force Push Now',
          onConfirm: async () => {
            setConfirmDialog(null);
            setForceConfirmStep(0);
            // Force push is not directly supported by the IPC handler,
            // so we surface a message. The IPC would need extension.
            showResult('error', 'Force push is not yet supported by the git backend.');
          },
        });
      },
    });
  }, [anyOperationRunning, selectedRemote, gitCurrentBranch, showResult]);

  // No repo or branch
  if (!repoPath || !gitCurrentBranch) {
    return (
      <div className="git-manager-quick-actions" style={{ justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
          No branch selected
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="git-manager-quick-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        {/* Top row — branch info + ahead/behind */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Branch name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
            <BranchSmallIcon />
            <span
              style={{
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontSize: '0.72rem',
                color: 'var(--text)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {gitCurrentBranch}
            </span>
            {aheadBehind.upstream && (
              <span
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: '0.62rem',
                  color: 'var(--text-tertiary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {aheadBehind.upstream}
              </span>
            )}
          </div>

          {/* Ahead/Behind badges */}
          {aheadBehind.upstream && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {aheadBehind.ahead > 0 && (
                <span className="git-manager-badge green" title={`${aheadBehind.ahead} commit${aheadBehind.ahead !== 1 ? 's' : ''} ahead`}>
                  <ArrowUpIcon /> {aheadBehind.ahead}
                </span>
              )}
              {aheadBehind.behind > 0 && (
                <span className="git-manager-badge orange" title={`${aheadBehind.behind} commit${aheadBehind.behind !== 1 ? 's' : ''} behind`}>
                  <ArrowDownIcon /> {aheadBehind.behind}
                </span>
              )}
            </div>
          )}

          {/* Synced indicator */}
          {aheadBehind.upstream && aheadBehind.ahead === 0 && aheadBehind.behind === 0 && (
            <span className="git-manager-badge gray" title="Up to date with remote">
              <CheckIcon /> Synced
            </span>
          )}

          {/* No upstream indicator */}
          {!aheadBehind.upstream && (
            <span className="git-manager-badge gray" title="No upstream tracking branch">
              No upstream
            </span>
          )}
        </div>

        {/* Remote selector — only if multiple remotes */}
        {remoteList.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.68rem', color: 'var(--text-tertiary)', flexShrink: 0 }}>
              Remote:
            </span>
            <select
              value={selectedRemote}
              onChange={(e) => setSelectedRemote(e.target.value)}
              disabled={anyOperationRunning}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '3px 6px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'var(--bg)',
                color: 'var(--text)',
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontSize: '0.68rem',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {remoteList.map(r => (
                <option key={r.name} value={r.name}>
                  {r.name} ({r.fetchUrl || r.pushUrl || ''})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Action buttons row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Fetch */}
          <button
            className="git-manager-action-btn"
            onClick={handleFetch}
            disabled={anyOperationRunning || !hasRemotes}
            title="Fetch changes from remote"
          >
            {fetching ? (
              <span className="git-manager-spinner sm"><span className="git-manager-spinner-circle" /></span>
            ) : (
              <FetchIcon />
            )}
            Fetch
          </button>

          {/* Pull */}
          <button
            className="git-manager-action-btn primary"
            onClick={handlePull}
            disabled={anyOperationRunning || !hasRemotes}
            title={`Pull from ${selectedRemote}/${gitCurrentBranch}`}
          >
            {pulling ? (
              <span className="git-manager-spinner sm"><span className="git-manager-spinner-circle" /></span>
            ) : (
              <PullIcon />
            )}
            Pull
            {aheadBehind.behind > 0 && (
              <span className="git-manager-badge orange" style={{ marginLeft: 2 }}>
                {aheadBehind.behind}
              </span>
            )}
          </button>

          {/* Push */}
          <button
            className={`git-manager-action-btn${isProtectedBranch ? ' warning' : ' success'}`}
            onClick={handlePush}
            disabled={anyOperationRunning || !hasRemotes}
            title={isProtectedBranch
              ? `Push to protected branch ${gitCurrentBranch}`
              : `Push to ${selectedRemote}/${gitCurrentBranch}`}
          >
            {pushing ? (
              <span className="git-manager-spinner sm"><span className="git-manager-spinner-circle" /></span>
            ) : (
              <PushIcon />
            )}
            Push
            {aheadBehind.ahead > 0 && (
              <span className="git-manager-badge green" style={{ marginLeft: 2 }}>
                {aheadBehind.ahead}
              </span>
            )}
          </button>

          {/* Force push (hidden unless there's a need — show after push rejection) */}
          {result && result.type === 'error' && result.text.includes('force push') && (
            <button
              className="git-manager-action-btn danger"
              onClick={handleForcePush}
              disabled={anyOperationRunning}
              title="Force push — destructive operation"
            >
              <ForceIcon />
              Force
            </button>
          )}
        </div>

        {/* Result message */}
        {result && (
          <div
            style={{
              fontFamily: 'var(--sans)',
              fontSize: '0.72rem',
              fontWeight: 500,
              color: result.type === 'success'
                ? 'var(--color-completed)'
                : result.type === 'warning'
                  ? 'var(--color-blocked)'
                  : 'var(--color-failed)',
              lineHeight: 1.4,
              padding: '0 2px',
            }}
          >
            {result.text}
          </div>
        )}
      </div>

      {/* Confirmation dialog overlay */}
      {confirmDialog && (
        <div
          className="git-manager-dialog-overlay"
          onClick={() => { setConfirmDialog(null); setForceConfirmStep(0); }}
        >
          <div
            className={`git-manager-dialog ${confirmDialog.type}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="git-manager-dialog-header">
              <div className="git-manager-dialog-icon">
                {confirmDialog.type === 'danger' ? <DangerDialogIcon /> :
                 confirmDialog.type === 'warning' ? <WarningDialogIcon /> :
                 <SafeDialogIcon />}
              </div>
              <div className="git-manager-dialog-title">{confirmDialog.title}</div>
            </div>
            <div className="git-manager-dialog-body">
              {confirmDialog.message}
            </div>
            <div className="git-manager-dialog-footer">
              <button
                className="git-manager-dialog-btn cancel"
                onClick={() => { setConfirmDialog(null); setForceConfirmStep(0); }}
              >
                Cancel
              </button>
              <button
                className={`git-manager-dialog-btn confirm-${confirmDialog.type}`}
                onClick={confirmDialog.onConfirm}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────

function BranchSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="12" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 6v4M9 6.5C7.5 7 5 8 5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 12V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5 7l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PullIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 4v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5 9l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FetchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 5l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 10h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="5" cy="13" r="1" fill="currentColor" />
      <circle cx="8" cy="13" r="1" fill="currentColor" />
      <circle cx="11" cy="13" r="1" fill="currentColor" />
    </svg>
  );
}

function ForceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.5 5.5L8 2l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 5.5L8 2l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(0, 3)" />
      <path d="M4 14h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M4 7V1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2 3l2-2 2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M4 1v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2 5l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M1.5 4L3.5 6L6.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DangerDialogIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" />
    </svg>
  );
}

function WarningDialogIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2L18.5 17H1.5L10 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 8v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.7" fill="currentColor" />
    </svg>
  );
}

function SafeDialogIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10L9 12.5L13.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
