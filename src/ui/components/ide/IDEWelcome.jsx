// IDEWelcome — Welcome screen shown when no workspace is open
// Provides "Open Folder" and "Create New Folder" action buttons.

import React, { useCallback } from 'react';
import { useDispatch } from '../../context/AppContext.jsx';
import { createWorkspaceDashboard } from '../../utils/ideWorkspaceManager.js';
import { saveDashboardProject } from '../../utils/dashboardProjects.js';
import '../../styles/ide-explorer.css';

// ── SVG Icons ────────────────────────────────────────────────

function CodeBracketIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 8L5 16l7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 8l7 8-7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderOpenActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v1H4.5a2 2 0 00-1.874 1.298L1.5 11.5V4.5z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 8.5A1.5 1.5 0 014.5 7H14l-1.5 5.5a1.5 1.5 0 01-1.45 1H2.5L3 8.5z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M8 7v4M6 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ── IDEWelcome ───────────────────────────────────────────────

export default function IDEWelcome() {
  const dispatch = useDispatch();

  // Open existing folder via native picker
  const handleOpenFolder = useCallback(async () => {
    try {
      const api = window.electronAPI;
      if (!api || !api.ideSelectFolder) {
        console.error('IDEWelcome: ideSelectFolder not available');
        return;
      }

      const folderPath = await api.ideSelectFolder();
      if (!folderPath) return; // user cancelled

      // Extract folder name from path
      const parts = folderPath.replace(/\/+$/, '').split(/[/\\]/);
      const folderName = parts[parts.length - 1] || folderPath;

      // Generate workspace ID before dispatch so we can link it to a dashboard
      const wsId = String(Date.now());
      dispatch({
        type: 'IDE_OPEN_WORKSPACE',
        path: folderPath,
        name: folderName,
        id: wsId
      });

      // Create a dashboard for this workspace and associate the project path
      try {
        const dashboardId = await createWorkspaceDashboard(wsId);
        if (dashboardId) {
          saveDashboardProject(dashboardId, folderPath);
        }
      } catch (err) {
        console.error('IDEWelcome: failed to create workspace dashboard', err);
      }
    } catch (err) {
      console.error('IDEWelcome: failed to open folder', err);
    }
  }, [dispatch]);

  // Create new folder via native picker then create
  const handleCreateFolder = useCallback(async () => {
    try {
      const api = window.electronAPI;
      if (!api || !api.ideSelectFolder) {
        console.error('IDEWelcome: ideSelectFolder not available');
        return;
      }

      // First select where to create the folder
      const parentPath = await api.ideSelectFolder();
      if (!parentPath) return; // user cancelled

      // Prompt for folder name
      const folderName = window.prompt('Enter new folder name:');
      if (!folderName || !folderName.trim()) return;

      const newPath = parentPath.replace(/\/+$/, '') + '/' + folderName.trim();

      if (api.ideCreateFolder) {
        const result = await api.ideCreateFolder(newPath);
        if (!result || !result.success) {
          console.error('IDEWelcome: failed to create folder', result);
          return;
        }
      }

      // Generate workspace ID before dispatch so we can link it to a dashboard
      const wsId = String(Date.now());
      dispatch({
        type: 'IDE_OPEN_WORKSPACE',
        path: newPath,
        name: folderName.trim(),
        id: wsId
      });

      // Create a dashboard for this workspace and associate the project path
      try {
        const dashboardId = await createWorkspaceDashboard(wsId);
        if (dashboardId) {
          saveDashboardProject(dashboardId, newPath);
        }
      } catch (err) {
        console.error('IDEWelcome: failed to create workspace dashboard', err);
      }
    } catch (err) {
      console.error('IDEWelcome: failed to create folder', err);
    }
  }, [dispatch]);

  return (
    <div className="ide-welcome">
      <div className="ide-welcome-icon">
        <CodeBracketIcon />
      </div>

      <h2 className="ide-welcome-title">Code Explorer</h2>
      <p className="ide-welcome-subtitle">
        Open a project folder to browse files, edit code, and manage your workspace.
      </p>

      <div className="ide-welcome-actions">
        <button className="ide-welcome-btn primary" onClick={handleOpenFolder}>
          <span className="ide-welcome-btn-icon"><FolderOpenActionIcon /></span>
          Open Folder
        </button>
        <button className="ide-welcome-btn" onClick={handleCreateFolder}>
          <span className="ide-welcome-btn-icon"><FolderPlusIcon /></span>
          Create New Folder
        </button>
      </div>
    </div>
  );
}
