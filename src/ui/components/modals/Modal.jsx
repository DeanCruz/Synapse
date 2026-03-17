// Modal — Base modal wrapper component
// Provides overlay, header with title + close button, and scrollable body.
// Closes on Escape key and outside click.

import React, { useEffect } from 'react';

/**
 * @param {string}     props.title     - modal header title text
 * @param {Function}   props.onClose   - callback to close the modal
 * @param {React.node} props.children  - modal body content
 * @param {string}     [props.className] - optional extra class on .history-modal
 */
export default function Modal({ title, onClose, children, className }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && onClose) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget && onClose) onClose();
  }

  return (
    <div
      className="history-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={'history-modal' + (className ? ' ' + className : '')}>
        <div className="history-modal-header">
          <span className="history-modal-title">{title}</span>
          {onClose && (
            <button
              className="history-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              &#10005;
            </button>
          )}
        </div>
        <div className="history-modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}
