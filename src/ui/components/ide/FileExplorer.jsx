// FileExplorer — Recursive tree view of files and folders
// Renders from ideFileTrees[workspaceId] in AppContext state.
// Clicking a file dispatches IDE_OPEN_FILE; clicking a folder toggles expand/collapse.

import React, { useState, useCallback, useEffect } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/ide-explorer.css';

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
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="#e8a74e" strokeWidth="1.2" fill="rgba(232,167,78,0.15)" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v1H4.5a2 2 0 00-1.874 1.298L1.5 11.5V4.5z" stroke="#e8a74e" strokeWidth="1.2" fill="rgba(232,167,78,0.15)" />
      <path d="M3 8.5A1.5 1.5 0 014.5 7H14l-1.5 5.5a1.5 1.5 0 01-1.45 1H2.5L3 8.5z" stroke="#e8a74e" strokeWidth="1.2" fill="rgba(232,167,78,0.1)" />
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
      <path d="M4 2h5.586a1 1 0 01.707.293l2.414 2.414a1 1 0 01.293.707V13a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.1" fill="rgba(255,255,255,0.04)" />
      <path d="M9 2v3a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function MarkdownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="rgba(155,124,240,0.12)" stroke="#9b7cf0" strokeWidth="0.8" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="5" fontWeight="700" fill="#9b7cf0" fontFamily="sans-serif">MD</text>
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

// ── TreeNode — recursive renderer ────────────────────────────

function TreeNode({ node, depth, expandedPaths, toggleExpand, onFileClick, activeFilePath }) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedPaths.has(node.path);
  const isActive = !isDir && node.path === activeFilePath;

  const handleClick = useCallback(() => {
    if (isDir) {
      toggleExpand(node.path);
    } else {
      onFileClick(node);
    }
  }, [isDir, node, toggleExpand, onFileClick]);

  return (
    <>
      <div
        className={`ide-explorer-item ${isDir ? 'folder' : 'file'}${isActive ? ' active' : ''}`}
        data-depth={Math.min(depth, 10)}
        onClick={handleClick}
        role="treeitem"
        aria-expanded={isDir ? isExpanded : undefined}
        title={node.path}
      >
        {isDir ? (
          <span className={`ide-explorer-chevron${isExpanded ? ' expanded' : ''}`}>
            <ChevronIcon />
          </span>
        ) : (
          <span className="ide-explorer-chevron-spacer" />
        )}
        <span className="ide-explorer-icon">
          {isDir ? (isExpanded ? <FolderOpenIcon /> : <FolderIcon />) : getFileIcon(node.name)}
        </span>
        <span className="ide-explorer-label">{node.name}</span>
      </div>
      {isDir && isExpanded && node.children && node.children.length > 0 && (
        node.children.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedPaths={expandedPaths}
            toggleExpand={toggleExpand}
            onFileClick={onFileClick}
            activeFilePath={activeFilePath}
          />
        ))
      )}
    </>
  );
}

// ── FileExplorer — main component ────────────────────────────

export default function FileExplorer() {
  const state = useAppState();
  const dispatch = useDispatch();

  const workspaceId = state.ideActiveWorkspaceId;
  const workspace = state.ideWorkspaces.find(w => w.id === workspaceId);
  const tree = workspaceId ? state.ideFileTrees[workspaceId] : null;
  const openFiles = workspaceId ? (state.ideOpenFiles[workspaceId] || []) : [];
  const activeFileId = workspaceId ? state.ideActiveFileId[workspaceId] : null;

  // Derive active file path for highlighting
  const activeFile = openFiles.find(f => f.id === activeFileId);
  const activeFilePath = activeFile ? activeFile.path : null;

  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [loading, setLoading] = useState(false);

  // Load file tree when workspace changes (or on initial mount if workspace already active)
  useEffect(() => {
    if (!workspaceId || !workspace) return;

    // If tree already loaded, skip
    if (tree) return;

    let cancelled = false;
    async function loadTree() {
      setLoading(true);
      try {
        const api = window.electronAPI;
        if (!api || !api.ideReadDir) return;

        const result = await api.ideReadDir(workspace.path, { maxDepth: 3 });
        if (cancelled) return;

        if (result && result.success && result.tree) {
          dispatch({ type: 'IDE_SET_FILE_TREE', workspaceId, tree: result.tree });

          // Auto-expand root level
          if (result.tree.children) {
            const rootPaths = new Set([result.tree.path]);
            setExpandedPaths(rootPaths);
          }
        }
      } catch (err) {
        console.error('FileExplorer: failed to load directory tree', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadTree();
    return () => { cancelled = true; };
  }, [workspaceId, workspace, tree, dispatch]);

  // Toggle expand/collapse for a directory path
  const toggleExpand = useCallback((path) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Handle file click — dispatch IDE_OPEN_FILE
  const onFileClick = useCallback((node) => {
    if (!workspaceId) return;
    dispatch({
      type: 'IDE_OPEN_FILE',
      workspaceId,
      file: { path: node.path, name: node.name }
    });
  }, [workspaceId, dispatch]);

  // Refresh tree
  const handleRefresh = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api || !api.ideReadDir) return;

      const result = await api.ideReadDir(workspace.path, { maxDepth: 3 });
      if (result && result.success && result.tree) {
        dispatch({ type: 'IDE_SET_FILE_TREE', workspaceId, tree: result.tree });
      }
    } catch (err) {
      console.error('FileExplorer: failed to refresh directory tree', err);
    } finally {
      setLoading(false);
    }
  }, [workspace, workspaceId, dispatch]);

  // No workspace — shouldn't render, but handle gracefully
  if (!workspaceId || !workspace) {
    return (
      <div className="ide-explorer">
        <div className="ide-explorer-empty">No workspace selected</div>
      </div>
    );
  }

  return (
    <div className="ide-explorer">
      <div className="ide-explorer-header">
        <span className="ide-explorer-title" title={workspace.path}>
          {workspace.name}
        </span>
        <div className="ide-explorer-actions">
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
        {loading ? (
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
            />
          ))
        ) : (
          <div className="ide-explorer-empty">Empty directory</div>
        )}
      </div>
    </div>
  );
}
