const fs = require('fs');
const path = require('path');
const { ARCHIVE_DIR } = require('../utils/constants');
const { readJSON } = require('../utils/json');
const { getDashboardDir, copyDirSync } = require('./DashboardService');

// --- Archive Helpers ---

/**
 * List all archived dashboards with basic metadata.
 * Returns an array sorted newest-first by archive name.
 */
function listArchives() {
  try {
    if (!fs.existsSync(ARCHIVE_DIR)) return [];
    const entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true });
    const archives = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const init = readJSON(path.join(ARCHIVE_DIR, e.name, 'initialization.json'));
      archives.push({
        name: e.name,
        task: init && init.task ? init.task : null,
        agentCount: init && init.agents ? init.agents.length : 0,
      });
    }
    return archives.sort((a, b) => b.name.localeCompare(a.name)); // newest first
  } catch {
    return [];
  }
}

/**
 * Archive a dashboard by copying its contents to Archive/.
 * Returns the archive name (e.g., "2026-02-25_taskName").
 *
 * @param {string} id - Dashboard ID to archive
 * @returns {string} The archive name
 */
function archiveDashboard(id) {
  const dashboardDir = getDashboardDir(id);
  const { readDashboardInit } = require('./DashboardService');
  const init = readDashboardInit(id);
  const taskName = (init && init.task && init.task.name) ? init.task.name : 'unnamed';
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const archiveName = `${today}_${taskName}`;
  const archiveDir = path.join(ARCHIVE_DIR, archiveName);

  copyDirSync(dashboardDir, archiveDir);

  return archiveName;
}

/**
 * Delete an archived dashboard by name.
 * Removes the entire archive directory.
 *
 * @param {string} name - Archive folder name (e.g., "2026-02-25_taskName")
 * @returns {boolean} true if deleted, false if not found
 */
function deleteArchive(name) {
  const archiveDir = path.join(ARCHIVE_DIR, name);
  if (!fs.existsSync(archiveDir)) return false;
  fs.rmSync(archiveDir, { recursive: true, force: true });
  return true;
}

module.exports = {
  listArchives,
  archiveDashboard,
  deleteArchive,
};
