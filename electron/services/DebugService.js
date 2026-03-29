// electron/services/DebugService.js — Node.js Debug Service via Chrome DevTools Protocol
// Manages a single debug session: spawns a Node.js process with --inspect-brk=0,
// connects to the CDP WebSocket, and provides debugger control (breakpoints, stepping,
// evaluation, variable inspection). Uses Node.js built-in global WebSocket (Node 22+).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

var broadcastFn = null;       // (channel, data) => void — sends to renderer
var activeSession = null;     // { process, ws, scriptPath, cwd, breakpoints, nextId }

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the DebugService with a broadcast function for push events.
 * @param {Function} broadcast — (channel, data) => void
 */
function init(broadcast) {
  broadcastFn = broadcast;
  console.log('[DebugService] init() called, broadcastFn set:', !!broadcast);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Send a push event to the renderer if broadcast is available.
 */
function pushEvent(channel, data) {
  if (broadcastFn) {
    broadcastFn(channel, data);
  }
}

/**
 * Send a CDP command over the WebSocket and wait for a response.
 * @param {string} method — CDP method name (e.g., 'Debugger.enable')
 * @param {Object} [params] — CDP parameters
 * @param {number} [timeout=10000] — response timeout in ms
 * @returns {Promise<Object>} — CDP result
 */
function sendCDPCommand(method, params, timeout) {
  timeout = timeout || 10000;
  return new Promise(function (resolve, reject) {
    if (!activeSession || !activeSession.ws) {
      return reject(new Error('No active debug session'));
    }

    var ws = activeSession.ws;
    if (ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('WebSocket not open (state: ' + ws.readyState + ')'));
    }

    var id = ++activeSession.nextId;
    var msg = JSON.stringify({ id: id, method: method, params: params || {} });

    var timer = setTimeout(function () {
      ws.removeEventListener('message', handler);
      reject(new Error('CDP command timeout: ' + method));
    }, timeout);

    function handler(event) {
      var data;
      try {
        data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      } catch (e) {
        return;
      }
      if (data.id === id) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        if (data.error) {
          reject(new Error(data.error.message || JSON.stringify(data.error)));
        } else {
          resolve(data.result || {});
        }
      }
    }

    ws.addEventListener('message', handler);
    ws.send(msg);
  });
}

/**
 * Parse the WebSocket URL from Node.js inspector stderr output.
 * Looks for: "Debugger listening on ws://127.0.0.1:PORT/UUID"
 * @param {string} text — stderr output
 * @returns {string|null} — the ws:// URL or null
 */
function parseDebuggerUrl(text) {
  var match = text.match(/Debugger listening on (ws:\/\/[^\s]+)/);
  return match ? match[1] : null;
}

/**
 * Extract structured call frame data from CDP Debugger.paused event.
 * @param {Array} callFrames — CDP callFrames array
 * @returns {{ callStack: Array, scopes: Array, pausedFile: string, pausedLine: number }}
 */
function extractPausedInfo(callFrames) {
  var callStack = [];
  var scopes = [];
  var pausedFile = null;
  var pausedLine = null;

  for (var i = 0; i < callFrames.length; i++) {
    var frame = callFrames[i];
    var location = frame.location || {};
    var scriptId = location.scriptId;
    var lineNumber = (location.lineNumber || 0) + 1; // CDP is 0-based, convert to 1-based
    var columnNumber = (location.columnNumber || 0) + 1;

    // Resolve source file from the frame's URL, falling back to scriptSources cache
    var source = frame.url || '';
    if (!source && scriptId && activeSession && activeSession.scriptSources[scriptId]) {
      source = activeSession.scriptSources[scriptId];
    }
    if (source.startsWith('file://')) {
      source = source.replace('file://', '');
    }

    callStack.push({
      id: frame.callFrameId,
      name: frame.functionName || '(anonymous)',
      source: source,
      line: lineNumber,
      column: columnNumber,
      scriptId: scriptId,
    });

    // Collect scopes from the top frame only
    if (i === 0) {
      pausedFile = source;
      pausedLine = lineNumber;

      if (frame.scopeChain) {
        for (var j = 0; j < frame.scopeChain.length; j++) {
          var scope = frame.scopeChain[j];
          scopes.push({
            name: scope.type ? (scope.type.charAt(0).toUpperCase() + scope.type.slice(1)) : 'Unknown',
            type: scope.type,
            variablesReference: scope.object ? scope.object.objectId : null,
            expensive: scope.type === 'global',
          });
        }
      }
    }
  }

  return {
    callStack: callStack,
    scopes: scopes,
    pausedFile: pausedFile,
    pausedLine: pausedLine,
  };
}

