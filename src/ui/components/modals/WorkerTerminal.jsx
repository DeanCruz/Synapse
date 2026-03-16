// WorkerTerminal — Live streaming worker output in a conversation-style view
// Shows tool calls, text blocks, results. Includes Kill and Clear controls.

import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal.jsx';

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

function ConversationItem({ msg }) {
  if (msg.type === 'assistant_text') {
    return (
      <div className="claude-message claude-assistant">
        <div className="claude-message-text">{msg.text}</div>
      </div>
    );
  }
  if (msg.type === 'tool_call') {
    return <ToolCallBlock block={msg.block} />;
  }
  if (msg.type === 'result') {
    return (
      <div className="claude-message claude-result">
        <div className="claude-message-text">{msg.text}</div>
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
      <div className="claude-tool-result-standalone">
        <pre className="claude-tool-result">{toolResultText(msg.content)}</pre>
      </div>
    );
  }
  return null;
}

export default function WorkerTerminal({ onClose, taskId, title, pid }) {
  const api = window.electronAPI || null;

  const [messages, setMessages] = useState([]);
  const [killed, setKilled] = useState(false);

  const conversationRef = useRef(null);
  const toolMapRef = useRef({});
  const currentTextIdxRef = useRef(null);
  const handleChunkRef = useRef(null);

  useEffect(() => {
    if (!api) return;

    const workerListener = api.on('worker-output', (data) => {
      if (data.taskId !== taskId) return;
      if (handleChunkRef.current) handleChunkRef.current(data.chunk);
    });

    const completeListener = api.on('worker-complete', (data) => {
      if (data.taskId !== taskId) return;
      currentTextIdxRef.current = null;
      setMessages(prev => {
        const out = [...prev, {
          id: Date.now() + Math.random(),
          type: 'system',
          text: '\u2014\u2014\u2014 Worker finished (exit code: ' + data.exitCode + ') \u2014\u2014\u2014',
        }];
        if (data.errorOutput) {
          out.push({ id: Date.now() + Math.random(), type: 'system', text: '[stderr] ' + data.errorOutput, isError: true });
        }
        return out;
      });
    });

    return () => {
      api.off('worker-output', workerListener);
      api.off('worker-complete', completeListener);
    };
  }, [api, taskId]);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  function appendMsg(msg) {
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), ...msg }]);
  }

  function flushText() {
    currentTextIdxRef.current = null;
  }

  function appendText(text) {
    setMessages(prev => {
      if (currentTextIdxRef.current !== null && currentTextIdxRef.current < prev.length) {
        const idx = currentTextIdxRef.current;
        const updated = prev.slice();
        updated[idx] = { ...updated[idx], text: updated[idx].text + text };
        return updated;
      }
      const newMsg = { id: Date.now() + Math.random(), type: 'assistant_text', text };
      currentTextIdxRef.current = prev.length;
      return [...prev, newMsg];
    });
  }

  function appendToolResult(toolUseId, content) {
    flushText();
    if (toolUseId && toolMapRef.current[toolUseId] !== undefined) {
      setMessages(prev => {
        const idx = toolMapRef.current[toolUseId];
        if (idx >= prev.length) return prev;
        const updated = prev.slice();
        updated[idx] = { ...updated[idx], block: { ...updated[idx].block, _result: content } };
        return updated;
      });
    } else {
      setMessages(prev => [...prev, {
        id: Date.now() + Math.random(),
        type: 'tool_result_standalone',
        content,
      }]);
    }
  }

  function addToolCall(block) {
    flushText();
    setMessages(prev => {
      if (block.id) toolMapRef.current[block.id] = prev.length;
      return [...prev, { id: Date.now() + Math.random(), type: 'tool_call', block }];
    });
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
        appendText(trimmed + '\n');
      }
    }
  }

  // Keep ref pointing to latest handleChunk so IPC listener works
  handleChunkRef.current = handleChunk;

  function processEvent(evt) {
    if (!evt || !evt.type) return;

    switch (evt.type) {
      case 'system': {
        if (evt.subtype === 'init') {
          appendMsg({ type: 'system', text: `Model: ${evt.model || '?'} | ${(evt.tools || []).length} tools` });
        } else {
          appendMsg({ type: 'system', text: evt.message || JSON.stringify(evt) });
        }
        break;
      }

      case 'assistant': {
        const content = evt.message?.content || evt.content || [];
        for (const block of content) {
          if (block.type === 'text') {
            appendText(block.text);
          } else if (block.type === 'tool_use') {
            addToolCall({ id: block.id, name: block.name, input: block.input });
          }
          // Skip thinking blocks in worker terminal
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
        // Result text duplicates the last assistant message — skip it.
        flushText();
        break;
      }

      // Silently ignore rate_limit_event
      default: break;
    }
  }

  function handleKill() {
    if (!api || !pid) return;
    api.killWorker(pid);
    appendMsg({ type: 'system', text: '[KILLED]', isError: true });
    setKilled(true);
  }

  function handleClear() {
    setMessages([]);
    toolMapRef.current = {};
    currentTextIdxRef.current = null;
  }

  return (
    <Modal title={'Live Output \u2014 ' + (title || taskId)} onClose={onClose}>
      <div className="claude-conversation" ref={conversationRef}>
        {messages.map(msg => (
          <ConversationItem key={msg.id} msg={msg} />
        ))}
      </div>
      <div className="worker-terminal-controls">
        {pid && (
          <button
            className="settings-custom-reset-btn"
            onClick={handleKill}
            disabled={killed}
          >
            Kill Worker
          </button>
        )}
        <button className="settings-custom-reset-btn" onClick={handleClear}>
          Clear
        </button>
      </div>
    </Modal>
  );
}
