// App — Root component. Wires IPC, fetches initial data, renders layout.

import React, { useEffect, useState, useCallback } from 'react';
import { useAppState, useDispatch } from './context/AppContext.jsx';
import { useDashboardData } from './hooks/useDashboardData.js';
import { initStatusColorsFromCSS } from '@/utils/constants.js';

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
import LogPanel from './components/LogPanel.jsx';
import CommandsModal from './components/modals/CommandsModal.jsx';
import ProjectModal from './components/modals/ProjectModal.jsx';
import PlanningModal from './components/modals/PlanningModal.jsx';
import SettingsModal from './components/modals/SettingsModal.jsx';
import AgentDetails from './components/modals/AgentDetails.jsx';

// ── ClearDashboardSection ────────────────────────────────────────────────────
function ClearDashboardSection({ visible, onClear }) {
  if (!visible) return null;
  return (
    <section className="clear-dashboard-section">
      <button
        className="clear-dashboard-btn"
        aria-label="Clear current dashboard"
        onClick={onClear}
      >
        Clear Dashboard
      </button>
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

// ── DashboardContent — main pipeline area ────────────────────────────────────
function DashboardContent() {
  const state = useAppState();
  const dispatch = useDispatch();
  const { currentStatus, currentLogs, activeLogFilter, currentProgress } = state;

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
    await window.electronAPI?.clearDashboard(state.currentDashboardId).catch(() => {});
  }

  return (
    <>
      <ProgressSection onOpenTimeline={() => setTimelineOpen(true)} />

      {hasTask ? (
        <>
          {taskType === 'Chains'
            ? <ChainPipeline status={currentStatus} onAgentClick={setSelectedAgent} />
            : <WavePipeline status={currentStatus} onAgentClick={setSelectedAgent} />
          }
          <ClearDashboardSection visible={showClear} onClear={handleClear} />
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
        return <ClaudeView />;
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
        <ProjectModal onClose={closeModal} />
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
    </>
  );
}
