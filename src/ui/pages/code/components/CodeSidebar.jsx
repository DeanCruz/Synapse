// CodeSidebar — Dashboard selector with status dots, per-dashboard Project/Agent buttons,
// add/delete dashboard controls, collapse toggle, drag-and-drop reorder, inline rename,
// and queue section

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';
import { getDashboardLabel } from '@/utils/constants.js';
import { getDashboardProject, saveDashboardProject } from '@/utils/dashboardProjects.js';
import '@/pages/code/subpages/code-explorer/styles/ide-sidebar.css';

function StatusDot({ status }) {
  let cls = 'dashboard-item-status idle';
  if (status === 'in_progress') cls = 'dashboard-item-status in-progress';
  else if (status === 'waiting') cls = 'dashboard-item-status waiting';
  else if (status === 'completed') cls = 'dashboard-item-status completed';
  else if (status === 'error') cls = 'dashboard-item-status error';
  else if (status === 'idle') cls = 'dashboard-item-status idle';
  return <span className={cls} />;
}

function getProjectDisplayName(dashboardId) {
  const projectPath = getDashboardProject(dashboardId);
  if (!projectPath) return null;
  const parts = projectPath.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || null;
}

/**
 * Resolve display name: custom name > project name > getDashboardLabel fallback.
 */
function getDisplayName(id, dashboardNames) {
  const customName = dashboardNames?.[id];
  if (customName) return customName;
  const projectName = getProjectDisplayName(id);
  if (projectName) return projectName;
  return getDashboardLabel(id);
}

