// MetricsPanel — collapsible panel showing swarm performance metrics
// Fetches from GET /api/dashboards/:id/metrics on mount and periodically.

import React, { useState, useEffect, useRef, useCallback } from 'react';

const POLL_INTERVAL = 10000; // 10 seconds

/**
 * Format seconds into a human-readable duration string.
 * e.g. 125 → "2m 5s", 3661 → "1h 1m 1s"
 */
function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  let str = `${h}h`;
  if (m > 0) str += ` ${m}m`;
  if (rem > 0) str += ` ${rem}s`;
  return str;
}

/**
 * Format a percentage value with one decimal place.
 */
function formatPct(value) {
  if (value == null || isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * @param {object} props
 * @param {string} props.dashboardId - The current dashboard ID (e.g. "dashboard1")
 */
export default function MetricsPanel({ dashboardId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const fetchMetrics = useCallback(async () => {
    if (!dashboardId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/dashboards/${dashboardId}/metrics`);
      if (!res.ok) {
        setError('Failed to fetch metrics');
        setMetrics(null);
        return;
      }
      const data = await res.json();
      if (data.metrics === null || data.metrics === undefined) {
        setMetrics(null);
        setError(null);
      } else {
        setMetrics(data.metrics || data);
        setError(null);
      }
    } catch (err) {
      setError('Failed to fetch metrics');
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  // Fetch on mount and when dashboardId changes
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Poll periodically when panel is open
  useEffect(() => {
    if (!isOpen) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(fetchMetrics, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOpen, fetchMetrics]);

  // Determine what to show
  const hasMetrics = metrics != null;

  return (
    <div className={`metrics-panel${isOpen ? ' expanded' : ''}`}>
      <button
        className="metrics-toggle"
        onClick={() => setIsOpen(o => !o)}
        aria-expanded={isOpen}
      >
        <span className="metrics-toggle-text">
          <svg className="metrics-toggle-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="9" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="6.5" y="5" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="12" y="1" width="3" height="14" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          Performance Metrics
        </span>
        <span className={`metrics-toggle-chevron${isOpen ? ' open' : ''}`}>&#8964;</span>
      </button>

      {isOpen && (
        <div className="metrics-body">
          {error && (
            <div className="metrics-empty">{error}</div>
          )}
          {!error && !hasMetrics && (
            <div className="metrics-empty">
              Metrics available after swarm completion
            </div>
          )}
          {!error && hasMetrics && (
            <div className="metrics-grid">
              <MetricCard
                label="Elapsed"
                value={formatDuration(metrics.elapsed_seconds)}
                sublabel="total duration"
              />
              <MetricCard
                label="Parallel Efficiency"
                value={formatPct(metrics.parallel_efficiency)}
                sublabel={metrics.serial_estimate_seconds != null
                  ? `${formatDuration(metrics.serial_estimate_seconds)} serial est.`
                  : 'serial vs actual'}
              />
              <MetricCard
                label="Min Duration"
                value={formatDuration(metrics.min_task_duration)}
                sublabel="fastest task"
              />
              <MetricCard
                label="Avg Duration"
                value={formatDuration(metrics.avg_task_duration)}
                sublabel="average task"
              />
              <MetricCard
                label="Max Duration"
                value={formatDuration(metrics.max_task_duration)}
                sublabel="slowest task"
              />
              <MetricCard
                label="Failure Rate"
                value={formatPct(metrics.failure_rate)}
                sublabel={metrics.failed_count != null
                  ? `${metrics.failed_count} of ${metrics.total_count} tasks`
                  : 'failed tasks'}
                warn={metrics.failure_rate > 0}
              />
              <MetricCard
                label="Max Concurrent"
                value={metrics.max_concurrent_workers ?? '—'}
                sublabel="peak parallelism"
              />
              <MetricCard
                label="Deviations"
                value={metrics.deviation_count ?? '—'}
                sublabel="plan divergences"
                warn={metrics.deviation_count > 0}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, sublabel, warn }) {
  return (
    <div className={`metric-card${warn ? ' metric-warn' : ''}`}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
      {sublabel && <span className="metric-sublabel">{sublabel}</span>}
    </div>
  );
}
