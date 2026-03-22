# Theming

Synapse uses a dark-first design system built on CSS custom properties, Google Fonts, and a consistent status color palette shared between CSS and JavaScript. The visual language is characterized by dark backgrounds, translucent surfaces with backdrop blur (glass morphism), purple-to-green gradient accents, and color-coded status indicators.

---

## Design Tokens (CSS Custom Properties)

All theme values are declared as CSS custom properties on `:root` in `src/ui/styles/index.css`. Components reference these variables rather than hard-coding colors, ensuring consistency and enabling future theme switching.

### Background and Surface Colors

| Variable | Value | Purpose |
|---|---|---|
| `--bg` | `#0a0a0c` | Page background — near-black with a slight warm tint |
| `--surface` | `rgba(255,255,255,0.04)` | Card and panel backgrounds — translucent white at 4% opacity |
| `--surface-hover` | `rgba(255,255,255,0.07)` | Surface color on hover states |
| `--surface-raised` | `#1c1c1e` | Elevated surfaces (modals, popovers) — opaque dark gray |
| `--border` | `rgba(255,255,255,0.08)` | Default border color — subtle white at 8% opacity |
| `--border-hover` | `rgba(255,255,255,0.15)` | Border color on hover — slightly more visible |

### Text Colors

| Variable | Value | Purpose |
|---|---|---|
| `--text` | `#F5F5F7` | Primary text — off-white (Apple-style) |
| `--text-secondary` | `#A1A1A6` | Secondary text — medium gray for labels and metadata |
| `--text-tertiary` | `#6E6E73` | Tertiary text — dim gray for timestamps and de-emphasized content |

### Font Stacks

| Variable | Value | Purpose |
|---|---|---|
| `--sans` | `'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif` | Body text — all paragraph content, labels, and UI text |
| `--display` | `'Space Grotesk', 'DM Sans', sans-serif` | Display text — headings, stat numbers, brand name |

### Status Colors

Status colors are used throughout the dashboard to indicate task lifecycle states. They are defined both as CSS custom properties and as JavaScript constants (with runtime synchronization).

| Variable | Value | Hex | Used For |
|---|---|---|---|
| `--color-completed` | `#34d399` | Green | Completed tasks, success indicators, progress fills |
| `--color-in-progress` | `#9b7cf0` | Purple | Active tasks, the primary accent color |
| `--color-pending` | `#6E6E73` | Gray | Pending/queued tasks |
| `--color-failed` | `#ef4444` | Red | Failed tasks, error states |
| `--color-claimed` | `rgba(200,255,62,0.7)` | Lime | Tasks claimed by an agent but not yet started |
| `--color-blocked` | `#f97316` | Orange | Tasks blocked by unmet dependencies |

### Gradient Accent Colors

| Variable | Value | Purpose |
|---|---|---|
| `--color-purple-start` | `#667eea` | Start of the purple gradient (used in progress bars, active badges) |
| `--color-purple-end` | `#9b7cf0` | End of the purple gradient |

The primary accent gradient is:

```css
linear-gradient(135deg, #667eea, #9b7cf0)
```

This gradient appears on the progress bar fill, active agent badges, and interactive highlights throughout the UI.

---

## Font Loading

Fonts are loaded from Google Fonts in `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
```

### DM Sans (Body Font)

- **Weights loaded:** 300 (light), 400 (regular), 500 (medium), 600 (semibold)
- **Usage:** All body text, labels, log entries, card descriptions, button text
- **CSS variable:** `var(--sans)`
- **Base size:** `14px` (set on `body`)
- **Line height:** `1.5`

### Space Grotesk (Display Font)

- **Weights loaded:** 400 (regular), 500 (medium), 600 (semibold)
- **Usage:** Stat card numbers, brand name, wave/chain headers, section titles
- **CSS variable:** `var(--display)`
- **Characteristics:** Geometric sans-serif with distinctive character shapes — gives headings a technical, modern feel distinct from body text

### Font Rendering

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Subpixel antialiasing is disabled in favor of grayscale antialiasing, which produces thinner, crisper text on dark backgrounds.

---

## Glass Morphism

Glass morphism is a core visual pattern in Synapse. Translucent surfaces with backdrop blur create depth and hierarchy without solid background colors.

### Pattern

```css
.element {
  background: var(--surface);          /* rgba(255,255,255,0.04) */
  border: 1px solid var(--border);     /* rgba(255,255,255,0.08) */
  border-radius: 12px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
```

### Where It Appears

| Component | Blur Radius | Notes |
|---|---|---|
| Stat cards | `12px` | Full glass effect with hover glow |
| Wave column headers | `4px` | Lighter blur for column structure |
| Agent cards | `4px` | Subtle glass for card surfaces |
| Sidebar panels | `4px` | Panel backgrounds |
| Log panel | `12px` | Full glass effect matching stat cards |
| Modal overlays | `8px` | Medium blur for modal backgrounds |

