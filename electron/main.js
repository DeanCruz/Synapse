// electron/main.js — Electron main process entry point
// Creates BrowserWindow, serves project files via custom app:// protocol,
// and manages app lifecycle.

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

// Register custom protocol scheme before app.ready (must be synchronous)
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
  },
}]);

function createWindow() {
  const settings = require('./settings');

  mainWindow = new BrowserWindow({
    width: settings.get('windowWidth'),
    height: settings.get('windowHeight'),
    x: settings.get('windowX') || undefined,
    y: settings.get('windowY') || undefined,
    backgroundColor: '#0a0a0c',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (settings.get('windowMaximized')) {
    mainWindow.maximize();
  }

  // Save window state on resize/move
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', () => settings.set('windowMaximized', true));
  mainWindow.on('unmaximize', () => settings.set('windowMaximized', false));

  // Forward renderer console to main process stdout
  mainWindow.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.log('[renderer]', msg); // warnings + errors only
  });

  // Load the dashboard HTML via custom protocol
  mainWindow.loadURL('app://synapse/public/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let saveWindowTimeout = null;
function saveWindowState() {
  clearTimeout(saveWindowTimeout);
  saveWindowTimeout = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
    const settings = require('./settings');
    const bounds = mainWindow.getBounds();
    settings.set('windowWidth', bounds.width);
    settings.set('windowHeight', bounds.height);
    settings.set('windowX', bounds.x);
    settings.set('windowY', bounds.y);
  }, 500);
}

// --- App Lifecycle ---

app.whenReady().then(() => {
  // Custom app:// protocol handler — resolves paths relative to PROJECT_ROOT.
  // index.html uses absolute paths like /src/client/app.js and /styles.css.
  // The protocol maps these to the correct locations on disk.
  protocol.handle('app', (request) => {
    const reqUrl = new URL(request.url);
    let filePath = decodeURIComponent(reqUrl.pathname);

    // Try the direct path first (handles /src/*, /public/*)
    let resolved = path.join(PROJECT_ROOT, filePath);

    // If not found, try public/ subdirectory (handles /styles.css -> public/styles.css)
    if (!fs.existsSync(resolved)) {
      const publicResolved = path.join(PROJECT_ROOT, 'public', filePath);
      if (fs.existsSync(publicResolved)) {
        resolved = publicResolved;
      }
    }

    return net.fetch(url.pathToFileURL(resolved).href);
  });

  // Initialize settings
  const settings = require('./settings');
  settings.init(app);

  // Initialize IPC handlers + file watchers
  const { registerIPCHandlers } = require('./ipc-handlers');
  registerIPCHandlers(getMainWindow);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  const { stopWatchers } = require('./ipc-handlers');
  stopWatchers();
  app.quit();
});

module.exports = { getMainWindow };
