const { readDashboardInit, readDashboardProgress } = require('./DashboardService');

// --- Internal Helpers ---

/**
 * Safely retrieve the agents array from initialization data.
 * Returns an empty array if data is missing or malformed.
 */
function getAgents(initData) {
  if (!initData || !Array.isArray(initData.agents)) return [];
  return initData.agents;
}

/**
 * Safely retrieve a task's depends_on array.
 * Returns an empty array if missing or not an array.
 */
function getDependsOn(agent) {
  if (!agent || !Array.isArray(agent.depends_on)) return [];
  return agent.depends_on;
}

/**
 * Determine the status of a single task based on its progress data.
 * Returns "completed", "in_progress", "failed", or "pending".
 */
function resolveTaskStatus(taskId, progressMap) {
  const progress = progressMap[taskId];
  if (!progress || !progress.status) return 'pending';
  return progress.status;
}

// --- Exported Functions ---

/**
 * Get all tasks that are ready to be dispatched for a given dashboard.
 *
 * A task is dispatchable when:
 *   - ALL entries in its depends_on have a progress file with status === "completed"
 *   - The task itself does NOT have a progress file (meaning it is still pending)
 *
 * @param {string} dashboardId - The dashboard identifier (e.g., "dashboard1")
 * @returns {Array<Object>} Array of dispatchable agent objects, each augmented with
 *   a `dependency_status` object mapping each dependency ID to its current status.
 */
function getDispatchableTasks(dashboardId) {
  try {
    const initData = readDashboardInit(dashboardId);
    const progressMap = readDashboardProgress(dashboardId);
    const agents = getAgents(initData);

    const dispatchable = [];

    for (const agent of agents) {
      if (!agent || !agent.id) continue;

      // Skip tasks that already have a progress file (already dispatched or running)
      if (progressMap[agent.id]) continue;

      const deps = getDependsOn(agent);
      const dependencyStatus = {};
      let allSatisfied = true;

      for (const depId of deps) {
        const status = resolveTaskStatus(depId, progressMap);
        dependencyStatus[depId] = status;
        if (status !== 'completed') {
          allSatisfied = false;
        }
      }

      // Task is dispatchable if it has no deps (allSatisfied is true by default)
      // or all deps are completed
      if (allSatisfied) {
        dispatchable.push({
          ...agent,
          dependency_status: dependencyStatus,
        });
      }
    }

    return dispatchable;
  } catch {
    return [];
  }
}

/**
 * Efficiently compute which tasks became newly unblocked after a specific task completed.
 *
 * Instead of scanning all tasks, this only examines tasks that list `completedTaskId`
 * in their depends_on array. For each such task, it checks whether ALL other
 * dependencies are also completed (and the task itself has no progress file yet).
 *
 * @param {string} dashboardId - The dashboard identifier
 * @param {string} completedTaskId - The task ID that just completed
 * @returns {Array<Object>} Array of newly dispatchable agent objects, each augmented
 *   with a `dependency_status` object.
 */
function computeNewlyUnblocked(dashboardId, completedTaskId) {
  try {
    const initData = readDashboardInit(dashboardId);
    const progressMap = readDashboardProgress(dashboardId);
    const agents = getAgents(initData);

    const unblocked = [];

    for (const agent of agents) {
      if (!agent || !agent.id) continue;

      const deps = getDependsOn(agent);

      // Only consider tasks that depend on the completed task
      if (!deps.includes(completedTaskId)) continue;

      // Skip tasks that already have a progress file
      if (progressMap[agent.id]) continue;

      // Check if ALL dependencies are now completed
      const dependencyStatus = {};
      let allSatisfied = true;

      for (const depId of deps) {
        const status = resolveTaskStatus(depId, progressMap);
        dependencyStatus[depId] = status;
        if (status !== 'completed') {
          allSatisfied = false;
        }
      }

      if (allSatisfied) {
        unblocked.push({
          ...agent,
          dependency_status: dependencyStatus,
        });
      }
    }

    return unblocked;
  } catch {
    return [];
  }
}

/**
 * Get the dependency status for a single task.
 *
 * Returns the status of each dependency (completed, in_progress, failed, or pending),
 * along with aggregate satisfaction metrics.
 *
 * @param {string} dashboardId - The dashboard identifier
 * @param {string} taskId - The task ID to check dependencies for
 * @returns {Object} An object with:
 *   - `dependencies` {Object} — Map of depId to status string
 *   - `allSatisfied` {boolean} — Whether all dependencies are completed
 *   - `satisfiedCount` {number} — Number of completed dependencies
 *   - `totalCount` {number} — Total number of dependencies
 */
function getDependencyStatus(dashboardId, taskId) {
  try {
    const initData = readDashboardInit(dashboardId);
    const progressMap = readDashboardProgress(dashboardId);
    const agents = getAgents(initData);

    // Find the target task
    const agent = agents.find(a => a && a.id === taskId);
    if (!agent) {
      return { dependencies: {}, allSatisfied: true, satisfiedCount: 0, totalCount: 0 };
    }

    const deps = getDependsOn(agent);
    const dependencies = {};
    let satisfiedCount = 0;

    for (const depId of deps) {
      const status = resolveTaskStatus(depId, progressMap);
      dependencies[depId] = status;
      if (status === 'completed') {
        satisfiedCount++;
      }
    }

    return {
      dependencies,
      allSatisfied: satisfiedCount === deps.length,
      satisfiedCount,
      totalCount: deps.length,
    };
  } catch {
    return { dependencies: {}, allSatisfied: true, satisfiedCount: 0, totalCount: 0 };
  }
}

module.exports = {
  getDispatchableTasks,
  computeNewlyUnblocked,
  getDependencyStatus,
};
