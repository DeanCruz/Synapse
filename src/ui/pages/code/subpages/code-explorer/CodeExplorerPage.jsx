// CodeExplorerPage — main IDE layout component
// Assembles FileExplorer, EditorTabs, CodeEditor,
// DebugToolbar, DebugPanels, and a VS Code-style BottomPanel (Terminal, Output,
// Problems, Debug Console, etc.)
//
// IDE context is keyed entirely by currentDashboardId — the orthogonal sidebar
// dashboard list now drives which project is active. There is no separate
// workspace tab bar.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';
import FileExplorer from './components/FileExplorer.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import EditorTabs from './components/EditorTabs.jsx';
import CodeEditor from './components/CodeEditor.jsx';
import DebugToolbar from './components/DebugToolbar.jsx';
import DebugPanels from './components/DebugPanels.jsx';
import BottomPanel from '@/pages/code/subpages/dashboards/components/BottomPanel.jsx';
import { getDashboardProject, saveDashboardProject } from '@/utils/dashboardProjects.js';
import './styles/ide-layout.css';
import './styles/ide-debug.css';
import './styles/ide-debug-panels.css';
import './styles/ide-debug-console.css';

const MIN_EXPLORER_WIDTH = 180;
const MAX_EXPLORER_WIDTH = 500;
const DEFAULT_EXPLORER_WIDTH = 250;

