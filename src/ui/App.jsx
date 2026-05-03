// App — Root PageRouter. Wires IPC, fetches initial data, mounts Header,
// renders ChatPage/CodePage shells (always mounted, CSS-hidden when inactive
// so IPC listeners stay alive), and manages root-level modals.

import React, { useEffect, useCallback } from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';
import { useDashboardData } from '@/hooks/useDashboardData.js';
import { initStatusColorsFromCSS } from '@/utils/constants.js';

import Header from '@/shared/Header.jsx';
import CommandsModal from '@/shared/modals/CommandsModal.jsx';
import ProjectModal from '@/shared/modals/ProjectModal.jsx';
import PlanningModal from '@/shared/modals/PlanningModal.jsx';
import SettingsModal from '@/shared/modals/SettingsModal.jsx';
import LogsModal from '@/shared/modals/LogsModal.jsx';
import ArchiveModal from '@/shared/modals/ArchiveModal.jsx';

import ChatPage from '@/pages/chat/ChatPage.jsx';
import CodePage from '@/pages/code/CodePage.jsx';

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

  const { activeModal, currentLogs, allDashboardLogs, currentDashboardId, appMode } = state;

  function closeModal() {
    dispatch({ type: 'CLOSE_MODAL' });
  }

  return (
    <>
      <Header />
      <div className="dashboard-layout">
        {/* Chat shell — always mounted; hidden via CSS when not in chat mode */}
        <div className={`app-shell-chat${appMode !== 'chat' ? ' hidden' : ''}`}>
          <ChatPage />
        </div>
        {/* Code shell — always mounted; hidden via CSS when in chat mode */}
        <div className={`app-shell-code${appMode === 'chat' ? ' hidden' : ''}`}>
          <CodePage />
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
      {activeModal === 'logs' && (
        <LogsModal
          onClose={closeModal}
          logs={allDashboardLogs[state.modalDashboardId || currentDashboardId] || currentLogs}
          dashboardId={state.modalDashboardId || currentDashboardId}
        />
      )}
      {activeModal === 'archive' && (
        <ArchiveModal onClose={closeModal} />
      )}
    </>
  );
}
