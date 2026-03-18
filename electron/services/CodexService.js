// electron/services/CodexService.js — Codex CLI process management

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

var activeWorkers = {};
var broadcastFn = null;

function init(broadcast) {
  broadcastFn = broadcast;
  console.log('[CodexService] init() called, broadcastFn set:', !!broadcast);
}

function spawnWorker(opts) {
  var cliPath = opts.cliPath || 'codex';
  var args = buildArgs(opts);
  var promptText = buildPromptText(opts);
  var outputLastMessagePath = path.join(
    os.tmpdir(),
    'synapse_codex_last_message_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.txt'
  );
  args.push('-o', outputLastMessagePath);

  var env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;

  console.log('[CodexService] Spawning cliPath:', cliPath);
  console.log('[CodexService] Full args:', JSON.stringify(args));
  console.log('[CodexService] CWD:', opts.projectDir || process.cwd());

  var proc = spawn(cliPath, args, {
    cwd: opts.projectDir || process.cwd(),
    env: env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdin.write(promptText);
  proc.stdin.end();

  var worker = {
    provider: 'codex',
    taskId: opts.taskId,
    dashboardId: opts.dashboardId,
    process: proc,
    pid: proc.pid,
    startedAt: new Date().toISOString(),
    output: '',
    errorOutput: '',
    lineBuffer: '',
    outputLastMessagePath: outputLastMessagePath,
  };

  activeWorkers[proc.pid] = worker;

  proc.stdout.on('data', function (chunk) {
    var text = chunk.toString();
    worker.output += text;
    worker.lineBuffer += text;

    var lines = worker.lineBuffer.split('\n');
    worker.lineBuffer = lines.pop() || '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var parsed = null;
      try { parsed = JSON.parse(line); } catch (e) { /* ignore */ }

      if (broadcastFn) {
        broadcastFn('worker-output', {
          pid: proc.pid,
          provider: 'codex',
          taskId: opts.taskId,
          dashboardId: opts.dashboardId,
          chunk: line + '\n',
          parsed: parsed,
        });
      }
    }
  });

  proc.stderr.on('data', function (chunk) {
    worker.errorOutput += chunk.toString();
  });

  proc.on('close', function (code) {
    delete activeWorkers[proc.pid];

    var lastMessage = null;
    try {
      lastMessage = fs.readFileSync(worker.outputLastMessagePath, 'utf-8');
    } catch (e) { /* ignore */ }
    try {
      fs.unlinkSync(worker.outputLastMessagePath);
    } catch (e) { /* ignore */ }

    if (broadcastFn) {
      broadcastFn('worker-complete', {
        pid: proc.pid,
        provider: 'codex',
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        exitCode: code == null ? 0 : code,
        output: worker.output,
        errorOutput: cleanErrorOutput(worker.errorOutput),
        lastMessage: lastMessage,
      });
    }
  });

  proc.on('error', function (err) {
    delete activeWorkers[proc.pid];
    if (broadcastFn) {
      broadcastFn('worker-error', {
        pid: proc.pid,
        provider: 'codex',
        taskId: opts.taskId,
        dashboardId: opts.dashboardId,
        error: err.message,
      });
    }
  });

  return { pid: proc.pid, taskId: opts.taskId, dashboardId: opts.dashboardId };
}

function killWorker(pid) {
  var worker = activeWorkers[pid];
  if (!worker) return false;
  try {
    worker.process.kill('SIGTERM');
    setTimeout(function () {
      try { worker.process.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }, 5000);
    return true;
  } catch (e) {
    return false;
  }
}

function killAllWorkers() {
  var pids = Object.keys(activeWorkers);
  var killed = 0;
  for (var i = 0; i < pids.length; i++) {
    if (killWorker(Number(pids[i]))) killed++;
  }
  return killed;
}

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

function buildArgs(opts) {
  var args = opts.resumeSessionId
    ? ['exec', 'resume', '--json']
    : ['exec', '--json'];

  if (opts.model) {
    args.push('--model', opts.model);
  }
  if (opts.dangerouslySkipPermissions) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--full-auto');
  }
  if (!opts.resumeSessionId && opts.projectDir) {
    args.push('-C', opts.projectDir);
  }
  args.push('--skip-git-repo-check');
  if (opts.resumeSessionId) {
    args.push(opts.resumeSessionId);
  }
  return args;
}

function buildPromptText(opts) {
  if (!opts.systemPrompt) {
    return opts.prompt;
  }
  return [
    'Follow these operating instructions exactly:',
    opts.systemPrompt,
    '',
    'User request:',
    opts.prompt,
  ].join('\n');
}

function cleanErrorOutput(errorOutput) {
  if (!errorOutput) return '';
  return errorOutput
    .split('\n')
    .filter(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed === 'Reading prompt from stdin...') return false;
      return true;
    })
    .join('\n')
    .trim();
}

module.exports = {
  init,
  spawnWorker,
  killWorker,
  killAllWorkers,
  getActiveWorkers,
};
