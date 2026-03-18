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
