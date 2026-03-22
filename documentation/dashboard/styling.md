# CSS Design System

The Synapse Dashboard uses a custom CSS design system built on CSS custom properties, with no CSS-in-JS libraries or utility frameworks. All styles live in `/src/ui/styles/index.css` (approximately 5900+ lines). JavaScript reads status colors from CSS via `getComputedStyle` at runtime so that theme changes propagate to both CSS and JS rendering.

---

## CSS Custom Properties

### Core Design Tokens

Defined on `:root` and overridden by theme selectors:

```css
:root {
  /* Backgrounds */
  --bg: #0a0a0c;                              /* Page background */
  --surface: rgba(255,255,255,0.04);          /* Card/panel background */
  --surface-hover: rgba(255,255,255,0.07);    /* Card hover state */
  --surface-raised: #1c1c1e;                  /* Elevated surface */

  /* Borders */
  --border: rgba(255,255,255,0.08);           /* Default border */
  --border-hover: rgba(255,255,255,0.15);     /* Hover border */

  /* Text */
  --text: #F5F5F7;                            /* Primary text */
  --text-secondary: #A1A1A6;                  /* Secondary text */
  --text-tertiary: #6E6E73;                   /* Tertiary/muted text */

  /* Fonts */
  --sans: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --display: 'Space Grotesk', 'DM Sans', sans-serif;

  /* Status colors (shared between CSS and JS) */
  --color-completed: #34d399;                 /* Green */
  --color-in-progress: #9b7cf0;              /* Purple */
  --color-pending: #6E6E73;                  /* Gray */
  --color-failed: #ef4444;                   /* Red */
  --color-claimed: rgba(200,255,62,0.7);     /* Lime */
  --color-blocked: #f97316;                  /* Orange */

  /* Accent gradients */
  --color-purple-start: #667eea;             /* Gradient start */
  --color-purple-end: #9b7cf0;               /* Gradient end */
}
```

### Typography

| Token | Font | Usage |
|---|---|---|
| `--sans` | DM Sans, system fallbacks | Body text, labels, inputs |
| `--display` | Space Grotesk, DM Sans fallback | Headlines, stat numbers, brand text |

**Base styles:**
- Font size: `14px`
- Line height: `1.5`
- Font smoothing: antialiased

---

## Status Color System

Status colors are the backbone of the visual system. They are defined as CSS custom properties and synchronized to JavaScript via `initStatusColorsFromCSS()`.

### JavaScript Color Constants (`/src/ui/utils/constants.js`)

```javascript
// Foreground colors (text, dots, borders)
export const STATUS_COLORS = {
  completed:   '#34d399',              // Green
  in_progress: '#9b7cf0',             // Purple
  pending:     '#6E6E73',             // Gray
  failed:      '#ef4444',             // Red
  claimed:     'rgba(200,255,62,0.7)', // Lime
  blocked:     '#f97316',             // Orange
};

// Background colors (card fills, badge fills)
export const STATUS_BG_COLORS = {
  completed:   'rgba(52,211,153,0.1)',
  in_progress: 'rgba(155,124,240,0.1)',
  pending:     'rgba(255,255,255,0.04)',
  failed:      'rgba(239,68,68,0.1)',
  claimed:     'rgba(200,255,62,0.08)',
  blocked:     'rgba(249,115,22,0.1)',
};
```

### CSS-to-JS Sync

On app mount, `initStatusColorsFromCSS()` reads CSS custom properties and updates the JS color maps:

```javascript
export function initStatusColorsFromCSS() {
  const styles = getComputedStyle(document.documentElement);

  // Map CSS variables to status keys
  const mapping = {
    '--color-completed':   'completed',
    '--color-in-progress': 'in_progress',
    '--color-pending':     'pending',
    '--color-failed':      'failed',
    '--color-claimed':     'claimed',
    '--color-blocked':     'blocked',
  };

  // Update STATUS_COLORS from CSS
  for (const [varName, key] of Object.entries(mapping)) {
    const val = styles.getPropertyValue(varName).trim();
    if (val) STATUS_COLORS[key] = val;
  }

  // Recompute STATUS_BG_COLORS with theme-appropriate alpha
  for (const key of Object.keys(STATUS_BG_ALPHA)) {
    STATUS_BG_COLORS[key] = colorWithAlpha(STATUS_COLORS[key], STATUS_BG_ALPHA[key]);
  }
}
```

