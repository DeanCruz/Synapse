// ProjectModal — Project configuration UI
// ES module. Directory picker, recent projects, Claude CLI detection.

import { el } from '../../utils/dom.js';
import { createModalPopup } from './ModalFactory.js';

var DASHBOARD_PROJECTS_KEY = 'synapse-dashboard-projects';

/**
 * Get all per-dashboard project paths from localStorage.
 * @returns {object} — map of dashboardId → project path
 */
export function getAllDashboardProjects() {
  try {
    return JSON.parse(localStorage.getItem(DASHBOARD_PROJECTS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Get the project path for a specific dashboard.
 * @param {string} dashboardId
 * @returns {string|null}
 */
export function getDashboardProject(dashboardId) {
  var map = getAllDashboardProjects();
  return map[dashboardId] || null;
}

/**
 * Save a project path for a specific dashboard.
 * @param {string} dashboardId
 * @param {string} projectPath
 */
export function saveDashboardProject(dashboardId, projectPath) {
  var map = getAllDashboardProjects();
  map[dashboardId] = projectPath;
  localStorage.setItem(DASHBOARD_PROJECTS_KEY, JSON.stringify(map));
}

/**
 * Show the project configuration modal.
 *
 * @param {object} opts
 * @param {string} opts.dashboardId — which dashboard this project config is for
 * @param {function} opts.onProjectSelected — callback({ path, name, language, hasClaudeMd, dashboardId })
 */
export function showProjectModal(opts) {
  var dashboardId = opts.dashboardId || 'dashboard1';
  var popup = createModalPopup('project-overlay', 'Project Configuration — ' + dashboardId.replace('dashboard', 'Dashboard '));
  var body = popup.body;

  var api = window.electronAPI;
  if (!api) {
    body.appendChild(el('div', { text: 'Project configuration requires the desktop app.' }));
    document.body.appendChild(popup.overlay);
    return;
  }

  // --- Current Project Section ---
  var currentSection = el('div', { className: 'settings-section' });
  currentSection.appendChild(el('div', { className: 'settings-section-title', text: 'Active Project' }));

  var currentDisplay = el('div', { className: 'project-current-display' });
  currentDisplay.textContent = 'No project selected';
  currentSection.appendChild(currentDisplay);

  // Pick directory button
  var pickBtn = el('button', { className: 'project-pick-btn', text: 'Select Project Directory' });
  pickBtn.addEventListener('click', function () {
    api.selectProjectDirectory().then(function (dirPath) {
      if (!dirPath) return;
      api.loadProject(dirPath).then(function (project) {
        updateCurrentDisplay(project);
        api.addRecentProject({ path: project.path, name: project.name });
        // Save per-dashboard project path
        saveDashboardProject(dashboardId, project.path);
        if (opts.onProjectSelected) opts.onProjectSelected({ path: project.path, name: project.name, language: project.language, hasClaudeMd: project.hasClaudeMd, dashboardId: dashboardId });
      });
    });
  });
  currentSection.appendChild(pickBtn);
  body.appendChild(currentSection);

  // --- Recent Projects Section ---
  var recentSection = el('div', { className: 'settings-section' });
  recentSection.appendChild(el('div', { className: 'settings-section-title', text: 'Recent Projects' }));

  var recentList = el('div', { className: 'project-recent-list' });
  recentSection.appendChild(recentList);
  body.appendChild(recentSection);

  // --- Claude CLI Section ---
  var cliSection = el('div', { className: 'settings-section' });
  cliSection.appendChild(el('div', { className: 'settings-section-title', text: 'Claude CLI' }));

  var cliStatus = el('div', { className: 'project-cli-status' });
  cliStatus.textContent = 'Detecting...';
  cliSection.appendChild(cliStatus);

  var cliInput = document.createElement('input');
  cliInput.type = 'text';
  cliInput.className = 'settings-app-input';
  cliInput.placeholder = 'Path to claude binary';
  cliInput.style.marginTop = '8px';
  cliInput.addEventListener('change', function () {
    api.setSetting('claudeCliPath', cliInput.value);
  });
  cliSection.appendChild(cliInput);

  // Model selector
  var modelRow = el('div', { className: 'settings-app-row', style: { marginTop: '12px' } });
  modelRow.appendChild(el('label', { className: 'settings-app-label', text: 'Default Model' }));
  var modelSelect = document.createElement('select');
  modelSelect.className = 'settings-app-input';
  var models = ['sonnet', 'opus', 'haiku'];
  for (var i = 0; i < models.length; i++) {
    var opt = document.createElement('option');
    opt.value = models[i];
    opt.textContent = models[i].charAt(0).toUpperCase() + models[i].slice(1);
    modelSelect.appendChild(opt);
  }
  modelSelect.addEventListener('change', function () {
    api.setSetting('defaultModel', modelSelect.value);
  });
  modelRow.appendChild(modelSelect);
  cliSection.appendChild(modelRow);

  // Skip permissions toggle
  var permRow = el('div', { className: 'settings-app-row', style: { marginTop: '8px' } });
  permRow.appendChild(el('label', { className: 'settings-app-label', text: 'Skip Permissions' }));
  var permCheck = document.createElement('input');
  permCheck.type = 'checkbox';
  permCheck.className = 'settings-app-input';
  permCheck.style.width = 'auto';
  permCheck.addEventListener('change', function () {
    api.setSetting('dangerouslySkipPermissions', permCheck.checked);
  });
  permRow.appendChild(permCheck);
  cliSection.appendChild(permRow);

  body.appendChild(cliSection);

  // --- Load data ---
  function updateCurrentDisplay(project) {
    currentDisplay.textContent = '';
    var nameEl = el('div', { className: 'project-name', text: project.name });
    var pathEl = el('div', { className: 'project-path', text: project.path });
    var metaEl = el('div', { className: 'project-meta' });
    if (project.language) {
      metaEl.appendChild(el('span', { className: 'project-badge', text: project.language }));
    }
    if (project.hasClaudeMd) {
      metaEl.appendChild(el('span', { className: 'project-badge project-badge-green', text: 'CLAUDE.md' }));
    }
    currentDisplay.appendChild(nameEl);
    currentDisplay.appendChild(pathEl);
    currentDisplay.appendChild(metaEl);
  }

  // Load active project for this dashboard (per-dashboard path takes priority)
  var perDashboardPath = getDashboardProject(dashboardId);
  api.getSettings().then(function (settings) {
    var projectPath = perDashboardPath || settings.activeProjectPath;
    if (projectPath) {
      api.loadProject(projectPath).then(function (project) {
        updateCurrentDisplay(project);
      });
    }
    if (settings.claudeCliPath) {
      cliInput.value = settings.claudeCliPath;
    }
    if (settings.defaultModel) {
      modelSelect.value = settings.defaultModel;
    }
    permCheck.checked = !!settings.dangerouslySkipPermissions;
  });

  // Load recent projects
  api.getRecentProjects().then(function (recents) {
    if (!recents || recents.length === 0) {
      recentList.appendChild(el('div', { className: 'project-recent-empty', text: 'No recent projects' }));
      return;
    }
    for (var j = 0; j < recents.length; j++) {
      (function (recent) {
        var row = el('div', { className: 'project-recent-row' });
        row.appendChild(el('span', { className: 'project-recent-name', text: recent.name }));
        row.appendChild(el('span', { className: 'project-recent-path', text: recent.path }));
        row.addEventListener('click', function () {
          api.loadProject(recent.path).then(function (project) {
            updateCurrentDisplay(project);
            saveDashboardProject(dashboardId, project.path);
            if (opts.onProjectSelected) opts.onProjectSelected({ path: project.path, name: project.name, language: project.language, hasClaudeMd: project.hasClaudeMd, dashboardId: dashboardId });
          });
        });
        recentList.appendChild(row);
      })(recents[j]);
    }
  });

  // Detect CLI
  api.detectClaudeCli().then(function (cliPath) {
    if (cliPath) {
      cliStatus.textContent = 'Found: ' + cliPath;
      cliStatus.className = 'project-cli-status project-cli-found';
      if (!cliInput.value) cliInput.value = cliPath;
    } else {
      cliStatus.textContent = 'Not found — please set path manually';
      cliStatus.className = 'project-cli-status project-cli-missing';
    }
  });

  document.body.appendChild(popup.overlay);
}
