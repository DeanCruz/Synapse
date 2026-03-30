# Configuration Reference

This document covers Synapse's Electron app settings, build configuration, and distribution setup.

---

## Settings Store

**File:** `electron/settings.js` (105 lines)

Settings are persisted as a JSON file at `{userData}/synapse-settings.json` (the Electron `userData` directory, e.g., `~/Library/Application Support/synapse/` on macOS). The store implements a simple get/set interface with in-memory caching and synchronous disk writes.

### API

| Method | Signature | Description |
|---|---|---|
| `init(electronApp)` | `init(app)` | Initialize with Electron app (resolves settings path) |
| `get(key)` | `get(string) -> any` | Get a setting value (falls back to default) |
| `set(key, value)` | `set(string, any)` | Set a setting value and persist to disk |
| `getAll()` | `getAll() -> object` | Get all settings (merged defaults + overrides) |
| `reset()` | `reset() -> object` | Delete settings file and return defaults |

### Default Settings

#### Window Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `windowWidth` | `number` | `1400` | Window width in pixels |
| `windowHeight` | `number` | `900` | Window height in pixels |
| `windowX` | `number\|null` | `null` | Window X position (null = OS default) |
| `windowY` | `number\|null` | `null` | Window Y position (null = OS default) |
| `windowMaximized` | `boolean` | `false` | Whether window is maximized |

Window position and size are saved automatically on resize/move events (debounced at 500ms). On startup, the saved dimensions and position are restored. If `windowMaximized` is true, the window is maximized after creation.

#### Behavior Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `dashboardCount` | `number` | `5` | Number of dashboard slots available |

#### Dashboard Metadata

| Key | Type | Default | Description |
|---|---|---|---|
| `dashboardMeta` | `object` | `{ order: [], names: {} }` | Sidebar ordering and custom display names for dashboards |

The `dashboardMeta` object has two sub-fields:
- `order` -- Array of dashboard IDs defining sidebar display order
- `names` -- Object mapping dashboard IDs to custom display names

Managed via IPC: `reorderDashboards(orderedIds)` and `renameDashboard(id, displayName)`.

#### Performance / Polling Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `initPollMs` | `number` | `100` | Polling interval for initialization.json changes (ms) |
| `progressRetryMs` | `number` | `80` | Retry interval for progress file reads (ms) |
| `progressReadDelayMs` | `number` | `30` | Delay before reading a changed progress file (ms) |
| `reconcileDebounceMs` | `number` | `300` | Debounce interval for reconciliation logic (ms) |

These settings control the file watcher timing. Lower values give faster UI updates but higher CPU usage.

#### Theme Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `theme` | `string` | `"original"` | Active theme name |
| `customColors` | `object\|null` | `null` | Custom color overrides |

#### Project Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `recentProjects` | `array` | `[]` | List of recent projects (`{ path, name, lastOpened }`) |
| `activeProjectPath` | `string\|null` | `null` | Currently active project path |
| `agentProvider` | `string` | `"claude"` | Active CLI provider (`"claude"` or `"codex"`) |
| `claudeCliPath` | `string\|null` | `null` | Path to Claude CLI binary (null = auto-detect) |
| `codexCliPath` | `string\|null` | `null` | Path to Codex CLI binary (null = auto-detect) |
| `defaultModel` | `string` | `""` | Default model name for worker agents |
| `dangerouslySkipPermissions` | `boolean` | `false` | Skip CLI permission prompts |

### Recent Projects List

The recent projects list is managed via IPC:
- `addRecentProject(project)` -- Adds or promotes a project to the top
- `getRecentProjects()` -- Returns the list (max 10 entries)

Each entry contains:
```javascript
{
  path: "/path/to/project",
  name: "my-app",
  lastOpened: "2026-03-22T15:00:00Z"
}
```

Duplicates are removed by path before prepending.

### Extensibility

The settings store allows unknown keys (logs a warning but persists them). This supports extension by the renderer or future features without requiring schema changes.

---

