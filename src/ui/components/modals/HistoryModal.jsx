// HistoryModal — Lists past swarm records with status dots, badges, dates, completion stats
// Mirrors HistoryModal.js with React hooks and JSX.

import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';

function getDotColor(item) {
  if (item.overall_status === 'completed') return '#34d399';
  if (item.overall_status === 'completed_with_errors') return '#f97316';
  if (item.failed_tasks > 0) return '#ef4444';
  return '#34d399';
}

function HistoryEntry({ item, onClick }) {
  const dotColor = getDotColor(item);
  const statsText = item.completed_tasks + '/' + item.total_tasks +
    (item.failed_tasks > 0 ? ' (' + item.failed_tasks + ' failed)' : '');
  const dateStr = item.cleared_at ? item.cleared_at.slice(0, 10) : '';

  return (
    <div className="history-entry" onClick={() => onClick && onClick(item)}>
      <span className="history-entry-dot" style={{ backgroundColor: dotColor }} />
      <div className="history-entry-content">
        <div className="history-entry-name">{item.task_name || 'unnamed'}</div>
        <div className="history-entry-meta">
          {item.task_type && (
            <span
              className="history-entry-badge"
              style={{ backgroundColor: 'rgba(102,126,234,0.1)', color: 'rgba(102,126,234,0.8)' }}
            >
              {item.task_type}
            </span>
          )}
          {item.project && (
            <span
              className="history-entry-badge"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {item.project}
            </span>
          )}
          <span
            className="history-entry-badge"
            style={{ backgroundColor: 'rgba(155,124,240,0.1)', color: '#9b7cf0' }}
          >
            {statsText}
          </span>
          {item.duration && (
            <span
              className="history-entry-badge"
              style={{ backgroundColor: 'rgba(52,211,153,0.08)', color: '#34d399' }}
            >
              {item.duration}
            </span>
          )}
          {dateStr && (
            <span className="history-entry-date">{dateStr}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HistoryModal({ onClose, onItemClick }) {
  const api = window.electronAPI || null;
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) { setLoading(false); return; }
    api.getHistory().then(items => {
      setHistory(items || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api]);

  return (
    <Modal title="Task History" onClose={onClose}>
      {loading ? (
        <div className="history-empty">Loading...</div>
      ) : history.length === 0 ? (
        <div className="history-empty">No completed tasks in history</div>
      ) : (
        history.map((item, i) => (
          <HistoryEntry
            key={item.task_name + i}
            item={item}
            onClick={onItemClick}
          />
        ))
      )}
    </Modal>
  );
}
