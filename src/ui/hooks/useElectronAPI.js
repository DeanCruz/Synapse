// useElectronAPI — provides access to the platform API with environment detection.
//
// In Electron: returns window.electronAPI (the preload bridge).
// In VSCode webview: returns the webview bridge API (which webview-main.jsx
//   already exposes on window.electronAPI for seamless compatibility).
// In plain browser (dev server / SSE): returns null.
//
// Components should continue using useElectronAPI() — the hook transparently
// returns the correct transport for the current environment.

import { useMemo } from 'react';
import { createWebviewAPI } from './useWebviewAPI.js';

/**
 * Detect which environment the app is running in.
 *   - 'electron'  — Electron BrowserWindow (window.electronAPI set by preload)
 *   - 'webview'   — VSCode webview panel (acquireVsCodeApi available)
 *   - 'browser'   — Plain browser / dev server
 */
export function detectEnvironment() {
  if (typeof window === 'undefined') return 'browser';
  // The boot script in getWebviewHtml.ts consumes acquireVsCodeApi() (single-use)
  // and exposes window.synapseWebview. Check for it to detect the webview env
  // even after acquireVsCodeApi has been consumed.
  if (window.synapseWebview) return 'webview';
  // Electron preload sets window.electronAPI before React boots.
  // In webview-main.jsx we also set window.electronAPI to the bridge, but
  // distinguish the true Electron env by checking the userAgent or the absence
  // of acquireVsCodeApi.
  if (window.electronAPI && typeof window.acquireVsCodeApi !== 'function') {
    return 'electron';
  }
  if (typeof window.acquireVsCodeApi === 'function') {
    return 'webview';
  }
  return 'browser';
}

/**
 * Resolve the platform API object for the current environment.
 * Returns window.electronAPI in Electron, the webview bridge in VSCode
 * webviews, or null in a plain browser.
 */
function resolveAPI() {
  const env = detectEnvironment();
  if (env === 'electron') return window.electronAPI;
  if (env === 'webview') {
    // webview-main.jsx sets window.electronAPI to the bridge on boot.
    // If that already happened, return it; otherwise create it now.
    if (window.electronAPI) return window.electronAPI;
    const api = createWebviewAPI();
    if (api) window.electronAPI = api;
    return api;
  }
  return null;
}

export function useElectronAPI() {
  return useMemo(() => resolveAPI(), []);
}

export function useIsElectron() {
  return detectEnvironment() === 'electron';
}

/**
 * Returns true when running inside a VSCode webview panel.
 */
export function useIsWebview() {
  return detectEnvironment() === 'webview';
}

/**
 * Returns true when any IPC-style API is available (Electron or webview).
 */
export function useHasAPI() {
  return resolveAPI() !== null;
}
