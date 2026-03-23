// BottomPanel — tabbed panel at the bottom of the dashboard with Terminal and Logs tabs.
// Replaces LogPanel as the outer wrapper. Both tabs stay mounted (display toggle)
// so terminal state persists across tab switches.

import React, { useState } from 'react';
import LogPanel from './LogPanel.jsx';
import TerminalView from './TerminalView.jsx';

const TABS = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'logs', label: 'Logs' },
];

/**
 * @param {object}   props.logs          - logs payload { entries: [...] }
 * @param {string}   props.activeFilter  - current filter level ('all' | level string)
 * @param {Function} props.onFilterChange - callback(level) when a filter button is clicked
 * @param {string}   props.projectDir    - working directory for the terminal
 */
export default function BottomPanel({ logs, activeFilter, onFilterChange, projectDir }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('terminal');

  const entries = (logs && logs.entries) ? logs.entries : [];

  // Toggle button text depends on active tab
  const toggleText = activeTab === 'terminal'
    ? 'Terminal'
    : `Logs (${entries.length} entries)`;

  return (
    <div className={`log-panel${isOpen ? ' expanded' : ''}`}>
      {/* Toggle button — opens/collapses the panel */}
      <button
        className="log-toggle"
        onClick={() => setIsOpen(open => !open)}
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

      {/* Tab bodies — both always mounted, toggled via display */}
      <div
        className="bottom-panel-body bottom-panel-body--terminal"
        style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}
      >
        <TerminalView projectDir={projectDir} />
      </div>

      <div
        className="bottom-panel-body bottom-panel-body--logs"
        style={{ display: activeTab === 'logs' ? 'block' : 'none' }}
      >
        {/* LogPanel is embedded unchanged. CSS overrides strip its outer
            positioning and toggle so it renders as just the log body content. */}
        <LogPanel
          logs={logs}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        />
      </div>
    </div>
  );
}
