import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import ProjectModal from '../modals/ProjectModal.jsx';
import { saveDashboardProject, clearDashboardProject, getDashboardProject } from '../../utils/dashboardProjects.js';

function getChatProjectName(agentHex) {
  if (!agentHex) return null;
  const projectPath = getDashboardProject('chat-agent-' + agentHex);
  if (!projectPath) return null;
  const parts = projectPath.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || null;
}

export default function ChatSidebar() {
  const {
    chatActiveView,
    chatTabs,
    chatActiveTabId,
    currentDashboardId,
    claudeIsProcessing,
    claudeProcessingStash,
    unreadChatCounts,
  } = useAppState();
  const dispatch = useDispatch();
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  // New-chat flow:
  //   1. user clicks New chat -> projectPromptOpen=true (Yes/No popup)
  //   2. Yes -> projectModalOpen=true; project picks accumulate in pickedProjectRef
  //      No  -> finalize immediately with no project
  //   3. ProjectModal close -> finalize using whatever was picked (or none)
  const [projectPromptOpen, setProjectPromptOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  // Tab-id of the chat whose settings (project picker) modal is open, or null.
  // Distinct from projectModalOpen which is reserved for the new-chat flow.
  const [settingsTabId, setSettingsTabId] = useState(null);
  // Tab-id of the chat whose action dropdown menu is open, or null.
  const [menuOpenTabId, setMenuOpenTabId] = useState(null);
  const menuRef = useRef(null);
  // Tab being renamed via the popup (distinct from the inline double-click edit).
  const [renameTabId, setRenameTabId] = useState(null);
  const [renamePopupValue, setRenamePopupValue] = useState('');
  // Pseudo-id used by ProjectModal's localStorage helpers when this chat has no
  // disk path yet. Resolved before opening the modal so onProjectSelected can
  // key off it deterministically.
  const pendingChatKeyRef = useRef(null);
  const pickedProjectRef = useRef(null);
  // Tracks whether the user clicked Save (vs Cancel/X) inside ProjectModal.
  // Cancel must NOT carry over the most-recently-clicked project; Save must.
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

  // Step 1 — open the Yes/No popup. The actual chat/agent creation happens in
  // finalizeNewChat once the user has answered (and optionally picked a project).
  const handleNewChat = useCallback(() => {
    pickedProjectRef.current = null;
    projectSavedRef.current = false;
    pendingChatKeyRef.current = 'pending-chat-' + Date.now();
    setProjectPromptOpen(true);
  }, []);

  // Step 3 — actually create the chat. Calls the IPC to allocate a unique
  // 4-hex agent and create the on-disk Chat/chat{N}/agent{XXXX}/ folder, then
  // dispatches CHAT_TAB_CREATE so the sidebar shows the new tab.
  const finalizeNewChat = useCallback(async (projectPath) => {
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
    // Persist the project at the chat-agent's real dashboard key so the chat
    // header badge and message-spawn lookups resolve to the correct project.
    // The pending-chat-XXX key the modal wrote to is orphaned by design.
    if (agentHex) {
      const realKey = 'chat-agent-' + agentHex;
      if (projectPath) {
        saveDashboardProject(realKey, projectPath);
      } else {
        clearDashboardProject(realKey);
      }
    }
    dispatch({ type: 'CHAT_TAB_CREATE', chatNumber, agentHex, projectPath: projectPath || null });
    pickedProjectRef.current = null;
    projectSavedRef.current = false;
    pendingChatKeyRef.current = null;
  }, [dispatch]);

  const handleProjectPromptYes = useCallback(() => {
    setProjectPromptOpen(false);
    setProjectModalOpen(true);
  }, []);

  const handleProjectPromptNo = useCallback(() => {
    setProjectPromptOpen(false);
    finalizeNewChat(null);
  }, [finalizeNewChat]);

  // The modal calls onSave (Save click) THEN onClose, or onClose alone (Cancel/X).
  // onSave stages the picked project; onClose performs the actual finalize using
  // the staged value when saved, or null when cancelled.
  const handleProjectModalSave = useCallback((project) => {
    pickedProjectRef.current = project && project.path ? project.path : null;
    projectSavedRef.current = true;
  }, []);

  const handleProjectModalClose = useCallback(() => {
    setProjectModalOpen(false);
    const projectPath = projectSavedRef.current ? pickedProjectRef.current : null;
    finalizeNewChat(projectPath);
  }, [finalizeNewChat]);

  const handleProjectSelected = useCallback((project) => {
    if (project && project.path) {
      pickedProjectRef.current = project.path;
    } else {
      pickedProjectRef.current = null;
    }
  }, []);

  const handleSwitchTab = useCallback((tabId) => {
    if (tabId !== chatActiveTabId || !isChatInstanceActive) {
      dispatch({ type: 'CHAT_TAB_SWITCH', tabId });
    }
  }, [chatActiveTabId, isChatInstanceActive, dispatch]);

  const handleSettingsModalClose = useCallback(() => {
    setSettingsTabId(null);
  }, []);

  const performDelete = useCallback((tabId) => {
    dispatch({ type: 'CHAT_TAB_DELETE', tabId });
    setDeleteConfirmId(null);
  }, [dispatch]);

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
            title="New chat"
            aria-label="New chat"
            onClick={handleNewChat}
          >
            <span className="sidebar-tab-icon">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M2 3h12v8H6l-4 3v-3H2V3z" stroke="currentColor" strokeWidth="1.4"/>
              </svg>
            </span>
            <span className="sidebar-tab-label">New chat</span>
            <span className="chat-new-tab-plus" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
          </button>
        </div>
      </div>

      {/* Chat tab list */}
      <div className="dashboard-list">
        {chatTabs.map(tab => {
          const isActive = isChatInstanceActive && tab.id === chatActiveTabId;
          const projectName = getChatProjectName(tab.agentHex);

          // Compute chat status dot state for this tab.
          // Grey (idle): not responding and no unread.
          // Pulsing purple (responding): assistant is currently streaming.
          // Green (unread): assistant has finished and the chat hasn't been opened yet.
          const dashId = tab.agentHex ? 'chat-agent-' + tab.agentHex : null;
          const isChatProcessing = dashId
            ? (dashId === currentDashboardId
                ? claudeIsProcessing
                : !!claudeProcessingStash?.[dashId]?.isProcessing)
            : false;
          const unreadCount = dashId ? (unreadChatCounts?.[dashId] || 0) : 0;
          let chatStatusClass = 'chat-idle';
          if (isChatProcessing) chatStatusClass = 'chat-processing';
          else if (unreadCount > 0) chatStatusClass = 'chat-unread';

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
                    chatStatusClass === 'chat-processing' ? 'Responding…'
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
                      className={`chat-tab-bubble${unreadCount > 0 ? ' chat-unread' : ''}`}
                      title={unreadCount > 0 ? `${unreadCount} new message${unreadCount !== 1 ? 's' : ''}` : undefined}
                      aria-hidden
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
                    </span>
                  )}
                </div>
                <div className="chat-tab-bottom-row">
                  {editingId !== tab.id && (
                    projectName ? (
                      <span className="chat-tab-project-badge" title={projectName}>
                        {projectName}
                      </span>
                    ) : (
                      <span className="chat-tab-project-badge no-project" title="No project">
                        No project
                      </span>
                    )
                  )}
                  {editingId !== tab.id && !collapsed && (
                    <div
                      className="dashboard-item-actions chat-tab-menu-wrap"
                      ref={menuOpenTabId === tab.id ? menuRef : null}
                    >
                      <button
                        className="dashboard-item-action-btn chat-settings-btn"
                        title="Chat actions"
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

      {/* Associate-project popup — shown after clicking New chat */}
      {projectPromptOpen && (
        <div className="sidebar-delete-overlay" onClick={handleProjectPromptNo}>
          <div className="sidebar-delete-popup" onClick={e => e.stopPropagation()}>
            <div className="sidebar-delete-popup-title">Associate a Project?</div>
            <p className="sidebar-delete-popup-text">
              Would you like to associate a project with this new chat? You can change this later.
            </p>
            <div className="sidebar-delete-popup-actions">
              <button
                className="sidebar-delete-popup-btn archive"
                onClick={handleProjectPromptYes}
              >
                Yes
              </button>
              <button
                className="sidebar-delete-popup-btn cancel"
                onClick={handleProjectPromptNo}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project picker — same modal the code tab uses. The chat-tab pseudo-id
          is supplied so ProjectModal's localStorage helpers don't collide
          with any existing dashboard's settings. */}
      {projectModalOpen && (
        <ProjectModal
          onClose={handleProjectModalClose}
          onSave={handleProjectModalSave}
          onProjectSelected={handleProjectSelected}
          dashboardId={pendingChatKeyRef.current || 'pending-chat'}
          pristine
        />
      )}

      {/* Per-chat settings — opens the project picker for an existing chat
          using its real chat-agent-XXXX dashboard key so the modal loads
          and persists the right project. ProjectModal handles save itself. */}
      {settingsTabId && (() => {
        const tab = chatTabs.find(t => t.id === settingsTabId);
        const dashId = tab && tab.agentHex ? 'chat-agent-' + tab.agentHex : settingsTabId;
        return (
          <ProjectModal
            onClose={handleSettingsModalClose}
            dashboardId={dashId}
          />
        );
      })()}

      {/* Rename popup — renames only the sidebar tab label, nothing else. */}
      {renamingTab && (
        <div className="sidebar-delete-overlay" onClick={closeRenamePopup}>
          <div className="sidebar-delete-popup" onClick={e => e.stopPropagation()}>
            <div className="sidebar-delete-popup-title">Rename Chat</div>
            <p className="sidebar-delete-popup-text">
              Enter a new name for this chat tab.
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
            <div className="sidebar-delete-popup-title">Delete Chat?</div>
            <p className="sidebar-delete-popup-text">
              Delete <strong>{deletingTab.name}</strong>? This cannot be undone.
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
