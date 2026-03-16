// ConfirmModal — confirmation dialog with Cancel / Confirm buttons
// Built on the reusable Modal base.

import React from 'react';
import Modal from './Modal.jsx';

/**
 * @param {string}   props.title     - modal header title
 * @param {string}   props.message   - confirmation message body
 * @param {Function} props.onConfirm - callback when the user clicks Confirm
 * @param {Function} props.onCancel  - callback when the user clicks Cancel or closes
 */
export default function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="modal-message">{message}</p>
      <div className="modal-actions">
        <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="modal-btn modal-btn-confirm" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    </Modal>
  );
}
