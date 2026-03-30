// electron/services/TerminalService.js — PTY terminal session management

var pty = require('node-pty');
var activeTerminals = {};   // id -> { id, process, cols, rows, cwd, shell, startedAt }
var broadcastFn = null;

/**
 * Initialize with a broadcast function for sending events to renderer.
 * @param {Function} broadcast — (channel, data) => void
 */
function init(broadcast) {
  broadcastFn = broadcast;
  console.log('[TerminalService] init() called, broadcastFn set:', !!broadcast);
}

/**
 * Spawn a new PTY terminal session.
 *
 * @param {object} opts
 * @param {string} [opts.cwd] — working directory (defaults to process.cwd())
 * @param {number} [opts.cols] — terminal columns (default 80)
 * @param {number} [opts.rows] — terminal rows (default 24)
 * @param {string} [opts.shell] — shell to use (defaults to SHELL env or /bin/zsh)
 * @returns {{ id, pid, shell, cwd, cols, rows }}
 */
function spawnTerminal(opts) {
  opts = opts || {};

  var shell = opts.shell || process.env.SHELL || '/bin/zsh';
  var cols = opts.cols || 80;
  var rows = opts.rows || 24;
  var cwd = opts.cwd || process.cwd();
  var id = 'term_' + Date.now();

  var env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;

  // Inject dashboard binding so PreToolUse hooks can enforce isolation
  if (opts.dashboardId) {
    env.SYNAPSE_DASHBOARD_ID = opts.dashboardId;
  }

  console.log('[TerminalService] spawnTerminal() id:', id, 'shell:', shell, 'cwd:', cwd, 'cols:', cols, 'rows:', rows);

  var proc = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: cols,
    rows: rows,
    cwd: cwd,
    env: env,
  });

  var terminal = {
    id: id,
    process: proc,
    pid: proc.pid,
    cols: cols,
    rows: rows,
    cwd: cwd,
    shell: shell,
    startedAt: new Date().toISOString(),
  };

  activeTerminals[id] = terminal;

  // Stream PTY output to renderer
  proc.onData(function (data) {
    if (broadcastFn) {
      broadcastFn('terminal-output', { id: id, data: data });
    }
  });

  // Handle PTY exit
  proc.onExit(function (exitInfo) {
    var exitCode = exitInfo ? exitInfo.exitCode : 0;
    console.log('[TerminalService] Terminal exited, id:', id, 'exitCode:', exitCode);
    delete activeTerminals[id];
    if (broadcastFn) {
      broadcastFn('terminal-exit', { id: id, exitCode: exitCode });
    }
  });

  console.log('[TerminalService] Terminal spawned, id:', id, 'pid:', proc.pid);

  return { id: id, pid: proc.pid, shell: shell, cwd: cwd, cols: cols, rows: rows };
}

/**
 * Write data to a terminal (from xterm.js user input).
 * @param {string} id — terminal session ID
 * @param {string} data — input data from xterm.js onData
 * @returns {boolean}
 */
function writeTerminal(id, data) {
  var terminal = activeTerminals[id];
  if (!terminal) return false;
  try {
    terminal.process.write(data);
    return true;
  } catch (e) {
    console.error('[TerminalService] writeTerminal error, id:', id, 'error:', e.message);
    return false;
  }
}

/**
 * Resize a terminal session.
 * @param {string} id — terminal session ID
 * @param {number} cols — new column count
 * @param {number} rows — new row count
 * @returns {boolean}
 */
function resizeTerminal(id, cols, rows) {
  var terminal = activeTerminals[id];
  if (!terminal) return false;
  try {
    terminal.process.resize(cols, rows);
    terminal.cols = cols;
    terminal.rows = rows;
    return true;
  } catch (e) {
    console.error('[TerminalService] resizeTerminal error, id:', id, 'error:', e.message);
    return false;
  }
}

/**
 * Kill a specific terminal session by ID.
 * @param {string} id — terminal session ID
 * @returns {boolean}
 */
function killTerminal(id) {
  var terminal = activeTerminals[id];
  if (!terminal) return false;
  try {
    terminal.process.kill();
    delete activeTerminals[id];
    return true;
  } catch (e) {
    console.error('[TerminalService] killTerminal error, id:', id, 'error:', e.message);
    return false;
  }
}

/**
 * Kill all active terminal sessions.
 * @returns {number} — count of terminals killed
 */
function killAllTerminals() {
  var ids = Object.keys(activeTerminals);
  var killed = 0;
  for (var i = 0; i < ids.length; i++) {
    if (killTerminal(ids[i])) killed++;
  }
  return killed;
}

/**
 * Get list of active terminal sessions.
 * @returns {{ id, pid, shell, cwd, cols, rows, startedAt }[]}
 */
function getActiveTerminals() {
  var result = [];
  for (var id in activeTerminals) {
    var t = activeTerminals[id];
    result.push({
      id: t.id,
      pid: t.pid,
      shell: t.shell,
      cwd: t.cwd,
      cols: t.cols,
      rows: t.rows,
      startedAt: t.startedAt,
    });
  }
  return result;
}

module.exports = {
  init: init,
  spawnTerminal: spawnTerminal,
  writeTerminal: writeTerminal,
  resizeTerminal: resizeTerminal,
  killTerminal: killTerminal,
  killAllTerminals: killAllTerminals,
  getActiveTerminals: getActiveTerminals,
};
