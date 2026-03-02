// HomeView — Renders the home/overview meta-dashboard
// ES module. Shows active dashboards, inactive dashboards, recent archives,
// and recent history.

import { el } from '../utils/dom.js';
import { DASHBOARD_LABELS } from '../utils/constants.js';

/**
 * Render the home overview into the given container.
 *
 * @param {HTMLElement} container — the #home-view element
 * @param {object} data — response from GET /api/overview
 * @param {object} callbacks
 * @param {function} callbacks.onDashboardClick — callback(dashboardId)
 * @param {function} callbacks.onArchiveClick — callback(archiveName)
 */
export function renderHomeView(container, data, callbacks) {
  container.textContent = '';

  var dashboards = data.dashboards || [];
  var archives = data.archives || [];
  var history = data.history || [];

  // Partition dashboards into active vs inactive
  var activeDashboards = [];
  var inactiveDashboards = [];
  for (var i = 0; i < dashboards.length; i++) {
    if (dashboards[i].status !== 'idle') {
      activeDashboards.push(dashboards[i]);
    } else {
      inactiveDashboards.push(dashboards[i]);
    }
  }

  // --- Section 1: Active Dashboards ---
  var activeSection = createSection('Active Dashboards', activeDashboards.length === 0 ? 'No active dashboards' : null);
  for (var a = 0; a < activeDashboards.length; a++) {
    activeSection.body.appendChild(createDashboardCard(activeDashboards[a], callbacks.onDashboardClick));
  }
  container.appendChild(activeSection.section);

  // --- Section 2: Inactive Dashboards ---
  var inactiveSection = createSection('Inactive Dashboards', inactiveDashboards.length === 0 ? 'All dashboards are active' : null);
  for (var b = 0; b < inactiveDashboards.length; b++) {
    inactiveSection.body.appendChild(createIdleItem(inactiveDashboards[b], callbacks.onDashboardClick));
  }
  container.appendChild(inactiveSection.section);

  // --- Section 3: Recently Archived ---
  var archiveSection = createSection('Recently Archived', archives.length === 0 ? 'No archived tasks' : null);
  for (var c = 0; c < archives.length; c++) {
    archiveSection.body.appendChild(createArchiveEntry(archives[c], callbacks.onArchiveClick));
  }
  container.appendChild(archiveSection.section);

  // --- Section 4: Recent History ---
  var historySection = createSection('Recent History', history.length === 0 ? 'No completed tasks in history' : null);
  for (var d = 0; d < history.length; d++) {
    historySection.body.appendChild(createHistoryEntry(history[d]));
  }
  container.appendChild(historySection.section);

}

// --- Helpers ---

function createSection(title, emptyMessage) {
  var section = el('div', { className: 'home-section' });
  var header = el('div', { className: 'home-section-header' });
  header.appendChild(el('span', { className: 'home-section-title', text: title }));
  section.appendChild(header);

  var body = el('div', { className: 'home-section-body' });
  if (emptyMessage) {
    body.appendChild(el('div', { className: 'home-empty', text: emptyMessage }));
  }
  section.appendChild(body);

  return { section: section, body: body };
}

