// HistoryPanel — Commit history with SVG branch/merge graph
// Features: commit log table, SVG graph with colored branch lines and merge curves,
// expandable rows (full message, files changed, diff), lazy loading on scroll,
// filtering by branch, author, and date range.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/git-manager.css';

// ── Constants ────────────────────────────────────────────────────
const BATCH_SIZE = 50;
const ROW_HEIGHT = 36;
const LANE_WIDTH = 10;
const NODE_RADIUS = 4;
const MERGE_NODE_RADIUS = 5;
const GRAPH_PADDING = 4;
const MAX_DISPLAY_LANES = 8;

// Lane colors read from CSS variables with fallbacks.
// These are stable per-lane colors that work across themes.
function getLaneColors() {
  const s = getComputedStyle(document.documentElement);
  const accent = s.getPropertyValue('--color-in-progress').trim() || '#9b7cf0';
  const completed = s.getPropertyValue('--color-completed').trim() || '#34d399';
  // Return a palette that adapts the primary accent + stable secondary colors
  return [
    accent.replace(/[^#\w,() ]/g, '') + '',                  // theme accent
    completed,                                                 // theme completed
    'rgba(245, 158, 11, 0.85)',  // amber
    'rgba(59, 130, 246, 0.85)',  // blue
    'rgba(239, 68, 68, 0.85)',   // red
    'rgba(6, 182, 212, 0.85)',   // cyan
    'rgba(236, 72, 153, 0.85)',  // pink
    'rgba(249, 115, 22, 0.85)',  // orange
    'rgba(168, 85, 247, 0.85)',  // violet
    'rgba(20, 184, 166, 0.85)',  // teal
  ];
}
const LANE_COLORS = getLaneColors();

// ── Relative date formatter ──────────────────────────────────────
function relativeDate(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return dateStr;
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return seconds + 's ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + 'd ago';
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks + 'w ago';
  const months = Math.floor(days / 30);
  if (months < 12) return months + 'mo ago';
  const years = Math.floor(days / 365);
  return years + 'y ago';
}

// ── Ref/decoration parser ────────────────────────────────────────
function parseRefs(refStr) {
  if (!refStr) return [];
  const cleaned = refStr.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!cleaned) return [];
  return cleaned.split(',').map(r => {
    const t = r.trim();
    if (t.startsWith('HEAD -> ')) return { name: t.replace('HEAD -> ', ''), type: 'head' };
    if (t === 'HEAD') return { name: 'HEAD', type: 'head' };
    if (t.startsWith('tag: ')) return { name: t.replace('tag: ', ''), type: 'tag' };
    if (t.startsWith('origin/')) return { name: t, type: 'branch' };
    return { name: t, type: 'branch' };
  });
}

// ── Graph layout computation ─────────────────────────────────────
// Assigns each commit a lane (column). Aggressively consolidates
// lanes so that each branch shows as a single vertical rail with
// smooth merge/fork connections branching in and out.

function computeGraphLayout(commits) {
  if (!commits || commits.length === 0) return [];

  const activeLanes = []; // activeLanes[lane] = expected hash or null

  return commits.map((commit) => {
    const parents = commit.parents || [];
    const isMerge = parents.length > 1;

    // Find ALL lanes expecting this commit's hash (duplicates happen
    // when two branches converge on the same parent)
    const matchingLanes = [];
    for (let l = 0; l < activeLanes.length; l++) {
      if (activeLanes[l] === commit.hash) matchingLanes.push(l);
    }

    let commitLane;
    if (matchingLanes.length > 0) {
      // Prefer the lowest lane; free the rest
      commitLane = matchingLanes[0];
      for (let k = 1; k < matchingLanes.length; k++) {
        activeLanes[matchingLanes[k]] = null;
      }
    } else {
      commitLane = activeLanes.indexOf(null);
      if (commitLane === -1) {
        commitLane = activeLanes.length;
        activeLanes.push(null);
      }
    }

    const entry = {
      lane: commitLane,
      isMerge,
      lines: [],           // vertical pass-through rails
      mergeLines: [],       // curves coming IN from a parent lane above
      convergingLines: [],  // curves coming IN from freed duplicate lanes
      laneCount: 0,
    };

    // Parent connections
    if (parents.length === 0) {
      activeLanes[commitLane] = null;
    } else {
      // First parent continues on this lane
      activeLanes[commitLane] = parents[0];

      // Additional parents — merge sources
      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p];
        let parentLane = -1;
        for (let l = 0; l < activeLanes.length; l++) {
          if (activeLanes[l] === parentHash) { parentLane = l; break; }
        }
        if (parentLane === -1) {
          parentLane = activeLanes.indexOf(null);
          if (parentLane === -1) {
            parentLane = activeLanes.length;
            activeLanes.push(null);
          }
          activeLanes[parentLane] = parentHash;
        }
        if (parentLane !== commitLane) {
          entry.mergeLines.push({
            fromLane: commitLane,
            toLane: parentLane,
            colorIdx: parentLane % LANE_COLORS.length,
          });
        }
      }
    }

    // Converging curves from freed duplicate lanes
    for (let k = 1; k < matchingLanes.length; k++) {
      entry.convergingLines.push({
        fromLane: matchingLanes[k],
        toLane: commitLane,
        colorIdx: matchingLanes[k] % LANE_COLORS.length,
      });
    }

    // Pass-through lines for all active lanes (including merge parent lanes,
    // whose visual connection is handled by the merge curve entering from above)
    for (let l = 0; l < activeLanes.length; l++) {
      if (activeLanes[l] !== null) {
        entry.lines.push({ lane: l, colorIdx: l % LANE_COLORS.length });
      }
    }

    // Trim trailing empty lanes to keep the graph compact
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop();
    }

    entry.laneCount = activeLanes.filter(v => v !== null).length || 1;
    return entry;
  });
}

