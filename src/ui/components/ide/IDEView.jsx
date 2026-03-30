// IDEView — main IDE layout component
// Assembles WorkspaceTabs, FileExplorer, EditorTabs, CodeEditor, IDEWelcome,
// DebugToolbar, DebugPanels, and a VS Code-style BottomPanel (Terminal, Output,
// Problems, Debug Console, etc.)

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import WorkspaceTabs from './WorkspaceTabs.jsx';
import FileExplorer from './FileExplorer.jsx';
import SearchPanel from './SearchPanel.jsx';
import EditorTabs from './EditorTabs.jsx';
import CodeEditor from './CodeEditor.jsx';
import IDEWelcome from './IDEWelcome.jsx';
import DebugToolbar from './DebugToolbar.jsx';
import DebugPanels from './DebugPanels.jsx';
import BottomPanel from '../BottomPanel.jsx';
import { getDashboardProject } from '../../utils/dashboardProjects.js';
import { getWorkspaceDashboard } from '../../utils/ideWorkspaceManager.js';
import '../../styles/ide-layout.css';
import '../../styles/ide-debug.css';
import '../../styles/ide-debug-panels.css';
import '../../styles/ide-debug-console.css';

const MIN_EXPLORER_WIDTH = 180;
const MAX_EXPLORER_WIDTH = 500;
const DEFAULT_EXPLORER_WIDTH = 250;

