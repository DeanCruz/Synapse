// Sidebar — Dashboard selector with status dots, per-dashboard Project/Claude buttons,
// collapse toggle, and queue section

import React, { useState } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';
import { DEFAULT_DASHBOARDS, DASHBOARD_LABELS } from '@/utils/constants.js';
import { getDashboardProject } from '../utils/dashboardProjects.js';

function StatusDot({ status }) {
  let cls = 'dashboard-item-status idle';
  if (status === 'in_progress') cls = 'dashboard-item-status in-progress';
  else if (status === 'completed') cls = 'dashboard-item-status completed';
  else if (status === 'error') cls = 'dashboard-item-status error';
  else if (status === 'idle') cls = 'dashboard-item-status idle';
  return <span className={cls} />;
}

function getProjectDisplayName(dashboardId) {
  const projectPath = getDashboardProject(dashboardId);
  if (!projectPath) return null;
  const parts = projectPath.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || null;
}

export default function Sidebar() {
  const state = useAppState();
  const dispatch = useDispatch();
  const { currentDashboardId, dashboardStates, queueItems } = state;

  const [collapsed, setCollapsed] = useState(false);

  function handleSwitch(id) {
    if (id !== currentDashboardId) {
      dispatch({ type: 'SWITCH_DASHBOARD', id });
    }
  }

  function handleProjectClick(e, dashboardId) {
    e.stopPropagation();
    dispatch({ type: 'OPEN_MODAL', modal: 'project', dashboardId });
  }

  function handleClaudeClick(e, dashboardId) {
    e.stopPropagation();
    // Switch to the dashboard first, then open Claude
    if (dashboardId !== currentDashboardId) {
      dispatch({ type: 'SWITCH_DASHBOARD', id: dashboardId });
    }
    dispatch({ type: 'SET_VIEW', view: 'claude', dashboardId });
  }

  return (
    <aside className={`dashboard-sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-title">Dashboards</span>
        <button
          className="sidebar-toggle-btn"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label="Toggle sidebar"
          onClick={() => setCollapsed(c => !c)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Dashboard list */}
      <div className="dashboard-list">
        {DEFAULT_DASHBOARDS.map(id => {
          const status = dashboardStates[id] ?? 'idle';
          const isActive = id === currentDashboardId;
          const projectName = getProjectDisplayName(id);
          const projectPath = getDashboardProject(id);
          return (
            <div
              key={id}
              className={`dashboard-item${isActive ? ' active' : ''}`}
              onClick={() => handleSwitch(id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSwitch(id); }}
            >
              <StatusDot status={status} />
              <span className="dashboard-item-name" title={projectPath || undefined}>
                {projectName || (DASHBOARD_LABELS[id] ?? id)}
              </span>
              <div className="dashboard-item-actions">
                <button
                  className={`dashboard-item-action-btn${projectPath ? ' has-project' : ''}`}
                  title={projectPath ? `Project: ${projectPath}` : 'Set project directory'}
                  onClick={(e) => handleProjectClick(e, id)}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M2 4l4-2 4 2 4-2v10l-4 2-4-2-4 2V4z" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M6 2v12M10 4v12" stroke="currentColor" strokeWidth="1.4"/>
                  </svg>
                </button>
                <button
                  className="dashboard-item-action-btn"
                  title="Claude Chat"
                  onClick={(e) => handleClaudeClick(e, id)}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M2 3h12v8H6l-4 3v-3H2V3z" stroke="currentColor" strokeWidth="1.4"/>
                    <circle cx="5.5" cy="7" r="0.8" fill="currentColor"/>
                    <circle cx="8" cy="7" r="0.8" fill="currentColor"/>
                    <circle cx="10.5" cy="7" r="0.8" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            </div>
          );
        })}

        {/* Queue items */}
        {queueItems.length > 0 && (
          <>
            <div className="dashboard-item queue-count-item">
              <span className="dashboard-item-status queue-dot" />
              <span className="dashboard-item-name">{queueItems.length} queued</span>
            </div>
            {queueItems.map((item, idx) => (
              <div key={item.id ?? idx} className="dashboard-item queue-item">
                <span className="dashboard-item-status queue-dot" />
                <span className="dashboard-item-name">{item.name ?? `Queue ${idx + 1}`}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer — Settings */}
      <div className="sidebar-footer">
        <button className="sidebar-settings-btn" title="Settings" aria-label="Settings" onClick={() => dispatch({ type: 'OPEN_MODAL', modal: 'settings' })}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M3.93 3.93l1.77 1.77M10.3 10.3l1.77 1.77M3.93 12.07l1.77-1.77M10.3 5.7l1.77-1.77" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <span className="sidebar-settings-label">Settings</span>
        </button>
      </div>
    </aside>
  );
}