### Hover Effects

Glass surfaces gain a subtle purple glow on hover:

```css
.stat-card:hover {
  box-shadow:
    0 0 6px rgba(155,124,240,0.35),
    0 0 14px rgba(155,124,240,0.12);
}
```

Active stat cards (those representing the current filter) show a green accent instead:

```css
.stat-card.stat-active {
  border-color: rgba(52,211,153,0.35);
  box-shadow: 0 0 0 1px rgba(52,211,153,0.1), 0 4px 20px rgba(52,211,153,0.06);
}
```

---

## Header Gradient

The header bar features a signature gradient glow along its bottom edge — purple on the left transitioning to green on the right:

```css
.header-bar::after {
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(102,126,234,0.9) 8%,       /* Purple start */
    rgba(155,124,240,0.65) 35%,      /* Purple end */
    rgba(52,211,153,0.65) 65%,       /* Green start */
    rgba(52,211,153,0.9) 92%,        /* Green end */
    transparent 100%
  );
  filter: blur(6px);
}
```

This gradient uses the same purple (`#667eea` / `#9b7cf0`) and green (`#34d399`) values as the status colors, creating visual coherence between the header accent and the task status indicators.

---

## JavaScript Color Constants

The `src/ui/utils/constants.js` file defines color constants used by React components for inline styles, dynamic rendering, and computed values that cannot use CSS variables directly.

### Status Colors (JavaScript)

```js
export const STATUS_COLORS = {
  completed:   '#34d399',              // Green
  in_progress: '#9b7cf0',             // Purple
  pending:     '#6E6E73',             // Gray
  failed:      '#ef4444',             // Red
  claimed:     'rgba(200,255,62,0.7)', // Lime
  blocked:     '#f97316',             // Orange
};
```

### Status Background Colors

Each status has a corresponding low-opacity background for card fills and badges:

```js
export const STATUS_BG_COLORS = {
  completed:   'rgba(52,211,153,0.1)',
  in_progress: 'rgba(155,124,240,0.1)',
  pending:     'rgba(255,255,255,0.04)',
  failed:      'rgba(239,68,68,0.1)',
  claimed:     'rgba(200,255,62,0.08)',
  blocked:     'rgba(249,115,22,0.1)',
};
```

### Log Level Colors

Log entries in the dashboard are color-coded by level:

```js
export const LEVEL_COLORS = {
  info:       '#9b7cf0',   // Purple
  warn:       'rgba(200,255,62,0.7)', // Lime
  error:      '#ef4444',   // Red
  debug:      '#6E6E73',   // Gray
  permission: '#f59e0b',   // Amber
  deviation:  '#eab308',   // Yellow
};
```

### Log Level Background Colors

```js
export const LEVEL_BG_COLORS = {
  info:       'rgba(155,124,240,0.1)',
  warn:       'rgba(200,255,62,0.08)',
  error:      'rgba(239,68,68,0.1)',
  debug:      'rgba(255,255,255,0.04)',
  permission: 'rgba(245,158,11,0.1)',
  deviation:  'rgba(234,179,8,0.1)',
};
```

### Timeline Colors

The timeline view uses a dedicated color set:

```js
export const TIMELINE_COLORS = {
  task_start:  '#9b7cf0',              // Purple
  task_end:    '#34d399',              // Green
  completed:   '#34d399',              // Green
  in_progress: 'rgba(155,124,240,0.5)', // Semi-transparent purple
  failed:      '#ef4444',              // Red
  pending:     '#6E6E73',              // Gray
};
```

### CSS-to-JS Synchronization

At runtime, `initStatusColorsFromCSS()` reads the CSS custom properties from the computed styles of `:root` and updates the JavaScript constants to match:

```js
export function initStatusColorsFromCSS() {
  const styles = getComputedStyle(document.documentElement);
  for (const varName in CSS_VAR_TO_STATUS_KEY) {
    const key = CSS_VAR_TO_STATUS_KEY[varName];
    const val = styles.getPropertyValue(varName).trim();
    if (val) STATUS_COLORS[key] = val;
  }
  // Recompute background colors from updated status colors
  for (const key in STATUS_BG_ALPHA) {
    STATUS_BG_COLORS[key] = colorWithAlpha(STATUS_COLORS[key], STATUS_BG_ALPHA[key]);
  }
}
```

This synchronization ensures that if CSS variables are ever overridden (e.g., by a future theme), the JavaScript colors automatically follow. The mapping is:

| CSS Variable | JS Key |
|---|---|
| `--color-completed` | `completed` |
| `--color-in-progress` | `in_progress` |
| `--color-pending` | `pending` |
| `--color-failed` | `failed` |
| `--color-claimed` | `claimed` |
| `--color-blocked` | `blocked` |

### Color Utility

