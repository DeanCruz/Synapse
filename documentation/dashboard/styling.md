# CSS Design System

The Synapse Dashboard uses a custom CSS design system built on CSS custom properties, with no CSS-in-JS libraries or utility frameworks. Styles are split across **10 CSS files** in `/src/ui/styles/` totaling **13,778 lines**. JavaScript reads status colors from CSS via `getComputedStyle` at runtime so that theme changes propagate to both CSS and JS rendering.

---

## CSS File Inventory

| File | Lines | Scope | Imported By |
|---|---|---|---|
| `index.css` | 8,073 | Core design system, dashboard components, pipelines, modals, themes, animations | `main.jsx` |
| `git-manager.css` | 2,401 | Full Git Manager view — repo tabs, changes, commits, diffs, branches, history, quick actions, dialogs | `GitManagerView.jsx` + all git sub-components |
| `ide-debug.css` | 1,124 | IDE debug toolbar, status indicators, button styles, launch config | `IDEView.jsx`, `DebugToolbar.jsx`, `DebugPanels.jsx`, `ProblemsPanel.jsx` |
| `ide-debug-panels.css` | 525 | Debug side panels — variables, call stack, breakpoints, watch expressions | `IDEView.jsx` |
| `ide-explorer.css` | 345 | File tree browser, welcome screen, tree node indent levels, loading states | `FileExplorer.jsx`, `IDEWelcome.jsx`, `main.jsx` |
| `ide-editor.css` | 297 | Editor tabs, Monaco host, breakpoint glyphs, diagnostic decorations, saving indicator | `EditorTabs.jsx`, `CodeEditor.jsx`, `main.jsx` |
| `ide-debug-console.css` | 288 | Debug console REPL — output display, expression input, entry types | `IDEView.jsx` |
| `ide-layout.css` | 270 | IDE container layout, workspace tabs, resizable divider, editor area, debug sidebar | `IDEView.jsx`, `main.jsx` |
| `ide-problems.css` | 233 | Problems panel — diagnostics list, severity icons, file groups, filter bar | Standalone (used by `ProblemsPanel.jsx`) |
| `ide-sidebar.css` | 222 | Sidebar tab bar (Code Explorer / Dashboards), dashboard item styling, drag-and-drop, rename input | `Sidebar.jsx`, `main.jsx` |
| **Total** | **13,778** | | |

**Loading strategy:** Core CSS files (`index.css`, `ide-sidebar.css`, `ide-explorer.css`, `ide-editor.css`, `ide-layout.css`) are imported globally in `main.jsx`. Component-specific CSS files are imported by their respective components.

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

### Conversation / Chat Styles

The ClaudeView conversation area uses a flex column layout with the following key classes:

