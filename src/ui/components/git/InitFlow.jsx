// InitFlow — wizard UI for folders that don't have .git initialized
// Shows a friendly prompt with an "Initialize Repository" button.
// On success, calls onInitComplete to transition to the full git view.

import React, { useState, useCallback } from 'react';

function GitInitIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="8" width="32" height="32" rx="6" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M24 16v16M16 24h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 8l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="git-manager-spinner">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 12" strokeLinecap="round" />
    </svg>
  );
}

export default function InitFlow({ repoPath, repoName, onInitComplete }) {
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleInit = useCallback(async () => {
    const api = window.electronAPI;
    if (!api || !api.gitInit) return;

    setInitializing(true);
    setError(null);

    try {
      const result = await api.gitInit(repoPath);
      if (result && result.success) {
        setSuccess(true);
        if (onInitComplete) {
          setTimeout(() => onInitComplete(), 800);
        }
      } else {
        setError(result?.error || 'Failed to initialize repository');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setInitializing(false);
    }
  }, [repoPath, onInitComplete]);

  return (
    <div className="git-manager-empty">
      <div className="git-manager-empty-icon">
        {success ? <CheckIcon /> : <GitInitIcon />}
      </div>
      <div className="git-manager-empty-title">
        {success ? 'Repository Initialized' : 'Not a Git Repository'}
      </div>
      <div className="git-manager-empty-text">
        {success
          ? `${repoName} is now a git repository. Loading git data...`
          : `"${repoName}" doesn't have git initialized yet. Would you like to set it up?`
        }
      </div>
      {error && (
        <div className="git-manager-error">
          <span className="git-manager-error-message">{error}</span>
        </div>
      )}
      {!success && (
        <div className="git-manager-empty-action">
          <button
            className="git-manager-action-btn primary"
            onClick={handleInit}
            disabled={initializing}
          >
            {initializing ? (
              <>
                <span className="git-manager-action-btn-icon"><SpinnerIcon /></span>
                Initializing...
              </>
            ) : (
              <>
                <span className="git-manager-action-btn-icon"><GitInitIcon /></span>
                Initialize Repository
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
