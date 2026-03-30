// electron/services/ClaudeCodeService.js — Claude Code CLI process management

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
  console.log('[ClaudeCodeService] init() called, broadcastFn set:', !!broadcast);
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
 * @param {string} [opts.model] — model to use
 * @param {string} [opts.cliPath] — path to Claude binary
 * @param {boolean} [opts.dangerouslySkipPermissions] — skip permission prompts
 * @param {string[]} [opts.additionalContextDirs] — additional read-only context directories
 * @returns {{ pid, taskId, dashboardId }}
 */
function spawnWorker(opts) {
  var cliPath = opts.cliPath || 'claude';
  console.log('[ClaudeCodeService] spawnWorker() cliPath:', cliPath, 'broadcastFn set:', !!broadcastFn);
  var args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
  ];

  if (opts.model) {
    args.push('--model', opts.model);
  }

  if (opts.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  } else {
    // Non-bypass mode: relay permission prompts via stdin/stdout JSON
    args.push('--permission-prompt-tool', 'stdio');
    args.push('--input-format', 'stream-json');
  }

  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  }

  // Always add Synapse directory first — agent needs access to commands and instructions
  var synapseRoot = path.resolve(__dirname, '../..');
  args.push('--add-dir', synapseRoot);

  // Then add the target project directory if different from Synapse
  var resolvedProjectDir = opts.projectDir ? path.resolve(opts.projectDir) : null;
  if (resolvedProjectDir && resolvedProjectDir !== synapseRoot) {
    args.push('--add-dir', opts.projectDir);
  }

  // Add additional context directories (read-only reference dirs)
  var additionalDirs = opts.additionalContextDirs || [];
  for (var i = 0; i < additionalDirs.length; i++) {
    var resolvedDir = path.resolve(additionalDirs[i]);
    // Deduplicate: skip if already added as synapseRoot or projectDir
    if (resolvedDir === synapseRoot) continue;
    if (resolvedProjectDir && resolvedDir === resolvedProjectDir) continue;
    args.push('--add-dir', resolvedDir);
  }

  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
  }

  // Prompt will be passed via stdin to avoid arg parsing issues
  var promptText = opts.prompt;

  var env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;

  console.log('[ClaudeCodeService] Spawning cliPath:', cliPath);
  console.log('[ClaudeCodeService] Full args:', JSON.stringify(args));
  console.log('[ClaudeCodeService] CWD:', opts.projectDir || process.cwd());

  var proc = spawn(cliPath, args, {
    cwd: opts.projectDir || process.cwd(),
    env: env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  console.log('[ClaudeCodeService] Process spawned, PID:', proc.pid);

  // Write prompt via stdin — avoids arg parsing issues with flags
  // When keepStdinOpen is true (non-bypass mode), leave stdin open for permission relay
  var keepStdinOpen = opts.keepStdinOpen != null ? opts.keepStdinOpen : !opts.dangerouslySkipPermissions;
  if (keepStdinOpen) {
    // stream-json mode: wrap prompt in NDJSON user message envelope
    var userMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: promptText } });
    proc.stdin.write(userMsg + '\n');
  } else {
    // Bypass mode: plain text prompt
    proc.stdin.write(promptText);
    proc.stdin.end();
  }

  // Safety timeout: if no stdout within 10s, log a warning
  var gotOutput = false;
  setTimeout(function () {
    if (!gotOutput && activeWorkers[proc.pid]) {
      console.warn('[ClaudeCodeService] WARNING: No stdout received after 10s from PID:', proc.pid);
      console.warn('[ClaudeCodeService] stderr so far:', worker.errorOutput || '(empty)');
    }
  }, 10000);

  var worker = {
    provider: 'claude',
    taskId: opts.taskId,
    dashboardId: opts.dashboardId,
    process: proc,
    pid: proc.pid,
    startedAt: new Date().toISOString(),
    output: '',
    errorOutput: '',
    lineBuffer: '',
  };

  activeWorkers[proc.pid] = worker;

  // Stream stdout — buffer NDJSON lines and emit parsed events
  proc.stdout.on('data', function (chunk) {
    gotOutput = true;
    var text = chunk.toString();
    console.log('[ClaudeCodeService] stdout chunk (' + text.length + ' bytes) from PID:', proc.pid);
    worker.output += text;
    worker.lineBuffer += text;

    // Split on newlines and process complete lines
    var lines = worker.lineBuffer.split('\n');
    // Last element is incomplete (or empty if chunk ended with \n)
    worker.lineBuffer = lines.pop() || '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var parsed = null;
      try { parsed = JSON.parse(line); } catch (e) { /* not valid JSON yet */ }

      if (broadcastFn) {
        var eventType = parsed ? parsed.type : 'raw';
        console.log('[ClaudeCodeService] Broadcasting worker-output, event type:', eventType, 'taskId:', opts.taskId);
        broadcastFn('worker-output', {
          pid: proc.pid,
          provider: 'claude',
          taskId: opts.taskId,
          dashboardId: opts.dashboardId,
          chunk: line + '\n',
          parsed: parsed,
        });
      } else {
        console.warn('[ClaudeCodeService] broadcastFn is NULL — output lost!');
      }
    }
  });

  proc.stderr.on('data', function (chunk) {
    var errText = chunk.toString();
    console.log('[ClaudeCodeService] stderr from PID', proc.pid, ':', errText.substring(0, 200));
    worker.errorOutput += errText;

    // Forward stderr as status updates so the UI can show tool execution activity
    if (broadcastFn) {
      broadcastFn('worker-output', {
        pid: proc.pid,
        provider: 'claude',
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        chunk: errText,
        isStderr: true,
      });
    }
  });

  proc.on('close', function (code) {
    var exitCode = code == null ? 0 : code;
    console.log('[ClaudeCodeService] Process closed, PID:', proc.pid, 'exit code:', exitCode);

    // Flush any remaining data in the line buffer — the last chunk from the CLI
    // may not end with a newline, leaving events (result, content_block_start, etc.)
    // silently stuck in the buffer.
    if (worker.lineBuffer && worker.lineBuffer.trim()) {
      var remaining = worker.lineBuffer.trim();
      worker.lineBuffer = '';
      var parsed = null;
      try { parsed = JSON.parse(remaining); } catch (e) { /* not valid JSON */ }
      if (broadcastFn) {
        broadcastFn('worker-output', {
          pid: proc.pid,
          provider: 'claude',
          taskId: opts.taskId,
          dashboardId: opts.dashboardId,
          chunk: remaining + '\n',
          parsed: parsed,
        });
      }
    }

    delete activeWorkers[proc.pid];
    if (broadcastFn) {
      broadcastFn('worker-complete', {
        pid: proc.pid,
        provider: 'claude',
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        exitCode: exitCode,
        output: worker.output,
        errorOutput: worker.errorOutput,
      });
    }
  });

  proc.on('error', function (err) {
    console.error('[ClaudeCodeService] Process error, PID:', proc.pid, 'error:', err.message);
    delete activeWorkers[proc.pid];

    if (broadcastFn) {
      broadcastFn('worker-error', {
        pid: proc.pid,
        provider: 'claude',
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
      provider: w.provider,
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

/**
 * Write data to a worker's stdin (for permission relay).
 * @param {number} pid — worker process PID
 * @param {string} data — data to write to stdin
 * @returns {boolean}
 */
function writeToWorker(pid, data) {
  var worker = activeWorkers[pid];
  if (!worker) return false;
  try {
    worker.process.stdin.write(data);
    return true;
  } catch (e) {
    console.error('[ClaudeCodeService] writeToWorker error, pid:', pid, 'error:', e.message);
    return false;
  }
}

module.exports = {
  init,
  spawnWorker,
  killWorker,
  killAllWorkers,
  getActiveWorkers,
  getActiveCountForDashboard,
  writeToWorker,
};

function buildArgs(opts) {
  var claudeArgs = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
  ];

  if (opts.model) {
    claudeArgs.push('--model', opts.model);
  }
  if (opts.dangerouslySkipPermissions) {
    claudeArgs.push('--dangerously-skip-permissions');
  }
  if (opts.resumeSessionId) {
    claudeArgs.push('--resume', opts.resumeSessionId);
  }
  if (opts.projectDir) {
    claudeArgs.push('--add-dir', opts.projectDir);
  }
  if (opts.systemPrompt) {
    claudeArgs.push('--append-system-prompt', opts.systemPrompt);
  }
  return claudeArgs;
}
