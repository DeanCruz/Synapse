// BottomPanel — tabbed panel at the bottom of the dashboard with Terminal and Logs tabs.
// Supports multiple terminal instances via sub-tabs within the Terminal view.
// Both main tabs stay mounted (display toggle) so terminal state persists.

import React, { useState, useCallback, useRef } from 'react';
import LogPanel from './LogPanel.jsx';
import TerminalView from './TerminalView.jsx';

const TABS = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'logs', label: 'Logs' },
];

const MAX_TERMINAL_TABS = 5;

/**
 * @param {object}   props.logs          - logs payload { entries: [...] }
 * @param {string}   props.activeFilter  - current filter level ('all' | level string)
 * @param {Function} props.onFilterChange - callback(level) when a filter button is clicked
 * @param {string}   props.projectDir    - working directory for the terminal
 */
export default function BottomPanel({ logs, activeFilter, onFilterChange, projectDir }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('terminal');

  // Multi-terminal tab state
  const [termTabs, setTermTabs] = useState([{ id: 1, label: 'Terminal 1' }]);
  const [activeTermTab, setActiveTermTab] = useState(1);
  const nextId = useRef(2);

  const entries = (logs && logs.entries) ? logs.entries : [];

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
      setActiveTermTab(current => {
        if (current !== tabId) return current;
        return remaining[Math.min(idx, remaining.length - 1)].id;
      });
      return remaining;
    });
  }, []);

  const toggleText = activeTab === 'terminal'
    ? 'Terminal'
    : `Logs (${entries.length} entries)`;

  return (
    <div className={`log-panel${isOpen ? ' expanded' : ''}`}>
      {/* Toggle button — opens/collapses the panel */}
      <button
        className="log-toggle"
        onClick={() => setIsOpen(o => !o)}
        aria-expanded={isOpen}
      >
        <span className="log-toggle-text">
          {toggleText}
        </span>
        <span className={`log-toggle-chevron${isOpen ? ' open' : ''}`}>
          &#8964;
        </span>
      </button>

      {/* Tab bar — sits between toggle and body */}
      <div className="bottom-panel-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`bottom-panel-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.id === 'logs' ? `Logs (${entries.length})` : tab.label}
          </button>
        ))}
      </div>

      {/* Terminal tab body */}
      <div
        className="bottom-panel-body bottom-panel-body--terminal"
        style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}
      >
        {/* Terminal sub-tab bar */}
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
                  ×
                </button>
              )}
            </div>
          ))}
          {termTabs.length < MAX_TERMINAL_TABS && (
            <button
              className="terminal-tab-add"
              onClick={addTermTab}
              title="New terminal"
            >
              +
            </button>
          )}
        </div>

        {/* Terminal panes — all stay mounted, visibility toggled */}
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

      <div
        className="bottom-panel-body bottom-panel-body--logs"
        style={{ display: activeTab === 'logs' ? 'block' : 'none' }}
      >
        <LogPanel
          logs={logs}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        />
      </div>
    </div>
  );
}
