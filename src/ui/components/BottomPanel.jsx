// BottomPanel — VS Code-style bottom panel with Terminal, Output, Problems,
// Debug Console, and Ports tabs. Supports multiple terminal instances via
// sub-tabs within the Terminal view. Drag-to-resize from top edge.
// Can be embedded (IDE) or overlay (dashboard).

import React, { useState, useCallback, useRef, useEffect } from 'react';
import LogPanel from './LogPanel.jsx';
import TerminalView from './TerminalView.jsx';

const PANEL_TABS = [
  { id: 'problems', label: 'PROBLEMS' },
  { id: 'output', label: 'OUTPUT' },
  { id: 'debug-console', label: 'DEBUG CONSOLE' },
  { id: 'terminal', label: 'TERMINAL' },
  { id: 'ports', label: 'PORTS' },
];

const MAX_TERMINAL_TABS = 5;
const DEFAULT_PANEL_HEIGHT = 300;
const MIN_PANEL_HEIGHT = 120;
const HEADER_HEIGHT = 35;

/**
 * @param {object}   props.logs          - logs payload { entries: [...] }
 * @param {string}   props.activeFilter  - current filter level ('all' | level string)
 * @param {Function} props.onFilterChange - callback(level) when a filter button is clicked
 * @param {string}   props.projectDir    - working directory for the terminal
 * @param {boolean}  props.embedded      - true for IDE (flex child), false for dashboard (fixed overlay)
 */
export default function BottomPanel({ logs, activeFilter, onFilterChange, projectDir, embedded = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('terminal');
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);

  // Multi-terminal sub-tabs
  const [termTabs, setTermTabs] = useState([{ id: 1, label: 'Terminal 1' }]);
  const [activeTermTab, setActiveTermTab] = useState(1);
  const nextId = useRef(2);

  // Drag resize refs (avoid re-renders during drag)
  const dragStateRef = useRef(null);
  const rafRef = useRef(null);

  const entries = (logs?.entries) || [];

  // ---- Terminal tab management ----
  const addTermTab = useCallback(() => {
    const id = nextId.current++;
    setTermTabs(prev => {
      if (prev.length >= MAX_TERMINAL_TABS) return prev;
      return [...prev, { id, label: `Terminal ${id}` }];
    });
    setActiveTermTab(id);
  }, []);

  const closeTermTab = useCallback((tabId) => {
    setTermTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === tabId);
      const remaining = prev.filter(t => t.id !== tabId);
      setActiveTermTab(current =>
        current !== tabId ? current : remaining[Math.min(idx, remaining.length - 1)].id
      );
      return remaining;
    });
  }, []);

  // ---- Tab click: toggle panel or switch tab ----
  const handleTabClick = useCallback((tabId) => {
    if (activeTab === tabId && isOpen) {
      setIsOpen(false);
    } else {
      setActiveTab(tabId);
      setIsOpen(true);
    }
  }, [activeTab, isOpen]);

  // ---- Drag-to-resize from top edge ----
  const handleResizePointerDown = useCallback((e) => {
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      startY: e.clientY,
      startHeight: panelHeight,
    };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('bottom-panel-resizing');
  }, [panelHeight]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragStateRef.current) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (!dragStateRef.current) return;
        const maxH = window.innerHeight * 0.8;
        const deltaY = e.clientY - dragStateRef.current.startY;
        const newH = Math.min(maxH, Math.max(MIN_PANEL_HEIGHT, dragStateRef.current.startHeight - deltaY));
        setPanelHeight(newH);
      });
    };

    const onUp = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('bottom-panel-resizing');
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      onUp();
    };
  }, []);

  // ---- Compute styles ----
  const panelStyle = {
    height: isOpen ? panelHeight + 'px' : HEADER_HEIGHT + 'px',
  };

  const className = [
    'bottom-panel',
    isOpen ? 'bottom-panel--open' : '',
    embedded ? 'bottom-panel--embedded' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} style={panelStyle}>
      {/* Resize handle (top edge) — visible when panel is open */}
      {isOpen && (
        <div
          className="bottom-panel-resize-handle"
          onPointerDown={handleResizePointerDown}
        />
      )}

      {/* Tab bar header */}
      <div className="bottom-panel-header">
        <div className="bottom-panel-tabs-row">
          {PANEL_TABS.map(tab => (
            <button
              key={tab.id}
              className={`bottom-panel-tab${activeTab === tab.id && isOpen ? ' active' : ''}`}
              onClick={() => handleTabClick(tab.id)}
            >
              {tab.label}
              {tab.id === 'output' && entries.length > 0 && (
                <span className="bottom-panel-tab-badge">{entries.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="bottom-panel-header-actions">
          {isOpen && (
            <button
              className="bottom-panel-header-btn"
              onClick={() => setIsOpen(false)}
              title="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Panel content — all panes stay mounted for state persistence */}
      <div className="bottom-panel-content" style={{ display: isOpen ? 'flex' : 'none' }}>
        {/* PROBLEMS */}
        <div className="bottom-panel-pane" style={{ display: activeTab === 'problems' ? 'flex' : 'none' }}>
          <div className="bottom-panel-placeholder">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M5.5 8l1.5 1.5 3.5-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>No problems detected</span>
          </div>
        </div>

        {/* OUTPUT (Logs) */}
        <div className="bottom-panel-pane bottom-panel-pane--output" style={{ display: activeTab === 'output' ? 'flex' : 'none' }}>
          <LogPanel
            logs={logs}
            activeFilter={activeFilter}
            onFilterChange={onFilterChange}
          />
        </div>

        {/* DEBUG CONSOLE */}
        <div className="bottom-panel-pane" style={{ display: activeTab === 'debug-console' ? 'flex' : 'none' }}>
          <div className="bottom-panel-placeholder">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M5 6l2.5 2.5L5 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span>Debug console</span>
          </div>
        </div>

        {/* TERMINAL */}
        <div className="bottom-panel-pane bottom-panel-pane--terminal" style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}>
          <div className="terminal-tabs">
            {termTabs.map(tab => (
              <div
                key={tab.id}
                className={`terminal-tab${activeTermTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTermTab(tab.id)}
              >
                <span className="terminal-tab-label">{tab.label}</span>
                {termTabs.length > 1 && (
                  <button
                    className="terminal-tab-close"
                    onClick={(e) => { e.stopPropagation(); closeTermTab(tab.id); }}
                    title="Close terminal"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            {termTabs.length < MAX_TERMINAL_TABS && (
              <button className="terminal-tab-add" onClick={addTermTab} title="New terminal">+</button>
            )}
          </div>
          {termTabs.map(tab => (
            <div
              key={tab.id}
              className="terminal-tab-body"
              style={{ display: activeTermTab === tab.id ? 'flex' : 'none' }}
            >
              <TerminalView projectDir={projectDir} />
            </div>
          ))}
        </div>

        {/* PORTS */}
        <div className="bottom-panel-pane" style={{ display: activeTab === 'ports' ? 'flex' : 'none' }}>
          <div className="bottom-panel-placeholder">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span>No forwarded ports</span>
          </div>
        </div>
      </div>
    </div>
  );
}
