// LogsModal — Full-screen modal displaying all log entries for a dashboard
// Includes filter buttons, search, and auto-scroll.

import React, { useState, useRef, useEffect, useMemo } from 'react';
import Modal from './Modal.jsx';
import { LEVEL_COLORS, LEVEL_BG_COLORS } from '@/utils/constants.js';
import { formatTime } from '@/utils/format.js';

const FILTER_LEVELS = ['all', 'info', 'warn', 'error', 'deviation'];

export default function LogsModal({ onClose, logs, dashboardId }) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
  const entriesRef = useRef(null);
  const prevLengthRef = useRef(0);

  const entries = (logs && logs.entries) ? logs.entries : [];

  const filtered = useMemo(() => {
    let result = entries;
    if (activeFilter !== 'all') {
      result = result.filter(e => e.level === activeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        (e.message && e.message.toLowerCase().includes(q))
        || (e.task_id && e.task_id.toLowerCase().includes(q))
        || (e.agent && e.agent.toLowerCase().includes(q))
      );
    }
    return result;
  }, [entries, activeFilter, search]);

  const counts = useMemo(() => {
    const c = {};
    for (const e of entries) {
      c[e.level] = (c[e.level] || 0) + 1;
    }
    return c;
  }, [entries]);

  // Auto-scroll when new entries arrive
  useEffect(() => {
    if (entries.length === prevLengthRef.current) return;
    prevLengthRef.current = entries.length;
    const el = entriesRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [filtered, entries.length]);

  const dashLabel = dashboardId ? dashboardId.replace('dashboard', 'Dashboard ') : 'Dashboard';

  return (
    <Modal title={`Logs — ${dashLabel}`} onClose={onClose} className="logs-modal">
      <div className="logs-modal-toolbar">
        <div className="logs-modal-filters">
          {FILTER_LEVELS.map(level => (
            <button
              key={level}
              className={`logs-modal-filter-btn${activeFilter === level ? ' active' : ''}`}
              data-level={level}
              onClick={() => setActiveFilter(level)}
            >
              {level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1)}
              {' '}
              <span className="logs-modal-filter-count">
                {level === 'all' ? entries.length : (counts[level] || 0)}
              </span>
            </button>
          ))}
        </div>
        <input
          className="logs-modal-search"
          type="text"
          placeholder="Search logs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="logs-modal-entries" ref={entriesRef}>
        {filtered.length === 0 ? (
          <div className="logs-modal-empty">No log entries{search ? ' matching search' : ''}</div>
        ) : (
          filtered.map((entry, idx) => (
            <div className="logs-modal-row" key={`${entry.timestamp}-${idx}`}>
              <span className="logs-modal-ts">{formatTime(entry.timestamp)}</span>
              <span className="logs-modal-task">{entry.task_id}</span>
              <span className="logs-modal-agent">{entry.agent}</span>
              <span
                className="logs-modal-level"
                style={{
                  backgroundColor: LEVEL_BG_COLORS[entry.level] || LEVEL_BG_COLORS.debug,
                  color: LEVEL_COLORS[entry.level] || LEVEL_COLORS.debug,
                }}
              >
                {entry.level}
              </span>
              <span className="logs-modal-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
