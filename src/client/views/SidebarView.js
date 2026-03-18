// SidebarView — dashboard sidebar rendering
// ES module. Accepts DOM element references as parameters.

import { DEFAULT_DASHBOARDS, DASHBOARD_LABELS } from '../utils/constants.js';

/**
 * Render the sidebar dashboard list with status dots.
 *
 * @param {HTMLElement} listEl — the #dashboard-list container element
 * @param {object} options
 * @param {string} options.currentDashboardId — the currently active dashboard ID
 * @param {boolean} options.archiveViewActive — whether an archived task is being viewed
 * @param {boolean} options.queueViewActive — whether a queued task is being viewed
 * @param {object} options.dashboardStates — map of dashboardId → state string ('idle'|'in_progress'|'completed'|'error')
 * @param {number} options.queueCount — number of items in the queue
 * @param {object} options.dashboardProjects — map of dashboardId → project path string (for project indicator)
 * @param {boolean} options.isElectron — whether running in Electron (controls action button visibility)
 * @param {Function} options.onSwitch — callback(dashboardId) when a dashboard item is clicked
 * @param {Function} options.onExitArchive — callback() when the archive exit button is clicked
 * @param {Function} options.onExitQueue — callback() when the queue exit button is clicked
 * @param {Function} options.onProjectClick — callback(dashboardId) when Project button is clicked
 * @param {Function} options.onClaudeClick — callback(dashboardId) when Claude button is clicked
 */
