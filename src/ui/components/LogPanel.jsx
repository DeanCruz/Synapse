// LogPanel — collapsible log panel with filter buttons and auto-scroll
// Replaces LogPanelView.js

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { LEVEL_COLORS, LEVEL_BG_COLORS } from '@/utils/constants.js';
import { formatTime } from '@/utils/format.js';

const FILTER_LEVELS = ['all', 'info', 'warn', 'error', 'deviation'];

/**
 * @param {object}   props.logs          - logs payload { entries: [...] }
 * @param {string}   props.activeFilter  - current filter level ('all' | level string)
 * @param {Function} props.onFilterChange - callback(level) when a filter button is clicked
 */
export default function LogPanel({ logs, activeFilter, onFilterChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const entriesRef = useRef(null);
  const prevLengthRef = useRef(0);

  const entries = (logs && logs.entries) ? logs.entries : [];

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return entries;
    return entries.filter(e => e.level === activeFilter);
  }, [entries, activeFilter]);

  // Compute per-level counts in one pass
  const counts = useMemo(() => {
    const c = {};
    for (const e of entries) {
      c[e.level] = (c[e.level] || 0) + 1;
    }
    return c;
  }, [entries]);

  // Auto-scroll to bottom when new entries arrive (only if panel is open)
  useEffect(() => {
    if (!isOpen) return;
    if (entries.length === prevLengthRef.current) return;
    prevLengthRef.current = entries.length;

    const el = entriesRef.current;
    if (!el) return;
    // Only auto-scroll if user is near the bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered, isOpen, entries.length]);

  function getLabelCount(level) {
    if (level === 'all') return entries.length;
    return counts[level] || 0;
  }

  function getLabel(level) {
    return level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1);
  }

  return (
    <div className={`log-panel${isOpen ? ' expanded' : ''}`}>
      <button
        className="log-toggle"
        onClick={() => setIsOpen(open => !open)}
        aria-expanded={isOpen}
      >
        <span className="log-toggle-text">
          Logs ({entries.length} entries)
        </span>
        <span className={`log-toggle-chevron${isOpen ? ' open' : ''}`}>
          &#8964;
        </span>
      </button>

      <div className="log-body">
        {/* Filter bar */}
        <div className="log-filters">
          {FILTER_LEVELS.map(level => (
            <button
              key={level}
              className={`log-filter-btn${activeFilter === level ? ' active' : ''}`}
              data-level={level}
              onClick={() => onFilterChange && onFilterChange(level)}
            >
              {getLabel(level)}{' '}
              <span className="log-filter-count">{getLabelCount(level)}</span>
            </button>
          ))}
        </div>

        {/* Entries list */}
        <div className="log-entries" ref={entriesRef}>
          {filtered.map((entry, idx) => (
            <LogRow key={`${entry.timestamp}-${idx}`} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LogRow({ entry }) {
  const levelColor   = LEVEL_COLORS[entry.level]    || LEVEL_COLORS.debug;
  const levelBgColor = LEVEL_BG_COLORS[entry.level] || LEVEL_BG_COLORS.debug;

  return (
    <div className="log-row">
      <span className="log-timestamp">{formatTime(entry.timestamp)}</span>
      <span className="log-task-id">{entry.task_id}</span>
      <span className="log-agent">{entry.agent}</span>
      <span
        className="log-level"
        style={{ backgroundColor: levelBgColor, color: levelColor }}
      >
        {entry.level}
      </span>
      <span className="log-message">{entry.message}</span>
    </div>
  );
}
