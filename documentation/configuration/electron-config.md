# Electron Configuration

The Synapse desktop application is built on Electron. Its configuration is managed by a JSON-backed settings store defined in:

```
electron/settings.js
```

This module provides a simple key-value API (`get`, `set`, `getAll`, `reset`) backed by a JSON file on disk. Settings persist across application restarts and are used by both the main process and (via IPC) the renderer process.

---

## Settings File Location

```
{userData}/synapse-settings.json
```

The `{userData}` path is OS-specific, determined by Electron's `app.getPath('userData')`:

| Platform | Typical Path |
|---|---|
| **macOS** | `~/Library/Application Support/Synapse/synapse-settings.json` |
| **Windows** | `%APPDATA%\Synapse\synapse-settings.json` |
| **Linux** | `~/.config/Synapse/synapse-settings.json` |

The settings file is created automatically on first write. If it is missing or corrupt at startup, the store initializes with an empty cache and falls back to defaults for all values.

---

## Default Settings

The `DEFAULTS` object defines every recognized setting and its default value:

### Window Geometry

| Key | Default | Type | Purpose |
|---|---|---|---|
| `windowWidth` | `1400` | number | Window width in pixels |
| `windowHeight` | `900` | number | Window height in pixels |
| `windowX` | `null` | number \| null | Window X position (null = OS default) |
| `windowY` | `null` | number \| null | Window Y position (null = OS default) |
| `windowMaximized` | `false` | boolean | Whether the window was maximized when last closed |

Window geometry is saved automatically on resize and move events (debounced to 500ms) and restored on the next launch. When `windowMaximized` is `true`, the window opens maximized regardless of `windowWidth`/`windowHeight`.

### Behavior

| Key | Default | Type | Purpose |
|---|---|---|---|
| `dashboardCount` | `5` | number | Number of dashboard slots available in the sidebar |

### Performance / Polling

These settings mirror the server-side timing constants but apply to the Electron process. They allow the desktop app to tune its own file-watching behavior independently of the server.

| Key | Default | Type | Purpose |
|---|---|---|---|
| `initPollMs` | `100` | number | Polling interval for `initialization.json` and `logs.json` |
| `progressRetryMs` | `80` | number | Retry delay when a progress file read fails |
| `progressReadDelayMs` | `30` | number | Delay before reading a changed progress file |
| `reconcileDebounceMs` | `300` | number | Debounce interval for directory change reconciliation |

### Theme

| Key | Default | Type | Purpose |
|---|---|---|---|
| `theme` | `'original'` | string | Active theme name. Currently `'original'` is the only built-in theme. |
| `customColors` | `null` | object \| null | Reserved for future custom color overrides. Not currently used by the renderer. |

### Project Management

| Key | Default | Type | Purpose |
|---|---|---|---|
| `recentProjects` | `[]` | array | List of recently opened project paths, used for quick switching |
| `activeProjectPath` | `null` | string \| null | The currently active target project path |
| `agentProvider` | `'claude'` | string | Which AI agent provider to use (e.g., `'claude'`) |
| `claudeCliPath` | `null` | string \| null | Custom path to the Claude CLI binary (null = use system PATH) |
| `codexCliPath` | `null` | string \| null | Custom path to the Codex CLI binary |
| `defaultModel` | `''` | string | Default model to use for agent dispatch (empty = provider default) |
| `dangerouslySkipPermissions` | `false` | boolean | When `true`, agents are dispatched with `--dangerously-skip-permissions`. **Use with caution** — this skips all safety confirmations. |

---

## API

The settings module exports five functions:

### `init(electronApp)`

Initializes the settings store. Must be called once during `app.whenReady()` with the Electron `app` object. Resolves the settings file path and loads any persisted values into the in-memory cache.

```js
const settings = require('./settings');
settings.init(app);
```

### `get(key)`

Returns the value for `key`. Checks the in-memory cache first, then falls back to `DEFAULTS`. Returns `undefined` for keys not in either.

```js
settings.get('windowWidth');  // 1400 (default) or persisted value
settings.get('theme');        // 'original'
```

### `set(key, value)`

Sets `key` to `value` in the cache and immediately persists the entire cache to disk. Unknown keys (not in `DEFAULTS`) are accepted with a console warning — this allows extensibility without schema changes.

```js
settings.set('windowWidth', 1600);
settings.set('activeProjectPath', '/Users/dean/repos/my-app');
```

### `getAll()`

Returns a merged object of all settings: persisted values overlaid on defaults. Useful for sending the full configuration to the renderer process via IPC.

