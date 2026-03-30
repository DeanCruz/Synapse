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
  // Sync to Electron settings on disk (fire-and-forget)
  if (window.electronAPI && window.electronAPI.saveAdditionalContext) {
    window.electronAPI.saveAdditionalContext(dashboardId, dirs).catch(() => {});
  }
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

/**
 * Async loader — merges disk-persisted additional context dirs into localStorage.
 * Call once on app startup to recover dirs that survived a localStorage clear.
 * Produces the union of both sources (deduped by path).
 */
export async function loadDashboardAdditionalContextFromDisk(dashboardId) {
  if (!window.electronAPI || !window.electronAPI.getAdditionalContext) return;
  try {
    const diskDirs = await window.electronAPI.getAdditionalContext(dashboardId);
    if (!Array.isArray(diskDirs) || diskDirs.length === 0) return;
    const localDirs = getDashboardAdditionalContext(dashboardId);
    const merged = [...new Set([...localDirs, ...diskDirs])];
    if (merged.length !== localDirs.length) {
      saveDashboardAdditionalContext(dashboardId, merged);
    }
  } catch (e) {
    // Disk read failed — localStorage remains the authoritative source
  }
}

/**
 * Async loader — merges disk-persisted additional context for ALL dashboards.
 * Call once on app startup to recover all dirs from disk.
 */
export async function loadAllDashboardAdditionalContextFromDisk() {
  if (!window.electronAPI || !window.electronAPI.getAdditionalContext) return;
  try {
    const diskMap = await window.electronAPI.getAdditionalContext();
    if (!diskMap || typeof diskMap !== 'object') return;
    for (const dashboardId of Object.keys(diskMap)) {
      const diskDirs = diskMap[dashboardId];
      if (!Array.isArray(diskDirs) || diskDirs.length === 0) continue;
      const localDirs = getDashboardAdditionalContext(dashboardId);
      const merged = [...new Set([...localDirs, ...diskDirs])];
      if (merged.length !== localDirs.length) {
        saveDashboardAdditionalContext(dashboardId, merged);
      }
    }
  } catch (e) {
    // Disk read failed — localStorage remains the authoritative source
  }
}
