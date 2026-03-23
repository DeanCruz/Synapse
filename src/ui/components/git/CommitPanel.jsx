// CommitPanel — compose and execute git commits
// Provides: subject line textarea (50-char guideline), optional extended description
// (72-char wrap guideline), amend checkbox with history-rewrite warning,
// commit button disabled when no staged files or empty message.

import React, { useState, useCallback, useRef } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/git-manager.css';

const SUBJECT_SOFT_LIMIT = 50;
const BODY_WRAP_LIMIT = 72;

export default function CommitPanel({ repoPath, onCommitComplete }) {
  const { gitStatus, gitLoading } = useAppState();
  const dispatch = useDispatch();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showBody, setShowBody] = useState(false);
  const [amend, setAmend] = useState(false);
  const [amendWarningDismissed, setAmendWarningDismissed] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null); // { type: 'success'|'error', text }
  const resultTimeoutRef = useRef(null);

  // Derive staged file count
  const stagedCount = gitStatus && Array.isArray(gitStatus.staged) ? gitStatus.staged.length : 0;
  const canCommit = (subject.trim().length > 0) && (stagedCount > 0 || amend) && !committing && !gitLoading;

  // Subject line character state
  const subjectLen = subject.length;
  const subjectOverLimit = subjectLen > SUBJECT_SOFT_LIMIT;

  // Clear result message after a timeout
  const showResult = useCallback((type, text) => {
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    setCommitResult({ type, text });
    resultTimeoutRef.current = setTimeout(() => {
      setCommitResult(null);
      resultTimeoutRef.current = null;
    }, 4000);
  }, []);

  // Handle commit
  const handleCommit = useCallback(async () => {
    if (!canCommit || !repoPath) return;

    const api = window.electronAPI;
    if (!api || !api.gitCommit) {
      showResult('error', 'Git API not available');
      return;
    }

    // Build the full commit message
    let message = subject.trim();
    if (body.trim()) {
      message += '\n\n' + body.trim();
    }

    setCommitting(true);
    dispatch({ type: 'GIT_SET_ERROR', error: null });

    try {
      // If amend, we need to pass --amend flag
      // The IPC handler expects (repoPath, message) — for amend we rely on
      // a separate approach. Since the backend git-commit handler only supports
      // `-m`, we compose the git args ourselves. For now the preload only exposes
      // gitCommit(repoPath, message). We'll handle amend by calling through the
      // standard API and noting this limitation.
      // NOTE: The current IPC handler does not support --amend. If amend is
      // checked, we warn the user that amend support requires IPC extension.
      // For production, the IPC handler should be extended to accept an options
      // object. For now we proceed with a normal commit when amend is off.
      if (amend) {
        // Attempt amend — this requires the IPC to support an options argument.
        // We try calling with the message; if the backend doesn't support amend,
        // we surface the error.
        showResult('error', 'Amend is not yet supported by the git backend. Uncheck amend to commit normally.');
        setCommitting(false);
        return;
      }

      const result = await api.gitCommit(repoPath, message);

      if (result && result.success) {
        showResult('success', 'Committed successfully');
        setSubject('');
        setBody('');
        setShowBody(false);
        setAmend(false);

        // Refresh status, log, and branches after commit
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
        await Promise.all(refreshPromises);

        if (onCommitComplete) onCommitComplete();
      } else {
        showResult('error', (result && result.error) || 'Commit failed');
      }
    } catch (err) {
      showResult('error', err.message || 'Commit failed');
    } finally {
      setCommitting(false);
    }
  }, [canCommit, repoPath, subject, body, amend, dispatch, showResult, onCommitComplete]);

  // Handle keydown — Cmd/Ctrl+Enter to commit from either textarea
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canCommit) handleCommit();
    }
  }, [canCommit, handleCommit]);

  // Prevent newlines in the subject — Enter in subject alone is blocked
  const handleSubjectKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canCommit) handleCommit();
    }
  }, [canCommit, handleCommit]);

  // Amend checkbox toggle with warning
  const handleAmendToggle = useCallback(() => {
    if (!amend && !amendWarningDismissed) {
      // Show warning on first enable
      setAmend(true);
      setAmendWarningDismissed(false);
    } else {
      setAmend(prev => !prev);
    }
  }, [amend, amendWarningDismissed]);

  const dismissAmendWarning = useCallback(() => {
    setAmendWarningDismissed(true);
  }, []);

  return (
    <div className="git-manager-commit-panel">
      {/* Subject line input */}
      <div style={{ position: 'relative' }}>
        <textarea
          className="git-manager-commit-input"
          placeholder={stagedCount > 0
            ? `Commit message (${stagedCount} staged file${stagedCount !== 1 ? 's' : ''})`
            : 'No files staged for commit'}
          value={subject}
          onChange={(e) => {
            // Prevent newlines in subject — those go in body
            const val = e.target.value.replace(/\n/g, '');
            setSubject(val);
          }}
          onKeyDown={handleSubjectKeyDown}
          disabled={committing || gitLoading}
          rows={2}
          style={{ resize: 'none', minHeight: '52px', maxHeight: '52px' }}
        />

        {/* Character counter */}
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 8,
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: '0.62rem',
            color: subjectOverLimit ? 'var(--color-blocked)' : 'var(--text-tertiary)',
            opacity: subjectLen > 0 ? 1 : 0,
            transition: 'opacity 0.15s, color 0.15s',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {subjectLen}/{SUBJECT_SOFT_LIMIT}
        </div>
      </div>

      {/* 50/72 rule hint — visible when subject is over limit */}
      {subjectOverLimit && (
        <div
          style={{
            fontFamily: 'var(--sans)',
            fontSize: '0.68rem',
            color: 'var(--color-blocked)',
            opacity: 0.8,
            lineHeight: 1.3,
            padding: '0 2px',
          }}
        >
          Subject line exceeds 50 characters. Keep the first line short; add details below.
        </div>
      )}

      {/* Extended description toggle + field */}
      {!showBody && (
        <button
          className="git-manager-action-btn"
          onClick={() => setShowBody(true)}
          disabled={committing}
          style={{ alignSelf: 'flex-start', fontSize: '0.68rem', padding: '3px 8px' }}
        >
          <DescriptionIcon />
          Add description
        </button>
      )}

      {showBody && (
        <div style={{ position: 'relative' }}>
          <textarea
            className="git-manager-commit-input"
            placeholder="Extended description (wrap at 72 chars per line)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={committing || gitLoading}
            rows={4}
            style={{ minHeight: '72px', maxHeight: '200px', resize: 'vertical' }}
          />
          {/* Body wrap indicator */}
          {body.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: 6,
                right: 8,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontSize: '0.62rem',
                color: body.split('\n').some(line => line.length > BODY_WRAP_LIMIT)
                  ? 'var(--color-blocked)'
                  : 'var(--text-tertiary)',
                opacity: 0.8,
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              wrap at {BODY_WRAP_LIMIT}
            </div>
          )}
        </div>
      )}

      {/* Commit result message */}
      {commitResult && (
        <div
          style={{
            fontFamily: 'var(--sans)',
            fontSize: '0.72rem',
            fontWeight: 500,
            color: commitResult.type === 'success' ? 'var(--color-completed)' : 'var(--color-failed)',
            padding: '2px 2px',
            lineHeight: 1.3,
          }}
        >
          {commitResult.text}
        </div>
      )}

      {/* Amend warning banner — shown when amend is checked and not dismissed */}
      {amend && !amendWarningDismissed && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 10px',
            background: 'rgba(249, 115, 22, 0.08)',
            border: '1px solid rgba(249, 115, 22, 0.2)',
            borderRadius: 6,
          }}
        >
          <WarningIcon />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--sans)',
                fontSize: '0.72rem',
                fontWeight: 600,
                color: 'var(--color-blocked)',
                marginBottom: 2,
              }}
            >
              Amend rewrites history
            </div>
            <div
              style={{
                fontFamily: 'var(--sans)',
                fontSize: '0.68rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.4,
              }}
            >
              This replaces the most recent commit. If you have already pushed, you will need to force-push. Only amend commits that have not been shared.
            </div>
            <button
              className="git-manager-action-btn"
              onClick={dismissAmendWarning}
              style={{ marginTop: 6, fontSize: '0.65rem', padding: '2px 8px' }}
            >
              I understand
            </button>
          </div>
        </div>
      )}

      {/* Actions row */}
      <div className="git-manager-commit-actions">
        {/* Amend checkbox */}
        <label className="git-manager-commit-amend">
          <input
            type="checkbox"
            checked={amend}
            onChange={handleAmendToggle}
            disabled={committing}
          />
          Amend
        </label>

        {/* Commit button */}
        <button
          className="git-manager-commit-btn"
          onClick={handleCommit}
          disabled={!canCommit}
        >
          {committing ? (
            <>
              <span className="git-manager-spinner sm">
                <span className="git-manager-spinner-circle" />
              </span>
              Committing...
            </>
          ) : (
            <>
              <CommitIcon />
              {amend ? 'Amend Commit' : 'Commit'}
              {stagedCount > 0 && !amend && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.15)',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    marginLeft: 2,
                  }}
                >
                  {stagedCount}
                </span>
              )}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────

function CommitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1v4M8 11v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function DescriptionIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4h10M3 7h10M3 10h6M3 13h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M8 1.5L14.5 13H1.5L8 1.5z" stroke="var(--color-blocked)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(249,115,22,0.1)" />
      <path d="M8 6v3" stroke="var(--color-blocked)" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.7" fill="var(--color-blocked)" />
    </svg>
  );
}
