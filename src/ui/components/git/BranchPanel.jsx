// BranchPanel — Branch management with visual indicators
// Shows current branch, local/remote branches, ahead/behind status,
// and actions: create, switch, delete, merge, move changes to new branch.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/git-manager.css';

// ── SVG Icons (inline for zero-dep) ──────────────────────────────

const IconBranch = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="3.5" r="2" />
    <circle cx="5" cy="12.5" r="2" />
    <circle cx="11" cy="6.5" r="2" />
    <path d="M5 5.5v5M11 8.5c0 2-2 2-2 4h-4" />
  </svg>
);

const IconChevron = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 2l4 3-4 3" />
  </svg>
);

const IconPlus = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M6 2v8M2 6h8" />
  </svg>
);

const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 3h9M4 3V2a1 1 0 011-1h2a1 1 0 011 1v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3" />
  </svg>
);

const IconMerge = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="3" cy="2.5" r="1.5" />
    <circle cx="3" cy="9.5" r="1.5" />
    <circle cx="9" cy="4.5" r="1.5" />
    <path d="M3 4v4M9 6c0 2-3 2-3 4v-2" />
  </svg>
);

const IconSwitch = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 4h10M8 1l3 3-3 3M11 8H1M4 5l-3 3 3 3" />
  </svg>
);

const IconMove = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 7h10M9 4l3 3-3 3" />
    <path d="M5 2v10" />
  </svg>
);

const IconWarning = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2L1.5 15h15L9 2z" />
    <path d="M9 7v3.5M9 12.5v.5" />
  </svg>
);

const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6l3 3 4.5-5" />
  </svg>
);

const IconCloud = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 10.5a3 3 0 01-.5-5.96 4.5 4.5 0 018.5 1.96 2.5 2.5 0 01-.5 4h-7.5" />
  </svg>
);

const IconSearch = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <circle cx="5" cy="5" r="3.5" />
    <path d="M8 8l3 3" />
  </svg>
);

const IconStar = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" stroke="none">
    <circle cx="5" cy="5" r="3" />
  </svg>
);

const IconRemote = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="2" />
    <path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.5 2.5l1.5 1.5M8 8l1.5 1.5M9.5 2.5L8 4M4 8l-1.5 1.5" />
  </svg>
);

// ── Helpers ──────────────────────────────────────────────────────

function getRepoPath(state) {
  const repo = state.gitRepos.find(r => r.id === state.gitActiveRepoId);
  return repo ? repo.path : null;
}

function classifyBranches(branches) {
  const local = [];
  const remote = [];
  if (!branches || !Array.isArray(branches)) return { local, remote };

  for (const b of branches) {
    if (b.name.startsWith('origin/') || b.name.includes('/')) {
      // Remote-tracking branches typically include the remote name
      // Check if the name matches a pattern like remoteName/branchName
      const slashIdx = b.name.indexOf('/');
      if (slashIdx > 0) {
        remote.push(b);
      } else {
        local.push(b);
      }
    } else {
      local.push(b);
    }
  }
  return { local, remote };
}

// ── Confirmation Dialog ─────────────────────────────────────────

