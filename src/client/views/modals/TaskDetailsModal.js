// TaskDetailsModal — Shows task details in a modal popup
// ES module. Displays task name, status, type, project, directory badges, prompt text, meta grid.

import { el, colorWithAlpha } from '../../utils/dom.js';
import { formatTime } from '../../utils/format.js';
import { STATUS_COLORS, STATUS_BG_COLORS } from '../../utils/constants.js';

/**
 * Create a status badge element for the given status string.
 * @param {string} status
 * @returns {HTMLElement}
 */
function createStatusBadge(status) {
  var label = status.replace(/_/g, ' ');
  var baseColor = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return el('span', {
    className: 'status-badge',
    text: label,
    style: {
      backgroundColor: STATUS_BG_COLORS[status] || STATUS_BG_COLORS.pending,
      color: baseColor,
      border: '1px solid ' + baseColor,
      borderColor: colorWithAlpha(baseColor, 0.3),
    },
  });
}

/** @type {function|null} Escape key handler reference for cleanup */
var _onEsc = null;

/**
 * Show the task details modal popup.
 * @param {object} task — task object with name, overall_status, type, project, directory, prompt, created, started_at, completed_at, total_tasks, completed_tasks, failed_tasks, total_waves
 */
export function showTaskDetails(task) {
  hideTaskDetails();

  var overlay = el('div', { className: 'task-details-overlay', attrs: { id: 'task-details-overlay' } });
  var modal = el('div', { className: 'task-details-modal' });

  // Header — name + close
  var hdr = el('div', { className: 'task-details-header' });
  var nameEl = el('span', { className: 'task-details-name', text: task.name });
  var closeBtn = el('button', { className: 'task-details-close', text: '\u2715' });
  closeBtn.addEventListener('click', hideTaskDetails);
  hdr.appendChild(nameEl);
  hdr.appendChild(closeBtn);
  modal.appendChild(hdr);

  // Body
  var body = el('div', { className: 'task-details-body' });

  // Status + project badges
  var badges = el('div', { className: 'task-details-badges' });
  if (task.overall_status) {
    badges.appendChild(createStatusBadge(task.overall_status));
  }
  if (task.type) {
    var typeBadge = el('span', {
      className: 'status-badge',
      text: task.type,
      style: {
        backgroundColor: 'rgba(102,126,234,0.1)',
        color: 'rgba(102,126,234,0.8)',
        border: '1px solid rgba(102,126,234,0.2)',
      },
    });
    badges.appendChild(typeBadge);
  }
  if (task.project) {
    var proj = el('span', {
      className: 'status-badge',
      text: task.project,
      style: {
        backgroundColor: 'rgba(255,255,255,0.04)',
        color: 'var(--text-secondary)',
        border: '1px solid rgba(255,255,255,0.08)',
      },
    });
    badges.appendChild(proj);
  }
  if (task.directory) {
    var dirBadge = el('span', {
      className: 'status-badge',
      text: task.directory,
      style: {
        backgroundColor: 'rgba(102,126,234,0.06)',
        color: 'rgba(102,126,234,0.7)',
        border: '1px solid rgba(102,126,234,0.15)',
      },
    });
    badges.appendChild(dirBadge);
  }
  if (badges.children.length) body.appendChild(badges);

  // Prompt
  if (task.prompt) {
    var prompt = el('p', { className: 'task-details-prompt', text: task.prompt });
    body.appendChild(prompt);
  }

  // Meta grid
  var meta = el('div', { className: 'task-details-meta' });
  function metaItem(label, value) {
    if (!value) return;
    var item = el('div', { className: 'task-details-meta-item' });
    var lbl = el('span', { className: 'task-details-meta-label', text: label });
    var val = el('span', { className: 'task-details-meta-value', text: value });
    item.appendChild(lbl);
    item.appendChild(val);
    meta.appendChild(item);
  }
  metaItem('Created', task.created ? formatTime(task.created) : null);
  metaItem('Started', task.started_at ? formatTime(task.started_at) : null);
  metaItem('Completed', task.completed_at ? formatTime(task.completed_at) : null);
  metaItem('Total Tasks', task.total_tasks != null ? String(task.total_tasks) : null);
  metaItem('Completed Tasks', task.completed_tasks != null ? String(task.completed_tasks) : null);
  metaItem('Failed Tasks', task.failed_tasks != null ? String(task.failed_tasks) : null);
  metaItem('Waves', task.total_waves != null ? String(task.total_waves) : null);
  if (meta.children.length) body.appendChild(meta);

  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hideTaskDetails();
  });

  _onEsc = function (e) {
    if (e.key === 'Escape') hideTaskDetails();
  };
  document.addEventListener('keydown', _onEsc);
}

/**
 * Hide the task details modal and clean up the Escape listener.
 */
export function hideTaskDetails() {
  var existing = document.getElementById('task-details-overlay');
  if (existing) existing.remove();
  if (_onEsc) {
    document.removeEventListener('keydown', _onEsc);
    _onEsc = null;
  }
}
