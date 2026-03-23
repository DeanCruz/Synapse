import React, { useState, useCallback } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/git-manager.css';

const STATUS_MAP = {
  M: { label: 'M', cls: 'modified' },
  A: { label: 'A', cls: 'added' },
  D: { label: 'D', cls: 'deleted' },
  R: { label: 'R', cls: 'renamed' },
  U: { label: 'U', cls: 'untracked' },
  C: { label: 'C', cls: 'conflicted' },
  '?': { label: 'U', cls: 'untracked' },
  T: { label: 'T', cls: 'modified' },
};

function getStatusInfo(status) {
  return STATUS_MAP[status] || STATUS_MAP[status?.[0]] || { label: status || '?', cls: 'untracked' };
}

function splitPath(filePath) {
  if (!filePath) return { name: '', dir: '' };
  const idx = filePath.lastIndexOf('/');
  if (idx === -1) return { name: filePath, dir: '' };
  return { name: filePath.substring(idx + 1), dir: filePath.substring(0, idx + 1) };
}

function ChevronIcon({ collapsed }) {
  return (
    <span className={`git-manager-branch-section-chevron${collapsed ? ' collapsed' : ''}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
        <path d="M3 2l4 3-4 3z" />
      </svg>
    </span>
  );
}

function FileItem({ filePath, status, isStaged, isUntracked, isSelected, onSelect, onStage, onUnstage, onDiscard }) {
  const info = isUntracked ? { label: 'U', cls: 'untracked' } : getStatusInfo(status);
  const { name, dir } = splitPath(filePath);

  return (
    <div
      className={`git-manager-file-item${isSelected ? ' selected' : ''}`}
      onClick={() => onSelect(filePath, isStaged)}
      title={filePath}
    >
      <span className={`git-manager-file-status ${info.cls}`}>{info.label}</span>
      <span className="git-manager-file-name">
        {name}
        {dir && <span className="git-manager-file-path">{dir}</span>}
      </span>
      <span className="git-manager-file-actions">
        {isStaged ? (
          <button
            className="git-manager-file-action-btn"
            title="Unstage"
            onClick={(e) => { e.stopPropagation(); onUnstage(filePath); }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </button>
        ) : (
          <>
            <button
              className="git-manager-file-action-btn"
              title="Stage"
              onClick={(e) => { e.stopPropagation(); onStage(filePath); }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
            </button>
            {!isUntracked && (
              <button
                className="git-manager-file-action-btn danger"
                title="Discard changes (irreversible)"
                onClick={(e) => { e.stopPropagation(); onDiscard(filePath); }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5.5 2h5M3 4h10M12 4l-.5 8.5a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5L4 4" />
                </svg>
              </button>
            )}
          </>
        )}
      </span>
    </div>
  );
}

export default function ChangesPanel({ repoPath }) {
  const { gitStatus, gitSelectedFile } = useAppState();
  const dispatch = useDispatch();

  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [untrackedOpen, setUntrackedOpen] = useState(true);

  const staged = gitStatus?.staged || [];
  const unstaged = gitStatus?.unstaged || [];
  const untracked = gitStatus?.untracked || [];

  const refreshStatus = useCallback(async () => {
    if (!repoPath) return;
    try {
      const result = await window.electronAPI.gitStatus(repoPath);
      if (result.success) {
        dispatch({ type: 'GIT_SET_STATUS', status: result.data });
      }
    } catch (err) {
      dispatch({ type: 'GIT_SET_ERROR', error: err.message });
    }
  }, [repoPath, dispatch]);

  const handleSelectFile = useCallback(async (filePath, isStaged) => {
    dispatch({ type: 'GIT_SET_SELECTED_FILE', filePath });
    if (!repoPath) return;
    try {
      const result = await window.electronAPI.gitDiffFile(repoPath, filePath, isStaged);
      if (result.success) {
        dispatch({ type: 'GIT_SET_DIFF', diff: result.data });
      } else {
        dispatch({ type: 'GIT_SET_DIFF', diff: null });
      }
    } catch {
      dispatch({ type: 'GIT_SET_DIFF', diff: null });
    }
  }, [repoPath, dispatch]);

  const handleStageFile = useCallback(async (filePath) => {
    if (!repoPath) return;
    try {
      await window.electronAPI.gitStage(repoPath, [filePath]);
      await refreshStatus();
    } catch (err) {
      dispatch({ type: 'GIT_SET_ERROR', error: err.message });
    }
  }, [repoPath, refreshStatus, dispatch]);

  const handleUnstageFile = useCallback(async (filePath) => {
    if (!repoPath) return;
    try {
      await window.electronAPI.gitUnstage(repoPath, [filePath]);
      await refreshStatus();
    } catch (err) {
      dispatch({ type: 'GIT_SET_ERROR', error: err.message });
    }
  }, [repoPath, refreshStatus, dispatch]);

  const handleDiscardFile = useCallback(async (filePath) => {
    const confirmed = window.confirm(
      `Discard changes to "${filePath}"?\n\nThis action is IRREVERSIBLE. All uncommitted changes to this file will be lost.`
    );
    if (!confirmed) return;
    if (!repoPath) return;
    try {
      await window.electronAPI.gitDiscardFile(repoPath, filePath);
      await refreshStatus();
      if (gitSelectedFile === filePath) {
        dispatch({ type: 'GIT_SET_SELECTED_FILE', filePath: null });
        dispatch({ type: 'GIT_SET_DIFF', diff: null });
      }
    } catch (err) {
      dispatch({ type: 'GIT_SET_ERROR', error: err.message });
    }
  }, [repoPath, refreshStatus, gitSelectedFile, dispatch]);

  const handleStageAll = useCallback(async () => {
    if (!repoPath) return;
    try {
      await window.electronAPI.gitStageAll(repoPath);
      await refreshStatus();
    } catch (err) {
      dispatch({ type: 'GIT_SET_ERROR', error: err.message });
    }
  }, [repoPath, refreshStatus, dispatch]);

  const handleUnstageAll = useCallback(async () => {
    if (!repoPath) return;
    try {
      await window.electronAPI.gitUnstageAll(repoPath);
      await refreshStatus();
    } catch (err) {
      dispatch({ type: 'GIT_SET_ERROR', error: err.message });
    }
  }, [repoPath, refreshStatus, dispatch]);

  const handleDiscardAll = useCallback(async () => {
    if (unstaged.length === 0) return;
    const confirmed = window.confirm(
      `Discard ALL unstaged changes?\n\nThis will permanently discard changes in ${unstaged.length} file(s). This action is IRREVERSIBLE.`
    );
    if (!confirmed) return;
    if (!repoPath) return;
    try {
      for (const file of unstaged) {
        await window.electronAPI.gitDiscardFile(repoPath, file.path);
      }
      await refreshStatus();
      if (gitSelectedFile && unstaged.some(f => f.path === gitSelectedFile)) {
        dispatch({ type: 'GIT_SET_SELECTED_FILE', filePath: null });
        dispatch({ type: 'GIT_SET_DIFF', diff: null });
      }
    } catch (err) {
      dispatch({ type: 'GIT_SET_ERROR', error: err.message });
    }
  }, [repoPath, unstaged, refreshStatus, gitSelectedFile, dispatch]);

  const totalChanges = staged.length + unstaged.length + untracked.length;

  if (!gitStatus) {
    return (
      <div className="git-manager-changes">
        <div className="git-manager-empty">
          <div className="git-manager-empty-text">No status loaded</div>
        </div>
      </div>
    );
  }

  if (totalChanges === 0) {
    return (
      <div className="git-manager-changes">
        <div className="git-manager-empty">
          <div className="git-manager-empty-title">Working tree clean</div>
          <div className="git-manager-empty-text">No changes to commit</div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-manager-changes">
      {/* Staged Changes */}
      <div className="git-manager-changes-header" onClick={() => setStagedOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ChevronIcon collapsed={!stagedOpen} />
          Staged Changes
          {staged.length > 0 && (
            <span style={{ fontSize: '0.65rem', opacity: 0.5, fontWeight: 400 }}>({staged.length})</span>
          )}
        </span>
        {staged.length > 0 && (
          <div className="git-manager-changes-header-actions" onClick={e => e.stopPropagation()}>
            <button className="git-manager-changes-header-btn" title="Unstage All" onClick={handleUnstageAll}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {stagedOpen && (
        <div className="git-manager-file-list">
          {staged.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: '0.72rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No staged files
            </div>
          ) : (
            staged.map(file => (
              <FileItem
                key={'s-' + file.path}
                filePath={file.path}
                status={file.status}
                isStaged={true}
                isSelected={gitSelectedFile === file.path}
                onSelect={handleSelectFile}
                onUnstage={handleUnstageFile}
              />
            ))
          )}
        </div>
      )}

      {/* Unstaged Changes */}
      <div className="git-manager-changes-header" onClick={() => setUnstagedOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ChevronIcon collapsed={!unstagedOpen} />
          Unstaged Changes
          {unstaged.length > 0 && (
            <span style={{ fontSize: '0.65rem', opacity: 0.5, fontWeight: 400 }}>({unstaged.length})</span>
          )}
        </span>
        {unstaged.length > 0 && (
          <div className="git-manager-changes-header-actions" onClick={e => e.stopPropagation()}>
            <button className="git-manager-changes-header-btn" title="Stage All" onClick={handleStageAll}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
            </button>
            <button className="git-manager-changes-header-btn danger" title="Discard All Changes" onClick={handleDiscardAll}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5.5 2h5M3 4h10M12 4l-.5 8.5a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5L4 4" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {unstagedOpen && (
        <div className="git-manager-file-list">
          {unstaged.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: '0.72rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No unstaged changes
            </div>
          ) : (
            unstaged.map(file => (
              <FileItem
                key={'u-' + file.path}
                filePath={file.path}
                status={file.status}
                isStaged={false}
                isSelected={gitSelectedFile === file.path}
                onSelect={handleSelectFile}
                onStage={handleStageFile}
                onDiscard={handleDiscardFile}
              />
            ))
          )}
        </div>
      )}

      {/* Untracked Files */}
      {untracked.length > 0 && (
        <>
          <div className="git-manager-changes-header" onClick={() => setUntrackedOpen(v => !v)} style={{ cursor: 'pointer' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ChevronIcon collapsed={!untrackedOpen} />
              Untracked Files
              <span style={{ fontSize: '0.65rem', opacity: 0.5, fontWeight: 400 }}>({untracked.length})</span>
            </span>
            <div className="git-manager-changes-header-actions" onClick={e => e.stopPropagation()}>
              <button className="git-manager-changes-header-btn" title="Stage All Untracked" onClick={handleStageAll}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="8" y1="3" x2="8" y2="13" />
                  <line x1="3" y1="8" x2="13" y2="8" />
                </svg>
              </button>
            </div>
          </div>
          {untrackedOpen && (
            <div className="git-manager-file-list">
              {untracked.map(filePath => (
                <FileItem
                  key={'t-' + filePath}
                  filePath={filePath}
                  isUntracked={true}
                  isStaged={false}
                  isSelected={gitSelectedFile === filePath}
                  onSelect={handleSelectFile}
                  onStage={handleStageFile}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
