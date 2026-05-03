// FileExplorer — Recursive tree view with lazy-loaded directories
// Renders from ideFileTrees[currentDashboardId] in AppContext state.
// Clicking a file dispatches IDE_OPEN_FILE; clicking a folder loads its children on demand.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '@/context/AppContext.jsx';
import { getDashboardProject } from '@/utils/dashboardProjects.js';
import '@/pages/code/subpages/code-explorer/styles/ide-explorer.css';

// ── SVG Icon Components ──────────────────────────────────────

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-folder">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="var(--icon-folder)" strokeWidth="1.2" fill="var(--icon-folder-bg)" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-folder">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v1H4.5a2 2 0 00-1.874 1.298L1.5 11.5V4.5z" stroke="var(--icon-folder)" strokeWidth="1.2" fill="var(--icon-folder-bg)" />
      <path d="M3 8.5A1.5 1.5 0 014.5 7H14l-1.5 5.5a1.5 1.5 0 01-1.45 1H2.5L3 8.5z" stroke="var(--icon-folder)" strokeWidth="1.2" fill="var(--icon-folder-bg)" />
    </svg>
  );
}

function JsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="rgba(250,204,21,0.15)" stroke="#facc15" strokeWidth="0.8" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#facc15" fontFamily="sans-serif">JS</text>
    </svg>
  );
}

function CssIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" strokeWidth="0.8" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#38bdf8" fontFamily="sans-serif">CSS</text>
    </svg>
  );
}

function JsonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="rgba(250,204,21,0.1)" stroke="#a3a312" strokeWidth="0.8" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="4.5" fontWeight="700" fill="#a3a312" fontFamily="sans-serif">{ }</text>
    </svg>
  );
}

function HtmlIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="rgba(239,68,68,0.12)" stroke="#ef4444" strokeWidth="0.8" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="4" fontWeight="700" fill="#ef4444" fontFamily="sans-serif">HTML</text>
    </svg>
  );
}

function GenericFileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2h5.586a1 1 0 01.707.293l2.414 2.414a1 1 0 01.293.707V13a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1" fill="var(--icon-generic-bg)" />
      <path d="M9 2v3a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function MarkdownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="var(--color-accent-bg)" stroke="var(--color-accent)" strokeWidth="0.8" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="5" fontWeight="700" fill="var(--color-accent)" fontFamily="sans-serif">MD</text>
    </svg>
  );
}

function TypeScriptIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="rgba(56,130,246,0.15)" stroke="#3882f6" strokeWidth="0.8" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#3882f6" fontFamily="sans-serif">TS</text>
    </svg>
  );
}

// ── File type icon resolver ──────────────────────────────────

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return <JsIcon />;
    case 'ts':
    case 'tsx':
      return <TypeScriptIcon />;
    case 'css':
    case 'scss':
    case 'less':
      return <CssIcon />;
    case 'json':
      return <JsonIcon />;
    case 'html':
    case 'htm':
      return <HtmlIcon />;
    case 'md':
    case 'mdx':
      return <MarkdownIcon />;
    default:
      return <GenericFileIcon />;
  }
}

// ── Refresh Icon ─────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 8a5 5 0 01-9.544 2M3 8a5 5 0 019.544-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3 12V9.5h2.5M13 4v2.5h-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── New File Icon ────────────────────────────────────────────

function NewFileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2h5.586a1 1 0 01.707.293l2.414 2.414a1 1 0 01.293.707V13a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M8 7v4M6 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ── New Folder Icon ──────────────────────────────────────────

function NewFolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M8 7v4M6 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ── Loading Spinner ──────────────────────────────────────────

function LoadingSpinner() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="ide-explorer-spinner">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 12" strokeLinecap="round" />
    </svg>
  );
}

// ── TreeNode — recursive renderer ────────────────────────────

