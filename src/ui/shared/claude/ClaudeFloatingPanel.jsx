// ClaudeFloatingPanel — Floating Claude/Codex chat panel mounted in the Code shell.
// Always mounted so IPC listeners stay alive during background runs;
// shows as a minimized pill when chat is not actively open.

import React, { useState, useEffect } from 'react';
import { useAppState } from '@/context/AppContext.jsx';
import { useResize } from '@/hooks/useResize.js';
import { getDashboardProject } from '@/utils/dashboardProjects.js';
import ClaudeView from './ClaudeView.jsx';

// ── useAgentProviderLabel — reads agentProvider from settings + listens for changes ──
export function useAgentProviderLabel() {
  const [provider, setProvider] = useState('claude');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    function syncProvider(settings) {
      setProvider(settings?.agentProvider || 'claude');
    }

    api.getSettings().then(syncProvider).catch(() => {});
    const removeSettingsListener = api.on('settings-changed', (payload) => {
      syncProvider(payload?.settings || null);
    });

    return () => {
      removeSettingsListener();
    };
  }, []);

  return provider === 'codex' ? 'Codex' : 'Claude';
}

// ── ClaudeFloatingPanel — wraps ClaudeView in a floating container ──────────
// Always mounted so IPC listeners stay alive during background runs.
// Shows as a minimized pill when chat is not actively open.
export default function ClaudeFloatingPanel({ isVisible, dashboardId, viewMode, onOpen, onSetMode }) {
  const floatRef = React.useRef(null);
  const prevMode = React.useRef(viewMode);
  const dragRef = React.useRef(null);
  const handleRef = React.useRef(null);
  const providerLabel = useAgentProviderLabel();
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
          <span>{providerLabel}</span>
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
        <ClaudeView hideHeader viewMode={viewMode} tab="code" surface="code" />
      </div>
    </div>
  );
}

// ── Floating header with window controls ────────────────────────────────────
function ClaudeFloatingHeader({ dashboardId, viewMode, onSetMode }) {
  const state = useAppState();
  const projectPath = getDashboardProject(dashboardId);
  const projectName = projectPath ? projectPath.replace(/\/+$/, '').split('/').pop() : null;
  const dashboardLabel = dashboardId ? dashboardId.replace('dashboard', 'Dashboard ') : '';

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
      {dashboardId && <span className="claude-view-dashboard-id">{dashboardId}</span>}

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
