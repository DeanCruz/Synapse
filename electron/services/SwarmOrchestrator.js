// electron/services/SwarmOrchestrator.js — Self-managing swarm dispatch engine
// Implements the full dispatch loop: reads dependency graph, dispatches unblocked tasks,
// handles completions/failures, writes logs. Replaces the terminal-based master agent.

const fs = require('fs');
const path = require('path');

const { DASHBOARDS_DIR } = require('../../src/server/utils/constants');
const { readDashboardInit, readDashboardProgress } = require('../../src/server/services/DashboardService');
const ClaudeCodeService = require('./ClaudeCodeService');
const PromptBuilder = require('./PromptBuilder');
const ProjectService = require('./ProjectService');

var activeSwarms = {};  // dashboardId -> { state, projectPath, ... }
var broadcastFn = null;

/**
 * Initialize with a broadcast function.
 * @param {Function} broadcast — (channel, data) => void
 */
function init(broadcast) {
  broadcastFn = broadcast;
  ClaudeCodeService.init(broadcast);
}

/**
 * Start orchestrating a swarm on a dashboard.
 *
 * @param {string} dashboardId
 * @param {object} opts
 * @param {string} opts.projectPath — project directory
 * @param {string} [opts.model] — Claude model
 * @param {string} [opts.cliPath] — path to claude binary
 * @param {boolean} [opts.dangerouslySkipPermissions]
 * @returns {{ success: boolean, error?: string }}
 */
function startSwarm(dashboardId, opts) {
  if (activeSwarms[dashboardId]) {
    return { success: false, error: 'Swarm already active on ' + dashboardId };
  }

  var init = readDashboardInit(dashboardId);
  if (!init || !init.task || !init.task.name) {
    return { success: false, error: 'No task plan found on ' + dashboardId };
  }

  if (!init.agents || init.agents.length === 0) {
    return { success: false, error: 'No tasks defined in the plan' };
  }

  var trackerRoot = path.resolve(__dirname, '..', '..');

  activeSwarms[dashboardId] = {
    state: 'running',
    projectPath: opts.projectPath,
    model: opts.model || 'sonnet',
    cliPath: opts.cliPath || 'claude',
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions || false,
    trackerRoot: trackerRoot,
    dispatchedTasks: {},  // taskId -> true
    completedTasks: {},   // taskId -> true
    failedTasks: {},      // taskId -> true
  };

  appendLog(dashboardId, {
    level: 'info',
    message: 'Swarm started — dispatching Wave 1 tasks',
  });

  // Dispatch all initially unblocked tasks
  dispatchReady(dashboardId);

  return { success: true };
}

/**
 * Called when a worker's progress file indicates completion.
 * Scans for newly unblocked tasks and dispatches them.
 *
 * @param {string} dashboardId
 * @param {string} taskId
 */
function onTaskComplete(dashboardId, taskId) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return;

  swarm.completedTasks[taskId] = true;
  delete swarm.dispatchedTasks[taskId];

  var init = readDashboardInit(dashboardId);
  var agent = findAgent(init, taskId);
  var title = agent ? agent.title : taskId;

  appendLog(dashboardId, {
    task_id: taskId,
    level: 'info',
    message: 'Task completed: ' + title,
    task_name: title,
  });

  // Check if swarm is complete
  if (isSwarmComplete(dashboardId)) {
    swarm.state = 'completed';
    appendLog(dashboardId, {
      level: 'info',
      message: 'Swarm completed — all tasks finished',
    });
    delete activeSwarms[dashboardId];
    return;
  }

  // Dispatch newly unblocked tasks
  if (swarm.state === 'running') {
    dispatchReady(dashboardId);
  }
}

/**
 * Called when a worker's progress file indicates failure.
 *
 * @param {string} dashboardId
 * @param {string} taskId
 */
