// electron/main.js — Electron main process entry point
// Creates BrowserWindow, serves project files via custom app:// protocol,
// and manages app lifecycle.

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MAC_DOCK_ICON_PATH = path.join(__dirname, 'assets', 'icon.icns');

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

  // Forward ALL renderer console to main process stdout for debugging
  mainWindow.webContents.on('console-message', (_e, level, msg) => {
    const prefix = ['[renderer:verbose]','[renderer:info]','[renderer:warn]','[renderer:error]'][level] || '[renderer]';
    console.log(prefix, msg);
  });

  // Load the React app from the Vite build output
  mainWindow.loadURL('app://synapse/dist/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setMacDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;

  // Prefer the 512x512 PNG — nativeImage handles PNGs reliably
  const pngPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, 'assets', 'icon.iconset', 'icon_512x512.png');

  const icnsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.icns')
    : MAC_DOCK_ICON_PATH;

  const iconPath = fs.existsSync(pngPath) ? pngPath : icnsPath;

  if (fs.existsSync(iconPath)) {
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) {
        app.dock.setIcon(img);
      }
    } catch (e) {
      // Icon loading failed — non-fatal, skip silently
    }
  }
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
  // The protocol maps absolute paths to the correct locations on disk.
  protocol.handle('app', (request) => {
    const reqUrl = new URL(request.url);
    let filePath = decodeURIComponent(reqUrl.pathname);

    // Try the direct path first
    let resolved = path.join(PROJECT_ROOT, filePath);

    // If not found, try dist/ subdirectory (Vite build output)
    if (!fs.existsSync(resolved)) {
      const distResolved = path.join(PROJECT_ROOT, 'dist', filePath);
      if (fs.existsSync(distResolved)) {
        resolved = distResolved;
      }
    }

    // If still not found, try public/ subdirectory (legacy fallback)
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
  setMacDockIcon();

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
  try {
    const ClaudeCodeService = require('./services/ClaudeCodeService');
    ClaudeCodeService.killAllWorkers();
  } catch (e) { /* ignore */ }
  app.quit();
});

module.exports = { getMainWindow };
