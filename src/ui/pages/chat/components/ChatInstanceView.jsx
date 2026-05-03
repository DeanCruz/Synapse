// ChatInstanceView — Full agent chat in chat mode.
// Bound to the active project tab's active subtab agent (chat-agent-XXXX).

import React, { useMemo } from 'react';
import ClaudeView from '@/shared/claude/ClaudeView.jsx';
import { useAppState } from '@/context/AppContext.jsx';

export default function ChatInstanceView({ tab = 'chat', surface = 'chat' }) {
  const { chatTabs, chatActiveTabId } = useAppState();
  const chatAgentId = useMemo(() => {
    const projectTab = chatTabs.find(t => t.id === chatActiveTabId);
    if (!projectTab?.subtabs) return projectTab?.id || null;
    const sub = projectTab.subtabs.find(s => s.id === projectTab.activeSubTabId)
      || projectTab.subtabs[0];
    return sub?.agentHex ? 'chat-agent-' + sub.agentHex : (projectTab.id || null);
  }, [chatTabs, chatActiveTabId]);

  return (
    <div className="chat-instance-claude-wrap">
      <ClaudeView tab={tab} chatAgentId={chatAgentId} surface={surface} />
    </div>
  );
}
