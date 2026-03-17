// PermissionModal — Amber popup for agent permission requests
// Shows message, agent name, dismiss button. Closes on Escape or overlay click.

import React, { useEffect } from 'react';

export default function PermissionModal({ onClose, message, agent }) {
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
    <div className="permission-overlay" onClick={handleOverlayClick}>
      <div className="permission-modal">
        <div className="permission-header">
          <span className="permission-icon">⚠</span>
          <div className="permission-title-wrap">
            <span className="permission-title">Agent is requesting your permission</span>
            {agent && (
              <span className="permission-agent">from {agent}</span>
            )}
          </div>
        </div>

        {message && (
          <p className="permission-message">{message}</p>
        )}

        <p className="permission-instruction">
          → Respond in your terminal to continue
        </p>

        <button className="permission-dismiss" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
