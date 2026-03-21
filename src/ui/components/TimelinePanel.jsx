// TimelinePanel — side panel showing a sorted timeline of task events
// Replaces TimelinePanelView.js

import React, { useEffect, useRef } from 'react';
import { TIMELINE_COLORS } from '@/utils/constants.js';
import { formatTime, calcDuration } from '@/utils/format.js';

/**
 * @param {object}   props.status  - merged status: { active_task, agents, history }
 * @param {boolean}  props.visible - whether the panel is visible/expanded
 * @param {Function} props.onClose - callback to close the panel
 */
export default function TimelinePanel({ status, visible, onClose }) {
  const bodyRef = useRef(null);

  const task    = (status && status.active_task) || null;
  const agents  = (status && status.agents)      || [];
  const history = (status && status.history)     || [];

  // Build sorted event list for current task
  const events = [];
  if (task) {
    if (task.started_at) {
      events.push({ time: task.started_at, status: 'task_start', label: 'Task started', title: task.name });
    }
    for (const a of agents) {
      if (a.started_at) {
        events.push({ time: a.started_at, status: 'in_progress', label: 'Agent started', title: a.title, id: a.id });
      }
      if (a.completed_at) {
        events.push({
          time: a.completed_at,
          status: a.status,
          label: a.status === 'failed' ? 'Agent failed' : 'Agent completed',
          title: a.title,
          id: a.id,
        });
      }
    }
    if (task.completed_at) {
      events.push({ time: task.completed_at, status: 'task_end', label: 'Task completed', title: task.name });
    }
    events.sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  // Auto-scroll to bottom when panel becomes visible or events change
  useEffect(() => {
    if (!visible || !bodyRef.current || events.length === 0) return;
    requestAnimationFrame(() => {
      if (bodyRef.current) {
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      }
    });
  }, [visible, events.length]);

  return (
    <div className={`timeline-panel${visible ? ' expanded' : ''}`}>
      <div className="timeline-panel-header">
        <span className="timeline-panel-title">Timeline</span>
        <button className="timeline-close" onClick={onClose} aria-label="Close timeline">
          &#10005;
        </button>
      </div>

      <div className="timeline-panel-body" ref={bodyRef}>
        {events.length > 0 && (
          <>
            <div className="timeline-section-label">Current Task</div>
            {events.map((event, idx) => (
              <TimelineEntry key={`${event.time}-${idx}`} event={event} />
            ))}
          </>
        )}

        {history.length > 0 && (
          <>
            <div className="timeline-divider" />
            <div className="timeline-section-label">History</div>
            {[...history].reverse().map((histTask, idx) => (
              <HistoryEntry key={idx} histTask={histTask} />
            ))}
          </>
        )}

        {events.length === 0 && history.length === 0 && (
          <div
            className="timeline-section-label"
            style={{ textAlign: 'center', marginLeft: '0', padding: '24px 0' }}
          >
            No events yet.
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineEntry({ event }) {
  const dotColor = TIMELINE_COLORS[event.status] || TIMELINE_COLORS.pending;
  return (
    <div className="timeline-entry">
      <span className="timeline-dot" style={{ backgroundColor: dotColor }} />
      <div className="timeline-content">
        <span className="timeline-time">{formatTime(event.time)}</span>
        <span className="timeline-event">{event.label}</span>
        {event.title && (
          <span className="timeline-agent-title">
            {event.id ? `[${event.id}] ` : ''}{event.title}
          </span>
        )}
      </div>
    </div>
  );
}

function HistoryEntry({ histTask }) {
  const color = histTask.overall_status === 'completed'
    ? '#34d399'
    : histTask.overall_status === 'failed'
      ? '#ef4444'
      : '#6E6E73';

  const meta = histTask.started_at && histTask.completed_at
    ? calcDuration(histTask.started_at, histTask.completed_at)
    : histTask.overall_status;

  return (
    <div className="timeline-history-entry">
      <span className="timeline-dot" style={{ backgroundColor: color }} />
      <span className="timeline-history-name">{histTask.name}</span>
      <span className="timeline-history-meta">{meta}</span>
    </div>
  );
}