// ── SVG Graph Cell ───────────────────────────────────────────────
function GraphCell({ layoutEntry, maxLanes }) {
  if (!layoutEntry) return null;
  const { lane, isMerge, lines, mergeLines, convergingLines } = layoutEntry;
  const cappedLanes = Math.min(maxLanes, MAX_DISPLAY_LANES);
  const svgWidth = Math.max(28, cappedLanes * LANE_WIDTH + GRAPH_PADDING * 2);
  const cy = ROW_HEIGHT / 2;

  function laneX(l) {
    return GRAPH_PADDING + l * LANE_WIDTH + LANE_WIDTH / 2;
  }

  const cx = laneX(lane);

  return (
    <svg
      className="git-manager-history-graph"
      width={svgWidth}
      height={ROW_HEIGHT}
      style={{ width: svgWidth, minWidth: svgWidth }}
    >
      {/* Vertical pass-through lines */}
      {lines.map((line, idx) => {
        const lx = laneX(line.lane);
        if (line.lane === lane) {
          // Current commit's lane: draw segments above and below the node
          return (
            <React.Fragment key={'l' + idx}>
              <line
                x1={lx} y1={0} x2={lx} y2={cy - NODE_RADIUS - 1}
                stroke={LANE_COLORS[line.colorIdx]}
                strokeWidth={2} opacity={0.5}
              />
              <line
                x1={lx} y1={cy + NODE_RADIUS + 1} x2={lx} y2={ROW_HEIGHT}
                stroke={LANE_COLORS[line.colorIdx]}
                strokeWidth={2} opacity={0.5}
              />
            </React.Fragment>
          );
        }
        // Pass-through: full vertical line
        return (
          <line
            key={'l' + idx}
            x1={lx} y1={0} x2={lx} y2={ROW_HEIGHT}
            stroke={LANE_COLORS[line.colorIdx]}
            strokeWidth={2} opacity={0.35}
          />
        );
      })}

      {/* Merge curves (bezier from parent lane above into commit node) */}
      {mergeLines.map((ml, idx) => {
        const commitX = laneX(ml.fromLane);
        const parentX = laneX(ml.toLane);
        // Descends vertically on parent lane, then curves horizontally into commit node
        const midX = (parentX + commitX) / 2;
        return (
          <path
            key={'m' + idx}
            d={`M ${parentX} 0 C ${parentX} ${cy * 0.6}, ${midX} ${cy}, ${commitX} ${cy}`}
            fill="none"
            stroke={LANE_COLORS[ml.colorIdx]}
            strokeWidth={2}
            opacity={0.55}
          />
        );
      })}

      {/* Converging curves (branch merging back into this commit's lane) */}
      {convergingLines && convergingLines.map((cl, idx) => {
        const fromX = laneX(cl.fromLane);
        const toX = laneX(cl.toLane);
        // Descends vertically on branch lane, then curves horizontally into commit node
        const midX = (fromX + toX) / 2;
        return (
          <path
            key={'c' + idx}
            d={`M ${fromX} 0 C ${fromX} ${cy * 0.6}, ${midX} ${cy}, ${toX} ${cy}`}
            fill="none"
            stroke={LANE_COLORS[cl.colorIdx]}
            strokeWidth={2}
            opacity={0.55}
          />
        );
      })}

      {/* Commit node */}
      <circle
        cx={cx}
        cy={cy}
        r={isMerge ? MERGE_NODE_RADIUS : NODE_RADIUS}
        fill={LANE_COLORS[lane % LANE_COLORS.length]}
        stroke={isMerge ? 'var(--border-hover)' : 'none'}
        strokeWidth={isMerge ? 1.5 : 0}
      />
    </svg>
  );
}

