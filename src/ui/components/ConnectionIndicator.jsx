// ConnectionIndicator — small dot showing SSE connection state
// Replaces ConnectionIndicatorView.js

import React from 'react';

/**
 * @param {boolean} props.connected - true when SSE connection is live
 */
export default function ConnectionIndicator({ connected }) {
  const color = connected ? 'var(--color-completed)' : 'var(--color-failed)';

  return (
    <span className="connection-status">
      <span
        className="connection-dot"
        style={{ backgroundColor: color }}
        title={connected ? 'Connected' : 'Disconnected'}
        aria-label={connected ? 'Connected' : 'Disconnected'}
      />
    </span>
  );
}
