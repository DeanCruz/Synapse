// Constants — status colors, level colors, timing, dashboard labels
// Shared by all components. Colors are initialized from CSS custom properties.

export function colorWithAlpha(color, alpha) {
  if (!color) return color;
  const rgbaMatch = color.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/);
  if (rgbaMatch) return `rgba(${rgbaMatch[1]},${rgbaMatch[2]},${rgbaMatch[3]},${alpha})`;
  const rgbMatch = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) return `rgba(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]},${alpha})`;
  const hexMatch = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (hexMatch) return `rgba(${parseInt(hexMatch[1],16)},${parseInt(hexMatch[2],16)},${parseInt(hexMatch[3],16)},${alpha})`;
  return color;
}

export const STATUS_COLORS = {
  completed: '#34d399',
  in_progress: '#9b7cf0',
  pending: '#6E6E73',
  failed: '#ef4444',
  claimed: 'rgba(200,255,62,0.7)',
  blocked: '#f97316',
};

export const STATUS_BG_COLORS = {
  completed: 'rgba(52,211,153,0.1)',
  in_progress: 'rgba(155,124,240,0.1)',
  pending: 'rgba(255,255,255,0.04)',
  failed: 'rgba(239,68,68,0.1)',
  claimed: 'rgba(200,255,62,0.08)',
  blocked: 'rgba(249,115,22,0.1)',
};

const CSS_VAR_TO_STATUS_KEY = {
  '--color-completed':   'completed',
  '--color-in-progress': 'in_progress',
  '--color-pending':     'pending',
  '--color-failed':      'failed',
  '--color-claimed':     'claimed',
  '--color-blocked':     'blocked',
};

const STATUS_BG_ALPHA = {
  completed: 0.1, in_progress: 0.1, failed: 0.1, claimed: 0.08, blocked: 0.1,
};

export const LEVEL_COLORS = {
  info: '#9b7cf0', warn: 'rgba(200,255,62,0.7)', error: '#ef4444',
  debug: '#6E6E73', permission: '#f59e0b', deviation: '#eab308',
};

export const LEVEL_BG_COLORS = {
  info: 'rgba(155,124,240,0.1)', warn: 'rgba(200,255,62,0.08)', error: 'rgba(239,68,68,0.1)',
  debug: 'rgba(255,255,255,0.04)', permission: 'rgba(245,158,11,0.1)', deviation: 'rgba(234,179,8,0.1)',
};

export const DEBOUNCE_MS = 250;
export const LOG_ROW_HEIGHT = 32;
export const LOG_VIRTUAL_THRESHOLD = 500;

export const TIMELINE_COLORS = {
  task_start: '#9b7cf0', task_end: '#34d399', completed: '#34d399',
  in_progress: 'rgba(155,124,240,0.5)', failed: '#ef4444', pending: '#6E6E73',
};

// Dashboard labels are derived dynamically from dashboard IDs.
// No hardcoded list — the sidebar is driven by dashboardList from the server.
export function getDashboardLabel(id) {
  // Backwards compat for legacy dashboardN format
  if (id && id.startsWith('dashboard')) {
    const num = id.replace('dashboard', '');
    return `Dashboard ${num}`;
  }
  // New short hex IDs — display uppercase
  return id ? id.toUpperCase() : 'Unknown';
}

export function initStatusColorsFromCSS() {
  const styles = getComputedStyle(document.documentElement);
  for (const varName in CSS_VAR_TO_STATUS_KEY) {
    const key = CSS_VAR_TO_STATUS_KEY[varName];
    const val = styles.getPropertyValue(varName).trim();
    if (val) STATUS_COLORS[key] = val;
  }
  for (const key in STATUS_BG_ALPHA) {
    STATUS_BG_COLORS[key] = colorWithAlpha(STATUS_COLORS[key], STATUS_BG_ALPHA[key]);
  }
  const surface = styles.getPropertyValue('--surface').trim();
  if (surface) STATUS_BG_COLORS.pending = surface;

  // Sync LEVEL_COLORS from theme
  const accent = styles.getPropertyValue('--color-accent').trim() || styles.getPropertyValue('--color-in-progress').trim();
  if (accent) {
    LEVEL_COLORS.info = accent;
    LEVEL_BG_COLORS.info = colorWithAlpha(accent, 0.1);
  }
  if (STATUS_COLORS.failed) {
    LEVEL_COLORS.error = STATUS_COLORS.failed;
    LEVEL_BG_COLORS.error = colorWithAlpha(STATUS_COLORS.failed, 0.1);
  }
  const neutralBg = styles.getPropertyValue('--color-neutral-bg').trim();
  if (neutralBg) LEVEL_BG_COLORS.debug = neutralBg;

  // Sync TIMELINE_COLORS
  if (accent) {
    TIMELINE_COLORS.task_start = accent;
    TIMELINE_COLORS.in_progress = colorWithAlpha(accent, 0.5);
  }
  if (STATUS_COLORS.completed) {
    TIMELINE_COLORS.task_end = STATUS_COLORS.completed;
    TIMELINE_COLORS.completed = STATUS_COLORS.completed;
  }
  if (STATUS_COLORS.failed) TIMELINE_COLORS.failed = STATUS_COLORS.failed;
  if (STATUS_COLORS.pending) TIMELINE_COLORS.pending = STATUS_COLORS.pending;
}
