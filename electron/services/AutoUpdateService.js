const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let broadcast = () => {};
let initialized = false;
let startupCheckTimer = null;

const state = {
  currentVersion: app.getVersion(),
  checking: false,
  available: false,
  downloaded: false,
  updateInfo: null,
  progress: null,
  error: null,
  lastCheckedAt: null,
  message: app.isPackaged
    ? 'Automatic updates are ready.'
    : 'Automatic updates only work in packaged builds.',
};

function snapshot() {
  return {
    ...state,
    currentVersion: app.getVersion(),
  };
}

function emit() {
  broadcast('update-status', snapshot());
}

function setState(patch) {
  Object.assign(state, patch);
  emit();
}

function initAutoUpdater(broadcastFn) {
  if (initialized) return;
  initialized = true;
  broadcast = typeof broadcastFn === 'function' ? broadcastFn : () => {};

  if (!app.isPackaged) {
    emit();
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setState({
      checking: true,
      error: null,
      progress: null,
      downloaded: false,
      lastCheckedAt: new Date().toISOString(),
      message: 'Checking for updates...',
    });
  });

  autoUpdater.on('update-available', (info) => {
    setState({
      checking: false,
      available: true,
      downloaded: false,
      updateInfo: info || null,
      progress: null,
      error: null,
      message: `Downloading ${info?.version || 'the latest update'}...`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    setState({
      checking: false,
      available: false,
      downloaded: false,
      updateInfo: info || null,
      progress: null,
      error: null,
      message: 'You are on the latest version.',
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setState({
      available: true,
      downloaded: false,
      progress: progress || null,
      error: null,
      message: `Downloading update: ${Math.round(progress?.percent || 0)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setState({
      checking: false,
      available: true,
      downloaded: true,
      updateInfo: info || null,
      progress: { percent: 100 },
      error: null,
      message: 'Update downloaded. Restart Synapse to install it.',
    });
  });

  autoUpdater.on('error', (error) => {
    setState({
      checking: false,
      error: error ? error.message : 'Unknown update error',
      message: error ? error.message : 'Update check failed.',
    });
  });

  emit();

  startupCheckTimer = setTimeout(() => {
    checkForUpdates().catch(() => {});
  }, 10_000);
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setState({
      checking: false,
      error: null,
      message: 'Updates can only be checked from a packaged build.',
    });
    return snapshot();
  }

  await autoUpdater.checkForUpdates();
  return snapshot();
}

function quitAndInstallUpdate() {
  if (!state.downloaded) {
    return { success: false, error: 'No downloaded update is ready to install.' };
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });

  return { success: true };
}

function getUpdateState() {
  return snapshot();
}

function disposeAutoUpdater() {
  if (startupCheckTimer) {
    clearTimeout(startupCheckTimer);
    startupCheckTimer = null;
  }
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  quitAndInstallUpdate,
  getUpdateState,
  disposeAutoUpdater,
};
