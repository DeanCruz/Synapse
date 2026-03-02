// PermissionModal — Amber warning modal for agent permission requests
// ES module. Shows when an agent requests permission from the user.

import { el } from '../../utils/dom.js';

/** @type {function|null} Escape key handler reference for cleanup */
var _onEsc = null;

/**
 * Show the permission popup modal.
 * @param {string} message — the permission request message
 * @param {string} [agent] — optional agent identifier
 */
export function showPermissionPopup(message, agent) {
  hidePermissionPopup();

  var overlay = el('div', { className: 'permission-overlay', attrs: { id: 'permission-overlay' } });
  var modal = el('div', { className: 'permission-modal' });

  // Header — icon + title
  var header = el('div', { className: 'permission-header' });
  var icon = el('span', { className: 'permission-icon', text: '\u26A0' });
  var titleWrap = el('div', { className: 'permission-title-wrap' });
  var title = el('span', { className: 'permission-title', text: 'Agent is requesting your permission' });
  titleWrap.appendChild(title);
  if (agent) {
    var sub = el('span', { className: 'permission-agent', text: 'from ' + agent });
    titleWrap.appendChild(sub);
  }
  header.appendChild(icon);
  header.appendChild(titleWrap);
  modal.appendChild(header);

  // Message from the log entry
  if (message) {
    var msg = el('p', { className: 'permission-message', text: message });
    modal.appendChild(msg);
  }

  // Instruction
  var instr = el('p', {
    className: 'permission-instruction',
    text: '\u2192 Respond in your terminal to continue',
  });
  modal.appendChild(instr);

  // Dismiss button
  var dismiss = el('button', { className: 'permission-dismiss', text: 'Dismiss' });
  dismiss.addEventListener('click', hidePermissionPopup);
  modal.appendChild(dismiss);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hidePermissionPopup();
  });

  _onEsc = function (e) {
    if (e.key === 'Escape') hidePermissionPopup();
  };
  document.addEventListener('keydown', _onEsc);
}

/**
 * Hide the permission popup and clean up the Escape listener.
 */
export function hidePermissionPopup() {
  var existing = document.getElementById('permission-overlay');
  if (existing) existing.remove();
  if (_onEsc) {
    document.removeEventListener('keydown', _onEsc);
    _onEsc = null;
  }
}
