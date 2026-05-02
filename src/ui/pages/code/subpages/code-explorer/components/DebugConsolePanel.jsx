// DebugConsolePanel — REPL-style debug console for evaluating expressions and viewing debug output.
// Subscribes to debug-output and debug-stopped push events via window.electronAPI.on().
// Reads debugSession and debugCallStack from AppContext via useAppState().
// Standalone component — will be mounted in BottomPanel.jsx by task 4.1.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppState } from '../../context/AppContext.jsx';
import '../../styles/ide-debug.css';

const MAX_OUTPUT_ENTRIES = 1000;

// ── ANSI escape code stripper ────────────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07/g;
function stripAnsi(text) {
  return typeof text === 'string' ? text.replace(ANSI_RE, '') : String(text);
}

// ── Timestamp formatter ──────────────────────────────────────
function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

// ── Type-to-CSS-class mapping ────────────────────────────────

const TYPE_CLASS_MAP = {
  stdout:       'debug-console-entry--stdout',
  stderr:       'debug-console-entry--error',
  error:        'debug-console-entry--error',
  log:          'debug-console-entry--log',
  'eval-input': 'debug-console-entry--eval-input',
  'eval-result':'debug-console-entry--eval-result',
  'eval-error': 'debug-console-entry--eval-error',
  system:       'debug-console-entry--system',
};

function entryClassName(type) {
  return TYPE_CLASS_MAP[type] || TYPE_CLASS_MAP.stdout;
}

// ── Type indicator labels for gutter ─────────────────────────

const TYPE_LABELS = {
  stdout:       'out',
  stderr:       'err',
  log:          'log',
  error:        'ERR',
  'eval-input': '>>>',
  'eval-result':'<<<',
  'eval-error': 'ERR',
  system:       'sys',
};

// ── SVG Icons ────────────────────────────────────────────────

function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ── Output Line Component ────────────────────────────────────

