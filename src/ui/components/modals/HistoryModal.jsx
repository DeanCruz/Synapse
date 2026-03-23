// HistoryModal — Lists past swarm records with status dots, badges, dates, completion stats
// Includes an analytics section showing aggregate metrics when analytics.json is available.

import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';

function getDotColor(item) {
  if (item.overall_status === 'completed') return '#34d399';
  if (item.overall_status === 'completed_with_errors') return '#f97316';
  if (item.failed_tasks > 0) return '#ef4444';
  return '#34d399';
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? m + 'm ' + s + 's' : s + 's';
}

function getTrendColor(trend) {
  if (trend === 'improving') return '#34d399';
  if (trend === 'degrading') return '#ef4444';
  return '#a78bfa';
}

function getTrendLabel(trend) {
  if (trend === 'improving') return 'Improving';
  if (trend === 'degrading') return 'Degrading';
  return 'Stable';
}

function AnalyticsSection({ analytics }) {
  if (!analytics) {
    return (
      <div style={{
        padding: '12px 16px',
        marginBottom: 16,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        color: 'var(--text-secondary)',
        fontSize: 13,
      }}>
        Run <code style={{ color: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.1)', padding: '2px 6px', borderRadius: 4 }}>!history --analytics</code> to compute analytics.
      </div>
    );
  }

  const metrics = [
    { label: 'Total Swarms', value: analytics.total_swarms },
    { label: 'Avg Tasks/Swarm', value: analytics.avg_tasks_per_swarm != null ? analytics.avg_tasks_per_swarm.toFixed(1) : '--' },
    { label: 'Avg Duration', value: formatDuration(analytics.avg_duration_seconds) },
    { label: 'Failure Rate', value: analytics.overall_failure_rate != null ? analytics.overall_failure_rate.toFixed(1) + '%' : '--' },
    {
      label: 'Failure Trend',
      value: getTrendLabel(analytics.failure_rate_trend),
      color: getTrendColor(analytics.failure_rate_trend),
    },
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 8,
      }}>
        {metrics.map((m) => (
          <div key={m.label} style={{
            flex: '1 1 auto',
            minWidth: 110,
            padding: '10px 12px',
            borderRadius: 8,
            backgroundColor: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: m.color || 'var(--text-primary)' }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
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
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) { setLoading(false); return; }

    const loadData = async () => {
      try {
        const [historyResult, analyticsResult] = await Promise.all([
          api.getHistory(),
          fetch('/api/history/analytics').then(r => r.json()).catch(() => ({ analytics: null })),
        ]);
        setHistory(historyResult || []);
        // analyticsResult is either the analytics object or { analytics: null }
        if (analyticsResult && !analyticsResult.analytics && analyticsResult.total_swarms != null) {
          setAnalytics(analyticsResult);
        } else if (analyticsResult && analyticsResult.analytics === null) {
          setAnalytics(null);
        } else {
          setAnalytics(analyticsResult);
        }
      } catch {
        // ignore errors
      }
      setLoading(false);
    };

    loadData();
  }, [api]);

  return (
    <Modal title="Task History" onClose={onClose}>
      {loading ? (
        <div className="history-empty">Loading...</div>
      ) : (
        <>
          <AnalyticsSection analytics={analytics} />
          {history.length === 0 ? (
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
        </>
      )}
    </Modal>
  );
}
