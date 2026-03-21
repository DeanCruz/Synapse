// ClaudeView — Full in-app agent chat view embedded in main content area
// Handles streaming worker output, tool call rendering, and conversation history.
// State persists in AppContext so switching views doesn't lose messages.
// Reads Synapse CLAUDE.md + project CLAUDE.md on each spawn.
// Logs chat events to the active dashboard.
// Allows sending follow-up messages while an agent is still running.

import React, { useState, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';
import { renderMarkdown } from '../utils/markdown.js';
import { getDashboardProject } from '../utils/dashboardProjects.js';

// Strip ANSI escape codes and terminal control characters from text
function stripAnsi(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')       // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[()][0-9A-B]/g, '')              // Character set selection
    .replace(/\x1b[\x20-\x2f]*[\x40-\x7e]/g, '')  // Other escape sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''); // Control chars (keep \t \n \r)
}

const MODEL_OPTIONS = {
  claude: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  codex: [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
    { value: 'gpt-5.2-codex', label: 'GPT-5.2-Codex' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1-Codex-Max' },
    { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1-Codex-Mini' },
  ],
};

function getModelOptions(provider) {
  return MODEL_OPTIONS[provider] || MODEL_OPTIONS.claude;
}

function resolveModel(provider, savedModel) {
  const options = getModelOptions(provider);
  if (savedModel && options.some((option) => option.value === savedModel)) {
    return savedModel;
  }
  return options[0].value;
}

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

// Thinking bubble — shown for extended thinking blocks (collapsible)
function ThinkingBubble({ msg }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = msg.text && msg.text.trim().length > 0;
  return (
    <div className="claude-thinking-bubble">
      <div
        className="claude-thinking-header"
        onClick={() => hasContent && setExpanded(e => !e)}
        style={{ cursor: hasContent ? 'pointer' : 'default' }}
      >
        <div className="claude-thinking-dots">
          <span /><span /><span />
        </div>
        <span className="claude-thinking-label">Thinking</span>
        {hasContent && (
          <span className="claude-thinking-toggle">{expanded ? '▼' : '▶'}</span>
        )}
      </div>
      {expanded && hasContent && (
        <div className="claude-thinking-content">{msg.text}</div>
      )}
    </div>
  );
}

// Live processing indicator — shown at bottom of conversation while Claude is running
function ProcessingIndicator() {
  return (
    <div className="claude-thinking-bubble claude-processing-live">
      <div className="claude-thinking-header" style={{ cursor: 'default' }}>
        <div className="claude-thinking-dots">
          <span /><span /><span />
        </div>
        <span className="claude-thinking-label">Thinking...</span>
      </div>
    </div>
  );
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
  if (msg.type === 'thinking') {
    return <ThinkingBubble msg={msg} />;
  }
  if (msg.type === 'user') {
    return (
      <div className="claude-message claude-user">
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="claude-message-attachments">
            {msg.attachments.map((a, i) => (
              <img key={i} className="claude-message-image" src={a.dataUrl} alt={a.name} />
            ))}
          </div>
        )}
        <div className="claude-message-text">{msg.text}</div>
      </div>
    );
  }
  if (msg.type === 'assistant') {
    // DEBUG: log raw text content to console for diagnosis
    console.log('[ClaudeView][RENDER] assistant msg text (' + (msg.text?.length || 0) + ' chars):', JSON.stringify(msg.text?.substring(0, 300)));
    // DEBUG: also log char codes of first 50 chars
    if (msg.text) {
      const codes = Array.from(msg.text.substring(0, 50)).map(c => c.charCodeAt(0));
      console.log('[ClaudeView][RENDER] char codes:', codes);
    }
    return (
      <div className="claude-message claude-assistant">
        <pre className="claude-message-text" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.75rem' }}>
          {msg.text || '(empty)'}
        </pre>
      </div>
    );
  }
  if (msg.type === 'tool_call') {
    // DEBUG: render tool calls as visible debug blocks
    return (
      <div style={{ background: '#1a1a2e', border: '1px solid #444', borderRadius: 6, padding: '6px 10px', alignSelf: 'flex-start', maxWidth: '90%', fontSize: '0.75rem' }}>
        <span style={{ color: '#f59e0b' }}>[TOOL_CALL]</span>{' '}
        <span style={{ color: '#60a5fa' }}>{msg.block?.name || '(no name)'}</span>{' '}
        <span style={{ color: '#888' }}>{toolInputSummary(msg.block?.name, msg.block?.input) || ''}</span>
        {msg.block?._result && <span style={{ color: '#34d399' }}> ✓ has result</span>}
      </div>
    );
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
      <div style={{ background: '#1a1a2e', border: '1px solid #2d6', borderRadius: 6, padding: '6px 10px', alignSelf: 'flex-start', maxWidth: '90%', fontSize: '0.75rem' }}>
        <span style={{ color: '#34d399' }}>[TOOL_RESULT_STANDALONE]</span>{' '}
        <span style={{ color: '#ccc' }}>{String(toolResultText(msg.content)).substring(0, 100)}</span>
      </div>
    );
  }
  // DEBUG: catch any unknown message types
  return (
    <div style={{ background: '#2a1a1a', border: '1px solid #f44', borderRadius: 6, padding: '6px 10px', alignSelf: 'flex-start', fontSize: '0.75rem' }}>
      <span style={{ color: '#f44' }}>[UNKNOWN type="{msg.type}"]</span>{' '}
      <span style={{ color: '#888' }}>{JSON.stringify(msg).substring(0, 150)}</span>
    </div>
  );
}