export function renderSidebar(listEl, options) {
  if (!listEl) return;
  listEl.textContent = '';

  var currentDashboardId = options.currentDashboardId;
  var archiveViewActive  = options.archiveViewActive;
  var queueViewActive    = options.queueViewActive;
  var dashboardStates    = options.dashboardStates;
  var dashboardProjects  = options.dashboardProjects || {};
  var isElectron         = options.isElectron || false;
  var queueCount         = options.queueCount || 0;
  var onSwitch           = options.onSwitch;
  var onExitArchive      = options.onExitArchive;
  var onExitQueue        = options.onExitQueue;
  var onProjectClick     = options.onProjectClick;
  var onClaudeClick      = options.onClaudeClick;

  for (var i = 0; i < DEFAULT_DASHBOARDS.length; i++) {
    var dbId = DEFAULT_DASHBOARDS[i];
    var isActive = !archiveViewActive && !queueViewActive && dbId === currentDashboardId;
    var item = document.createElement('div');
    item.className = 'dashboard-item' + (isActive ? ' active' : '');
    item.setAttribute('data-id', dbId);

    var statusDot = document.createElement('span');
    var dotState = dashboardStates[dbId] || 'idle';
    var dotClass = dotState === 'in_progress' ? 'in-progress'
      : dotState === 'completed' ? 'completed'
      : dotState === 'error' ? 'error'
      : 'idle';
    statusDot.className = 'dashboard-item-status ' + dotClass;
    item.appendChild(statusDot);

    var projectPath = dashboardProjects[dbId] || '';
    var displayName = DASHBOARD_LABELS[dbId] || dbId;
    if (projectPath) {
      // Extract the last directory name from the path
      var parts = projectPath.replace(/\/+$/, '').split('/');
      displayName = parts[parts.length - 1] || displayName;
    }

    var nameEl = document.createElement('span');
    nameEl.className = 'dashboard-item-name';
    nameEl.textContent = displayName;
    if (projectPath) nameEl.title = projectPath;
    item.appendChild(nameEl);

    // Per-dashboard action buttons (Electron only)
    if (isElectron) {
      var actions = document.createElement('div');
      actions.className = 'dashboard-item-actions';

      // Project button
      var projBtn = document.createElement('button');
      projBtn.className = 'dashboard-item-action-btn' + (dashboardProjects[dbId] ? ' has-project' : '');
      projBtn.title = dashboardProjects[dbId] ? 'Project: ' + dashboardProjects[dbId] : 'Set project directory';
      projBtn.setAttribute('data-id', dbId);
      projBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4l4-2 4 2 4-2v10l-4 2-4-2-4 2V4z" stroke="currentColor" stroke-width="1.4"/><path d="M6 2v12M10 4v12" stroke="currentColor" stroke-width="1.4"/></svg>';
      projBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = this.getAttribute('data-id');
        if (onProjectClick) onProjectClick(id);
      });
      actions.appendChild(projBtn);

      // Claude chat button
      var claudeBtn = document.createElement('button');
      claudeBtn.className = 'dashboard-item-action-btn';
      claudeBtn.title = 'Claude Chat';
      claudeBtn.setAttribute('data-id', dbId);
      claudeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v8H6l-4 3v-3H2V3z" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="7" r="0.8" fill="currentColor"/><circle cx="8" cy="7" r="0.8" fill="currentColor"/><circle cx="10.5" cy="7" r="0.8" fill="currentColor"/></svg>';
      claudeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = this.getAttribute('data-id');
        if (onClaudeClick) onClaudeClick(id);
      });
      actions.appendChild(claudeBtn);

      item.appendChild(actions);
    }

    item.addEventListener('click', function () {
      var id = this.getAttribute('data-id');
      onSwitch(id);
    });

    listEl.appendChild(item);
  }

  // If viewing an archived task, add the "Archived Task" item
  if (archiveViewActive) {
    var archiveItem = document.createElement('div');
    archiveItem.className = 'dashboard-item archived-item active';

    var archiveDot = document.createElement('span');
    archiveDot.className = 'dashboard-item-status has-activity';
    archiveItem.appendChild(archiveDot);

    var archiveName = document.createElement('span');
    archiveName.className = 'dashboard-item-name';
    archiveName.textContent = 'Archived Task';
    archiveItem.appendChild(archiveName);

    var exitBtn = document.createElement('button');
    exitBtn.className = 'archive-exit-btn';
    exitBtn.textContent = '\u2715';
    exitBtn.title = 'Exit archive view';
    exitBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (onExitArchive) onExitArchive();
    });
    archiveItem.appendChild(exitBtn);

    listEl.appendChild(archiveItem);
  }

  // If viewing a queued task, add the "Queued Task" item
  if (queueViewActive) {
    var queueItem = document.createElement('div');
    queueItem.className = 'dashboard-item queue-item active';

    var queueDot = document.createElement('span');
    queueDot.className = 'dashboard-item-status has-activity';
    queueItem.appendChild(queueDot);

    var queueName = document.createElement('span');
    queueName.className = 'dashboard-item-name';
    queueName.textContent = 'Queued Task';
    queueItem.appendChild(queueName);

    var qExitBtn = document.createElement('button');
    qExitBtn.className = 'archive-exit-btn';
    qExitBtn.textContent = '\u2715';
    qExitBtn.title = 'Exit queue view';
    qExitBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (onExitQueue) onExitQueue();
    });
    queueItem.appendChild(qExitBtn);

    listEl.appendChild(queueItem);
  }

  // Show queue count if there are queued items (and not viewing one)
  if (queueCount > 0 && !queueViewActive) {
    var queueLabel = document.createElement('div');
    queueLabel.className = 'dashboard-item queue-count-item';

    var queueCountDot = document.createElement('span');
    queueCountDot.className = 'dashboard-item-status queue-dot';
    queueLabel.appendChild(queueCountDot);

    var queueCountName = document.createElement('span');
    queueCountName.className = 'dashboard-item-name';
    queueCountName.textContent = 'Queue (' + queueCount + ')';
    queueLabel.appendChild(queueCountName);

    listEl.appendChild(queueLabel);
  }
}

/**
 * Set up sidebar collapse/expand toggle with localStorage persistence.
 *
 * @param {HTMLElement} toggleBtn — the sidebar toggle button element
 * @param {HTMLElement} sidebar — the sidebar container element
 */
export function setupSidebarToggle(toggleBtn, sidebar) {
  var sidebarCollapsed = false;

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    if (sidebar) {
      sidebar.classList.toggle('collapsed', sidebarCollapsed);
    }
    localStorage.setItem('sidebar-collapsed', sidebarCollapsed ? 'true' : 'false');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleSidebar);
  }

  // Restore saved state
  var saved = localStorage.getItem('sidebar-collapsed');
  if (saved === 'true') {
    sidebarCollapsed = true;
    if (sidebar) sidebar.classList.add('collapsed');
  }
}

/**
 * Set up the sidebar "Dashboards" title as a clickable home link.
 * @param {HTMLElement} titleEl — the .sidebar-title element
 * @param {Function} onClickFn — callback when title is clicked
 */
export function setupSidebarTitle(titleEl, onClickFn) {
  if (!titleEl) return;
  titleEl.addEventListener('click', onClickFn);
}