function ConfirmDialog({ level, title, body, affectedItems, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const confirmClass = level === 'danger'
    ? 'confirm-danger'
    : level === 'warning'
    ? 'confirm-warning'
    : 'confirm-safe';

  return (
    <div className="git-manager-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={`git-manager-dialog ${level || 'safe'}`} ref={ref}>
        <div className="git-manager-dialog-header">
          <div className="git-manager-dialog-icon">
            <IconWarning />
          </div>
          <div className="git-manager-dialog-title">{title}</div>
        </div>
        <div className="git-manager-dialog-body">
          {body}
          {affectedItems && affectedItems.length > 0 && (
            <div className="git-manager-dialog-affected">
              {affectedItems.map((item, i) => <div key={i}>{item}</div>)}
            </div>
          )}
        </div>
        <div className="git-manager-dialog-footer">
          <button className="git-manager-dialog-btn cancel" onClick={onCancel}>
            {cancelLabel || 'Cancel'}
          </button>
          <button className={`git-manager-dialog-btn ${confirmClass}`} onClick={onConfirm}>
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Merge Preview Dialog ────────────────────────────────────────

function MergePreviewDialog({ sourceBranch, currentBranch, commits, onConfirm, onCancel, loading }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="git-manager-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="git-manager-dialog safe">
        <div className="git-manager-dialog-header">
          <div className="git-manager-dialog-icon">
            <IconMerge />
          </div>
          <div className="git-manager-dialog-title">
            Merge {sourceBranch} into {currentBranch}
          </div>
        </div>
        <div className="git-manager-dialog-body">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="git-manager-spinner sm"><div className="git-manager-spinner-circle" /></div>
              Loading merge preview...
            </div>
          ) : commits && commits.length > 0 ? (
            <>
              <div style={{ marginBottom: 8 }}>
                {commits.length} commit{commits.length !== 1 ? 's' : ''} will be merged:
              </div>
              <div className="git-manager-dialog-affected">
                {commits.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ color: 'var(--color-in-progress)', fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: '0.68rem' }}>
                      {c.shortHash}
                    </span>
                    <span>{c.subject}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div>No commits to merge. Branches may already be up to date.</div>
          )}
        </div>
        <div className="git-manager-dialog-footer">
          <button className="git-manager-dialog-btn cancel" onClick={onCancel}>Cancel</button>
          <button
            className="git-manager-dialog-btn confirm-safe"
            onClick={onConfirm}
            disabled={loading || !commits || commits.length === 0}
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Branch Graph (SVG commit history with lanes) ────────────────

const GRAPH_COLORS = [
  '#9b7cf0', // purple (primary)
  '#4ade80', // green
  '#f59e0b', // amber
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // emerald
  '#fb923c', // orange
  '#a78bfa', // violet
  '#38bdf8', // sky
  '#fbbf24', // yellow
];

function buildGraphLayout(commits) {
  if (!commits || commits.length === 0) return { rows: [], maxCol: 0 };

  const hashMap = new Map();
  commits.forEach((c, i) => hashMap.set(c.hash, i));

  // Active lanes: each element is a commit hash that "owns" that lane
  // null means the lane is free
  const lanes = [];
  const rows = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const { hash, parents } = commit;

    // Find which lane this commit occupies
    let col = lanes.indexOf(hash);
    if (col === -1) {
      // New branch — find first free lane or append
      col = lanes.indexOf(null);
      if (col === -1) {
        col = lanes.length;
        lanes.push(hash);
      } else {
        lanes[col] = hash;
      }
    }

    // Build connections: lines from parent positions to this commit
    const connections = [];
    const firstParent = parents[0] || null;

    // This lane continues to the first parent
    if (firstParent && hashMap.has(firstParent)) {
      lanes[col] = firstParent;
    } else {
      lanes[col] = null; // lane ends
    }

    // Additional parents (merge sources) — find or reserve their lanes
    for (let p = 1; p < parents.length; p++) {
      const parentHash = parents[p];
      if (!hashMap.has(parentHash)) continue;
      let parentCol = lanes.indexOf(parentHash);
      if (parentCol === -1) {
        // The parent isn't in any lane yet — it will appear later
        // Reserve a lane for it
        parentCol = lanes.indexOf(null);
        if (parentCol === -1) {
          parentCol = lanes.length;
          lanes.push(parentHash);
        } else {
          lanes[parentCol] = parentHash;
        }
      }
      connections.push({ fromCol: parentCol, toCol: col, type: 'merge' });
    }

    // Track continuations from other lanes through this row
    for (let l = 0; l < lanes.length; l++) {
      if (l !== col && lanes[l] !== null) {
        connections.push({ fromCol: l, toCol: l, type: 'pass' });
      }
    }

    // First parent connection
    if (firstParent && hashMap.has(firstParent)) {
      connections.push({ fromCol: col, toCol: col, type: 'parent' });
    }

    // Parse ref labels
    const labels = [];
    if (commit.refs && commit.refs.length > 0) {
      for (const ref of commit.refs) {
        const cleaned = ref.replace('HEAD -> ', '').trim();
        if (cleaned) {
          const isHead = ref.includes('HEAD');
          labels.push({ name: cleaned, isHead });
        }
      }
    }

    rows.push({
      hash: commit.hash,
      col,
      color: GRAPH_COLORS[col % GRAPH_COLORS.length],
      subject: commit.subject,
      author: commit.author,
      date: commit.date,
      parents: commit.parents,
      connections,
      labels,
      isMerge: parents.length > 1,
    });
  }

  // Trim trailing nulls from max column calculation
  let maxCol = 0;
  for (const row of rows) {
    if (row.col > maxCol) maxCol = row.col;
    for (const conn of row.connections) {
      if (conn.fromCol > maxCol) maxCol = conn.fromCol;
      if (conn.toCol > maxCol) maxCol = conn.toCol;
    }
  }

  return { rows, maxCol };
}

