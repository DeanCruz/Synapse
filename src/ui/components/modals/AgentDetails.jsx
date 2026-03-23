// AgentDetails — Shows agent details: id, title, status, wave, layer, directory,
// summary, dependencies, meta grid, milestones, deviations, and activity log.

import React, { useRef, useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { STATUS_COLORS, STATUS_BG_COLORS, colorWithAlpha } from '../../utils/constants.js';
import { formatTime, calcDuration, formatElapsed } from '../../utils/format.js';

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

export default function AgentDetails({ onClose, agent, progressData, findAgentFn }) {
  const logsBoxRef = useRef(null);

  useEffect(() => {
    if (logsBoxRef.current) {
      logsBoxRef.current.scrollTop = logsBoxRef.current.scrollHeight;
    }
  }, []);

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

  // Live-updating duration for in-progress tasks
  const isRunning = merged.started_at && !merged.completed_at;
  const [elapsed, setElapsed] = useState(() =>
    isRunning ? formatElapsed(merged.started_at) : null
  );

  useEffect(() => {
    if (!isRunning) return;
    setElapsed(formatElapsed(merged.started_at));
    const id = setInterval(() => setElapsed(formatElapsed(merged.started_at)), 1000);
    return () => clearInterval(id);
  }, [isRunning, merged.started_at]);

  let durationStr = null;
  if (merged.started_at && merged.completed_at) {
    durationStr = calcDuration(merged.started_at, merged.completed_at);
  } else if (isRunning) {
    durationStr = (elapsed || formatElapsed(merged.started_at)) + ' (running)';
  }

  return (
    <Modal title="" onClose={onClose} className="agent-details-modal-wrapper">
      {/* Custom header layout matching original */}
      <div className="agent-details-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div className="agent-details-title-wrap">
          <span className="agent-details-id">{agent.id}</span>
          <span className="agent-details-name">{agent.title}</span>
        </div>
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

        {/* Live progress (stage + message) */}
        {merged.status === 'in_progress' && (merged.stage || merged.message) && (
          <div className="agent-details-progress">
            {merged.stage && (
              <span className="agent-details-stage">
                {merged.stage.replace(/_/g, ' ')}
              </span>
            )}
            {merged.message && (
              <p className="agent-details-message">{merged.message}</p>
            )}
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
            <span className="agent-deviations-label">⚠ Deviations from Plan</span>
            {agentProg.deviations.map((dev, i) => (
              <div key={i} className="agent-deviation-item">
                {dev.at && (
                  <span className="agent-deviation-time">{formatTime(dev.at)}</span>
                )}
                {dev.description || ''}
              </div>
            ))}
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
