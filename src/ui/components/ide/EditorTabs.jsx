/**
 * EditorTabs — Tab bar for open files in the IDE.
 *
 * Shows open files as horizontal tabs with:
 *   - Active tab highlight with purple top accent
 *   - Dirty (unsaved) indicator dot
 *   - Close button on each tab (with dirty confirmation)
 *   - Horizontal scrolling for overflow
 *
 * Props:
 *   workspaceId — ID of the active workspace
 */

import React, { useRef, useCallback } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/ide-editor.css';

export default function EditorTabs({ workspaceId }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const tabsBarRef = useRef(null);

  const openFiles = state.ideOpenFiles[workspaceId] || [];
  const activeFileId = state.ideActiveFileId[workspaceId];

  const handleTabClick = useCallback((fileId) => {
    dispatch({ type: 'IDE_SWITCH_FILE', workspaceId, fileId });
  }, [dispatch, workspaceId]);

  const handleTabClose = useCallback((e, file) => {
    e.stopPropagation(); // Don't trigger tab switch
    if (file.isDirty) {
      const confirmed = window.confirm(
        `"${file.name}" has unsaved changes. Close without saving?`
      );
      if (!confirmed) return;
    }
    dispatch({ type: 'IDE_CLOSE_FILE', workspaceId, fileId: file.id });
  }, [dispatch, workspaceId]);

  // Scroll active tab into view when it changes
  const scrollToActive = useCallback((el) => {
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, []);

  if (openFiles.length === 0) {
    return (
      <div className="editor-tabs-bar">
        <span className="editor-tabs-empty">No open files</span>
      </div>
    );
  }

  return (
    <div className="editor-tabs-bar" ref={tabsBarRef}>
      {openFiles.map((file) => {
        const isActive = file.id === activeFileId;
        return (
          <button
            key={file.id}
            className={`editor-tab${isActive ? ' active' : ''}`}
            onClick={() => handleTabClick(file.id)}
            ref={isActive ? scrollToActive : null}
            title={file.path}
          >
            <span className="editor-tab-name">{file.name}</span>
            {file.isDirty && <span className="editor-tab-dirty" />}
            <span
              className="editor-tab-close"
              onClick={(e) => handleTabClose(e, file)}
              role="button"
              tabIndex={-1}
              aria-label={`Close ${file.name}`}
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
}
