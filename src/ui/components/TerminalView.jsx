// TerminalView — Interactive terminal component using @xterm/xterm
// Renders a PTY-backed terminal inside the dashboard bottom panel.
// Communicates with the Electron main process via IPC for spawning,
// writing, resizing, and killing terminal sessions.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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
 */
export default function TerminalView({ projectDir, dashboardId }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const terminalIdRef = useRef(null);
  const isDisposedRef = useRef(false);
  const [noElectron, setNoElectron] = useState(false);
  const [exited, setExited] = useState(false);

  // Stable ref for the spawn function so cleanup/restart can use it
  const spawnRef = useRef(null);

  const spawnTerminal = useCallback(async () => {
    if (!window.electronAPI || !window.electronAPI.spawnTerminal) return;

    const term = terminalRef.current;
    if (!term) return;

    setExited(false);

    try {
      const cwd = projectDir || undefined;
      const result = await window.electronAPI.spawnTerminal({ cwd, dashboardId });
      if (result && result.id) {
        terminalIdRef.current = result.id;
      }
    } catch (err) {
      if (term && !isDisposedRef.current) {
        term.writeln(`\r\n\x1b[31mFailed to spawn terminal: ${err.message || err}\x1b[0m`);
      }
    }
  }, [projectDir, dashboardId]);

  // Store latest spawnTerminal in ref for use in listeners
  spawnRef.current = spawnTerminal;

  // Initialize terminal on mount
  useEffect(() => {
    if (!window.electronAPI) {
      setNoElectron(true);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    isDisposedRef.current = false;

    // Create terminal instance
    const terminal = new Terminal(TERMINAL_OPTIONS);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Open terminal in the container
    terminal.open(container);

    // Fit after open (small delay to let layout settle)
    requestAnimationFrame(() => {
      if (!isDisposedRef.current) {
        try { fitAddon.fit(); } catch (_) { /* container not ready */ }
      }
    });

    // Route user input to PTY via IPC
    const dataDisposable = terminal.onData((data) => {
      const id = terminalIdRef.current;
      if (id && window.electronAPI.writeTerminal) {
        window.electronAPI.writeTerminal(id, data);
      }
    });

    // Handle PTY output → xterm
    const handleOutput = (payload) => {
      if (!payload) return;
      const { id, data } = payload;
      if (id === terminalIdRef.current && !isDisposedRef.current) {
        terminal.write(data);
      }
    };

    // Handle PTY exit
    const handleExit = (payload) => {
      if (!payload) return;
      const { id, exitCode } = payload;
      if (id === terminalIdRef.current && !isDisposedRef.current) {
        terminal.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode ?? 0}]\x1b[0m`);
        terminal.writeln('\x1b[90mPress any key to restart...\x1b[0m');
        setExited(true);
        terminalIdRef.current = null;
      }
    };

    // Register push event listeners
    let removeOutputListener = null;
    let removeExitListener = null;

    if (window.electronAPI.on) {
      removeOutputListener = window.electronAPI.on('terminal-output', handleOutput);
      removeExitListener = window.electronAPI.on('terminal-exit', handleExit);
    }

    // Spawn the PTY process
    spawnRef.current();

    // ResizeObserver for auto-fitting when the panel resizes
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!isDisposedRef.current && fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
            // Notify PTY of new dimensions
            const id = terminalIdRef.current;
            if (id && window.electronAPI.resizeTerminal) {
              window.electronAPI.resizeTerminal(id, terminal.cols, terminal.rows);
            }
          } catch (_) { /* ignore fit errors during transitions */ }
        }
      });
      resizeObserver.observe(container);
    }

    // Cleanup on unmount
    return () => {
      isDisposedRef.current = true;

      // Remove push event listeners
      if (removeOutputListener) removeOutputListener();
      if (removeExitListener) removeExitListener();

      // Dispose xterm data handler
      dataDisposable.dispose();

      // Kill PTY
      const id = terminalIdRef.current;
      if (id && window.electronAPI.killTerminal) {
        window.electronAPI.killTerminal(id);
        terminalIdRef.current = null;
      }

      // Disconnect resize observer
      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      // Dispose terminal
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // Mount once — projectDir changes don't re-create the terminal

  // Handle restart after exit — listen for keypress
  useEffect(() => {
    if (!exited) return;
    const terminal = terminalRef.current;
    if (!terminal) return;

    const restartDisposable = terminal.onData(() => {
      setExited(false);
      terminal.clear();
      spawnRef.current();
    });

    return () => restartDisposable.dispose();
  }, [exited]);

  // Re-fit when projectDir changes (panel might have resized)
  useEffect(() => {
    if (fitAddonRef.current && !isDisposedRef.current) {
      try { fitAddonRef.current.fit(); } catch (_) {}
    }
  }, [projectDir]);

  // Watch for theme changes and update terminal colors
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || isDisposedRef.current) return;

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme' || m.attributeName === 'style') {
          if (!isDisposedRef.current && terminalRef.current) {
            terminalRef.current.options.theme = getTerminalThemeFromCSS();
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