export default function CodeSidebar() {
  const state = useAppState();
  const dispatch = useDispatch();
  const { currentDashboardId, dashboardStates, dashboardList, dashboardNames, queueItems, activeView, chatPreviews, unreadChatCounts, claudeIsProcessing, claudeProcessingStash, archivedDashboard } = state;

  const [collapsed, setCollapsed] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, taskName } or null

  // Keep --sidebar-width CSS variable in sync with collapse state
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-width',
      collapsed ? '52px' : '220px'
    );
  }, [collapsed]);

  // Rename state
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  // Drag-and-drop state
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const dragCounterRef = useRef(0);

  // Use dashboardList from server (populated via SSE/IPC), fall back to currentDashboardId
  const allDashboards = dashboardList.length > 0 ? dashboardList : [];

  // All dashboards render uniformly — no IDE-special handling.
  const dashboards = [...allDashboards];

  function handleSwitch(id) {
    if (archivedDashboard) {
      dispatch({ type: 'CLEAR_ARCHIVED_DASHBOARD' });
    }
    if (id !== currentDashboardId) {
      dispatch({ type: 'SWITCH_DASHBOARD', id });
    }
    // Switch to dashboard view unless already in claude chat (preserve chat state)
    if (activeView !== 'claude') {
      dispatch({ type: 'SET_VIEW', view: 'dashboard' });
    }
  }

  function handleClaudeClick(e, dashboardId) {
    e.stopPropagation();
    if (dashboardId !== currentDashboardId) {
      dispatch({ type: 'SWITCH_DASHBOARD', id: dashboardId });
    }
    dispatch({ type: 'CLAUDE_SET_VIEW_MODE', mode: 'maximized' });
    dispatch({ type: 'SET_VIEW', view: 'claude', dashboardId });
  }

  const handleAddDashboard = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      // Open folder picker first — cancel aborts dashboard creation
      const folderPath = await api.ideSelectFolder();
      if (!folderPath) return;

      const result = await api.createDashboard();
      if (result && result.id) {
        saveDashboardProject(result.id, folderPath);
        dispatch({ type: 'SWITCH_DASHBOARD', id: result.id });
      }
    } catch (err) {
      console.error('Failed to create dashboard:', err);
    }
  }, [dispatch]);

  const handleDeleteClick = useCallback((e, id) => {
    e.stopPropagation();
    // Check if an agent chat is actively processing on this dashboard
    const isChatActive = id === currentDashboardId
      ? claudeIsProcessing
      : !!claudeProcessingStash[id]?.isProcessing;
    // Check if dashboard has task/swarm data
    const dashStatus = dashboardStates[id];
    const hasTaskData = dashStatus && dashStatus !== 'idle';

    if (isChatActive) {
      // Agent is running — show active-agent popup
      setDeleteConfirm({ id, taskName: null, agentActive: true, hasTaskData });
      // Try to get the actual task name if there's task data
      if (hasTaskData) {
        const api = window.electronAPI;
        if (api) {
          api.getDashboardInit(id).then(initData => {
            if (initData && initData.task && initData.task.name) {
              setDeleteConfirm(prev => prev && prev.id === id ? { ...prev, taskName: initData.task.name } : prev);
            }
          }).catch(() => {});
        }
      }
    } else if (hasTaskData) {
      // No active agent but has task data — existing flow
      setDeleteConfirm({ id, taskName: 'active task data', agentActive: false, hasTaskData: true });
      const api = window.electronAPI;
      if (api) {
        api.getDashboardInit(id).then(initData => {
          if (initData && initData.task && initData.task.name) {
            setDeleteConfirm(prev => prev && prev.id === id ? { ...prev, taskName: initData.task.name } : prev);
          }
        }).catch(() => {});
      }
    } else {
      // No data, no active agent — delete directly (but don't allow deleting the last dashboard)
      if (dashboards.length <= 1) return;
      performDelete(id);
    }
  }, [dashboardStates, dashboards.length, state.allDashboardProgress, currentDashboardId, claudeIsProcessing, claudeProcessingStash]);

  const performDelete = useCallback(async (id, archive = false) => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      if (archive) {
        await api.archiveDashboard(id);
      }
      // If we're deleting the active dashboard, switch first
      if (id === currentDashboardId) {
        const remaining = dashboards.filter(d => d !== id);
        if (remaining.length > 0) {
          dispatch({ type: 'SWITCH_DASHBOARD', id: remaining[0] });
        }
      }
      await api.deleteDashboard(id);
      dispatch({ type: 'REMOVE_DASHBOARD', id });
    } catch (err) {
      console.error('Failed to delete dashboard:', err);
    }
    setDeleteConfirm(null);
  }, [currentDashboardId, dashboards, dispatch]);

  // --- Rename handlers ---

  const handleRenameStart = useCallback((e, id) => {
    e.stopPropagation();
    if (collapsed) return;
    setEditingId(id);
    setEditingName(getDisplayName(id, dashboardNames));
  }, [collapsed, dashboardNames]);

  const handleRenameCommit = useCallback(async (id) => {
    const trimmed = editingName.trim();
    setEditingId(null);
    setEditingName('');
    if (!trimmed) return;
    const currentDisplay = getDisplayName(id, dashboardNames);
    if (trimmed === currentDisplay) return;
    dispatch({ type: 'RENAME_DASHBOARD', id, name: trimmed });
    const api = window.electronAPI;
    if (api) {
      await api.renameDashboard(id, trimmed);
    }
  }, [editingName, dashboardNames, dispatch]);

  const handleRenameCancel = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  // --- Drag-and-drop handlers ---

  const handleDragStart = useCallback((e, id) => {
    if (collapsed) { e.preventDefault(); return; }
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    requestAnimationFrame(() => {
      if (e.target) e.target.style.opacity = '0.4';
    });
  }, [collapsed]);

  const handleDragEnd = useCallback((e) => {
    if (e.target) e.target.style.opacity = '';
    setDragId(null);
    setDragOverId(null);
    dragCounterRef.current = 0;
  }, []);

  const handleDragEnter = useCallback((e, id) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragOverId(id);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragLeave = useCallback((e, id) => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      if (dragOverId === id) setDragOverId(null);
    }
  }, [dragOverId]);

  const handleDrop = useCallback(async (e, targetId) => {
    e.preventDefault();
    setDragOverId(null);
    dragCounterRef.current = 0;
    const sourceId = dragId;
    setDragId(null);

    if (!sourceId || sourceId === targetId) return;

    // Reorder within the full dashboardList.
    const currentOrder = [...allDashboards];
    const sourceIdx = currentOrder.indexOf(sourceId);
    const targetIdx = currentOrder.indexOf(targetId);
    if (sourceIdx < 0 || targetIdx < 0) return;

    currentOrder.splice(sourceIdx, 1);
    currentOrder.splice(targetIdx, 0, sourceId);

    dispatch({ type: 'REORDER_DASHBOARDS', orderedIds: currentOrder });

    const api = window.electronAPI;
    if (api) {
      await api.reorderDashboards(currentOrder);
    }
  }, [dragId, allDashboards, dispatch]);

  // Determine which sidebar tab is active
  const isIdeActive = activeView === 'ide';
  const isGitActive = activeView === 'git';
  const isPreviewActive = activeView === 'preview';
  const isDashboardActive = !isIdeActive && !isGitActive && !isPreviewActive;

  return (
    <aside className={`dashboard-sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* Sidebar header — two rows */}
      <div className="sidebar-tab-bar">
        <div className="sidebar-tab-row">
          <button
            className={`sidebar-tab${isIdeActive ? ' active' : ''}`}
            title="Code Explorer"
            aria-label="Code Explorer"
            onClick={() => {
              dispatch({ type: 'SET_VIEW', view: 'ide' });
            }}
          >
            <span className="sidebar-tab-icon">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M5.5 4L2 8l3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10.5 4L14 8l-3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <span className="sidebar-tab-label">Code Explorer</span>
          </button>
          <button
            className="sidebar-toggle-btn"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed(c => !c)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <div className="sidebar-tab-row">
          <button
            className={`sidebar-tab${isDashboardActive ? ' active' : ''}`}
            title="Dashboard"
            aria-label="Dashboard"
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'dashboard' })}
          >
            <span className="sidebar-tab-icon">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
            </span>
            <span className="sidebar-tab-label">Dashboard</span>
          </button>
          <button
            className="sidebar-add-btn"
            title="Add dashboard"
            aria-label="Add dashboard"
            onClick={handleAddDashboard}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="sidebar-tab-row">
          <button
            className={`sidebar-tab${isGitActive ? ' active' : ''}`}
            title="Git Manager"
            aria-label="Git Manager"
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'git' })}
          >
            <span className="sidebar-tab-icon">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M6 2v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M6 14v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M6 10c2 0 4-1 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                <circle cx="6" cy="14" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                <circle cx="10" cy="5" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              </svg>
            </span>
            <span className="sidebar-tab-label">Git Manager</span>
          </button>
        </div>
        <div className="sidebar-tab-row">
          <button
            className={`sidebar-tab${isPreviewActive ? ' active' : ''}`}
            title="Preview"
            aria-label="Preview"
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'preview' })}
          >
            <span className="sidebar-tab-icon">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
            </span>
            <span className="sidebar-tab-label">Preview</span>
          </button>
        </div>
      </div>

      {/* Dashboard list */}
      <div className="dashboard-list">
        {dashboards.map(id => {
          const status = dashboardStates[id] ?? 'idle';
          const isActive = id === currentDashboardId;
          const projectPath = getDashboardProject(id);
          const unreadCount = unreadChatCounts[id] || 0;
          const isChatProcessing = id === currentDashboardId ? claudeIsProcessing : !!claudeProcessingStash[id]?.isProcessing;
          const isDraggable = !collapsed;
          const itemClasses = [
            'dashboard-item',
            isActive ? 'active' : '',
            unreadCount > 0 ? 'has-unread' : '',
            dragOverId === id && dragId !== id ? 'drag-over' : '',
            dragId === id ? 'dragging' : '',
          ].filter(Boolean).join(' ');

          return (
            <div
              key={id}
              className={itemClasses}
              onClick={() => handleSwitch(id)}
              role="button"
              tabIndex={0}
              title={unreadCount > 0 ? `${unreadCount} new message${unreadCount !== 1 ? 's' : ''}` : undefined}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSwitch(id); }}
              draggable={isDraggable}
              onDragStart={(e) => handleDragStart(e, id)}
              onDragEnd={handleDragEnd}
              onDragEnter={(e) => handleDragEnter(e, id)}
              onDragOver={(e) => handleDragOver(e)}
              onDragLeave={(e) => handleDragLeave(e, id)}
              onDrop={(e) => handleDrop(e, id)}
            >
              <div className="dashboard-item-dot-wrap">
                <StatusDot status={status} />
              </div>
              <div className="dashboard-item-content">
                <div className="dashboard-item-header">
                  {editingId === id ? (
                    <input
                      className="dashboard-item-rename-input"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => handleRenameCommit(id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleRenameCommit(id); }
                        if (e.key === 'Escape') handleRenameCancel();
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="dashboard-item-name"
                      title={projectPath || undefined}
                      onDoubleClick={(e) => handleRenameStart(e, id)}
                    >
                      {getDisplayName(id, dashboardNames)}
                    </span>
                  )}
                  {!collapsed && editingId !== id && (
                    <span className="dashboard-item-id">#{id}</span>
                  )}
                </div>
                {!collapsed && editingId !== id && (
                  <div className="dashboard-item-meta">
                    {chatPreviews[id]?.text ? (
                      <span className={`dashboard-item-preview${chatPreviews[id].isStreaming ? ' streaming' : ''}`}>
                        {chatPreviews[id].text.length > 45
                          ? chatPreviews[id].text.substring(0, 45) + '...'
                          : chatPreviews[id].text}
                      </span>
                    ) : (
                      <span className="dashboard-item-preview dashboard-item-status-label">{status}</span>
                    )}
                    <div className="dashboard-item-actions">
                      <button
                        className={[
                          'dashboard-item-action-btn',
                          'chat-action-btn',
                          isChatProcessing ? 'chat-processing' : '',
                          unreadCount > 0 ? 'chat-unread' : '',
                        ].filter(Boolean).join(' ')}
                        title="Agent Chat"
                        onClick={(e) => handleClaudeClick(e, id)}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path d="M2 3h12v8H6l-4 3v-3H2V3z" stroke="currentColor" strokeWidth="1.4"/>
                          <circle cx="5.5" cy="7" r="0.8" fill="currentColor"/>
                          <circle cx="8" cy="7" r="0.8" fill="currentColor"/>
                          <circle cx="10.5" cy="7" r="0.8" fill="currentColor"/>
                        </svg>
                        {unreadCount > 0 && (
                          <span className="chat-action-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                        )}
                      </button>
                      {dashboards.length > 1 && (
                        <button
                          className="dashboard-item-action-btn dashboard-delete-btn"
                          title="Delete dashboard"
                          onClick={(e) => handleDeleteClick(e, id)}
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Queue items */}
        {queueItems.length > 0 && (
          <>
            <div className="dashboard-item queue-count-item">
              <span className="dashboard-item-status queue-dot" />
              <span className="dashboard-item-name">{queueItems.length} queued</span>
            </div>
            {queueItems.map((item, idx) => (
              <div key={item.id ?? idx} className="dashboard-item queue-item">
                <span className="dashboard-item-status queue-dot" />
                <span className="dashboard-item-name">{item.name ?? `Queue ${idx + 1}`}</span>
              </div>
            ))}
          </>
        )}

        {/* Archived dashboard tab (temporary) */}
        {archivedDashboard && (
          <div
            className="dashboard-item archived-item active"
            onClick={() => dispatch({ type: 'SET_VIEW', view: 'dashboard' })}
            role="button"
            tabIndex={0}
          >
            <div className="dashboard-item-dot-wrap">
              <span className="dashboard-item-status completed" />
            </div>
            <div className="dashboard-item-content">
              <div className="dashboard-item-header">
                <span className="dashboard-item-name archived-name">
                  Archived — {archivedDashboard.taskName}
                </span>
              </div>
              {!collapsed && (
                <div className="dashboard-item-meta">
                  <span className="dashboard-item-preview dashboard-item-status-label">archived</span>
                  <div className="dashboard-item-actions">
                    <button
                      className="dashboard-item-action-btn dashboard-delete-btn"
                      title="Close archived view"
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'CLEAR_ARCHIVED_DASHBOARD' });
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation popup */}
      {deleteConfirm && (
        <div className="sidebar-delete-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="sidebar-delete-popup" onClick={e => e.stopPropagation()}>
            {deleteConfirm.agentActive ? (
              <>
                <div className="sidebar-delete-popup-title agent-active">Agent Active</div>
                <p className="sidebar-delete-popup-text">
                  <strong>{getDisplayName(deleteConfirm.id, dashboardNames)}</strong> has an agent currently running.
                  {deleteConfirm.hasTaskData && deleteConfirm.taskName ? ` Task: ${deleteConfirm.taskName}.` : ''}
                </p>
                <div className="sidebar-delete-popup-actions">
                  {deleteConfirm.hasTaskData ? (
                    <button
                      className="sidebar-delete-popup-btn archive"
                      onClick={() => performDelete(deleteConfirm.id, true)}
                    >
                      Archive All & Close
                    </button>
                  ) : (
                    <button
                      className="sidebar-delete-popup-btn archive"
                      onClick={() => performDelete(deleteConfirm.id, false)}
                    >
                      Archive Chat & Close
                    </button>
                  )}
                  <button
                    className="sidebar-delete-popup-btn cancel"
                    onClick={() => setDeleteConfirm(null)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="sidebar-delete-popup-title">Close Dashboard?</div>
                <p className="sidebar-delete-popup-text">
                  <strong>{getDisplayName(deleteConfirm.id, dashboardNames)}</strong> has data
                  {deleteConfirm.taskName ? ` (${deleteConfirm.taskName})` : ''}.
                </p>
                <div className="sidebar-delete-popup-actions">
                  <button
                    className="sidebar-delete-popup-btn archive"
                    onClick={() => performDelete(deleteConfirm.id, true)}
                  >
                    Archive & Close
                  </button>
                  <button
                    className="sidebar-delete-popup-btn cancel"
                    onClick={() => setDeleteConfirm(null)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Footer — Settings */}
      <div className="sidebar-footer">
        <button className="sidebar-settings-btn" title="Settings" aria-label="Settings" onClick={() => dispatch({ type: 'OPEN_MODAL', modal: 'settings' })}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M3.93 3.93l1.77 1.77M10.3 10.3l1.77 1.77M3.93 12.07l1.77-1.77M10.3 5.7l1.77-1.77" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <span className="sidebar-settings-label">Settings</span>
        </button>
      </div>
    </aside>
  );
}

