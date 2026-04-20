// electron/services/SwarmOrchestrator.js — Self-managing swarm dispatch engine
// Implements the full dispatch loop: reads dependency graph, dispatches unblocked tasks,
// handles completions/failures, writes logs. Replaces the terminal-based master agent.

const fs = require('fs');
const path = require('path');

const { DASHBOARDS_DIR } = require('../../src/server/utils/constants');
const { readDashboardInit, readDashboardProgress } = require('../../src/server/services/DashboardService');
const ClaudeCodeService = require('./ClaudeCodeService');
const CodexService = require('./CodexService');
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
  CodexService.init(broadcast);
}

/**
 * Start orchestrating a swarm on a dashboard.
 *
 * @param {string} dashboardId
 * @param {object} opts
 * @param {string} opts.projectPath — project directory
 * @param {string} [opts.provider] — active CLI provider
 * @param {string} [opts.model] — model name
 * @param {string} [opts.cliPath] — path to CLI binary
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
    provider: opts.provider || 'claude',
    model: opts.model || '',
    cliPath: opts.cliPath || null,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions || false,
    additionalContextDirs: opts.additionalContextDirs || [],
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
    // Auto-extract knowledge before cleaning up
    try {
      extractSwarmKnowledge(dashboardId, swarm.projectPath);
    } catch (e) {
      appendLog(dashboardId, {
        level: 'warn',
        message: 'Knowledge extraction failed (non-blocking): ' + (e.message || e),
      });
    }
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
  var triggerWave = agent ? agent.wave : null;
  if (agent) {
    for (var fid in swarm.failedTasks) {
      var fa = findAgent(init, fid);
      if (fa && fa.wave === agent.wave) failedInWave++;
    }
  }
  if (failedInWave >= 3) {
    swarm.state = 'replanning';
    appendLog(dashboardId, {
      level: 'warn',
      message: 'Circuit breaker triggered — 3+ failures in Wave ' + triggerWave + '. Entering replan mode.',
    });
    if (broadcastFn) {
      broadcastFn('swarm-state', { dashboardId: dashboardId, state: 'replanning' });
    }
    startReplan(dashboardId, triggerWave);
    return;
  }

  // Also check blast radius: does this failure block >50% of remaining tasks?
  var remainingCount = 0;
  var blockedByThis = 0;
  for (var bi = 0; bi < init.agents.length; bi++) {
    var bAgent = init.agents[bi];
    if (swarm.completedTasks[bAgent.id] || swarm.failedTasks[bAgent.id]) continue;
    if (swarm.dispatchedTasks[bAgent.id]) continue;
    remainingCount++;
    var bDeps = bAgent.depends_on || [];
    for (var bd = 0; bd < bDeps.length; bd++) {
      if (bDeps[bd] === taskId) {
        blockedByThis++;
        break;
      }
    }
  }
  if (blockedByThis >= 3 || (remainingCount > 0 && blockedByThis / remainingCount > 0.5)) {
    swarm.state = 'replanning';
    appendLog(dashboardId, {
      level: 'warn',
      message: 'Circuit breaker triggered — task ' + taskId + ' blocks ' + blockedByThis + '/' + remainingCount + ' remaining tasks. Entering replan mode.',
    });
    if (broadcastFn) {
      broadcastFn('swarm-state', { dashboardId: dashboardId, state: 'replanning' });
    }
    startReplan(dashboardId, triggerWave);
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
    // Auto-extract knowledge even from partially failed swarms
    try {
      extractSwarmKnowledge(dashboardId, swarm.projectPath);
    } catch (e) {
      appendLog(dashboardId, {
        level: 'warn',
        message: 'Knowledge extraction failed (non-blocking): ' + (e.message || e),
      });
    }
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

  var allContexts = ProjectService.getProjectContextWithFallback(
    swarm.projectPath,
    swarm.additionalContextDirs
  );

  // Partition combined contexts into primary project vs additional (read-only) dirs.
  // Primary contexts render under "Project Context"; additional render under "Additional Context (READ-ONLY)".
  var primaryContexts = [];
  var additionalContexts = [];
  var projectPrefix = swarm.projectPath ? path.resolve(swarm.projectPath) + path.sep : null;

  for (var ci = 0; ci < allContexts.length; ci++) {
    if (projectPrefix && allContexts[ci].path.indexOf(projectPrefix) === 0) {
      primaryContexts.push(allContexts[ci]);
    } else {
      additionalContexts.push(allContexts[ci]);
    }
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
      projectPath: swarm.projectPath,
      additionalContextDirs: swarm.additionalContextDirs,
    });

    var taskPrompt = PromptBuilder.buildTaskPrompt({
      task: agent,
      taskDescription: agent.description || '',
      projectContexts: primaryContexts,
      upstreamResults: upstreamResults,
      additionalContextPaths: additionalContexts,
      projectPath: swarm.projectPath,
    });

    appendLog(dashboardId, {
      task_id: taskId,
      level: 'info',
      message: 'Dispatching: ' + agent.title,
      task_name: agent.title,
    });

    // Spawn the worker
    var service = swarm.provider === 'codex' ? CodexService : ClaudeCodeService;
    service.spawnWorker({
      provider: swarm.provider,
      taskId: taskId,
      dashboardId: dashboardId,
      projectDir: swarm.projectPath,
      prompt: taskPrompt,
      systemPrompt: systemPrompt,
      model: swarm.model,
      cliPath: swarm.cliPath,
      dangerouslySkipPermissions: swarm.dangerouslySkipPermissions,
      additionalContextDirs: swarm.additionalContextDirs,
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
  workers = workers.concat(CodexService.getActiveWorkers());
  for (var i = 0; i < workers.length; i++) {
    if (workers[i].dashboardId === dashboardId) {
      if (!ClaudeCodeService.killWorker(workers[i].pid)) {
        CodexService.killWorker(workers[i].pid);
      }
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

// --- Replanning ---

/**
 * Spawn a Claude CLI process to analyze failures and produce a revised plan.
 * On success, applies the revised plan to initialization.json and resumes dispatch.
 */
