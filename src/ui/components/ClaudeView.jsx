// ClaudeView — Full Claude Code chat view embedded in main content area
// Handles streaming worker output, tool call rendering, and conversation history.
// State persists in AppContext so switching views doesn't lose messages.
// Reads Synapse CLAUDE.md + project CLAUDE.md on each spawn.
// Logs chat events to the active dashboard.
// Allows sending follow-up messages while Claude is still running.

import React, { useState, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';
import { renderMarkdown } from '../../client/utils/markdown.js';

// Parse tool result content into a display string
function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => b.type === 'text' ? b.text : JSON.stringify(b, null, 2)).join('\n');
  }
  if (content && typeof content === 'object') {
    if (content.file && content.file.content) return content.file.content;
    if (content.type === 'text' && content.text) return content.text;
    try { return JSON.stringify(content, null, 2); } catch (e) { return String(content); }
  }
  return String(content);
}

// Format tool input for display — show a compact summary for common tools
function toolInputSummary(name, input) {
  if (!input) return null;
  switch (name) {
    case 'Read': return input.file_path || null;
    case 'Edit': return input.file_path || null;
    case 'Write': return input.file_path || null;
    case 'Bash': return input.command || null;
    case 'Glob': return input.pattern || null;
    case 'Grep': return `/${input.pattern || ''}/${input.path ? ' in ' + input.path : ''}`;
    case 'Agent': return input.description || null;
    default: return null;
  }
}