This means themes only need to change the CSS custom properties; JS colors update automatically.

### Log Level Colors

```javascript
export const LEVEL_COLORS = {
  info:       '#9b7cf0',              // Purple
  warn:       'rgba(200,255,62,0.7)', // Lime
  error:      '#ef4444',              // Red
  debug:      '#6E6E73',              // Gray
  permission: '#f59e0b',              // Amber
  deviation:  '#eab308',              // Yellow
};

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

```javascript
export const TIMELINE_COLORS = {
  task_start:  '#9b7cf0',
  task_end:    '#34d399',
  completed:   '#34d399',
  in_progress: 'rgba(155,124,240,0.5)',
  failed:      '#ef4444',
  pending:     '#6E6E73',
};
```

### colorWithAlpha Utility

```javascript
export function colorWithAlpha(color, alpha) -> string
```

Converts any color format (hex, rgb, rgba) to `rgba()` with a specified alpha. Used throughout for border colors, background tints, etc.

---

## Themes

### Original (Dark) -- Default

The default theme. No `data-theme` attribute needed.

| Property | Value |
|---|---|
| `--bg` | `#0a0a0c` |
| `--surface` | `rgba(255,255,255,0.04)` |
| `--text` | `#F5F5F7` |
| Header bg | `rgb(10,10,12)` |
| Log panel bg | `#0b0b0f` |
| Modal bg | `#0f0f14` |

### Light

Applied via `[data-theme="light"]`.

| Property | Value |
|---|---|
| `--bg` | `#f5f5f7` |
| `--surface` | `rgba(0,0,0,0.035)` |
| `--surface-raised` | `#ffffff` |
| `--text` | `#1d1d1f` |
| `--text-secondary` | `#6e6e73` |
| `--text-tertiary` | `#a1a1a6` |
| `--border` | `rgba(0,0,0,0.1)` |
| Header bg | `rgb(245,245,247)` |
| Modal bg | `#ffffff` |

Light theme overrides backgrounds for: header, sidebar, log panel, modals, overlays, archive dropdown, timeline panel, and more.

### Ocean

Applied via `[data-theme="ocean"]`.

| Property | Value |
|---|---|
| `--bg` | `#0b1628` |
| `--surface` | `rgba(100,180,255,0.05)` |
| `--text` | `#e0eaf5` |
| `--color-in-progress` | `#60a5fa` |
| `--color-purple-start` | `#3b82f6` |
| `--color-purple-end` | `#60a5fa` |

### Custom Theme

Users can create custom themes via the Settings modal. Custom themes apply CSS properties directly to `document.documentElement.style`:

```javascript
function applyCustomTheme(colors) {
  const root = document.documentElement;
  root.style.setProperty('--bg', colors.bg);
  root.style.setProperty('--text', colors.text);
  root.style.setProperty('--surface', colorWithAlpha(colors.surface, 0.06));
  root.style.setProperty('--color-in-progress', colors.accent);
  root.style.setProperty('--color-completed', colors.completed);
  root.style.setProperty('--color-failed', colors.error);
  // ... plus derived properties
}
```

Customizable fields: Background, Surface, Text, Accent, Completed, Error.

---

## Layout System

### App Shell

```
+--------------------------------------------------+
| Header (sticky, z-index: 100)                    |
+----------+---------------------------------------+
| Sidebar  | .dashboard-content                    |
| (aside)  |                                       |
|          |                                       |
|          |                                       |
+----------+---------------------------------------+
| LogPanel (fixed bottom, z-index: 50)             |
+--------------------------------------------------+
```

```css
.dashboard-layout {
  display: flex;
  flex-direction: row;
  min-height: calc(100vh - header-height);
}

.dashboard-sidebar {
  width: 205px;        /* Collapses to ~52px */
  border-right: 1px solid var(--border);
  position: sticky;
  top: header-height;
  height: calc(100vh - header-height);
}

.dashboard-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-bottom: 60px;  /* Space for log panel */
}
```

### Glassmorphism Pattern

The design system uses a consistent "glass surface" pattern across cards, panels, and modals:

```css
/* Glass card pattern */
.component {
  background: var(--surface);           /* Semi-transparent */
  border: 1px solid var(--border);      /* Subtle border */
  border-radius: 12px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
```

