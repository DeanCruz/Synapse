// ClaudeView — Full in-app agent chat view embedded in main content area
// Handles streaming worker output, tool call rendering, and conversation history.
// State persists in AppContext so switching views doesn't lose messages.
// Reads Synapse CLAUDE.md + project CLAUDE.md on each spawn.
// Logs chat events to the active dashboard.
// Allows sending follow-up messages while an agent is still running.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';
import { renderMarkdown } from '../utils/markdown.js';
import { getDashboardProject, getDashboardAdditionalContext } from '../utils/dashboardProjects.js';
import PermissionModal from './modals/PermissionModal.jsx';

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

// Tools whose summary is a file path (clickable to open)
function toolHasFilePath(name) {
  return name === 'Read' || name === 'Edit' || name === 'Write';
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
// isLatest controls whether the dots animate (only the most recent thinking block animates)
function ThinkingBubble({ msg, isLatest }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = msg.text && msg.text.trim().length > 0;
  return (
    <div className={'claude-thinking-bubble' + (isLatest ? '' : ' thinking-done')}>
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

// Expandable pre block for tool input/result — click to toggle max-height
function ExpandablePre({ className, children }) {
  const [contentExpanded, setContentExpanded] = useState(false);
  return (
    <pre
      className={className + (contentExpanded ? ' tool-content-expanded' : '')}
      onClick={(e) => { e.stopPropagation(); setContentExpanded(v => !v); }}
      title={contentExpanded ? 'Click to collapse' : 'Click to expand'}
    >{children}</pre>
  );
}

// Shorten absolute paths — keep last 3 segments
function shortPath(p) {
  if (!p || typeof p !== 'string') return p;
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return '…/' + parts.slice(-3).join('/');
}

// Clickable file path — opens file in the IDE explorer
function ClickablePath({ path, onOpenFile }) {
  if (!path || !onOpenFile) {
    return <span className="tool-field-value tool-field-path" title={path}>{shortPath(path)}</span>;
  }
  return (
    <span
      className="tool-field-value tool-field-path tool-field-path-link"
      title={path + ' — click to open'}
      onClick={(e) => { e.stopPropagation(); onOpenFile(path); }}
    >{shortPath(path)}</span>
  );
}

// Rich formatted body for each tool type
function ToolInputFormatted({ name, input, onOpenFile }) {
  if (!input) return null;

  if (name === 'Read') {
    return (
      <div className="tool-formatted">
        <div className="tool-field">
          <span className="tool-field-label">File</span>
          <ClickablePath path={input.file_path} onOpenFile={onOpenFile} />
        </div>
        {input.offset && (
          <div className="tool-field">
            <span className="tool-field-label">Lines</span>
            <span className="tool-field-value">{input.offset}{input.limit ? `–${input.offset + input.limit}` : '+'}</span>
          </div>
        )}
      </div>
    );
  }

  if (name === 'Edit') {
    return (
      <div className="tool-formatted">
        <div className="tool-field">
          <span className="tool-field-label">File</span>
          <ClickablePath path={input.file_path} onOpenFile={onOpenFile} />
        </div>
        {input.replace_all && (
          <div className="tool-field">
            <span className="tool-field-label">Mode</span>
            <span className="tool-field-value tool-field-badge">Replace All</span>
          </div>
        )}
        {input.old_string && (
          <div className="tool-diff">
            <div className="tool-diff-section tool-diff-remove">
              <span className="tool-diff-marker">−</span>
              <pre className="tool-diff-code">{input.old_string}</pre>
            </div>
            <div className="tool-diff-section tool-diff-add">
              <span className="tool-diff-marker">+</span>
              <pre className="tool-diff-code">{input.new_string}</pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (name === 'Write') {
    const preview = input.content && input.content.length > 500
      ? input.content.substring(0, 500) + '\n… (truncated)'
      : input.content;
    return (
      <div className="tool-formatted">
        <div className="tool-field">
          <span className="tool-field-label">File</span>
          <ClickablePath path={input.file_path} onOpenFile={onOpenFile} />
        </div>
        {preview && (
          <div className="tool-diff">
            <div className="tool-diff-section tool-diff-add">
              <span className="tool-diff-marker">+</span>
              <pre className="tool-diff-code">{preview}</pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (name === 'Bash') {
    return (
      <div className="tool-formatted">
        {input.description && (
          <div className="tool-field">
            <span className="tool-field-label">Action</span>
            <span className="tool-field-value">{input.description}</span>
          </div>
        )}
        <div className="tool-bash-command">
          <span className="tool-bash-prompt">$</span>
          <code>{input.command}</code>
        </div>
        {input.timeout && (
          <div className="tool-field">
            <span className="tool-field-label">Timeout</span>
            <span className="tool-field-value">{input.timeout >= 1000 ? `${(input.timeout / 1000).toFixed(0)}s` : `${input.timeout}ms`}</span>
          </div>
        )}
      </div>
    );
  }

  if (name === 'Grep') {
    return (
      <div className="tool-formatted">
        <div className="tool-field">
          <span className="tool-field-label">Pattern</span>
          <code className="tool-field-value tool-field-code">/{input.pattern}/</code>
        </div>
        {input.path && (
          <div className="tool-field">
            <span className="tool-field-label">Path</span>
            <ClickablePath path={input.path} onOpenFile={onOpenFile} />
          </div>
        )}
        {input.glob && (
          <div className="tool-field">
            <span className="tool-field-label">Glob</span>
            <span className="tool-field-value">{input.glob}</span>
          </div>
        )}
        {input.output_mode && (
          <div className="tool-field">
            <span className="tool-field-label">Output</span>
            <span className="tool-field-value">{input.output_mode}</span>
          </div>
        )}
      </div>
    );
  }

  if (name === 'Glob') {
    return (
      <div className="tool-formatted">
        <div className="tool-field">
          <span className="tool-field-label">Pattern</span>
          <code className="tool-field-value tool-field-code">{input.pattern}</code>
        </div>
        {input.path && (
          <div className="tool-field">
            <span className="tool-field-label">Path</span>
            <ClickablePath path={input.path} onOpenFile={onOpenFile} />
          </div>
        )}
      </div>
    );
  }

  if (name === 'Task') {
    return (
      <div className="tool-formatted">
        {input.description && (
          <div className="tool-field">
            <span className="tool-field-label">Task</span>
            <span className="tool-field-value">{input.description}</span>
          </div>
        )}
        {input.subagent_type && (
          <div className="tool-field">
            <span className="tool-field-label">Agent</span>
            <span className="tool-field-value tool-field-badge">{input.subagent_type}</span>
          </div>
        )}
        {input.prompt && (
          <div className="tool-field-block">
            <span className="tool-field-label">Prompt</span>
            <ExpandablePre className="claude-tool-input">{input.prompt}</ExpandablePre>
          </div>
        )}
      </div>
    );
  }

  if (name === 'WebFetch') {
    return (
      <div className="tool-formatted">
        <div className="tool-field">
          <span className="tool-field-label">URL</span>
          <span className="tool-field-value tool-field-path">{input.url}</span>
        </div>
        {input.prompt && (
          <div className="tool-field">
            <span className="tool-field-label">Prompt</span>
            <span className="tool-field-value">{input.prompt}</span>
          </div>
        )}
      </div>
    );
  }

  if (name === 'WebSearch') {
    return (
      <div className="tool-formatted">
        <div className="tool-field">
          <span className="tool-field-label">Query</span>
          <span className="tool-field-value">{input.query}</span>
        </div>
      </div>
    );
  }

  if (name === 'TodoWrite') {
    const todos = input.todos || [];
    if (todos.length === 0) return null;
    const icons = { completed: '✓', in_progress: '◉', pending: '○' };
    const colors = { completed: 'var(--color-completed)', in_progress: 'var(--color-in-progress)', pending: 'var(--text-tertiary)' };
    return (
      <div className="tool-formatted">
        <div className="tool-todo-list">
          {todos.map((t, i) => (
            <div key={i} className={`tool-todo-item tool-todo-${t.status}`}>
              <span className="tool-todo-icon" style={{ color: colors[t.status] }}>{icons[t.status] || '○'}</span>
              <span className="tool-todo-text">{t.content}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (name === 'NotebookEdit') {
    return (
      <div className="tool-formatted">
        <div className="tool-field">
          <span className="tool-field-label">Notebook</span>
          <ClickablePath path={input.notebook_path} onOpenFile={onOpenFile} />
        </div>
        {input.cell_type && (
          <div className="tool-field">
            <span className="tool-field-label">Cell</span>
            <span className="tool-field-value tool-field-badge">{input.cell_type}</span>
          </div>
        )}
        {input.edit_mode && (
          <div className="tool-field">
            <span className="tool-field-label">Mode</span>
            <span className="tool-field-value">{input.edit_mode}</span>
          </div>
        )}
        {input.new_source && (
          <div className="tool-diff">
            <div className="tool-diff-section tool-diff-add">
              <span className="tool-diff-marker">+</span>
              <pre className="tool-diff-code">{input.new_source.length > 500 ? input.new_source.substring(0, 500) + '\n… (truncated)' : input.new_source}</pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback: show raw JSON for unknown tools
  const raw = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  return (
    <div className="tool-formatted">
      <ExpandablePre className="claude-tool-input">{raw}</ExpandablePre>
    </div>
  );
}

// Single collapsible tool call block
function ToolCallBlock({ block, onOpenFile }) {
  const [expanded, setExpanded] = useState(false);
  const summary = toolInputSummary(block.name, block.input);
  const hasResult = block._result !== undefined && block._result !== null;

  return (
    <div className={'claude-tool-call' + (expanded ? ' expanded' : '') + (hasResult ? ' has-result' : '')}>
      <div className="claude-tool-header" onClick={() => setExpanded(e => !e)}>
        <span className="claude-tool-icon">{hasResult ? '✓' : '⚙'}</span>
        <span className="claude-tool-name">{block.name}</span>
        {summary && (
          toolHasFilePath(block.name) && onOpenFile ? (
            <span
              className="claude-tool-summary claude-tool-summary-link"
              title={summary + ' — click to open'}
              onClick={(e) => { e.stopPropagation(); onOpenFile(summary); }}
            >{shortPath(summary)}</span>
          ) : (
            <span className="claude-tool-summary">{summary}</span>
          )
        )}
        <span className="claude-tool-toggle">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="claude-tool-body">
          <ToolInputFormatted name={block.name} input={block.input} onOpenFile={onOpenFile} />
          {hasResult && (
            <>
              <div className="claude-tool-label claude-tool-result-label">Result:</div>
              <ExpandablePre className="claude-tool-result">{toolResultText(block._result)}</ExpandablePre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Interactive question card for AskUserQuestion tool_use events
function AskUserQuestionBlock({ block, onSendAnswer }) {
  const questions = block.input?.questions || [];
  const [selections, setSelections] = useState(() =>
    questions.map(() => [])
  );
  const [answered, setAnswered] = useState(false);

  function toggleOption(qIdx, optIdx, multiSelect) {
    if (answered) return;
    setSelections(prev => {
      const updated = prev.map(s => [...s]);
      if (multiSelect) {
        const idx = updated[qIdx].indexOf(optIdx);
        if (idx >= 0) updated[qIdx].splice(idx, 1);
        else updated[qIdx].push(optIdx);
      } else {
        updated[qIdx] = updated[qIdx][0] === optIdx ? [] : [optIdx];
      }
      return updated;
    });
  }

  function handleSubmit() {
    if (answered) return;
    const hasAnySelection = selections.some(s => s.length > 0);
    if (!hasAnySelection) return;

    const lines = ['Here are my answers:\n'];
    questions.forEach((q, qIdx) => {
      const selectedLabels = selections[qIdx].map(i => q.options[i]?.label).filter(Boolean);
      if (selectedLabels.length > 0) {
        lines.push(`**${q.header || q.question}**: ${selectedLabels.join(', ')}`);
      }
    });

    setAnswered(true);
    if (onSendAnswer) onSendAnswer(lines.join('\n'));
  }

  if (questions.length === 0) return null;

  return (
    <div className={'claude-ask-question' + (answered ? ' claude-ask-answered' : '')}>
      {questions.map((q, qIdx) => (
        <div key={qIdx} className="claude-ask-section">
          <div className="claude-ask-header">{q.header || q.question}</div>
          {q.question && q.header && (
            <div className="claude-ask-subheader">{q.question}</div>
          )}
          <div className="claude-ask-options">
            {(q.options || []).map((opt, optIdx) => {
              const isSelected = selections[qIdx].includes(optIdx);
              return (
                <button
                  key={optIdx}
                  className={'claude-ask-option' + (isSelected ? ' selected' : '')}
                  onClick={() => toggleOption(qIdx, optIdx, q.multiSelect)}
                  disabled={answered}
                >
                  <span className="claude-ask-option-indicator">
                    {q.multiSelect
                      ? (isSelected ? '☑' : '☐')
                      : (isSelected ? '◉' : '○')}
                  </span>
                  <span className="claude-ask-option-content">
                    <span className="claude-ask-option-label">{opt.label}</span>
                    {opt.description && (
                      <span className="claude-ask-option-desc">{opt.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!answered && (
        <button
          className="claude-ask-submit"
          onClick={handleSubmit}
          disabled={!selections.some(s => s.length > 0)}
        >
          Submit Answers
        </button>
      )}
      {answered && (
        <div className="claude-ask-submitted-label">Answers submitted</div>
      )}
    </div>
  );
}

// Human-readable labels for task event fields
const TASK_EVENT_LABELS = {
  subtype: 'Event',
  task_id: 'Task ID',
  tool_use_id: 'Tool Use',
  description: 'Description',
  task_type: 'Task Type',
  uuid: 'UUID',
  session_id: 'Session',
  total_tokens: 'Tokens',
  tool_uses: 'Tool Uses',
  duration_ms: 'Duration',
  last_tool_name: 'Last Tool',
};

function formatTaskEventValue(key, value) {
  if (key === 'duration_ms' && typeof value === 'number') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
  }
  if (key === 'total_tokens' && typeof value === 'number') {
    return value.toLocaleString();
  }
  if (key === 'subtype') {
    return String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return String(value);
}

function TaskEventMessage({ data }) {
  const [expanded, setExpanded] = React.useState(false);
  const subtype = data.subtype || 'task_event';
  const description = data.description || '';
  const label = subtype === 'task_started' ? 'Task Started'
    : subtype === 'task_progress' ? 'Task Progress'
    : subtype.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Fields to show in the expanded details (exclude type and fields already shown in header)
  const detailFields = Object.entries(data).filter(([k]) =>
    k !== 'type' && k !== 'description' && k !== 'message'
  );

  // Flatten usage object into detail fields
  const allDetails = [];
  for (const [k, v] of detailFields) {
    if (k === 'usage' && v && typeof v === 'object') {
      for (const [uk, uv] of Object.entries(v)) {
        allDetails.push([uk, uv]);
      }
    } else {
      allDetails.push([k, v]);
    }
  }

  return (
    <div className="claude-task-event">
      <div className="claude-task-event-header" onClick={() => setExpanded(!expanded)}>
        <span className="claude-task-event-icon">{expanded ? '▾' : '▸'}</span>
        <span className="claude-task-event-label">{label}</span>
        {description && <span className="claude-task-event-desc">{description}</span>}
      </div>
      {expanded && (
        <div className="claude-task-event-details">
          {allDetails.map(([k, v]) => (
            <div key={k} className="claude-task-event-row">
              <span className="claude-task-event-key">{TASK_EVENT_LABELS[k] || k}</span>
              <span className="claude-task-event-value">{formatTaskEventValue(k, v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Copy-to-clipboard button shown on hover over chat bubbles
function CopyBubbleButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button className="claude-bubble-copy" onClick={handleCopy} title="Copy message">
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

// A single conversation message
function ConversationMessage({ msg, isLatestThinking, onSendAnswer, onOpenFile }) {
  if (msg.type === 'thinking') {
    return <ThinkingBubble msg={msg} isLatest={isLatestThinking} />;
  }
  if (msg.type === 'user') {
    return (
      <div className="claude-message claude-user">
        <CopyBubbleButton text={msg.text} />
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
    return (
      <div className="claude-message claude-assistant">
        <CopyBubbleButton text={msg.text} />
        <div
          className="claude-message-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
        />
      </div>
    );
  }
  if (msg.type === 'tool_call') {
    if (msg.block?.name === 'AskUserQuestion') {
      return <AskUserQuestionBlock block={msg.block} onSendAnswer={onSendAnswer} />;
    }
    return <ToolCallBlock block={msg.block || {}} onOpenFile={onOpenFile} />;
  }
  if (msg.type === 'system') {
    if (msg.isTaskEvent && msg.taskEventData) {
      return <TaskEventMessage data={msg.taskEventData} />;
    }
    // Catch legacy raw-JSON task events already stored in message history
    if (msg.text && msg.text.startsWith('{') && /"subtype"\s*:\s*"task_(progress|started|completed|failed)"/.test(msg.text)) {
      try {
        const parsed = JSON.parse(msg.text);
        return <TaskEventMessage data={parsed} />;
      } catch (_) { /* fall through to default rendering */ }
    }
    return (
      <div className={'claude-system-msg' + (msg.isError ? ' claude-error' : '') + (msg.isCompaction ? ' claude-compaction' : '')}>
        {msg.text}
      </div>
    );
  }
  if (msg.type === 'tool_result_standalone') {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--color-completed)', borderRadius: 6, padding: '6px 10px', alignSelf: 'flex-start', maxWidth: '90%', fontSize: '0.75rem', overflowWrap: 'break-word', wordBreak: 'break-word', minWidth: 0 }}>
        <span style={{ color: 'var(--color-completed)' }}>[TOOL_RESULT_STANDALONE]</span>{' '}
        <span style={{ color: 'var(--text-secondary)' }}>{String(toolResultText(msg.content)).substring(0, 100)}</span>
      </div>
    );
  }
  // DEBUG: catch any unknown message types
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--color-failed)', borderRadius: 6, padding: '6px 10px', alignSelf: 'flex-start', fontSize: '0.75rem' }}>
      <span style={{ color: 'var(--color-failed)' }}>[UNKNOWN type="{msg.type}"]</span>{' '}
      <span style={{ color: 'var(--text-tertiary)' }}>{JSON.stringify(msg).substring(0, 150)}</span>
    </div>
  );
}

export default function ClaudeView({ onClose, hideHeader, viewMode }) {
  const api = window.electronAPI || null;
  const state = useAppState();
  const dispatch = useDispatch();

  // Pull persistent state from context
  const messages = state.claudeMessages;
  const isProcessing = state.claudeIsProcessing;
  const status = state.claudeStatus;
  const dashboardId = state.currentDashboardId;
  if (!dashboardId) return <div className="claude-view-empty">Select a dashboard to begin</div>;
  const pendingAttachments = state.claudePendingAttachments;
  const pendingPermission = state.pendingPermission;
  const tabs = state.claudeTabs[dashboardId] || [{ id: 'default', name: 'Chat 1' }];
  const activeTabId = state.claudeActiveTabId;
  const [processingTabId, setProcessingTabId] = useState(null);

  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState(resolveModel('claude'));
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [showQuickAccessEditor, setShowQuickAccessEditor] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState({});
  const quickAccessEditorRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Session / conversation persistence (per-dashboard:tab)
  const sessionIdRef = useRef(null);    // CLI session_id for --resume
  const convIdRef = useRef(null);       // saved conversation id
  const convCreatedRef = useRef(null);  // ISO string of conversation creation
  const messagesRef = useRef(messages); // mirror of messages for async saves
  const sessionMapRef = useRef({});     // { [dashboardId:tabId]: { sessionId, convId, convCreated } }
  const prevDashboardRef = useRef(dashboardId);
  const prevTabRef = useRef(activeTabId);
  const activeTabRef = useRef(activeTabId);

  const conversationRef = useRef(null);
  // Smart scroll — track whether user is at bottom, count unseen messages
  const isAtBottomRef = useRef(true);
  const prevMsgLengthRef = useRef(0);
  const [newMsgCount, setNewMsgCount] = useState(0);
  // Track all active task IDs (multiple workers can be running)
  const activeTaskIdsRef = useRef(new Set());
  const codexStreamedTaskIdsRef = useRef(new Set());
  // Map: taskId -> pid (for killing specific workers)
  const taskPidMapRef = useRef({});
  // Map: tool_use_id -> index in messages array (for appending results)
  const toolCallIndexRef = useRef({});
  // Index of current accumulating assistant text message
  const currentTextIndexRef = useRef(null);
  // Streaming content block accumulator: { index -> { type, id, name, input_json, thinking } }
  const streamingBlocksRef = useRef({});
  // Track whether we received streaming content_block events (to skip duplicate assistant summary)
  const sawStreamingRef = useRef(false);
  // Track whether current task is a resumed session (history replay events should be ignored)
  const isResumedSessionRef = useRef(false);
  // Health check consecutive failure counter — only hard-reset after 3 consecutive IPC failures
  const healthFailCountRef = useRef(0);
  // Stable refs so IPC listeners always call latest functions
  const handleChunkRef = useRef(null);
  const finishRef = useRef(null);
  // Throttled preview dispatch timer for sidebar chat previews
  const previewFlushTimerRef = useRef(null);
  // Session-scoped set of tool names the user has chosen to "always allow"
  const allowedToolsRef = useRef(new Set());

  // Keep refs in sync for async operations
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { activeTabRef.current = activeTabId; }, [activeTabId]);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);
  // Auto-resize textarea when prompt changes programmatically (tab/dashboard switch)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [prompt]);

  // Stash/restore per-dashboard refs when dashboard changes — never lose running workers
  const activeTaskStashRef = useRef({});  // { [dashboardId]: Set of taskIds }
  const codexStashRef = useRef({});       // { [dashboardId]: Set of taskIds }
  const textIndexStashRef = useRef({});   // { [dashboardId]: currentTextIndex }
  const toolIndexStashRef = useRef({});   // { [dashboardId]: toolCallIndexMap }
  // Global map: taskId → dashboardId (persists across switches so we can route output)
  const taskDashboardMapRef = useRef({});
  // Global map: taskId → tabId (which tab the task was started on)
  const taskTabMapRef = useRef({});
  // Per-dashboard:tab input text stash — ensures prompt text switches with context
  const promptStashRef = useRef({});  // { [dashboardId:tabId]: string }
  const promptRef = useRef('');       // mirror of prompt for async access in effects

  useEffect(() => {
    const dashChanged = prevDashboardRef.current !== dashboardId;
    const tabChanged = prevTabRef.current !== activeTabId;
    if (!dashChanged && !tabChanged) return;

    const prevDid = prevDashboardRef.current;
    const prevTab = prevTabRef.current;

    // Stash current session info (refs still hold old tab's values)
    sessionMapRef.current[prevDid + ':' + prevTab] = {
      sessionId: sessionIdRef.current,
      convId: convIdRef.current,
      convCreated: convCreatedRef.current,
    };

    // Stash current input text and restore target's input text
    promptStashRef.current[prevDid + ':' + prevTab] = promptRef.current;
    const restoredPrompt = promptStashRef.current[dashboardId + ':' + activeTabId] || '';
    setPrompt(restoredPrompt);

    if (dashChanged) {
      // Stash active task refs so workers keep being tracked when we switch back
      activeTaskStashRef.current[prevDid] = new Set(activeTaskIdsRef.current);
      codexStashRef.current[prevDid] = new Set(codexStreamedTaskIdsRef.current);
      textIndexStashRef.current[prevDid] = currentTextIndexRef.current;
      toolIndexStashRef.current[prevDid] = { ...toolCallIndexRef.current };
      // Restore target dashboard's active task refs
      activeTaskIdsRef.current = activeTaskStashRef.current[dashboardId] || new Set();
      codexStreamedTaskIdsRef.current = codexStashRef.current[dashboardId] || new Set();
      currentTextIndexRef.current = textIndexStashRef.current[dashboardId] ?? null;
      toolCallIndexRef.current = toolIndexStashRef.current[dashboardId] || {};
    } else {
      // Tab switch only — streaming state is flushed/reset by switchToTab() before dispatch
    }

    // Restore target session info
    const restored = sessionMapRef.current[dashboardId + ':' + activeTabId] || {};
    sessionIdRef.current = restored.sessionId || null;
    convIdRef.current = restored.convId || null;
    convCreatedRef.current = restored.convCreated || null;

    prevDashboardRef.current = dashboardId;
    prevTabRef.current = activeTabId;
  }, [dashboardId, activeTabId]);

  // Scroll helpers
  const scrollTrigger = messages.length + (messages[messages.length - 1]?.text?.length || 0);
  function scrollToBottom() {
    if (!conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }

  // Track scroll position — detect when user scrolls away from bottom
  useEffect(() => {
    const el = conversationRef.current;
    if (!el) return;
    function handleScroll() {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      isAtBottomRef.current = atBottom;
      if (atBottom) setNewMsgCount(0);
    }
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Smart auto-scroll — only scroll if user is near bottom, otherwise count new messages
  useEffect(() => {
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
    } else {
      const added = messages.length - prevMsgLengthRef.current;
      if (added > 0) setNewMsgCount(c => c + added);
    }
    prevMsgLengthRef.current = messages.length;
  }, [scrollTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on dashboard/tab switch (always)
  useEffect(() => {
    isAtBottomRef.current = true;
    setNewMsgCount(0);
    prevMsgLengthRef.current = messages.length;
    requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
  }, [dashboardId, activeTabId]); // eslint-disable-line react-hooks-exhaustive-deps

  // Scroll to bottom on initial mount
  useEffect(() => {
    isAtBottomRef.current = true;
    scrollToBottom();
    requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when chat panel expands from minimized (e.g. sidebar click, expand button)
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (prev === 'minimized' && viewMode && viewMode !== 'minimized') {
      isAtBottomRef.current = true;
      setNewMsgCount(0);
      requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
    }
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  function scrollToNew() {
    scrollToBottom();
    isAtBottomRef.current = true;
    setNewMsgCount(0);
  }

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

  // Set up push listeners — route output to correct dashboard (current or stashed)
  useEffect(() => {
    if (!api) return;

    // Helper: check if a taskId belongs to any dashboard (current or stashed)
    function isKnownTask(taskId) {
      if (activeTaskIdsRef.current.has(taskId)) return true;
      for (const did in activeTaskStashRef.current) {
        if (activeTaskStashRef.current[did]?.has(taskId)) return true;
      }
      return false;
    }

    // Helper: check if taskId belongs to the currently active dashboard
    function isCurrentDashboardTask(taskId) {
      return activeTaskIdsRef.current.has(taskId);
    }

    // Helper: find which stashed dashboard owns this task
    function getStashedDashboard(taskId) {
      return taskDashboardMapRef.current[taskId] || null;
    }

    // Helper: route output to a specific tab's stash on the current dashboard
    function routeToTabStash(data, targetTab) {
      const chunk = data.chunk;
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          if (evt.type === 'assistant') {
            const content = evt.message?.content || evt.content || [];
            for (const block of content) {
              if (block.type === 'text') {
                const cleaned = stripAnsi(block.text);
                if (cleaned && cleaned.trim()) {
                  dispatch({ type: 'CLAUDE_TAB_STASH_APPEND_MSG', tabId: targetTab, msg: { type: 'assistant', text: cleaned } });
                }
              } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                dispatch({ type: 'CLAUDE_TAB_STASH_APPEND_MSG', tabId: targetTab, msg: { type: 'tool_call', block: { id: block.id, name: block.name, input: block.input } } });
              } else if (block.type === 'thinking' || block.type === 'extended_thinking') {
                dispatch({ type: 'CLAUDE_TAB_STASH_APPEND_MSG', tabId: targetTab, msg: { type: 'thinking', text: block.thinking || '' } });
              }
            }
          } else if (evt.type === 'system') {
            if (evt.subtype === 'init') {
              dispatch({ type: 'CLAUDE_TAB_STASH_APPEND_MSG', tabId: targetTab, msg: { type: 'system', text: `Connected — model: ${evt.model || '?'}, ${(evt.tools || []).length} tools available` } });
            }
          } else if (evt.type === 'result') {
            if (evt.session_id) {
              const targetKey = prevDashboardRef.current + ':' + targetTab;
              const storedSession = sessionMapRef.current[targetKey] || {};
              sessionMapRef.current[targetKey] = { ...storedSession, sessionId: evt.session_id };
            }
          }
        } catch (e) { /* non-JSON — skip */ }
      }
    }

    const workerListener = api.on('worker-output', (data) => {
      if (!isKnownTask(data.taskId)) return;

      if (isCurrentDashboardTask(data.taskId)) {
        // Active dashboard — check if task's tab matches active tab
        const taskTab = taskTabMapRef.current[data.taskId];
        if (!taskTab || taskTab === activeTabRef.current) {
          // Same tab — process with full streaming
          if (handleChunkRef.current) handleChunkRef.current(data);
        } else {
          // Different tab on same dashboard — route to tab stash
          routeToTabStash(data, taskTab);
        }
      } else {
        // Non-active dashboard — buffer chunks into stashed messages
        const targetDash = getStashedDashboard(data.taskId);
        if (!targetDash) return;
        const chunk = data.chunk;
        const lines = chunk.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            // Only capture text and tool_use from assistant events for stashed dashboards
            if (evt.type === 'assistant') {
              const content = evt.message?.content || evt.content || [];
              for (const block of content) {
                if (block.type === 'text') {
                  const cleaned = stripAnsi(block.text);
                  if (cleaned && cleaned.trim()) {
                    dispatch({ type: 'CLAUDE_STASH_APPEND_MSG', dashboardId: targetDash, msg: { type: 'assistant', text: cleaned } });
                    // Also update preview for this stashed dashboard
                    dispatch({ type: 'SET_CHAT_PREVIEW', dashboardId: targetDash, text: cleaned.substring(0, 60), isStreaming: true });
                  }
                } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                  dispatch({ type: 'CLAUDE_STASH_APPEND_MSG', dashboardId: targetDash, msg: { type: 'tool_call', block: { id: block.id, name: block.name, input: block.input } } });
                } else if (block.type === 'thinking' || block.type === 'extended_thinking') {
                  dispatch({ type: 'CLAUDE_STASH_APPEND_MSG', dashboardId: targetDash, msg: { type: 'thinking', text: block.thinking || '' } });
                }
              }
            } else if (evt.type === 'content_block_stop') {
              // Handle streaming format for stashed dashboards (simplified — just capture the final block)
              // Full streaming state for stashed dashboards isn't tracked, but content_block_stop
              // with complete data will be handled when the assistant event arrives
            } else if (evt.type === 'system') {
              if (evt.subtype === 'init') {
                dispatch({ type: 'CLAUDE_STASH_APPEND_MSG', dashboardId: targetDash, msg: { type: 'system', text: `Connected — model: ${evt.model || '?'}, ${(evt.tools || []).length} tools available` } });
              }
            } else if (evt.type === 'result') {
              if (evt.session_id) {
                // Stash the session ID for this dashboard:tab
                const targetTab = taskTabMapRef.current[data.taskId] || 'default';
                const targetKey = targetDash + ':' + targetTab;
                const storedSession = sessionMapRef.current[targetKey] || {};
                sessionMapRef.current[targetKey] = { ...storedSession, sessionId: evt.session_id };
              }
            }
          } catch (e) {
            // Non-JSON output for stashed dashboard — skip (progress bars, etc.)
          }
        }
      }
    });

    const completeListener = api.on('worker-complete', (data) => {
      if (!isKnownTask(data.taskId)) return;

      if (isCurrentDashboardTask(data.taskId)) {
        const taskTab = taskTabMapRef.current[data.taskId];
        const isActiveTab = !taskTab || taskTab === activeTabRef.current;

        if (isActiveTab) {
          // Active tab — process normally with streaming finish
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
        } else {
          // Different tab on same dashboard — route to tab stash
          if (data.provider === 'codex' && data.lastMessage && !codexStreamedTaskIdsRef.current.has(data.taskId)) {
            dispatch({ type: 'CLAUDE_TAB_STASH_APPEND_MSG', tabId: taskTab, msg: { type: 'assistant', text: data.lastMessage } });
          }
          if (data.errorOutput) {
            dispatch({ type: 'CLAUDE_TAB_STASH_APPEND_MSG', tabId: taskTab, msg: { type: 'system', text: '[stderr] ' + data.errorOutput, isError: true } });
          }
          // Lightweight cleanup (skip auto-save — messages persisted in stash)
          activeTaskIdsRef.current.delete(data.taskId);
          codexStreamedTaskIdsRef.current.delete(data.taskId);
          delete taskDashboardMapRef.current[data.taskId];
          delete taskTabMapRef.current[data.taskId];
          delete taskPidMapRef.current[data.taskId];
          if (activeTaskIdsRef.current.size === 0) {
            dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
            dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
            setProcessingTabId(null);
          }
          if (api && prevDashboardRef.current) {
            api.logChatEvent(prevDashboardRef.current, { level: 'info', message: 'Claude chat response completed', task_id: data.taskId }).catch(() => {});
          }
        }
      } else {
        // Non-active dashboard — update stashed state
        const targetDash = getStashedDashboard(data.taskId);
        if (!targetDash) return;
        if (data.provider === 'codex' && data.lastMessage) {
          dispatch({ type: 'CLAUDE_STASH_APPEND_MSG', dashboardId: targetDash, msg: { type: 'assistant', text: data.lastMessage } });
        }
        if (data.errorOutput) {
          dispatch({ type: 'CLAUDE_STASH_APPEND_MSG', dashboardId: targetDash, msg: { type: 'system', text: '[stderr] ' + data.errorOutput, isError: true } });
        }
        // Remove from stashed active tasks and update processing state
        const stashedSet = activeTaskStashRef.current[targetDash];
        if (stashedSet) {
          stashedSet.delete(data.taskId);
          if (stashedSet.size === 0) {
            dispatch({ type: 'CLAUDE_STASH_SET_PROCESSING', dashboardId: targetDash, value: false, status: 'Ready' });
          }
        }
        delete taskDashboardMapRef.current[data.taskId];
        delete taskTabMapRef.current[data.taskId];
        delete taskPidMapRef.current[data.taskId];
      }
    });

    // Listen for worker-error events (process spawn failures, etc.)
    const errorListener = api.on('worker-error', (data) => {
      if (!isKnownTask(data.taskId)) return;

      if (isCurrentDashboardTask(data.taskId)) {
        const taskTab = taskTabMapRef.current[data.taskId];
        const isActiveTab = !taskTab || taskTab === activeTabRef.current;

        if (isActiveTab) {
          dispatch({
            type: 'CLAUDE_APPEND_MSG',
            msg: { type: 'system', text: '⚠ Connection lost — the agent process ended unexpectedly' + (data.error ? ': ' + data.error : '.'), isError: true }
          });
          if (finishRef.current) finishRef.current(data.taskId);
        } else {
          dispatch({ type: 'CLAUDE_TAB_STASH_APPEND_MSG', tabId: taskTab, msg: { type: 'system', text: '⚠ Connection lost — the agent process ended unexpectedly.', isError: true } });
          activeTaskIdsRef.current.delete(data.taskId);
          delete taskDashboardMapRef.current[data.taskId];
          delete taskTabMapRef.current[data.taskId];
          delete taskPidMapRef.current[data.taskId];
          if (activeTaskIdsRef.current.size === 0) {
            dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
            dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
            setProcessingTabId(null);
          }
        }
      } else {
        const targetDash = getStashedDashboard(data.taskId);
        if (targetDash) {
          dispatch({ type: 'CLAUDE_STASH_APPEND_MSG', dashboardId: targetDash, msg: { type: 'system', text: '⚠ Connection lost — the agent process ended unexpectedly.', isError: true } });
          const stashedSet = activeTaskStashRef.current[targetDash];
          if (stashedSet) {
            stashedSet.delete(data.taskId);
            if (stashedSet.size === 0) {
              dispatch({ type: 'CLAUDE_STASH_SET_PROCESSING', dashboardId: targetDash, value: false, status: 'Ready' });
            }
          }
          delete taskDashboardMapRef.current[data.taskId];
          delete taskTabMapRef.current[data.taskId];
          delete taskPidMapRef.current[data.taskId];
        }
      }
    });

    return () => {
      if (workerListener) workerListener();
      if (completeListener) completeListener();
      if (errorListener) errorListener();
      if (previewFlushTimerRef.current) clearTimeout(previewFlushTimerRef.current);
    };
  }, [api, dispatch]);

  // --- Process health check: detect orphaned tasks where the subprocess died silently ---
  // Polls getActiveWorkers() every 8s and compares against locally tracked tasks.
  // If a tracked task's PID is no longer in the active workers list, it means the
  // process exited but we never received the worker-complete/worker-error event.
  useEffect(() => {
    if (!api || !api.getActiveWorkers) return;
    const HEALTH_CHECK_INTERVAL = 8000;

    const healthTimer = setInterval(async () => {
      // Only check if we think we have active tasks
      if (activeTaskIdsRef.current.size === 0) return;

      try {
        const remoteWorkers = await api.getActiveWorkers();
        const remotePids = new Set(remoteWorkers.map(w => w.pid));
        // IPC succeeded — reset consecutive failure counter
        healthFailCountRef.current = 0;

        // Check each locally tracked task
        const orphanedTasks = [];
        for (const taskId of activeTaskIdsRef.current) {
          const pid = taskPidMapRef.current[taskId];
          // If we have a PID and it's not in the remote active list, the process is gone
          if (pid && !remotePids.has(pid)) {
            orphanedTasks.push(taskId);
          }
        }

        // Clean up orphaned tasks
        for (const taskId of orphanedTasks) {
          const taskTab = taskTabMapRef.current[taskId];
          const isActiveTab = !taskTab || taskTab === activeTabRef.current;

          if (isActiveTab) {
            dispatch({
              type: 'CLAUDE_APPEND_MSG',
              msg: { type: 'system', text: '⚠ Connection lost — the agent process stopped unexpectedly. You can send a new message to continue.', isError: true }
            });
          } else {
            dispatch({ type: 'CLAUDE_TAB_STASH_APPEND_MSG', tabId: taskTab, msg: { type: 'system', text: '⚠ Connection lost — the agent process stopped unexpectedly.', isError: true } });
          }

          activeTaskIdsRef.current.delete(taskId);
          codexStreamedTaskIdsRef.current.delete(taskId);
          delete taskDashboardMapRef.current[taskId];
          delete taskTabMapRef.current[taskId];
          delete taskPidMapRef.current[taskId];
        }

        if (orphanedTasks.length > 0 && activeTaskIdsRef.current.size === 0) {
          dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
          dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
          setProcessingTabId(null);
        }

        // Also check stashed dashboard tasks
        for (const [dashId, stashedSet] of Object.entries(activeTaskStashRef.current)) {
          if (!stashedSet || stashedSet.size === 0) continue;
          const stashedOrphans = [];
          for (const taskId of stashedSet) {
            const pid = taskPidMapRef.current[taskId];
            if (pid && !remotePids.has(pid)) {
              stashedOrphans.push(taskId);
            }
          }
          for (const taskId of stashedOrphans) {
            dispatch({ type: 'CLAUDE_STASH_APPEND_MSG', dashboardId: dashId, msg: { type: 'system', text: '⚠ Connection lost — the agent process stopped unexpectedly.', isError: true } });
            stashedSet.delete(taskId);
            delete taskDashboardMapRef.current[taskId];
            delete taskTabMapRef.current[taskId];
            delete taskPidMapRef.current[taskId];
          }
          if (stashedOrphans.length > 0 && stashedSet.size === 0) {
            dispatch({ type: 'CLAUDE_STASH_SET_PROCESSING', dashboardId: dashId, value: false, status: 'Ready' });
          }
        }
      } catch (e) {
        // getActiveWorkers failed — IPC may be temporarily broken
        healthFailCountRef.current += 1;
        console.warn('[ClaudeView] Health check IPC failure:', e);
        // Only do a hard reset after 3 consecutive failures to avoid
        // wiping task tracking on a single transient IPC hiccup
        if (healthFailCountRef.current >= 3 && activeTaskIdsRef.current.size > 0) {
          dispatch({
            type: 'CLAUDE_APPEND_MSG',
            msg: { type: 'system', text: '⚠ Connection lost — unable to reach the agent process. You can send a new message to continue.', isError: true }
          });
          activeTaskIdsRef.current.clear();
          taskPidMapRef.current = {};
          taskDashboardMapRef.current = {};
          taskTabMapRef.current = {};
          dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
          dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
          setProcessingTabId(null);
        }
      }
    }, HEALTH_CHECK_INTERVAL);

    return () => clearInterval(healthTimer);
  }, [api, dispatch]);

  // --- State mutation helpers using functional updater (avoids stale closures) ---

  function appendMsg(msg) {
    dispatch({ type: 'CLAUDE_APPEND_MSG', msg });
  }

  // --- Buffered streaming for maximum throughput ---
  // Accumulates deltas and flushes to React state at most every 32ms (~30fps).
  // This avoids dispatching a state update + re-render on every single character delta.
  const STREAM_FLUSH_MS = 32;

  // Text buffer
  const textBufferRef = useRef('');
  const textFlushTimerRef = useRef(null);

  // Thinking buffer
  const thinkingBufferRef = useRef('');
  const thinkingFlushTimerRef = useRef(null);
  const currentThinkingIndexRef = useRef(null);

  function commitTextBuffer() {
    const buffered = textBufferRef.current;
    if (!buffered) return;
    textBufferRef.current = '';
    textFlushTimerRef.current = null;

    dispatch({ type: 'CLAUDE_UPDATE_MESSAGES', updater: (prev) => {
      if (currentTextIndexRef.current !== null && currentTextIndexRef.current < prev.length) {
        const idx = currentTextIndexRef.current;
        const updated = prev.slice();
        updated[idx] = { ...updated[idx], text: updated[idx].text + buffered };
        return updated;
      }
      const newMsg = { id: Date.now() + Math.random(), type: 'assistant', text: buffered };
      currentTextIndexRef.current = prev.length;
      return [...prev, newMsg];
    }});

    // Throttled preview update for sidebar
    if (!previewFlushTimerRef.current) {
      previewFlushTimerRef.current = setTimeout(() => {
        previewFlushTimerRef.current = null;
        const msgs = messagesRef.current;
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          if (last.type === 'assistant' && last.text) {
            const preview = last.text.length > 60 ? '...' + last.text.slice(-57) : last.text;
            dispatch({ type: 'SET_CHAT_PREVIEW', dashboardId, text: preview, isStreaming: true });
          }
        }
      }, 200);
    }
  }

  function commitThinkingBuffer() {
    const buffered = thinkingBufferRef.current;
    if (!buffered) return;
    thinkingBufferRef.current = '';
    thinkingFlushTimerRef.current = null;

    dispatch({ type: 'CLAUDE_UPDATE_MESSAGES', updater: (prev) => {
      if (currentThinkingIndexRef.current !== null && currentThinkingIndexRef.current < prev.length) {
        const idx = currentThinkingIndexRef.current;
        const updated = prev.slice();
        updated[idx] = { ...updated[idx], text: updated[idx].text + buffered };
        return updated;
      }
      const newMsg = { id: Date.now() + Math.random(), type: 'thinking', text: buffered };
      currentThinkingIndexRef.current = prev.length;
      return [...prev, newMsg];
    }});
  }

  function flushText() {
    // Force-commit any buffered text immediately
    if (textFlushTimerRef.current) {
      clearTimeout(textFlushTimerRef.current);
      textFlushTimerRef.current = null;
    }
    commitTextBuffer();
    currentTextIndexRef.current = null;
  }

  function flushThinking() {
    if (thinkingFlushTimerRef.current) {
      clearTimeout(thinkingFlushTimerRef.current);
      thinkingFlushTimerRef.current = null;
    }
    commitThinkingBuffer();
    currentThinkingIndexRef.current = null;
  }

  function appendTextContent(text) {
    textBufferRef.current += text;
    if (!textFlushTimerRef.current) {
      textFlushTimerRef.current = setTimeout(commitTextBuffer, STREAM_FLUSH_MS);
    }
  }

  function appendThinkingContent(text) {
    thinkingBufferRef.current += text;
    if (!thinkingFlushTimerRef.current) {
      thinkingFlushTimerRef.current = setTimeout(commitThinkingBuffer, STREAM_FLUSH_MS);
    }
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
    flushThinking();
    dispatch({ type: 'CLAUDE_UPDATE_MESSAGES', updater: (prev) => {
      if (block.id) {
        toolCallIndexRef.current[block.id] = prev.length;
      }
      return [...prev, { id: Date.now() + Math.random(), type: 'tool_call', block }];
    }});
  }

  // Test if a line is purely CLI progress/spinner output (no meaningful text)
  function isProgressBarLine(str) {
    // Strip all known progress bar, spinner, box-drawing, and braille characters
    const stripped = str.replace(/[\u2580-\u259F\u2500-\u257F\u2800-\u28FF\u2588█▓▒░━─═●○◉◎◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷▰▱▮▯■□▪▫◼◻⬛⬜⏳⏸⏵⏹✓✗✘→←↑↓•·…‥─╌╍╎╏┄┅┆┇┈┉┊┋]/g, '').trim();
    // Also skip lines that are just dashes, equals, underscores, dots, or whitespace
    const withoutFiller = stripped.replace(/[-=_.·•\s]/g, '').trim();
    return withoutFiller.length === 0;
  }

  function handleChunk(data) {
    const chunk = data.chunk;
    const pid = data.pid;
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        processEvent(evt, data.taskId, pid);
      } catch (e) {
        // Non-JSON output from CLI — strip ANSI and skip progress/spinner lines
        const cleaned = stripAnsi(trimmed).trim();
        if (cleaned && /auto.?compact|compacting conversation/i.test(cleaned)) {
          flushText();
          flushThinking();
          appendMsg({ type: 'system', text: 'Context is being compacted — earlier messages may be summarized', isCompaction: true });
          // Reset streaming state — compaction invalidates current message indices
          currentTextIndexRef.current = null;
          currentThinkingIndexRef.current = null;
          toolCallIndexRef.current = {};
          sawStreamingRef.current = false;
        } else if (cleaned && !isProgressBarLine(cleaned)) {
          appendTextContent(cleaned + '\n');
        }
      }
    }
  }

  function processEvent(evt, taskId, pid) {
    if (!evt || !evt.type) return;

    switch (evt.type) {
      case 'system': {
        if (evt.subtype === 'init') {
          const tools = evt.tools || [];
          appendMsg({
            type: 'system',
            text: `Connected — model: ${evt.model || '?'}, ${tools.length} tools available`,
          });
        } else if (evt.subtype === 'task_progress' || evt.subtype === 'task_started' || evt.subtype === 'task_completed' || evt.subtype === 'task_failed') {
          appendMsg({ type: 'system', isTaskEvent: true, taskEventData: evt, text: evt.description || evt.subtype });
        } else {
          const msg = evt.message || JSON.stringify(evt);
          const isCompaction = /compact|context.*(truncat|compress|summar)/i.test(msg)
            || evt.subtype === 'auto_compact' || evt.subtype === 'compact';
          appendMsg({ type: 'system', text: isCompaction ? 'Context is being compacted — earlier messages may be summarized' : msg, isCompaction });
        }
        break;
      }

      case 'assistant': {
        // Skip if: (a) streaming content_block events already rendered this turn's
        // content, or (b) this is a resumed session replaying history that's already
        // in the UI. In both cases, the assistant event would produce duplicates.
        if (sawStreamingRef.current || isResumedSessionRef.current) break;
        const content = evt.message?.content || evt.content || [];
        for (const block of content) {
          if (block.type === 'text') {
            const cleaned = stripAnsi(block.text);
            if (cleaned && cleaned.trim()) {
              appendTextContent(cleaned);
            }
          } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
            addToolCall({
              id: block.id,
              name: block.name,
              input: block.input,
            });
          } else if (block.type === 'thinking' || block.type === 'extended_thinking') {
            dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Thinking...' });
            appendMsg({ type: 'thinking', text: block.thinking || '' });
          }
        }
        break;
      }

      // --- Streaming content block events (Claude CLI stream-json format) ---
      case 'content_block_start': {
        sawStreamingRef.current = true;
        isResumedSessionRef.current = false; // history replay is over, new content starts
        const block = evt.content_block || {};
        const idx = evt.index ?? 0;
        if (block.type === 'tool_use' || block.type === 'server_tool_use') {
          streamingBlocksRef.current[idx] = {
            type: 'tool_use', id: block.id, name: block.name, input_json: '',
          };
          dispatch({ type: 'CLAUDE_SET_STATUS', value: `Tool: ${block.name}` });
        } else if (block.type === 'thinking' || block.type === 'extended_thinking') {
          streamingBlocksRef.current[idx] = { type: 'thinking', thinking: '' };
          dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Thinking...' });
        } else if (block.type === 'text') {
          streamingBlocksRef.current[idx] = { type: 'text', text: '' };
          dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Responding...' });
        }
        break;
      }

      case 'content_block_delta': {
        const idx = evt.index ?? 0;
        const delta = evt.delta || {};
        const acc = streamingBlocksRef.current[idx];
        if (!acc) break;

        if (delta.type === 'text_delta' && acc.type === 'text') {
          const cleaned = stripAnsi(delta.text || '');
          if (cleaned) appendTextContent(cleaned);
        } else if (delta.type === 'thinking_delta' && acc.type === 'thinking') {
          const thinking = delta.thinking || '';
          if (thinking) appendThinkingContent(thinking);
        } else if (delta.type === 'input_json_delta' && acc.type === 'tool_use') {
          acc.input_json += (delta.partial_json || '');
        }
        break;
      }

      case 'content_block_stop': {
        const idx = evt.index ?? 0;
        const acc = streamingBlocksRef.current[idx];
        if (!acc) break;

        if (acc.type === 'tool_use') {
          let input = {};
          try { input = JSON.parse(acc.input_json); } catch (e) { /* partial */ }
          addToolCall({ id: acc.id, name: acc.name, input });
        } else if (acc.type === 'thinking') {
          flushThinking();
        } else if (acc.type === 'text') {
          flushText();
        }
        delete streamingBlocksRef.current[idx];
        break;
      }

      case 'message_start':
      case 'message_delta':
        // Message-level streaming events — session_id may appear here
        if (evt.message?.id) { /* message started */ }
        break;

      case 'message_stop':
        flushText();
        flushThinking();
        streamingBlocksRef.current = {};
        sawStreamingRef.current = false;
        isResumedSessionRef.current = false;
        dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
        break;

      case 'user': {
        // Skip replayed user events during resumed sessions — already in the UI
        if (isResumedSessionRef.current) break;
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
        flushThinking();
        streamingBlocksRef.current = {};
        sawStreamingRef.current = false;
        isResumedSessionRef.current = false;
        if (evt.session_id) sessionIdRef.current = evt.session_id;
        dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
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
      case 'ping':
        break;

      // --- Permission request from Claude CLI (--permission-prompt-tool stdio) ---
      case 'control_request': {
        const req = evt.request || {};
        if (req.subtype === 'can_use_tool') {
          const toolName = req.tool_name || 'unknown';
          const toolInput = req.input || {};
          const requestId = evt.request_id || null;
          const toolUseId = req.tool_use_id || null;
          dispatch({
            type: 'PERMISSION_REQUEST',
            permission: {
              pid: pid || null,
              toolName,
              toolInput,
              requestId,
              toolUseId,
              timestamp: Date.now(),
            },
          });
          dispatch({ type: 'CLAUDE_SET_STATUS', value: `Permission: ${toolName}` });
          appendMsg({
            type: 'system',
            text: `Permission requested for tool: ${toolName}`,
            isPermission: true,
          });
        }
        break;
      }

      default:
        console.log('[ClaudeView] unhandled event type:', evt.type, JSON.stringify(evt).substring(0, 200));
        break;
    }
  }

  function finishProcessing(taskId) {
    // Capture the task's original dashboard ID before cleanup deletes it.
    // If the user switched dashboards during execution, the closure-captured
    // `dashboardId` would be stale — this ref lookup ensures we target the
    // correct dashboard for preview updates, logging, and conversation saves.
    const taskDashId = taskDashboardMapRef.current[taskId] || dashboardId;

    activeTaskIdsRef.current.delete(taskId);
    codexStreamedTaskIdsRef.current.delete(taskId);
    delete taskDashboardMapRef.current[taskId];
    delete taskTabMapRef.current[taskId];
    delete taskPidMapRef.current[taskId];
    // Only mark as not processing when ALL workers are done
    if (activeTaskIdsRef.current.size === 0) {
      dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
      dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
      setProcessingTabId(null);
    }

    // Clear preview throttle timer
    if (previewFlushTimerRef.current) {
      clearTimeout(previewFlushTimerRef.current);
      previewFlushTimerRef.current = null;
    }

    // Update preview to show final message (not streaming)
    const finalMsgs = messagesRef.current;
    if (finalMsgs.length > 0) {
      const lastMsg = finalMsgs[finalMsgs.length - 1];
      if (lastMsg.type === 'assistant' && lastMsg.text) {
        const preview = lastMsg.text.length > 60 ? '...' + lastMsg.text.slice(-57) : lastMsg.text;
        dispatch({ type: 'SET_CHAT_PREVIEW', dashboardId: taskDashId, text: preview, isStreaming: false });
      }
    }
    currentTextIndexRef.current = null;
    flushText();
    flushThinking();

    // Log completion to dashboard
    if (api && taskDashId) {
      api.logChatEvent(taskDashId, {
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
        dashboardId: taskDashId,
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
  const OLDER_CAP = 15;     // condensed for next N beyond recent
  const MAX_CONTEXT_CHARS = 4000; // hard cap on total conversation context size

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
            parts.push('[Tool Result]: ' + (resultPreview.length > 200 ? resultPreview.substring(0, 200) + '...' : resultPreview));
          }
        }
      }
    }

    let result = parts.join('\n');
    if (result.length > MAX_CONTEXT_CHARS) {
      result = result.substring(0, MAX_CONTEXT_CHARS) + '\n[... conversation context truncated to ' + MAX_CONTEXT_CHARS + ' chars]';
    }
    return result;
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

  // Open a file in the IDE code explorer by path
  const handleOpenFile = useCallback((filePath) => {
    if (!filePath) return;
    const wsId = state.ideActiveWorkspaceId;
    if (!wsId) return;
    const name = filePath.split('/').filter(Boolean).pop() || filePath;
    dispatch({ type: 'IDE_OPEN_FILE', workspaceId: wsId, file: { path: filePath, name } });
    // Switch to IDE view if not already there
    if (state.activeView !== 'ide') {
      dispatch({ type: 'SET_VIEW', view: 'ide' });
    }
  }, [state.ideActiveWorkspaceId, state.activeView, dispatch]);

  async function sendText(text, attachments = []) {
    if (!text || !api) return;

    // Snapshot current messages BEFORE appending the new user message
    // so conversation context reflects what came before this prompt
    const currentMsgs = messagesRef.current;

    appendMsg({ type: 'user', text, attachments });
    dispatch({ type: 'SET_CHAT_PREVIEW', dashboardId, text: text.substring(0, 60), isStreaming: false });
    // User sent a message — always scroll to show it
    isAtBottomRef.current = true;
    setNewMsgCount(0);
    dispatch({ type: 'CLAUDE_SET_PROCESSING', value: true });
    dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Thinking...' });
    currentTextIndexRef.current = null;
    sawStreamingRef.current = false;
    isResumedSessionRef.current = !!sessionIdRef.current;

    const taskId = '_claude_' + Date.now();
    activeTaskIdsRef.current.add(taskId);
    codexStreamedTaskIdsRef.current.delete(taskId);
    // Register in global maps so output can be routed even after dashboard/tab switch
    taskDashboardMapRef.current[taskId] = dashboardId;
    taskTabMapRef.current[taskId] = activeTabId;
    setProcessingTabId(activeTabId);

    try {
      const settings = await api.getSettings();
      const perDashboardPath = getDashboardProject(dashboardId);
      const projectDir = perDashboardPath || settings.activeProjectPath || null;
      const additionalContextDirs = getDashboardAdditionalContext(dashboardId) || [];
      const provider = settings.agentProvider || 'claude';
      const selectedModel = resolveModel(provider, model || settings.defaultModel);
      const cliPath = provider === 'codex'
        ? (settings.codexCliPath || null)
        : (settings.claudeCliPath || null);

      // Only inject system prompt on fresh sessions — resumed sessions already have context
      const systemPrompt = sessionIdRef.current ? null : await api.getChatSystemPrompt(projectDir, dashboardId, additionalContextDirs);

      // Build conversation history context.
      // For resumed sessions, the CLI already has full history — injecting it again
      // doubles the context and overloads the model. Only inject for fresh sessions
      // with prior messages (e.g. loaded from history).
      let finalPrompt = text;
      const historyContext = buildConversationContext(currentMsgs);
      if (historyContext && !sessionIdRef.current) {
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

      const spawnResult = await api.spawnWorker({
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
        additionalContextDirs,
      });
      if (spawnResult && spawnResult.pid) {
        taskPidMapRef.current[taskId] = spawnResult.pid;
      }
    } catch (err) {
      appendMsg({ type: 'system', text: 'Error: ' + (err.message || String(err)), isError: true });
      activeTaskIdsRef.current.delete(taskId);
      if (activeTaskIdsRef.current.size === 0) {
        dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
        dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Ready' });
        setProcessingTabId(null);
      }
    }
  }

  async function sendMessage() {
    const text = prompt.trim();
    if (!text && pendingAttachments.length === 0) return;
    setPrompt('');
    // Clear stashed input for this tab since it's been sent
    delete promptStashRef.current[dashboardId + ':' + activeTabId];

    // Auto-rename tab if it still has default name
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (text && currentTab && currentTab.name.startsWith('Chat ')) {
      const preview = text.substring(0, 25) + (text.length > 25 ? '...' : '');
      dispatch({ type: 'CLAUDE_RENAME_TAB', tabId: activeTabId, name: preview });
    }

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

  // All available commands organized by folder
  const ALL_COMMANDS = {
    Synapse: [
      { label: '!p_track', command: '!p_track ', autoSend: false },
      { label: '!p', command: '!p ', autoSend: false },
      { label: '!master_plan_track', command: '!master_plan_track ', autoSend: false },
      { label: '!dispatch --ready', command: '!dispatch --ready', autoSend: true },
      { label: '!status', command: '!status', autoSend: true },
      { label: '!logs', command: '!logs', autoSend: true },
      { label: '!inspect', command: '!inspect ', autoSend: false },
      { label: '!deps', command: '!deps', autoSend: true },
      { label: '!retry', command: '!retry ', autoSend: false },
      { label: '!resume', command: '!resume', autoSend: true },
      { label: '!track_resume', command: '!track_resume', autoSend: true },
      { label: '!cancel', command: '!cancel', autoSend: true },
      { label: '!cancel-safe', command: '!cancel-safe', autoSend: true },
      { label: '!reset', command: '!reset', autoSend: false },
      { label: '!start', command: '!start', autoSend: true },
      { label: '!stop', command: '!stop', autoSend: true },
      { label: '!history', command: '!history', autoSend: true },
      { label: '!project', command: '!project ', autoSend: false },
      { label: '!guide', command: '!guide', autoSend: true },
      { label: '!update_dashboard', command: '!update_dashboard ', autoSend: false },
    ],
    Project: [
      { label: '!context', command: '!context ', autoSend: false },
      { label: '!review', command: '!review', autoSend: true },
      { label: '!health', command: '!health', autoSend: true },
      { label: '!plan', command: '!plan ', autoSend: false },
      { label: '!scope', command: '!scope ', autoSend: false },
      { label: '!trace', command: '!trace ', autoSend: false },
      { label: '!contracts', command: '!contracts', autoSend: true },
      { label: '!env_check', command: '!env_check', autoSend: true },
      { label: '!scaffold', command: '!scaffold', autoSend: true },
      { label: '!initialize', command: '!initialize', autoSend: true },
      { label: '!onboard', command: '!onboard', autoSend: true },
      { label: '!toc', command: '!toc ', autoSend: false },
      { label: '!toc_generate', command: '!toc_generate', autoSend: true },
      { label: '!toc_update', command: '!toc_update', autoSend: true },
      { label: '!commands', command: '!commands', autoSend: true },
      { label: '!help', command: '!help', autoSend: true },
      { label: '!profiles', command: '!profiles', autoSend: true },
    ],
    Profiles: [
      { label: '!analyst', command: '!analyst ', autoSend: false },
      { label: '!architect', command: '!architect ', autoSend: false },
      { label: '!copywriter', command: '!copywriter ', autoSend: false },
      { label: '!customer-success', command: '!customer-success ', autoSend: false },
      { label: '!devops', command: '!devops ', autoSend: false },
      { label: '!founder', command: '!founder ', autoSend: false },
      { label: '!growth', command: '!growth ', autoSend: false },
      { label: '!legal', command: '!legal ', autoSend: false },
      { label: '!marketing', command: '!marketing ', autoSend: false },
      { label: '!pricing', command: '!pricing ', autoSend: false },
      { label: '!product', command: '!product ', autoSend: false },
      { label: '!qa', command: '!qa ', autoSend: false },
      { label: '!sales', command: '!sales ', autoSend: false },
      { label: '!security', command: '!security ', autoSend: false },
      { label: '!technical-writer', command: '!technical-writer ', autoSend: false },
    ],
  };

  const QUICK_ACCESS_STORAGE_KEY = 'synapse-quick-access-commands';
  const DEFAULT_QUICK_ACCESS = ['!p_track', '!dispatch --ready', '!status', '!cancel'];

  function loadQuickAccessCommands() {
    try {
      const stored = localStorage.getItem(QUICK_ACCESS_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_QUICK_ACCESS;
  }

  const [quickAccessLabels, setQuickAccessLabels] = useState(loadQuickAccessCommands);

  function saveQuickAccessCommands(labels) {
    setQuickAccessLabels(labels);
    try { localStorage.setItem(QUICK_ACCESS_STORAGE_KEY, JSON.stringify(labels)); } catch {}
  }

  // Resolve label to full command object
  function findCommand(label) {
    for (const folder of Object.values(ALL_COMMANDS)) {
      const found = folder.find(c => c.label === label);
      if (found) return found;
    }
    return { label, command: label, autoSend: false };
  }

  function toggleQuickAccessCommand(label) {
    const current = [...quickAccessLabels];
    const idx = current.indexOf(label);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(label);
    }
    saveQuickAccessCommands(current);
  }

  function toggleFolder(folder) {
    setExpandedFolders(prev => ({ ...prev, [folder]: !prev[folder] }));
  }

  // Close quick access editor on outside click
  useEffect(() => {
    if (!showQuickAccessEditor) return;
    function handleClickOutside(e) {
      if (quickAccessEditorRef.current && !quickAccessEditorRef.current.contains(e.target)) {
        setShowQuickAccessEditor(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showQuickAccessEditor]);

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
      // Clear stashed session for this dashboard:tab too
      delete sessionMapRef.current[dashboardId + ':' + activeTabId];
    }
  }

  // Save a tab's conversation to disk-based history so it survives tab closes and restarts
  function saveTabToDisk(tabId, tabMessages) {
    if (!api) return;
    const msgs = tabMessages || (tabId === activeTabId ? messagesRef.current : null);
    if (!msgs || msgs.length <= 1) return; // nothing meaningful to save (only welcome)
    const firstUser = msgs.find(m => m.type === 'user');
    if (!firstUser) return; // no user messages — nothing to save
    const name = firstUser.text.substring(0, 50) + (firstUser.text.length > 50 ? '...' : '');
    const now = new Date().toISOString();
    const sessionInfo = sessionMapRef.current[dashboardId + ':' + tabId] || {};
    const cId = (tabId === activeTabId ? convIdRef.current : sessionInfo.convId) || 'conv_' + Date.now() + '_' + tabId;
    const cCreated = (tabId === activeTabId ? convCreatedRef.current : sessionInfo.convCreated) || now;
    const sId = (tabId === activeTabId ? sessionIdRef.current : sessionInfo.sessionId) || null;
    api.saveConversation({
      id: cId,
      name,
      created: cCreated,
      sessionId: sId,
      dashboardId,
      messages: msgs,
    }).catch(() => {});
  }

  function switchToTab(tabId) {
    if (tabId === activeTabId) return;
    // Stash current tab's input text and restore target tab's
    promptStashRef.current[dashboardId + ':' + activeTabId] = prompt;
    setPrompt(promptStashRef.current[dashboardId + ':' + tabId] || '');
    // Flush streaming buffers to current tab before switching
    if (textFlushTimerRef.current) { clearTimeout(textFlushTimerRef.current); textFlushTimerRef.current = null; }
    commitTextBuffer();
    if (thinkingFlushTimerRef.current) { clearTimeout(thinkingFlushTimerRef.current); thinkingFlushTimerRef.current = null; }
    commitThinkingBuffer();
    // Save current tab's conversation to disk before switching
    saveTabToDisk(activeTabId);
    // Dispatch tab switch (stashes current messages, loads target)
    dispatch({ type: 'CLAUDE_SWITCH_TAB', tabId });
    // Reset streaming state for new tab context
    currentTextIndexRef.current = null;
    currentThinkingIndexRef.current = null;
    streamingBlocksRef.current = {};
    sawStreamingRef.current = false;
    isResumedSessionRef.current = false;
  }

  function newTab() {
    // Don't clear an already-empty conversation
    if (messages.length <= 1 && messages[0]?.id === 'welcome') return;

    // Save current conversation to history before clearing
    saveTabToDisk(activeTabId);

    // Reset session refs
    sessionIdRef.current = null;
    convIdRef.current = null;
    convCreatedRef.current = null;
    delete sessionMapRef.current[dashboardId + ':' + activeTabId];

    // Reset streaming state
    currentTextIndexRef.current = null;
    currentThinkingIndexRef.current = null;
    streamingBlocksRef.current = {};
    sawStreamingRef.current = false;
    isResumedSessionRef.current = false;
    textBufferRef.current = '';
    thinkingBufferRef.current = '';
    if (textFlushTimerRef.current) {
      clearTimeout(textFlushTimerRef.current);
      textFlushTimerRef.current = null;
    }
    if (thinkingFlushTimerRef.current) {
      clearTimeout(thinkingFlushTimerRef.current);
      thinkingFlushTimerRef.current = null;
    }
    toolCallIndexRef.current = {};

    // Clear messages to fresh state (also clears localStorage entry + pending attachments)
    dispatch({ type: 'CLAUDE_CLEAR_MESSAGES' });
  }

  function closeTab(tabId) {
    // Save the tab's conversation to disk before closing
    const stashKey = dashboardId + ':' + tabId;
    const tabMsgs = tabId === activeTabId
      ? messagesRef.current
      : (state.claudeTabStash[stashKey] || null);
    saveTabToDisk(tabId, tabMsgs);
    // Clean up prompt stash for the closed tab
    delete promptStashRef.current[stashKey];
    // If closing the active tab, restore the next tab's prompt
    if (tabId === activeTabId) {
      const currentTabs = tabs;
      const closedIdx = currentTabs.findIndex(t => t.id === tabId);
      const remaining = currentTabs.filter(t => t.id !== tabId);
      if (remaining.length > 0) {
        const nextTab = remaining[Math.min(closedIdx, remaining.length - 1)];
        setPrompt(promptStashRef.current[dashboardId + ':' + nextTab.id] || '');
      }
    }
    dispatch({ type: 'CLAUDE_CLOSE_TAB', tabId });
  }

  async function stopChat() {
    if (!api || activeTaskIdsRef.current.size === 0) return;
    // Only kill workers belonging to the current tab
    const currentTab = activeTabRef.current;
    const tasksToKill = [];
    for (const taskId of activeTaskIdsRef.current) {
      const taskTab = taskTabMapRef.current[taskId];
      if (!taskTab || taskTab === currentTab) {
        tasksToKill.push(taskId);
      }
    }
    if (tasksToKill.length === 0) return;
    for (const taskId of tasksToKill) {
      const pid = taskPidMapRef.current[taskId];
      if (pid) {
        try {
          await api.killWorker(pid);
        } catch (e) {
          // ignore — worker may already be dead
        }
        delete taskPidMapRef.current[taskId];
      }
      activeTaskIdsRef.current.delete(taskId);
      codexStreamedTaskIdsRef.current.delete(taskId);
      delete taskTabMapRef.current[taskId];
      delete taskDashboardMapRef.current[taskId];
    }
    currentTextIndexRef.current = null;
    if (activeTaskIdsRef.current.size === 0) {
      dispatch({ type: 'CLAUDE_SET_PROCESSING', value: false });
      setProcessingTabId(null);
    }
    dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Stopped' });
    appendMsg({ type: 'system', text: 'Agent stopped by user.' });
  }

  // --- Permission relay handlers ---
  function handlePermissionApprove() {
    if (!pendingPermission || !api) return;
    const { pid, requestId, toolName } = pendingPermission;
    if (pid) {
      const response = JSON.stringify({
        type: 'control_response',
        request_id: requestId,
        response: { subtype: 'success', response: { behavior: 'allow' } },
      }) + '\n';
      api.writeWorker(pid, response);
    }
    dispatch({ type: 'PERMISSION_RESOLVED', requestId });
    dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Running' });
    appendMsg({ type: 'system', text: `Permission approved for: ${toolName}` });
  }

  function handlePermissionDeny() {
    if (!pendingPermission || !api) return;
    const { pid, requestId, toolName } = pendingPermission;
    if (pid) {
      const response = JSON.stringify({
        type: 'control_response',
        request_id: requestId,
        response: { subtype: 'success', response: { behavior: 'deny', message: 'User denied this action' } },
      }) + '\n';
      api.writeWorker(pid, response);
    }
    dispatch({ type: 'PERMISSION_RESOLVED', requestId });
    dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Running' });
    appendMsg({ type: 'system', text: `Permission denied for: ${toolName}` });
  }

  function handleAlwaysAllow(toolName) {
    if (toolName) allowedToolsRef.current.add(toolName);
  }

  // Auto-approve permission requests for tools the user has always-allowed this session
  useEffect(() => {
    if (!pendingPermission || !api) return;
    if (allowedToolsRef.current.has(pendingPermission.toolName)) {
      const { pid, requestId, toolName } = pendingPermission;
      if (pid) {
        const response = JSON.stringify({
          type: 'control_response',
          request_id: requestId,
          response: { subtype: 'success', response: { behavior: 'allow' } },
        }) + '\n';
        api.writeWorker(pid, response);
      }
      dispatch({ type: 'PERMISSION_RESOLVED', requestId });
      dispatch({ type: 'CLAUDE_SET_STATUS', value: 'Running' });
      appendMsg({ type: 'system', text: `Permission auto-approved for: ${toolName}` });
    }
  }, [pendingPermission]);

  async function loadHistoryConversation(conv) {
    if (isProcessing || !api) return;
    try {
      const full = await api.loadConversation(conv.id);
      if (!full) return;
      dispatch({ type: 'CLAUDE_SET_MESSAGES', messages: full.messages || [] });
      sessionIdRef.current = full.sessionId || null;
      convIdRef.current = full.id;
      convCreatedRef.current = full.created;
      // Scroll to bottom of loaded conversation
      isAtBottomRef.current = true;
      setNewMsgCount(0);
      requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
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
          <span className="claude-view-dashboard-id">{dashboardId}</span>
          <button
            className="claude-clear-btn"
            onClick={() => setShowHistory(h => !h)}
            title="Browse conversation history"
          >
            History
          </button>
          <button
            className="claude-clear-btn"
            onClick={newTab}
            title="Start a new conversation tab"
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
            onClick={newTab}
            title="Start a new conversation tab"
          >
            New
          </button>
        </div>
      )}

      {tabs.length > 1 && (
        <div className="claude-tab-bar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={'claude-tab' + (tab.id === activeTabId ? ' active' : '') + (tab.id === processingTabId ? ' processing' : '')}
              onClick={() => switchToTab(tab.id)}
              title={tab.name}
            >
              {tab.id === processingTabId && <span className="claude-tab-dot" />}
              <span className="claude-tab-name">{tab.name}</span>
              {tabs.length > 1 && tab.id !== processingTabId && (
                <span
                  className="claude-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  ✕
                </span>
              )}
            </button>
          ))}
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
          {(() => {
            // Find last thinking index once, outside the map loop
            let lastThinkingIdx = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].type === 'thinking') { lastThinkingIdx = i; break; }
            }
            return messages.map((msg, idx) => (
              <ConversationMessage
                key={msg.id}
                msg={msg}
                isLatestThinking={msg.type === 'thinking' && idx === lastThinkingIdx && isProcessing}
                onSendAnswer={sendText}
                onOpenFile={handleOpenFile}
              />
            ));
          })()}
          {/* Show animated dots whenever processing on THIS tab */}
          {isProcessing && processingTabId === activeTabId && (
            <ProcessingIndicator />
          )}
        </div>
        {newMsgCount > 0 && (
          <button className="claude-new-messages" onClick={scrollToNew}>
            {newMsgCount} new message{newMsgCount !== 1 ? 's' : ''} ↓
          </button>
        )}
      </div>

      <div className="claude-suggestion-chips">
        {quickAccessLabels.map(label => {
          const cmd = findCommand(label);
          return (
            <button
              key={cmd.command}
              className="claude-suggestion-chip"
              onClick={() => handleSuggestion(cmd)}
              disabled={isProcessing}
              title={cmd.autoSend ? `Send: ${cmd.command}` : `Fill: ${cmd.command}`}
            >
              {cmd.label}
            </button>
          );
        })}
        <div className="claude-quick-access-editor-wrapper" ref={quickAccessEditorRef}>
          <button
            className="claude-suggestion-chip claude-quick-access-add-btn"
            onClick={() => setShowQuickAccessEditor(prev => !prev)}
            title="Customize quick access buttons"
          >+</button>
          {showQuickAccessEditor && (
            <>
              <div className="claude-quick-access-overlay" onClick={() => setShowQuickAccessEditor(false)} />
              <div className="claude-quick-access-popup">
                <div className="claude-quick-access-popup-header">Quick Access Commands</div>
                {Object.entries(ALL_COMMANDS).map(([folder, commands]) => (
                  <div key={folder} className="claude-quick-access-folder">
                    <button
                      className="claude-quick-access-folder-toggle"
                      onClick={() => toggleFolder(folder)}
                    >
                      <span className={`claude-quick-access-folder-arrow ${expandedFolders[folder] ? 'expanded' : ''}`}>▶</span>
                      <span className="claude-quick-access-folder-name">{folder}</span>
                      <span className="claude-quick-access-folder-count">
                        {commands.filter(c => quickAccessLabels.includes(c.label)).length}/{commands.length}
                      </span>
                    </button>
                    {expandedFolders[folder] && (
                      <div className="claude-quick-access-folder-items">
                        {commands.map(cmd => (
                          <label key={cmd.label} className="claude-quick-access-item">
                            <input
                              type="checkbox"
                              checked={quickAccessLabels.includes(cmd.label)}
                              onChange={() => toggleQuickAccessCommand(cmd.label)}
                            />
                            <span className="claude-quick-access-item-label">{cmd.label}</span>
                            <span className="claude-quick-access-item-mode">
                              {cmd.autoSend ? 'auto' : 'fill'}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
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

      {pendingPermission && !allowedToolsRef.current.has(pendingPermission.toolName) && (
        <PermissionModal
          interactive
          toolName={pendingPermission.toolName}
          toolInput={pendingPermission.toolInput}
          onApprove={handlePermissionApprove}
          onDeny={handlePermissionDeny}
          onAlwaysAllow={handleAlwaysAllow}
          onClose={handlePermissionDeny}
        />
      )}
    </div>
  );
}