function onTaskFailed(dashboardId, taskId) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return;

  swarm.failedTasks[taskId] = true;
  delete swarm.dispatchedTasks[taskId];

  var init = readDashboardInit(dashboardId);
  var agent = findAgent(init, taskId);
  var title = agent ? agent.title : taskId;

  appendLog(dashboardId, {
    task_id: taskId,
    level: 'error',
    message: 'Task failed: ' + title,
    task_name: title,
  });

  // Check circuit breaker: 3+ failures in same wave
  var failedInWave = 0;
  if (agent) {
    for (var fid in swarm.failedTasks) {
      var fa = findAgent(init, fid);
      if (fa && fa.wave === agent.wave) failedInWave++;
    }
  }
  if (failedInWave >= 3) {
    swarm.state = 'paused';
    appendLog(dashboardId, {
      level: 'warn',
      message: 'Circuit breaker triggered — 3+ failures in Wave ' + agent.wave + '. Swarm paused.',
    });
    return;
  }

  // Check if swarm is complete (all tasks either done or failed, no dispatched)
  if (isSwarmComplete(dashboardId)) {
    swarm.state = 'completed';
    var failCount = Object.keys(swarm.failedTasks).length;
    appendLog(dashboardId, {
      level: failCount > 0 ? 'warn' : 'info',
      message: 'Swarm finished — ' + failCount + ' task(s) failed',
    });
    delete activeSwarms[dashboardId];
    return;
  }

  // Continue dispatching unblocked tasks
  if (swarm.state === 'running') {
    dispatchReady(dashboardId);
  }
}

/**
 * Scan for tasks whose dependencies are all satisfied and dispatch them.
 */
function dispatchReady(dashboardId) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm || swarm.state !== 'running') return;

  var init = readDashboardInit(dashboardId);
  if (!init || !init.agents) return;

  var projectContexts = [];
  if (swarm.projectPath) {
    projectContexts = ProjectService.getProjectContext(swarm.projectPath);
  }

  for (var i = 0; i < init.agents.length; i++) {
    var agent = init.agents[i];
    var taskId = agent.id;

    // Skip already dispatched, completed, or failed
    if (swarm.dispatchedTasks[taskId] || swarm.completedTasks[taskId] || swarm.failedTasks[taskId]) {
      continue;
    }

    // Check if all dependencies are satisfied
    var deps = agent.depends_on || [];
    var allSatisfied = true;
    for (var d = 0; d < deps.length; d++) {
      if (!swarm.completedTasks[deps[d]]) {
        allSatisfied = false;
        break;
      }
    }

    if (!allSatisfied) continue;

    // Dependencies satisfied — dispatch this task
    swarm.dispatchedTasks[taskId] = true;

    // Build upstream results from completed dependencies
    var upstreamResults = PromptBuilder.readUpstreamResults(dashboardId, deps, swarm.trackerRoot);

    // Build prompts
    var systemPrompt = PromptBuilder.buildSystemPrompt({
      taskId: taskId,
      dashboardId: dashboardId,
      trackerRoot: swarm.trackerRoot,
    });

    var taskPrompt = PromptBuilder.buildTaskPrompt({
      task: agent,
      taskDescription: agent.description || '',
      projectContexts: projectContexts,
      upstreamResults: upstreamResults,
    });

    appendLog(dashboardId, {
      task_id: taskId,
      level: 'info',
      message: 'Dispatching: ' + agent.title,
      task_name: agent.title,
    });

    // Spawn the worker
    ClaudeCodeService.spawnWorker({
      taskId: taskId,
      dashboardId: dashboardId,
      projectDir: swarm.projectPath,
      prompt: taskPrompt,
      systemPrompt: systemPrompt,
      model: swarm.model,
      cliPath: swarm.cliPath,
      dangerouslySkipPermissions: swarm.dangerouslySkipPermissions,
    });
  }
}

/**
 * Check if the swarm is complete (no dispatched tasks, all tasks either done, failed, or blocked by failures).
 */
function isSwarmComplete(dashboardId) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return true;

  // If any tasks are still dispatched (in flight), not complete
  if (Object.keys(swarm.dispatchedTasks).length > 0) return false;

  var init = readDashboardInit(dashboardId);
  if (!init || !init.agents) return true;

  for (var i = 0; i < init.agents.length; i++) {
    var taskId = init.agents[i].id;
    if (!swarm.completedTasks[taskId] && !swarm.failedTasks[taskId]) {
      // Check if it's blocked by a failed dependency
      var deps = init.agents[i].depends_on || [];
      var blockedByFailure = false;
      for (var d = 0; d < deps.length; d++) {
        if (swarm.failedTasks[deps[d]]) {
          blockedByFailure = true;
          break;
        }
      }
      if (!blockedByFailure) return false; // Task is ready but not dispatched — not complete
    }
  }

  return true;
}

