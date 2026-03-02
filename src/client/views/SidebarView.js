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
 * @param {object} options.dashboardStates — map of dashboardId → state string ('idle'|'in_progress'|'completed'|'error')
 * @param {Function} options.onSwitch — callback(dashboardId) when a dashboard item is clicked
 * @param {Function} options.onExitArchive — callback() when the archive exit button is clicked
 */
export function renderSidebar(listEl, options) {
  if (!listEl) return;
  listEl.textContent = '';

  var currentDashboardId = options.currentDashboardId;
  var archiveViewActive  = options.archiveViewActive;
  var dashboardStates    = options.dashboardStates;
  var onSwitch           = options.onSwitch;
  var onExitArchive      = options.onExitArchive;

  for (var i = 0; i < DEFAULT_DASHBOARDS.length; i++) {
    var dbId = DEFAULT_DASHBOARDS[i];
    var isActive = !archiveViewActive && dbId === currentDashboardId;
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

    var nameEl = document.createElement('span');
    nameEl.className = 'dashboard-item-name';
    nameEl.textContent = DASHBOARD_LABELS[dbId] || dbId;
    item.appendChild(nameEl);

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