```css
.claude-conversation {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

**Message bubbles:**

| Class | Purpose |
|---|---|
| `.claude-message` | Base message container |
| `.claude-user` | User messages — right-aligned, purple gradient background |
| `.claude-assistant` | Assistant messages — dark surface background |
| `.claude-system-msg` | System messages — centered, muted text |
| `.claude-error` | Error variant of system messages — red-tinted |

**Tool call blocks:**

| Class | Purpose |
|---|---|
| `.claude-tool-call` | Collapsible tool call container — glass surface, 8px radius |
| `.claude-tool-call.expanded` | Expanded state — shows body content |
| `.claude-tool-call.has-result` | Has a result — green left border accent |
| `.claude-tool-header` | Clickable header row with tool name and expand icon |
| `.claude-tool-input` | Preformatted tool input — `max-height: 200px`, scrollable |
| `.claude-tool-result` | Preformatted tool result — `max-height: 300px`, scrollable |

**Standalone tool results:**

The `tool_result_standalone` message type uses inline styles in `ClaudeView.jsx` (not CSS classes) for overflow-safe rendering:

```javascript
{
  background: '#1a1a2e',
  border: '1px solid #2d6',
  borderRadius: 6,
  padding: '6px 10px',
  alignSelf: 'flex-start',
  maxWidth: '90%',
  fontSize: '0.75rem',
  overflowWrap: 'break-word',  // Prevents long paths from overflowing
  wordBreak: 'break-word',     // Secondary break strategy
  minWidth: 0                  // Allows flex child to shrink below content size
}
```

In `WorkerTerminal.jsx`, the same message type uses the `.claude-tool-result-standalone` CSS class instead, which applies equivalent overflow protection via CSS properties.

**Thinking bubbles:**

| Class | Purpose |
|---|---|
| `.claude-thinking-bubble` | Extended thinking container — dark surface with border |
| `.claude-thinking-header` | Header with "Thinking..." label and animated dots |
| `.claude-thinking-content` | Expandable content area — `pre-wrap`, scrollable |

---

## IDE Styling

The IDE view uses 7 dedicated CSS files, plus `ide-sidebar.css` which is shared with the main sidebar. These files follow VS Code-inspired dark theme conventions.

### `ide-layout.css` (270 lines)

Main IDE container layout and workspace management.

| Class | Element |
|---|---|
| `.ide-view` | Root container — full-width/height flexbox column |
| `.workspace-tabs` | Top bar for workspace switching (36px height) |
| `.workspace-tab` | Individual workspace tab with folder icon and close button |
| `.workspace-tab.active` | Active workspace highlight |
| `.ide-main` | Split panel container (explorer + editor) |
| `.ide-explorer-panel` | Left sidebar for file tree |
| `.ide-divider` | Draggable column resize handle (4px, purple on hover) |
| `.ide-editor-area` | Main editor region |
| `.ide-editor-and-debug` | Horizontal split: editor + debug sidebar |
| `.ide-debug-sidebar` | Right-side debug panels (280px default) |

### `ide-editor.css` (297 lines)

Editor tabs and Monaco integration.

| Class | Element |
|---|---|
| `.editor-tabs-bar` | Tab strip for open files (36px height, hidden scrollbar) |
| `.editor-tab` | Individual file tab with close button |
| `.editor-tab.active` | Active tab with purple top border accent (`::before`) |
| `.editor-tab-dirty` | Unsaved changes dot indicator (purple, 7px) |
| `.code-editor-container` | Monaco editor host |
| `.code-editor-saving` | Save indicator overlay (fades out via `editorSaveFade` animation) |
| `.breakpoint-glyph` | Red circle in gutter margin for breakpoints |
| `.diagnostic-error-glyph` | Red circle for error diagnostics |
| `.diagnostic-warning-glyph` | Yellow triangle for warning diagnostics |
| `.diagnostic-info-glyph` | Purple circle for info diagnostics |
| `.debug-current-line` | Yellow highlight on the current debug execution line |

### `ide-explorer.css` (345 lines)

File tree browser and welcome screen.

| Class | Element |
|---|---|
| `.ide-explorer` | Explorer container with header and tree |
| `.ide-explorer-item` | Tree node (file or folder) with depth-based indentation |
| `.ide-explorer-item[data-depth="N"]` | Indent levels 0-10 (8px base + 14px per level) |
| `.ide-explorer-chevron` | Folder expand/collapse arrow (rotates 90deg when expanded) |
| `.ide-welcome` | Welcome screen with centered layout and action buttons |
| `.ide-welcome-btn.primary` | Purple gradient primary action button |
| `.ide-welcome-shortcut kbd` | Keyboard shortcut hint badges |

### `ide-sidebar.css` (222 lines)

Sidebar tab bar shared between dashboard and IDE views.

| Class | Element |
|---|---|
| `.sidebar-tab-bar` | Stacked tab rows container |
| `.sidebar-tab` | Individual tab (Code Explorer, Dashboards) |
| `.sidebar-tab.active` | Purple accent highlight for active tab |
| `.dashboard-item-content` | Dashboard list item in sidebar |
| `.dashboard-item-preview` | Chat preview text with streaming pulse animation |
| `.dashboard-item[draggable]` | Drag-and-drop reorder support |
| `.dashboard-item-rename-input` | Inline rename text field |

### `ide-debug.css` (1,124 lines)

Debug toolbar and session controls.

| Class | Element |
|---|---|
| `.debug-toolbar` | Toolbar container with controls and launch config |
| `.debug-toolbar-controls` | Status indicator + action buttons row |
| `.debug-status-dot` | 8px status indicator dot |
| `.debug-toolbar-btn` | Action button (play, stop, step over, step into, step out) |
| `.debug-toolbar-btn.primary-action` | Green start button with glow |

### `ide-debug-panels.css` (525 lines)

Debug side panels (Variables, Call Stack, Breakpoints, Watch).

| Class | Element |
|---|---|
| `.debug-panels` | Scrollable container for all debug panel sections |
| `.debug-panel-section` | Collapsible section with header and body |
| `.debug-panel-section-header` | Clickable header with chevron and title |
| `.debug-var-row` | Variable row with name, value, and type |
| `.debug-var-value` | Syntax-colored value display (string=green, number=blue, boolean=purple) |
| `.debug-frame-row` | Call stack frame entry |
| `.debug-bp-row` | Breakpoint entry with toggle and location |

### `ide-debug-console.css` (288 lines)

REPL-style debug console.

| Class | Element |
|---|---|
| `.debug-console` | Container with monospace font (Cascadia Code / Fira Code) |
| `.debug-console-header` | Header bar with title and clear button |
| `.debug-console-output` | Scrollable output area |
| `.debug-console-entry` | Individual output entry (input echo, result, log, error) |
| `.debug-console-input-row` | Bottom input row with prompt chevron |

### `ide-problems.css` (233 lines)

Problems panel for diagnostics display.

| Class | Element |
|---|---|
| `.problems-panel` | Container (VS Code dark theme: `#1e1e1e` background) |
| `.problems-summary-bar` | Filter toggle bar (errors, warnings, info counts) |
| `.problems-filter-btn` | Toggle button for severity filtering |
| `.problems-file-group` | File header + diagnostics list grouped by file |
| `.problems-row` | Individual diagnostic entry with severity icon, message, and location |
| `.problems-severity--error` | Red severity dot (`#f44747`) |
| `.problems-severity--warning` | Yellow severity dot (`#cca700`) |
| `.problems-severity--info` | Blue severity dot (`#3794ff`) |