function TreeNode({ node, depth, expandedPaths, toggleExpand, onFileClick, activeFilePath, loadingPaths }) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedPaths.has(node.path);
  const isLoading = loadingPaths.has(node.path);
  const isActive = !isDir && node.path === activeFilePath;

  const handleClick = useCallback(() => {
    if (isDir) {
      toggleExpand(node.path, node.children);
    } else {
      onFileClick(node);
    }
  }, [isDir, node, toggleExpand, onFileClick]);

  return (
    <>
      <div
        className={`ide-explorer-item ${isDir ? 'folder' : 'file'}${isActive ? ' active' : ''}`}
        data-depth={Math.min(depth, 10)}
        data-path={node.path}
        onClick={handleClick}
        role="treeitem"
        aria-expanded={isDir ? isExpanded : undefined}
        title={node.path}
      >
        {isDir ? (
          <span className={`ide-explorer-chevron${isExpanded ? ' expanded' : ''}`}>
            {isLoading ? <LoadingSpinner /> : <ChevronIcon />}
          </span>
        ) : (
          <span className="ide-explorer-chevron-spacer" />
        )}
        <span className="ide-explorer-icon">
          {isDir ? (isExpanded ? <FolderOpenIcon /> : <FolderIcon />) : getFileIcon(node.name)}
        </span>
        <span className="ide-explorer-label">{node.name}</span>
      </div>
      {isDir && isExpanded && Array.isArray(node.children) && node.children.length > 0 && (
        node.children.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedPaths={expandedPaths}
            toggleExpand={toggleExpand}
            onFileClick={onFileClick}
            activeFilePath={activeFilePath}
            loadingPaths={loadingPaths}
          />
        ))
      )}
    </>
  );
}

// ── FileExplorer — main component ────────────────────────────

