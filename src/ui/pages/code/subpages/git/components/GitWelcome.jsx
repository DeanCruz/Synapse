// GitWelcome — empty state shown when no repositories are open
// Displays a centered card with "Open Repository" button.
// Mirrors IDEWelcome.jsx pattern, uses git-manager-empty-* classes.

import React, { useCallback } from 'react';
import { useDispatch } from '../../context/AppContext.jsx';

function GitBranchIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="8" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="24" cy="40" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="36" cy="20" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M24 12v24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M24 16c0 4 12 0 12 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v1H4.5a2 2 0 00-1.874 1.298L1.5 11.5V4.5z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 8.5A1.5 1.5 0 014.5 7H14l-1.5 5.5a1.5 1.5 0 01-1.45 1H2.5L3 8.5z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default function GitWelcome() {
  const dispatch = useDispatch();

  const handleOpenRepo = useCallback(async () => {
    try {
      const api = window.electronAPI;
      if (!api || !api.ideSelectFolder) {
        console.error('GitWelcome: ideSelectFolder not available');
        return;
      }

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
      console.error('GitWelcome: failed to open folder', err);
    }
  }, [dispatch]);

  return (
    <div className="git-manager-empty">
      <div className="git-manager-empty-icon">
        <GitBranchIcon />
      </div>
      <div className="git-manager-empty-title">Git Manager</div>
      <div className="git-manager-empty-text">
        Open a repository to manage branches, commits, and changes
      </div>
      <div className="git-manager-empty-action">
        <button className="git-manager-action-btn primary" onClick={handleOpenRepo}>
          <span className="git-manager-action-btn-icon">
            <FolderOpenIcon />
          </span>
          Open Repository
        </button>
      </div>
    </div>
  );
}
