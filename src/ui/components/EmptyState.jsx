// EmptyState — shown when no active task is loaded on the current dashboard

import React from 'react';

export default function EmptyState() {
  return (
    <section className="empty-state">
      <div className="empty-state-content">
        <p className="empty-state-title">No active agents</p>
        <p className="empty-state-subtitle">Waiting for !p to dispatch agents...</p>
      </div>
    </section>
  );
}
