// LogPanel — collapsible log panel with filter buttons, auto-scroll, and retry actions
// Replaces LogPanelView.js

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { LEVEL_COLORS, LEVEL_BG_COLORS } from '@/utils/constants.js';
import { formatTime } from '@/utils/format.js';
import { detectEnvironment } from '../hooks/useElectronAPI.js';

const FILTER_LEVELS = ['all', 'info', 'warn', 'error', 'deviation'];

/**
 * Resolve the platform API for retry actions.
 */
function getPlatformAPI() {
  const env = detectEnvironment();
  if (env === 'electron' || env === 'webview') {
    return window.electronAPI || null;
  }
  return null;
}

/**
 * @param {object}   props.logs          - logs payload { entries: [...] }
 * @param {string}   props.activeFilter  - current filter level ('all' | level string)
 * @param {Function} props.onFilterChange - callback(level) when a filter button is clicked
 * @param {string}   [props.dashboardId] - current dashboard ID (for retry actions)
 */
export default function LogPanel({ logs, activeFilter, onFilterChange, dashboardId }) {
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

  // Retry handler for failed tasks shown in log entries
  const handleRetry = useCallback(async (taskId) => {
    if (!taskId || !dashboardId) return;
    const api = getPlatformAPI();
    if (!api) return;

    try {
      if (api.retryTask) {
        await api.retryTask({ dashboardId, taskId });
      }
    } catch (_) {
      // Retry failure is non-fatal — user can retry from other surfaces
    }
  }, [dashboardId]);

  function getLabelCount(level) {
    if (level === 'all') return entries.length;
    return counts[level] || 0;
  }

  function getLabel(level) {
    return level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1);
  }

  // Count errors and deviations for badge display on toggle
  const errorCount = counts['error'] || 0;
  const deviationCount = counts['deviation'] || 0;

  return (
    <div className={`log-panel${isOpen ? ' expanded' : ''}`}>
      <button
        className="log-toggle"
        onClick={() => setIsOpen(open => !open)}
        aria-expanded={isOpen}
      >
        <span className="log-toggle-text">
          Logs ({entries.length} entries)
          {errorCount > 0 && (
            <span className="log-toggle-badge log-toggle-badge-error">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
          )}
          {deviationCount > 0 && (
            <span className="log-toggle-badge log-toggle-badge-deviation">{deviationCount} deviation{deviationCount !== 1 ? 's' : ''}</span>
          )}
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
            <LogRow
              key={`${entry.timestamp}-${idx}`}
              entry={entry}
              onRetry={entry.level === 'error' && entry.task_id ? handleRetry : null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LogRow({ entry, onRetry }) {
  const levelColor   = LEVEL_COLORS[entry.level]    || LEVEL_COLORS.debug;
  const levelBgColor = LEVEL_BG_COLORS[entry.level] || LEVEL_BG_COLORS.debug;

  return (
    <div className={`log-row${entry.level === 'deviation' ? ' log-row-deviation' : ''}`}>
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
      {onRetry && (
        <button
          className="log-retry-btn"
          title={`Retry task ${entry.task_id}`}
          onClick={(e) => { e.stopPropagation(); onRetry(entry.task_id); }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