// Single collapsible tool call block
function ToolCallBlock({ block }) {
  const [expanded, setExpanded] = useState(false);
  const summary = toolInputSummary(block.name, block.input);
  const inputStr = block.input
    ? (typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2))
    : null;
  const hasResult = block._result !== undefined && block._result !== null;

  return (
    <div className={'claude-tool-call' + (expanded ? ' expanded' : '') + (hasResult ? ' has-result' : '')}>
      <div className="claude-tool-header" onClick={() => setExpanded(e => !e)}>
        <span className="claude-tool-icon">{hasResult ? '✓' : '⚙'}</span>
        <span className="claude-tool-name">{block.name}</span>
        {summary && <span className="claude-tool-summary">{summary}</span>}
        <span className="claude-tool-toggle">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="claude-tool-body">
          {inputStr && (
            <>
              <div className="claude-tool-label">Input:</div>
              <pre className="claude-tool-input">{inputStr}</pre>
            </>
          )}
          {hasResult && (
            <>
              <div className="claude-tool-label claude-tool-result-label">Result:</div>
              <pre className="claude-tool-result">{toolResultText(block._result)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// A single conversation message
function ConversationMessage({ msg }) {
  if (msg.type === 'user') {
    return (
      <div className="claude-message claude-user">
        <div className="claude-message-text">{msg.text}</div>
      </div>
    );
  }
  if (msg.type === 'assistant') {
    return (
      <div className="claude-message claude-assistant">
        <div
          className="claude-message-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
        />
      </div>
    );
  }
  if (msg.type === 'tool_call') {
    return <ToolCallBlock block={msg.block} />;
  }
  if (msg.type === 'system') {
    return (
      <div className={'claude-system-msg' + (msg.isError ? ' claude-error' : '')}>
        {msg.text}
      </div>
    );
  }
  if (msg.type === 'tool_result_standalone') {
    return (
      <div className="claude-tool-result-standalone">
        <pre className="claude-tool-result">{toolResultText(msg.content)}</pre>
      </div>
    );
  }
  return null;
}

export default function ClaudeView({ onClose }) {
  const api = window.electronAPI || null;
  const state = useAppState();
  const dispatch = useDispatch();

  // Pull persistent state from context
  const messages = state.claudeMessages;
  const isProcessing = state.claudeIsProcessing;
  const status = state.claudeStatus;
  const dashboardId = state.currentDashboardId;

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('sonnet');
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState([]);
  const textareaRef = useRef(null);

  // Session / conversation persistence
  const sessionIdRef = useRef(null);    // CLI session_id for --resume
  const convIdRef = useRef(null);       // saved conversation id
  const convCreatedRef = useRef(null);  // ISO string of conversation creation
  const messagesRef = useRef(messages); // mirror of messages for async saves

  const conversationRef = useRef(null);
  // Track all active task IDs (multiple workers can be running)
  const activeTaskIdsRef = useRef(new Set());
  // Map: tool_use_id -> index in messages array (for appending results)
  const toolCallIndexRef = useRef({});
  // Index of current accumulating assistant text message
  const currentTextIndexRef = useRef(null);
  // Stable refs so IPC listeners always call latest functions
  const handleChunkRef = useRef(null);
  const finishRef = useRef(null);

  // Keep messagesRef in sync for async saves
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  // Load conversation list when history panel opens
  useEffect(() => {
    if (showHistory && api) {
      api.listConversations().then(res => setConversations(res?.conversations || res || [])).catch(() => {});
    }
  }, [showHistory, api]);

  // Set up push listeners — use refs so the closure always calls latest functions
  useEffect(() => {
    if (!api) return;

    const workerListener = api.on('worker-output', (data) => {
      if (!activeTaskIdsRef.current.has(data.taskId)) return;
      if (handleChunkRef.current) handleChunkRef.current(data.chunk);
    });

    const completeListener = api.on('worker-complete', (data) => {
      if (!activeTaskIdsRef.current.has(data.taskId)) return;
      if (data.errorOutput) {
        dispatch({
          type: 'CLAUDE_APPEND_MSG',
          msg: { type: 'system', text: '[stderr] ' + data.errorOutput, isError: true }
        });
      }
      if (finishRef.current) finishRef.current(data.taskId);
    });

    return () => {
      if (api) {
        api.off('worker-output', workerListener);
        api.off('worker-complete', completeListener);
      }
    };
  }, [api, dispatch]);

  // --- State mutation helpers using functional updater (avoids stale closures) ---

  function appendMsg(msg) {
    dispatch({ type: 'CLAUDE_APPEND_MSG', msg });
  }

  function flushText() {
    currentTextIndexRef.current = null;
  }

  function appendTextContent(text) {
    dispatch({ type: 'CLAUDE_UPDATE_MESSAGES', updater: (prev) => {
      if (currentTextIndexRef.current !== null && currentTextIndexRef.current < prev.length) {
        const idx = currentTextIndexRef.current;
        const updated = prev.slice();
        updated[idx] = { ...updated[idx], text: updated[idx].text + text };
        return updated;
      }
      const newMsg = { id: Date.now() + Math.random(), type: 'assistant', text };
      currentTextIndexRef.current = prev.length;
      return [...prev, newMsg];
    }});
  }

  function appendToolResult(toolUseId, content) {
    flushText();
    if (toolUseId && toolCallIndexRef.current[toolUseId] !== undefined) {
      dispatch({ type: 'CLAUDE_UPDATE_MESSAGES', updater: (prev) => {
        const idx = toolCallIndexRef.current[toolUseId];
        if (idx >= prev.length) return prev;
        const updated = prev.slice();
        const block = { ...updated[idx].block, _result: content };
        updated[idx] = { ...updated[idx], block };
        return updated;
      }});
    } else {
      appendMsg({ type: 'tool_result_standalone', content });
    }
  }

  function addToolCall(block) {
    flushText();
    dispatch({ type: 'CLAUDE_UPDATE_MESSAGES', updater: (prev) => {
      if (block.id) {
        toolCallIndexRef.current[block.id] = prev.length;
      }
      return [...prev, { id: Date.now() + Math.random(), type: 'tool_call', block }];
    }});
  }

  function handleChunk(chunk) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        processEvent(evt);
      } catch (e) {
        appendTextContent(trimmed + '\n');
      }
    }
  }

  function processEvent(evt) {
    if (!evt || !evt.type) return;

    switch (evt.type) {
      case 'system': {
        if (evt.subtype === 'init') {
          const tools = evt.tools || [];
          appendMsg({
            type: 'system',
            text: `Connected — model: ${evt.model || '?'}, ${tools.length} tools available`,
          });
        } else {
          appendMsg({ type: 'system', text: evt.message || JSON.stringify(evt) });
        }
        break;
      }

      case 'assistant': {
        const content = evt.message?.content || evt.content || [];
        for (const block of content) {
          if (block.type === 'text') {
            appendTextContent(block.text);
          } else if (block.type === 'tool_use') {
            addToolCall({
              id: block.id,
              name: block.name,
              input: block.input,
            });
          } else if (block.type === 'thinking') {
            dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Thinking...' });
          }
        }
        break;
      }

      case 'user': {
        const content = evt.message?.content || [];
        for (const block of content) {
          if (block.type === 'tool_result') {
            const resultContent = evt.tool_use_result || block.content;
            appendToolResult(block.tool_use_id, resultContent);
          }
        }
        break;
      }

      case 'result': {
        flushText();
        if (evt.session_id) sessionIdRef.current = evt.session_id;
        break;
      }

      case 'rate_limit_event':
        break;

      default:
        break;
    }
  }

  function finishProcessing(taskId) {
    activeTaskIdsRef.current.delete(taskId);
    // Only mark as not processing when ALL workers are done
    if (activeTaskIdsRef.current.size === 0) {
      dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
      dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
    }
    currentTextIndexRef.current = null;
    flushText();

    // Log completion to dashboard
    if (api && dashboardId) {
      api.logChatEvent(dashboardId, {
        level: 'info',
        message: 'Claude chat response completed',
        task_id: taskId,
      }).catch(() => {});
    }

    // Auto-save conversation to disk after each response
    if (api && sessionIdRef.current) {
      const currentMsgs = messagesRef.current;
      const firstUser = currentMsgs.find(m => m.type === 'user');
      const name = firstUser
        ? firstUser.text.substring(0, 50) + (firstUser.text.length > 50 ? '...' : '')
        : 'Conversation';
      const now = new Date().toISOString();
      if (!convIdRef.current) {
        convIdRef.current = 'conv_' + Date.now();
        convCreatedRef.current = now;
      }
      api.saveConversation({
        id: convIdRef.current,
        name,
        created: convCreatedRef.current || now,
        sessionId: sessionIdRef.current,
        messages: currentMsgs,
      }).catch(() => {});
    }
  }

  // Keep refs pointing to latest function instances so IPC listeners work
  handleChunkRef.current = handleChunk;
  finishRef.current = finishProcessing;

  // Build conversation history string from messages for context continuity
  function buildConversationContext(currentMessages) {
    const parts = [];
    for (const msg of currentMessages) {
      if (msg.type === 'user') {
        parts.push('[User]: ' + msg.text);
      } else if (msg.type === 'assistant') {
        parts.push('[Assistant]: ' + msg.text);
      } else if (msg.type === 'tool_call') {
        const summary = toolInputSummary(msg.block.name, msg.block.input);
        parts.push('[Tool Call]: ' + msg.block.name + (summary ? ' — ' + summary : ''));
        if (msg.block._result) {
          const resultPreview = toolResultText(msg.block._result);
          // Truncate long tool results to keep context manageable
          parts.push('[Tool Result]: ' + (resultPreview.length > 500 ? resultPreview.substring(0, 500) + '...' : resultPreview));
        }
      }
      // Skip system messages — they're internal UI state
    }
    return parts.join('\n');
  }

  async function sendText(text) {
    if (!text || !api) return;

    appendMsg({ type: 'user', text });
    dispatch({ type: 'CLAUDE_SET_PROCESSING', value: true });
    dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Thinking...' });
    currentTextIndexRef.current = null;

    const taskId = '_claude_' + Date.now();
    activeTaskIdsRef.current.add(taskId);

    try {
      const settings = await api.getSettings();
      const projectDir = settings.activeProjectPath || null;
      const selectedModel = model || settings.defaultModel || 'sonnet';

      // Only inject system prompt on fresh sessions — resumed sessions already have context
      const systemPrompt = sessionIdRef.current ? null : await api.getChatSystemPrompt(projectDir);

      if (dashboardId) {
        api.logChatEvent(dashboardId, {
          level: 'info',
          message: 'Claude chat: ' + text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          task_id: taskId,
        }).catch(() => {});
      }

      await api.spawnWorker({
        taskId,
        dashboardId,
        prompt: text,
        systemPrompt: systemPrompt || undefined,
        resumeSessionId: sessionIdRef.current || undefined,
        model: selectedModel,
        cliPath: settings.claudeCliPath || null,
        dangerouslySkipPermissions: settings.dangerouslySkipPermissions || false,
        projectDir,
      });
    } catch (err) {
      appendMsg({ type: 'system', text: 'Error: ' + (err.message || String(err)), isError: true });
      activeTaskIdsRef.current.delete(taskId);
      if (activeTaskIdsRef.current.size === 0) {
        dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
        dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
      }
    }
  }

  async function sendMessage() {
    const text = prompt.trim();
    if (!text) return;
    setPrompt('');
    await sendText(text);
  }

  const SUGGESTIONS = [
    { label: '!p_track', command: '!p_track ', autoSend: false },
    { label: '!dispatch --ready', command: '!dispatch --ready', autoSend: true },
    { label: '!status', command: '!status', autoSend: true },
    { label: '!cancel', command: '!cancel', autoSend: true },
  ];

  function handleSuggestion(s) {
    if (s.autoSend) {
      sendText(s.command);
    } else {
      setPrompt(s.command);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleTextareaInput(e) {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }

  function clearChat() {
    if (!isProcessing) {
      dispatch({ type: 'CLAUDE_CLEAR_MESSAGES' });
      sessionIdRef.current = null;
      convIdRef.current = null;
      convCreatedRef.current = null;
    }
  }

  async function loadHistoryConversation(conv) {
    if (isProcessing || !api) return;
    try {
      const full = await api.loadConversation(conv.id);
      if (!full) return;
      dispatch({ type: 'CLAUDE_SET_MESSAGES', messages: full.messages || [] });
      sessionIdRef.current = full.sessionId || null;
      convIdRef.current = full.id;
      convCreatedRef.current = full.created;
      setShowHistory(false);
    } catch (e) {
      // silently ignore
    }
  }

  function formatHistoryDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + 'd ago';
    return d.toLocaleDateString();
  }

  return (
    <div className="claude-view">
      <div className="claude-view-header">
        <span className="claude-view-title">Claude Code</span>
        <span className={'claude-view-status' + (isProcessing ? ' active' : '')}>{status}</span>
        <button
          className="claude-clear-btn"
          onClick={() => setShowHistory(h => !h)}
          title="Browse conversation history"
        >
          History
        </button>
        <button
          className="claude-clear-btn"
          onClick={clearChat}
          disabled={isProcessing}
          title="Start a new conversation"
        >
          New
        </button>
        {onClose && (
          <button className="claude-view-close" onClick={onClose}>✕</button>
        )}
      </div>

      <div className="claude-view-body">
        {showHistory && (
          <div className="claude-history-panel">
            <div className="claude-history-header">History</div>
            <div className="claude-history-list">
              {conversations.length === 0 && (
                <div className="claude-history-empty">No saved conversations</div>
              )}
              {conversations.map(c => (
                <button
                  key={c.id}
                  className={'claude-history-item' + (c.id === convIdRef.current ? ' active' : '')}
                  onClick={() => loadHistoryConversation(c)}
                  disabled={isProcessing}
                >
                  <span className="claude-history-name">{c.name}</span>
                  <span className="claude-history-date">{formatHistoryDate(c.updated)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="claude-conversation claude-view-conversation" ref={conversationRef}>
          {messages.map(msg => (
            <ConversationMessage key={msg.id} msg={msg} />
          ))}
        </div>
      </div>

      <div className="claude-suggestion-chips">
        {SUGGESTIONS.map(s => (
          <button
            key={s.command}
            className="claude-suggestion-chip"
            onClick={() => handleSuggestion(s)}
            disabled={isProcessing}
            title={s.autoSend ? `Send: ${s.command}` : `Fill: ${s.command}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="claude-prompt-bar">
        <select
          className="claude-model-select"
          value={model}
          onChange={e => setModel(e.target.value)}
        >
          <option value="sonnet">Sonnet</option>
          <option value="opus">Opus</option>
          <option value="haiku">Haiku</option>
        </select>
        <textarea
          ref={textareaRef}
          className="claude-prompt-input"
          placeholder="Ask Claude anything..."
          rows={1}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleTextareaInput}
        />
        <button
          className="claude-send-btn"
          onClick={sendMessage}
          disabled={!prompt.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