/**
 * Set up CDP event listeners on the WebSocket connection.
 */
function setupCDPEventHandlers(ws) {
  ws.addEventListener('message', function (event) {
    var data;
    try {
      data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    } catch (e) {
      return;
    }

    // Only handle events (no id field)
    if (data.id !== undefined) return;

    var method = data.method;
    var params = data.params || {};

    switch (method) {
      case 'Debugger.paused': {
        var info = extractPausedInfo(params.callFrames || []);
        pushEvent('debug-paused', {
          reason: params.reason || 'unknown',
          callStack: info.callStack,
          scopes: info.scopes,
          pausedFile: info.pausedFile,
          pausedLine: info.pausedLine,
          hitBreakpoints: params.hitBreakpoints || [],
        });
        break;
      }

      case 'Debugger.resumed': {
        pushEvent('debug-resumed', {});
        break;
      }

      case 'Debugger.scriptParsed': {
        // Cache scriptId -> url mapping for resolving call stack sources
        if (params.scriptId && params.url) {
          if (activeSession) {
            activeSession.scriptSources[params.scriptId] = params.url;
          }
        }
        break;
      }

      case 'Runtime.executionContextCreated': {
        var ctx = params.context || {};
        console.log('[DebugService] Execution context created:', ctx.id, ctx.origin);
        break;
      }

      case 'Runtime.consoleAPICalled': {
        // Forward console output from the debuggee
        var args = (params.args || []).map(function (arg) {
          return arg.value !== undefined ? String(arg.value) : (arg.description || arg.type);
        });
        pushEvent('debug-output', {
          type: params.type || 'log',
          text: args.join(' '),
          timestamp: params.timestamp,
        });
        break;
      }

      case 'Runtime.exceptionThrown': {
        var detail = params.exceptionDetails || {};
        var text = detail.text || 'Exception thrown';
        if (detail.exception && detail.exception.description) {
          text = detail.exception.description;
        }
        pushEvent('debug-output', {
          type: 'error',
          text: text,
          line: detail.lineNumber ? detail.lineNumber + 1 : null,
          column: detail.columnNumber ? detail.columnNumber + 1 : null,
        });
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch a Node.js script with --inspect-brk=0 and connect to the CDP WebSocket.
 *
 * @param {Object} opts
 * @param {string} opts.scriptPath — absolute path to the .js file to debug
 * @param {string} [opts.cwd] — working directory (defaults to script's directory)
 * @param {string[]} [opts.args] — additional arguments to pass to the script
 * @param {Object} [opts.env] — additional environment variables
 * @returns {Promise<{ success: true, pid: number } | { success: false, error: string }>}
 */
async function launch(opts) {
  if (activeSession) {
    return { success: false, error: 'A debug session is already active. Stop it first.' };
  }

  var scriptPath = opts.scriptPath;
  if (!scriptPath) {
    return { success: false, error: 'scriptPath is required' };
  }

  var cwd = opts.cwd || path.dirname(scriptPath);
  var args = opts.args || [];
  var extraEnv = opts.env || {};

  console.log('[DebugService] Launching debug session:', scriptPath, 'cwd:', cwd);

  return new Promise(function (resolve) {
    var wsUrl = null;
    var stderrBuffer = '';
    var connectTimeout = null;
    var resolved = false;

    // Spawn the Node.js process with --inspect-brk=0 (random port, break on first line)
    var env = Object.assign({}, process.env, extraEnv);
    // Ensure the child runs as a regular Node.js process, not Electron
    delete env.ELECTRON_RUN_AS_NODE;

    var childArgs = ['--inspect-brk=0'].concat([scriptPath]).concat(args);
    var child = spawn(process.execPath, childArgs, {
      cwd: cwd,
      env: env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Set up session state immediately
    activeSession = {
      process: child,
      ws: null,
      scriptPath: scriptPath,
      cwd: cwd,
      breakpoints: {},       // { breakpointId: { file, line } }
      scriptSources: {},     // { scriptId: url } — from Debugger.scriptParsed
      nextId: 0,
    };

    // Timeout: if we can't find ws URL within 5 seconds, fail
    connectTimeout = setTimeout(function () {
      if (!resolved) {
        resolved = true;
        cleanup('Connection timeout — could not find debugger WebSocket URL within 5 seconds');
        resolve({ success: false, error: 'Connection timeout — debugger did not start within 5 seconds' });
      }
    }, 5000);

    // Parse stderr for the WebSocket URL
    child.stderr.on('data', function (chunk) {
      var text = chunk.toString();
      stderrBuffer += text;

      // Forward stderr output
      pushEvent('debug-output', { type: 'stderr', text: text });

      if (!wsUrl) {
        wsUrl = parseDebuggerUrl(stderrBuffer);
        if (wsUrl) {
          console.log('[DebugService] Found debugger URL:', wsUrl);
          connectWebSocket(wsUrl);
        }
      }
    });

    // Forward stdout
    child.stdout.on('data', function (chunk) {
      pushEvent('debug-output', { type: 'stdout', text: chunk.toString() });
    });

    // Handle process exit
    child.on('exit', function (code, signal) {
      console.log('[DebugService] Debuggee exited, code:', code, 'signal:', signal);
      if (!resolved) {
        resolved = true;
        clearTimeout(connectTimeout);
        resolve({ success: false, error: 'Debuggee process exited before connection (code: ' + code + ')' });
      }
      pushEvent('debug-stopped', { code: code, signal: signal, reason: 'exited' });
      cleanupSession();
    });

    child.on('error', function (err) {
      console.error('[DebugService] Spawn error:', err.message);
      if (!resolved) {
        resolved = true;
        clearTimeout(connectTimeout);
        resolve({ success: false, error: 'Failed to spawn debuggee: ' + err.message });
      }
      pushEvent('debug-stopped', { reason: 'error', error: err.message });
      cleanupSession();
    });

    /**
     * Connect to the CDP WebSocket endpoint.
     */
    function connectWebSocket(url) {
      try {
        var ws = new WebSocket(url);

        ws.addEventListener('open', function () {
          console.log('[DebugService] WebSocket connected to CDP');
          if (activeSession) {
            activeSession.ws = ws;
          }

          // Enable debugger and runtime domains, then signal the runtime to
          // begin execution. With --inspect-brk the runtime waits for a debugger;
          // runIfWaitingForDebugger triggers V8 to start and immediately pause on
          // the first statement (Debugger.paused event with reason "Break on start").
          Promise.all([
            sendCDPCommand('Debugger.enable'),
            sendCDPCommand('Runtime.enable'),
          ]).then(function () {
            // Signal V8 to start execution (it will pause on first line due to --inspect-brk)
            return sendCDPCommand('Runtime.runIfWaitingForDebugger');
          }).then(function () {
            console.log('[DebugService] CDP domains enabled, session ready');
            clearTimeout(connectTimeout);
            if (!resolved) {
              resolved = true;
              resolve({ success: true, pid: child.pid });
            }
          }).catch(function (err) {
            console.error('[DebugService] Failed to enable CDP domains:', err.message);
            clearTimeout(connectTimeout);
            if (!resolved) {
              resolved = true;
              resolve({ success: false, error: 'Failed to enable CDP: ' + err.message });
            }
          });
        });

        ws.addEventListener('error', function (err) {
          console.error('[DebugService] WebSocket error:', err.message || err);
          if (!resolved) {
            resolved = true;
            clearTimeout(connectTimeout);
            resolve({ success: false, error: 'WebSocket connection failed: ' + (err.message || 'unknown error') });
          }
        });

        ws.addEventListener('close', function (event) {
          console.log('[DebugService] WebSocket closed, code:', event.code);
          // If session still active, the debuggee may have crashed
          if (activeSession && activeSession.ws === ws) {
            pushEvent('debug-stopped', { reason: 'disconnected', code: event.code });
            cleanupSession();
          }
        });

        // Set up event handlers for CDP events
        setupCDPEventHandlers(ws);

      } catch (err) {
        console.error('[DebugService] WebSocket creation failed:', err.message);
        clearTimeout(connectTimeout);
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: 'WebSocket creation failed: ' + err.message });
        }
      }
    }

    /**
     * Emergency cleanup — used when connection times out or fails.
     */
    function cleanup(reason) {
      console.log('[DebugService] Cleanup:', reason);
      cleanupSession();
    }
  });
}

/**
 * Clean up the active session — close WebSocket, kill process, clear state.
 */
function cleanupSession() {
  if (!activeSession) return;

  var session = activeSession;
  activeSession = null;

  // Close WebSocket
  if (session.ws) {
    try {
      session.ws.close();
    } catch (e) {
      console.error('[DebugService] Error closing WebSocket:', e.message);
    }
  }

  // Kill the debuggee process
  if (session.process && !session.process.killed) {
    try {
      session.process.kill('SIGTERM');
      // Force kill after 2 seconds if still alive
      setTimeout(function () {
        try {
          if (!session.process.killed) {
            session.process.kill('SIGKILL');
          }
        } catch (e) { /* already dead */ }
      }, 2000);
    } catch (e) {
      console.error('[DebugService] Error killing debuggee:', e.message);
    }
  }
}

/**
 * Stop the active debug session.
 * @returns {{ success: boolean, error?: string }}
 */
function stop() {
  if (!activeSession) {
    return { success: false, error: 'No active debug session' };
  }

  console.log('[DebugService] Stopping debug session');
  pushEvent('debug-stopped', { reason: 'user' });
  cleanupSession();
  return { success: true };
}

/**
 * Set a breakpoint by file URL and line number.
 * @param {string} filePath — absolute file path
 * @param {number} lineNumber — 1-based line number
 * @param {string} [condition] — optional breakpoint condition expression
 * @returns {Promise<{ success: boolean, breakpointId?: string, actualLine?: number, error?: string }>}
 */
async function setBreakpoint(filePath, lineNumber, condition) {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  try {
    // Resolve symlinks to match V8's internal URL (e.g., /tmp -> /private/tmp on macOS)
    var resolvedPath = filePath;
    try { resolvedPath = fs.realpathSync(filePath); } catch (e) { /* use original path */ }

    var params = {
      url: 'file://' + resolvedPath,
      lineNumber: lineNumber - 1, // CDP uses 0-based line numbers
    };
    if (condition) {
      params.condition = condition;
    }

    var result = await sendCDPCommand('Debugger.setBreakpointByUrl', params);
    var breakpointId = result.breakpointId;

    // Store breakpoint mapping
    if (breakpointId) {
      activeSession.breakpoints[breakpointId] = { file: filePath, line: lineNumber };
    }

    var actualLine = lineNumber;
    if (result.locations && result.locations.length > 0) {
      actualLine = result.locations[0].lineNumber + 1; // Convert back to 1-based
    }

    return { success: true, breakpointId: breakpointId, actualLine: actualLine };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Remove a breakpoint by its CDP breakpoint ID.
 * @param {string} breakpointId — CDP breakpoint ID
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function removeBreakpoint(breakpointId) {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  try {
    await sendCDPCommand('Debugger.removeBreakpoint', { breakpointId: breakpointId });
    delete activeSession.breakpoints[breakpointId];
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Resume script execution (continue).
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function resume() {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  try {
    await sendCDPCommand('Debugger.resume');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Pause script execution.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function pause() {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  try {
    await sendCDPCommand('Debugger.pause');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Step over the current statement.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function stepOver() {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  try {
    await sendCDPCommand('Debugger.stepOver');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Step into the next function call.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function stepInto() {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  try {
    await sendCDPCommand('Debugger.stepInto');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Step out of the current function.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function stepOut() {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  try {
    await sendCDPCommand('Debugger.stepOut');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Evaluate an expression in the context of the top call frame.
 * @param {string} expression — JavaScript expression to evaluate
 * @param {string} [callFrameId] — specific call frame ID (optional, uses top frame from last pause)
 * @returns {Promise<{ success: boolean, result?: Object, error?: string }>}
 */
async function evaluate(expression, callFrameId) {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  try {
    var result;
    if (callFrameId) {
      // Evaluate on a specific call frame (when paused)
      result = await sendCDPCommand('Debugger.evaluateOnCallFrame', {
        callFrameId: callFrameId,
        expression: expression,
        generatePreview: true,
        throwOnSideEffect: false,
      });
    } else {
      // Evaluate in global runtime context
      result = await sendCDPCommand('Runtime.evaluate', {
        expression: expression,
        generatePreview: true,
        throwOnSideEffect: false,
      });
    }

    var remoteObj = result.result || {};
    var value = remoteObj.value;
    if (value === undefined && remoteObj.description) {
      value = remoteObj.description;
    }

    return {
      success: true,
      result: {
        type: remoteObj.type,
        subtype: remoteObj.subtype,
        value: value,
        description: remoteObj.description,
        objectId: remoteObj.objectId,
        preview: remoteObj.preview,
      },
      exceptionDetails: result.exceptionDetails || null,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get variables (properties) for a given scope or object.
 * @param {string} objectId — CDP Runtime.RemoteObject objectId (from scopes or previous getProperties)
 * @returns {Promise<{ success: boolean, variables?: Array, error?: string }>}
 */
async function getVariables(objectId) {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  if (!objectId) {
    return { success: false, error: 'objectId is required' };
  }

  try {
    var result = await sendCDPCommand('Runtime.getProperties', {
      objectId: objectId,
      ownProperties: true,
      generatePreview: true,
    });

    var variables = (result.result || []).map(function (prop) {
      var val = prop.value || {};
      return {
        name: prop.name,
        value: val.value !== undefined ? val.value : (val.description || val.type),
        type: val.type,
        subtype: val.subtype,
        variablesReference: val.objectId || null,
        preview: val.preview,
      };
    });

    return { success: true, variables: variables };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get scopes for the current paused state.
 * This re-fetches scope info if the session is paused.
 * @param {string} [callFrameId] — optional call frame ID
 * @returns {Promise<{ success: boolean, scopes?: Array, error?: string }>}
 */
async function getScopes(callFrameId) {
  if (!activeSession || !activeSession.ws) {
    return { success: false, error: 'No active debug session' };
  }

  // Note: Scopes are sent with the Debugger.paused event.
  // This function allows the renderer to re-request scopes for a different frame
  // by evaluating a no-op on the call frame (which returns the frame info).
  // However, the primary scopes data comes from the debug-paused push event.
  // We return a hint that scopes should be obtained from the last paused event.

  return {
    success: true,
    message: 'Scopes are provided with the debug-paused event. Use debug-get-variables with a scope objectId to drill into specific scopes.',
  };
}

/**
 * Check if a debug session is currently active.
 * @returns {{ active: boolean, scriptPath?: string, pid?: number }}
 */
function getSessionInfo() {
  if (!activeSession) {
    return { active: false };
  }
  return {
    active: true,
    scriptPath: activeSession.scriptPath,
    pid: activeSession.process ? activeSession.process.pid : null,
    breakpoints: Object.keys(activeSession.breakpoints).map(function (id) {
      return Object.assign({ breakpointId: id }, activeSession.breakpoints[id]);
    }),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: init,
  launch: launch,
  stop: stop,
  setBreakpoint: setBreakpoint,
  removeBreakpoint: removeBreakpoint,
  resume: resume,
  pause: pause,
  stepOver: stepOver,
  stepInto: stepInto,
  stepOut: stepOut,
  evaluate: evaluate,
  getVariables: getVariables,
  getScopes: getScopes,
  getSessionInfo: getSessionInfo,
};
