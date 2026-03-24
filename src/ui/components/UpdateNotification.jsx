// UpdateNotification — small header pill showing auto-update status
// States: idle, checking, available, downloading, downloaded, error

import React, { useState, useEffect, useCallback } from 'react';

const STATES = {
  IDLE: 'idle',
  CHECKING: 'checking',
  AVAILABLE: 'available',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  ERROR: 'error',
};

export default function UpdateNotification() {
  const [updateState, setUpdateState] = useState(STATES.IDLE);
  const [updateInfo, setUpdateInfo] = useState(null);       // { version, releaseDate, releaseNotes }
  const [downloadProgress, setDownloadProgress] = useState(0); // 0-100
  const [errorMessage, setErrorMessage] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // Subscribe to push channels from the main process
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanups = [];

    cleanups.push(
      window.electronAPI.on('update-checking', () => {
        setUpdateState(STATES.CHECKING);
        setDismissed(false);
        setErrorMessage(null);
      })
    );

    cleanups.push(
      window.electronAPI.on('update-available', (info) => {
        setUpdateState(STATES.AVAILABLE);
        setUpdateInfo(info);
        setDismissed(false);
      })
    );

    cleanups.push(
      window.electronAPI.on('update-not-available', () => {
        setUpdateState(STATES.IDLE);
        setUpdateInfo(null);
      })
    );

    cleanups.push(
      window.electronAPI.on('update-progress', (progress) => {
        setUpdateState(STATES.DOWNLOADING);
        setDownloadProgress(Math.round(progress.percent || 0));
      })
    );

    cleanups.push(
      window.electronAPI.on('update-downloaded', (info) => {
        setUpdateState(STATES.DOWNLOADED);
        setUpdateInfo(info);
        setDownloadProgress(100);
      })
    );

    cleanups.push(
      window.electronAPI.on('update-error', (data) => {
        setUpdateState(STATES.ERROR);
        setErrorMessage(data?.error || 'Update failed');
      })
    );

    // Also fetch initial status in case we missed events
    window.electronAPI.getUpdateStatus?.().then((status) => {
      if (!status) return;
      if (status.downloaded) {
        setUpdateState(STATES.DOWNLOADED);
        setUpdateInfo(status.updateInfo);
      } else if (status.downloading) {
        setUpdateState(STATES.DOWNLOADING);
        setDownloadProgress(Math.round(status.downloadProgress?.percent || 0));
      } else if (status.updateAvailable) {
        setUpdateState(STATES.AVAILABLE);
        setUpdateInfo(status.updateInfo);
      } else if (status.checking) {
        setUpdateState(STATES.CHECKING);
      } else if (status.error) {
        setUpdateState(STATES.ERROR);
        setErrorMessage(status.error);
      }
    }).catch(() => {});

    return () => { cleanups.forEach(fn => fn && fn()); };
  }, []);

  const handleCheckForUpdate = useCallback(() => {
    window.electronAPI?.checkForUpdate?.().catch(() => {});
  }, []);

  const handleDownload = useCallback(() => {
    window.electronAPI?.downloadUpdate?.().catch(() => {});
  }, []);

  const handleInstall = useCallback(() => {
    window.electronAPI?.quitAndInstall?.();
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Nothing to show in idle state or when dismissed (except downloaded — never dismiss that)
  if (updateState === STATES.IDLE) return null;
  if (dismissed && updateState !== STATES.DOWNLOADED) return null;
  if (!window.electronAPI) return null;

  return (
    <div className={`update-notification update-notification--${updateState}`}>
      {updateState === STATES.CHECKING && (
        <>
          <span className="update-notification__spinner" />
          <span className="update-notification__text">Checking...</span>
        </>
      )}

      {updateState === STATES.AVAILABLE && (
        <>
          <span className="update-notification__dot update-notification__dot--available" />
          <span className="update-notification__text">
            v{updateInfo?.version || '?'} available
          </span>
          <button
            className="update-notification__action"
            onClick={handleDownload}
          >
            Download
          </button>
          <button
            className="update-notification__dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        </>
      )}

      {updateState === STATES.DOWNLOADING && (
        <>
          <span className="update-notification__spinner" />
          <span className="update-notification__text">
            Downloading {downloadProgress}%
          </span>
          <span className="update-notification__progress-track">
            <span
              className="update-notification__progress-bar"
              style={{ width: `${downloadProgress}%` }}
            />
          </span>
        </>
      )}

      {updateState === STATES.DOWNLOADED && (
        <>
          <span className="update-notification__dot update-notification__dot--ready" />
          <span className="update-notification__text">
            v{updateInfo?.version || '?'} ready
          </span>
          <button
            className="update-notification__action update-notification__action--install"
            onClick={handleInstall}
          >
            Restart
          </button>
        </>
      )}

      {updateState === STATES.ERROR && (
        <>
          <span className="update-notification__dot update-notification__dot--error" />
          <span className="update-notification__text" title={errorMessage}>
            Update error
          </span>
          <button
            className="update-notification__dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Standalone "Check for Updates" button for use in Settings or elsewhere.
 * Self-contained — manages its own loading state.
 */
export function CheckForUpdatesButton({ className }) {
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!window.electronAPI || !checking) return;

    const cleanups = [];

    // Any result clears the checking state
    cleanups.push(window.electronAPI.on('update-available', () => setChecking(false)));
    cleanups.push(window.electronAPI.on('update-not-available', () => setChecking(false)));
    cleanups.push(window.electronAPI.on('update-error', () => setChecking(false)));

    return () => { cleanups.forEach(fn => fn && fn()); };
  }, [checking]);

  function handleClick() {
    setChecking(true);
    window.electronAPI?.checkForUpdate?.().catch(() => setChecking(false));
  }

  if (!window.electronAPI) return null;

  return (
    <button
      className={className || 'settings-check-update-btn'}
      onClick={handleClick}
      disabled={checking}
    >
      {checking ? 'Checking...' : 'Check for Updates'}
    </button>
  );
}
