// ConnectionIndicatorView — SSE connection status indicator
// ES module. Accepts DOM element references as parameters.

import { el } from '../utils/dom.js';
import { STATUS_COLORS } from '../utils/constants.js';

/**
 * Create the connection status indicator and insert it into the header-center,
 * positioned before the task-badge.
 * Returns an object with setConnected() and setDisconnected() methods.
 *
 * @param {HTMLElement} container — the .header-center container element
 * @param {object} [statusColors] — optional override for STATUS_COLORS (defaults to imported)
 * @returns {{ setConnected: Function, setDisconnected: Function }}
 */
export function createConnectionIndicator(container, statusColors) {
  var colors = statusColors || STATUS_COLORS;

  var wrapper = el('span', { className: 'connection-status' });

  var connectionDot = el('span', {
    className: 'connection-dot',
    style: { backgroundColor: colors.pending },
  });

  wrapper.appendChild(connectionDot);
  container.insertBefore(wrapper, container.firstChild);

  return {
    setConnected: function () {
      connectionDot.style.backgroundColor = colors.completed;
    },
    setDisconnected: function () {
      connectionDot.style.backgroundColor = colors.failed;
    },
  };
}