// ── Ref badges (branch/tag decorations) ──────────────────────────
function RefBadges({ commit, branchMap, currentBranch }) {
  const refs = useMemo(() => {
    const result = [];
    // Parse inline refs from commit data first
    if (commit.refs) {
      result.push(...parseRefs(commit.refs));
    }
    // Cross-reference with branch map by short hash
    const mapped = branchMap && (branchMap[commit.shortHash] || branchMap[commit.hash]);
    if (mapped) {
      for (const b of mapped) {
        if (!result.some(r => r.name === b.name)) {
          if (b.current) {
            result.unshift({ name: b.name, type: 'head' });
          } else {
            result.push({ name: b.name, type: 'branch' });
          }
        }
      }
    }
    return result;
  }, [commit.refs, commit.shortHash, commit.hash, branchMap, currentBranch]);

  if (refs.length === 0) return null;

  return (
    <span className="git-manager-history-refs" style={{ marginRight: 6 }}>
      {refs.map((ref, i) => (
        <span key={i} className={`git-manager-history-ref ${ref.type}`}>
          {ref.name}
        </span>
      ))}
    </span>
  );
}

// ── File status colors ───────────────────────────────────────────
const FILE_STATUS_COLORS = {
  M: 'var(--color-in-progress)',
  A: 'var(--color-completed)',
  D: 'var(--color-failed)',
  R: '#f59e0b',
  C: '#06b6d4',
  T: 'var(--text-secondary)',
  U: 'var(--color-blocked)',
};

