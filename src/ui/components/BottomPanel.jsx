// BottomPanel — VS Code-style bottom panel with Terminal, Output, Problems,
// Debug Console, and Ports tabs. Supports multiple terminal instances via
// sub-tabs within the Terminal view. Drag-to-resize from top edge.
// Can be embedded (IDE) or overlay (dashboard).

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAppState } from '../context/AppContext.jsx';
import LogPanel from './LogPanel.jsx';
import TerminalView from './TerminalView.jsx';
import ProblemsPanel from './ide/ProblemsPanel.jsx';
import DebugConsolePanel from './ide/DebugConsolePanel.jsx';
import { getDashboardProject } from '../utils/dashboardProjects.js';

const PANEL_TABS = [
  { id: 'terminal', label: 'TERMINAL' },
  { id: 'problems', label: 'PROBLEMS' },
  { id: 'output', label: 'OUTPUT' },
  { id: 'debug-console', label: 'DEBUG CONSOLE' },
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
 * @param {Function} props.onNavigate    - callback(filePath, line, column) for navigating to diagnostic locations
 * @param {boolean}  props.embedded      - true for IDE (flex child), false for dashboard (fixed overlay)
 */
export default function BottomPanel({ logs, activeFilter, onFilterChange, projectDir, dashboardId, onNavigate, embedded = false }) {
  const appState = useAppState();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('terminal');
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);

  // Compute diagnostics counts for the Problems tab badge
  const diagnosticsCounts = useMemo(() => {
    const diagnostics = appState.diagnostics || {};
    let errors = 0;
    let warnings = 0;
    for (const filePath of Object.keys(diagnostics)) {
      const items = diagnostics[filePath];
      if (!Array.isArray(items)) continue;
      for (const d of items) {
        if (d.severity === 'error') errors++;
        else if (d.severity === 'warning') warnings++;
      }
    }
    return { errors, warnings, total: errors + warnings };
  }, [appState.diagnostics]);

  // Per-dashboard terminal state: { [dashboardId]: { tabs, activeTab, nextId } }
  const DEFAULT_TERM = { tabs: [{ id: 1, label: 'Terminal 1' }], activeTab: 1, nextId: 2 };
  const [termState, setTermState] = useState(() => {
    if (!dashboardId) return {};
    return { [dashboardId]: { ...DEFAULT_TERM } };
  });

  // Ensure current dashboard has terminal state when switching
  useEffect(() => {
    if (!dashboardId) return;
    setTermState(prev => {
      if (prev[dashboardId]) return prev;
      return { ...prev, [dashboardId]: { tabs: [{ id: 1, label: 'Terminal 1' }], activeTab: 1, nextId: 2 } };
    });
  }, [dashboardId]);

  // Derived state for current dashboard's terminal tabs
  const currentTermState = termState[dashboardId] || DEFAULT_TERM;
  const termTabs = currentTermState.tabs;
  const activeTermTab = currentTermState.activeTab;

  // Drag resize refs (avoid re-renders during drag)
  const dragStateRef = useRef(null);
  const rafRef = useRef(null);

  const entries = (logs?.entries) || [];

  // ---- Terminal tab management (per-dashboard) ----
  const addTermTab = useCallback(() => {
    if (!dashboardId) return;
    setTermState(prev => {
      const ds = prev[dashboardId] || { tabs: [], activeTab: 1, nextId: 1 };
      if (ds.tabs.length >= MAX_TERMINAL_TABS) return prev;
      const id = ds.nextId;
      return { ...prev, [dashboardId]: { tabs: [...ds.tabs, { id, label: `Terminal ${id}` }], activeTab: id, nextId: id + 1 } };
    });
  }, [dashboardId]);

  const closeTermTab = useCallback((tabId) => {
    if (!dashboardId) return;
    setTermState(prev => {
      const ds = prev[dashboardId];
      if (!ds || ds.tabs.length <= 1) return prev;
      const idx = ds.tabs.findIndex(t => t.id === tabId);
      const remaining = ds.tabs.filter(t => t.id !== tabId);
      const newActive = ds.activeTab !== tabId ? ds.activeTab : remaining[Math.min(idx, remaining.length - 1)].id;
      return { ...prev, [dashboardId]: { ...ds, tabs: remaining, activeTab: newActive } };
    });
  }, [dashboardId]);

  const setActiveTermTab = useCallback((tabId) => {
    if (!dashboardId) return;
    setTermState(prev => {
      const ds = prev[dashboardId];
      if (!ds) return prev;
      return { ...prev, [dashboardId]: { ...ds, activeTab: tabId } };
    });
  }, [dashboardId]);

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
              {tab.id === 'problems' && diagnosticsCounts.total > 0 && (
                <span className={`bottom-panel-tab-badge${diagnosticsCounts.errors > 0 ? ' bottom-panel-tab-badge--error' : ' bottom-panel-tab-badge--warning'}`}>
                  {diagnosticsCounts.total}
                </span>
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
          <ProblemsPanel onNavigate={onNavigate} />
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
          <DebugConsolePanel />
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
          {/* Render ALL dashboards' terminals — hidden when not current. Keeps PTY + xterm alive across switches. */}
          {Object.entries(termState).map(([dbId, ds]) =>
            ds.tabs.map(tab => (
              <div
                key={`${dbId}-${tab.id}`}
                className="terminal-tab-body"
                style={{ display: dbId === dashboardId && ds.activeTab === tab.id ? 'flex' : 'none' }}
              >
                <TerminalView
                  projectDir={dbId === dashboardId ? projectDir : getDashboardProject(dbId)}
                  dashboardId={dbId}
                />
              </div>
            ))
          )}
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
