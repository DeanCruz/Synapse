// ChatInstanceView — Full agent chat in chat mode.
// Reuses ClaudeView (the same component code mode renders in its floating
// panel) so the chat-instance pane has identical streaming, tool-call,
// permission, and history behavior.
//
// In chat mode the panel is bound to the active chat tab's 4-hex agent
// (Chat/chat{N}/agent{XXXX}/) — not to a code dashboard. The agentHex is
// passed to ClaudeView as `chatAgentId` so it can use it as a substitute
// context id and skip the "Select a dashboard" empty state.
//
// `tab` is forwarded so downstream logic can distinguish the chat-mode
// instance from the code-mode (floating panel) instance.

import React, { useMemo } from 'react';
import ClaudeView from '@/shared/claude/ClaudeView.jsx';
import { useAppState } from '@/context/AppContext.jsx';

export default function ChatInstanceView({ tab = 'chat', surface = 'chat' }) {
  const { chatTabs, chatActiveTabId } = useAppState();
  const activeTab = useMemo(
    () => chatTabs.find(t => t.id === chatActiveTabId) || null,
    [chatTabs, chatActiveTabId],
  );
  const chatAgentId = activeTab?.agentHex
    ? 'chat-agent-' + activeTab.agentHex
    : (activeTab?.id || null);

  return (
    <div className="chat-instance-claude-wrap">
      <ClaudeView tab={tab} chatAgentId={chatAgentId} surface={surface} />
    </div>
  );
}
