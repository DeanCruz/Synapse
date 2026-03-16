export function formatElapsed(startISO) {
  const start = new Date(startISO);
  let diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const hours = Math.floor(diff / 3600);
  diff %= 3600;
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`;
}

export function formatTime(isoString) {
  const d = new Date(isoString);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

export function calcDuration(startISO, endISO) {
  const diff = Math.max(0, Math.floor((new Date(endISO) - new Date(startISO)) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
