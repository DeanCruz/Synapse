// CodePage — Code shell. Owns CodeSidebar + content area + floating Claude panel.
// Extracted from App.jsx (formerly inlined inside the app-shell-code div).

import React from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';

import CodeSidebar from '@/pages/code/components/CodeSidebar.jsx';
import ClaudeFloatingPanel from '@/shared/claude/ClaudeFloatingPanel.jsx';

import SwarmBuilder from '@/pages/code/subpages/dashboards/components/SwarmBuilder.jsx';
import DashboardsPage from '@/pages/code/subpages/dashboards/DashboardsPage.jsx';
import CodeExplorerPage from '@/pages/code/subpages/code-explorer/CodeExplorerPage.jsx';
import GitPage from '@/pages/code/subpages/git/GitPage.jsx';
import PreviewPage from '@/pages/code/subpages/preview/PreviewPage.jsx';

export default function CodePage() {
  const state = useAppState();
  const dispatch = useDispatch();

  const {
    activeView,
    currentDashboardId,
  } = state;

  const claudeViewMode = state.claudeViewMode;
  const claudeDashboardId = state.claudeDashboardId || currentDashboardId;
  const showClaudeFloat = activeView === 'claude';
  const ideChatActive = activeView === 'ide' && state.ideChatOpen;

  function renderMainContent() {
    switch (activeView) {
      case 'swarmBuilder':
        return (
          <SwarmBuilder
            dashboardId={currentDashboardId}
            onCancel={() => dispatch({ type: 'SET_VIEW', view: 'dashboard' })}
          />
        );
      case 'claude':
        // Claude is now a floating panel — show the dashboard behind it
        return <DashboardsPage />;
      case 'git':
        return GitPage ? <GitPage /> : <div>Loading Git Manager...</div>;
      case 'preview':
        return PreviewPage ? <PreviewPage /> : <div>Loading Preview...</div>;
      case 'ide':
        return <CodeExplorerPage />;
      case 'dashboard':
      default:
        return <DashboardsPage />;
    }
  }

  return (
    <>
      <CodeSidebar />
      <div className="dashboard-content">
        {renderMainContent()}
      </div>
      {/* Floating Claude chat panel — always mounted so IPC listeners stay alive */}
      <ClaudeFloatingPanel
        isVisible={activeView !== 'git' && activeView !== 'preview'}
        dashboardId={claudeDashboardId}
        viewMode={ideChatActive ? claudeViewMode : (showClaudeFloat ? claudeViewMode : 'minimized')}
        onOpen={() => {
          if (activeView === 'ide') {
            dispatch({ type: 'IDE_OPEN_CHAT' });
          } else {
            dispatch({ type: 'CLAUDE_SET_VIEW_MODE', mode: 'expanded' });
            dispatch({ type: 'SET_VIEW', view: 'claude', dashboardId: claudeDashboardId || currentDashboardId });
          }
        }}
        onSetMode={(mode) => {
          dispatch({ type: 'CLAUDE_SET_VIEW_MODE', mode });
          if (mode === 'minimized') {
            if (activeView === 'ide') {
              dispatch({ type: 'IDE_CLOSE_CHAT' });
            } else {
              dispatch({ type: 'SET_VIEW', view: 'dashboard' });
            }
          }
        }}
      />
    </>
  );
}
