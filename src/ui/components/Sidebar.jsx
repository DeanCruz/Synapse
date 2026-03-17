// Sidebar — Dashboard selector with status dots, collapse toggle, and queue section

import React, { useState } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';
import { DEFAULT_DASHBOARDS, DASHBOARD_LABELS } from '@/utils/constants.js';

function StatusDot({ status }) {
  let cls = 'dashboard-item-status idle';
  if (status === 'in_progress') cls = 'dashboard-item-status in-progress';
  else if (status === 'completed') cls = 'dashboard-item-status completed';
  else if (status === 'error') cls = 'dashboard-item-status error';
  else if (status === 'idle') cls = 'dashboard-item-status idle';
  return <span className={cls} />;
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
              <span className="dashboard-item-name">{DASHBOARD_LABELS[id] ?? id}</span>
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
