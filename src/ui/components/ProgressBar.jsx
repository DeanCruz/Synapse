// ProgressBar — thin horizontal fill bar showing task completion ratio

import React from 'react';

export default function ProgressBar({ completed = 0, total = 0 }) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return (
    <div className="progress-track">
      <div
        className="progress-fill"
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