/**
 * Pause the swarm — stops dispatching new tasks but lets active workers finish.
 */
function pauseSwarm(dashboardId) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return { success: false, error: 'No active swarm on ' + dashboardId };
  swarm.state = 'paused';
  appendLog(dashboardId, { level: 'info', message: 'Swarm paused' });
  return { success: true };
}

/**
 * Resume a paused swarm.
 */
function resumeSwarm(dashboardId) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return { success: false, error: 'No active swarm on ' + dashboardId };
  swarm.state = 'running';
  appendLog(dashboardId, { level: 'info', message: 'Swarm resumed — dispatching ready tasks' });
  dispatchReady(dashboardId);
  return { success: true };
}

/**
 * Cancel the swarm — kills all workers and marks as cancelled.
 */
function cancelSwarm(dashboardId) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return { success: false, error: 'No active swarm on ' + dashboardId };

  // Kill all workers for this dashboard
  var workers = ClaudeCodeService.getActiveWorkers();
  for (var i = 0; i < workers.length; i++) {
    if (workers[i].dashboardId === dashboardId) {
      ClaudeCodeService.killWorker(workers[i].pid);
    }
  }

  swarm.state = 'cancelled';
  appendLog(dashboardId, { level: 'warn', message: 'Swarm cancelled' });
  delete activeSwarms[dashboardId];
  return { success: true };
}

/**
 * Retry a failed task.
 */
function retryTask(dashboardId, taskId) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return { success: false, error: 'No active swarm on ' + dashboardId };

  if (!swarm.failedTasks[taskId]) {
    return { success: false, error: 'Task ' + taskId + ' is not in failed state' };
  }

  // Clear failed state
  delete swarm.failedTasks[taskId];

  // Delete old progress file
  var progressFile = path.join(swarm.trackerRoot, 'dashboards', dashboardId, 'progress', taskId + '.json');
  try { fs.unlinkSync(progressFile); } catch (e) { /* ignore */ }

  appendLog(dashboardId, {
    task_id: taskId,
    level: 'info',
    message: 'Retrying task: ' + taskId,
    task_name: taskId,
  });

  // Re-dispatch
  if (swarm.state !== 'running') {
    swarm.state = 'running';
  }
  dispatchReady(dashboardId);

  return { success: true };
}

/**
 * Get current swarm state for all dashboards.
 */
function getSwarmStates() {
  var result = {};
  for (var id in activeSwarms) {
    var s = activeSwarms[id];
    result[id] = {
      state: s.state,
      dispatched: Object.keys(s.dispatchedTasks).length,
      completed: Object.keys(s.completedTasks).length,
      failed: Object.keys(s.failedTasks).length,
    };
  }
  return result;
}

/**
 * Check if a dashboard has an active swarm.
 */
function isActive(dashboardId) {
  return !!activeSwarms[dashboardId];
}

/**
 * Process a progress file change — detects completion/failure and triggers dispatch.
 * Called by the watcher integration.
 *
 * @param {string} dashboardId
 * @param {string} taskId
 * @param {object} progressData — parsed progress file
 */
function handleProgressUpdate(dashboardId, taskId, progressData) {
  if (!activeSwarms[dashboardId]) return;

  if (progressData.status === 'completed') {
    onTaskComplete(dashboardId, taskId);
  } else if (progressData.status === 'failed') {
    onTaskFailed(dashboardId, taskId);
  }
}

// --- Helpers ---

function findAgent(init, taskId) {
  if (!init || !init.agents) return null;
  for (var i = 0; i < init.agents.length; i++) {
    if (init.agents[i].id === taskId) return init.agents[i];
  }
  return null;
}

function appendLog(dashboardId, entry) {
  var logsFile = path.join(DASHBOARDS_DIR, dashboardId, 'logs.json');
  var logs;
  try {
    logs = JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
  } catch (e) {
    logs = { entries: [] };
  }

  logs.entries.push({
    timestamp: new Date().toISOString(),
    task_id: entry.task_id || null,
    agent: entry.agent || 'orchestrator',
    level: entry.level || 'info',
    message: entry.message,
    task_name: entry.task_name || null,
  });

  fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2));
}

module.exports = {
  init,
  startSwarm,
  pauseSwarm,
  resumeSwarm,
  cancelSwarm,
  retryTask,
  getSwarmStates,
  isActive,
  handleProgressUpdate,
};
