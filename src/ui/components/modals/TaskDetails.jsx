// TaskDetails — Shows task metadata: name, status, type, project, directory, prompt, meta grid
// Mirrors TaskDetailsModal.js with React hooks and JSX.

import React from 'react';
import Modal from './Modal.jsx';
import { STATUS_COLORS, STATUS_BG_COLORS, colorWithAlpha } from '../../utils/constants.js';
import { formatTime } from '../../utils/format.js';

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

export default function TaskDetails({ onClose, task }) {
  function metaItem(label, value) {
    if (value == null || value === '') return null;
    return (
      <div key={label} className="task-details-meta-item">
        <span className="task-details-meta-label">{label}</span>
        <span className="task-details-meta-value">{value}</span>
      </div>
    );
  }

  const hasBadges = task.overall_status || task.type || task.project || task.directory;

  return (
    <Modal title="" onClose={onClose} className="task-details-modal-wrapper">
      {/* Custom header */}
      <div className="task-details-header" style={{ marginBottom: '12px' }}>
        <span className="task-details-name">{task.name}</span>
      </div>

      <div className="task-details-body">
        {/* Badges */}
        {hasBadges && (
          <div className="task-details-badges">
            {task.overall_status && <StatusBadge status={task.overall_status} />}

            {task.type && (
              <span
                className="status-badge"
                style={{
                  backgroundColor: 'rgba(102,126,234,0.1)',
                  color: 'rgba(102,126,234,0.8)',
                  border: '1px solid rgba(102,126,234,0.2)',
                }}
              >
                {task.type}
              </span>
            )}

            {task.project && (
              <span
                className="status-badge"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {task.project}
              </span>
            )}

            {task.directory && (
              <span
                className="status-badge"
                style={{
                  backgroundColor: 'rgba(102,126,234,0.06)',
                  color: 'rgba(102,126,234,0.7)',
                  border: '1px solid rgba(102,126,234,0.15)',
                }}
              >
                {task.directory}
              </span>
            )}
          </div>
        )}

        {/* Prompt */}
        {task.prompt && (
          <p className="task-details-prompt">{task.prompt}</p>
        )}

        {/* Meta grid */}
        <div className="task-details-meta">
          {metaItem('Created', task.created ? formatTime(task.created) : null)}
          {metaItem('Started', task.started_at ? formatTime(task.started_at) : null)}
          {metaItem('Completed', task.completed_at ? formatTime(task.completed_at) : null)}
          {metaItem('Total Tasks', task.total_tasks != null ? String(task.total_tasks) : null)}
          {metaItem('Completed Tasks', task.completed_tasks != null ? String(task.completed_tasks) : null)}
          {metaItem('Failed Tasks', task.failed_tasks != null ? String(task.failed_tasks) : null)}
          {metaItem('Waves', task.total_waves != null ? String(task.total_waves) : null)}
        </div>
      </div>
    </Modal>
  );
}
