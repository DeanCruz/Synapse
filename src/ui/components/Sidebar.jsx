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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" overflow="visible">
            <path
              d="M6.7 1.4a1 1 0 011.6 0l.5.7a1 1 0 001 .4l.8-.2a1 1 0 011.1.8l.1.9a1 1 0 00.7.7l.9.1a1 1 0 01.8 1.1l-.2.8a1 1 0 00.4 1l.7.5a1 1 0 010 1.6l-.7.5a1 1 0 00-.4 1l.2.8a1 1 0 01-.8 1.1l-.9.1a1 1 0 00-.7.7l-.1.9a1 1 0 01-1.1.8l-.8-.2a1 1 0 00-1 .4l-.5.7a1 1 0 01-1.6 0l-.5-.7a1 1 0 00-1-.4l-.8.2a1 1 0 01-1.1-.8l-.1-.9a1 1 0 00-.7-.7l-.9-.1a1 1 0 01-.8-1.1l.2-.8a1 1 0 00-.4-1l-.7-.5a1 1 0 010-1.6l.7-.5a1 1 0 00.4-1l-.2-.8a1 1 0 01.8-1.1l.9-.1a1 1 0 00.7-.7l.1-.9a1 1 0 011.1-.8l.8.2a1 1 0 001-.4l.5-.7z"
              stroke="currentColor"
              strokeWidth="1.1"
            />
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.1"/>
          </svg>
          <span className="sidebar-settings-label">Settings</span>
        </button>
      </div>
    </aside>
  );
}
