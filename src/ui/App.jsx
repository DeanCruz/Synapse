// App — Root component. Wires IPC, fetches initial data, renders layout.

import React, { useEffect, useState, useCallback } from 'react';
import { useAppState, useDispatch } from './context/AppContext.jsx';
import { useDashboardData } from './hooks/useDashboardData.js';
import { initStatusColorsFromCSS } from '@/utils/constants.js';
import { useResize } from './hooks/useResize.js';

import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import StatsBar from './components/StatsBar.jsx';
import ProgressBar from './components/ProgressBar.jsx';
import EmptyState from './components/EmptyState.jsx';
import HomeView from './components/HomeView.jsx';
import SwarmBuilder from './components/SwarmBuilder.jsx';
import ClaudeView from './components/ClaudeView.jsx';
import WavePipeline from './components/WavePipeline.jsx';
import ChainPipeline from './components/ChainPipeline.jsx';
import TimelinePanel from './components/TimelinePanel.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';
import LogPanel from './components/LogPanel.jsx';
import CommandsModal from './components/modals/CommandsModal.jsx';
import ProjectModal from './components/modals/ProjectModal.jsx';
import PlanningModal from './components/modals/PlanningModal.jsx';
import SettingsModal from './components/modals/SettingsModal.jsx';
import AgentDetails from './components/modals/AgentDetails.jsx';
import { getDashboardProject } from './utils/dashboardProjects.js';

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