export default function ClaudeView({ onClose, hideHeader }) {
  const api = window.electronAPI || null;
  const state = useAppState();
  const dispatch = useDispatch();

  // Pull persistent state from context
  const messages = state.claudeMessages;
  const isProcessing = state.claudeIsProcessing;
  const status = state.claudeStatus;
  const dashboardId = state.currentDashboardId;
  const pendingAttachments = state.claudePendingAttachments;

  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState(resolveModel('claude'));
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState([]);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Session / conversation persistence (per-dashboard)
  const sessionIdRef = useRef(null);    // CLI session_id for --resume
  const convIdRef = useRef(null);       // saved conversation id
  const convCreatedRef = useRef(null);  // ISO string of conversation creation
  const messagesRef = useRef(messages); // mirror of messages for async saves
  const sessionMapRef = useRef({});     // { [dashboardId]: { sessionId, convId, convCreated } }
  const prevDashboardRef = useRef(dashboardId);

  const conversationRef = useRef(null);
  // Track all active task IDs (multiple workers can be running)
  const activeTaskIdsRef = useRef(new Set());
  const codexStreamedTaskIdsRef = useRef(new Set());
  // Map: tool_use_id -> index in messages array (for appending results)
  const toolCallIndexRef = useRef({});
  // Index of current accumulating assistant text message
  const currentTextIndexRef = useRef(null);
  // Stable refs so IPC listeners always call latest functions
  const handleChunkRef = useRef(null);
  const finishRef = useRef(null);

  // Keep messagesRef in sync for async saves
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Swap session/conversation refs when dashboard changes
  useEffect(() => {
    if (prevDashboardRef.current !== dashboardId) {
      // Stash current dashboard's session info
      sessionMapRef.current[prevDashboardRef.current] = {
        sessionId: sessionIdRef.current,
        convId: convIdRef.current,
        convCreated: convCreatedRef.current,
      };
      // Restore target dashboard's session info
      const restored = sessionMapRef.current[dashboardId] || {};
      sessionIdRef.current = restored.sessionId || null;
      convIdRef.current = restored.convId || null;
      convCreatedRef.current = restored.convCreated || null;
      // Reset streaming state
      currentTextIndexRef.current = null;
      toolCallIndexRef.current = {};
      prevDashboardRef.current = dashboardId;
    }
  }, [dashboardId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  // Load conversation list when history panel opens (filtered by current dashboard)
  useEffect(() => {
    if (showHistory && api) {
      api.listConversations(dashboardId).then(res => setConversations(res?.conversations || res || [])).catch(() => {});
    }
  }, [showHistory, api, dashboardId]);

  useEffect(() => {
    if (!api) return;
    api.getSettings().then((settings) => {
      const nextProvider = settings.agentProvider || 'claude';
      const resolvedDefaultModel = resolveModel(nextProvider, settings.defaultModel);
      setProvider(nextProvider);
      setModel(resolvedDefaultModel);
      if (resolvedDefaultModel !== settings.defaultModel) {
        api.setSetting('defaultModel', resolvedDefaultModel).catch(() => {});
      }
    }).catch(() => {});
  }, [api, dashboardId]);

  // Set up push listeners — use refs so the closure always calls latest functions
  useEffect(() => {
    if (!api) return;

    const workerListener = api.on('worker-output', (data) => {
      if (!activeTaskIdsRef.current.has(data.taskId)) return;
      if (handleChunkRef.current) handleChunkRef.current(data);
    });

    const completeListener = api.on('worker-complete', (data) => {
      if (!activeTaskIdsRef.current.has(data.taskId)) return;
      if (data.provider === 'codex' && data.lastMessage && !codexStreamedTaskIdsRef.current.has(data.taskId)) {
        appendMsg({ type: 'assistant', text: data.lastMessage });
      }
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

  function handleChunk(data) {
    const chunk = data.chunk;
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        processEvent(evt, data.taskId);
      } catch (e) {
        // Non-JSON output from CLI — strip ANSI and skip empty/progress lines
        const cleaned = stripAnsi(trimmed).trim();
        // Also strip Unicode block/bar characters used for terminal progress bars
        const withoutBlocks = cleaned.replace(/[\u2580-\u259F\u2500-\u257F\u2800-\u28FF\u2588█▓▒░━─═]/g, '').trim();
        if (withoutBlocks) {
          appendTextContent(cleaned + '\n');
        }
        // else: skip — line was purely progress bar characters
      }
    }
  }

  function processEvent(evt, taskId) {
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
            const cleaned = stripAnsi(block.text);
            console.log('[ClaudeView] assistant text block:', JSON.stringify(cleaned?.substring(0, 200)));
            if (cleaned && cleaned.trim()) {
              appendTextContent(cleaned);
            }
          } else if (block.type === 'tool_use') {
            addToolCall({
              id: block.id,
              name: block.name,
              input: block.input,
            });
          } else if (block.type === 'thinking') {
            dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Thinking...' });
            // Add thinking block as a collapsible bubble in the conversation
            appendMsg({ type: 'thinking', text: block.thinking || '' });
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

      case 'thread.started': {
        if (evt.thread_id) sessionIdRef.current = evt.thread_id;
        break;
      }

      case 'turn.started':
        dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Thinking...' });
        break;

      case 'item.completed':
        if (evt.item?.type === 'agent_message' && evt.item.text) {
          codexStreamedTaskIdsRef.current.add(taskId);
          appendTextContent(evt.item.text);
          flushText();
        }
        break;

      case 'error':
        appendMsg({ type: 'system', text: evt.message || 'Agent error', isError: true });
        break;

      case 'rate_limit_event':
        break;

      default:
        console.log('[ClaudeView] unhandled event type:', evt.type, JSON.stringify(evt).substring(0, 200));
        break;
    }
  }

  function finishProcessing(taskId) {
    activeTaskIdsRef.current.delete(taskId);
    codexStreamedTaskIdsRef.current.delete(taskId);
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
        dashboardId,
        messages: currentMsgs,
      }).catch(() => {});
    }
  }

  // Keep refs pointing to latest function instances so IPC listeners work
  handleChunkRef.current = handleChunk;
  finishRef.current = finishProcessing;

  // Build tiered conversation history — recent messages in full detail,
  // older messages summarized. Returns a string for injection into the prompt.
  // Tiers:
  //   - Last RECENT_COUNT messages: full text, full tool details
  //   - Older messages: condensed (user prompts + assistant summaries only)
  //   - Very old messages (beyond OLDER_CAP): skipped entirely
  const RECENT_COUNT = 10;  // full detail for last N messages
  const OLDER_CAP = 30;     // condensed for next N beyond recent

  function buildConversationContext(currentMessages) {
    // Filter to meaningful messages (skip system, thinking)
    const meaningful = currentMessages.filter(m =>
      m.type === 'user' || m.type === 'assistant' || m.type === 'tool_call'
    );
    if (meaningful.length === 0) return '';

    const total = meaningful.length;
    const recentStart = Math.max(0, total - RECENT_COUNT);
    const olderStart = Math.max(0, recentStart - OLDER_CAP);

    const parts = [];

    // Older tier — condensed summaries only
    if (olderStart < recentStart) {
      parts.push('--- Earlier in this conversation (condensed) ---');
      for (let i = olderStart; i < recentStart; i++) {
        const msg = meaningful[i];
        if (msg.type === 'user') {
          // Truncate long user messages in older tier
          const preview = msg.text.length > 200 ? msg.text.substring(0, 200) + '...' : msg.text;
          parts.push('[User]: ' + preview);
        } else if (msg.type === 'assistant') {
          // First 150 chars of assistant responses in older tier
          const preview = msg.text?.length > 150 ? msg.text.substring(0, 150) + '...' : (msg.text || '');
          if (preview) parts.push('[Assistant]: ' + preview);
        } else if (msg.type === 'tool_call') {
          // Just tool name + summary in older tier, skip results
          const summary = toolInputSummary(msg.block?.name, msg.block?.input);
          parts.push('[Tool]: ' + (msg.block?.name || '?') + (summary ? ' — ' + summary : ''));
        }
      }
      if (olderStart > 0) {
        parts.unshift('[' + olderStart + ' earlier messages omitted]');
      }
    }

    // Recent tier — full detail
    if (recentStart < total) {
      parts.push('--- Recent conversation ---');
      for (let i = recentStart; i < total; i++) {
        const msg = meaningful[i];
        if (msg.type === 'user') {
          parts.push('[User]: ' + msg.text);
        } else if (msg.type === 'assistant') {
          parts.push('[Assistant]: ' + (msg.text || ''));
        } else if (msg.type === 'tool_call') {
          const summary = toolInputSummary(msg.block?.name, msg.block?.input);
          parts.push('[Tool Call]: ' + (msg.block?.name || '?') + (summary ? ' — ' + summary : ''));
          if (msg.block?._result) {
            const resultPreview = toolResultText(msg.block._result);
            parts.push('[Tool Result]: ' + (resultPreview.length > 500 ? resultPreview.substring(0, 500) + '...' : resultPreview));
          }
        }
      }
    }

    return parts.join('\n');
  }

  async function handleFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = (e) => {
        dispatch({
          type: 'CLAUDE_ADD_ATTACHMENT',
          attachment: {
            id: Date.now() + Math.random(),
            name: file.name,
            type: file.type,
            dataUrl: e.target.result,
          },
        });
      };
      reader.readAsDataURL(file);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }
  function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }
  async function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    await handleFiles(files);
  }
  async function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await handleFiles(imageFiles);
    }
  }

  async function openFilePicker() {
    if (!api) return;
    const result = await api.selectImageFile();
    if (result && result.base64) {
      dispatch({
        type: 'CLAUDE_ADD_ATTACHMENT',
        attachment: {
          id: Date.now() + Math.random(),
          name: result.name || 'image',
          type: result.mimeType || 'image/png',
          dataUrl: `data:${result.mimeType || 'image/png'};base64,${result.base64}`,
        },
      });
    }
  }

  async function sendText(text, attachments = []) {
    if (!text || !api) return;

    // Snapshot current messages BEFORE appending the new user message
    // so conversation context reflects what came before this prompt
    const currentMsgs = messagesRef.current;

    appendMsg({ type: 'user', text, attachments });
    dispatch({ type: 'CLAUDE_SET_PROCESSING', value: true });
    dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Thinking...' });
    currentTextIndexRef.current = null;

    const taskId = '_claude_' + Date.now();
    activeTaskIdsRef.current.add(taskId);
    codexStreamedTaskIdsRef.current.delete(taskId);

    try {
      const settings = await api.getSettings();
      const perDashboardPath = getDashboardProject(dashboardId);
      const projectDir = perDashboardPath || settings.activeProjectPath || null;
      const provider = settings.agentProvider || 'claude';
      const selectedModel = resolveModel(provider, model || settings.defaultModel);
      const cliPath = provider === 'codex'
        ? (settings.codexCliPath || null)
        : (settings.claudeCliPath || null);

      // Only inject system prompt on fresh sessions — resumed sessions already have context
      const systemPrompt = sessionIdRef.current ? null : await api.getChatSystemPrompt(projectDir);

      // Build conversation history context.
      // For resumed sessions, the CLI already has full history — but we still inject
      // recent messages as a lightweight refresher since context compaction may have
      // dropped details. For fresh sessions with prior messages (e.g. loaded from
      // history), this provides the full conversational thread.
      let finalPrompt = text;
      const historyContext = buildConversationContext(currentMsgs);
      if (historyContext) {
        finalPrompt =
          '<conversation_history>\n' +
          historyContext +
          '\n</conversation_history>\n\n' +
          'Refer to the conversation history above for context. ' +
          'The user\'s current message follows:\n\n' +
          text;
      }

      if (dashboardId) {
        api.logChatEvent(dashboardId, {
          level: 'info',
          message: 'Agent chat: ' + text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          task_id: taskId,
        }).catch(() => {});
      }

      await api.spawnWorker({
        provider,
        taskId,
        dashboardId,
        prompt: finalPrompt,
        systemPrompt: systemPrompt || undefined,
        resumeSessionId: sessionIdRef.current || undefined,
        model: selectedModel || undefined,
        cliPath,
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
    if (!text && pendingAttachments.length === 0) return;
    setPrompt('');

    let finalPrompt = text;
    const attachmentsSnapshot = [...pendingAttachments];

    if (attachmentsSnapshot.length > 0 && api) {
      try {
        const toSave = attachmentsSnapshot.map(a => ({
          base64: a.dataUrl.split(',')[1] || a.dataUrl,
          mimeType: a.type,
          name: a.name,
        }));
        const saved = await api.saveTempImages(toSave);
        const paths = saved.filter(s => s.path).map(s => s.path);
        if (paths.length > 0) {
          finalPrompt = (text ? text + '\n\n' : '') + paths.join('\n');
        }
      } catch (err) {
        // proceed without paths if save fails
      }
      dispatch({ type: 'CLAUDE_CLEAR_ATTACHMENTS' });
    }

    await sendText(finalPrompt, attachmentsSnapshot);
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

  function handleModelSelect(nextModel) {
    setModel(nextModel);
    if (api) {
      api.setSetting('defaultModel', nextModel).catch(() => {});
    }
  }

  function clearChat() {
    if (!isProcessing) {
      dispatch({ type: 'CLAUDE_CLEAR_MESSAGES' });
      sessionIdRef.current = null;
      convIdRef.current = null;
      convCreatedRef.current = null;
      // Clear stashed session for this dashboard too
      delete sessionMapRef.current[dashboardId];
    }
  }

  async function stopChat() {
    if (!api || activeTaskIdsRef.current.size === 0) return;
    try {
      await api.killAllWorkers();
    } catch (e) {
      // ignore — workers may already be dead
    }
    // Clean up local state
    activeTaskIdsRef.current.clear();
    codexStreamedTaskIdsRef.current.clear();
    currentTextIndexRef.current = null;
    dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
    dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Stopped' });
    appendMsg({ type: 'system', text: 'Agent stopped by user.' });
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

  const activeModelLabel = getModelOptions(provider).find((option) => option.value === model)?.label || model;
  const projectPath = getDashboardProject(dashboardId);
  const projectDisplayName = projectPath ? projectPath.replace(/\/+$/, '').split('/').pop() : null;

  return (
    <div className={`claude-view${hideHeader ? ' claude-view--no-header' : ''}`}>
      {!hideHeader && (
        <div className="claude-view-header">
          <span className="claude-view-title">Agent Chat</span>
          {projectDisplayName && <span className="claude-view-project">{projectDisplayName}</span>}
          <span className="claude-view-project">{activeModelLabel}</span>
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
      )}
      {hideHeader && (
        <div className="claude-float-actions-bar">
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
        </div>
      )}

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

        <div
          className="claude-conversation claude-view-conversation"
          ref={conversationRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {messages.map(msg => (
            <ConversationMessage key={msg.id} msg={msg} />
          ))}
          {/* Show animated dots when processing and last message isn't already a thinking block */}
          {isProcessing && messages.length > 0 && messages[messages.length - 1]?.type !== 'thinking' && (
            <ProcessingIndicator />
          )}
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

      {pendingAttachments.length > 0 && (
        <div className="claude-attachment-bar">
          {pendingAttachments.map(a => (
            <div key={a.id} className="claude-attachment-chip">
              <img src={a.dataUrl} alt={a.name} />
              <span className="claude-attachment-chip-name">{a.name}</span>
              <button
                className="claude-attachment-chip-remove"
                onClick={() => dispatch({ type: 'CLAUDE_REMOVE_ATTACHMENT', id: a.id })}
                title="Remove"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="claude-prompt-bar">
        <textarea
          ref={textareaRef}
          className="claude-prompt-input"
          placeholder="Ask the active agent anything... (drag or paste images)"
          rows={1}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleTextareaInput}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => { handleFiles(Array.from(e.target.files)); e.target.value = ''; }}
        />
        <div className="claude-prompt-controls">
          <div className="claude-prompt-controls-left">
            <select
              className="claude-model-select"
              value={model}
              onChange={e => handleModelSelect(e.target.value)}
            >
              {getModelOptions(provider).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              className="claude-attach-btn"
              onClick={openFilePicker}
              title="Attach image"
              disabled={isProcessing}
            >📎</button>
          </div>
          {isProcessing ? (
            <button
              className="claude-send-btn claude-stop-btn"
              onClick={stopChat}
            >
              Stop
            </button>
          ) : (
            <button
              className="claude-send-btn"
              onClick={sendMessage}
              disabled={!prompt.trim() && pendingAttachments.length === 0}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