---

## Git Manager Styling

All Git Manager styles live in a single file: `git-manager.css` (2,401 lines). Every class is prefixed with `.git-manager-*` to avoid namespace collisions.

### Major Sections

| Section | Lines | Description |
|---|---|---|
| Repo Tab Bar | ~140 | Top tab strip for switching between repositories (mirrors workspace tabs pattern) |
| Main Layout | ~10 | Flexbox sidebar + divider + content area |
| Sidebar | ~85 | Changes list + commit panel container (~300px default, resizable) |
| Changes Panel | ~195 | Staged/unstaged file lists with status icons and action buttons |
| Commit Panel | ~90 | Message textarea, amend toggle, commit button with character count |
| Divider | ~60 | Resizable panel separator (mirrors IDE divider) |
| Content Area | ~80 | Main right panel tab bar (Changes, History, Branches) |
| Diff Viewer | ~180 | Line-level green/red diff highlighting with line numbers |
| Branch Panel | ~185 | Branch list, current branch indicator, merge/rebase controls |
| History Panel | ~295 | Commit log table with hash, author, date, message columns |
| Quick Actions | ~195 | Bottom toolbar with fetch, pull, push buttons and centered modal |
| Safety Dialogs | ~195 | Confirmation overlays for destructive operations (force push, hard reset) |
| Loading/Error States | ~40 | Full-panel loading spinner and error display |
| Tooltips & Badges | ~40 | Generic tooltip positioning and count badges |
| Stash List | ~55 | Stash entries with apply/drop controls |
| Conflict Indicator | ~40 | Merge/rebase conflict warning banner |
| Keyboard Hints | ~35 | Shortcut hint badges |
| Scrollbar Overrides | ~35 | Custom scrollbar styling for git panels |

### Design Patterns

- **Mirrors IDE structure:** Layout (repo tabs, resizable sidebar, divider) follows the same pattern as `ide-layout.css`
- **VS Code dark theme colors:** Many components use `#1e1e1e` background, `#cccccc` text, `#333` borders
- **Diff colors:** Added lines use green (`rgba(35, 134, 54, 0.25)`) background, removed lines use red (`rgba(248, 81, 73, 0.25)`)
- **Status indicators:** Branch status badges, ahead/behind counts, conflict markers

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

### editorSaveFade (IDE)

```css
@keyframes editorSaveFade {
  0%   { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
```

Applied to the `.code-editor-saving` indicator. Duration: `1.5s ease-out forwards`. Defined in `ide-editor.css`.

### ide-spin (IDE)

```css
@keyframes ide-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

Loading spinner for file explorer lazy-load states. Duration: `0.8s linear infinite`. Defined in `ide-explorer.css`.

### preview-pulse (Sidebar)

```css
@keyframes preview-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.7; }
}
```

Pulsing opacity on chat preview text when streaming. Duration: `1.5s ease-in-out infinite`. Defined in `ide-sidebar.css`.

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
