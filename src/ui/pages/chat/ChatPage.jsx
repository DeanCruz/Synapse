// ChatPage — Chat shell. Owns ChatSidebar + content area routed by chatActiveView.
// Extracted from App.jsx (formerly inlined inside the app-shell-chat div).

import React, { useCallback, useMemo } from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';
import ChatSidebar from './components/ChatSidebar.jsx';
import ChatDashboardView from './components/ChatDashboardView.jsx';
import ChatMakePage from './components/ChatMakePage.jsx';
import ChatInstanceView from './components/ChatInstanceView.jsx';
import { saveDashboardProject } from '@/utils/dashboardProjects.js';

function ChatTabBar() {
  const { chatTabs, chatActiveTabId, chatActiveView } = useAppState();
  const dispatch = useDispatch();

  const projectTab = useMemo(
    () => chatTabs.find(t => t.id === chatActiveTabId) || null,
    [chatTabs, chatActiveTabId],
  );

  const handleNewSubTab = useCallback(async () => {
    if (!projectTab) return;
    const api = window.electronAPI;
    let agentHex = null;
    let chatNumber = null;
    if (api && typeof api.createChatAgent === 'function') {
      try {
        const result = await api.createChatAgent({ projectPath: projectTab.projectPath || null });
        agentHex = result?.agentHex ?? null;
        chatNumber = result?.chatNumber ?? null;
      } catch (err) {
        console.error('createChatAgent failed:', err);
      }
    }
    if (agentHex && projectTab.projectPath) {
      saveDashboardProject('chat-agent-' + agentHex, projectTab.projectPath);
    }
    dispatch({ type: 'CHAT_SUBTAB_CREATE', agentHex, chatNumber });
  }, [projectTab, dispatch]);

  const handleSwitchSubTab = useCallback((subTabId) => {
    dispatch({ type: 'CHAT_SUBTAB_SWITCH', subTabId });
  }, [dispatch]);

  const handleDeleteSubTab = useCallback(async (subTabId) => {
    if (!projectTab) return;
    const sub = projectTab.subtabs.find(s => s.id === subTabId);
    if (sub?.agentHex) {
      const api = window.electronAPI;
      if (api && typeof api.deleteChatAgent === 'function') {
        try { await api.deleteChatAgent(sub.agentHex); } catch (e) { /* */ }
      }
    }
    dispatch({ type: 'CHAT_SUBTAB_DELETE', subTabId });
  }, [projectTab, dispatch]);

  if (!projectTab || chatActiveView !== 'chat-instance') return null;
  const subtabs = projectTab.subtabs || [];
  if (subtabs.length === 0) return null;

  return (
    <div className="chat-internal-tab-bar">
      {subtabs.map(sub => (
        <div
          key={sub.id}
          className={`chat-internal-tab${sub.id === projectTab.activeSubTabId ? ' active' : ''}`}
          onClick={() => handleSwitchSubTab(sub.id)}
        >
          <span className="chat-internal-tab-name">{sub.name}</span>
          {subtabs.length > 1 && (
            <button
              className="chat-internal-tab-close"
              title="Close tab"
              onClick={(e) => { e.stopPropagation(); handleDeleteSubTab(sub.id); }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      ))}
      <button
        className="chat-internal-tab-add"
        title="New chat"
        onClick={handleNewSubTab}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

export default function ChatPage() {
  const { chatActiveView } = useAppState();

  return (
    <>
      <ChatSidebar />
      <div className="dashboard-content">
        <ChatTabBar />
        {/* ChatInstanceView stays mounted (hidden) so agent processes, IPC
            listeners, and React state survive tab switches. */}
        <div style={{ display: chatActiveView === 'chat-instance' ? 'contents' : 'none' }}>
          <ChatInstanceView tab="chat" surface="chat" />
        </div>
        {chatActiveView === 'make' && <ChatMakePage />}
        {chatActiveView === 'dashboard' && <ChatDashboardView />}
        {chatActiveView !== 'chat-instance' && chatActiveView !== 'make' && chatActiveView !== 'dashboard' && <ChatDashboardView />}
      </div>
    </>
  );
}
