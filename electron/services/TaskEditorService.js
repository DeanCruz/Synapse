// electron/services/TaskEditorService.js — CRUD operations on initialization.json
// Provides create/update/delete for swarms, tasks, waves, and dependencies.

const fs = require('fs');
const path = require('path');

const { DASHBOARDS_DIR, DEFAULT_INITIALIZATION, DEFAULT_LOGS } = require('../../src/server/utils/constants');
const { readDashboardInit } = require('../../src/server/services/DashboardService');

function getDashboardDir(id) {
  return path.join(DASHBOARDS_DIR, id);
}

function readInit(dashboardId) {
  return readDashboardInit(dashboardId) || JSON.parse(JSON.stringify(DEFAULT_INITIALIZATION));
}

function writeInit(dashboardId, data) {
  var filePath = path.join(getDashboardDir(dashboardId), 'initialization.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Create a new swarm on a dashboard.
 *
 * @param {string} dashboardId
 * @param {object} opts
 * @param {string} opts.name — swarm name
 * @param {string} [opts.type='Waves'] — 'Waves' or 'Chains'
 * @param {string} [opts.directory] — project directory
 * @param {string} [opts.project] — project name
 * @param {string} [opts.prompt] — original prompt
 * @returns {object} — the new initialization data
 */
function createSwarm(dashboardId, opts) {
  var init = {
    task: {
      name: opts.name,
      type: opts.type || 'Waves',
      directory: opts.directory || null,
      prompt: opts.prompt || '',
      project: opts.project || '',
      created: new Date().toISOString(),
      total_tasks: 0,
      total_waves: 0,
    },
    agents: [],
    waves: [],
    chains: [],
    history: [],
  };

  writeInit(dashboardId, init);

  // Reset logs
  var logsPath = path.join(getDashboardDir(dashboardId), 'logs.json');
  fs.writeFileSync(logsPath, JSON.stringify({
    entries: [{
      timestamp: new Date().toISOString(),
      task_id: null,
      agent: 'master',
      level: 'info',
      message: 'Swarm created: ' + opts.name,
      task_name: null,
    }],
  }, null, 2));

  // Clear progress
  var progressDir = path.join(getDashboardDir(dashboardId), 'progress');
  try {
    var files = fs.readdirSync(progressDir);
    for (var i = 0; i < files.length; i++) {
      if (files[i].endsWith('.json')) {
        fs.unlinkSync(path.join(progressDir, files[i]));
      }
    }
  } catch (e) { /* ignore */ }

  return init;
}

/**
 * Add a task to a swarm.
 *
 * @param {string} dashboardId
 * @param {object} task
 * @param {string} task.id — e.g. "1.1"
 * @param {string} task.title
 * @param {number} task.wave — wave number
 * @param {string} [task.layer] — layer label
 * @param {string} [task.directory] — working directory
 * @param {string[]} [task.depends_on] — dependency task IDs
 * @param {string} [task.description] — task description for worker prompt
 * @returns {object} — updated initialization data
 */
function addTask(dashboardId, task) {
  var init = readInit(dashboardId);

  var agent = {
    id: task.id,
    title: task.title,
    wave: task.wave,
    layer: task.layer || '',
    directory: task.directory || '.',
    depends_on: task.depends_on || [],
  };

  // Store description separately for prompt building (not part of standard init schema)
  if (task.description) {
    agent.description = task.description;
  }

  init.agents.push(agent);

  // Ensure the wave exists
  var waveExists = false;
  for (var i = 0; i < init.waves.length; i++) {
    if (init.waves[i].id === task.wave) {
      init.waves[i].total++;
      waveExists = true;
      break;
    }
  }
  if (!waveExists) {
    init.waves.push({ id: task.wave, name: 'Wave ' + task.wave, total: 1 });
    init.waves.sort(function (a, b) { return a.id - b.id; });
  }

  // Update counts
  init.task.total_tasks = init.agents.length;
  init.task.total_waves = init.waves.length;

  writeInit(dashboardId, init);
  return init;
}

/**
 * Update an existing task.
 *
 * @param {string} dashboardId
 * @param {string} taskId — the task ID to update
 * @param {object} updates — fields to merge
 * @returns {object|null} — updated initialization data, or null if task not found
 */
function updateTask(dashboardId, taskId, updates) {
  var init = readInit(dashboardId);

  var found = false;
  for (var i = 0; i < init.agents.length; i++) {
    if (init.agents[i].id === taskId) {
      for (var key in updates) {
        init.agents[i][key] = updates[key];
      }
      found = true;
      break;
    }
  }

  if (!found) return null;

  // Recalculate wave totals
  recalcWaves(init);

  writeInit(dashboardId, init);
  return init;
}

/**
 * Remove a task from a swarm.
 *
 * @param {string} dashboardId
 * @param {string} taskId
 * @returns {object|null} — updated initialization data, or null if not found
 */
function removeTask(dashboardId, taskId) {
  var init = readInit(dashboardId);

  var idx = -1;
  for (var i = 0; i < init.agents.length; i++) {
    if (init.agents[i].id === taskId) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;

  init.agents.splice(idx, 1);

  // Remove from dependency lists
  for (var j = 0; j < init.agents.length; j++) {
    var deps = init.agents[j].depends_on;
    if (deps) {
      var depIdx = deps.indexOf(taskId);
      if (depIdx !== -1) deps.splice(depIdx, 1);
    }
  }

  // Remove progress file if it exists
  var progressFile = path.join(getDashboardDir(dashboardId), 'progress', taskId + '.json');
  try { fs.unlinkSync(progressFile); } catch (e) { /* ignore */ }

  recalcWaves(init);
  writeInit(dashboardId, init);
  return init;
}

/**
 * Add a wave.
 *
 * @param {string} dashboardId
 * @param {object} wave — { name }
 * @returns {object} — updated init
 */
function addWave(dashboardId, wave) {
  var init = readInit(dashboardId);
  var maxId = 0;
  for (var i = 0; i < init.waves.length; i++) {
    if (init.waves[i].id > maxId) maxId = init.waves[i].id;
  }
  init.waves.push({ id: maxId + 1, name: wave.name || ('Wave ' + (maxId + 1)), total: 0 });
  init.task.total_waves = init.waves.length;
  writeInit(dashboardId, init);
  return init;
}

/**
 * Remove a wave and all its tasks.
 *
 * @param {string} dashboardId
 * @param {number} waveId
 * @returns {object|null}
 */
function removeWave(dashboardId, waveId) {
  var init = readInit(dashboardId);

  // Remove agents in this wave
  var removedIds = [];
  init.agents = init.agents.filter(function (a) {
    if (a.wave === waveId) {
      removedIds.push(a.id);
      return false;
    }
    return true;
  });

  // Clean up dependencies
  for (var i = 0; i < init.agents.length; i++) {
    if (init.agents[i].depends_on) {
      init.agents[i].depends_on = init.agents[i].depends_on.filter(function (dep) {
        return removedIds.indexOf(dep) === -1;
      });
    }
  }

  // Remove the wave
  init.waves = init.waves.filter(function (w) { return w.id !== waveId; });

  recalcWaves(init);
  writeInit(dashboardId, init);
  return init;
}

/**
 * Generate the next available task ID for a given wave.
 *
 * @param {string} dashboardId
 * @param {number} waveNum
 * @returns {string} — e.g. "2.3"
 */
function nextTaskId(dashboardId, waveNum) {
  var init = readInit(dashboardId);
  var maxSub = 0;
  for (var i = 0; i < init.agents.length; i++) {
    var parts = init.agents[i].id.split('.');
    if (parseInt(parts[0], 10) === waveNum) {
      var sub = parseInt(parts[1], 10);
      if (sub > maxSub) maxSub = sub;
    }
  }
  return waveNum + '.' + (maxSub + 1);
}

/**
 * Validate the dependency graph for cycles and missing references.
 *
 * @param {string} dashboardId
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateDependencies(dashboardId) {
  var init = readInit(dashboardId);
  var errors = [];
  var agentIds = {};

  for (var i = 0; i < init.agents.length; i++) {
    agentIds[init.agents[i].id] = true;
  }

  // Check for missing references
  for (var j = 0; j < init.agents.length; j++) {
    var deps = init.agents[j].depends_on || [];
    for (var d = 0; d < deps.length; d++) {
      if (!agentIds[deps[d]]) {
        errors.push('Task ' + init.agents[j].id + ' depends on unknown task ' + deps[d]);
      }
    }
  }

  // Check for cycles (BFS/Kahn's algorithm)
  var inDegree = {};
  var adj = {};
  for (var k in agentIds) {
    inDegree[k] = 0;
    adj[k] = [];
  }
  for (var m = 0; m < init.agents.length; m++) {
    var a = init.agents[m];
    var aDeps = a.depends_on || [];
    inDegree[a.id] = aDeps.length;
    for (var n = 0; n < aDeps.length; n++) {
      if (adj[aDeps[n]]) adj[aDeps[n]].push(a.id);
    }
  }

  var queue = [];
  for (var q in inDegree) {
    if (inDegree[q] === 0) queue.push(q);
  }
  var visited = 0;
  while (queue.length > 0) {
    var node = queue.shift();
    visited++;
    var neighbors = adj[node] || [];
    for (var ni = 0; ni < neighbors.length; ni++) {
      inDegree[neighbors[ni]]--;
      if (inDegree[neighbors[ni]] === 0) queue.push(neighbors[ni]);
    }
  }

  if (visited < Object.keys(agentIds).length) {
    errors.push('Dependency cycle detected in the task graph');
  }

  return { valid: errors.length === 0, errors: errors };
}

/**
 * Recalculate wave totals from agents.
 */
function recalcWaves(init) {
  var waveCounts = {};
  for (var i = 0; i < init.agents.length; i++) {
    var w = init.agents[i].wave;
    waveCounts[w] = (waveCounts[w] || 0) + 1;
  }

  // Update existing waves
  for (var j = 0; j < init.waves.length; j++) {
    init.waves[j].total = waveCounts[init.waves[j].id] || 0;
  }

  // Remove empty waves
  init.waves = init.waves.filter(function (w) { return w.total > 0; });

  init.task.total_tasks = init.agents.length;
  init.task.total_waves = init.waves.length;
}

module.exports = {
  createSwarm,
  addTask,
  updateTask,
  removeTask,
  addWave,
  removeWave,
  nextTaskId,
  validateDependencies,
};
