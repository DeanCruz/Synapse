// IDE Workspace Manager — bridges workspaces to dashboards via localStorage
// Each IDE workspace is linked to a dedicated dashboard for persistent chat context.
// The mapping survives app restarts via localStorage.

import { getDashboardLabel } from '@/utils/constants.js';

const STORAGE_KEY = 'synapse-ide-workspace-dashboards';

// ── Storage helpers ──────────────────────────────────────────────────────────

/**
 * Get the full workspace-to-dashboard mapping.
 * @returns {{ [workspaceId: string]: string }} workspaceId → dashboardId
 */
export function getAllWorkspaceDashboards() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Get the dashboardId linked to a workspace.
 * @param {string} workspaceId
 * @returns {string|null}
 */
export function getWorkspaceDashboard(workspaceId) {
  const map = getAllWorkspaceDashboards();
  return map[workspaceId] || null;
}

/**
 * Store a workspace → dashboard link.
 * @param {string} workspaceId
 * @param {string} dashboardId
 */
export function setWorkspaceDashboard(workspaceId, dashboardId) {
  const map = getAllWorkspaceDashboards();
  map[workspaceId] = dashboardId;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) { /* quota exceeded or unavailable */ }
}

/**
 * Remove a workspace → dashboard link (e.g. when unlinking, not on close).
 * @param {string} workspaceId
 */
export function removeWorkspaceDashboard(workspaceId) {
  const map = getAllWorkspaceDashboards();
  delete map[workspaceId];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) { /* quota exceeded or unavailable */ }
}

// ── Query helpers ────────────────────────────────────────────────────────────

/**
 * Check whether a given dashboardId is linked to any IDE workspace.
 * @param {string} dashboardId
 * @returns {boolean}
 */
export function isIdeDashboard(dashboardId) {
  const map = getAllWorkspaceDashboards();
  return Object.values(map).includes(dashboardId);
}

/**
 * Get the workspaceId linked to a given dashboardId (reverse lookup).
 * @param {string} dashboardId
 * @returns {string|null}
 */
export function getWorkspaceForDashboard(dashboardId) {
  const map = getAllWorkspaceDashboards();
  for (const [wsId, dId] of Object.entries(map)) {
    if (dId === dashboardId) return wsId;
  }
  return null;
}

/**
 * Get a display label for a dashboard, appending "(IDE)" if it's linked to a workspace.
 * @param {string} dashboardId
 * @returns {string}
 */
export function getIdeDashboardLabel(dashboardId) {
  const base = getDashboardLabel(dashboardId);
  if (isIdeDashboard(dashboardId)) {
    return base + ' (IDE)';
  }
  return base;
}

// ── Dashboard creation ───────────────────────────────────────────────────────

/**
 * Create a new dashboard and link it to a workspace.
 * Calls window.electronAPI.createDashboard() and stores the mapping.
 * @param {string} workspaceId
 * @returns {Promise<string|null>} The new dashboardId, or null on failure
 */
export async function createWorkspaceDashboard(workspaceId) {
  // Check if workspace already has a dashboard
  const existing = getWorkspaceDashboard(workspaceId);
  if (existing) return existing;

  const api = window.electronAPI;
  if (!api || !api.createDashboard) return null;

  try {
    const result = await api.createDashboard();
    if (result && result.id) {
      setWorkspaceDashboard(workspaceId, result.id);
      return result.id;
    }
  } catch (err) {
    console.error('Failed to create IDE dashboard for workspace:', workspaceId, err);
  }
  return null;
}
