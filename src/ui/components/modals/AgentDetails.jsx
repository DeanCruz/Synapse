// AgentDetails — Shows agent details: id, title, status, wave, layer, directory,
// summary, dependencies, meta grid, milestones, deviations, retry action, and activity log.

import React, { useRef, useEffect, useCallback } from 'react';
import Modal from './Modal.jsx';
import { STATUS_COLORS, STATUS_BG_COLORS, colorWithAlpha } from '../../utils/constants.js';
import { formatTime, calcDuration, formatElapsed } from '../../utils/format.js';
import { detectEnvironment } from '../../hooks/useElectronAPI.js';

function StatusBadge({ status }) {
  const label = (status || '').replace(/_/g, ' ');
  const baseColor = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span
      className="status-badge"
      style={{
        backgroundColor: STATUS_BG_COLORS[status] || STATUS_BG_COLORS.pending,
        color: baseColor,
        border: '1px solid ' + colorWithAlpha(baseColor, 0.3),
      }}
    >
      {label}
    </span>
  );
}

/**
 * Resolve the platform API for retry actions.
 */
function getPlatformAPI() {
  const env = detectEnvironment();
  if (env === 'electron' || env === 'webview') {
    return window.electronAPI || null;
  }
  return null;
}

/** Severity badge color mapping */
const SEVERITY_STYLES = {
  CRITICAL: { bg: 'rgba(241,76,76,0.15)', color: '#f14c4c', border: 'rgba(241,76,76,0.3)' },
  MODERATE: { bg: 'rgba(204,167,0,0.15)', color: '#cca700', border: 'rgba(204,167,0,0.3)' },
  MINOR:    { bg: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary, #888)', border: 'rgba(255,255,255,0.1)' },
};

export default function AgentDetails({ onClose, agent, progressData, findAgentFn, dashboardId }) {
  const logsBoxRef = useRef(null);
  const prevLogCountRef = useRef(0);

  // Auto-scroll logs on initial render and when new logs arrive
  useEffect(() => {
    const el = logsBoxRef.current;
    if (!el) return;
    const agentProg = progressData ? progressData[agent.id] : null;
    const logCount = agentProg && agentProg.logs ? agentProg.logs.length : 0;
    if (logCount !== prevLogCountRef.current) {
      prevLogCountRef.current = logCount;
      // Only auto-scroll if user is near the bottom (within 60px)
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      if (atBottom || logCount <= 5) {
        el.scrollTop = el.scrollHeight;
      }
    }
  });

  // Retry handler for this agent
  const handleRetry = useCallback(async () => {
    if (!dashboardId || !agent.id) return;
    const api = getPlatformAPI();
    if (!api) return;

    try {
      if (api.retryTask) {
        await api.retryTask({ dashboardId, taskId: agent.id });
      }
    } catch (_) {
      // Retry failure is non-fatal
    }
  }, [dashboardId, agent.id]);

  const agentProg = progressData ? progressData[agent.id] : null;

  // Merge lifecycle data from progress file into agent
  const merged = { ...agent, ...(agentProg || {}) };

  function metaItem(label, value) {
    if (!value) return null;
    return (
      <div key={label} className="task-details-meta-item">
        <span className="task-details-meta-label">{label}</span>
        <span className="task-details-meta-value">{value}</span>
      </div>
    );
  }

  const deps = agent.depends_on || [];

  let durationStr = null;
  if (merged.started_at && merged.completed_at) {
    durationStr = calcDuration(merged.started_at, merged.completed_at);
  } else if (merged.started_at) {
    durationStr = formatElapsed(merged.started_at) + ' (running)';
  }

  const isFailed = merged.status === 'failed';

  return (
    <Modal title="" onClose={onClose} className="agent-details-modal-wrapper">
      {/* Custom header layout matching original */}
      <div className="agent-details-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div className="agent-details-title-wrap">
          <span className="agent-details-id">{agent.id}</span>
          <span className="agent-details-name">{agent.title}</span>
        </div>
        {isFailed && (
          <button
            className="agent-details-retry-btn"
            onClick={handleRetry}
            title="Retry this failed task"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 0 1 10.2-4.3L14 2v4h-4l1.6-1.6A4.5 4.5 0 1 0 12.5 8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
            </svg>
            Retry
          </button>
        )}
      </div>

      <div className="task-details-body">
        {/* Badges row */}
        <div className="task-details-badges">
          <StatusBadge status={merged.status} />

          {agent.wave && (
            <span
              className="status-badge"
              style={{
                backgroundColor: 'rgba(102,126,234,0.1)',
                color: 'rgba(102,126,234,0.8)',
                border: '1px solid rgba(102,126,234,0.2)',
              }}
            >
              Wave {agent.wave}
            </span>
          )}

          {agent.layer && (
            <span
              className="status-badge"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {agent.layer}
            </span>
          )}

          {agent.directory && (
            <span
              className="status-badge"
              style={{
                backgroundColor: 'rgba(102,126,234,0.06)',
                color: 'rgba(102,126,234,0.7)',
                border: '1px solid rgba(102,126,234,0.15)',
              }}
            >
              {agent.directory}
            </span>
          )}

          {merged.assigned_agent && (
            <span
              className="status-badge"
              style={{
                backgroundColor: 'rgba(155,124,240,0.08)',
                color: 'rgba(155,124,240,0.8)',
                border: '1px solid rgba(155,124,240,0.2)',
              }}
            >
              {merged.assigned_agent}
            </span>
          )}
        </div>

        {/* Summary */}
        {merged.summary && (
          <p className="task-details-prompt">{merged.summary}</p>
        )}

        {/* Dependencies */}
        {deps.length > 0 && (
          <div className="agent-details-deps">
            <span className="agent-details-deps-label">Depends on</span>
            <div className="agent-details-deps-list">
              {deps.map(depId => {
                const depAgent = findAgentFn ? findAgentFn(depId) : null;
                return (
                  <span
                    key={depId}
                    className="agent-details-dep-chip"
                    style={depAgent ? {
                      borderColor: colorWithAlpha(
                        STATUS_COLORS[depAgent.status] || STATUS_COLORS.pending, 0.3
                      ),
                    } : undefined}
                  >
                    {depId}{depAgent ? ' \u2014 ' + depAgent.title : ''}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Meta grid */}
        {(merged.started_at || merged.completed_at || durationStr || merged.status) && (
          <div className="task-details-meta">
            {metaItem('Started', merged.started_at ? formatTime(merged.started_at) : null)}
            {metaItem('Completed', merged.completed_at ? formatTime(merged.completed_at) : null)}
            {metaItem('Duration', durationStr)}
            {metaItem('Status', merged.status ? merged.status.replace(/_/g, ' ') : null)}
          </div>
        )}

        {/* Milestones */}
        {agentProg && agentProg.milestones && agentProg.milestones.length > 0 && (
          <div className="agent-milestones">
            <span className="agent-milestones-label">Milestones</span>
            {agentProg.milestones.map((ms, i) => (
              <div key={i} className="agent-milestone-item">
                <span className="agent-milestone-time">{ms.at ? formatTime(ms.at) : ''}</span>
                <span className="agent-milestone-msg">{ms.msg || ''}</span>
              </div>
            ))}
          </div>
        )}

        {/* Deviations */}
        {agentProg && agentProg.deviations && agentProg.deviations.length > 0 && (
          <div className="agent-deviations">
            <span className="agent-deviations-label">Deviations from Plan ({agentProg.deviations.length})</span>
            {agentProg.deviations.map((dev, i) => {
              const severity = dev.severity || 'MODERATE';
              const sevStyle = SEVERITY_STYLES[severity] || SEVERITY_STYLES.MODERATE;
              return (
                <div key={i} className="agent-deviation-item">
                  <div className="agent-deviation-header">
                    {dev.at && (
                      <span className="agent-deviation-time">{formatTime(dev.at)}</span>
                    )}
                    <span
                      className="agent-deviation-severity"
                      style={{
                        backgroundColor: sevStyle.bg,
                        color: sevStyle.color,
                        border: '1px solid ' + sevStyle.border,
                      }}
                    >
                      {severity}
                    </span>
                  </div>
                  <span className="agent-deviation-desc">{dev.description || ''}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Activity log */}
        {agentProg && agentProg.logs && agentProg.logs.length > 0 && (
          <div className="agent-logs-section">
            <span className="agent-logs-label">Activity Log</span>
            <div className="agent-logs-box" ref={logsBoxRef}>
              {agentProg.logs.map((entry, i) => (
                <div key={i} className="agent-log-entry">
                  <span className="agent-log-time">
                    {entry.at ? formatTime(entry.at) : ''}
                  </span>
                  <span className={'agent-log-level agent-log-level-' + (entry.level || 'info')}>
                    {(entry.level || 'info').toUpperCase()}
                  </span>
                  <span className="agent-log-msg">{entry.msg || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