export default function CodeExplorerPage() {
  const state = useAppState();
  const {
    ideOpenFiles,
    ideActiveFileId,
    currentDashboardId,
    dashboardList,
    dashboardNames,
    currentLogs,
    activeLogFilter,
    debugSession,
  } = state;
  const dispatch = useDispatch();

  const projectPath = currentDashboardId ? getDashboardProject(currentDashboardId) : null;

  // ---- Debug launch config ref (persists across restarts) ----
  const debugLaunchConfigRef = useRef({ scriptPath: '', cwd: '' });

  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: 0 });
  // Tick state used to force a re-render after saveDashboardProject writes to
  // localStorage (since localStorage isn't reactive).
  const [, setProjectTick] = useState(0);

  // NOTE: File tree loading is handled exclusively by FileExplorer.jsx, which
  // uses the lazy-load pattern (ideListDir per directory). A previous recursive
  // ideReadDir effect lived here, but its response wrapper ({success, tree})
  // was being stored directly into ideFileTrees — when the recursive call
  // completed (often several seconds later), it overwrote the populated tree
  // with a malformed object, visually collapsing the explorer.

  // NOTE: Dashboards are now created from the sidebar's "+" button. The IDE
  // workspace concept has been removed; switching the active dashboard
  // (via the sidebar) is the only way to switch the IDE's active project.

  // ---- Set Project handler (folder picker + saveDashboardProject) ----
  const handleSetProject = useCallback(async () => {
    if (!currentDashboardId) return;
    if (!window.electronAPI?.ideSelectFolder) return;
    try {
      const picked = await window.electronAPI.ideSelectFolder();
      if (!picked) return;
      saveDashboardProject(currentDashboardId, picked);
      // Force a re-render so the new project path is read from localStorage.
      setProjectTick(t => t + 1);
    } catch (e) {
      // Silently ignore — user cancellation or IPC error
    }
  }, [currentDashboardId]);

  // ---- Debug IPC callbacks ----
  const handleDebugLaunch = useCallback((scriptPath, args) => {
    const cwd = projectPath || '';
    debugLaunchConfigRef.current = { scriptPath, cwd };
    if (window.electronAPI?.debugLaunch) {
      window.electronAPI.debugLaunch({ scriptPath, args, cwd });
    }
  }, [projectPath]);

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
    if (!filePath || !currentDashboardId) return;
    // Open the file in the editor
    dispatch({
      type: 'IDE_OPEN_FILE',
      dashboardId: currentDashboardId,
      file: { path: filePath, name: filePath.split('/').pop() },
    });
    // Store a navigation target so CodeEditor can jump to the line
    dispatch({
      type: 'SET',
      key: 'ideNavigateToLine',
      value: { filePath, line, column: 1, ts: Date.now() },
    });
  }, [currentDashboardId, dispatch]);

  const handleDebugNavigateToFrame = useCallback((source, line, column) => {
    if (!source || !currentDashboardId) return;
    dispatch({
      type: 'IDE_OPEN_FILE',
      dashboardId: currentDashboardId,
      file: { path: source, name: source.split('/').pop() },
    });
    dispatch({
      type: 'SET',
      key: 'ideNavigateToLine',
      value: { filePath: source, line, column: column || 1, ts: Date.now() },
    });
  }, [currentDashboardId, dispatch]);

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

  // Derive current open files / active file using the dashboard-keyed slices
  const activeWsOpenFiles = currentDashboardId
    ? (ideOpenFiles[currentDashboardId] || [])
    : [];
  const activeFileId = currentDashboardId
    ? (ideActiveFileId[currentDashboardId] || null)
    : null;
  const activeFile = activeWsOpenFiles.find(f => f.id === activeFileId) || null;

  const hasDashboards = Array.isArray(dashboardList) && dashboardList.length > 0;
  const hasActiveDashboard = !!currentDashboardId;
  const hasProject = !!projectPath;

  // ---- Empty state: no dashboard selected (or none exist) ----
  if (!hasActiveDashboard) {
    return (
      <div className="ide-view">
        <div className="ide-empty-state">
          <svg className="ide-empty-state-icon" viewBox="0 0 48 48" fill="none">
            <rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M16 16h16M16 22h12M16 28h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <div className="ide-empty-state-title">
            {hasDashboards ? 'Select a dashboard' : 'Select or create a dashboard'}
          </div>
          <div className="ide-empty-state-text">
            {hasDashboards
              ? 'Choose a dashboard from the sidebar to open its Code Explorer.'
              : 'Create a dashboard from the sidebar to start exploring code.'}
          </div>
        </div>
        <BottomPanel
          logs={currentLogs}
          activeFilter={activeLogFilter}
          onFilterChange={(level) => dispatch({ type: 'SET', key: 'activeLogFilter', value: level })}
          projectDir={projectPath}
          dashboardId={currentDashboardId}
          embedded
        />
      </div>
    );
  }

  // ---- Empty state: dashboard has no project bound ----
  if (!hasProject) {
    const dashName =
      (dashboardNames && dashboardNames[currentDashboardId]) || currentDashboardId;
    return (
      <div className="ide-view">
        <div className="ide-empty-state">
          <svg className="ide-empty-state-icon" viewBox="0 0 48 48" fill="none">
            <rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M16 16h16M16 22h12M16 28h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <div className="ide-empty-state-title">Project not set</div>
          <div className="ide-empty-state-text">
            Dashboard <strong>{dashName}</strong> doesn't have a project folder yet.
            Pick one to start browsing code.
          </div>
          <button
            type="button"
            className="ide-empty-state-button"
            onClick={handleSetProject}
          >
            Set Project
          </button>
        </div>
        <BottomPanel
          logs={currentLogs}
          activeFilter={activeLogFilter}
          onFilterChange={(level) => dispatch({ type: 'SET', key: 'activeLogFilter', value: level })}
          projectDir={projectPath}
          dashboardId={currentDashboardId}
          embedded
        />
      </div>
    );
  }

  return (
    <div className="ide-view">
      <div className="ide-main">
        {/* File Explorer / Search Panel */}
        <div
          className="ide-explorer-panel"
          style={{ width: explorerWidth }}
        >
          {state.ideSidebarView === 'search'
            ? <SearchPanel dashboardId={currentDashboardId} />
            : <FileExplorer dashboardId={currentDashboardId} />}
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
              <EditorTabs dashboardId={currentDashboardId} />
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
                        dashboardId={currentDashboardId}
                        workspacePath={projectPath}
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
        projectDir={projectPath}
        dashboardId={currentDashboardId}
        onNavigate={handleDebugNavigate}
        embedded
      />
    </div>
  );
}
