// DebugPanels — VS Code-style debug sidebar with collapsible sections:
// Variables, Call Stack, Breakpoints, Watch Expressions.
// Reads from AppContext debug state. Standalone component for IDEView integration (task 4.1).

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/ide-debug.css';

// ── SVG Icon Components ──────────────────────────────────────

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckboxCheckedIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="var(--color-in-progress, #9B7CF0)" stroke="var(--color-in-progress, #9B7CF0)" strokeWidth="1" />
      <path d="M5 8l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 8h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function baseName(filePath) {
  if (!filePath) return '';
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function truncate(str, max = 80) {
  if (str == null) return '';
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

// ── CollapsibleSection ───────────────────────────────────────

function CollapsibleSection({ title, defaultOpen = true, count, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="dbg-section">
      <button
        className="dbg-section-header"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
      >
        <span className={`dbg-section-chevron${open ? ' expanded' : ''}`}>
          <ChevronIcon />
        </span>
        <span className="dbg-section-title">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="dbg-section-count">{count}</span>
        )}
      </button>
      {open && (
        <div className="dbg-section-body">
          {children}
        </div>
      )}
    </div>
  );
}

// ── VariableRow — single variable with optional lazy expand ──

function VariableRow({ variable, depth = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);

  const hasChildren = variable.variablesReference > 0;

  const handleExpand = useCallback(async () => {
    if (!hasChildren) return;

    if (expanded) {
      setExpanded(false);
      return;
    }

    // Lazy load children on first expand
    if (!children) {
      setLoading(true);
      try {
        const api = window.electronAPI;
        if (api && api.debugGetVariables) {
          const result = await api.debugGetVariables(variable.variablesReference);
          if (result && Array.isArray(result)) {
            setChildren(result);
          } else if (result && result.variables) {
            setChildren(result.variables);
          } else {
            setChildren([]);
          }
        }
      } catch (err) {
        console.error('DebugPanels: failed to load child variables', err);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }

    setExpanded(true);
  }, [hasChildren, expanded, children, variable.variablesReference]);

  return (
    <>
      <div
        className={`dbg-var-row${hasChildren ? ' expandable' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={hasChildren ? handleExpand : undefined}
      >
        {hasChildren ? (
          <span className={`dbg-var-arrow${expanded ? ' expanded' : ''}${loading ? ' loading' : ''}`}>
            {loading ? (
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="dbg-var-spinner">
                <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 12" strokeLinecap="round" />
              </svg>
            ) : (
              <ChevronIcon />
            )}
          </span>
        ) : (
          <span className="dbg-var-arrow-spacer" />
        )}
        <span className="dbg-var-name">{variable.name}</span>
        <span className="dbg-var-sep">=</span>
        <span className="dbg-var-value" title={String(variable.value)}>
          {truncate(variable.value)}
        </span>
        {variable.type && (
          <span className="dbg-var-type">{variable.type}</span>
        )}
      </div>
      {expanded && children && children.map((child, i) => (
        <VariableRow
          key={`${child.name}-${i}`}
          variable={child}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

// ── VariablesSection ─────────────────────────────────────────

function VariablesSection() {
  const state = useAppState();
  const { debugSession, debugScopes, debugVariables } = state;
  const isPaused = debugSession.status === 'paused';

  const totalVars = isPaused
    ? debugScopes.reduce((sum, scope) => {
        const vars = debugVariables[scope.variablesReference];
        return sum + (Array.isArray(vars) ? vars.length : 0);
      }, 0)
    : 0;

  return (
    <CollapsibleSection title="VARIABLES" count={totalVars}>
      {!isPaused ? (
        <div className="dbg-empty">Not paused</div>
      ) : debugScopes.length === 0 ? (
        <div className="dbg-empty">No scopes available</div>
      ) : (
        debugScopes.map((scope, si) => {
          const vars = debugVariables[scope.variablesReference] || [];
          return (
            <div key={`scope-${si}-${scope.variablesReference}`} className="dbg-scope-group">
              <div className="dbg-scope-label">{scope.name}</div>
              {vars.length === 0 ? (
                <div className="dbg-empty-inline">No variables</div>
              ) : (
                vars.map((v, vi) => (
                  <VariableRow key={`${v.name}-${vi}`} variable={v} depth={0} />
                ))
              )}
            </div>
          );
        })
      )}
    </CollapsibleSection>
  );
}

// ── CallStackSection ─────────────────────────────────────────

function CallStackSection({ onNavigateToFrame }) {
  const state = useAppState();
  const { debugCallStack, debugSession } = state;
  const isPaused = debugSession.status === 'paused';

  const handleFrameClick = useCallback((frame) => {
    if (onNavigateToFrame && frame.source) {
      onNavigateToFrame(frame.source, frame.line, frame.column);
    }
  }, [onNavigateToFrame]);

  return (
    <CollapsibleSection title="CALL STACK" count={debugCallStack.length}>
      {!isPaused || debugCallStack.length === 0 ? (
        <div className="dbg-empty">
          {isPaused ? 'No call frames' : 'Not paused'}
        </div>
      ) : (
        debugCallStack.map((frame, index) => (
          <div
            key={frame.id || index}
            className={`dbg-stack-row${index === 0 ? ' paused-frame' : ''}`}
            onClick={() => handleFrameClick(frame)}
            title={frame.source ? `${frame.source}:${frame.line}` : frame.name}
          >
            <span className="dbg-stack-name">{frame.name || '(anonymous)'}</span>
            {frame.source && (
              <span className="dbg-stack-loc">
                {baseName(frame.source)}:{frame.line}
              </span>
            )}
          </div>
        ))
      )}
    </CollapsibleSection>
  );
}

// ── BreakpointsSection ───────────────────────────────────────

function BreakpointsSection({ onNavigateToBreakpoint }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const { debugBreakpoints } = state;

  // Flatten breakpoints into a sorted list
  const bpList = [];
  for (const filePath of Object.keys(debugBreakpoints)) {
    const lines = debugBreakpoints[filePath];
    if (Array.isArray(lines)) {
      for (const line of lines) {
        bpList.push({ filePath, line });
      }
    }
  }
  bpList.sort((a, b) => {
    const cmp = baseName(a.filePath).localeCompare(baseName(b.filePath));
    return cmp !== 0 ? cmp : a.line - b.line;
  });

  const handleToggle = useCallback((filePath, line, e) => {
    e.stopPropagation();
    dispatch({ type: 'DEBUG_TOGGLE_BREAKPOINT', filePath, line });
  }, [dispatch]);

  const handleClick = useCallback((filePath, line) => {
    if (onNavigateToBreakpoint) {
      onNavigateToBreakpoint(filePath, line);
    }
  }, [onNavigateToBreakpoint]);

  return (
    <CollapsibleSection title="BREAKPOINTS" count={bpList.length}>
      {bpList.length === 0 ? (
        <div className="dbg-empty">No breakpoints set</div>
      ) : (
        bpList.map((bp) => (
          <div
            key={`${bp.filePath}:${bp.line}`}
            className="dbg-bp-row"
            onClick={() => handleClick(bp.filePath, bp.line)}
            title={`${bp.filePath}:${bp.line}`}
          >
            <button
              className="dbg-bp-checkbox"
              onClick={(e) => handleToggle(bp.filePath, bp.line, e)}
              aria-label={`Toggle breakpoint at ${baseName(bp.filePath)}:${bp.line}`}
            >
              <CheckboxCheckedIcon />
            </button>
            <span className="dbg-bp-file">{baseName(bp.filePath)}</span>
            <span className="dbg-bp-line">:{bp.line}</span>
          </div>
        ))
      )}
    </CollapsibleSection>
  );
}

// ── WatchSection ─────────────────────────────────────────────

function WatchSection() {
  const state = useAppState();
  const dispatch = useDispatch();
  const { debugWatchExpressions, debugSession, debugCallStack } = state;
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  const isPaused = debugSession.status === 'paused';

  const handleAddExpression = useCallback(async () => {
    const expr = inputValue.trim();
    if (!expr) return;

    setInputValue('');

    let value = '';
    let error = null;

    try {
      const api = window.electronAPI;
      if (api && api.debugEvaluate) {
        const callFrameId = isPaused && debugCallStack.length > 0
          ? debugCallStack[0].id
          : undefined;
        const result = await api.debugEvaluate(expr, callFrameId);
        if (result && result.error) {
          error = result.error;
        } else if (result && result.value !== undefined) {
          value = String(result.value);
        } else if (result && result.result) {
          value = result.result.description || String(result.result.value);
        } else {
          value = String(result);
        }
      } else {
        error = 'Debug API not available';
      }
    } catch (err) {
      error = err.message || 'Evaluation failed';
    }

    const newWatch = {
      id: `watch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      expression: expr,
      value,
      error,
    };
    const updated = [...debugWatchExpressions, newWatch];
    dispatch({ type: 'SET', key: 'debugWatchExpressions', value: updated });
  }, [inputValue, isPaused, debugCallStack, debugWatchExpressions, dispatch]);

  const handleRemoveExpression = useCallback((id) => {
    const updated = debugWatchExpressions.filter(w => w.id !== id);
    dispatch({ type: 'SET', key: 'debugWatchExpressions', value: updated });
  }, [debugWatchExpressions, dispatch]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      handleAddExpression();
    }
  }, [handleAddExpression]);

  return (
    <CollapsibleSection title="WATCH" count={debugWatchExpressions.length} defaultOpen={true}>
      {debugWatchExpressions.length === 0 && (
        <div className="dbg-empty">No watch expressions</div>
      )}
      {debugWatchExpressions.map((watch) => (
        <div key={watch.id} className="dbg-watch-row">
          <span className="dbg-watch-expr">{watch.expression}</span>
          <span className="dbg-watch-sep">=</span>
          {watch.error ? (
            <span className="dbg-watch-error" title={watch.error}>{watch.error}</span>
          ) : (
            <span className="dbg-watch-val" title={String(watch.value)}>
              {truncate(watch.value, 60)}
            </span>
          )}
          <button
            className="dbg-watch-remove"
            onClick={() => handleRemoveExpression(watch.id)}
            title="Remove watch expression"
          >
            <RemoveIcon />
          </button>
        </div>
      ))}
      <div className="dbg-watch-input-row">
        <input
          ref={inputRef}
          type="text"
          className="dbg-watch-input"
          placeholder="Add expression..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <button
          className="dbg-watch-add-btn"
          onClick={handleAddExpression}
          disabled={!inputValue.trim()}
          title="Add watch expression"
        >
          <AddIcon />
        </button>
      </div>
    </CollapsibleSection>
  );
}

// ── DebugPanels — main exported component ────────────────────

/**
 * VS Code-style debug sidebar panels.
 * @param {object}   props
 * @param {Function} props.onNavigateToFrame      - (source, line, column) => void
 * @param {Function} props.onNavigateToBreakpoint - (filePath, line) => void
 */
export default function DebugPanels({ onNavigateToFrame, onNavigateToBreakpoint }) {
  return (
    <div className="dbg-panels">
      <VariablesSection />
      <CallStackSection onNavigateToFrame={onNavigateToFrame} />
      <BreakpointsSection onNavigateToBreakpoint={onNavigateToBreakpoint} />
      <WatchSection />
    </div>
  );
}