export default function IDEView() {
  const state = useAppState();
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
    debugSession,
  } = state;
  const dispatch = useDispatch();

  const projectPath = getDashboardProject(currentDashboardId);

  // ---- Debug launch config ref (persists across restarts) ----
  const debugLaunchConfigRef = useRef({ scriptPath: '', cwd: '' });

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

  // ---- Debug IPC callbacks ----
  const handleDebugLaunch = useCallback((scriptPath, args) => {
    const ws = ideWorkspaces.find(w => w.id === ideActiveWorkspaceId);
    const cwd = ws?.path || projectPath || '';
    debugLaunchConfigRef.current = { scriptPath, cwd };
    if (window.electronAPI?.debugLaunch) {
      window.electronAPI.debugLaunch({ scriptPath, args, cwd });
    }
  }, [ideWorkspaces, ideActiveWorkspaceId, projectPath]);

  const handleDebugContinue = useCallback(() => {
    window.electronAPI?.debugContinue?.();
  }, []);

  const handleDebugPause = useCallback(() => {
    window.electronAPI?.debugPause?.();
  }, []);

  const handleDebugStepOver = useCallback(() => {
    window.electronAPI?.debugStepOver?.();
  }, []);

  const handleDebugStepInto = useCallback(() => {
    window.electronAPI?.debugStepInto?.();
  }, []);

  const handleDebugStepOut = useCallback(() => {
    window.electronAPI?.debugStepOut?.();
  }, []);

  const handleDebugStop = useCallback(() => {
    window.electronAPI?.debugStop?.();
  }, []);

  const handleDebugRestart = useCallback(() => {
    if (window.electronAPI?.debugStop) {
      window.electronAPI.debugStop().then(() => {
        const { scriptPath, cwd } = debugLaunchConfigRef.current;
        if (scriptPath && window.electronAPI?.debugLaunch) {
          // Small delay to let the process fully terminate
          setTimeout(() => {
            window.electronAPI.debugLaunch({ scriptPath, cwd });
          }, 300);
        }
      }).catch(() => {
        // If stop fails, try launching anyway
        const { scriptPath, cwd } = debugLaunchConfigRef.current;
        if (scriptPath && window.electronAPI?.debugLaunch) {
          window.electronAPI.debugLaunch({ scriptPath, cwd });
        }
      });
    }
  }, []);

  // ---- Debug panel navigation callbacks ----
  const handleDebugNavigate = useCallback((filePath, line) => {
    if (!filePath || !ideActiveWorkspaceId) return;
    // Open the file in the editor
    dispatch({
      type: 'IDE_OPEN_FILE',
      workspaceId: ideActiveWorkspaceId,
      file: { path: filePath, name: filePath.split('/').pop() },
    });
    // Store a navigation target so CodeEditor can jump to the line
    dispatch({
      type: 'SET',
      key: 'ideNavigateToLine',
      value: { filePath, line, column: 1, ts: Date.now() },
    });
  }, [ideActiveWorkspaceId, dispatch]);

  const handleDebugNavigateToFrame = useCallback((source, line, column) => {
    if (!source || !ideActiveWorkspaceId) return;
    dispatch({
      type: 'IDE_OPEN_FILE',
      workspaceId: ideActiveWorkspaceId,
      file: { path: source, name: source.split('/').pop() },
    });
    dispatch({
      type: 'SET',
      key: 'ideNavigateToLine',
      value: { filePath: source, line, column: column || 1, ts: Date.now() },
    });
  }, [ideActiveWorkspaceId, dispatch]);

  // ---- Subscribe to debug push events ----
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const cleanups = [];

    // debug-paused: update session, call stack, scopes
    cleanups.push(window.electronAPI.on('debug-paused', (data) => {
      dispatch({
        type: 'DEBUG_SET_SESSION',
        session: {
          status: 'paused',
          pausedFile: data.pausedFile || data.file || null,
          pausedLine: data.pausedLine || data.line || null,
          threadId: data.threadId || null,
        },
      });
      if (data.callStack) {
        dispatch({ type: 'DEBUG_SET_CALL_STACK', callStack: data.callStack });
      }
      if (data.scopes) {
        dispatch({ type: 'DEBUG_SET_SCOPES', scopes: data.scopes });
      }
      // If scopes include variables, set them too
      if (data.scopes && Array.isArray(data.scopes)) {
        for (const scope of data.scopes) {
          if (scope.variables && scope.variablesReference) {
            dispatch({
              type: 'DEBUG_SET_VARIABLES',
              scopeId: scope.variablesReference,
              variables: scope.variables,
            });
          }
        }
      }
    }));

    // debug-resumed: set status to running
    cleanups.push(window.electronAPI.on('debug-resumed', () => {
      dispatch({
        type: 'DEBUG_SET_SESSION',
        session: { status: 'running', pausedFile: null, pausedLine: null },
      });
    }));

    // debug-stopped: clear all debug state
    cleanups.push(window.electronAPI.on('debug-stopped', () => {
      dispatch({ type: 'DEBUG_CLEAR_SESSION' });
    }));

    return () => {
      for (const cleanup of cleanups) {
        if (typeof cleanup === 'function') cleanup();
      }
    };
  }, [dispatch]);

  // ---- Cmd+Shift+F → open search panel ----
  useEffect(() => {
    function handleSearchShortcut(e) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        dispatch({ type: 'SET', key: 'ideSidebarView', value: 'search' });
        setTimeout(() => {
          var input = document.querySelector('.ide-search-input');
          if (input) input.focus();
        }, 50);
      }
    }
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [dispatch]);

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
        {/* File Explorer / Search Panel */}
        <div
          className="ide-explorer-panel"
          style={{ width: explorerWidth }}
        >
          {state.ideSidebarView === 'search' ? <SearchPanel /> : <FileExplorer />}
        </div>

        {/* Draggable Divider */}
        <div
          className={`ide-divider${isDragging ? ' dragging' : ''}`}
          onMouseDown={handleDividerMouseDown}
        />

        {/* Editor + Debug Panels Area */}
        <div className="ide-editor-area">
          {activeWsOpenFiles.length > 0 ? (
            <>
              <EditorTabs workspaceId={ideActiveWorkspaceId} />
              {/* Debug Toolbar — shown when debug session is active (not idle) */}
              {debugSession.status !== 'idle' && (
                <DebugToolbar
                  debugStatus={debugSession.status}
                  onLaunch={handleDebugLaunch}
                  onContinue={handleDebugContinue}
                  onPause={handleDebugPause}
                  onStepOver={handleDebugStepOver}
                  onStepInto={handleDebugStepInto}
                  onStepOut={handleDebugStepOut}
                  onStop={handleDebugStop}
                  onRestart={handleDebugRestart}
                />
              )}
              <div className="ide-editor-content">
                <div className="ide-editor-and-debug">
                  <div className="ide-editor-main">
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
                  {/* Debug Panels — right sidebar, shown when debug session is active */}
                  {debugSession.status !== 'idle' && (
                    <div className="ide-debug-sidebar">
                      <DebugPanels
                        onNavigateToFrame={handleDebugNavigateToFrame}
                        onNavigateToBreakpoint={handleDebugNavigate}
                      />
                    </div>
                  )}
                </div>
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
        onNavigate={handleDebugNavigate}
        embedded
      />
    </div>
  );
}
