// GuideModal — Browse and read user-facing guide documentation.
// Read-only sidebar list grouped by folder with a markdown viewer.

import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal.jsx';
import { renderMarkdown } from '@/utils/markdown.js';

function guideKey(guide) {
  return guide?.id || guide?.path || guide?.filePath || guide?.name || guide?.title || '';
}

function guideSortValue(guide) {
  return guide?.path || guide?.id || guide?.name || guide?.title || '';
}

function naturalCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return [];

  return groups
    .map(group => ({
      folder: group?.folder || 'General',
      guides: Array.isArray(group?.guides)
        ? [...group.guides].sort((a, b) => naturalCompare(guideSortValue(a), guideSortValue(b)))
        : [],
    }))
    .filter(group => group.guides.length > 0)
    .sort((a, b) => naturalCompare(a.folder, b.folder));
}

function GuideFolder({ folder, guides, activeGuide, onSelect, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen || false);
  const activeKey = guideKey(activeGuide);

  return (
    <div className="commands-folder">
      <button
        className={'commands-folder-header' + (open ? ' open' : '')}
        onClick={() => setOpen(o => !o)}
      >
        <svg className="commands-folder-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="commands-folder-name">{folder}</span>
        <span className="commands-folder-count">{guides.length}</span>
      </button>
      {open && (
        <div className="commands-folder-items">
          {guides.map(guide => {
            const key = guideKey(guide);
            return (
              <div
                key={key}
                className={'commands-list-item' + (activeKey === key ? ' active' : '')}
                onClick={() => onSelect(guide)}
              >
                <span className="commands-item-name">
                  {guide.subfolder ? <span className="commands-item-subfolder">{guide.subfolder}/</span> : null}
                  {guide.title || guide.name}
                </span>
                <div className="commands-item-purpose">{guide.purpose || guide.path || ''}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GuideViewer({ guide }) {
  return (
    <>
      <div className="commands-viewer-header">
        <h2 className="commands-viewer-title">{guide.title || guide.name}</h2>
      </div>
      {guide.purpose && (
        <div className="commands-viewer-purpose">
          <span className="commands-meta-label">Purpose: </span>
          <span>{guide.purpose}</span>
        </div>
      )}
      <div
        className="commands-viewer-content"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(guide.content || '') }}
      />
    </>
  );
}

export default function GuideModal({ onClose }) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const hasGuideApi = !!api && typeof api.listGuide === 'function' && typeof api.getGuide === 'function';

  const [groups, setGroups] = useState([]);
  const [activeSummary, setActiveSummary] = useState(null);
  const [activeGuide, setActiveGuide] = useState(null);
  const [viewerState, setViewerState] = useState(hasGuideApi ? 'loading' : 'missing_api');
  const [error, setError] = useState(null);

  const loadGuides = useCallback(() => {
    if (!hasGuideApi) {
      setViewerState('missing_api');
      return;
    }

    setViewerState('loading');
    setError(null);
    api.listGuide()
      .then(result => {
        const nextGroups = normalizeGroups(result);
        setGroups(nextGroups);
        setActiveSummary(null);
        setActiveGuide(null);
        setViewerState(nextGroups.length > 0 ? 'placeholder' : 'empty');
      })
      .catch(err => {
        setGroups([]);
        setActiveSummary(null);
        setActiveGuide(null);
        setError(err?.message || 'Unable to load guide files.');
        setViewerState('error');
      });
  }, [api, hasGuideApi]);

  useEffect(() => { loadGuides(); }, [loadGuides]);

  function selectGuide(guide) {
    if (!hasGuideApi) return;

    setActiveSummary(guide);
    setActiveGuide(null);
    setError(null);
    setViewerState('loading_file');

    api.getGuide(guide.id || guide.path || guide.name)
      .then(full => {
        if (!full) {
          setActiveGuide(null);
          setViewerState('missing');
          return;
        }
        setActiveGuide(full);
        setViewerState('view');
      })
      .catch(err => {
        setActiveGuide(null);
        setError(err?.message || 'Unable to load guide file.');
        setViewerState('error');
      });
  }

  return (
    <Modal title="Guide" onClose={onClose} className="commands-modal guide-modal">
      <div className="commands-layout">
        <div className="commands-sidebar">
          <div className="commands-sidebar-header">
            <span className="commands-section-title">Documentation</span>
          </div>
          <div className="commands-list">
            {groups.map((group, index) => (
              <GuideFolder
                key={group.folder}
                folder={group.folder}
                guides={group.guides}
                activeGuide={activeSummary}
                onSelect={selectGuide}
                defaultOpen={index === 0}
              />
            ))}
            {viewerState === 'loading' && (
              <div className="commands-empty">Loading guide files...</div>
            )}
            {viewerState === 'empty' && (
              <div className="commands-empty">No guide files found</div>
            )}
            {viewerState === 'missing_api' && (
              <div className="commands-empty">Guide API is unavailable</div>
            )}
          </div>
        </div>

        <div className="commands-viewer">
          {viewerState === 'loading' && (
            <div className="commands-viewer-placeholder">Loading guide files...</div>
          )}
          {viewerState === 'placeholder' && (
            <div className="commands-viewer-placeholder">Select a guide to read</div>
          )}
          {viewerState === 'loading_file' && (
            <div className="commands-viewer-placeholder">Loading guide...</div>
          )}
          {viewerState === 'empty' && (
            <div className="commands-viewer-placeholder">No guide files found in documentation/guide</div>
          )}
          {viewerState === 'missing_api' && (
            <div className="commands-viewer-placeholder">Guide content is unavailable in this window</div>
          )}
          {viewerState === 'missing' && (
            <div className="commands-viewer-placeholder">The selected guide file could not be found</div>
          )}
          {viewerState === 'error' && (
            <div className="commands-viewer-placeholder">{error || 'Unable to load guide content'}</div>
          )}
          {viewerState === 'view' && activeGuide && (
            <GuideViewer guide={activeGuide} />
          )}
        </div>
      </div>
    </Modal>
  );
}
