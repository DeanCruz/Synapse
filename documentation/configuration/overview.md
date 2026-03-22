# Configuration Overview

Synapse has a layered configuration system split across three runtime contexts: the **Node.js SSE server**, the **Electron desktop shell**, and the **Vite-built React frontend**. Each layer has its own configuration source, defaults, and override mechanism.

---

## Configuration Layers

| Layer | File(s) | Runtime | Scope |
|---|---|---|---|
| **Server constants** | `src/server/utils/constants.js` | Node.js | Paths, ports, polling intervals, MIME types, default data shapes |
| **Electron settings** | `electron/settings.js` | Electron main process | Window geometry, dashboard count, theme, project paths, performance tuning |
| **Build configuration** | `vite.config.js`, `package.json` | Build time | Vite plugins, output paths, module aliases, Electron packaging |
| **CSS design tokens** | `src/ui/styles/index.css` | Browser / renderer | Colors, fonts, spacing, status palette, glass morphism effects |
| **Project config** | `.synapse/project.json` | Agent runtime | Active target project path |

---

## How Configuration Loads

### Server Startup

When `node src/server/index.js` starts:

1. `constants.js` is `require()`-d at the top of the server module.
2. `PORT` reads from `process.env.PORT`, falling back to `3456`.
3. `ROOT` is resolved as three directories above `constants.js` (i.e., the Synapse repository root).
4. All directory paths (`DASHBOARDS_DIR`, `QUEUE_DIR`, `ARCHIVE_DIR`, `HISTORY_DIR`, `CONVERSATIONS_DIR`) are derived from `ROOT` using `path.join`.
5. Timing constants (polling intervals, debounce windows, heartbeat) are hardcoded numeric values — no environment variable overrides except `PORT`.

### Electron Startup

When `npm start` launches the Electron app:

1. `app.whenReady()` fires in `electron/main.js`.
2. `settings.init(app)` is called, which resolves the settings file path to `{userData}/synapse-settings.json` and loads any previously persisted settings from disk.
3. `createWindow()` reads window geometry from settings (`windowWidth`, `windowHeight`, `windowX`, `windowY`, `windowMaximized`) to restore the previous window state.
4. IPC handlers are registered, connecting the renderer process to the main process.
5. The React app is loaded from the Vite build output at `app://synapse/dist/index.html`.

### Frontend (Renderer)

The React frontend does not have its own configuration file. It receives configuration through:

- **CSS custom properties** defined in `:root` of `src/ui/styles/index.css` — colors, fonts, spacing.
- **SSE connection** to the server for live dashboard data.
- **Electron IPC** (via `preload.js`) for settings that the renderer needs from the main process.

---

## Configuration Precedence

For the **server port**, the precedence is:

```
Environment variable PORT  →  Hardcoded default (3456)
```

For **Electron settings**, the precedence is:

```
Persisted value in synapse-settings.json  →  DEFAULTS object in settings.js
```

Unknown keys are accepted for extensibility (with a console warning), so the settings store is not strictly schema-locked.

For **project path** resolution, the precedence is:

```
Explicit --project flag  →  .synapse/project.json  →  Current working directory
```

---

## Key Configuration Files at a Glance

| File | Location | Format | Mutable at Runtime |
|---|---|---|---|
| `constants.js` | `src/server/utils/` | CommonJS module | No — hardcoded, read once |
| `settings.js` | `electron/` | JSON-backed store | Yes — read/write via `get()`/`set()` |
| `synapse-settings.json` | `{userData}/` (OS-specific) | JSON | Yes — written by `settings.js` |
| `project.json` | `.synapse/` | JSON | Yes — written by `!project set` |
| `index.css` | `src/ui/styles/` | CSS | No — compiled at build time |
| `vite.config.js` | Repository root | ESM | No — read at build time |
| `package.json` | Repository root | JSON | No — metadata and build scripts |

---

## Environment Variables

Synapse uses a minimal set of environment variables:

| Variable | Used By | Default | Purpose |
|---|---|---|---|
| `PORT` | `src/server/utils/constants.js` | `3456` | HTTP port for the SSE server |
| `ELECTRON_RUN_AS_NODE` | `npm start` script (unset) | — | Unset during `npm start` to ensure Electron runs as a GUI app, not a Node.js script |

No `.env` file is used. The server is designed to run with zero configuration — `node src/server/index.js` works out of the box with sensible defaults.

---

## Related Documentation

- [Server Configuration](server-config.md) — Full reference for `constants.js` and server-side settings.
- [Electron Configuration](electron-config.md) — Full reference for `settings.js`, window state persistence, and project management.
- [Theming](theming.md) — CSS design system, custom properties, status colors, and visual customization.