// ── DashboardContent — main pipeline area ────────────────────────────────────
function DashboardContent() {
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
      </div>

      <ProgressSection onOpenTimeline={() => setTimelineOpen(true)} />
      <ReplanningBanner visible={task?.overall_status === 'replanning'} />
      <MetricsPanel dashboardId={dashboardId} />

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

      <TimelinePanel
        status={currentStatus}
        visible={timelineOpen}
        onClose={() => setTimelineOpen(false)}
      />

      <LogPanel
        logs={currentLogs}
        activeFilter={activeLogFilter}
        onFilterChange={(level) => dispatch({ type: 'SET', key: 'activeLogFilter', value: level })}
      />

      {selectedAgent && (
        <AgentDetails
          agent={selectedAgent}
          progressData={currentProgress}
          findAgentFn={findAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </>
  );
}

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const state = useAppState();
  const dispatch = useDispatch();

  // Connect IPC listeners — must be called once at App level
  useDashboardData();

  // Initialize CSS-derived status colors and restore saved theme on mount
  useEffect(() => {
    initStatusColorsFromCSS();

    const savedTheme = localStorage.getItem('synapse-theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  }, []);

  // Fetch initial data (dashboard statuses + queue) once IPC is available
  const fetchInitialData = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;

    try {
      const statusesResult = await api.invoke?.('api', { path: '/api/dashboards/statuses' });
      if (statusesResult?.statuses) {
        Object.entries(statusesResult.statuses).forEach(([id, status]) => {
          dispatch({ type: 'SET_DASHBOARD_STATE', id, status });
        });
      }
    } catch (_) {
      // Non-fatal — statuses arrive via push events
    }

    try {
      const queueResult = await api.invoke?.('api', { path: '/api/queue' });
      if (queueResult?.queue) {
        dispatch({ type: 'SET', key: 'queueItems', value: queueResult.queue });
      }
    } catch (_) {
      // Non-fatal
    }
  }, [dispatch]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const { activeView, activeModal, currentStatus, currentLogs, dashboardStates, dashboardList,
          allDashboardLogs, currentDashboardId } = state;

  function closeModal() {
    dispatch({ type: 'CLOSE_MODAL' });
  }

  function handleSwitchDashboard(id) {
    dispatch({ type: 'SWITCH_DASHBOARD', id });
  }

  async function handleArchiveClick(archive) {
    try {
      const res = await fetch('/api/archives/' + encodeURIComponent(archive.name));
      if (!res.ok) return;
      const data = await res.json();
      if (data.error) return;
      dispatch({ type: 'SET_INIT', data: data.initialization });
      dispatch({ type: 'SET_PROGRESS', data: data.progress });
      dispatch({ type: 'SET_LOGS', data: data.logs });
      dispatch({ type: 'SET', key: 'archiveViewActive', value: true });
      dispatch({ type: 'SET_VIEW', view: 'dashboard' });
    } catch (_) {}
  }

  const claudeViewMode = state.claudeViewMode;
  const claudeDashboardId = state.claudeDashboardId || currentDashboardId;
  const showClaudeFloat = activeView === 'claude';

  function renderMainContent() {
    switch (activeView) {
      case 'home':
        return (
          <HomeView
            dashboardStates={dashboardStates}
            dashboardList={dashboardList}
            allDashboardLogs={allDashboardLogs}
            onSwitchDashboard={handleSwitchDashboard}
            onArchiveClick={handleArchiveClick}
          />
        );
      case 'swarmBuilder':
        return (
          <SwarmBuilder
            dashboardId={currentDashboardId}
            onCancel={() => dispatch({ type: 'SET_VIEW', view: 'dashboard' })}
          />
        );
      case 'claude':
        // Claude is now a floating panel — show the dashboard behind it
        return <DashboardContent />;
      case 'dashboard':
      default:
        return <DashboardContent />;
    }
  }

  return (
    <>
      <Header />
      <div className="dashboard-layout">
        <Sidebar />
        <div className="dashboard-content">
          {renderMainContent()}
        </div>
      </div>

      {activeModal === 'commands' && (
        <CommandsModal onClose={closeModal} />
      )}
      {activeModal === 'project' && (
        <ProjectModal
          onClose={closeModal}
          dashboardId={state.modalDashboardId || currentDashboardId}
        />
      )}
      {activeModal === 'planning' && (
        <PlanningModal
          onClose={closeModal}
          dashboardId={currentDashboardId}
          onPlanReady={() => { closeModal(); dispatch({ type: 'SET_VIEW', view: 'dashboard' }); }}
        />
      )}
      {activeModal === 'settings' && (
        <SettingsModal onClose={closeModal} />
      )}

      {/* Floating Claude chat panel — always mounted so IPC listeners stay alive */}
      <ClaudeFloatingPanel
        isVisible={true}
        dashboardId={claudeDashboardId}
        viewMode={showClaudeFloat ? claudeViewMode : 'minimized'}
        onOpen={() => {
          dispatch({ type: 'CLAUDE_SET_VIEW_MODE', mode: 'expanded' });
          dispatch({ type: 'SET_VIEW', view: 'claude', dashboardId: claudeDashboardId || currentDashboardId });
        }}
        onSetMode={(mode) => {
          dispatch({ type: 'CLAUDE_SET_VIEW_MODE', mode });
          if (mode === 'minimized') dispatch({ type: 'SET_VIEW', view: 'dashboard' });
        }}
      />
    </>
  );
}

// ── ClaudeFloatingPanel — wraps ClaudeView in a floating container ──────────
// Always mounted so IPC listeners stay alive during background runs.
// Shows as a minimized pill when chat is not actively open.
function ClaudeFloatingPanel({ isVisible, dashboardId, viewMode, onOpen, onSetMode }) {
  const floatRef = React.useRef(null);
  const prevMode = React.useRef(viewMode);
  const dragRef = React.useRef(null);
  const handleRef = React.useRef(null);
  useResize(floatRef, viewMode);

  // Clear inline resize styles when leaving expanded mode so they don't
  // bleed into minimized/collapsed/maximized layouts.
  React.useEffect(() => {
    if (prevMode.current === 'expanded' && viewMode !== 'expanded' && floatRef.current) {
      floatRef.current.style.width = '';
    }
    prevMode.current = viewMode;
  }, [viewMode]);

  // Left-edge drag-to-resize (width only, right-anchored panel)
  const onResizeStart = React.useCallback((e) => {
    if (viewMode !== 'expanded' || !floatRef.current) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = floatRef.current.getBoundingClientRect().width;
    dragRef.current = { startX, startWidth };
    if (handleRef.current) handleRef.current.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      if (!dragRef.current || !floatRef.current) return;
      // Dragging left = negative deltaX = wider panel (right-anchored)
      const deltaX = ev.clientX - dragRef.current.startX;
      const newWidth = Math.max(360, dragRef.current.startWidth - deltaX);
      floatRef.current.style.width = newWidth + 'px';
    };

    const onUp = () => {
      dragRef.current = null;
      if (handleRef.current) handleRef.current.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [viewMode]);

  return (
    <div
      ref={floatRef}
      className={`claude-float claude-float--${viewMode}`}
      style={!isVisible ? { display: 'none' } : undefined}
    >
      {viewMode === 'expanded' && (
        <>
          <div className="claude-resize-handle claude-resize-left" data-resize-edge="left" />
          <div className="claude-resize-handle claude-resize-top" data-resize-edge="top" />
          <div className="claude-resize-handle claude-resize-corner" data-resize-edge="top-left" />
        </>
      )}
      {/* Minimized: show pill button */}
      {viewMode === 'minimized' && (
        <button className="claude-pill" onClick={() => onOpen()}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 3h12v8H6l-4 3v-3H2V3z" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="5.5" cy="7" r="0.8" fill="currentColor"/>
            <circle cx="8" cy="7" r="0.8" fill="currentColor"/>
            <circle cx="10.5" cy="7" r="0.8" fill="currentColor"/>
          </svg>
          <span>Claude</span>
        </button>
      )}
      {/* Left-edge resize handle (expanded mode only) */}
      {viewMode === 'expanded' && (
        <div
          ref={handleRef}
          className="claude-float-resize-handle"
          onMouseDown={onResizeStart}
        />
      )}
      {/* ClaudeView always in the same tree position so it never unmounts */}
      <div className="claude-view" style={viewMode === 'minimized' ? { display: 'none' } : undefined}>
        {viewMode !== 'minimized' && (
          <ClaudeFloatingHeader
            dashboardId={dashboardId}
            viewMode={viewMode}
            onSetMode={onSetMode}
          />
        )}
        <ClaudeView hideHeader />
      </div>
    </div>
  );
}

// ── Floating header with window controls ────────────────────────────────────
function ClaudeFloatingHeader({ dashboardId, viewMode, onSetMode }) {
  const state = useAppState();
  const projectPath = getDashboardProject(dashboardId);
  const projectName = projectPath ? projectPath.replace(/\/+$/, '').split('/').pop() : null;
  const dashboardLabel = dashboardId.replace('dashboard', 'Dashboard ');

  return (
    <div
      className="claude-float-header"
      onClick={() => { if (viewMode === 'collapsed') onSetMode('expanded'); }}
      style={{ cursor: viewMode === 'collapsed' ? 'pointer' : 'default' }}
    >
      <span className="claude-view-title">Agent Chat</span>
      {projectName && (
        <span className="claude-view-project" title={projectPath}>
          {projectName}
        </span>
      )}
      {!projectName && (
        <span className="claude-view-project">{dashboardLabel}</span>
      )}
      <span className={'claude-view-status' + (state.claudeIsProcessing ? ' active' : '')}>
        {state.claudeStatus}
      </span>

      <div className="claude-view-controls">
        <button className="claude-view-ctrl-btn" title="Minimize" onClick={(e) => { e.stopPropagation(); onSetMode('minimized'); }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 9h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
        <button className="claude-view-ctrl-btn" title={viewMode === 'maximized' ? 'Restore' : 'Maximize'} onClick={(e) => { e.stopPropagation(); onSetMode(viewMode === 'maximized' ? 'expanded' : 'maximized'); }}>
          {viewMode === 'maximized' ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="3" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="1" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="var(--bg, #0f0f14)"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="1" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