// ── Expanded commit detail view ──────────────────────────────────
function CommitDetails({ commit, repoPath }) {
  const [filesChanged, setFilesChanged] = useState(null);
  const [diffText, setDiffText] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Load file list (--name-status) for this commit
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI;
    if (!api || !api.gitLog || !repoPath || !commit) return;

    setLoadingFiles(true);
    setFilesChanged(null);
    setDiffText(null);
    setShowDiff(false);

    (async () => {
      try {
        // Fetch this single commit with --name-status appended
        const result = await api.gitLog(repoPath, 1, [
          commit.hash,
          '--name-status',
        ]);

        if (!cancelled && result && result.success && result.data) {
          if (Array.isArray(result.data) && result.data.length > 0) {
            const entry = result.data[0];
            // --name-status output appears in the body after the format output
            const bodyLines = (entry.body || '').split('\n').filter(Boolean);
            const files = [];
            for (const line of bodyLines) {
              const match = line.match(/^([MADRCTU])\d*\t(.+)$/);
              if (match) {
                files.push({ status: match[1], path: match[2] });
              }
            }
            setFilesChanged(files);
          } else if (typeof result.data === 'string') {
            const lines = result.data.split('\n').filter(Boolean);
            const files = [];
            for (const line of lines) {
              const match = line.match(/^([MADRCTU])\d*\t(.+)$/);
              if (match) {
                files.push({ status: match[1], path: match[2] });
              }
            }
            setFilesChanged(files);
          }
        }
      } catch (err) {
        console.error('CommitDetails: failed to load files', err);
        if (!cancelled) setFilesChanged([]);
      } finally {
        if (!cancelled) setLoadingFiles(false);
      }
    })();

    return () => { cancelled = true; };
  }, [commit?.hash, repoPath]);

  // Load diff on demand
  const handleToggleDiff = useCallback(async () => {
    if (diffText !== null) {
      setShowDiff(prev => !prev);
      return;
    }

    const api = window.electronAPI;
    if (!api || !api.gitLog || !repoPath || !commit) return;

    setLoadingDiff(true);
    try {
      const result = await api.gitLog(repoPath, 1, [commit.hash, '-p']);
      if (result && result.success && result.data) {
        if (Array.isArray(result.data) && result.data.length > 0) {
          setDiffText(result.data[0].body || 'No diff available');
        } else if (typeof result.data === 'string') {
          setDiffText(result.data || 'No diff available');
        } else {
          setDiffText('No diff available');
        }
        setShowDiff(true);
      } else {
        setDiffText('No diff available');
        setShowDiff(true);
      }
    } catch (err) {
      console.error('CommitDetails: failed to load diff', err);
      setDiffText('Failed to load diff');
      setShowDiff(true);
    } finally {
      setLoadingDiff(false);
    }
  }, [commit, repoPath, diffText]);

  const fullBody = commit.body || '';
  const isMerge = commit.parents && commit.parents.length > 1;

  return (
    <div
      className="git-manager-history-details"
      style={{
        padding: '10px 12px 12px 52px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {/* Full commit message body */}
      {fullBody && (
        <pre style={{
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: '0.72rem',
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
          margin: '0 0 10px 0',
        }}>
          {fullBody}
        </pre>
      )}

      {/* Metadata row */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 16px',
        marginBottom: 10,
        fontSize: '0.7rem',
        color: 'var(--text-tertiary)',
      }}>
        <span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Commit: </span>
          <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace" }}>{commit.hash}</span>
        </span>
        {commit.parents && commit.parents.length > 0 && (
          <span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
              {isMerge ? 'Merge: ' : 'Parent: '}
            </span>
            <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
              {commit.parents.map(p => p.slice(0, 7)).join(isMerge ? ' + ' : ', ')}
            </span>
          </span>
        )}
        <span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Author: </span>
          {commit.author}
          {commit.email && (
            <span style={{ opacity: 0.5 }}> &lt;{commit.email}&gt;</span>
          )}
        </span>
        <span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Date: </span>
          {commit.date ? new Date(commit.date).toLocaleString() : ''}
        </span>
      </div>

      {/* Files changed list */}
      {loadingFiles && filesChanged === null && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem', padding: '4px 0' }}>
          Loading changed files...
        </div>
      )}

      {filesChanged !== null && filesChanged.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{
            fontSize: '0.65rem',
            color: 'var(--text-tertiary)',
            marginBottom: 4,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            Files Changed ({filesChanged.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filesChanged.map((f, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.72rem',
                padding: '2px 0',
              }}>
                <span style={{
                  width: 14,
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '0.62rem',
                  color: FILE_STATUS_COLORS[f.status] || 'var(--text-tertiary)',
                  flexShrink: 0,
                }}>
                  {f.status}
                </span>
                <span style={{
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                }}>
                  {f.path}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {filesChanged !== null && filesChanged.length === 0 && !loadingFiles && (
        <div style={{
          color: 'var(--text-tertiary)',
          fontSize: '0.7rem',
          padding: '2px 0',
          marginBottom: 6,
        }}>
          No file changes recorded for this commit
        </div>
      )}

      {/* Show/hide diff button */}
      <div style={{ marginTop: 4 }}>
        <button
          className="git-manager-action-btn"
          onClick={handleToggleDiff}
          disabled={loadingDiff}
          style={{ padding: '3px 10px', fontSize: '0.68rem' }}
        >
          {loadingDiff ? 'Loading...' : showDiff ? 'Hide Diff' : 'Show Diff'}
        </button>
      </div>

      {/* Diff content with syntax coloring */}
      {showDiff && diffText !== null && (
        <pre style={{
          padding: 10,
          borderRadius: 5,
          background: 'rgba(0, 0, 0, 0.2)',
          border: '1px solid var(--border)',
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: '0.66rem',
          lineHeight: 1.5,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 400,
          overflowY: 'auto',
          margin: '8px 0 0 0',
        }}>
          {diffText.split('\n').map((line, idx) => {
            let color = 'var(--text-secondary)';
            if (line.startsWith('+') && !line.startsWith('+++')) color = 'var(--color-completed)';
            else if (line.startsWith('-') && !line.startsWith('---')) color = 'var(--color-failed)';
            else if (line.startsWith('@@')) color = 'var(--color-in-progress)';
            else if (line.startsWith('diff ') || line.startsWith('index ')) color = 'var(--text-tertiary)';
            return (
              <span key={idx} style={{ color }}>{line}{'\n'}</span>
            );
          })}
        </pre>
      )}
    </div>
  );
}

// ── Main HistoryPanel component ──────────────────────────────────

function HistoryPanel({ repoPath }) {
  const { gitBranches, gitCurrentBranch } = useAppState();
  const dispatch = useDispatch();

  // Core state
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expandedHash, setExpandedHash] = useState(null);
  const loadingRef = useRef(false);

  // Filter state
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [authorInput, setAuthorInput] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const tableRef = useRef(null);
  const searchTimer = useRef(null);
  const authorTimer = useRef(null);

  // Debounced search
  const handleSearchChange = useCallback((val) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchTerm(val), 400);
  }, []);

  // Debounced author filter
  const handleAuthorInputChange = useCallback((val) => {
    setAuthorInput(val);
    if (authorTimer.current) clearTimeout(authorTimer.current);
    authorTimer.current = setTimeout(() => setAuthorFilter(val), 400);
  }, []);

  // Load commits from the repository
  const loadCommits = useCallback(async (offset = 0, replace = false) => {
    if (!repoPath || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    try {
      const api = window.electronAPI;
      if (!api || !api.gitLog) {
        loadingRef.current = false;
        setLoading(false);
        return;
      }

      const extraArgs = ['--parents', '--decorate=short'];

      if (branchFilter) extraArgs.push(branchFilter);
      if (authorFilter) extraArgs.push(`--author=${authorFilter}`);
      if (searchTerm) extraArgs.push(`--grep=${searchTerm}`);
      if (dateFrom) extraArgs.push(`--after=${dateFrom}`);
      if (dateTo) extraArgs.push(`--before=${dateTo}`);
      if (offset > 0) extraArgs.push(`--skip=${offset}`);

      const result = await api.gitLog(repoPath, BATCH_SIZE, extraArgs);

      if (result && result.success && result.data) {
        // Parse parent hashes from the hash field
        // When --parents is used, %H outputs: hash parent1 parent2 ...
        const parsed = result.data.map(c => {
          const hashParts = (c.hash || '').split(' ');
          return {
            hash: hashParts[0],
            shortHash: c.shortHash || hashParts[0].slice(0, 7),
            author: c.author || '',
            email: c.email || '',
            date: c.date || '',
            subject: c.subject || '',
            body: c.body || '',
            parents: hashParts.slice(1).filter(Boolean),
            refs: c.refs || null,
          };
        });

        if (replace) {
          setCommits(parsed);
        } else {
          setCommits(prev => {
            // Avoid duplicates when loading more
            const existingHashes = new Set(prev.map(c => c.hash));
            const newCommits = parsed.filter(c => !existingHashes.has(c.hash));
            return [...prev, ...newCommits];
          });
        }

        setHasMore(parsed.length >= BATCH_SIZE);

        // Update global state on initial load
        if (replace) {
          dispatch({ type: 'GIT_SET_LOG', log: parsed });
        }
      } else {
        if (replace) setCommits([]);
        setHasMore(false);
      }
    } catch (err) {
      console.error('HistoryPanel: failed to load commits', err);
      if (replace) setCommits([]);
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [repoPath, branchFilter, authorFilter, searchTerm, dateFrom, dateTo, dispatch]);

  // Reload when filters or repo changes
  useEffect(() => {
    setCommits([]);
    setExpandedHash(null);
    setHasMore(true);
    loadingRef.current = false;
    if (repoPath) {
      loadCommits(0, true);
    }
  }, [repoPath, branchFilter, authorFilter, searchTerm, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    if (!tableRef.current || loadingRef.current || !hasMore) return;
    const el = tableRef.current;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      loadCommits(commits.length, false);
    }
  }, [hasMore, commits.length, loadCommits]);

  // Manual load-more fallback
  const handleLoadMore = useCallback(() => {
    if (hasMore && !loadingRef.current) {
      loadCommits(commits.length, false);
    }
  }, [hasMore, commits.length, loadCommits]);

  // Refresh
  const handleRefresh = useCallback(() => {
    setCommits([]);
    setExpandedHash(null);
    setHasMore(true);
    loadingRef.current = false;
    loadCommits(0, true);
  }, [loadCommits]);

  // Toggle row expansion
  const toggleExpand = useCallback((hash) => {
    setExpandedHash(prev => prev === hash ? null : hash);
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setBranchFilter('');
    setAuthorFilter('');
    setAuthorInput('');
    setDateFrom('');
    setDateTo('');
    setSearchTerm('');
    setSearchInput('');
  }, []);

  // Compute graph layout
  const graphLayout = useMemo(() => computeGraphLayout(commits), [commits]);

  const maxLanes = useMemo(() => {
    if (graphLayout.length === 0) return 1;
    return Math.max(1, ...graphLayout.map(l => l.laneCount));
  }, [graphLayout]);

  // Unique authors for filter dropdown
  const uniqueAuthors = useMemo(() => {
    const authors = new Set();
    commits.forEach(c => { if (c.author) authors.add(c.author); });
    return Array.from(authors).sort();
  }, [commits]);

  // Local branches for filter dropdown
  const localBranches = useMemo(() => {
    return (gitBranches || []).filter(b => !b.name.startsWith('remotes/'));
  }, [gitBranches]);

  // Branch hash map for RefBadges
  const branchMap = useMemo(() => {
    const map = {};
    for (const b of (gitBranches || [])) {
      if (b.hash) {
        if (!map[b.hash]) map[b.hash] = [];
        map[b.hash].push(b);
      }
    }
    return map;
  }, [gitBranches]);

  const hasActiveFilters = branchFilter || authorFilter || dateFrom || dateTo;

  // No repo guard
  if (!repoPath) {
    return (
      <div className="git-manager-history">
        <div className="git-manager-empty">
          <div className="git-manager-empty-message">No repository selected</div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-manager-history">
      {/* Toolbar: search + filter toggle + refresh */}
      <div className="git-manager-history-toolbar">
        <input
          className="git-manager-history-search"
          type="text"
          placeholder="Search commits (message, author, hash)..."
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
        />

        <button
          className={`git-manager-action-btn${showFilters ? ' primary' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          title="Toggle filters"
          style={{ padding: '4px 10px', fontSize: '0.7rem', gap: 4 }}
        >
          <FilterIcon />
          Filters
          {hasActiveFilters && (
            <span style={{
              width: 6, height: 6,
              borderRadius: '50%',
              background: 'var(--color-in-progress)',
              flexShrink: 0,
            }} />
          )}
        </button>

        <button
          className="git-manager-action-btn"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh history"
          style={{ padding: '4px 8px', fontSize: '0.7rem' }}
        >
          <RefreshIcon />
        </button>
      </div>

      {/* Collapsible filter panel */}
      {showFilters && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexWrap: 'wrap',
        }}>
          {/* Branch filter */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>
            Branch:
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              style={{
                height: 24, padding: '0 4px',
                border: '1px solid var(--border)', borderRadius: 4,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'var(--sans)', fontSize: '0.7rem',
                outline: 'none',
              }}
            >
              <option value="">All branches</option>
              {localBranches.map(b => (
                <option key={b.name} value={b.name}>
                  {b.name}{b.current ? ' *' : ''}
                </option>
              ))}
            </select>
          </label>

          {/* Author filter */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>
            Author:
            <select
              value={authorFilter}
              onChange={e => { setAuthorFilter(e.target.value); setAuthorInput(e.target.value); }}
              style={{
                height: 24, padding: '0 4px',
                border: '1px solid var(--border)', borderRadius: 4,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'var(--sans)', fontSize: '0.7rem',
                outline: 'none',
              }}
            >
              <option value="">All authors</option>
              {uniqueAuthors.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>

          {/* Date range */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>
            From:
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{
                height: 24, padding: '0 4px',
                border: '1px solid var(--border)', borderRadius: 4,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'var(--sans)', fontSize: '0.68rem',
                outline: 'none',
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>
            To:
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{
                height: 24, padding: '0 4px',
                border: '1px solid var(--border)', borderRadius: 4,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'var(--sans)', fontSize: '0.68rem',
                outline: 'none',
              }}
            />
          </label>

          {/* Clear filters button */}
          {hasActiveFilters && (
            <button
              className="git-manager-action-btn danger"
              onClick={clearFilters}
              style={{ padding: '2px 8px', fontSize: '0.65rem' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Commit table (scrollable, infinite scroll) */}
      <div
        className="git-manager-history-table"
        ref={tableRef}
        onScroll={handleScroll}
      >
        {commits.map((commit, idx) => (
          <React.Fragment key={commit.hash}>
            <div
              className={`git-manager-history-row${expandedHash === commit.hash ? ' selected' : ''}`}
              onClick={() => toggleExpand(commit.hash)}
            >
              {/* Graph column */}
              <GraphCell
                layoutEntry={graphLayout[idx]}
                maxLanes={maxLanes}
              />

              {/* Hash (abbreviated, 7 chars) */}
              <span className="git-manager-history-hash" title={commit.hash}>
                {commit.shortHash}
              </span>

              {/* Message + ref badges */}
              <span className="git-manager-history-message">
                <RefBadges
                  commit={commit}
                  branchMap={branchMap}
                  currentBranch={gitCurrentBranch}
                />
                {commit.subject}
              </span>

              {/* Author */}
              <span className="git-manager-history-author" title={commit.email || commit.author}>
                {commit.author}
              </span>

              {/* Relative date */}
              <span className="git-manager-history-date" title={commit.date ? new Date(commit.date).toLocaleString() : ''}>
                {relativeDate(commit.date)}
              </span>
            </div>

            {/* Expanded commit detail panel */}
            {expandedHash === commit.hash && (
              <CommitDetails commit={commit} repoPath={repoPath} />
            )}
          </React.Fragment>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div
            className="git-manager-history-row"
            style={{ justifyContent: 'center', opacity: 0.5, cursor: 'default' }}
          >
            Loading commits...
          </div>
        )}

        {/* Empty state */}
        {!loading && commits.length === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 120,
            color: 'var(--text-tertiary)',
            fontSize: '0.78rem',
            gap: 8,
          }}>
            <EmptyHistoryIcon />
            <span>
              {searchTerm || hasActiveFilters
                ? 'No commits match the current filters'
                : 'No commit history found'}
            </span>
          </div>
        )}

        {/* Load more button (fallback if scroll doesn't trigger) */}
        {!loading && hasMore && commits.length > 0 && (
          <div className="git-manager-load-more" style={{
            padding: '10px 12px',
            textAlign: 'center',
          }}>
            <button
              className="git-manager-action-btn"
              onClick={handleLoadMore}
              style={{ fontSize: '0.7rem' }}
            >
              Load more commits
            </button>
          </div>
        )}

        {/* End of history */}
        {!loading && !hasMore && commits.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px 0',
            color: 'var(--text-tertiary)',
            fontSize: '0.65rem',
            opacity: 0.5,
          }}>
            End of commit history
          </div>
        )}
      </div>
    </div>
  );
}

export default HistoryPanel;

// ── SVG Icons ────────────────────────────────────────────────────

function FilterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M2 3h12M4 8h8M6 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M2 8a6 6 0 0 1 10.3-4.2M14 8a6 6 0 0 1-10.3 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12.5 1v3h-3M3.5 15v-3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyHistoryIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.4 }}>
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1.2" />
      <path d="M16 9v7l4 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
