// ErrorModal — Error display with red title + dismiss button
// ES module. Used for showing fetch failures and other errors.

import { el } from '../../utils/dom.js';

/**
 * Show an error popup modal.
 * @param {string} title — the error title (displayed in red)
 * @param {string} [message] — the error message body
 */
export function showErrorPopup(title, message) {
  var overlay = el('div', { className: 'confirm-overlay', attrs: { id: 'error-popup-overlay' } });
  var modal = el('div', { className: 'confirm-modal' });

  modal.appendChild(el('div', {
    className: 'confirm-title',
    text: title,
    style: { color: '#ef4444' },
  }));
  modal.appendChild(el('div', {
    className: 'confirm-message',
    text: message || 'An unknown error occurred.',
  }));

  var actions = el('div', { className: 'confirm-actions' });
  var dismissBtn = el('button', { className: 'confirm-cancel-btn', text: 'Dismiss' });
  dismissBtn.addEventListener('click', function () { cleanup(); });
  actions.appendChild(dismissBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) cleanup();
  });

  var onEsc = function (e) {
    if (e.key === 'Escape') cleanup();
  };
  document.addEventListener('keydown', onEsc);

  function cleanup() {
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  }
}
