// Per-dashboard project path storage — uses localStorage
// Each dashboard can have its own project directory.

const STORAGE_KEY = 'synapse-dashboard-projects';

export function getAllDashboardProjects() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

export function getDashboardProject(dashboardId) {
  const map = getAllDashboardProjects();
  return map[dashboardId] || null;
}

export function saveDashboardProject(dashboardId, projectPath) {
  const map = getAllDashboardProjects();
  map[dashboardId] = projectPath;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

// Per-dashboard additional context directories storage — uses localStorage
// Each dashboard can have an array of additional context directory paths.

const ADDITIONAL_CONTEXT_KEY = 'synapse-dashboard-additional-context';

export function getAllDashboardAdditionalContext() {
  try {
    return JSON.parse(localStorage.getItem(ADDITIONAL_CONTEXT_KEY)) || {};
  } catch (e) {
    return {};
  }
}

export function getDashboardAdditionalContext(dashboardId) {
  const map = getAllDashboardAdditionalContext();
  return map[dashboardId] || [];
}

export function saveDashboardAdditionalContext(dashboardId, dirs) {
  const map = getAllDashboardAdditionalContext();
  map[dashboardId] = dirs;
  localStorage.setItem(ADDITIONAL_CONTEXT_KEY, JSON.stringify(map));
}

export function addDashboardAdditionalContext(dashboardId, dirPath) {
  const dirs = getDashboardAdditionalContext(dashboardId);
  if (!dirs.includes(dirPath)) {
    dirs.push(dirPath);
    saveDashboardAdditionalContext(dashboardId, dirs);
  }
}

export function removeDashboardAdditionalContext(dashboardId, dirPath) {
  const dirs = getDashboardAdditionalContext(dashboardId);
  const filtered = dirs.filter(d => d !== dirPath);
  saveDashboardAdditionalContext(dashboardId, filtered);
}