function createDashboardCard(dashboard, onClick) {
  var card = el('div', { className: 'home-dashboard-card' });

  // Status dot
  var dotClass = dashboard.status === 'in_progress' ? 'in-progress'
    : dashboard.status === 'completed' ? 'completed'
    : dashboard.status === 'error' ? 'error'
    : 'idle';
  var dot = el('span', { className: 'home-card-dot ' + dotClass });
  card.appendChild(dot);

  var content = el('div', { className: 'home-card-content' });

  // Dashboard label
  var label = DASHBOARD_LABELS[dashboard.id] || dashboard.id;
  content.appendChild(el('div', { className: 'home-card-label', text: label }));

  if (dashboard.task) {
    var task = dashboard.task;

    // Task name
    content.appendChild(el('div', { className: 'home-card-task-name', text: task.name }));

    // Metadata row
    var meta = el('div', { className: 'home-card-meta' });

    if (task.type) {
      meta.appendChild(el('span', {
        className: 'home-card-badge',
        text: task.type,
        style: { backgroundColor: 'rgba(102,126,234,0.1)', color: 'rgba(102,126,234,0.8)' },
      }));
    }

    if (task.directory) {
      meta.appendChild(el('span', {
        className: 'home-card-badge',
        text: task.directory,
        style: { backgroundColor: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' },
      }));
    }

    // Progress
    var completedCount = (task.completed_tasks || 0) + (task.failed_tasks || 0);
    var totalCount = task.total_tasks || 0;
    meta.appendChild(el('span', {
      className: 'home-card-badge',
      text: completedCount + '/' + totalCount + ' tasks',
      style: { backgroundColor: 'rgba(155,124,240,0.1)', color: '#9b7cf0' },
    }));

    content.appendChild(meta);

    // Progress bar
    if (totalCount > 0) {
      var progressTrack = el('div', { className: 'home-card-progress-track' });
      var progressFill = el('div', { className: 'home-card-progress-fill' });
      var pct = Math.round((task.completed_tasks || 0) / totalCount * 100);
      progressFill.style.width = pct + '%';
      if (task.failed_tasks > 0) {
        progressFill.classList.add('has-errors');
      }
      progressTrack.appendChild(progressFill);
      content.appendChild(progressTrack);
    }
  }

  card.appendChild(content);

  // Status label on right
  var statusLabel = dashboard.status === 'in_progress' ? 'In Progress'
    : dashboard.status === 'completed' ? 'Completed'
    : dashboard.status === 'error' ? 'Errors'
    : 'Idle';
  var statusEl = el('span', { className: 'home-card-status ' + dotClass, text: statusLabel });
  card.appendChild(statusEl);

  card.addEventListener('click', function () {
    if (onClick) onClick(dashboard.id);
  });

  return card;
}

function createIdleItem(dashboard, onClick) {
  var item = el('div', { className: 'home-idle-item' });

  var dot = el('span', { className: 'home-card-dot idle' });
  item.appendChild(dot);

  var label = DASHBOARD_LABELS[dashboard.id] || dashboard.id;
  item.appendChild(el('span', { className: 'home-idle-label', text: label }));
  item.appendChild(el('span', { className: 'home-idle-status', text: 'Available' }));

  item.addEventListener('click', function () {
    if (onClick) onClick(dashboard.id);
  });

  return item;
}

function createArchiveEntry(archive, onClick) {
  var entry = el('div', { className: 'history-entry home-clickable' });

  var dotColor = '#34d399';
  entry.appendChild(el('span', { className: 'history-entry-dot', style: { backgroundColor: dotColor } }));

  var content = el('div', { className: 'history-entry-content' });
  var taskName = archive.task ? archive.task.name : archive.name;
  content.appendChild(el('div', { className: 'history-entry-name', text: taskName }));

  var meta = el('div', { className: 'history-entry-meta' });
  if (archive.task && archive.task.type) {
    meta.appendChild(el('span', {
      className: 'history-entry-badge',
      text: archive.task.type,
      style: { backgroundColor: 'rgba(102,126,234,0.1)', color: 'rgba(102,126,234,0.8)' },
    }));
  }
  meta.appendChild(el('span', {
    className: 'history-entry-badge',
    text: archive.agentCount + ' agents',
    style: { backgroundColor: 'rgba(155,124,240,0.1)', color: '#9b7cf0' },
  }));
  var dateStr = archive.name.slice(0, 10);
  meta.appendChild(el('span', { className: 'history-entry-date', text: dateStr }));
  content.appendChild(meta);
  entry.appendChild(content);

  entry.addEventListener('click', function () {
    if (onClick) onClick(archive.name);
  });

  return entry;
}

function createHistoryEntry(item) {
  var entry = el('div', { className: 'history-entry' });

  var dotColor = item.overall_status === 'completed' ? '#34d399'
    : item.overall_status === 'completed_with_errors' ? '#f97316'
    : item.failed_tasks > 0 ? '#ef4444'
    : '#34d399';
  entry.appendChild(el('span', { className: 'history-entry-dot', style: { backgroundColor: dotColor } }));

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

  var statsText = (item.completed_tasks || 0) + '/' + (item.total_tasks || 0);
  if (item.failed_tasks > 0) statsText += ' (' + item.failed_tasks + ' failed)';
  meta.appendChild(el('span', {
    className: 'history-entry-badge',
    text: statsText,
    style: { backgroundColor: 'rgba(155,124,240,0.1)', color: '#9b7cf0' },
  }));

  if (item.duration) {
    meta.appendChild(el('span', {
      className: 'history-entry-badge',
      text: item.duration,
      style: { backgroundColor: 'rgba(52,211,153,0.08)', color: '#34d399' },
    }));
  }

  if (item.cleared_at) {
    meta.appendChild(el('span', { className: 'history-entry-date', text: item.cleared_at.slice(0, 10) }));
  }

  content.appendChild(meta);
  entry.appendChild(content);

  return entry;
}