export default function FileExplorer({ dashboardId: dashboardIdProp } = {}) {
  const state = useAppState();
  const dispatch = useDispatch();

  // Prefer prop (CodeExplorerPage may pass it explicitly), otherwise fall back
  // to the active dashboard in AppContext. Both forms produce the same key.
  const dashboardId = dashboardIdProp || state.currentDashboardId;
  const projectPath = dashboardId ? getDashboardProject(dashboardId) : null;
  const dashboardName = dashboardId ? state.dashboardNames[dashboardId] : null;
  // Header label: dashboard name first, then folder basename of project path
  const headerLabel = dashboardName
    || (projectPath ? (projectPath.split('/').pop() || projectPath) : '');

  const tree = dashboardId ? state.ideFileTrees[dashboardId] : null;
  const openFiles = dashboardId ? (state.ideOpenFiles[dashboardId] || []) : [];
  const activeFileId = dashboardId ? state.ideActiveFileId[dashboardId] : null;

  // Derive active file path for highlighting
  const activeFile = openFiles.find(f => f.id === activeFileId);
  const activeFilePath = activeFile ? activeFile.path : null;

  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [loadingPaths, setLoadingPaths] = useState(new Set());
  const [initialLoading, setInitialLoading] = useState(false);

  // Load root level on mount and when active dashboard changes (always fetch fresh data)
  useEffect(() => {
    if (!dashboardId || !projectPath) return;

    let cancelled = false;
    async function loadRoot() {
      // Only show loading spinner if no tree exists yet (avoids flash on refresh)
      if (!tree) setInitialLoading(true);
      try {
        const api = window.electronAPI;
        if (!api || !api.ideListDir) return;

        const result = await api.ideListDir(projectPath);
        if (cancelled) return;

        if (result && result.success) {
          const rootName = projectPath.split('/').pop() || dashboardName || projectPath;
          // Merge instead of replace so that any already-loaded subtrees
          // survive dashboard re-renders.
          dispatch({
            type: 'IDE_MERGE_ROOT_ENTRIES',
            dashboardId,
            rootName,
            rootPath: projectPath,
            entries: result.entries,
          });
          // Only set initial expanded paths when there's no existing tree
          setExpandedPaths(prev => prev.size === 0 ? new Set([projectPath]) : prev);
        }
      } catch (err) {
        console.error('FileExplorer: failed to load root', err);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    loadRoot();
    return () => { cancelled = true; };
  }, [dashboardId, projectPath, dashboardName, dispatch]); // removed `tree` dep — always refresh on mount

  // Poll root directory for changes every 10 seconds.
  // Uses IDE_MERGE_ROOT_ENTRIES so that user-expanded subdirectories keep
  // their lazy-loaded children — otherwise the tree would visually collapse
  // every time the poll fires.
  useEffect(() => {
    if (!dashboardId || !projectPath) return;

    const interval = setInterval(async () => {
      const api = window.electronAPI;
      if (!api || !api.ideListDir) return;

      try {
        const result = await api.ideListDir(projectPath);
        if (result && result.success) {
          const rootName = projectPath.split('/').pop() || dashboardName || projectPath;
          dispatch({
            type: 'IDE_MERGE_ROOT_ENTRIES',
            dashboardId,
            rootName,
            rootPath: projectPath,
            entries: result.entries,
          });
        }
      } catch (_) {}
    }, 10000);

    return () => clearInterval(interval);
  }, [dashboardId, projectPath, dashboardName, dispatch]);

  // Lazy-load a directory's children
  const loadChildren = useCallback(async (dirPath) => {
    const api = window.electronAPI;
    if (!api || !api.ideListDir) return;

    setLoadingPaths(prev => new Set(prev).add(dirPath));
    try {
      const result = await api.ideListDir(dirPath);
      if (result && result.success) {
        dispatch({
          type: 'IDE_UPDATE_FILE_TREE_NODE',
          dashboardId,
          nodePath: dirPath,
          children: result.entries,
        });
      }
    } catch (err) {
      console.error('FileExplorer: failed to load directory', dirPath, err);
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, [dashboardId, dispatch]);

  // Toggle expand/collapse — triggers lazy load when children are null
  const toggleExpand = useCallback((nodePath, children) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(nodePath)) {
        next.delete(nodePath);
      } else {
        next.add(nodePath);
        if (children === null) {
          loadChildren(nodePath);
        }
      }
      return next;
    });
  }, [loadChildren]);

  // Handle file click — dispatch IDE_OPEN_FILE
  const onFileClick = useCallback((node) => {
    if (!dashboardId) return;
    dispatch({
      type: 'IDE_OPEN_FILE',
      dashboardId,
      file: { path: node.path, name: node.name }
    });
  }, [dashboardId, dispatch]);

  // ── Reveal-in-tree effect ────────────────────────────────────
  // Listens for state.ideRevealRequest dispatched from chat (or anywhere else).
  // Walks the path's ancestors, lazy-loads any unloaded directories, expands
  // each one, opens the file in a tab, and scrolls the row into view.
  const treeRef = useRef(tree);
  useEffect(() => { treeRef.current = tree; }, [tree]);
  const revealRequest = state.ideRevealRequest;
  useEffect(() => {
    if (!revealRequest || !projectPath || !dashboardId) return;
    if (revealRequest.dashboardId && revealRequest.dashboardId !== dashboardId) return;
    const targetPath = revealRequest.path;
    if (!targetPath || !targetPath.startsWith(projectPath)) return;

    let cancelled = false;

    function findNodeByPath(node, path) {
      if (!node) return null;
      if (node.path === path) return node;
      if (!Array.isArray(node.children)) return null;
      for (const child of node.children) {
        const hit = findNodeByPath(child, path);
        if (hit) return hit;
      }
      return null;
    }

    async function reveal() {
      const rel = targetPath.slice(projectPath.length).replace(/^\/+/, '');
      if (!rel) return;
      const parts = rel.split('/').filter(Boolean);
      const ancestors = []; // dirs from project root down to file's parent
      for (let i = 0; i < parts.length - 1; i++) {
        ancestors.push(projectPath + '/' + parts.slice(0, i + 1).join('/'));
      }

      // Sequentially ensure each ancestor has children loaded.
      // (Sequential — a child node only exists in the tree once its parent has loaded.)
      for (const dir of ancestors) {
        if (cancelled) return;
        const node = findNodeByPath(treeRef.current, dir);
        if (!node || node.children === null) {
          await loadChildren(dir);
        }
      }
      if (cancelled) return;

      // Expand all ancestors at once
      setExpandedPaths(prev => {
        const next = new Set(prev);
        ancestors.forEach(d => next.add(d));
        // Also expand the project root so the user sees the path from the top
        next.add(projectPath);
        return next;
      });

      // Open the file in a tab
      const fileName = parts[parts.length - 1] || targetPath;
      dispatch({
        type: 'IDE_OPEN_FILE',
        dashboardId,
        file: { path: targetPath, name: fileName },
      });

      // Scroll the row into view once it's rendered
      setTimeout(() => {
        if (cancelled) return;
        const root = document.querySelector('.ide-explorer-tree');
        if (!root) return;
        const sel = `[data-path="${(window.CSS && CSS.escape) ? CSS.escape(targetPath) : targetPath.replace(/"/g, '\\"')}"]`;
        const el = root.querySelector(sel);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 80);
    }

    reveal();
    return () => { cancelled = true; };
    // revealRequest is a fresh object on every dispatch (seq increments), so this fires per-click
  }, [revealRequest, projectPath, dashboardId, dispatch, loadChildren]);

  // Refresh tree — clear and reload root level
  const handleRefresh = useCallback(async () => {
    if (!dashboardId || !projectPath) return;
    setInitialLoading(true);
    setExpandedPaths(new Set());
    try {
      const api = window.electronAPI;
      if (!api || !api.ideListDir) return;

      const result = await api.ideListDir(projectPath);
      if (result && result.success) {
        const rootName = projectPath.split('/').pop() || dashboardName || projectPath;
        dispatch({
          type: 'IDE_SET_FILE_TREE',
          dashboardId,
          tree: {
            name: rootName,
            path: projectPath,
            type: 'directory',
            children: result.entries,
          },
        });
        setExpandedPaths(new Set([projectPath]));
      }
    } catch (err) {
      console.error('FileExplorer: failed to refresh directory tree', err);
    } finally {
      setInitialLoading(false);
    }
  }, [dashboardId, projectPath, dashboardName, dispatch]);

  // No dashboard / no project path — shouldn't render, but handle gracefully
  if (!dashboardId || !projectPath) {
    return (
      <div className="ide-explorer">
        <div className="ide-explorer-empty">No project selected</div>
      </div>
    );
  }

  return (
    <div className="ide-explorer">
      <div className="ide-explorer-header">
        <span className="ide-explorer-title" title={projectPath}>
          {headerLabel}
        </span>
        <div className="ide-explorer-actions">
          <button
            className="ide-explorer-action-btn"
            onClick={() => dispatch({ type: 'SET', key: 'ideSidebarView', value: 'search' })}
            title="Search in files (⌘⇧F)"
          >
            <SearchIcon />
          </button>
          <button
            className="ide-explorer-action-btn"
            onClick={handleRefresh}
            title="Refresh file tree"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      <div className="ide-explorer-tree" role="tree">
        {initialLoading ? (
          <div className="ide-explorer-loading">Loading...</div>
        ) : !tree ? (
          <div className="ide-explorer-empty">No files found</div>
        ) : tree.children && tree.children.length > 0 ? (
          tree.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={0}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
              onFileClick={onFileClick}
              activeFilePath={activeFilePath}
              loadingPaths={loadingPaths}
            />
          ))
        ) : (
          <div className="ide-explorer-empty">Empty directory</div>
        )}
      </div>
    </div>
  );
}
