// TerminalView — Interactive terminal component using @xterm/xterm
// Renders a PTY-backed terminal inside the dashboard bottom panel.
// Communicates with the Electron main process via IPC for spawning,
// writing, resizing, and killing terminal sessions.
//
// Sessions (xterm instance + PTY id) live in a module-level cache keyed by
// `${dashboardId}-${tabId}`. Mount/unmount only attaches/detaches DOM, so
// terminal history persists across view changes and dashboard switches for
// the lifetime of the app session. Sessions are only destroyed via the
// exported `destroyTerminalSession()` when a tab is explicitly closed.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const termSessions = new Map();
let globalListenersAttached = false;

function attachGlobalListenersOnce() {
  if (globalListenersAttached) return;
  if (typeof window === 'undefined' || !window.electronAPI?.on) return;

  window.electronAPI.on('terminal-output', (payload) => {
    if (!payload) return;
    const { id, data } = payload;
    for (const session of termSessions.values()) {
      if (session.terminalId === id) {
        try { session.terminal.write(data); } catch (_) { /* disposed */ }
        return;
      }
    }
  });

  window.electronAPI.on('terminal-exit', (payload) => {
    if (!payload) return;
    const { id, exitCode } = payload;
    for (const session of termSessions.values()) {
      if (session.terminalId === id) {
        try {
          session.terminal.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode ?? 0}]\x1b[0m`);
          session.terminal.writeln('\x1b[90mPress any key to restart...\x1b[0m');
        } catch (_) { /* disposed */ }
        session.exited = true;
        session.terminalId = null;
        if (session.onExit) session.onExit();
        return;
      }
    }
  });

  globalListenersAttached = true;
}

/**
 * Tear down a cached terminal session — kills the PTY and disposes the xterm
 * instance. Call when a user explicitly closes a tab.
 */
export function destroyTerminalSession(dashboardId, tabId) {
  const key = `${dashboardId}-${tabId}`;
  const session = termSessions.get(key);
  if (!session) return;
  try {
    if (session.terminalId && window.electronAPI?.killTerminal) {
      window.electronAPI.killTerminal(session.terminalId);
    }
  } catch (_) {}
  try { if (session.dataDisposable) session.dataDisposable.dispose(); } catch (_) {}
  try { if (session.terminal) session.terminal.dispose(); } catch (_) {}
  termSessions.delete(key);
}

function getTerminalThemeFromCSS() {
  const s = getComputedStyle(document.documentElement);
  const v = (name) => s.getPropertyValue(name).trim();
  const bg = v('--terminal-bg') || '#0b0b0f';
  return {
    background: bg,
    foreground: v('--terminal-fg') || '#e0e0e0',
    cursor: v('--terminal-cursor') || '#9b7cf0',
    cursorAccent: bg,
    selectionBackground: v('--terminal-selection') || 'rgba(155, 124, 240, 0.3)',
    selectionForeground: undefined,
    black: v('--terminal-black') || '#1a1a2e',
    red: v('--terminal-red') || '#ff6b6b',
    green: v('--terminal-green') || '#51cf66',
    yellow: v('--terminal-yellow') || '#ffd43b',
    blue: v('--terminal-blue') || '#748ffc',
    magenta: v('--terminal-magenta') || '#da77f2',
    cyan: v('--terminal-cyan') || '#66d9e8',
    white: v('--terminal-white') || '#e0e0e0',
    brightBlack: v('--terminal-bright-black') || '#4a4a6a',
    brightRed: v('--terminal-bright-red') || '#ff8787',
    brightGreen: v('--terminal-bright-green') || '#69db7c',
    brightYellow: v('--terminal-bright-yellow') || '#ffe066',
    brightBlue: v('--terminal-bright-blue') || '#91a7ff',
    brightMagenta: v('--terminal-bright-magenta') || '#e599f7',
    brightCyan: v('--terminal-bright-cyan') || '#99e9f2',
    brightWhite: v('--terminal-bright-white') || '#ffffff',
  };
}

const TERMINAL_OPTIONS = {
  theme: getTerminalThemeFromCSS(),
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  fontSize: 13,
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: 'bar',
  scrollback: 5000,
  allowProposedApi: true,
  convertEol: true,
};

/**
 * TerminalView — renders an interactive terminal backed by a PTY process.
 *
 * @param {object} props
 * @param {string} props.projectDir — working directory for the spawned shell
 * @param {string} props.dashboardId — dashboard owning this terminal
 * @param {number|string} props.tabId — terminal tab id (unique within dashboard)
 */
export default function TerminalView({ projectDir, dashboardId, tabId = 1 }) {
  const containerRef = useRef(null);
  const sessionRef = useRef(null);
  const isDisposedRef = useRef(false);
  const [noElectron, setNoElectron] = useState(false);
  const [exited, setExited] = useState(false);

  const spawnRef = useRef(null);

  const spawnTerminal = useCallback(async () => {
    if (!window.electronAPI || !window.electronAPI.spawnTerminal) return;
    const session = sessionRef.current;
    if (!session) return;

    setExited(false);
    session.exited = false;

    try {
      const cwd = projectDir || undefined;
      const result = await window.electronAPI.spawnTerminal({ cwd, dashboardId });
      if (result && result.id) {
        session.terminalId = result.id;
      }
    } catch (err) {
      if (session.terminal && !isDisposedRef.current) {
        session.terminal.writeln(`\r\n\x1b[31mFailed to spawn terminal: ${err.message || err}\x1b[0m`);
      }
    }
  }, [projectDir, dashboardId]);

  spawnRef.current = spawnTerminal;

  useEffect(() => {
    if (!window.electronAPI) {
      setNoElectron(true);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    isDisposedRef.current = false;
    attachGlobalListenersOnce();

    const key = `${dashboardId}-${tabId}`;
    let session = termSessions.get(key);
    const isNew = !session;

    if (!session) {
      const terminal = new Terminal(TERMINAL_OPTIONS);
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      session = {
        terminal,
        fitAddon,
        terminalId: null,
        exited: false,
        dataDisposable: null,
        onExit: null,
      };
      termSessions.set(key, session);

      terminal.open(container);

      // Persistent input handler: closure reads session.terminalId at call
      // time so it stays correct after a restart-after-exit assigns a new id.
      session.dataDisposable = terminal.onData((data) => {
        const id = session.terminalId;
        if (id && window.electronAPI?.writeTerminal) {
          window.electronAPI.writeTerminal(id, data);
        }
      });
    } else if (session.terminal.element && session.terminal.element.parentElement !== container) {
      // Move the existing xterm element into the new container — keeps the
      // entire scrollback buffer and cursor state intact.
      container.appendChild(session.terminal.element);
    }

    sessionRef.current = session;

    if (session.exited) setExited(true);
    session.onExit = () => setExited(true);

    requestAnimationFrame(() => {
      if (!isDisposedRef.current) {
        try { session.fitAddon.fit(); } catch (_) { /* container not ready */ }
      }
    });

    if (isNew) {
      spawnRef.current();
    }

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!isDisposedRef.current && session.fitAddon) {
          try {
            session.fitAddon.fit();
            const id = session.terminalId;
            if (id && window.electronAPI.resizeTerminal) {
              window.electronAPI.resizeTerminal(id, session.terminal.cols, session.terminal.rows);
            }
          } catch (_) { /* ignore fit errors during transitions */ }
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      isDisposedRef.current = true;
      session.onExit = null;
      if (resizeObserver) resizeObserver.disconnect();
      // Intentionally do NOT dispose xterm or kill the PTY — the session
      // lives on in termSessions until destroyTerminalSession() is called.
    };
  }, [dashboardId, tabId]);

  // Restart on keypress after exit
  useEffect(() => {
    if (!exited) return;
    const session = sessionRef.current;
    if (!session) return;
    const restartDisposable = session.terminal.onData(() => {
      setExited(false);
      session.terminal.clear();
      session.exited = false;
      spawnRef.current();
    });
    return () => restartDisposable.dispose();
  }, [exited]);

  // Re-fit when projectDir changes (panel might have resized)
  useEffect(() => {
    const session = sessionRef.current;
    if (session?.fitAddon && !isDisposedRef.current) {
      try { session.fitAddon.fit(); } catch (_) {}
    }
  }, [projectDir]);

  // Watch for theme changes and update terminal colors
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme' || m.attributeName === 'style') {
          const session = sessionRef.current;
          if (!isDisposedRef.current && session?.terminal) {
            session.terminal.options.theme = getTerminalThemeFromCSS();
          }
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => observer.disconnect();
  }, []);

  // Fallback when electronAPI is not available
  if (noElectron) {
    return (
      <div className="terminal-container terminal-fallback">
        <div className="terminal-fallback-message">
          Terminal is only available in the Electron desktop app.
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="terminal-container" />;
}
