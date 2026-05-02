// ArchiveModal — Lists archived snapshots with name, type, agent count, delete button
// Mirrors ArchiveModal.js with React hooks and JSX.

import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';

function ArchiveEntry({ archive, onClick, onDelete }) {
  const taskName = archive.task ? archive.task.name : archive.name;
  const dateStr = archive.name.slice(0, 10);

  function handleTrashClick(e) {
    e.stopPropagation();
    if (onDelete) onDelete(archive);
  }

  return (
    <div className="history-entry" onClick={() => onClick && onClick(archive.name)}>
      <span className="history-entry-dot" style={{ backgroundColor: 'var(--color-completed)' }} />
      <div className="history-entry-content">
        <div className="history-entry-name">{taskName}</div>
        <div className="history-entry-meta">
          {archive.task && archive.task.type && (
            <span
              className="history-entry-badge"
              style={{ backgroundColor: 'var(--color-type-bg)', color: 'var(--color-type)' }}
            >
              {archive.task.type}
            </span>
          )}
          <span
            className="history-entry-badge"
            style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)' }}
          >
            {archive.agentCount} agents
          </span>
          <span className="history-entry-date">{dateStr}</span>
        </div>
      </div>
      <button
        className="archive-trash-btn"
        title="Delete archive"
        onClick={handleTrashClick}
      >
        🗑
      </button>
    </div>
  );
}

export default function ArchiveModal({ onClose, onItemClick, onDelete }) {
  const api = window.electronAPI || null;
  const [archives, setArchives] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) { setLoading(false); return; }
    api.getArchives().then(items => {
      setArchives(items || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api]);

  function handleClick(archiveName) {
    onClose();
    if (onItemClick) onItemClick(archiveName);
  }

  function handleDelete(archive) {
    const taskName = archive.task ? archive.task.name : archive.name;
    if (!confirm('Are you sure you want to permanently delete "' + taskName + '"? This cannot be undone.')) {
      return;
    }

    if (onDelete) {
      // Let parent handle the delete API call
      onDelete(archive.name, () => {
        setArchives(prev => prev.filter(a => a.name !== archive.name));
      });
    } else if (api) {
      // Fallback: call API directly
      fetch('/api/archives/' + encodeURIComponent(archive.name), { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setArchives(prev => prev.filter(a => a.name !== archive.name));
          }
        })
        .catch(() => {});
    }
  }

  return (
    <Modal title="Archived Tasks" onClose={onClose}>
      {loading ? (
        <div className="history-empty">Loading...</div>
      ) : archives.length === 0 ? (
        <div className="history-empty">No archived tasks</div>
      ) : (
        archives.map((archive, i) => (
          <ArchiveEntry
            key={archive.name + i}
            archive={archive}
            onClick={handleClick}
            onDelete={handleDelete}
          />
        ))
      )}
    </Modal>
  );
}
