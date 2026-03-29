// AgentCard — Agent card component
// Mirrors the DOM structure produced by AgentCardView.js createAgentCard().

import React, { useState, useEffect, useRef } from 'react';
import { STATUS_COLORS, STATUS_BG_COLORS, colorWithAlpha } from '@/utils/constants.js';
import { formatElapsed, calcDuration } from '@/utils/format.js';

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

export function StatusBadge({ status }) {
  const label = status.replace(/_/g, ' ');
  const baseColor = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const bg = STATUS_BG_COLORS[status] || STATUS_BG_COLORS.pending;
  const border = colorWithAlpha(baseColor, 0.3);

  return (
    <span
      className="status-badge"
      style={{
        backgroundColor: bg,
        color: baseColor,
        border: `1px solid ${border}`,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ElapsedTimer — live-updating elapsed display for in_progress agents
// ---------------------------------------------------------------------------

function ElapsedTimer({ startedAt }) {
  const [text, setText] = useState(() =>
    startedAt ? formatElapsed(startedAt) : '...'
  );

  useEffect(() => {
    if (!startedAt) return;
    setText(formatElapsed(startedAt));
    const id = setInterval(() => setText(formatElapsed(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span className="agent-elapsed" data-started={startedAt || ''}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AgentCard
// ---------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {object} props.agent — { id, title, wave, status, layer, directory,
 *   assigned_agent, started_at, completed_at, summary, stage, message,
 *   milestones, deviations, depends_on }
 * @param {function} props.onClick — called with the agent object when clicked
 */
export default function AgentCard({ agent, onClick }) {
  const {
    id,
    title,
    status = 'pending',
    layer,
    directory,
    assigned_agent,
    started_at,
    completed_at,
    summary,
    stage,
    message,
    deviations,
    files_changed,
  } = agent;

  const dotColor = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const bgColor = STATUS_BG_COLORS[status] || STATUS_BG_COLORS.pending;
  const borderColor = STATUS_COLORS[status] || STATUS_COLORS.pending;

  function handleClick(e) {
    if (window.getSelection && window.getSelection().toString()) return;
    if (onClick) onClick(agent);
  }

  // ---- Bottom row content — status-dependent ----
  let bottomContent = null;

  if (status === 'completed') {
    bottomContent = (
      <>
        {summary && <span className="agent-summary">{summary}</span>}
        {started_at && completed_at && (
          <span className="agent-duration">
            {calcDuration(started_at, completed_at)}
          </span>
        )}
      </>
    );
  } else if (status === 'in_progress') {
    bottomContent = (
      <>
        <div className="agent-card-stage-row">
          {stage && (
            <span className="agent-stage" data-stage={stage}>
              {stage.replace(/_/g, ' ')}
            </span>
          )}
          <ElapsedTimer startedAt={started_at} />
        </div>
        {message && <span className="agent-milestone">{message}</span>}
      </>
    );
  } else if (status === 'failed') {
    bottomContent = (
      <span className="agent-fail-text">{summary || 'Failed'}</span>
    );
  } else {
    bottomContent = <span className="agent-waiting">Waiting...</span>;
  }

  const deviationCount = Array.isArray(deviations) ? deviations.length : 0;

  return (
    <div
      className="agent-card"
      data-status={status}
      data-agent-id={id}
      style={{
        borderLeft: `3px solid ${borderColor}`,
        backgroundColor: bgColor,
        cursor: 'pointer',
      }}
      onClick={handleClick}
    >
      {/* Top row: ID badge + status dot + title */}
      <div className="agent-card-top">
        <span className="agent-id">{id}</span>
        <span
          className="status-dot"
          style={{ backgroundColor: dotColor }}
        />
        <span className="agent-title">{title}</span>
      </div>

      {/* Meta row: layer badge + directory badge + agent assignment */}
      <div className="agent-card-meta">
        {layer && <span className="layer-badge">{layer}</span>}
        {directory && <span className="directory-badge">{directory}</span>}
        {assigned_agent && (
          <span className="agent-label">{assigned_agent}</span>
        )}
      </div>

      {/* Bottom row: status-dependent content */}
      <div className="agent-card-bottom">{bottomContent}</div>

      {/* Deviation badge */}
      {deviationCount > 0 && (
        <div className="agent-card-meta" style={{ marginTop: '6px' }}>
          <span className="deviation-badge">
            ⚠ {deviationCount} deviation{deviationCount > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Files changed badge */}
      {status === 'completed' && Array.isArray(files_changed) && files_changed.length > 0 && (
        <div className="agent-card-meta" style={{ marginTop: '4px' }}>
          <span className="files-changed-badge">
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-9.5A1.75 1.75 0 012 14.25Zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 00.25-.25V6h-2.75A1.75 1.75 0 019 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/>
            </svg>
            {files_changed.length} file{files_changed.length !== 1 ? 's' : ''} changed
          </span>
        </div>
      )}
    </div>
  );
}
