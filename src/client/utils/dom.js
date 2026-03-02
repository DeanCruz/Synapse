// DOM Construction Helpers — extracted from dashboard.js
// ES module. No external dependencies.

/**
 * Create an element with optional className, textContent, and attributes.
 * @param {string} tag
 * @param {object} [opts]
 * @returns {HTMLElement}
 */
export function el(tag, opts) {
  const node = document.createElement(tag);
  if (opts) {
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.attrs) {
      for (const key of Object.keys(opts.attrs)) {
        node.setAttribute(key, opts.attrs[key]);
      }
    }
    if (opts.style) {
      for (const key of Object.keys(opts.style)) {
        node.style[key] = opts.style[key];
      }
    }
  }
  return node;
}

/**
 * Convert a color string to rgba with given alpha.
 * Handles hex (#rrggbb), rgb(), rgba(), and passes through unknown formats.
 */
export function colorWithAlpha(color, alpha) {
  if (!color) return color;
  // Already rgba — replace the alpha value
  var rgbaMatch = color.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/);
  if (rgbaMatch) {
    return 'rgba(' + rgbaMatch[1] + ',' + rgbaMatch[2] + ',' + rgbaMatch[3] + ',' + alpha + ')';
  }
  // rgb() — add alpha
  var rgbMatch = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    return 'rgba(' + rgbMatch[1] + ',' + rgbMatch[2] + ',' + rgbMatch[3] + ',' + alpha + ')';
  }
  // Hex — convert to rgba
  var hexMatch = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (hexMatch) {
    return 'rgba(' + parseInt(hexMatch[1], 16) + ',' + parseInt(hexMatch[2], 16) + ',' + parseInt(hexMatch[3], 16) + ',' + alpha + ')';
  }
  return color;
}