## Build Configuration

### Vite Configuration

**File:** `vite.config.js`

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/ui'),
    },
  },
  optimizeDeps: {
    include: [
      'monaco-editor/esm/vs/editor/editor.worker',
      'monaco-editor/esm/vs/language/json/json.worker',
      'monaco-editor/esm/vs/language/css/css.worker',
      'monaco-editor/esm/vs/language/html/html.worker',
      'monaco-editor/esm/vs/language/typescript/ts.worker',
    ],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
});
```

| Setting | Value | Purpose |
|---|---|---|
| `root` | `"."` | Project root for Vite |
| `base` | `"./"` | Relative base path for assets (required for `app://` protocol) |
| `build.outDir` | `"dist"` | Output directory for the build |
| `build.emptyOutDir` | `true` | Clean output directory before each build |
| `resolve.alias.@` | `src/ui` | Import alias for UI source files |
| `plugins` | `[react()]` | React support via `@vitejs/plugin-react` |
| `optimizeDeps.include` | Monaco worker modules | Pre-bundle Monaco Editor web workers for faster dev startup |
| `server.port` | `5174` | Dev server port (Electron loads from `http://localhost:5174` in dev mode) |
| `server.strictPort` | `true` | Fail if port 5174 is already in use (prevents port mismatch with Electron) |
| `worker.format` | `"es"` | Use ES module format for web workers (Monaco Editor compatibility) |

### npm Scripts

**File:** `package.json`

| Script | Command | Description |
|---|---|---|
| `build` | `vite build` | Build the React frontend to `dist/` |
| `start` | `vite build && unset ELECTRON_RUN_AS_NODE && electron .` | Build and launch the Electron app |
| `dev` | `concurrently -k "vite" "electron ."` | Run Vite dev server and Electron concurrently (full HMR) |
| `dist` | `vite build && electron-builder --mac` | Build frontend and package as macOS DMG |
| `postinstall` | `electron-rebuild -f -w node-pty` | Rebuild native `node-pty` module for current Electron version |

The `start` script unsets `ELECTRON_RUN_AS_NODE` to prevent Electron from running as a plain Node.js process, which can happen if this environment variable is set by parent processes. The `dev` script uses `concurrently` to run Vite's dev server (with HMR on `http://localhost:5174`) alongside Electron, killing both when either exits (`-k` flag).

---

## Electron Builder Configuration

**File:** `package.json` (`build` key)

### App Identity

| Key | Value |
|---|---|
| `appId` | `com.synapse.app` |
| `productName` | `Synapse` |

### macOS Target

```json
{
  "mac": {
    "icon": "electron/assets/icon.icns",
    "target": "dmg",
    "category": "public.app-category.developer-tools"
  }
}
```

| Setting | Value | Description |
|---|---|---|
| `icon` | `electron/assets/icon.icns` | macOS app icon (ICNS format) |
| `target` | `dmg` | Package as disk image |
| `category` | `public.app-category.developer-tools` | macOS App Store category |

### Files Included in Build

```json
{
  "files": [
    "electron/**/*",
    "src/server/**/*",
    "dist/**/*",
    "dashboards/**/*",
    "!node_modules/**/*"
  ]
}
```

| Pattern | Purpose |
|---|---|
| `electron/**/*` | Main process code and services |
| `src/server/**/*` | Shared server services (DashboardService, WatcherService, etc.) |
| `dist/**/*` | Vite build output (React frontend) |
| `dashboards/**/*` | Dashboard data directories |
| `!node_modules/**/*` | Exclude node_modules (Electron builder handles dependencies) |

### Extra Resources

```json
{
  "extraResources": [
    { "from": "dashboards", "to": "dashboards" },
    { "from": "electron/assets/icon.icns", "to": "icon.icns" }
  ]
}
```

These files are copied into the `Resources/` directory of the packaged app:
- `dashboards/` -- Ensures dashboard directories exist in the packaged app
- `icon.icns` -- macOS dock icon (accessed via `process.resourcesPath` at runtime)