function BranchGraph({ repoPath }) {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const api = window.electronAPI;
        if (!api || !api.gitGraph) {
          setLoading(false);
          return;
        }
        const result = await api.gitGraph(repoPath, 80);
        if (cancelled) return;
        if (result && result.success) {
          setGraphData(buildGraphLayout(result.data));
        }
      } catch (err) {
        console.error('BranchGraph: failed to load', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [repoPath]);

  if (loading) {
    return (
      <div className="git-manager-branch-section" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="git-manager-branch-section-header" style={{ padding: '6px 12px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="git-manager-spinner sm"><div className="git-manager-spinner-circle" /></div>
            Loading graph...
          </span>
        </div>
      </div>
    );
  }

  if (!graphData || graphData.rows.length === 0) return null;

  const { rows, maxCol } = graphData;
  const ROW_H = 30;
  const COL_W = 18;
  const DOT_R = 3.5;
  const GRAPH_LEFT = 10;
  const LABEL_LEFT = GRAPH_LEFT + (maxCol + 1) * COL_W + 16;
  const DATE_COL_W = 70;
  // Calculate max label group width to size the SVG properly
  const maxLabelWidth = rows.reduce((max, row) => {
    const w = row.labels.reduce((sum, l) => sum + l.name.length * 7 + 18, 0);
    return Math.max(max, w);
  }, 0);
  const totalWidth = Math.max(800, LABEL_LEFT + maxLabelWidth + 420 + DATE_COL_W);
  const totalHeight = rows.length * ROW_H + 10;

  function colX(c) { return GRAPH_LEFT + c * COL_W + COL_W / 2; }
  function rowY(r) { return 5 + r * ROW_H + ROW_H / 2; }

  function formatDate(dateStr) {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now - d;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 30) return `${diffDays}d ago`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  return (
    <div className="git-manager-branch-section" style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        className="git-manager-branch-section-header"
        onClick={() => setCollapsed(c => !c)}
        style={{ cursor: 'pointer' }}
      >
        <span className={`git-manager-branch-section-chevron ${collapsed ? 'collapsed' : ''}`}>
          <IconChevron />
        </span>
        Branch Graph
        <span className="git-manager-badge gray">{rows.length}</span>
      </div>

      {!collapsed && (
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 420 }}>
          <svg
            width={totalWidth}
            height={totalHeight}
            style={{ display: 'block' }}
          >
            {/* Connection lines */}
            {rows.map((row, ri) => (
              <g key={'conn-' + ri}>
                {row.connections.map((conn, ci) => {
                  if (conn.type === 'pass') {
                    // Vertical pass-through line
                    return (
                      <line
                        key={ci}
                        x1={colX(conn.fromCol)}
                        y1={rowY(ri) - ROW_H / 2}
                        x2={colX(conn.toCol)}
                        y2={rowY(ri) + ROW_H / 2}
                        stroke={GRAPH_COLORS[conn.fromCol % GRAPH_COLORS.length]}
                        strokeWidth="1.5"
                        opacity="0.5"
                      />
                    );
                  }
                  if (conn.type === 'parent') {
                    // Vertical line down to next row (first parent)
                    return (
                      <line
                        key={ci}
                        x1={colX(conn.fromCol)}
                        y1={rowY(ri)}
                        x2={colX(conn.toCol)}
                        y2={rowY(ri) + ROW_H / 2}
                        stroke={row.color}
                        strokeWidth="1.5"
                        opacity="0.7"
                      />
                    );
                  }
                  if (conn.type === 'merge') {
                    // Curved line from merge source to this commit
                    const x1 = colX(conn.fromCol);
                    const y1 = rowY(ri) - ROW_H / 2;
                    const x2 = colX(conn.toCol);
                    const y2 = rowY(ri);
                    const mergeColor = GRAPH_COLORS[conn.fromCol % GRAPH_COLORS.length];
                    return (
                      <path
                        key={ci}
                        d={`M ${x1} ${y1} C ${x1} ${y1 + ROW_H * 0.4}, ${x2} ${y2 - ROW_H * 0.4}, ${x2} ${y2}`}
                        stroke={mergeColor}
                        strokeWidth="1.5"
                        fill="none"
                        opacity="0.6"
                      />
                    );
                  }
                  return null;
                })}

                {/* Vertical continuation from previous row into this commit's column */}
                {ri > 0 && rows[ri - 1].connections.some(c =>
                  (c.type === 'parent' && c.toCol === row.col) ||
                  (c.type === 'pass' && c.toCol === row.col)
                ) && (
                  <line
                    x1={colX(row.col)}
                    y1={rowY(ri) - ROW_H / 2}
                    x2={colX(row.col)}
                    y2={rowY(ri)}
                    stroke={row.color}
                    strokeWidth="1.5"
                    opacity="0.7"
                  />
                )}
              </g>
            ))}

            {/* Commit dots and labels */}
            {rows.map((row, ri) => {
              const cx = colX(row.col);
              const cy = rowY(ri);
              const isHovered = hoveredRow === ri;

              return (
                <g
                  key={'dot-' + ri}
                  onMouseEnter={() => setHoveredRow(ri)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{ cursor: 'default' }}
                >
                  {/* Hover highlight */}
                  {isHovered && (
                    <rect
                      x={0}
                      y={cy - ROW_H / 2}
                      width={totalWidth}
                      height={ROW_H}
                      fill="rgba(255,255,255,0.03)"
                    />
                  )}

                  {/* Commit dot */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={row.isMerge ? DOT_R + 1 : DOT_R}
                    fill={row.color}
                    stroke={row.isMerge ? 'rgba(255,255,255,0.3)' : 'none'}
                    strokeWidth={row.isMerge ? 1 : 0}
                  />

                  {/* Branch/tag labels */}
                  {row.labels.reduce((acc, label, li) => {
                    const prevOffset = li === 0 ? 0 : acc.offset;
                    const labelW = label.name.length * 7 + 12;
                    const lx = LABEL_LEFT + prevOffset;
                    acc.offset = prevOffset + labelW + 6;
                    acc.elements.push(
                      <g key={li}>
                        <rect
                          x={lx - 4}
                          y={cy - 8}
                          width={labelW}
                          height={16}
                          rx={3}
                          fill={label.isHead ? 'rgba(155,124,240,0.15)' : 'rgba(255,255,255,0.06)'}
                          stroke={label.isHead ? 'rgba(155,124,240,0.3)' : 'rgba(255,255,255,0.1)'}
                          strokeWidth="0.5"
                        />
                        <text
                          x={lx + 2}
                          y={cy + 3.5}
                          fill={label.isHead ? '#9b7cf0' : 'var(--text-secondary)'}
                          fontSize="10"
                          fontFamily="'SF Mono','Fira Code',monospace"
                          fontWeight={label.isHead ? '600' : '400'}
                        >
                          {label.name}
                        </text>
                      </g>
                    );
                    return acc;
                  }, { offset: 0, elements: [] }).elements}

                  {/* Commit message */}
                  {(() => {
                    const labelsW = row.labels.length > 0
                      ? row.labels.reduce((w, l) => w + l.name.length * 7 + 18, 0)
                      : 0;
                    const msgX = LABEL_LEFT + labelsW;
                    return (
                      <text
                        x={msgX}
                        y={cy + 3.5}
                        fill={isHovered ? 'var(--text)' : 'var(--text-secondary)'}
                        fontSize="11"
                        fontFamily="var(--sans)"
                      >
                        {row.subject.length > 60 ? row.subject.substring(0, 60) + '...' : row.subject}
                      </text>
                    );
                  })()}

                  {/* Date (right-aligned) */}
                  <text
                    x={totalWidth - 12}
                    y={cy + 3.5}
                    fill="var(--text-tertiary)"
                    fontSize="9.5"
                    fontFamily="var(--sans)"
                    textAnchor="end"
                  >
                    {formatDate(row.date)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

// ── Create Branch Form ──────────────────────────────────────────

function CreateBranchForm({ repoPath, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !repoPath) return;

    // Basic branch name validation
    if (/\s/.test(trimmed) || /[~^:?*\[\\]/.test(trimmed) || trimmed.startsWith('-') || trimmed.endsWith('.') || trimmed.includes('..')) {
      setError('Invalid branch name');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const result = await window.electronAPI.gitCreateBranch(repoPath, trimmed, true);
      if (result.success) {
        onCreated(trimmed);
      } else {
        setError(result.error || 'Failed to create branch');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }, [name, repoPath, onCreated]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: '8px 12px',
      borderBottom: '1px solid var(--border)',
      background: 'rgba(155, 124, 240, 0.03)',
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          ref={inputRef}
          className="git-manager-branch-search-input"
          type="text"
          placeholder="New branch name..."
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
            if (e.key === 'Escape') onCancel();
          }}
          disabled={creating}
          style={{ flex: 1 }}
        />
        <button
          className="git-manager-action-btn primary"
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          style={{ padding: '0 10px', height: 28 }}
        >
          {creating ? (
            <span className="git-manager-spinner sm"><span className="git-manager-spinner-circle" /></span>
          ) : (
            <>
              <span className="git-manager-action-btn-icon"><IconPlus /></span>
              Create
            </>
          )}
        </button>
        <button
          className="git-manager-action-btn"
          onClick={onCancel}
          style={{ padding: '0 8px', height: 28 }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div style={{
          fontFamily: 'var(--sans)',
          fontSize: '0.72rem',
          color: 'var(--color-failed)',
          padding: '2px 0',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ── Main BranchPanel ────────────────────────────────────────────

export default function BranchPanel({ repoPath: repoPathProp }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const repoPath = repoPathProp || getRepoPath(state);

  // Local UI state
  const [searchFilter, setSearchFilter] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const [remoteCollapsed, setRemoteCollapsed] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [aheadBehindMap, setAheadBehindMap] = useState({});

  // Dialog state
  const [dialog, setDialog] = useState(null);
  // dialog = { type: 'delete'|'switch'|'merge'|'moveChanges', ...context }

  const [mergePreview, setMergePreview] = useState(null);
  // mergePreview = { sourceBranch, loading, commits }

  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState(null);

  const { gitBranches, gitCurrentBranch, gitStatus } = state;

  // Classify branches
  const { local: localBranches, remote: remoteBranches } = useMemo(
    () => classifyBranches(gitBranches),
    [gitBranches]
  );

  // Filter branches by search
  const filteredLocal = useMemo(() => {
    if (!searchFilter) return localBranches;
    const q = searchFilter.toLowerCase();
    return localBranches.filter(b => b.name.toLowerCase().includes(q));
  }, [localBranches, searchFilter]);

  const filteredRemote = useMemo(() => {
    if (!searchFilter) return remoteBranches;
    const q = searchFilter.toLowerCase();
    return remoteBranches.filter(b => b.name.toLowerCase().includes(q));
  }, [remoteBranches, searchFilter]);

  // Fetch ahead/behind for local branches with upstreams
  useEffect(() => {
    if (!repoPath || localBranches.length === 0) return;
    let cancelled = false;

    async function fetchAheadBehind() {
      const map = {};
      for (const b of localBranches) {
        if (b.upstream) {
          try {
            const result = await window.electronAPI.gitAheadBehind(repoPath, b.name);
            if (!cancelled && result.success) {
              map[b.name] = result.data;
            }
          } catch (_) {
            // ignore individual failures
          }
        }
      }
      if (!cancelled) setAheadBehindMap(map);
    }

    fetchAheadBehind();
    return () => { cancelled = true; };
  }, [repoPath, localBranches]);

  // ── Refresh helper ────────────────────────────────────────────

  const refreshBranches = useCallback(async () => {
    if (!repoPath) return;
    try {
      const [branchResult, currentResult] = await Promise.all([
        window.electronAPI.gitBranches(repoPath),
        window.electronAPI.gitCurrentBranch(repoPath),
      ]);
      if (branchResult.success) {
        dispatch({ type: 'GIT_SET_BRANCHES', branches: branchResult.data });
      }
      if (currentResult.success) {
        dispatch({ type: 'GIT_SET_CURRENT_BRANCH', branch: currentResult.data });
      }
    } catch (_) { /* */ }
  }, [repoPath, dispatch]);

  const refreshAll = useCallback(async () => {
    if (!repoPath) return;
    try {
      const [branchResult, currentResult, statusResult] = await Promise.all([
        window.electronAPI.gitBranches(repoPath),
        window.electronAPI.gitCurrentBranch(repoPath),
        window.electronAPI.gitStatus(repoPath),
      ]);
      if (branchResult.success) dispatch({ type: 'GIT_SET_BRANCHES', branches: branchResult.data });
      if (currentResult.success) dispatch({ type: 'GIT_SET_CURRENT_BRANCH', branch: currentResult.data });
      if (statusResult.success) dispatch({ type: 'GIT_SET_STATUS', status: statusResult.data });
    } catch (_) { /* */ }
  }, [repoPath, dispatch]);

  // ── Check for uncommitted changes ─────────────────────────────

  const hasUncommittedChanges = useCallback(() => {
    if (!gitStatus) return false;
    const { staged, unstaged, untracked } = gitStatus;
    return (
      (staged && staged.length > 0) ||
      (unstaged && unstaged.length > 0) ||
      (untracked && untracked.length > 0)
    );
  }, [gitStatus]);

  // ── Branch actions ────────────────────────────────────────────

  // Switch branch
  const handleSwitchBranch = useCallback((branchName) => {
    if (branchName === gitCurrentBranch) return;

    if (hasUncommittedChanges()) {
      setDialog({
        type: 'switch',
        branchName,
        message: `You have uncommitted changes. Switching to "${branchName}" may cause data loss.`,
      });
    } else {
      performSwitchBranch(branchName);
    }
  }, [gitCurrentBranch, hasUncommittedChanges]);

  const performSwitchBranch = useCallback(async (branchName, stashFirst = false) => {
    if (!repoPath) return;
    setOperationLoading(true);
    setOperationError(null);
    setDialog(null);

    try {
      if (stashFirst) {
        const stashResult = await window.electronAPI.gitStash(repoPath, `Auto-stash before switching to ${branchName}`);
        if (!stashResult.success) {
          setOperationError(`Stash failed: ${stashResult.error}`);
          setOperationLoading(false);
          return;
        }
      }

      const result = await window.electronAPI.gitCheckout(repoPath, branchName);
      if (result.success) {
        await refreshAll();
      } else {
        // If stashed but checkout failed, pop stash to rollback
        if (stashFirst) {
          await window.electronAPI.gitStashPop(repoPath);
        }
        setOperationError(result.error || 'Failed to switch branch');
      }
    } catch (err) {
      setOperationError(err.message);
    } finally {
      setOperationLoading(false);
    }
  }, [repoPath, refreshAll]);

  // Delete branch
  const handleDeleteBranch = useCallback(async (branchName) => {
    if (!repoPath || branchName === gitCurrentBranch) return;

    // First try a safe delete (-d) to check for unmerged commits
    setOperationLoading(true);
    try {
      const result = await window.electronAPI.gitDeleteBranch(repoPath, branchName, false);
      if (result.success) {
        // Deleted cleanly — branch was fully merged
        await refreshBranches();
        setSelectedBranch(null);
        setOperationLoading(false);
        return;
      }

      // The -d flag failed — branch likely has unmerged commits
      setOperationLoading(false);
      setDialog({
        type: 'delete',
        branchName,
        unmerged: true,
        errorDetail: result.error,
      });
    } catch (err) {
      setOperationLoading(false);
      setOperationError(err.message);
    }
  }, [repoPath, gitCurrentBranch, refreshBranches]);

  const performForceDeleteBranch = useCallback(async (branchName) => {
    if (!repoPath) return;
    setOperationLoading(true);
    setOperationError(null);
    setDialog(null);
    try {
      const result = await window.electronAPI.gitDeleteBranch(repoPath, branchName, true);
      if (result.success) {
        await refreshBranches();
        setSelectedBranch(null);
      } else {
        setOperationError(result.error || 'Failed to force delete branch');
      }
    } catch (err) {
      setOperationError(err.message);
    } finally {
      setOperationLoading(false);
    }
  }, [repoPath, refreshBranches]);

  // Merge branch
  const handleMergeBranch = useCallback(async (sourceBranch) => {
    if (!repoPath || sourceBranch === gitCurrentBranch) return;

    // Load merge preview: commits in source that are not in current
    setMergePreview({ sourceBranch, loading: true, commits: [] });
    try {
      const result = await window.electronAPI.gitLog(repoPath, 50, [`${gitCurrentBranch}..${sourceBranch}`]);
      if (result.success) {
        setMergePreview({ sourceBranch, loading: false, commits: result.data || [] });
      } else {
        setMergePreview({ sourceBranch, loading: false, commits: [] });
      }
    } catch (_) {
      setMergePreview({ sourceBranch, loading: false, commits: [] });
    }
  }, [repoPath, gitCurrentBranch]);

  const performMerge = useCallback(async () => {
    if (!repoPath || !mergePreview) return;
    const { sourceBranch } = mergePreview;
    setMergePreview(null);
    setOperationLoading(true);
    setOperationError(null);

    try {
      const result = await window.electronAPI.gitMerge(repoPath, sourceBranch);
      if (result.success) {
        await refreshAll();
      } else {
        setOperationError(result.error || 'Merge failed');
      }
    } catch (err) {
      setOperationError(err.message);
    } finally {
      setOperationLoading(false);
    }
  }, [repoPath, mergePreview, refreshAll]);

  // Move Changes to New Branch
  const handleMoveChanges = useCallback(() => {
    if (!hasUncommittedChanges()) {
      setOperationError('No uncommitted changes to move');
      return;
    }
    setDialog({ type: 'moveChanges' });
  }, [hasUncommittedChanges]);

  const [moveNewBranchName, setMoveNewBranchName] = useState('');
  const [moveStep, setMoveStep] = useState(null); // null | 'stashing' | 'creating' | 'applying' | 'done' | 'error'
  const [moveError, setMoveError] = useState(null);

  const performMoveChanges = useCallback(async (branchName) => {
    if (!repoPath || !branchName.trim()) return;

    setMoveStep('stashing');
    setMoveError(null);

    try {
      // Step 1: Stash changes
      const stashResult = await window.electronAPI.gitStash(repoPath, `Move changes to ${branchName}`);
      if (!stashResult.success) {
        setMoveStep('error');
        setMoveError(`Stash failed: ${stashResult.error}`);
        return;
      }

      // Step 2: Create and checkout new branch
      setMoveStep('creating');
      const createResult = await window.electronAPI.gitCreateBranch(repoPath, branchName.trim(), true);
      if (!createResult.success) {
        // Rollback: pop stash to restore changes
        setMoveStep('error');
        await window.electronAPI.gitStashPop(repoPath);
        setMoveError(`Branch creation failed: ${createResult.error}. Changes restored.`);
        return;
      }

      // Step 3: Pop stash to apply changes
      setMoveStep('applying');
      const popResult = await window.electronAPI.gitStashPop(repoPath);
      if (!popResult.success) {
        // Changes were stashed and branch was created but pop failed
        setMoveStep('error');
        setMoveError(`Stash apply failed: ${popResult.error}. Your changes are in the stash list.`);
        await refreshAll();
        return;
      }

      setMoveStep('done');
      await refreshAll();

      // Auto-close after a short delay
      setTimeout(() => {
        setDialog(null);
        setMoveStep(null);
        setMoveNewBranchName('');
      }, 1200);
    } catch (err) {
      setMoveStep('error');
      setMoveError(err.message);
    }
  }, [repoPath, refreshAll]);

  // Branch creation callback
  const handleBranchCreated = useCallback(async (branchName) => {
    setShowCreateForm(false);
    await refreshAll();
  }, [refreshAll]);

  // ── Clear operation error after timeout ───────────────────────

  useEffect(() => {
    if (operationError) {
      const timer = setTimeout(() => setOperationError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [operationError]);

  // ── Render ────────────────────────────────────────────────────

  if (!repoPath) {
    return (
      <div className="git-manager-branches">
        <div className="git-manager-empty">
          <div className="git-manager-empty-icon"><IconBranch /></div>
          <div className="git-manager-empty-title">No Repository</div>
          <div className="git-manager-empty-text">Open a repository to manage branches.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-manager-branches">
      {/* ── Current Branch Header ─────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(155, 124, 240, 0.03)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 6,
          background: 'rgba(155, 124, 240, 0.1)',
          color: 'var(--color-in-progress)',
          flexShrink: 0,
        }}>
          <IconBranch />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: '0.88rem',
            fontWeight: 600,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {gitCurrentBranch || '(detached)'}
          </div>
          {aheadBehindMap[gitCurrentBranch] && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 2,
            }}>
              {aheadBehindMap[gitCurrentBranch].ahead > 0 && (
                <span className="git-manager-branch-ahead">
                  {aheadBehindMap[gitCurrentBranch].ahead} ahead
                </span>
              )}
              {aheadBehindMap[gitCurrentBranch].behind > 0 && (
                <span className="git-manager-branch-behind">
                  {aheadBehindMap[gitCurrentBranch].behind} behind
                </span>
              )}
              {aheadBehindMap[gitCurrentBranch].ahead === 0 && aheadBehindMap[gitCurrentBranch].behind === 0 && (
                <span style={{
                  fontFamily: 'var(--sans)',
                  fontSize: '0.68rem',
                  color: 'var(--color-completed)',
                }}>
                  Up to date
                </span>
              )}
            </div>
          )}
        </div>
        <button
          className="git-manager-action-btn primary"
          onClick={() => setShowCreateForm(!showCreateForm)}
          title="Create new branch"
          style={{ padding: '0 8px', height: 26, fontSize: '0.7rem' }}
        >
          <span className="git-manager-action-btn-icon"><IconPlus /></span>
          New
        </button>
        <button
          className="git-manager-action-btn warning"
          onClick={handleMoveChanges}
          title="Move uncommitted changes to a new branch"
          style={{ padding: '0 8px', height: 26, fontSize: '0.7rem' }}
        >
          <span className="git-manager-action-btn-icon"><IconMove /></span>
          Move
        </button>
      </div>

      {/* ── Operation error banner ────────────────────────────── */}
      {operationError && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          background: 'rgba(239, 68, 68, 0.08)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.15)',
          fontFamily: 'var(--sans)',
          fontSize: '0.72rem',
          color: 'var(--color-failed)',
          flexShrink: 0,
        }}>
          <IconWarning />
          <span style={{ flex: 1 }}>{operationError}</span>
          <button
            onClick={() => setOperationError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-failed)',
              cursor: 'pointer',
              fontSize: '0.82rem',
              padding: '0 4px',
            }}
          >
            x
          </button>
        </div>
      )}

      {/* ── Loading overlay (inline) ──────────────────────────── */}
      {operationLoading && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--sans)',
          fontSize: '0.72rem',
          color: 'var(--text-tertiary)',
          background: 'rgba(155, 124, 240, 0.03)',
          flexShrink: 0,
        }}>
          <div className="git-manager-spinner sm"><div className="git-manager-spinner-circle" /></div>
          Processing...
        </div>
      )}

      {/* ── Create Branch Form ────────────────────────────────── */}
      {showCreateForm && (
        <CreateBranchForm
          repoPath={repoPath}
          onCreated={handleBranchCreated}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {/* ── Search / Filter ───────────────────────────────────── */}
      <div className="git-manager-branch-search">
        <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}><IconSearch /></span>
        <input
          className="git-manager-branch-search-input"
          type="text"
          placeholder="Filter branches..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
        {searchFilter && (
          <span className="git-manager-badge gray">{filteredLocal.length + filteredRemote.length}</span>
        )}
      </div>

      {/* ── Scrollable branch content ─────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ── Branch Graph ──────────────────────────────────── */}
        <BranchGraph repoPath={repoPath} />

        {/* ── Local Branches ────────────────────────────────── */}
        <div className="git-manager-branch-section">
          <div
            className="git-manager-branch-section-header"
            onClick={() => setLocalCollapsed(!localCollapsed)}
          >
            <span className={`git-manager-branch-section-chevron ${localCollapsed ? 'collapsed' : ''}`}>
              <IconChevron />
            </span>
            Local
            <span className="git-manager-badge gray">{filteredLocal.length}</span>
          </div>

          {!localCollapsed && (
            <div className="git-manager-branch-list">
              {filteredLocal.length === 0 ? (
                <div style={{
                  padding: '12px 24px',
                  fontFamily: 'var(--sans)',
                  fontSize: '0.75rem',
                  color: 'var(--text-tertiary)',
                }}>
                  {searchFilter ? 'No matching branches' : 'No local branches'}
                </div>
              ) : (
                filteredLocal.map((branch) => {
                  const isCurrent = branch.name === gitCurrentBranch;
                  const isSelected = selectedBranch === branch.name;
                  const ab = aheadBehindMap[branch.name];

                  return (
                    <div
                      key={branch.name}
                      className={`git-manager-branch-item ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedBranch(isSelected ? null : branch.name)}
                      onDoubleClick={() => { if (!isCurrent) handleSwitchBranch(branch.name); }}
                    >
                      <span className="git-manager-branch-icon">
                        {isCurrent ? <IconStar /> : <IconBranch />}
                      </span>
                      <span className="git-manager-branch-name" title={branch.name}>
                        {branch.name}
                      </span>

                      {/* Ahead/behind tracking badges */}
                      {ab && (ab.ahead > 0 || ab.behind > 0) && (
                        <div className="git-manager-branch-tracking">
                          {ab.ahead > 0 && (
                            <span className="git-manager-branch-ahead" title={`${ab.ahead} commit${ab.ahead !== 1 ? 's' : ''} ahead of ${ab.upstream || 'upstream'}`}>
                              +{ab.ahead}
                            </span>
                          )}
                          {ab.behind > 0 && (
                            <span className="git-manager-branch-behind" title={`${ab.behind} commit${ab.behind !== 1 ? 's' : ''} behind ${ab.upstream || 'upstream'}`}>
                              -{ab.behind}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Upstream indicator */}
                      {branch.upstream && (
                        <span
                          title={`Tracks ${branch.upstream}`}
                          style={{ color: 'var(--text-tertiary)', display: 'flex', opacity: 0.5 }}
                        >
                          <IconCloud />
                        </span>
                      )}

                      {/* Action buttons (visible on hover) */}
                      <div className="git-manager-branch-actions">
                        {!isCurrent && (
                          <>
                            <button
                              className="git-manager-file-action-btn"
                              title={`Switch to ${branch.name}`}
                              onClick={(e) => { e.stopPropagation(); handleSwitchBranch(branch.name); }}
                            >
                              <IconSwitch />
                            </button>
                            <button
                              className="git-manager-file-action-btn"
                              title={`Merge ${branch.name} into ${gitCurrentBranch}`}
                              onClick={(e) => { e.stopPropagation(); handleMergeBranch(branch.name); }}
                            >
                              <IconMerge />
                            </button>
                            <button
                              className="git-manager-file-action-btn danger"
                              title={`Delete ${branch.name}`}
                              onClick={(e) => { e.stopPropagation(); handleDeleteBranch(branch.name); }}
                            >
                              <IconTrash />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* ── Remote Branches ───────────────────────────────── */}
        <div className="git-manager-branch-section">
          <div
            className="git-manager-branch-section-header"
            onClick={() => setRemoteCollapsed(!remoteCollapsed)}
          >
            <span className={`git-manager-branch-section-chevron ${remoteCollapsed ? 'collapsed' : ''}`}>
              <IconChevron />
            </span>
            Remote
            <span className="git-manager-badge gray">{filteredRemote.length}</span>
          </div>

          {!remoteCollapsed && (
            <div className="git-manager-branch-list">
              {filteredRemote.length === 0 ? (
                <div style={{
                  padding: '12px 24px',
                  fontFamily: 'var(--sans)',
                  fontSize: '0.75rem',
                  color: 'var(--text-tertiary)',
                }}>
                  {searchFilter ? 'No matching remote branches' : 'No remote branches'}
                </div>
              ) : (
                filteredRemote.map((branch) => (
                  <div
                    key={branch.name}
                    className={`git-manager-branch-item ${selectedBranch === branch.name ? 'selected' : ''}`}
                    onClick={() => setSelectedBranch(selectedBranch === branch.name ? null : branch.name)}
                  >
                    <span className="git-manager-branch-icon" style={{ color: 'var(--text-tertiary)' }}>
                      <IconRemote />
                    </span>
                    <span className="git-manager-branch-name" title={branch.name}>
                      {branch.name}
                    </span>
                    <div className="git-manager-branch-actions">
                      <button
                        className="git-manager-file-action-btn"
                        title={`Checkout ${branch.name}`}
                        onClick={(e) => { e.stopPropagation(); handleSwitchBranch(branch.name); }}
                      >
                        <IconSwitch />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Dialogs ───────────────────────────────────────────── */}

      {/* Switch branch with uncommitted changes */}
      {dialog?.type === 'switch' && (
        <ConfirmDialog
          level="warning"
          title={`Switch to ${dialog.branchName}?`}
          body={
            <div>
              <div>{dialog.message}</div>
              <div style={{ marginTop: 10, fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                You can stash your changes before switching, or switch directly (may cause conflicts).
              </div>
            </div>
          }
          confirmLabel="Stash & Switch"
          cancelLabel="Cancel"
          onConfirm={() => performSwitchBranch(dialog.branchName, true)}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Delete branch with unmerged commits */}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          level="danger"
          title={`Delete ${dialog.branchName}?`}
          body={
            <div>
              <div style={{ fontWeight: 500, color: 'var(--color-failed)', marginBottom: 6 }}>
                This branch has unmerged commits!
              </div>
              <div>
                Deleting this branch will permanently lose any commits not merged into another branch.
                This action cannot be undone.
              </div>
              {dialog.errorDetail && (
                <div style={{
                  marginTop: 8,
                  padding: '6px 8px',
                  background: 'rgba(239, 68, 68, 0.06)',
                  border: '1px solid rgba(239, 68, 68, 0.12)',
                  borderRadius: 4,
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  fontSize: '0.68rem',
                  color: 'var(--text-tertiary)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {dialog.errorDetail}
                </div>
              )}
            </div>
          }
          confirmLabel="Force Delete"
          cancelLabel="Cancel"
          onConfirm={() => performForceDeleteBranch(dialog.branchName)}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Move Changes to New Branch */}
      {dialog?.type === 'moveChanges' && (
        <div className="git-manager-dialog-overlay" onClick={(e) => {
          if (e.target === e.currentTarget && !moveStep) { setDialog(null); setMoveNewBranchName(''); setMoveStep(null); setMoveError(null); }
        }}>
          <div className="git-manager-dialog warning">
            <div className="git-manager-dialog-header">
              <div className="git-manager-dialog-icon">
                <IconMove />
              </div>
              <div className="git-manager-dialog-title">Move Changes to New Branch</div>
            </div>
            <div className="git-manager-dialog-body">
              {!moveStep ? (
                <>
                  <div style={{ marginBottom: 10 }}>
                    This will stash your current changes, create a new branch, and apply the changes there.
                  </div>
                  <input
                    className="git-manager-branch-search-input"
                    type="text"
                    placeholder="Enter new branch name..."
                    value={moveNewBranchName}
                    onChange={(e) => { setMoveNewBranchName(e.target.value); setMoveError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && moveNewBranchName.trim()) performMoveChanges(moveNewBranchName); }}
                    autoFocus
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </>
              ) : moveStep === 'done' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-completed)' }}>
                  <IconCheck /> Changes moved successfully to <strong>{moveNewBranchName}</strong>
                </div>
              ) : moveStep === 'error' ? (
                <div style={{ color: 'var(--color-failed)' }}>
                  {moveError || 'An error occurred'}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="git-manager-spinner sm"><div className="git-manager-spinner-circle" /></div>
                  {moveStep === 'stashing' && 'Stashing changes...'}
                  {moveStep === 'creating' && `Creating branch ${moveNewBranchName}...`}
                  {moveStep === 'applying' && 'Applying changes...'}
                </div>
              )}
            </div>
            <div className="git-manager-dialog-footer">
              {(!moveStep || moveStep === 'error') && (
                <>
                  <button
                    className="git-manager-dialog-btn cancel"
                    onClick={() => { setDialog(null); setMoveNewBranchName(''); setMoveStep(null); setMoveError(null); }}
                  >
                    Cancel
                  </button>
                  <button
                    className="git-manager-dialog-btn confirm-warning"
                    onClick={() => performMoveChanges(moveNewBranchName)}
                    disabled={!moveNewBranchName.trim() || (moveStep === 'stashing' || moveStep === 'creating' || moveStep === 'applying')}
                  >
                    Move Changes
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Merge preview dialog */}
      {mergePreview && (
        <MergePreviewDialog
          sourceBranch={mergePreview.sourceBranch}
          currentBranch={gitCurrentBranch}
          commits={mergePreview.commits}
          loading={mergePreview.loading}
          onConfirm={performMerge}
          onCancel={() => setMergePreview(null)}
        />
      )}
    </div>
  );
}
