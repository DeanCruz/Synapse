import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';
import ProjectModal from '@/shared/modals/ProjectModal.jsx';
import { saveDashboardProject } from '@/utils/dashboardProjects.js';

export default function ChatSidebar() {
  const {
    chatActiveView,
    chatTabs,
    chatActiveTabId,
    chatClaudeDashboardId,
    chatClaudeIsProcessing,
    chatClaudeProcessingStash,
    unreadChatCounts,
  } = useAppState();
  const dispatch = useDispatch();
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [settingsTabId, setSettingsTabId] = useState(null);
  const [menuOpenTabId, setMenuOpenTabId] = useState(null);
  const menuRef = useRef(null);
  const [renameTabId, setRenameTabId] = useState(null);
  const [renamePopupValue, setRenamePopupValue] = useState('');
  const pendingChatKeyRef = useRef(null);
  const pickedProjectRef = useRef(null);
  const projectSavedRef = useRef(false);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-width',
      collapsed ? '52px' : '220px'
    );
  }, [collapsed]);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpenTabId(null);
      }
    }
    if (menuOpenTabId) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpenTabId]);

  const isDashboardActive = chatActiveView === 'dashboard';
  const isMakeActive = chatActiveView === 'make';
  const isChatInstanceActive = chatActiveView === 'chat-instance';

  // --- New Project flow ---
  const handleNewProject = useCallback(() => {
    pickedProjectRef.current = null;
    projectSavedRef.current = false;
    pendingChatKeyRef.current = 'pending-chat-' + Date.now();
    setProjectModalOpen(true);
  }, []);

  const finalizeNewProject = useCallback(async (projectPath) => {
    let chatNumber = null;
    let agentHex = null;
    const api = window.electronAPI;
    if (api && typeof api.createChatAgent === 'function') {
      try {
        const result = await api.createChatAgent({ projectPath: projectPath || null });
        chatNumber = result?.chatNumber ?? null;
        agentHex = result?.agentHex ?? null;
      } catch (err) {
        console.error('createChatAgent failed:', err);
      }
    }
    if (agentHex && projectPath) {
      saveDashboardProject('chat-agent-' + agentHex, projectPath);
    }
    dispatch({ type: 'CHAT_TAB_CREATE', chatNumber, agentHex, projectPath: projectPath || null });
    pickedProjectRef.current = null;
    projectSavedRef.current = false;
    pendingChatKeyRef.current = null;
  }, [dispatch]);

  const handleProjectModalSave = useCallback((project) => {
    pickedProjectRef.current = project && project.path ? project.path : null;
    projectSavedRef.current = true;
  }, []);

  const handleProjectModalClose = useCallback(() => {
    setProjectModalOpen(false);
    const projectPath = projectSavedRef.current ? pickedProjectRef.current : null;
    if (projectPath) {
      finalizeNewProject(projectPath);
    }
  }, [finalizeNewProject]);

  const handleProjectSelected = useCallback((project) => {
    pickedProjectRef.current = project?.path || null;
  }, []);

  // --- Tab navigation ---
  const handleSwitchTab = useCallback((tabId) => {
    if (tabId !== chatActiveTabId || !isChatInstanceActive) {
      dispatch({ type: 'CHAT_TAB_SWITCH', tabId });
    }
  }, [chatActiveTabId, isChatInstanceActive, dispatch]);

  const handleSettingsModalClose = useCallback(() => {
    setSettingsTabId(null);
  }, []);

  // --- Delete (cleans up ALL subtab agents) ---
  const performDelete = useCallback(async (tabId) => {
    const tab = chatTabs.find(t => t.id === tabId);
    if (tab?.subtabs) {
      const api = window.electronAPI;
      if (api && typeof api.deleteChatAgent === 'function') {
        for (const sub of tab.subtabs) {
          if (sub.agentHex) {
            try { await api.deleteChatAgent(sub.agentHex); } catch (e) { /* */ }
          }
        }
      }
    }
    dispatch({ type: 'CHAT_TAB_DELETE', tabId });
    setDeleteConfirmId(null);
  }, [chatTabs, dispatch]);

  // --- Rename ---
  const handleRenameStart = useCallback((e, tab) => {
    e.stopPropagation();
    if (collapsed) return;
    setEditingId(tab.id);
    setEditingName(tab.name);
  }, [collapsed]);

  const handleRenameCommit = useCallback((tabId) => {
    const trimmed = editingName.trim();
    setEditingId(null);
    setEditingName('');
    if (!trimmed) return;
    const tab = chatTabs.find(t => t.id === tabId);
    if (!tab || trimmed === tab.name) return;
    dispatch({ type: 'CHAT_TAB_RENAME', tabId, name: trimmed });
  }, [editingName, chatTabs, dispatch]);

  const handleRenameCancel = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  const deletingTab = deleteConfirmId ? chatTabs.find(t => t.id === deleteConfirmId) : null;
  const renamingTab = renameTabId ? chatTabs.find(t => t.id === renameTabId) : null;

  const closeRenamePopup = useCallback(() => {
    setRenameTabId(null);
    setRenamePopupValue('');
  }, []);

  const submitRenamePopup = useCallback(() => {
    if (!renamingTab) return;
    const trimmed = renamePopupValue.trim();
    if (trimmed && trimmed !== renamingTab.name) {
      dispatch({ type: 'CHAT_TAB_RENAME', tabId: renamingTab.id, name: trimmed });
    }
    closeRenamePopup();
  }, [renamingTab, renamePopupValue, dispatch, closeRenamePopup]);

  // --- Aggregate status across subtabs for a project tab ---
  function getProjectStatus(tab) {
    let anyProcessing = false;
    let totalUnread = 0;
    for (const sub of (tab.subtabs || [])) {
      const ctxId = sub.agentHex ? 'chat-agent-' + sub.agentHex : null;
      if (!ctxId) continue;
      if (ctxId === chatClaudeDashboardId
        ? chatClaudeIsProcessing
        : !!chatClaudeProcessingStash?.[ctxId]?.isProcessing
      ) anyProcessing = true;
      totalUnread += unreadChatCounts?.[ctxId] || 0;
    }
    return { anyProcessing, totalUnread };
  }

  return (
    <aside className={`dashboard-sidebar chat-sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-tab-bar">
        <div className="sidebar-tab-row">
          <button
            className={`sidebar-tab${isDashboardActive ? ' active' : ''}`}
            title="Dashboard"
            aria-label="Chat Dashboard"
            onClick={() => dispatch({ type: 'SET_CHAT_VIEW', view: 'dashboard' })}
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
            className={`sidebar-tab${isMakeActive ? ' active' : ''}`}
            title="Make"
            aria-label="Make"
            onClick={() => dispatch({ type: 'SET_CHAT_VIEW', view: 'make' })}
          >
            <span className="sidebar-tab-icon">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
            <span className="sidebar-tab-label">Make</span>
          </button>
        </div>
        <div className="sidebar-tab-row">
          <button
            className="sidebar-tab chat-new-tab-btn"
            title="New project"
            aria-label="New project"
            onClick={handleNewProject}
          >
            <span className="sidebar-tab-icon">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h5l2-2h5v10H2V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              </svg>
            </span>
            <span className="sidebar-tab-label">New project</span>
            <span className="chat-new-tab-plus" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
          </button>
        </div>
      </div>

      {/* Project tab list */}
      <div className="dashboard-list">
        {chatTabs.map(tab => {
          const isActive = isChatInstanceActive && tab.id === chatActiveTabId;
          const { anyProcessing, totalUnread } = getProjectStatus(tab);
          const subtabCount = (tab.subtabs || []).length;

          let chatStatusClass = 'chat-idle';
          if (anyProcessing) chatStatusClass = 'chat-processing';
          else if (totalUnread > 0) chatStatusClass = 'chat-unread';

          return (
            <div
              key={tab.id}
              className={`dashboard-item${isActive ? ' active' : ''}`}
              onClick={() => handleSwitchTab(tab.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSwitchTab(tab.id); }}
            >
              <div className="dashboard-item-dot-wrap">
                <span
                  className={`chat-tab-status-dot ${chatStatusClass}`}
                  aria-hidden
                  title={
                    chatStatusClass === 'chat-processing' ? 'Responding...'
                    : chatStatusClass === 'chat-unread' ? 'New messages'
                    : 'Idle'
                  }
                />
              </div>
              <div className="dashboard-item-content">
                <div className="dashboard-item-header">
                  {editingId === tab.id ? (
                    <input
                      className="dashboard-item-rename-input"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => handleRenameCommit(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleRenameCommit(tab.id); }
                        if (e.key === 'Escape') handleRenameCancel();
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="dashboard-item-name"
                      onDoubleClick={(e) => handleRenameStart(e, tab)}
                    >
                      {tab.name}
                    </span>
                  )}
                  {editingId !== tab.id && (
                    <span
                      className={`chat-tab-bubble${totalUnread > 0 ? ' chat-unread' : ''}`}
                      title={totalUnread > 0 ? `${totalUnread} new message${totalUnread !== 1 ? 's' : ''}` : undefined}
                      aria-hidden
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M2 3h12v8H6l-4 3v-3H2V3z" stroke="currentColor" strokeWidth="1.4"/>
                        <circle cx="5.5" cy="7" r="0.8" fill="currentColor"/>
                        <circle cx="8" cy="7" r="0.8" fill="currentColor"/>
                        <circle cx="10.5" cy="7" r="0.8" fill="currentColor"/>
                      </svg>
                      {totalUnread > 0 && (
                        <span className="chat-action-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
                      )}
                    </span>
                  )}
                </div>
                <div className="chat-tab-bottom-row">
                  {editingId !== tab.id && (
                    <span className="chat-tab-project-badge" title={`${subtabCount} chat${subtabCount !== 1 ? 's' : ''}`}>
                      {subtabCount} chat{subtabCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {editingId !== tab.id && !collapsed && (
                    <div
                      className="dashboard-item-actions chat-tab-menu-wrap"
                      ref={menuOpenTabId === tab.id ? menuRef : null}
                    >
                      <button
                        className="dashboard-item-action-btn chat-settings-btn"
                        title="Project actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenTabId(prev => prev === tab.id ? null : tab.id);
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <circle cx="3" cy="8" r="1.4" fill="currentColor"/>
                          <circle cx="8" cy="8" r="1.4" fill="currentColor"/>
                          <circle cx="13" cy="8" r="1.4" fill="currentColor"/>
                        </svg>
                      </button>
                      {menuOpenTabId === tab.id && (
                        <div className="chat-tab-menu" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="chat-tab-menu-item"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenTabId(null);
                              setSettingsTabId(tab.id);
                            }}
                          >
                            Project configuration
                          </button>
                          <button
                            className="chat-tab-menu-item"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenTabId(null);
                              setRenameTabId(tab.id);
                              setRenamePopupValue(tab.name);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="chat-tab-menu-item chat-tab-menu-item-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenTabId(null);
                              setDeleteConfirmId(tab.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Project picker modal — opens when creating a new project tab */}
      {projectModalOpen && (
        <ProjectModal
          onClose={handleProjectModalClose}
          onSave={handleProjectModalSave}
          onProjectSelected={handleProjectSelected}
          dashboardId={pendingChatKeyRef.current || 'pending-chat'}
          pristine
        />
      )}

      {/* Per-project settings — uses the active subtab's dashboard key */}
      {settingsTabId && (() => {
        const tab = chatTabs.find(t => t.id === settingsTabId);
        const activeSub = tab?.subtabs?.find(s => s.id === tab.activeSubTabId) || tab?.subtabs?.[0];
        const dashId = activeSub?.agentHex ? 'chat-agent-' + activeSub.agentHex : settingsTabId;
        return (
          <ProjectModal
            onClose={handleSettingsModalClose}
            dashboardId={dashId}
          />
        );
      })()}

      {/* Rename popup */}
      {renamingTab && (
        <div className="sidebar-delete-overlay" onClick={closeRenamePopup}>
          <div className="sidebar-delete-popup" onClick={e => e.stopPropagation()}>
            <div className="sidebar-delete-popup-title">Rename Project</div>
            <p className="sidebar-delete-popup-text">
              Enter a new name for this project tab.
            </p>
            <input
              className="sidebar-rename-popup-input"
              value={renamePopupValue}
              onChange={(e) => setRenamePopupValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitRenamePopup(); }
                if (e.key === 'Escape') { e.preventDefault(); closeRenamePopup(); }
              }}
              autoFocus
            />
            <div className="sidebar-delete-popup-actions">
              <button
                className="sidebar-delete-popup-btn archive"
                onClick={submitRenamePopup}
              >
                Save
              </button>
              <button
                className="sidebar-delete-popup-btn cancel"
                onClick={closeRenamePopup}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation popup */}
      {deletingTab && (
        <div className="sidebar-delete-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="sidebar-delete-popup" onClick={e => e.stopPropagation()}>
            <div className="sidebar-delete-popup-title">Delete Project?</div>
            <p className="sidebar-delete-popup-text">
              Delete <strong>{deletingTab.name}</strong> and all its chats? This cannot be undone.
            </p>
            <div className="sidebar-delete-popup-actions">
              <button
                className="sidebar-delete-popup-btn archive"
                onClick={() => performDelete(deletingTab.id)}
              >
                Delete
              </button>
              <button
                className="sidebar-delete-popup-btn cancel"
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer — Settings */}
      <div className="sidebar-footer">
        <button
          className="sidebar-settings-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => dispatch({ type: 'OPEN_MODAL', modal: 'settings' })}
        >
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
