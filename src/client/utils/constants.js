// Constants — extracted from dashboard.js
// ES module. No external dependencies (except colorWithAlpha from dom.js).

import { colorWithAlpha } from './dom.js';

// ---------------------------------------------------------------------------
// Status Colors
// ---------------------------------------------------------------------------

// STATUS_COLORS and STATUS_BG_COLORS are populated from CSS custom properties
// at the start of init() via initStatusColorsFromCSS(). Fallback values are
// provided here so rendering still works if called before init (shouldn't happen).
export var STATUS_COLORS = {
  completed: '#34d399',
  in_progress: '#9b7cf0',
  pending: '#6E6E73',
  failed: '#ef4444',
  claimed: 'rgba(200,255,62,0.7)',
  blocked: '#f97316',
};

export var STATUS_BG_COLORS = {
  completed: 'rgba(52,211,153,0.1)',
  in_progress: 'rgba(155,124,240,0.1)',
  pending: 'rgba(255,255,255,0.04)',
  failed: 'rgba(239,68,68,0.1)',
  claimed: 'rgba(200,255,62,0.08)',
  blocked: 'rgba(249,115,22,0.1)',
};

/** CSS custom property name → STATUS_COLORS key */
export const CSS_VAR_TO_STATUS_KEY = {
  '--color-completed':   'completed',
  '--color-in-progress': 'in_progress',
  '--color-pending':     'pending',
  '--color-failed':      'failed',
  '--color-claimed':     'claimed',
  '--color-blocked':     'blocked',
};

/** Alpha values for computing STATUS_BG_COLORS from base colors */
export const STATUS_BG_ALPHA = {
  completed:   0.1,
  in_progress: 0.1,
  failed:      0.1,
  claimed:     0.08,
  blocked:     0.1,
  // pending is a special case — uses rgba(255,255,255,0.04) (--surface), not derived from --color-pending
};

// ---------------------------------------------------------------------------
// Level Colors
// ---------------------------------------------------------------------------

export const LEVEL_COLORS = {
  info:       '#9b7cf0',               // Purple accent
  warn:       'rgba(200,255,62,0.7)', // Lime badge
  error:      '#ef4444',               // Error red
  debug:      '#6E6E73',               // Text tertiary
  permission: '#f59e0b',               // Amber — triggers popup
  deviation:  '#eab308',               // Yellow — plan deviation
};

export const LEVEL_BG_COLORS = {
  info:       'rgba(155,124,240,0.1)',
  warn:       'rgba(200,255,62,0.08)',
  error:      'rgba(239,68,68,0.1)',
  debug:      'rgba(255,255,255,0.04)',
  permission: 'rgba(245,158,11,0.1)',
  deviation:  'rgba(234,179,8,0.1)',
};

// ---------------------------------------------------------------------------
// Timing / Debounce
// ---------------------------------------------------------------------------

export const DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Virtual Scrolling (Log Panel)
// ---------------------------------------------------------------------------

export var LOG_ROW_HEIGHT = 32; // estimated px per log row
export var LOG_VIRTUAL_THRESHOLD = 500; // use virtual scrolling above this count

// ---------------------------------------------------------------------------
// Timeline Colors
// ---------------------------------------------------------------------------

export const TIMELINE_COLORS = {
  task_start:  '#9b7cf0',
  task_end:    '#34d399',
  completed:   '#34d399',
  in_progress: 'rgba(155,124,240,0.5)',
  failed:      '#ef4444',
  pending:     '#6E6E73',
};

// ---------------------------------------------------------------------------
// Dashboard Constants
// ---------------------------------------------------------------------------

export var DEFAULT_DASHBOARDS = ['dashboard1', 'dashboard2', 'dashboard3', 'dashboard4', 'dashboard5'];
export var DASHBOARD_LABELS = {
  dashboard1: 'Dashboard 1',
  dashboard2: 'Dashboard 2',
  dashboard3: 'Dashboard 3',
  dashboard4: 'Dashboard 4',
  dashboard5: 'Dashboard 5',
};

// ---------------------------------------------------------------------------
// CSS → Status Color Initialization
// ---------------------------------------------------------------------------

/**
 * Read status colors from CSS custom properties on :root and populate
 * STATUS_COLORS and STATUS_BG_COLORS. Must be called after DOM is ready
 * and before any rendering.
 */
export function initStatusColorsFromCSS() {
  var styles = getComputedStyle(document.documentElement);
  var varName, key, val;
  for (varName in CSS_VAR_TO_STATUS_KEY) {
    key = CSS_VAR_TO_STATUS_KEY[varName];
    val = styles.getPropertyValue(varName).trim();
    if (val) {
      STATUS_COLORS[key] = val;
    }
  }
  // Recompute STATUS_BG_COLORS from the (now CSS-sourced) base colors
  for (key in STATUS_BG_ALPHA) {
    STATUS_BG_COLORS[key] = colorWithAlpha(STATUS_COLORS[key], STATUS_BG_ALPHA[key]);
  }
  // pending BG is not derived from --color-pending; it uses --surface
  var surface = styles.getPropertyValue('--surface').trim();
  if (surface) {
    STATUS_BG_COLORS.pending = surface;
  }
}
