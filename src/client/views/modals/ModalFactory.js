// ModalFactory — Shared modal creation utility
// ES module. Creates overlay + modal with header (title + close button), body container.
// Handles click-outside-to-close and Escape key with proper cleanup.

import { el } from '../../utils/dom.js';

/**
 * Create a modal popup with overlay, header (title + close), and body container.
 * Handles click-outside-to-close and Escape key. Cleans up Escape listener on close.
 *
 * @param {string} overlayId — id attribute for the overlay div
 * @param {string} titleText — text for the modal header title
 * @returns {{ overlay: HTMLElement, body: HTMLElement }}
 */
export function createModalPopup(overlayId, titleText) {
  // Remove any existing modal with the same overlay ID
  var existing = document.getElementById(overlayId);
  if (existing) existing.remove();

  var overlay = el('div', { className: 'history-overlay', attrs: { id: overlayId } });
  var modal = el('div', { className: 'history-modal' });

  // Header — title + close button
  var hdr = el('div', { className: 'history-modal-header' });
  var title = el('span', { className: 'history-modal-title', text: titleText });
  var closeBtn = el('button', { className: 'history-modal-close', text: '\u2715' });
  closeBtn.addEventListener('click', function () {
    cleanup();
  });
  hdr.appendChild(title);
  hdr.appendChild(closeBtn);
  modal.appendChild(hdr);

  // Body container — caller populates this
  var body = el('div', { className: 'history-modal-body' });
  modal.appendChild(body);
  overlay.appendChild(modal);

  // Click outside to close
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) cleanup();
  });

  // Escape key to close — with proper cleanup to avoid listener accumulation
  var onEsc = function (e) {
    if (e.key === 'Escape') cleanup();
  };
  document.addEventListener('keydown', onEsc);

  function cleanup() {
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  }

  return { overlay: overlay, body: body };
}
