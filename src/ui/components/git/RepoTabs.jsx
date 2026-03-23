// RepoTabs — horizontal tab bar showing open git repositories
// Each tab shows a repo name with branch badge and close button.
// A "+" button opens new repositories via folder picker.
// Mirrors the WorkspaceTabs.jsx pattern from the IDE view.

import React, { useCallback } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';

export default function RepoTabs() {
  const { gitRepos, gitActiveRepoId, gitCurrentBranch } = useAppState();
  const dispatch = useDispatch();

  // Open a new repo via native folder picker
  const handleAddRepo = useCallback(async () => {
    const api = window.electronAPI;
    if (!api || !api.ideSelectFolder) return;

    try {
      const folderPath = await api.ideSelectFolder();
      if (!folderPath) return; // user cancelled

      const pathStr = typeof folderPath === 'string' ? folderPath : folderPath.path;
      const parts = pathStr.replace(/\/+$/, '').split(/[/\\]/);
      const folderName = parts[parts.length - 1] || pathStr;

      const repoId = String(Date.now());
      dispatch({
        type: 'GIT_OPEN_REPO',
        id: repoId,
        path: pathStr,
        name: folderName,
      });
    } catch (err) {
      console.error('RepoTabs: failed to select folder', err);
    }
  }, [dispatch]);

  // Switch to a different repo tab
  const handleSwitchRepo = useCallback((repoId) => {
    dispatch({ type: 'GIT_SWITCH_REPO', repoId });
  }, [dispatch]);

  // Close a repo tab
  const handleCloseRepo = useCallback((e, repoId) => {
    e.stopPropagation();
    dispatch({ type: 'GIT_CLOSE_REPO', repoId });
  }, [dispatch]);

  return (
    <div className="git-manager-repo-tabs">
      <div className="git-manager-repo-tabs-scroll">
        {gitRepos.map(repo => {
          const isActive = repo.id === gitActiveRepoId;
          return (
            <button
              key={repo.id}
              className={`git-manager-repo-tab${isActive ? ' active' : ''}`}
              onClick={() => handleSwitchRepo(repo.id)}
              title={repo.path}
            >
              <span className="git-manager-repo-tab-icon">
                <GitBranchTabIcon />
              </span>
              <span className="git-manager-repo-tab-label">{repo.name}</span>
              {isActive && gitCurrentBranch && (
                <span className="git-manager-repo-tab-branch">{gitCurrentBranch}</span>
              )}
              <button
                className="git-manager-repo-tab-close"
                onClick={(e) => handleCloseRepo(e, repo.id)}
                title="Close repository"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            </button>
          );
        })}
      </div>
      <button
        className="git-manager-repo-tab-add"
        onClick={handleAddRepo}
        title="Open repository"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────

function GitBranchTabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 5.5v5M9.5 6.5C8 7.5 5 8.5 5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