function OutputLine({ entry }) {
  const typeClass = entryClassName(entry.type);
  const label = TYPE_LABELS[entry.type] || entry.type;
  const ts = formatTimestamp(entry.timestamp);

  return (
    <div className={`debug-console-entry ${typeClass}`}>
      <span className="debug-console-entry-ts">{ts}</span>
      <span className="debug-console-entry-type">[{label}]</span>
      <span className="debug-console-entry-text">{stripAnsi(entry.text)}</span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

let entryIdCounter = 0;

export default function DebugConsolePanel() {
  const state = useAppState();
  const debugSession = state.debugSession || { status: 'idle' };
  const debugCallStack = state.debugCallStack || [];

  // Output buffer — [{ id, type, text, timestamp }]
  const [outputLines, setOutputLines] = useState([]);

  // REPL input state
  const [inputValue, setInputValue] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Refs
  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const autoScrollRef = useRef(true);

  // ── Append helper with max-1000 trim ───────────────────────

  const appendEntries = useCallback((newEntries) => {
    setOutputLines((prev) => {
      const combined = [...prev, ...newEntries];
      if (combined.length > MAX_OUTPUT_ENTRIES) {
        return combined.slice(combined.length - MAX_OUTPUT_ENTRIES);
      }
      return combined;
    });
  }, []);

  // ── Auto-scroll logic ──────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, []);

  // Track whether user has manually scrolled up
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return;
    const el = outputRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    autoScrollRef.current = atBottom;
  }, []);

  // Auto-scroll when new lines arrive
  useEffect(() => {
    if (autoScrollRef.current) {
      scrollToBottom();
    }
  }, [outputLines, scrollToBottom]);

  // ── Event subscriptions ────────────────────────────────────

  // Listen for debug-output push events
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const cleanup = window.electronAPI.on('debug-output', (data) => {
      const entry = {
        id: ++entryIdCounter,
        type: data.type || 'stdout',
        text: data.text || '',
        timestamp: data.timestamp || new Date().toISOString(),
      };
      appendEntries([entry]);
    });

    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [appendEntries]);

  // Listen for debug-stopped push event — append "[Session ended]" marker
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const cleanup = window.electronAPI.on('debug-stopped', () => {
      const entry = {
        id: ++entryIdCounter,
        type: 'system',
        text: '[Session ended]',
        timestamp: new Date().toISOString(),
      };
      appendEntries([entry]);
    });

    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [appendEntries]);

  // ── Expression evaluation ──────────────────────────────────

  const handleEvaluate = useCallback(async (expression) => {
    const expr = expression.trim();
    if (!expr) return;

    // Add to command history (deduplicate, most recent at end)
    setCommandHistory((prev) => {
      const filtered = prev.filter((h) => h !== expr);
      return [...filtered, expr];
    });
    setHistoryIndex(-1);

    // Echo the expression in output (type: eval-input)
    const inputEntry = {
      id: ++entryIdCounter,
      type: 'eval-input',
      text: '> ' + expr,
      timestamp: new Date().toISOString(),
    };
    appendEntries([inputEntry]);

    // Get callFrameId from top of call stack
    const callFrameId = debugCallStack[0]?.id || undefined;

    try {
      const result = await window.electronAPI.debugEvaluate(expr, callFrameId);

      if (result.success) {
        const display = result.result?.description || result.result?.value || 'undefined';
        const resultEntry = {
          id: ++entryIdCounter,
          type: 'eval-result',
          text: String(display),
          timestamp: new Date().toISOString(),
        };
        appendEntries([resultEntry]);
      } else {
        const errorEntry = {
          id: ++entryIdCounter,
          type: 'eval-error',
          text: result.error || 'Evaluation failed',
          timestamp: new Date().toISOString(),
        };
        appendEntries([errorEntry]);
      }
    } catch (err) {
      const errorEntry = {
        id: ++entryIdCounter,
        type: 'eval-error',
        text: err.message || 'Evaluation failed',
        timestamp: new Date().toISOString(),
      };
      appendEntries([errorEntry]);
    }
  }, [debugCallStack, appendEntries]);

  // ── Input key handling (Enter, Up/Down arrows) ─────────────

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleEvaluate(inputValue);
        setInputValue('');
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length === 0) return;
        const newIndex = historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[newIndex]);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (commandHistory.length === 0 || historyIndex === -1) return;
        const newIndex = historyIndex + 1;
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setInputValue('');
        } else {
          setHistoryIndex(newIndex);
          setInputValue(commandHistory[newIndex]);
        }
        return;
      }
    },
    [handleEvaluate, inputValue, commandHistory, historyIndex]
  );

  // ── Clear output ───────────────────────────────────────────

  const handleClear = useCallback(() => {
    setOutputLines([]);
    autoScrollRef.current = true;
  }, []);

  // ── Render ─────────────────────────────────────────────────

  const isPaused = debugSession.status === 'paused';

  const inputPlaceholder = isPaused
    ? 'Evaluate expression...'
    : debugSession.status === 'running'
      ? 'Pause execution to evaluate...'
      : 'Start a debug session to evaluate...';

  return (
    <div className="debug-console">
      {/* ---- Output area ---- */}
      <div
        className="debug-console-output"
        ref={outputRef}
        onScroll={handleScroll}
      >
        {outputLines.length === 0 ? (
          <div className="debug-console-empty">
            Debug console is ready. Output and evaluation results will appear here.
          </div>
        ) : (
          outputLines.map((entry) => (
            <OutputLine key={entry.id} entry={entry} />
          ))
        )}
      </div>

      {/* ---- REPL Input area ---- */}
      <div className="debug-console-input-area">
        <span className="debug-console-prompt">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          className="debug-console-input"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={inputPlaceholder}
          disabled={!isPaused}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="debug-console-clear-btn"
          onClick={handleClear}
          title="Clear console"
        >
          <ClearIcon />
        </button>
      </div>
    </div>
  );
}
