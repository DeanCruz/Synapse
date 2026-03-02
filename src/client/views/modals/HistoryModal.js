// HistoryModal — Renders list of past swarms with status dots, badges, dates
// ES module. Uses createModalPopup factory from ModalFactory.js.

import { el } from '../../utils/dom.js';
import { createModalPopup } from './ModalFactory.js';

/**
 * Show the history popup modal with a list of past swarm records.
 * @param {Array} history — array of history items, each with: task_name, overall_status, task_type, project, completed_tasks, total_tasks, failed_tasks, duration, cleared_at
 */
export function showHistoryPopup(history) {
  var popup = createModalPopup('history-overlay', 'Task History');
  var body = popup.body;

  if (history.length === 0) {
    body.appendChild(el('div', { className: 'history-empty', text: 'No completed tasks in history' }));
  } else {
    for (var i = 0; i < history.length; i++) {
      (function (item) {
        var entry = el('div', { className: 'history-entry' });

        // Status color dot
        var dotColor = item.overall_status === 'completed' ? '#34d399'
          : item.overall_status === 'completed_with_errors' ? '#f97316'
          : item.failed_tasks > 0 ? '#ef4444'
          : '#34d399';
        var dot = el('span', { className: 'history-entry-dot', style: { backgroundColor: dotColor } });
        entry.appendChild(dot);

        var content = el('div', { className: 'history-entry-content' });
        content.appendChild(el('div', { className: 'history-entry-name', text: item.task_name || 'unnamed' }));

        var meta = el('div', { className: 'history-entry-meta' });

        if (item.task_type) {
          meta.appendChild(el('span', {
            className: 'history-entry-badge',
            text: item.task_type,
            style: { backgroundColor: 'rgba(102,126,234,0.1)', color: 'rgba(102,126,234,0.8)' },
          }));
        }

        if (item.project) {
          meta.appendChild(el('span', {
            className: 'history-entry-badge',
            text: item.project,
            style: { backgroundColor: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.08)' },
          }));
        }

        // Agent stats
        var statsText = item.completed_tasks + '/' + item.total_tasks;
        if (item.failed_tasks > 0) statsText += ' (' + item.failed_tasks + ' failed)';
        meta.appendChild(el('span', {
          className: 'history-entry-badge',
          text: statsText,
          style: { backgroundColor: 'rgba(155,124,240,0.1)', color: '#9b7cf0' },
        }));

        // Duration
        if (item.duration) {
          meta.appendChild(el('span', {
            className: 'history-entry-badge',
            text: item.duration,
            style: { backgroundColor: 'rgba(52,211,153,0.08)', color: '#34d399' },
          }));
        }

        // Date
        if (item.cleared_at) {
          var dateStr = item.cleared_at.slice(0, 10);
          meta.appendChild(el('span', { className: 'history-entry-date', text: dateStr }));
        }

        content.appendChild(meta);
        entry.appendChild(content);

        body.appendChild(entry);
      })(history[i]);
    }
  }

  document.body.appendChild(popup.overlay);
}