function startReplan(dashboardId, triggerWave) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return;

  var init = readDashboardInit(dashboardId);
  var progress = readDashboardProgress(dashboardId);

  var replanPrompt = PromptBuilder.buildReplanPrompt({
    dashboardId: dashboardId,
    init: init,
    progress: progress,
    failedTasks: swarm.failedTasks,
    completedTasks: swarm.completedTasks,
    failedInWave: triggerWave,
  });

  var replanSystem = PromptBuilder.buildReplanSystemPrompt();

  appendLog(dashboardId, {
    level: 'info',
    message: 'Spawning replanner CLI to analyze failures and revise plan...',
  });

  var cliPath = swarm.cliPath || 'claude';
  var args = [
    '--print',
    '--output-format', 'text',
  ];

  if (swarm.model) {
    args.push('--model', swarm.model);
  }

  if (swarm.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  args.push('--append-system-prompt', replanSystem);

  var env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;

  var proc = require('child_process').spawn(cliPath, args, {
    cwd: swarm.projectPath || process.cwd(),
    env: env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Send the replan prompt via stdin
  proc.stdin.write(replanPrompt);
  proc.stdin.end();

  var output = '';
  var errorOutput = '';

  proc.stdout.on('data', function (chunk) {
    output += chunk.toString();
  });

  proc.stderr.on('data', function (chunk) {
    errorOutput += chunk.toString();
  });

  proc.on('close', function (code) {
    if (!activeSwarms[dashboardId]) return; // swarm was cancelled during replan

    if (code !== 0) {
      appendLog(dashboardId, {
        level: 'error',
        message: 'Replanner CLI exited with code ' + code + '. Pausing swarm for manual intervention.',
      });
      swarm.state = 'paused';
      if (broadcastFn) {
        broadcastFn('swarm-state', { dashboardId: dashboardId, state: 'paused' });
      }
      return;
    }

    // Parse the JSON output from the replanner
    var replan = null;
    try {
      // Strip markdown fences if the model wrapped it anyway
      var cleaned = output.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      replan = JSON.parse(cleaned);
    } catch (e) {
      appendLog(dashboardId, {
        level: 'error',
        message: 'Replanner output was not valid JSON. Pausing swarm. Output: ' + output.substring(0, 200),
      });
      swarm.state = 'paused';
      if (broadcastFn) {
        broadcastFn('swarm-state', { dashboardId: dashboardId, state: 'paused' });
      }
      return;
    }

    applyReplan(dashboardId, replan);
  });

  proc.on('error', function (err) {
    if (!activeSwarms[dashboardId]) return;
    appendLog(dashboardId, {
      level: 'error',
      message: 'Replanner CLI failed to spawn: ' + err.message + '. Pausing swarm.',
    });
    swarm.state = 'paused';
    if (broadcastFn) {
      broadcastFn('swarm-state', { dashboardId: dashboardId, state: 'paused' });
    }
  });
}

/**
 * Apply a replan result to initialization.json and the swarm state,
 * then resume dispatching.
 *
 * @param {string} dashboardId
 * @param {object} replan — { summary, modified, added, removed, retry }
 */
function applyReplan(dashboardId, replan) {
  var swarm = activeSwarms[dashboardId];
  if (!swarm) return;

  var init = readDashboardInit(dashboardId);
  if (!init || !init.agents) {
    swarm.state = 'paused';
    return;
  }

  var summary = replan.summary || 'No summary provided';
  appendLog(dashboardId, {
    level: 'info',
    message: 'Replanner analysis: ' + summary,
  });

  var modified = replan.modified || [];
  var added = replan.added || [];
  var removed = replan.removed || [];
  var retry = replan.retry || [];

  // 1. Remove tasks
  if (removed.length > 0) {
    var removedSet = {};
    for (var r = 0; r < removed.length; r++) removedSet[removed[r]] = true;

    init.agents = init.agents.filter(function (a) { return !removedSet[a.id]; });

    // Clean up depends_on references pointing at removed tasks
    for (var ra = 0; ra < init.agents.length; ra++) {
      if (init.agents[ra].depends_on) {
        init.agents[ra].depends_on = init.agents[ra].depends_on.filter(function (dep) {
          return !removedSet[dep];
        });
      }
    }

    // Clean up swarm tracking for removed tasks
    for (var ri = 0; ri < removed.length; ri++) {
      delete swarm.failedTasks[removed[ri]];
      delete swarm.completedTasks[removed[ri]];
      delete swarm.dispatchedTasks[removed[ri]];
    }

    appendLog(dashboardId, {
      level: 'info',
      message: 'Removed ' + removed.length + ' task(s) from plan: ' + removed.join(', '),
    });
  }

  // 2. Modify existing tasks
  if (modified.length > 0) {
    for (var m = 0; m < modified.length; m++) {
      var mod = modified[m];
      for (var mi = 0; mi < init.agents.length; mi++) {
        if (init.agents[mi].id === mod.id) {
          // Merge only the fields provided in the modification
          if (mod.title !== undefined) init.agents[mi].title = mod.title;
          if (mod.description !== undefined) init.agents[mi].description = mod.description;
          if (mod.depends_on !== undefined) init.agents[mi].depends_on = mod.depends_on;
          if (mod.wave !== undefined) init.agents[mi].wave = mod.wave;
          if (mod.layer !== undefined) init.agents[mi].layer = mod.layer;
          break;
        }
      }
    }

    appendLog(dashboardId, {
      level: 'info',
      message: 'Modified ' + modified.length + ' task(s): ' + modified.map(function (m) { return m.id; }).join(', '),
    });
  }

  // 3. Add new tasks (repair/replacement tasks)
  if (added.length > 0) {
    for (var a = 0; a < added.length; a++) {
      init.agents.push(added[a]);
    }

    // Update wave totals
    for (var wa = 0; wa < added.length; wa++) {
      var addedWave = added[wa].wave;
      if (addedWave && init.waves) {
        var waveFound = false;
        for (var wi = 0; wi < init.waves.length; wi++) {
          if (init.waves[wi].id === addedWave) {
            init.waves[wi].total = (init.waves[wi].total || 0) + 1;
            waveFound = true;
            break;
          }
        }
        if (!waveFound) {
          init.waves.push({ id: addedWave, name: 'Wave ' + addedWave, total: 1 });
        }
      }
    }

    appendLog(dashboardId, {
      level: 'info',
      message: 'Added ' + added.length + ' new task(s): ' + added.map(function (a) { return a.id; }).join(', '),
    });
  }

  // 4. Handle retries (clear failed state, delete old progress file)
  if (retry.length > 0) {
    for (var rt = 0; rt < retry.length; rt++) {
      var retryId = retry[rt];
      delete swarm.failedTasks[retryId];

      // Delete old progress file so the worker starts fresh
      var progressFile = path.join(swarm.trackerRoot, 'dashboards', dashboardId, 'progress', retryId + '.json');
      try { fs.unlinkSync(progressFile); } catch (e) { /* ignore */ }
    }

    appendLog(dashboardId, {
      level: 'info',
      message: 'Retrying ' + retry.length + ' task(s): ' + retry.join(', '),
    });
  }

  // 5. Update total_tasks count
  if (init.task) {
    init.task.total_tasks = init.agents.length;
  }

  // 6. Write updated initialization.json
  var initFile = path.join(DASHBOARDS_DIR, dashboardId, 'initialization.json');
  fs.writeFileSync(initFile, JSON.stringify(init, null, 2));

  appendLog(dashboardId, {
    level: 'info',
    message: 'Replan applied. Resuming swarm dispatch.',
  });

  // 7. Resume dispatching
  swarm.state = 'running';
  if (broadcastFn) {
    broadcastFn('swarm-state', { dashboardId: dashboardId, state: 'running' });
  }
  dispatchReady(dashboardId);
}

// --- Post-Swarm Knowledge Extraction ---

/**
 * Extract knowledge from a completed swarm and persist it to the project's PKI.
 * Harvests worker annotations from progress files, generates swarm-level insights,
 * and merges everything into the project's .synapse/knowledge/ directory.
 *
 * @param {string} dashboardId
 * @param {string} projectPath — target project directory
 */
function extractSwarmKnowledge(dashboardId, projectPath) {
  if (!projectPath) return;

  var knowledgeDir = path.join(projectPath, '.synapse', 'knowledge');
  var insightsDir = path.join(knowledgeDir, 'insights');
  var annotationsDir = path.join(knowledgeDir, 'annotations');
  var manifestPath = path.join(knowledgeDir, 'manifest.json');

  // Ensure directories exist
  try {
    fs.mkdirSync(path.join(projectPath, '.synapse'), { recursive: true });
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.mkdirSync(insightsDir, { recursive: true });
    fs.mkdirSync(annotationsDir, { recursive: true });
  } catch (e) {
    // Best-effort — don't block completion
    return;
  }

  var init = readDashboardInit(dashboardId);
  var progress = readDashboardProgress(dashboardId);
  if (!init || !progress) return;

  var taskSlug = (init.task && init.task.name) || dashboardId;
  var now = new Date().toISOString();
  var datePrefix = now.substring(0, 10);

  // 1. Harvest worker annotations from progress files
  var harvestedAnnotations = {};
  var annotationCount = 0;
  var allDeviations = [];
  var allFilesChanged = [];
  var completedCount = 0;
  var failedCount = 0;

  for (var taskId in progress) {
    var prog = progress[taskId];
    if (!prog) continue;

    if (prog.status === 'completed') completedCount++;
    if (prog.status === 'failed') failedCount++;

    // Collect annotations
    if (prog.annotations) {
      for (var filePath in prog.annotations) {
        if (!harvestedAnnotations[filePath]) {
          harvestedAnnotations[filePath] = { gotchas: [], patterns: [], conventions: [] };
        }
        var ann = prog.annotations[filePath];
        if (ann.gotchas) {
          for (var gi = 0; gi < ann.gotchas.length; gi++) {
            if (harvestedAnnotations[filePath].gotchas.indexOf(ann.gotchas[gi]) === -1) {
              harvestedAnnotations[filePath].gotchas.push(ann.gotchas[gi]);
              annotationCount++;
            }
          }
        }
        if (ann.patterns) {
          for (var pi = 0; pi < ann.patterns.length; pi++) {
            if (harvestedAnnotations[filePath].patterns.indexOf(ann.patterns[pi]) === -1) {
              harvestedAnnotations[filePath].patterns.push(ann.patterns[pi]);
            }
          }
        }
        if (ann.conventions) {
          for (var ci = 0; ci < ann.conventions.length; ci++) {
            if (harvestedAnnotations[filePath].conventions.indexOf(ann.conventions[ci]) === -1) {
              harvestedAnnotations[filePath].conventions.push(ann.conventions[ci]);
            }
          }
        }
      }
    }

    // Collect deviations for insight extraction
    if (prog.deviations) {
      for (var di = 0; di < prog.deviations.length; di++) {
        allDeviations.push({
          task_id: taskId,
          deviation: prog.deviations[di],
        });
      }
    }

    // Collect files changed
    if (prog.files_changed) {
      for (var fi = 0; fi < prog.files_changed.length; fi++) {
        var fc = prog.files_changed[fi];
        if (fc.path && allFilesChanged.indexOf(fc.path) === -1) {
          allFilesChanged.push(fc.path);
        }
      }
    }
  }

  // 2. Build swarm insights from deviations and execution data
  var insights = {
    dependency_insights: [],
    complexity_surprises: [],
    failure_patterns: [],
    effective_patterns: [],
    architecture_notes: [],
  };

  // Extract dependency insights from CRITICAL deviations
  for (var dvi = 0; dvi < allDeviations.length; dvi++) {
    var dev = allDeviations[dvi];
    var desc = dev.deviation.description || '';
    var severity = dev.deviation.severity || 'MINOR';

    if (severity === 'CRITICAL') {
      insights.dependency_insights.push({
        description: desc,
        discovered_by: dev.task_id,
        severity: severity,
        affected_files: dev.deviation.affected_files || [],
      });
    } else if (severity === 'MODERATE') {
      insights.architecture_notes.push({
        description: desc,
        discovered_by: dev.task_id,
        severity: severity,
      });
    }
  }

  // Extract failure patterns from failed tasks
  for (var fpId in progress) {
    var fpProg = progress[fpId];
    if (fpProg && fpProg.status === 'failed') {
      var failDesc = fpProg.summary || fpProg.message || 'Unknown failure';
      insights.failure_patterns.push({
        description: failDesc,
        task_id: fpId,
        stage: fpProg.stage || 'unknown',
      });
    }
  }

  // 3. Write insights file
  var insightData = {
    swarm_name: taskSlug,
    completed_at: now,
    dashboard_id: dashboardId,
    total_tasks: (init.agents || []).length,
    completed_tasks: completedCount,
    failed_tasks: failedCount,
    files_changed: allFilesChanged,
    insights: insights,
    worker_annotations_harvested: annotationCount,
  };

  var insightFilename = datePrefix + '_' + taskSlug.replace(/[^a-z0-9_-]/gi, '-') + '.json';
  var insightFilePath = path.join(insightsDir, insightFilename);
  try {
    fs.writeFileSync(insightFilePath, JSON.stringify(insightData, null, 2));
  } catch (e) { /* best-effort */ }

  // 4. Merge worker annotations into PKI manifest
  var manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    manifest = null;
  }

  if (manifest && manifest.files) {
    var manifestChanged = false;

    for (var annFile in harvestedAnnotations) {
      var entry = manifest.files[annFile];
      if (entry && entry.hash) {
        // Merge into existing annotation
        var annPath = path.join(annotationsDir, entry.hash + '.json');
        var existing;
        try {
          existing = JSON.parse(fs.readFileSync(annPath, 'utf-8'));
        } catch (e) {
          existing = { file: annFile, gotchas: [], patterns: [], conventions: [] };
        }

        var harvested = harvestedAnnotations[annFile];
        var changed = false;

        // Merge gotchas (deduplicate)
        if (harvested.gotchas.length > 0) {
          if (!existing.gotchas) existing.gotchas = [];
          for (var mg = 0; mg < harvested.gotchas.length; mg++) {
            if (existing.gotchas.indexOf(harvested.gotchas[mg]) === -1) {
              existing.gotchas.push(harvested.gotchas[mg]);
              changed = true;
            }
          }
        }

        // Merge patterns
        if (harvested.patterns.length > 0) {
          if (!existing.patterns) existing.patterns = [];
          for (var mp = 0; mp < harvested.patterns.length; mp++) {
            if (existing.patterns.indexOf(harvested.patterns[mp]) === -1) {
              existing.patterns.push(harvested.patterns[mp]);
              changed = true;
            }
          }
        }

        // Merge conventions
        if (harvested.conventions.length > 0) {
          if (!existing.conventions) existing.conventions = [];
          for (var mc = 0; mc < harvested.conventions.length; mc++) {
            if (existing.conventions.indexOf(harvested.conventions[mc]) === -1) {
              existing.conventions.push(harvested.conventions[mc]);
              changed = true;
            }
          }
        }

        if (changed) {
          existing.annotated_at = now;
          existing.annotated_by = 'swarm:' + taskSlug;
          try {
            fs.writeFileSync(annPath, JSON.stringify(existing, null, 2));
          } catch (e) { /* best-effort */ }
          manifestChanged = true;
        }
      }
    }

    // Update insights_index in manifest
    if (!manifest.insights_index) manifest.insights_index = [];
    manifest.insights_index.push({
      file: 'insights/' + insightFilename,
      swarm_name: taskSlug,
      date: datePrefix,
      insight_count: insights.dependency_insights.length + insights.complexity_surprises.length +
        insights.failure_patterns.length + insights.effective_patterns.length +
        insights.architecture_notes.length,
      files_changed_count: allFilesChanged.length,
    });

    // Cap at 50 entries
    if (manifest.insights_index.length > 50) {
      manifest.insights_index = manifest.insights_index.slice(-50);
    }

    manifest.updated_at = now;
    manifestChanged = true;

    if (manifestChanged) {
      try {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      } catch (e) { /* best-effort */ }
    }
  }

  appendLog(dashboardId, {
    level: 'info',
    message: 'Knowledge extracted: ' + annotationCount + ' annotations harvested, ' +
      (insights.dependency_insights.length + insights.failure_patterns.length +
       insights.effective_patterns.length + insights.architecture_notes.length) +
      ' insights captured, PKI updated at ' + knowledgeDir,
  });
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
  extractSwarmKnowledge,
};
