// IDEView — main IDE layout component
// Assembles WorkspaceTabs, FileExplorer, EditorTabs, CodeEditor, IDEWelcome,
// and a VS Code-style BottomPanel (Terminal, Output, Problems, etc.)

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import WorkspaceTabs from './WorkspaceTabs.jsx';
import FileExplorer from './FileExplorer.jsx';
import EditorTabs from './EditorTabs.jsx';
import CodeEditor from './CodeEditor.jsx';
import IDEWelcome from './IDEWelcome.jsx';
import BottomPanel from '../BottomPanel.jsx';
import { getDashboardProject } from '../../utils/dashboardProjects.js';
import { getWorkspaceDashboard } from '../../utils/ideWorkspaceManager.js';
import '../../styles/ide-layout.css';

const MIN_EXPLORER_WIDTH = 180;
const MAX_EXPLORER_WIDTH = 500;
const DEFAULT_EXPLORER_WIDTH = 250;

export default function IDEView() {
  const {
    ideWorkspaces,
    ideActiveWorkspaceId,
    ideOpenFiles,
    ideActiveFileId,
    ideFileTrees,
    currentDashboardId,
    dashboardList,
    currentLogs,
    activeLogFilter,
  } = useAppState();
  const dispatch = useDispatch();

  const projectPath = getDashboardProject(currentDashboardId);

  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: 0 });

  // Load file tree when active workspace changes or when a new workspace is opened
  useEffect(() => {
    if (!ideActiveWorkspaceId) return;
    const ws = ideWorkspaces.find(w => w.id === ideActiveWorkspaceId);
    if (!ws) return;
    // Only load if we don't already have the tree cached
    if (ideFileTrees[ideActiveWorkspaceId]) return;

    let cancelled = false;
    (async () => {
      try {
        if (window.electronAPI && window.electronAPI.ideReadDir) {
          const tree = await window.electronAPI.ideReadDir(ws.path);
          if (!cancelled) {
            dispatch({ type: 'IDE_SET_FILE_TREE', workspaceId: ideActiveWorkspaceId, tree });
          }
        }
      } catch (err) {
        console.error('Failed to load file tree for workspace:', ws.path, err);
      }
    })();

    return () => { cancelled = true; };
  }, [ideActiveWorkspaceId, ideWorkspaces, ideFileTrees, dispatch]);

  // NOTE: Workspace-dashboard creation is handled exclusively by WorkspaceTabs.jsx.
  // handleAddWorkspace() creates dashboards for new workspaces, and a mount-time
  // recovery effect recreates dashboards for persisted workspaces after app restart.
  // Sidebar.jsx only handles display, sorting, and orphan cleanup — never creation.

  // Sync currentDashboardId to active workspace's dashboard when workspace changes
  useEffect(() => {
    if (!ideActiveWorkspaceId) return;
    const dashId = getWorkspaceDashboard(ideActiveWorkspaceId);
    if (dashId && dashId !== currentDashboardId) {
      dispatch({ type: 'SWITCH_DASHBOARD', id: dashId });
    }
  }, [ideActiveWorkspaceId, currentDashboardId, dispatch]);

  // Draggable divider handlers
  const handleDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    dragRef.current.startX = e.clientX;
    dragRef.current.startWidth = explorerWidth;
    setIsDragging(true);
  }, [explorerWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const delta = e.clientX - dragRef.current.startX;
      const newWidth = Math.min(
        MAX_EXPLORER_WIDTH,
        Math.max(MIN_EXPLORER_WIDTH, dragRef.current.startWidth + delta)
      );
      setExplorerWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add('ide-dragging');

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('ide-dragging');
    };
  }, [isDragging]);

  // Derive current workspace and file info
  const activeWorkspace = ideWorkspaces.find(w => w.id === ideActiveWorkspaceId) || null;
  const activeWsOpenFiles = ideActiveWorkspaceId
    ? (ideOpenFiles[ideActiveWorkspaceId] || [])
    : [];
  const activeFileId = ideActiveWorkspaceId
    ? (ideActiveFileId[ideActiveWorkspaceId] || null)
    : null;
  const activeFile = activeWsOpenFiles.find(f => f.id === activeFileId) || null;
  const hasWorkspaces = ideWorkspaces.length > 0;

  // When no workspaces are open, show the welcome screen with bottom panel
  if (!hasWorkspaces) {
    return (
      <div className="ide-view">
        <IDEWelcome />
        <BottomPanel
          logs={currentLogs}
          activeFilter={activeLogFilter}
          onFilterChange={(level) => dispatch({ type: 'SET', key: 'activeLogFilter', value: level })}
          projectDir={projectPath}
          embedded
        />
      </div>
    );
  }

  return (
    <div className="ide-view">
      <WorkspaceTabs />
      <div className="ide-main">
        {/* File Explorer Panel */}
        <div
          className="ide-explorer-panel"
          style={{ width: explorerWidth }}
        >
          <FileExplorer />
        </div>

        {/* Draggable Divider */}
        <div
          className={`ide-divider${isDragging ? ' dragging' : ''}`}
          onMouseDown={handleDividerMouseDown}
        />

        {/* Editor Area */}
        <div className="ide-editor-area">
          {activeWsOpenFiles.length > 0 ? (
            <>
              <EditorTabs workspaceId={ideActiveWorkspaceId} />
              <div className="ide-editor-content">
                {activeFile ? (
                  <CodeEditor
                    filePath={activeFile.path}
                    workspaceId={ideActiveWorkspaceId}
                    workspacePath={activeWorkspace ? activeWorkspace.path : ''}
                  />
                ) : (
                  <div className="ide-editor-empty">
                    <svg className="ide-editor-empty-icon" viewBox="0 0 48 48" fill="none">
                      <rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M16 16h16M16 22h12M16 28h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    <span className="ide-editor-empty-text">Select a file to open</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="ide-editor-empty">
              <svg className="ide-editor-empty-icon" viewBox="0 0 48 48" fill="none">
                <rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M16 16h16M16 22h12M16 28h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span className="ide-editor-empty-text">Open a file from the explorer</span>
            </div>
          )}
        </div>
      </div>

      {/* VS Code-style bottom panel: Terminal, Output, Problems, Debug Console, Ports */}
      <BottomPanel
        logs={currentLogs}
        activeFilter={activeLogFilter}
        onFilterChange={(level) => dispatch({ type: 'SET', key: 'activeLogFilter', value: level })}
        projectDir={activeWorkspace?.path || projectPath}
        embedded
      />
    </div>
  );
}