### Z-Index Layers

| Layer | Z-Index | Components |
|---|---|---|
| Header | `100` | `.header-bar` |
| Log panel | `50` | `.log-panel` |
| Chain header row | `5` | `.chain-header-row` (sticky) |
| Chain label | `3-4` | `.chain-label`, `.chain-label-cell` (sticky) |
| Modals/Overlays | `200` | `.task-details-overlay`, `.agent-details-overlay` |
| Permission popup | `300` | `.permission-overlay` |
| Dependency lines | `1` | `.chain-svg` |
| Chain rows | `2` | `.chain-row` |

---

## Component-Specific Styles

### Header Bar

- Glass background: `rgb(10,10,12)` with bottom border glow
- Gradient glow via `::after` pseudo-element: purple-to-green linear gradient with blur
- Three-section layout: left (logo), center (task badge), right (controls)

### Stats Bar

- Flex row with equal-width cards
- Cards: glass surface with blur, 12px border-radius
- Active card: green border glow
- Hover: purple box-shadow glow
- Number classes: `.completed` (green), `.in-progress` (purple), `.failed` (red), `.pending` (gray), `.total` (white)

### Agent Card

- Glass surface: `rgba(255,255,255,0.03)` background
- Left border colored by status (3px solid)
- Hover: purple background tint + purple border + purple glow
- In-progress cards have a pulsing left-border animation

**Stage badge colors by data-stage attribute:**

| Stage | Background | Text Color |
|---|---|---|
| `reading_context` | `rgba(102,126,234,0.1)` | `rgba(102,126,234,0.8)` |
| `planning` | `rgba(102,126,234,0.1)` | `rgba(130,160,255,0.9)` |
| `implementing` | `rgba(155,124,240,0.1)` | `rgba(155,124,240,0.9)` |
| `testing` | `rgba(52,211,153,0.1)` | `rgba(52,211,153,0.9)` |
| `finalizing` | `rgba(52,211,153,0.08)` | `rgba(52,211,153,0.7)` |

### Deviation Badge

- Yellow accent: `background: rgba(234,179,8,0.1)`, `color: #eab308`
- Yellow border with box-shadow glow

### Log Panel

- Fixed to bottom of viewport
- Collapsed height: `42px` (just the toggle button)
- Expanded height: `350px`
- Purple-to-green gradient glow on top border (matching header)
- Smooth expand transition: `cubic-bezier(0.16, 1, 0.3, 1)`

### Progress Bar

- Height: `4px`
- Track: `rgba(255,255,255,0.04)`
- Fill: `linear-gradient(135deg, #667eea, #9b7cf0)` (purple gradient)
- Fill transition: `width 0.5s cubic-bezier(0.16, 1, 0.3, 1)`

---

## Animations

### fadeIn

```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

Used by modal overlays. Duration: `0.15s ease`.

### agentPulse

```css
@keyframes agentPulse {
  0%, 100% { border-left-color: var(--color-in-progress); }
  50% { border-left-color: rgba(155,124,240,0.3); }
}
```

Applied to in-progress agent cards. Duration: `2s ease-in-out infinite`.

### permissionPulse

```css
@keyframes permissionPulse {
  0%, 100% { box-shadow: ... rgba(245,158,11,0.06); }
  50% { box-shadow: ... rgba(245,158,11,0.14); }
}
```

Applied to permission request modals. Duration: `2.5s ease-in-out infinite`.

### slideInDown

```css
@keyframes slideInDown {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
```

Used by the unblocked tasks toast notification. Duration: `0.3s ease-out`.

---

## Scrollbar Customization

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
```

Chain pipeline has custom purple scrollbar thumbs:

```css
.chain-pipeline::-webkit-scrollbar-thumb {
  background: rgba(155,124,240,0.25);
}
```

---

## Timing Constants (JavaScript)

```javascript
export const DEBOUNCE_MS = 250;
export const LOG_ROW_HEIGHT = 32;
export const LOG_VIRTUAL_THRESHOLD = 500;
```

---

## Dashboard Labels

```javascript
export function getDashboardLabel(id) {
  const num = id.replace('dashboard', '');
  return `Dashboard ${num}`;
}
```

Dashboard labels are derived dynamically from IDs. No hardcoded list.
