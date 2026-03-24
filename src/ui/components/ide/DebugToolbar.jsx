// DebugToolbar — Debug control bar with standard debugger actions.
// Pure UI component: receives debug state and callbacks as props.
// Buttons are disabled/enabled based on debugStatus prop.

import React, { useState, useCallback } from 'react';
import '../../styles/ide-debug.css';

// ── SVG Icon Components ──────────────────────────────────────

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 3.5v9l7-4.5-7-4.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="3" width="3" height="10" rx="0.75" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" rx="0.75" fill="currentColor" />
    </svg>
  );
}

function StepOverIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="11" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12 3l2 2-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepIntoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 2v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5.5 5.5L8 8l2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepOutIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 8V2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5.5 4.5L8 2l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 8a5 5 0 01-9.544 2M3 8a5 5 0 019.544-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3 12V9.5h2.5M13 4v2.5h-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

function LaunchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 3.5v9l7-4.5-7-4.5z" fill="currentColor" />
      <rect x="2" y="3" width="1.5" height="10" rx="0.5" fill="currentColor" />
    </svg>
  );
}

// ── Status Badge Icon ────────────────────────────────────────

function StatusDot({ status }) {
  const colorMap = {
    idle: 'var(--text-tertiary)',
    running: 'var(--color-in-progress)',
    paused: 'var(--color-warning, #f59e0b)',
    stopped: 'var(--text-tertiary)',
  };
  const color = colorMap[status] || colorMap.idle;

  return (
    <svg viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg" className="debug-status-dot">
      <circle cx="4" cy="4" r="3.5" fill={color} />
    </svg>
  );
}

// ── DebugToolbar — main component ────────────────────────────

/**
 * @param {object}   props
 * @param {string}   props.debugStatus   - 'idle' | 'running' | 'paused' | 'stopped'
 * @param {Function} props.onContinue    - Resume execution (F5 when paused)
 * @param {Function} props.onPause       - Pause execution (F5 when running)
 * @param {Function} props.onStepOver    - Step over (F10)
 * @param {Function} props.onStepInto    - Step into (F11)
 * @param {Function} props.onStepOut     - Step out (Shift+F11)
 * @param {Function} props.onRestart     - Restart debug session (Ctrl+Shift+F5)
 * @param {Function} props.onStop        - Stop debug session (Shift+F5)
 * @param {Function} props.onLaunch      - Launch debug session (scriptPath, args)
 */
export default function DebugToolbar({
  debugStatus = 'idle',
  onContinue,
  onPause,
  onStepOver,
  onStepInto,
  onStepOut,
  onRestart,
  onStop,
  onLaunch,
}) {
  const [scriptPath, setScriptPath] = useState('');
  const [args, setArgs] = useState('');

  const isIdle = debugStatus === 'idle';
  const isRunning = debugStatus === 'running';
  const isPaused = debugStatus === 'paused';
  const isStopped = debugStatus === 'stopped';

  // Button enabled states per spec:
  // idle:    only Launch
  // running: only Pause, Stop
  // paused:  Continue, StepOver, StepInto, StepOut, Restart, Stop
  // stopped: only Launch
  const canLaunch = (isIdle || isStopped) && scriptPath.trim().length > 0;
  const canContinue = isPaused;
  const canPause = isRunning;
  const canStepOver = isPaused;
  const canStepInto = isPaused;
  const canStepOut = isPaused;
  const canRestart = isPaused;
  const canStop = isRunning || isPaused;

  const handleLaunch = useCallback(() => {
    if (!canLaunch || !onLaunch) return;
    onLaunch(scriptPath.trim(), args.trim());
  }, [canLaunch, onLaunch, scriptPath, args]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      handleLaunch();
    }
  }, [handleLaunch]);

  const statusLabel = {
    idle: 'Idle',
    running: 'Running',
    paused: 'Paused',
    stopped: 'Stopped',
  }[debugStatus] || 'Idle';

  return (
    <div className="debug-toolbar">
      {/* ---- Status + Controls Row ---- */}
      <div className="debug-toolbar-controls">
        <div className="debug-toolbar-status">
          <StatusDot status={debugStatus} />
          <span className="debug-toolbar-status-label">{statusLabel}</span>
        </div>

        <div className="debug-toolbar-separator" />

        <div className="debug-toolbar-buttons">
          {/* Continue (F5) — visible when paused */}
          <button
            className="debug-toolbar-btn"
            onClick={onContinue}
            disabled={!canContinue}
            title="Continue (F5)"
          >
            <PlayIcon />
          </button>

          {/* Pause (F5) — visible when running */}
          <button
            className="debug-toolbar-btn"
            onClick={onPause}
            disabled={!canPause}
            title="Pause (F5)"
          >
            <PauseIcon />
          </button>

          <div className="debug-toolbar-btn-separator" />

          {/* Step Over (F10) */}
          <button
            className="debug-toolbar-btn"
            onClick={onStepOver}
            disabled={!canStepOver}
            title="Step Over (F10)"
          >
            <StepOverIcon />
          </button>

          {/* Step Into (F11) */}
          <button
            className="debug-toolbar-btn"
            onClick={onStepInto}
            disabled={!canStepInto}
            title="Step Into (F11)"
          >
            <StepIntoIcon />
          </button>

          {/* Step Out (Shift+F11) */}
          <button
            className="debug-toolbar-btn"
            onClick={onStepOut}
            disabled={!canStepOut}
            title="Step Out (Shift+F11)"
          >
            <StepOutIcon />
          </button>

          <div className="debug-toolbar-btn-separator" />

          {/* Restart (Ctrl+Shift+F5) */}
          <button
            className="debug-toolbar-btn debug-toolbar-btn--restart"
            onClick={onRestart}
            disabled={!canRestart}
            title="Restart (Ctrl+Shift+F5)"
          >
            <RestartIcon />
          </button>

          {/* Stop (Shift+F5) */}
          <button
            className="debug-toolbar-btn debug-toolbar-btn--stop"
            onClick={onStop}
            disabled={!canStop}
            title="Stop (Shift+F5)"
          >
            <StopIcon />
          </button>
        </div>
      </div>

      {/* ---- Launch Configuration Row ---- */}
      <div className="debug-toolbar-launch">
        <div className="debug-toolbar-launch-fields">
          <input
            type="text"
            className="debug-toolbar-input debug-toolbar-input--script"
            placeholder="Script path (e.g. index.js)"
            value={scriptPath}
            onChange={(e) => setScriptPath(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
          <input
            type="text"
            className="debug-toolbar-input debug-toolbar-input--args"
            placeholder="Arguments"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
        </div>
        <button
          className="debug-toolbar-launch-btn"
          onClick={handleLaunch}
          disabled={!canLaunch}
          title="Launch Debug Session"
        >
          <LaunchIcon />
          <span>Run</span>
        </button>
      </div>
    </div>
  );
}
