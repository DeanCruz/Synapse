// ConfirmModal — Generic confirm dialog with Cancel + action button
// ES module. Used for destructive actions like clearing a dashboard.

import { el } from '../../utils/dom.js';

/** @type {function|null} Escape key handler reference for cleanup */
var _onEsc = null;

/**
 * Show a confirmation modal dialog.
 * @param {string} title — the dialog title
 * @param {string} message — the confirmation message body
 * @param {function} onConfirm — callback invoked when the user clicks the confirm/action button
 */
export function showConfirmModal(title, message, onConfirm) {
  hideConfirmModal();

  var overlay = el('div', { className: 'confirm-overlay', attrs: { id: 'confirm-modal-overlay' } });
  var modal = el('div', { className: 'confirm-modal' });

  modal.appendChild(el('div', { className: 'confirm-title', text: title }));
  modal.appendChild(el('div', { className: 'confirm-message', text: message }));

  var actions = el('div', { className: 'confirm-actions' });

  var cancelBtn = el('button', { className: 'confirm-cancel-btn', text: 'Cancel' });
  cancelBtn.addEventListener('click', hideConfirmModal);
  actions.appendChild(cancelBtn);

  var confirmBtn = el('button', { className: 'confirm-danger-btn', text: title });
  confirmBtn.addEventListener('click', function () {
    hideConfirmModal();
    if (onConfirm) onConfirm();
  });
  actions.appendChild(confirmBtn);

  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hideConfirmModal();
  });

  _onEsc = function (e) {
    if (e.key === 'Escape') hideConfirmModal();
  };
  document.addEventListener('keydown', _onEsc);
}

/**
 * Hide the confirm modal and clean up the Escape listener.
 */
export function hideConfirmModal() {
  var existing = document.getElementById('confirm-modal-overlay');
  if (existing) existing.remove();
  if (_onEsc) {
    document.removeEventListener('keydown', _onEsc);
    _onEsc = null;
  }
}
