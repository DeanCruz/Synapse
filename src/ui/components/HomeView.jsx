// HomeView — Overview showing all dashboards, archives, and history
// Replaces HomeView.js

import React, { useState, useEffect } from 'react';
import { getDashboardLabel } from '@/utils/constants.js';

/**
 * @param {object}   props.dashboardStates     - { [dashboardId]: statusObj }
 * @param {string[]} props.dashboardList       - ordered list of dashboard ids
 * @param {object}   props.allDashboardLogs    - { [dashboardId]: { entries: [...] } }
 * @param {Function} props.onSwitchDashboard   - callback(dashboardId)
 */
export default function HomeView({ dashboardStates, dashboardList, allDashboardLogs, onSwitchDashboard, onArchiveClick }) {
  const [archives, setArchives] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetch('/api/overview')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setArchives(data.archives || []);
        setHistory(data.history || []);
      })
      .catch(() => {});
  }, []);

  // Build dashboard records from dashboardList + dashboardStates
  const dashboards = (dashboardList || []).map(id => ({
    id,
    ...(dashboardStates[id] || { status: 'idle' }),
  }));

  const activeDashboards   = dashboards.filter(d => d.status !== 'idle');
  const inactiveDashboards = dashboards.filter(d => d.status === 'idle');

  return (
    <div className="home-view">
      {/* Active Dashboards */}
      <HomeSection
        title="Active Dashboards"
        empty={activeDashboards.length === 0 ? 'No active dashboards' : null}
      >
        {activeDashboards.map(d => (
          <DashboardCard key={d.id} dashboard={d} onClick={onSwitchDashboard} />
        ))}
      </HomeSection>

      {/* Inactive Dashboards */}
      <HomeSection
        title="Inactive Dashboards"
        empty={inactiveDashboards.length === 0 ? 'All dashboards are active' : null}
      >
        {inactiveDashboards.map(d => (
          <IdleItem key={d.id} dashboard={d} onClick={onSwitchDashboard} />
        ))}
      </HomeSection>

      {/* Recently Archived */}
      <HomeSection
        title="Recently Archived"
        empty={archives.length === 0 ? 'No archived tasks' : null}
      >
        {archives.map((archive, idx) => (
          <ArchiveEntry key={archive.name || idx} archive={archive} onClick={onArchiveClick} />
        ))}
      </HomeSection>

      {/* Recent History */}
      <HomeSection
        title="Recent History"
        empty={history.length === 0 ? 'No completed tasks in history' : null}
      >
        {history.map((item, idx) => (
          <HistoryEntry key={idx} item={item} />
        ))}
      </HomeSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HomeSection({ title, empty, children }) {
  return (
    <div className="home-section">
      <div className="home-section-header">
        <span className="home-section-title">{title}</span>
      </div>
      <div className="home-section-body">
        {empty ? (
          <div className="home-empty">{empty}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function statusDotClass(status) {
  if (status === 'in_progress') return 'in-progress';
  if (status === 'completed')   return 'completed';
  if (status === 'error')       return 'error';
  return 'idle';
}

function statusLabel(status) {
  if (status === 'in_progress') return 'In Progress';
  if (status === 'completed')   return 'Completed';
  if (status === 'error')       return 'Errors';
  return 'Idle';
}

function DashboardCard({ dashboard, onClick }) {
  const dotClass = statusDotClass(dashboard.status);
  const label    = getDashboardLabel(dashboard.id);
  const task     = dashboard.task;

  const completedCount = task ? ((task.completed_tasks || 0) + (task.failed_tasks || 0)) : 0;
  const totalCount     = task ? (task.total_tasks || 0) : 0;
  const pct            = totalCount > 0 ? Math.round((task.completed_tasks || 0) / totalCount * 100) : 0;

  return (
    <div className="home-dashboard-card" onClick={() => onClick && onClick(dashboard.id)}>
      <span className={`home-card-dot ${dotClass}`} />

      <div className="home-card-content">
        <div className="home-card-label">{label}</div>

        {task && (
          <>
            <div className="home-card-task-name">{task.name}</div>
            <div className="home-card-meta">
              {task.type && (
                <span
                  className="home-card-badge"
                  style={{ backgroundColor: 'rgba(102,126,234,0.1)', color: 'rgba(102,126,234,0.8)' }}
                >
                  {task.type}
                </span>
              )}
              {task.directory && (
                <span
                  className="home-card-badge"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}
                >
                  {task.directory}
                </span>
              )}
              <span
                className="home-card-badge"
                style={{ backgroundColor: 'rgba(155,124,240,0.1)', color: '#9b7cf0' }}
              >
                {completedCount}/{totalCount} tasks
              </span>
            </div>
            {totalCount > 0 && (
              <div className="home-card-progress-track">
                <div
                  className={`home-card-progress-fill${task.failed_tasks > 0 ? ' has-errors' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </>
        )}
      </div>

      <span className={`home-card-status ${dotClass}`}>{statusLabel(dashboard.status)}</span>
    </div>
  );
}

function IdleItem({ dashboard, onClick }) {
  const label = getDashboardLabel(dashboard.id);
  return (
    <div className="home-idle-item" onClick={() => onClick && onClick(dashboard.id)}>
      <span className="home-card-dot idle" />
      <span className="home-idle-label">{label}</span>
      <span className="home-idle-status">Available</span>
    </div>
  );
}

function ArchiveEntry({ archive, onClick }) {
  const taskName = archive.task ? archive.task.name : archive.name;
  const dateStr  = archive.name ? archive.name.slice(0, 10) : '';

  return (
    <div className="history-entry home-clickable" onClick={() => onClick && onClick(archive)}>
      <span className="history-entry-dot" style={{ backgroundColor: '#34d399' }} />
      <div className="history-entry-content">
        <div className="history-entry-name">{taskName}</div>
        <div className="history-entry-meta">
          {archive.task && archive.task.type && (
            <span
              className="history-entry-badge"
              style={{ backgroundColor: 'rgba(102,126,234,0.1)', color: 'rgba(102,126,234,0.8)' }}
            >
              {archive.task.type}
            </span>
          )}
          <span
            className="history-entry-badge"
            style={{ backgroundColor: 'rgba(155,124,240,0.1)', color: '#9b7cf0' }}
          >
            {archive.agentCount} agents
          </span>
          {dateStr && <span className="history-entry-date">{dateStr}</span>}
        </div>
      </div>
    </div>
  );
}

function HistoryEntry({ item }) {
  const dotColor = item.overall_status === 'completed'
    ? '#34d399'
    : item.overall_status === 'completed_with_errors'
      ? '#f97316'
      : item.failed_tasks > 0
        ? '#ef4444'
        : '#34d399';

  const statsText = `${item.completed_tasks || 0}/${item.total_tasks || 0}${item.failed_tasks > 0 ? ` (${item.failed_tasks} failed)` : ''}`;

  return (
    <div className="history-entry">
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
          {item.cleared_at && (
            <span className="history-entry-date">{item.cleared_at.slice(0, 10)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
