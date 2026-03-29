// PermissionModal — Dual-mode permission popup for agent requests.
// Informational mode (backward-compatible): onClose, message, agent.
// Interactive mode: onApprove, onDeny, toolName, toolInput, onAlwaysAllow.

import React, { useEffect, useState } from 'react';

function formatToolInput(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  if (toolInput.file_path) return toolInput.file_path;
  if (toolInput.command) return toolInput.command;
  if (toolInput.path) return toolInput.path;
  const first = Object.values(toolInput).find(v => typeof v === 'string' && v.length > 0);
  return first || null;
}

export default function PermissionModal({
  onClose, message, agent,
  interactive, onApprove, onDeny, toolName, toolInput, onAlwaysAllow
}) {
  const [alwaysAllow, setAlwaysAllow] = useState(false);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget && onClose) onClose();
  }

  function handleApprove() {
    if (alwaysAllow && onAlwaysAllow) onAlwaysAllow(toolName);
    if (onApprove) onApprove();
  }

  const detail = interactive ? formatToolInput(toolName, toolInput) : null;

  return (
    <div className="permission-overlay" onClick={handleOverlayClick}>
      <div className="permission-modal">
        <div className="permission-header">
          <span className="permission-icon">{'\u26A0'}</span>
          <div className="permission-title-wrap">
            <span className="permission-title">
              {interactive ? 'Permission Required' : 'Agent is requesting your permission'}
            </span>
            {agent && <span className="permission-agent">from {agent}</span>}
          </div>
        </div>

        {interactive && toolName && (
          <div className="permission-tool-name">{toolName}</div>
        )}
        {interactive && detail && (
          <div className="permission-tool-input">{detail}</div>
        )}
        {message && <p className="permission-message">{message}</p>}
        {!interactive && (
          <p className="permission-instruction">{'\u2192'} Respond in your terminal to continue</p>
        )}

        {interactive ? (
          <>
            <div className="permission-actions">
              <button className="permission-deny-btn" onClick={() => onDeny && onDeny()}>Deny</button>
              <button className="permission-approve-btn" onClick={handleApprove}>Approve</button>
            </div>
            {onAlwaysAllow && (
              <label className="permission-always-allow">
                <input
                  type="checkbox" checked={alwaysAllow}
                  onChange={(e) => setAlwaysAllow(e.target.checked)}
                />
                Always allow {toolName || 'this tool'}
              </label>
            )}
          </>
        ) : (
          <button className="permission-dismiss" onClick={onClose}>Dismiss</button>
        )}
      </div>
    </div>
  );
}
