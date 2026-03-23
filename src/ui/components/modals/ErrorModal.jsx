// ErrorModal — error dialog with a red-tinted title and Close button
// Built on the reusable Modal base.

import React from 'react';
import Modal from './Modal.jsx';

/**
 * @param {string}   props.message  - error message to display
 * @param {Function} props.onClose  - callback to dismiss the modal
 */
export default function ErrorModal({ message, onClose }) {
  return (
    <Modal
      title={
        <span style={{ color: 'var(--color-failed)' }}>Error</span>
      }
      onClose={onClose}
    >
      <p className="modal-message modal-message-error">{message}</p>
      <div className="modal-actions">
        <button className="modal-btn modal-btn-close" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