```js
const allSettings = settings.getAll();
// { windowWidth: 1400, windowHeight: 900, theme: 'original', ... }
```

### `reset()`

Clears the in-memory cache and deletes the settings file from disk. Returns the default settings (as if the app were freshly installed).

```js
const defaults = settings.reset();
```

---

## Window State Persistence

The Electron main process (`electron/main.js`) automatically saves and restores window state:

### Save (on resize/move)

```js
mainWindow.on('resize', saveWindowState);
mainWindow.on('move', saveWindowState);
mainWindow.on('maximize', () => settings.set('windowMaximized', true));
mainWindow.on('unmaximize', () => settings.set('windowMaximized', false));
```

The `saveWindowState` function is debounced to 500ms to avoid excessive disk writes during continuous resize/drag operations. It saves `windowWidth`, `windowHeight`, `windowX`, and `windowY` from `mainWindow.getBounds()`. It skips saving if the window is maximized (since bounds in maximized state are not meaningful for restore).

### Restore (on launch)

```js
mainWindow = new BrowserWindow({
  width: settings.get('windowWidth'),
  height: settings.get('windowHeight'),
  x: settings.get('windowX') || undefined,
  y: settings.get('windowY') || undefined,
  // ...
});

if (settings.get('windowMaximized')) {
  mainWindow.maximize();
}
```

When `windowX` or `windowY` is `null` (first launch), `undefined` is passed, letting the OS choose the window position.

---

## Electron Window Configuration

The `BrowserWindow` is created with these fixed settings:

| Setting | Value | Purpose |
|---|---|---|
| `backgroundColor` | `'#0a0a0c'` | Matches the CSS `--bg` variable — prevents white flash on load |
| `titleBarStyle` | `'hiddenInset'` (macOS) / `'default'` (other) | Integrates the title bar with the app content on macOS |
| `contextIsolation` | `true` | Security: renderer cannot access Node.js APIs directly |
| `nodeIntegration` | `false` | Security: renderer runs in a sandboxed browser context |
| `preload` | `electron/preload.js` | Bridge script that exposes safe APIs to the renderer via `contextBridge` |

---

## Custom Protocol

Synapse registers a custom `app://` protocol scheme for serving frontend assets:

```js
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
  },
}]);
```

The protocol handler resolves file paths in this order:

1. **Direct path** — `{project_root}/{pathname}`
2. **Dist directory** — `{project_root}/dist/{pathname}` (Vite build output)
3. **Public directory** — `{project_root}/public/{pathname}` (legacy fallback)

The React app is loaded from `app://synapse/dist/index.html`.

---

## Build and Packaging

Electron packaging is configured in `package.json` under the `"build"` key:

```json
{
  "build": {
    "appId": "com.synapse.app",
    "productName": "Synapse",
    "mac": {
      "icon": "electron/assets/icon.icns",
      "target": "dmg",
      "category": "public.app-category.developer-tools"
    },
    "files": [
      "electron/**/*",
      "src/server/**/*",
      "dist/**/*",
      "dashboards/**/*",
      "!node_modules/**/*"
    ],
    "extraResources": [
      { "from": "dashboards", "to": "dashboards" },
      { "from": "electron/assets/icon.icns", "to": "icon.icns" }
    ]
  }
}
```

**Key points:**

- The build target is macOS DMG only (`"target": "dmg"`).
- The packaged app includes the Electron shell, the server code, the built frontend (`dist/`), and the dashboards directory.
- `node_modules` is excluded — dependencies are bundled by the build process.
- Dashboard directories are copied as extra resources so they are accessible at runtime.

### NPM Scripts

| Script | Command | Purpose |
|---|---|---|
| `npm run build` | `vite build` | Build the React frontend to `dist/` |
| `npm start` | `vite build && unset ELECTRON_RUN_AS_NODE && electron .` | Build frontend, then launch the Electron app |
| `npm run dev` | `vite build --watch` | Watch mode — rebuild frontend on file changes |
| `npm run dist` | `vite build && electron-builder --mac` | Build frontend and package as macOS DMG |

The `unset ELECTRON_RUN_AS_NODE` in `npm start` ensures Electron launches as a GUI application. Without this, some environments may try to run Electron as a plain Node.js process.

---

## Related Documentation

- [Configuration Overview](overview.md) — How all configuration layers fit together.
- [Server Configuration](server-config.md) — Server-side constants and timing.
- [Theming](theming.md) — Visual customization and the CSS design system.
