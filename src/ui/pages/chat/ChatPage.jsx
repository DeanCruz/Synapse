// ChatPage — Chat shell. Owns ChatSidebar + content area routed by chatActiveView.
// Extracted from App.jsx (formerly inlined inside the app-shell-chat div).

import React from 'react';
import { useAppState } from '@/context/AppContext.jsx';
import ChatSidebar from './components/ChatSidebar.jsx';
import ChatDashboardView from './components/ChatDashboardView.jsx';
import ChatMakePage from './components/ChatMakePage.jsx';
import ChatInstanceView from './components/ChatInstanceView.jsx';

export default function ChatPage() {
  const { chatActiveView } = useAppState();

  function renderChatContent() {
    switch (chatActiveView) {
      case 'make':
        return <ChatMakePage />;
      case 'chat-instance':
        return <ChatInstanceView tab="chat" surface="chat" />;
      case 'dashboard':
      default:
        return <ChatDashboardView />;
    }
  }

  return (
    <>
      <ChatSidebar />
      <div className="dashboard-content">
        {renderChatContent()}
      </div>
    </>
  );
}
