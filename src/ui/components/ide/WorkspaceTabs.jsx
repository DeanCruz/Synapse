// WorkspaceTabs — horizontal tab bar showing open workspace folders
// Each tab shows a folder name with a close button. A "+" button opens new folders.

import React, { useCallback } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import { createWorkspaceDashboard, getWorkspaceDashboard, removeWorkspaceDashboard } from '../../utils/ideWorkspaceManager.js';
import { saveDashboardProject } from '../../utils/dashboardProjects.js';

export default function WorkspaceTabs() {
  const { ideWorkspaces, ideActiveWorkspaceId, currentDashboardId, dashboardList } = useAppState();
  const dispatch = useDispatch();

  const handleAddWorkspace = useCallback(async () => {
    try {
      const result = await window.electronAPI.ideSelectFolder();
      if (!result) return; // user cancelled
      const folderPath = typeof result === 'string' ? result : result.path;
      const folderName = folderPath.split('/').filter(Boolean).pop() || folderPath;
      // Generate workspace ID before dispatch so we can link it to a dashboard
      const wsId = String(Date.now());
      dispatch({ type: 'IDE_OPEN_WORKSPACE', path: folderPath, name: folderName, id: wsId });
      // Create a dashboard for this workspace and associate the project path
      try {
        const dashboardId = await createWorkspaceDashboard(wsId);
        if (dashboardId) {
          saveDashboardProject(dashboardId, folderPath);
          dispatch({ type: 'SWITCH_DASHBOARD', id: dashboardId });
        }
      } catch (err) {
        console.error('Failed to create workspace dashboard:', err);
      }
    } catch (err) {
      console.error('Failed to select folder:', err);
    }
  }, [dispatch]);

  const handleSwitchWorkspace = useCallback((workspaceId) => {
    dispatch({ type: 'IDE_SWITCH_WORKSPACE', workspaceId });
    // Switch to the workspace's associated dashboard so chat context matches
    const dashId = getWorkspaceDashboard(workspaceId);
    if (dashId && dashId !== currentDashboardId) {
      dispatch({ type: 'SWITCH_DASHBOARD', id: dashId });
    }
  }, [dispatch, currentDashboardId]);

  const handleCloseWorkspace = useCallback(async (e, workspaceId) => {
    e.stopPropagation();
    // Get the associated dashboard before closing
    const dashboardId = getWorkspaceDashboard(workspaceId);
    if (dashboardId) {
      // Clear localStorage mapping
      removeWorkspaceDashboard(workspaceId);
      // If the deleted dashboard is the current one, switch to another first
      if (dashboardId === currentDashboardId) {
        const otherDashboard = dashboardList.find(id => id !== dashboardId);
        if (otherDashboard) {
          dispatch({ type: 'SWITCH_DASHBOARD', id: otherDashboard });
        }
      }
    }
    // Close the workspace in state
    dispatch({ type: 'IDE_CLOSE_WORKSPACE', workspaceId });
    // Delete the dashboard from disk and clean up state
    if (dashboardId) {
      try {
        await window.electronAPI.deleteDashboard(dashboardId);
      } catch (err) {
        console.error('Failed to delete workspace dashboard:', err);
      }
      dispatch({ type: 'REMOVE_DASHBOARD', id: dashboardId });
    }
  }, [dispatch, currentDashboardId, dashboardList]);

  return (
    <div className="workspace-tabs">
      <div className="workspace-tabs-scroll">
        {ideWorkspaces.map(ws => (
          <button
            key={ws.id}
            className={`workspace-tab${ws.id === ideActiveWorkspaceId ? ' active' : ''}`}
            onClick={() => handleSwitchWorkspace(ws.id)}
            title={ws.path}
          >
            <span className="workspace-tab-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M1.5 3.5C1.5 2.67 2.17 2 3 2h3.17a1 1 0 0 1 .7.3L8.3 3.7a1 1 0 0 0 .7.3H13c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-9Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="workspace-tab-label">{ws.name}</span>
            <button
              className="workspace-tab-close"
              onClick={(e) => handleCloseWorkspace(e, ws.id)}
              title="Close workspace"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </button>
        ))}
      </div>
      <button
        className="workspace-tab-add"
        onClick={handleAddWorkspace}
        title="Open folder"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
