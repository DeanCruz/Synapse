// Time Formatting Helpers — extracted from dashboard.js
// ES module. No external dependencies.

/**
 * Calculate elapsed time from an ISO start string to now.
 * Returns a human-readable string like "3m 12s" or "1h 5m".
 * @param {string} startISO
 * @returns {string}
 */
export function formatElapsed(startISO) {
  const start = new Date(startISO);
  const now = new Date();
  let diff = Math.max(0, Math.floor((now - start) / 1000));

  const hours = Math.floor(diff / 3600);
  diff %= 3600;
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;

  if (hours > 0) {
    return hours + 'h ' + minutes + 'm';
  }
  return minutes + 'm ' + seconds + 's';
}

/**
 * Format an ISO timestamp to "HH:MM:SS".
 * @param {string} isoString
 * @returns {string}
 */
export function formatTime(isoString) {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return hh + ':' + mm + ':' + ss;
}

/**
 * Calculate a readable duration between two ISO timestamps.
 * @param {string} startISO
 * @param {string} endISO
 * @returns {string}
 */
export function calcDuration(startISO, endISO) {
  const diff = Math.max(
    0,
    Math.floor((new Date(endISO) - new Date(startISO)) / 1000)
  );
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}
