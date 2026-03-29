// PreviewView — Live preview of a running web app via Electron webview
// Provides URL bar, navigation controls, overlay injection for inline editing,
// edit flow back to source files, and dev server auto-detection.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import { getDashboardProject, saveDashboardProject } from '../../utils/dashboardProjects.js';
import '../../styles/preview-view.css';

// Inline the overlay script at build time via Vite's ?raw import.
// The previous fetch-based approach broke in the bundled Electron app because
// the relative URL resolved to a nonexistent path in the dist directory.
import OVERLAY_SCRIPT_RAW from '../../preview/inject-overlay.js?raw';

/**
 * Bridge script injected alongside inject-overlay.js.
 * Listens for window.postMessage events with type "synapse-edit" (sent by
 * inject-overlay.js) and re-emits them via console.log with a JSON prefix
 * so the webview tag's console-message event can relay them to the host.
 */
const BRIDGE_SCRIPT = `
(function synapseBridge() {
  if (window.__synapseBridgeInjected) return;
  window.__synapseBridgeInjected = true;
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'synapse-edit') {
      console.log('__SYNAPSE_EDIT__' + JSON.stringify(event.data));
    }
  });
})();
`;

export default function PreviewView() {
  const state = useAppState();
  const dispatch = useDispatch();
  const { previewUrl, previewIsLoading, previewError, currentDashboardId } = state;

  const projectPath = getDashboardProject(currentDashboardId);

  const webviewRef = useRef(null);
  const urlInputRef = useRef(null);
  const overlayInjectedRef = useRef(false); // tracks whether overlay was injected for the current page

  // --- Local state ---
  const [urlInput, setUrlInput] = useState(previewUrl || ''); // URL bar input (uncommitted)
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [detectingServer, setDetectingServer] = useState(false);
  const [, forceUpdate] = useState(0); // triggers re-render after setting project
  const [editStatus, setEditStatus] = useState(null); // { type: 'success'|'error', message, timestamp }

  // Keep urlInput in sync when previewUrl changes externally
  useEffect(() => {
    if (previewUrl) setUrlInput(previewUrl);
  }, [previewUrl]);

  // Auto-clear edit status toast after 3 seconds
  useEffect(() => {
    if (!editStatus) return;
    const timer = setTimeout(() => setEditStatus(null), 3000);
    return () => clearTimeout(timer);
  }, [editStatus]);

  // --- Helpers ---

  /** Normalize a URL input: add http:// if no protocol is present. */
  const normalizeUrl = useCallback((raw) => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    // localhost and IP addresses are almost always http
    if (/^localhost/i.test(trimmed) || /^\d{1,3}\.\d{1,3}/.test(trimmed)) {
      return `http://${trimmed}`;
    }
    return `https://${trimmed}`;
  }, []);

  /**
   * Inject the overlay script + bridge into the webview.
   * Called after the webview finishes loading a page.
   * Uses the raw script content inlined at build time.
   */
  const injectOverlay = useCallback(async (wv) => {
    try {
      if (OVERLAY_SCRIPT_RAW) {
        await wv.executeJavaScript(OVERLAY_SCRIPT_RAW);
      }
      // Always inject the bridge regardless of overlay load success
      await wv.executeJavaScript(BRIDGE_SCRIPT);
      overlayInjectedRef.current = true;
    } catch (err) {
      console.error('[PreviewView] Overlay injection failed:', err);
    }
  }, []);

  /**
   * Handle a synapse-edit message received from the webview bridge.
   * Writes the edit to the source file and updates AppContext state.
   */
  const handleSynapseEdit = useCallback(async (editData) => {
    const { label, newText, oldText, routePath } = editData;
    if (!label) return;

    if (!projectPath) {
      console.warn('[PreviewView] Edit dropped — no project path set. Label:', label);
      setEditStatus({ type: 'error', message: 'No project set — click "Set Project" to enable editing', timestamp: Date.now() });
      return;
    }

    try {
      // Write the change to the source file via the main process
      // routePath (e.g., "/about") helps disambiguate files with the same name (e.g., page.tsx)
      const result = await window.electronAPI.previewUpdateText(projectPath, label, newText, routePath || '');

      if (result && result.success) {
        setEditStatus({ type: 'success', message: `Updated ${result.file}:${result.line}`, timestamp: Date.now() });

        // Record the edit in AppContext history
        dispatch({
          type: 'PREVIEW_ADD_EDIT',
          edit: { label, oldText, newText, timestamp: Date.now() },
        });

        // Refresh the label map after the edit so future edits resolve correctly
        try {
          const updatedMap = await window.electronAPI.previewGetLabelMap(projectPath);
          if (updatedMap) {
            dispatch({ type: 'PREVIEW_SET_LABEL_MAP', map: updatedMap });
          }
        } catch (mapErr) {
          console.warn('[PreviewView] Failed to refresh label map after edit:', mapErr);
        }
      } else {
        const errMsg = (result && result.error) || 'Unknown error';
        console.warn('[PreviewView] Edit was not applied:', result);
        setEditStatus({ type: 'error', message: `Edit failed: ${errMsg}`, timestamp: Date.now() });
      }
    } catch (err) {
      console.error('[PreviewView] Failed to update text:', err);
      setEditStatus({ type: 'error', message: `Edit failed: ${err.message}`, timestamp: Date.now() });
    }
  }, [projectPath, dispatch]);

  /** Navigate the webview to a new URL. */
  const navigateTo = useCallback((rawUrl) => {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return;
    dispatch({ type: 'PREVIEW_SET_URL', url: normalized });
    setUrlInput(normalized);
    dispatch({ type: 'PREVIEW_SET_ERROR', error: null });
    dispatch({ type: 'PREVIEW_SET_LOADING', value: true });
  }, [normalizeUrl, dispatch]);

  // --- Navigation callbacks ---

  const handleUrlSubmit = useCallback((e) => {
    e.preventDefault();
    navigateTo(urlInput);
  }, [urlInput, navigateTo]);

  const handleRefresh = useCallback(() => {
    const wv = webviewRef.current;
    if (wv && previewUrl) {
      dispatch({ type: 'PREVIEW_SET_LOADING', value: true });
      dispatch({ type: 'PREVIEW_SET_ERROR', error: null });
      wv.reload();
    }
  }, [previewUrl, dispatch]);

  const handleGoBack = useCallback(() => {
    const wv = webviewRef.current;
    if (wv && wv.canGoBack()) {
      wv.goBack();
    }
  }, []);

  const handleGoForward = useCallback(() => {
    const wv = webviewRef.current;
    if (wv && wv.canGoForward()) {
      wv.goForward();
    }
  }, []);

  const handleStop = useCallback(() => {
    const wv = webviewRef.current;
    if (wv) {
      wv.stop();
      dispatch({ type: 'PREVIEW_SET_LOADING', value: false });
    }
  }, [dispatch]);

  /** Prompt the user to select a project directory for this dashboard. */
  const handleSetProject = useCallback(async () => {
    try {
      const selectedPath = await window.electronAPI.selectProjectDirectory();
      if (selectedPath) {
        saveDashboardProject(currentDashboardId, selectedPath);
        forceUpdate(n => n + 1); // re-render so projectPath picks up the new value
      }
    } catch (err) {
      console.error('[PreviewView] Failed to set project:', err);
    }
  }, [currentDashboardId]);

  /** Detect a running dev server and auto-fill the URL bar. */
  const handleDetectDevServer = useCallback(async () => {
    if (!projectPath || detectingServer) return;
    setDetectingServer(true);
    try {
      const result = await window.electronAPI.previewDetectDevServer(projectPath);
      if (result && result.detected && result.url) {
        navigateTo(result.url);
      }
    } catch (err) {
      console.error('[PreviewView] Dev server detection failed:', err);
    } finally {
      setDetectingServer(false);
    }
  }, [projectPath, detectingServer, navigateTo]);

  // --- Webview lifecycle events ---
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !previewUrl) return;

    const onDidFinishLoad = () => {
      dispatch({ type: 'PREVIEW_SET_LOADING', value: false });
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      // Sync the URL bar if the webview navigated internally
      try {
        const currentUrl = wv.getURL();
        if (currentUrl) setUrlInput(currentUrl);
      } catch (_) { /* ignore */ }

      // Inject the overlay script + bridge for inline editing
      overlayInjectedRef.current = false;
      injectOverlay(wv);
    };

    // did-stop-loading is the definitive "all loading done" signal.
    // did-start-loading can fire multiple times (redirects, sub-frames) but
    // did-stop-loading fires exactly once when the spinner would stop.
    const onDidStopLoading = () => {
      dispatch({ type: 'PREVIEW_SET_LOADING', value: false });
    };

    const onDidFailLoad = (event) => {
      // errorCode -3 is a cancelled navigation (e.g., user stopped loading) -- ignore
      if (event.errorCode === -3) return;
      dispatch({ type: 'PREVIEW_SET_LOADING', value: false });
      dispatch({
        type: 'PREVIEW_SET_ERROR',
        error: {
          code: event.errorCode,
          description: event.errorDescription || 'Failed to load page',
          url: event.validatedURL || previewUrl,
        },
      });
    };

    const onDidStartLoading = () => {
      dispatch({ type: 'PREVIEW_SET_LOADING', value: true });
      dispatch({ type: 'PREVIEW_SET_ERROR', error: null });
    };

    const onDidNavigate = () => {
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
      try {
        const currentUrl = wv.getURL();
        if (currentUrl) setUrlInput(currentUrl);
      } catch (_) { /* ignore */ }
    };

    const onConsoleMessage = (event) => {
      const msg = event.message;

      // Check for synapse-edit bridge messages
      if (msg && msg.startsWith('__SYNAPSE_EDIT__')) {
        try {
          const editData = JSON.parse(msg.slice('__SYNAPSE_EDIT__'.length));
          console.log('[PreviewView] Received edit:', editData.label, '→', JSON.stringify(editData.newText).slice(0, 60));
          handleSynapseEdit(editData);
        } catch (parseErr) {
          console.error('[PreviewView] Failed to parse synapse-edit message:', parseErr);
        }
        return; // Don't log bridge messages to the console
      }

      // Forward other console messages from the webview
      const levelMap = { 0: 'log', 1: 'warn', 2: 'error' };
      const level = levelMap[event.level] || 'log';
      console[level](`[Preview] ${msg} (${event.sourceId}:${event.line})`);
    };

    wv.addEventListener('did-finish-load', onDidFinishLoad);
    wv.addEventListener('did-stop-loading', onDidStopLoading);
    wv.addEventListener('did-fail-load', onDidFailLoad);
    wv.addEventListener('did-start-loading', onDidStartLoading);
    wv.addEventListener('did-navigate', onDidNavigate);
    wv.addEventListener('did-navigate-in-page', onDidNavigate);
    wv.addEventListener('console-message', onConsoleMessage);

    return () => {
      wv.removeEventListener('did-finish-load', onDidFinishLoad);
      wv.removeEventListener('did-stop-loading', onDidStopLoading);
      wv.removeEventListener('did-fail-load', onDidFailLoad);
      wv.removeEventListener('did-start-loading', onDidStartLoading);
      wv.removeEventListener('did-navigate', onDidNavigate);
      wv.removeEventListener('did-navigate-in-page', onDidNavigate);
      wv.removeEventListener('console-message', onConsoleMessage);
    };
  }, [previewUrl, dispatch, injectOverlay, handleSynapseEdit]);

  // --- Render ---

  // Shared toolbar for both empty and loaded states
  const toolbar = (
    <div className="preview-toolbar">
      <div className="preview-nav-buttons">
        <button
          className="preview-nav-btn"
          disabled={!canGoBack || !previewUrl}
          onClick={handleGoBack}
          title="Back"
        >
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button
          className="preview-nav-btn"
          disabled={!canGoForward || !previewUrl}
          onClick={handleGoForward}
          title="Forward"
        >
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        {previewIsLoading ? (
          <button
            className="preview-nav-btn"
            onClick={handleStop}
            title="Stop"
          >
            <svg viewBox="0 0 16 16" width="14" height="14"><rect x="4" y="4" width="8" height="8" stroke="currentColor" strokeWidth="1.5" fill="none" rx="1"/></svg>
          </button>
        ) : (
          <button
            className="preview-nav-btn"
            disabled={!previewUrl}
            onClick={handleRefresh}
            title="Refresh"
          >
            <svg viewBox="0 0 16 16" width="14" height="14"><path d="M13 8A5 5 0 1 1 8 3m0 0l2.5 2M8 3V0.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>

      <form className="preview-url-form" onSubmit={handleUrlSubmit}>
        <input
          ref={urlInputRef}
          type="text"
          className="preview-url-input"
          placeholder="Enter URL (e.g., localhost:3000)"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {previewIsLoading && <div className="preview-url-loading-bar" />}
      </form>

      {projectPath && (
        <button
          className="preview-detect-btn"
          onClick={handleDetectDevServer}
          disabled={detectingServer}
          title="Detect running dev server"
        >
          {detectingServer ? (
            <div className="preview-detect-spinner" />
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          <span className="preview-detect-label">Detect</span>
        </button>
      )}
    </div>
  );

  // Empty state: no URL configured
  if (!previewUrl) {
    return (
      <div className="preview-view">
        {toolbar}
        <div className="preview-empty">
          <svg className="preview-empty-icon" viewBox="0 0 48 48" fill="none">
            <rect x="4" y="8" width="40" height="32" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <line x1="4" y1="16" x2="44" y2="16" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="10" cy="12" r="1.5" fill="currentColor" />
            <circle cx="15" cy="12" r="1.5" fill="currentColor" />
            <circle cx="20" cy="12" r="1.5" fill="currentColor" />
            <path d="M18 28l4-4 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="22" y1="24" x2="22" y2="34" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M30 30h-2a2 2 0 0 0-2 2v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="preview-empty-title">Live Preview</span>
          <span className="preview-empty-text">
            Enter a URL above to preview your running app
            {projectPath ? ', or click Detect to find a running dev server' : ''}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-view">
      {toolbar}

      {/* Project-not-set warning */}
      {!projectPath && (
        <div className="preview-no-project-banner">
          <span>No project set — inline editing is disabled.</span>
          <button className="preview-set-project-btn" onClick={handleSetProject}>
            Set Project
          </button>
        </div>
      )}

      {/* Webview container */}
      <div className="preview-content">
        {previewIsLoading && (
          <div className="preview-loading-overlay">
            <div className="preview-spinner" />
          </div>
        )}

        {previewError && (
          <div className="preview-error">
            <svg className="preview-error-icon" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5" />
              <path d="M24 14v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="24" cy="34" r="1.5" fill="currentColor" />
            </svg>
            <span className="preview-error-title">Failed to load page</span>
            <span className="preview-error-detail">{previewError.description} (error {previewError.code})</span>
            <span className="preview-error-url">{previewError.url}</span>
            <button className="preview-error-retry" onClick={handleRefresh}>Try Again</button>
          </div>
        )}

        <webview
          ref={webviewRef}
          src={previewUrl}
          className="preview-webview"
          /* Allow same-origin scripts; nodeintegration must stay off for security */
          allowpopups="true"
        />

        {/* Edit status toast */}
        {editStatus && (
          <div className={`preview-edit-toast preview-edit-toast--${editStatus.type}`}>
            <span>{editStatus.message}</span>
            <button className="preview-edit-toast-close" onClick={() => setEditStatus(null)}>&times;</button>
          </div>
        )}
      </div>
    </div>
  );
}
