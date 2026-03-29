// ProblemsPanel — Displays diagnostics (errors, warnings, info) aggregated from all open files.
// Reads from AppContext diagnostics state. Groups by file path with severity filtering.
// Designed to be embedded inside BottomPanel's "Problems" tab.

import React, { useState, useMemo, useCallback } from 'react';
import { useAppState } from '../../context/AppContext.jsx';
import '../../styles/ide-debug.css';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2, hint: 3 };

const SEVERITY_CONFIG = {
  error:   { label: 'Errors',   cssClass: 'problems-severity--error' },
  warning: { label: 'Warnings', cssClass: 'problems-severity--warning' },
  info:    { label: 'Info',     cssClass: 'problems-severity--info' },
};

/**
 * Shorten a file path for display — strips common workspace root prefix.
 * If the path contains a recognizable project-level directory, show from that point.
 */
function shortenPath(filePath) {
  if (!filePath) return '';
  // Try to find a meaningful segment — strip everything before common project dirs
  const markers = ['/src/', '/lib/', '/app/', '/pages/', '/components/', '/electron/'];
  for (const marker of markers) {
    const idx = filePath.indexOf(marker);
    if (idx !== -1) {
      return filePath.slice(idx + 1); // strip leading slash
    }
  }
  // Fallback: show last 3 segments
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 3) return parts.join('/');
  return '.../' + parts.slice(-3).join('/');
}

/**
 * Get just the filename from a full path.
 */
function fileName(filePath) {
  if (!filePath) return '';
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * SeverityIcon — circle for error, triangle for warning, info icon for info/hint.
 */
function SeverityIcon({ severity }) {
  if (severity === 'error') {
    return (
      <svg className="problems-severity-icon problems-severity--error" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.5" fill="var(--color-failed, #FF6B6B)" />
        <path d="M8 5v3.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.75" fill="#fff" />
      </svg>
    );
  }
  if (severity === 'warning') {
    return (
      <svg className="problems-severity-icon problems-severity--warning" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M8 2.5L14.5 13.5H1.5L8 2.5z" fill="var(--color-warning, #FFD93D)" />
        <path d="M8 7v2.5" stroke="#1a1a1a" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="11.25" r="0.65" fill="#1a1a1a" />
      </svg>
    );
  }
  // info or hint
  return (
    <svg className="problems-severity-icon problems-severity--info" width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" fill="var(--color-in-progress, #9B7CF0)" />
      <circle cx="8" cy="5.5" r="0.75" fill="#fff" />
      <path d="M8 7.5v3.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * ProblemsPanel — main component.
 * @param {object} props
 * @param {Function} props.onNavigate - callback(filePath, line, column) to navigate to error location
 */
export default function ProblemsPanel({ onNavigate }) {
  const state = useAppState();
  const diagnostics = state.diagnostics || {};

  // Filter state: which severities are visible
  const [activeFilters, setActiveFilters] = useState({
    error: true,
    warning: true,
    info: true,
  });

  // Compute counts and grouped diagnostics
  const { counts, groupedDiagnostics, totalVisible } = useMemo(() => {
    const counts = { error: 0, warning: 0, info: 0 };
    const grouped = {};

    const filePaths = Object.keys(diagnostics).sort();
    for (const filePath of filePaths) {
      const items = diagnostics[filePath];
      if (!Array.isArray(items) || items.length === 0) continue;

      for (const diag of items) {
        const sev = diag.severity === 'hint' ? 'info' : (diag.severity || 'info');
        if (sev in counts) {
          counts[sev]++;
        }
      }

      // Filter items by active severity filters
      const filtered = items.filter(d => {
        const sev = d.severity === 'hint' ? 'info' : (d.severity || 'info');
        return activeFilters[sev] !== false;
      });

      if (filtered.length > 0) {
        // Sort by severity, then line, then column
        const sorted = [...filtered].sort((a, b) => {
          const sevDiff = (SEVERITY_ORDER[a.severity] || 3) - (SEVERITY_ORDER[b.severity] || 3);
          if (sevDiff !== 0) return sevDiff;
          if (a.line !== b.line) return (a.line || 0) - (b.line || 0);
          return (a.column || 0) - (b.column || 0);
        });
        grouped[filePath] = sorted;
      }
    }

    const totalVisible = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);

    return { counts, groupedDiagnostics: grouped, totalVisible };
  }, [diagnostics, activeFilters]);

  // Toggle a severity filter
  const toggleFilter = useCallback((severity) => {
    setActiveFilters(prev => ({
      ...prev,
      [severity]: !prev[severity],
    }));
  }, []);

  // Handle row click — navigate to error location
  const handleRowClick = useCallback((filePath, line, column) => {
    if (typeof onNavigate === 'function') {
      onNavigate(filePath, line, column);
    }
  }, [onNavigate]);

  // Total count across all severities
  const totalCount = counts.error + counts.warning + counts.info;

  // Empty state — no diagnostics at all
  if (totalCount === 0) {
    return (
      <div className="problems-panel">
        <div className="problems-panel-empty">
          <svg className="problems-panel-empty-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M5.5 8l1.5 1.5 3.5-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>No problems detected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="problems-panel">
      {/* Summary bar with filter toggles */}
      <div className="problems-summary-bar">
        {Object.entries(SEVERITY_CONFIG).map(([severity, config]) => (
          <button
            key={severity}
            className={`problems-filter-btn${activeFilters[severity] ? ' active' : ''}`}
            onClick={() => toggleFilter(severity)}
            title={`${activeFilters[severity] ? 'Hide' : 'Show'} ${config.label.toLowerCase()}`}
          >
            <SeverityIcon severity={severity} />
            <span className="problems-filter-count">{counts[severity]}</span>
            <span className="problems-filter-label">{config.label}</span>
          </button>
        ))}
        <span className="problems-summary-total">
          {counts.error} errors, {counts.warning} warnings, {counts.info} info
        </span>
      </div>

      {/* Diagnostics list grouped by file */}
      <div className="problems-list">
        {totalVisible === 0 ? (
          <div className="problems-panel-empty">
            <span>All problems filtered out</span>
          </div>
        ) : (
          Object.entries(groupedDiagnostics).map(([filePath, items]) => (
            <div key={filePath} className="problems-file-group">
              <div className="problems-file-header">
                <svg className="problems-file-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1"/>
                  <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.1"/>
                </svg>
                <span className="problems-file-name">{fileName(filePath)}</span>
                <span className="problems-file-path-short">{shortenPath(filePath)}</span>
                <span className="problems-file-count">{items.length}</span>
              </div>
              {items.map((diag, idx) => (
                <div
                  key={`${filePath}-${diag.line}-${diag.column}-${idx}`}
                  className="problems-row"
                  onClick={() => handleRowClick(filePath, diag.line, diag.column)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleRowClick(filePath, diag.line, diag.column);
                    }
                  }}
                >
                  <SeverityIcon severity={diag.severity} />
                  <span className="problems-row-message">{diag.message}</span>
                  {diag.source && (
                    <span className="problems-row-source">{diag.source}</span>
                  )}
                  <span className="problems-row-location">
                    [{diag.line}:{diag.column}]
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
