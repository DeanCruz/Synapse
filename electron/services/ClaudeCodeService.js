// electron/services/ClaudeCodeService.js — Claude Code CLI process management
// Spawns Claude Code CLI processes as worker agents, streams output, manages lifecycle.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

var activeWorkers = {};   // pid -> { taskId, dashboardId, process, ... }
var broadcastFn = null;

/**
 * Initialize with a broadcast function for sending events to renderer.
 * @param {Function} broadcast — (channel, data) => void
 */
function init(broadcast) {
  broadcastFn = broadcast;
}

/**
 * Spawn a Claude Code CLI worker for a task.
 *
 * @param {object} opts
 * @param {string} opts.taskId — e.g. "1.1"
 * @param {string} opts.dashboardId — e.g. "dashboard1"
 * @param {string} opts.projectDir — codebase directory
 * @param {string} opts.prompt — the task prompt
 * @param {string} opts.systemPrompt — system prompt (worker instructions + context)
 * @param {string} [opts.model] — Claude model to use
 * @param {string} [opts.cliPath] — path to claude binary
 * @param {boolean} [opts.dangerouslySkipPermissions] — skip permission prompts
 * @returns {{ pid, taskId, dashboardId }}
 */
function spawnWorker(opts) {
  var cliPath = opts.cliPath || 'claude';
  var args = [
    '--print',
    '--output-format', 'stream-json',
  ];

  if (opts.model) {
    args.push('--model', opts.model);
  }

  if (opts.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  if (opts.projectDir) {
    args.push('--add-dir', opts.projectDir);
  }

  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
  }

  // The prompt is the final argument
  args.push(opts.prompt);

  var proc = spawn(cliPath, args, {
    cwd: opts.projectDir || process.cwd(),
    env: Object.assign({}, process.env, {
      // Ensure Electron doesn't interfere with spawned CLI
      ELECTRON_RUN_AS_NODE: undefined,
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  var worker = {
    taskId: opts.taskId,
    dashboardId: opts.dashboardId,
    process: proc,
    pid: proc.pid,
    startedAt: new Date().toISOString(),
    output: '',
    errorOutput: '',
  };

  activeWorkers[proc.pid] = worker;

  // Stream stdout to renderer
  proc.stdout.on('data', function (chunk) {
    var text = chunk.toString();
    worker.output += text;
    if (broadcastFn) {
      broadcastFn('worker-output', {
        pid: proc.pid,
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        chunk: text,
      });
    }
  });

  proc.stderr.on('data', function (chunk) {
    worker.errorOutput += chunk.toString();
  });

  proc.on('close', function (code) {
    var exitCode = code;
    delete activeWorkers[proc.pid];

    if (broadcastFn) {
      broadcastFn('worker-complete', {
        pid: proc.pid,
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        exitCode: exitCode,
        output: worker.output,
        errorOutput: worker.errorOutput,
      });
    }
  });

  proc.on('error', function (err) {
    delete activeWorkers[proc.pid];

    if (broadcastFn) {
      broadcastFn('worker-error', {
        pid: proc.pid,
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        error: err.message,
      });
    }
  });

  return { pid: proc.pid, taskId: opts.taskId, dashboardId: opts.dashboardId };
}

/**
 * Kill a specific worker by PID.
 * @param {number} pid
 * @returns {boolean}
 */
function killWorker(pid) {
  var worker = activeWorkers[pid];
  if (!worker) return false;
  try {
    worker.process.kill('SIGTERM');
    // Force kill after 5s if still running
    setTimeout(function () {
      try { worker.process.kill('SIGKILL'); } catch (e) { /* already dead */ }
    }, 5000);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Kill all active workers.
 * @returns {number} — count of workers killed
 */
function killAllWorkers() {
  var pids = Object.keys(activeWorkers);
  var killed = 0;
  for (var i = 0; i < pids.length; i++) {
    if (killWorker(Number(pids[i]))) killed++;
  }
  return killed;
}

/**
 * Get list of active workers.
 * @returns {{ pid, taskId, dashboardId, startedAt }[]}
 */
function getActiveWorkers() {
  var result = [];
  for (var pid in activeWorkers) {
    var w = activeWorkers[pid];
    result.push({
      pid: Number(pid),
      taskId: w.taskId,
      dashboardId: w.dashboardId,
      startedAt: w.startedAt,
    });
  }
  return result;
}

/**
 * Get count of active workers for a specific dashboard.
 * @param {string} dashboardId
 * @returns {number}
 */
function getActiveCountForDashboard(dashboardId) {
  var count = 0;
  for (var pid in activeWorkers) {
    if (activeWorkers[pid].dashboardId === dashboardId) count++;
  }
  return count;
}

module.exports = {
  init,
  spawnWorker,
  killWorker,
  killAllWorkers,
  getActiveWorkers,
  getActiveCountForDashboard,
};
