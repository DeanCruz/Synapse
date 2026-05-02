// DashboardsPage — main pipeline area for the Code shell's dashboard view.
// Extracted from App.jsx (formerly DashboardContent + helpers).

import React, { useState } from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';
import { getDashboardProject } from '@/utils/dashboardProjects.js';

import ProgressBar from './components/ProgressBar.jsx';
import StatsBar from './components/StatsBar.jsx';
import WavePipeline from './components/WavePipeline.jsx';
import ChainPipeline from './components/ChainPipeline.jsx';
import EmptyState from './components/EmptyState.jsx';
import TimelinePanel from './components/TimelinePanel.jsx';
import BottomPanel from './components/BottomPanel.jsx';
import AgentDetails from '@/shared/modals/AgentDetails.jsx';

// ── ClearDashboardSection ────────────────────────────────────────────────────
function ClearDashboardSection({ visible, onClear, taskName }) {
  const [showConfirm, setShowConfirm] = useState(false);

  if (!visible) return null;
  return (
    <section className="clear-dashboard-section">
      <button
        className="clear-dashboard-btn"
        aria-label="Clear current dashboard"
        onClick={() => setShowConfirm(true)}
      >
        Clear Dashboard
      </button>
      {showConfirm && (
        <div className="sidebar-delete-overlay" onClick={() => setShowConfirm(false)}>
          <div className="sidebar-delete-popup" onClick={e => e.stopPropagation()}>
            <div className="sidebar-delete-popup-title">Clear Dashboard?</div>
            <p className="sidebar-delete-popup-text">
              Are you sure you want to remove the dashboard{taskName ? <> for <strong>{taskName}</strong></> : ''}? The current task will be archived before clearing.
            </p>
            <div className="sidebar-delete-popup-actions">
              <button
                className="sidebar-delete-popup-btn archive"
                onClick={() => { setShowConfirm(false); onClear(); }}
              >
                Remove
              </button>
              <button
                className="sidebar-delete-popup-btn cancel"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── ProgressSection (progress bar + stats bar) ───────────────────────────────
function ProgressSection({ onOpenTimeline }) {
  const { currentStatus } = useAppState();
  const task = currentStatus?.active_task ?? null;
  const completed = task?.completed_tasks ?? 0;
  const total = task?.total_tasks ?? 0;

  return (
    <section className="progress-section">
      <ProgressBar completed={completed} total={total} />
      <StatsBar onOpenTimeline={onOpenTimeline} />
    </section>
  );
}

// ── ReplanningBanner — shown when circuit breaker fires ──────────────────────
function ReplanningBanner({ visible }) {
  if (!visible) return null;
  return (
    <div className="replanning-banner">
      <span className="replanning-dot" />
      <span>Circuit breaker triggered — replanning in progress</span>
    </div>
  );
}

// ── DashboardsPage — main pipeline area ──────────────────────────────────────
export default function DashboardsPage() {
  const state = useAppState();
  const dispatch = useDispatch();
  const { currentStatus, currentLogs, activeLogFilter, activeStatFilter, currentProgress } = state;

  const [timelineOpen, setTimelineOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);

  const task = currentStatus?.active_task ?? null;
  const taskType = task?.type ?? 'Waves';
  const hasTask = !!task?.name;
  const agents = currentStatus?.agents ?? [];

  function findAgent(id) {
    return agents.find(a => a.id === id) || null;
  }

  // Show clear button when task has completed (with or without errors)
  const showClear = task?.overall_status === 'completed'
    || task?.overall_status === 'completed_with_errors';

  async function handleClear() {
    const api = window.electronAPI;
    if (!api) return;
    if (!state.currentDashboardId) return;
    // Archive the current task before clearing
    if (hasTask) {
      await api.archiveDashboard(state.currentDashboardId).catch(() => {});
    }
    await api.clearDashboard(state.currentDashboardId).catch(() => {});
  }

  const dashboardId = state.currentDashboardId;
  const projectPath = getDashboardProject(dashboardId);
  const projectName = projectPath ? projectPath.replace(/\/+$/, '').split('/').pop() : null;

  return (
    <>
      <div className="dashboard-action-bar">
        <button
          className={`dashboard-action-bar-btn${projectPath ? ' has-project' : ''}`}
          title={projectPath ? `Project: ${projectPath}` : 'Set project directory'}
          onClick={() => dispatch({ type: 'OPEN_MODAL', modal: 'project', dashboardId })}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 4l4-2 4 2 4-2v10l-4 2-4-2-4 2V4z" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M6 2v12M10 4v12" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          <span>{projectName || 'Project'}</span>
        </button>
        <button
          className="dashboard-action-bar-btn"
          title="View dashboard logs"
          onClick={() => dispatch({ type: 'OPEN_MODAL', modal: 'logs', dashboardId })}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 3h12M2 6.5h12M2 10h8M2 13.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <span>Logs</span>
        </button>
      </div>

      <ProgressSection onOpenTimeline={() => setTimelineOpen(true)} />
      <ReplanningBanner visible={task?.overall_status === 'replanning'} />


      <div className="dashboard-scroll-area">
        {hasTask ? (
          <>
            {taskType === 'Chains'
              ? <ChainPipeline status={currentStatus} activeStatFilter={activeStatFilter} onAgentClick={setSelectedAgent} />
              : <WavePipeline status={currentStatus} activeStatFilter={activeStatFilter} onAgentClick={setSelectedAgent} progressData={currentProgress} />
            }
            <ClearDashboardSection visible={showClear} onClear={handleClear} taskName={task?.name} />
          </>
        ) : (
          <EmptyState />
        )}
      </div>

      <TimelinePanel
        status={currentStatus}
        visible={timelineOpen}
        onClose={() => setTimelineOpen(false)}
      />

      <BottomPanel
        logs={currentLogs}
        activeFilter={activeLogFilter}
        onFilterChange={(level) => dispatch({ type: 'SET', key: 'activeLogFilter', value: level })}
        projectDir={projectPath}
        dashboardId={dashboardId}
      />

      {selectedAgent && (
        <AgentDetails
          agent={selectedAgent}
          progressData={currentProgress}
          findAgentFn={findAgent}
          onClose={() => setSelectedAgent(null)}
          projectRoot={projectPath}
        />
      )}
    </>
  );
}
