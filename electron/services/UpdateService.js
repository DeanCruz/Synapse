// electron/services/UpdateService.js — Auto-update service using electron-updater

var broadcastFn = null;
var autoUpdater = null;
var available = false;

// Internal state object — returned by getUpdateInfo()
var state = {
  checking: false,
  updateAvailable: false,
  updateInfo: null,
  downloading: false,
  downloadProgress: null,
  downloaded: false,
  error: null
};

/**
 * Reset state to defaults (preserving updateInfo if an update was found).
 */
function resetState() {
  state = {
    checking: false,
    updateAvailable: false,
    updateInfo: null,
    downloading: false,
    downloadProgress: null,
    downloaded: false,
    error: null
  };
}

/**
 * Safely broadcast an event to the renderer process.
 * @param {string} channel
 * @param {*} data
 */
function broadcast(channel, data) {
  if (broadcastFn) {
    try {
      broadcastFn(channel, data);
    } catch (err) {
      console.error('[UpdateService] broadcast error:', err.message);
    }
  }
}

/**
 * Initialize the update service.
 * Sets up autoUpdater event listeners and stores the broadcast function.
 *
 * @param {Function} broadcastFunction — (channel, data) => void
 */
function init(broadcastFunction) {
  broadcastFn = broadcastFunction;

  // Attempt to load electron-updater — graceful degradation if not installed
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.warn('[UpdateService] electron-updater not available:', err.message);
    available = false;
    return;
  }

  available = true;

  // Safe defaults — never auto-download or auto-install
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  // --- Event listeners ---

  autoUpdater.on('checking-for-update', function () {
    state.checking = true;
    state.error = null;
    broadcast('update-checking', { checking: true });
  });

  autoUpdater.on('update-available', function (info) {
    state.checking = false;
    state.updateAvailable = true;
    state.updateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || null
    };
    broadcast('update-available', state.updateInfo);
  });

  autoUpdater.on('update-not-available', function (info) {
    state.checking = false;
    state.updateAvailable = false;
    state.updateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || null
    };
    broadcast('update-not-available', state.updateInfo);
  });

  autoUpdater.on('download-progress', function (progress) {
    state.downloading = true;
    state.downloadProgress = {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred
    };
    broadcast('update-progress', state.downloadProgress);
  });

  autoUpdater.on('update-downloaded', function (info) {
    state.downloading = false;
    state.downloaded = true;
    state.downloadProgress = null;
    state.updateInfo = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || null
    };
    broadcast('update-downloaded', state.updateInfo);
  });

  autoUpdater.on('error', function (err) {
    state.checking = false;
    state.downloading = false;
    state.error = err ? err.message : 'Unknown update error';
    broadcast('update-error', { error: state.error });
  });

  console.log('[UpdateService] init() complete, autoUpdater ready');
}

/**
 * Check for available updates.
 * Broadcasts 'update-available', 'update-not-available', or 'update-error'.
 *
 * @returns {Promise<object|null>} — Update check result, or null on error/unavailable
 */
function checkForUpdates() {
  if (!available || !autoUpdater) {
    var msg = 'electron-updater is not available';
    state.error = msg;
    broadcast('update-error', { error: msg });
    return Promise.resolve(null);
  }

  state.checking = true;
  state.error = null;

  try {
    return autoUpdater.checkForUpdates()
      .then(function (result) {
        return result;
      })
      .catch(function (err) {
        state.checking = false;
        state.error = err.message;
        broadcast('update-error', { error: err.message });
        return null;
      });
  } catch (err) {
    // Synchronous throw (e.g., no publish config)
    state.checking = false;
    state.error = err.message;
    broadcast('update-error', { error: err.message });
    return Promise.resolve(null);
  }
}

/**
 * Download the available update.
 * Broadcasts 'update-progress' events during download and 'update-downloaded' on completion.
 *
 * @returns {Promise<string|null>} — Download path, or null on error/unavailable
 */
function downloadUpdate() {
  if (!available || !autoUpdater) {
    var msg = 'electron-updater is not available';
    state.error = msg;
    broadcast('update-error', { error: msg });
    return Promise.resolve(null);
  }

  if (!state.updateAvailable) {
    var msg2 = 'No update available to download';
    state.error = msg2;
    broadcast('update-error', { error: msg2 });
    return Promise.resolve(null);
  }

  state.downloading = true;
  state.error = null;

  try {
    return autoUpdater.downloadUpdate()
      .then(function (result) {
        return result;
      })
      .catch(function (err) {
        state.downloading = false;
        state.error = err.message;
        broadcast('update-error', { error: err.message });
        return null;
      });
  } catch (err) {
    state.downloading = false;
    state.error = err.message;
    broadcast('update-error', { error: err.message });
    return Promise.resolve(null);
  }
}

/**
 * Quit the app and install the downloaded update.
 * This will close the application — the user must explicitly trigger this.
 */
function quitAndInstall() {
  if (!available || !autoUpdater) {
    var msg = 'electron-updater is not available';
    state.error = msg;
    broadcast('update-error', { error: msg });
    return;
  }

  if (!state.downloaded) {
    var msg2 = 'No update has been downloaded yet';
    state.error = msg2;
    broadcast('update-error', { error: msg2 });
    return;
  }

  // isSilent=false (show installer), isForceRunAfter=true (relaunch after install)
  autoUpdater.quitAndInstall(false, true);
}

/**
 * Get the current update state.
 *
 * @returns {object} — { checking, updateAvailable, updateInfo, downloading, downloadProgress, downloaded, error }
 */
function getUpdateInfo() {
  return Object.assign({}, state);
}

module.exports = {
  init: init,
  checkForUpdates: checkForUpdates,
  downloadUpdate: downloadUpdate,
  quitAndInstall: quitAndInstall,
  getUpdateInfo: getUpdateInfo
};
