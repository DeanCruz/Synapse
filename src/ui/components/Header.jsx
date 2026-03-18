// Header — top navigation bar with task badge, archive dropdown, and swarm controls

import React, { useState, useRef, useEffect } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';
import { useIsElectron } from '../hooks/useElectronAPI.js';

export default function Header() {
  const state = useAppState();
  const dispatch = useDispatch();
  const isElectron = useIsElectron();

  const { currentStatus, connected } = state;
  const task = currentStatus?.active_task ?? null;
  const agents = currentStatus?.agents ?? [];
  const activeCount = agents.filter(a => a.status === 'in_progress').length;

  const [archiveOpen, setArchiveOpen] = useState(false);
  const archiveRef = useRef(null);

  // Close archive dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (archiveRef.current && !archiveRef.current.contains(e.target)) {
        setArchiveOpen(false);
      }
    }
    if (archiveOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [archiveOpen]);

  function handleHomeClick() {
    dispatch({ type: 'SET_VIEW', view: 'home' });
  }

  function handleArchiveTask() {
    setArchiveOpen(false);
    window.electronAPI?.archiveDashboard(state.currentDashboardId).catch(() => {});
  }

  function handleViewArchive() {
    setArchiveOpen(false);
    dispatch({ type: 'SET_VIEW', view: 'home' });
  }

  function handleHistory() {
    dispatch({ type: 'SET_VIEW', view: 'home' });
  }

  function handleCommands() {
    dispatch({ type: 'OPEN_MODAL', modal: 'commands' });
  }

  return (
    <header className="header-bar">
      {/* Left — logo */}
      <div className="header-left">
        <h1 className="header-title" onClick={handleHomeClick}>Synapse</h1>
      </div>

      {/* Center — task badge + directory */}
      <div className="header-center">
        {task?.name && (
          <button className="task-badge" aria-label="Task details">
            {task.name}
          </button>
        )}
        {task?.directory && (
          <span className="task-directory">{task.directory}</span>
        )}
      </div>

      {/* Right — archive, history, swarm controls, active badge */}
      <div className="header-right">
        {/* Archive + History button group */}
        <div className="header-btn-group">
          <div className="archive-dropdown-wrap" ref={archiveRef}>
            <button
              className="header-action-btn"
              title="Archive"
              aria-label="Archive actions"
              onClick={() => setArchiveOpen(o => !o)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="2" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M2.5 5v7.5a1 1 0 001 1h9a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M6 8.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <span>Archive</span>
            </button>
            {archiveOpen && (
              <div className="archive-dropdown">
                <button className="archive-dropdown-item" onClick={handleArchiveTask}>
                  Archive task
                </button>
                <button className="archive-dropdown-item" onClick={handleViewArchive}>
                  View Archive
                </button>
              </div>
            )}
          </div>

          <button
            className="header-action-btn"
            title="History"
            aria-label="View task history"
            onClick={handleHistory}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span>History</span>
          </button>
        </div>

        {/* Electron-only swarm controls */}
        {isElectron && (
          <div className="header-btn-group">
            <button className="header-action-btn" title="Commands" onClick={handleCommands}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 5l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span>Commands</span>
            </button>
          </div>
        )}

        {/* Active agents count badge */}
        <span className="active-badge">{activeCount} active</span>
      </div>
    </header>
  );
}