The `colorWithAlpha(color, alpha)` function converts any color format (hex, rgb, rgba) to an rgba string with a new alpha value:

```js
colorWithAlpha('#34d399', 0.1)  // → 'rgba(52,211,153,0.1)'
colorWithAlpha('rgb(155,124,240)', 0.5)  // → 'rgba(155,124,240,0.5)'
```

This is used to generate background colors from status colors at configurable opacities.

---

## UI Constants

Additional constants that control UI behavior:

| Constant | Value | Purpose |
|---|---|---|
| `DEBOUNCE_MS` | `250` | General UI debounce interval for search, filter, and resize events |
| `LOG_ROW_HEIGHT` | `32` | Fixed height (px) for each log entry row in the virtualized log panel |
| `LOG_VIRTUAL_THRESHOLD` | `500` | Number of log entries before the log panel switches to virtualized rendering |

---

## Scrollbar Styling

Custom scrollbar styles match the dark theme:

```css
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.08);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.15);
}
```

The scrollbar is intentionally minimal (4px wide) with a transparent track, making it nearly invisible until hovered.

---

## Electron Window Background

The Electron `BrowserWindow` is created with `backgroundColor: '#0a0a0c'` — matching the CSS `--bg` variable exactly. This prevents a white flash during application startup before the CSS loads.

---

## Theme Settings (Electron)

The Electron settings store includes two theme-related keys:

| Key | Default | Purpose |
|---|---|---|
| `theme` | `'original'` | The active theme name. Currently only `'original'` is implemented. |
| `customColors` | `null` | Placeholder for future custom color overrides. Not currently consumed by the renderer. |

These settings are persisted in `{userData}/synapse-settings.json` and are available to the renderer via IPC. They provide the foundation for a future multi-theme system where users could select from predefined themes or define custom color palettes.

---

## Customization Guide

### Changing Status Colors

To change the color palette for task statuses:

1. **Edit CSS custom properties** in `src/ui/styles/index.css` under the `:root` selector.
2. **The JavaScript constants will auto-sync** via `initStatusColorsFromCSS()` at runtime — no JS changes needed for basic color changes.
3. **Rebuild** with `npm run build` or `npm run dev` (watch mode).

### Changing Fonts

1. **Update the Google Fonts link** in `index.html` to load different font families or weights.
2. **Update the CSS variables** `--sans` and `--display` in `:root` to reference the new font names.
3. **Rebuild** the frontend.

### Modifying Glass Morphism

The glass effect intensity can be adjusted by changing:
- **Surface opacity:** Increase `--surface` alpha for more opaque cards (e.g., `rgba(255,255,255,0.08)`)
- **Blur radius:** Increase `backdrop-filter: blur()` values for stronger frosted glass effect
- **Border opacity:** Increase `--border` alpha for more visible card edges

### Adding a New Theme

While full theme switching is not yet implemented, the architecture supports it:

1. Define a new set of CSS custom properties under a class selector (e.g., `.theme-light`)
2. Apply the class to `<html>` or `<body>` based on the `theme` setting from Electron
3. The `initStatusColorsFromCSS()` function will automatically pick up the new values
4. The `customColors` setting could map to per-property overrides applied as inline styles

---

## Color Reference Summary

### Status Lifecycle

| Status | Color | Hex/Value | CSS Variable |
|---|---|---|---|
| Completed | Green | `#34d399` | `--color-completed` |
| In Progress | Purple | `#9b7cf0` | `--color-in-progress` |
| Pending | Gray | `#6E6E73` | `--color-pending` |
| Failed | Red | `#ef4444` | `--color-failed` |
| Claimed | Lime | `rgba(200,255,62,0.7)` | `--color-claimed` |
| Blocked | Orange | `#f97316` | `--color-blocked` |

### Log Levels

| Level | Color | Hex/Value |
|---|---|---|
| Info | Purple | `#9b7cf0` |
| Warn | Lime | `rgba(200,255,62,0.7)` |
| Error | Red | `#ef4444` |
| Debug | Gray | `#6E6E73` |
| Permission | Amber | `#f59e0b` |
| Deviation | Yellow | `#eab308` |

### UI Surfaces

| Element | Color | Purpose |
|---|---|---|
| Background | `#0a0a0c` | Page background |
| Surface | `rgba(255,255,255,0.04)` | Card/panel fill |
| Surface (hover) | `rgba(255,255,255,0.07)` | Hovered card fill |
| Surface (raised) | `#1c1c1e` | Modal/popover fill |
| Border | `rgba(255,255,255,0.08)` | Default borders |
| Border (hover) | `rgba(255,255,255,0.15)` | Hovered borders |

---

## Related Documentation

- [Configuration Overview](overview.md) — How all configuration layers fit together.
- [Server Configuration](server-config.md) — Server-side constants and timing.
- [Electron Configuration](electron-config.md) — Desktop app settings including theme keys.