---

## Dependencies

### Runtime Dependencies

| Package | Version | Purpose |
|---|---|---|
| `react` | `^19.2.4` | UI framework |
| `react-dom` | `^19.2.4` | React DOM renderer |
| `@xterm/xterm` | `^6.0.0` | Terminal emulator for embedded terminal panels |
| `@xterm/addon-fit` | `^0.11.0` | Auto-resize addon for xterm.js terminals |
| `monaco-editor` | `^0.55.1` | Code editor component (IDE file editing) |
| `node-pty` | `^1.1.0` | Native pseudo-terminal for spawning shell processes |
| `nvm` | `^0.0.4` | Node version management helper |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `electron` | `^41.0.3` | Desktop app framework |
| `electron-builder` | `^26.8.1` | App packaging and distribution |
| `@electron/rebuild` | `^4.0.3` | Rebuild native modules (node-pty) for Electron's Node.js version |
| `vite` | `^8.0.0` | Frontend build tool |
| `@vitejs/plugin-react` | `^6.0.1` | React support for Vite |
| `concurrently` | `^9.2.1` | Run Vite dev server and Electron in parallel during development |

### Native Modules

`node-pty` is a native C++ addon that must be compiled for the specific Electron/Node.js ABI. The `postinstall` script (`electron-rebuild -f -w node-pty`) handles this automatically after `npm install`. If `node-pty` fails to load at runtime, run `npx electron-rebuild -f -w node-pty` manually.

### Zero-Dependency Server

The `src/server/` code (shared services used by both the Electron main process and the standalone Node.js server) has zero npm dependencies. It uses only Node.js built-in modules (`fs`, `path`, `http`, `url`, `crypto`). This ensures the server and shared services work with any Node.js installation without `npm install`.

---

## Protocol Handler

### `app://` Custom Protocol

Registered in `electron/main.js` before `app.ready`:

```javascript
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,         // Treated as a standard URL scheme
    secure: true,           // Treated as secure (like HTTPS)
    supportFetchAPI: true,  // Can be used with fetch()
    corsEnabled: true,      // CORS is enabled
  },
}]);
```

The handler resolves requests to `app://synapse/{path}` by searching:

1. `{PROJECT_ROOT}/{path}` -- Direct file path
2. `{PROJECT_ROOT}/dist/{path}` -- Vite build output
3. `{PROJECT_ROOT}/public/{path}` -- Legacy static assets

Files are served via `net.fetch(url.pathToFileURL(resolved).href)` which handles MIME type detection automatically.

### Entry Point

The renderer loads from: `app://synapse/dist/index.html`

---

## Environment Variables

| Variable | Effect |
|---|---|
| `ELECTRON_RUN_AS_NODE` | Deleted from worker process environments to prevent CLI tools from running in Node.js mode |
| `CLAUDECODE` | Deleted from worker process environments to prevent interference |
| `PORT` | Used by the standalone Node.js server (`src/server/index.js`) for HTTP port configuration |

---

## Window Configuration

### Initial Window Creation

```javascript
new BrowserWindow({
  width: settings.get('windowWidth'),     // default: 1400
  height: settings.get('windowHeight'),   // default: 900
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
```

| Setting | Value | Purpose |
|---|---|---|
| `backgroundColor` | `#0a0a0c` | Prevents white flash during load |
| `titleBarStyle` | `hiddenInset` (macOS) | Integrates with macOS traffic lights |
| `contextIsolation` | `true` | Security: isolates preload from renderer |
| `nodeIntegration` | `false` | Security: no Node.js APIs in renderer |

### State Persistence

Window state is persisted across sessions:
- **On resize/move:** Position and size saved (debounced 500ms)
- **On maximize/unmaximize:** Maximized state saved immediately
- **On startup:** Saved dimensions applied; if maximized, `window.maximize()` called after creation
- **When maximized:** Resize/move saves are skipped (to preserve pre-maximize dimensions)
