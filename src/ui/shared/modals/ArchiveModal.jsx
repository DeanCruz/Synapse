// ArchiveModal — Lists archived snapshots with name, type, agent count, delete button
// Clicking an archive opens it as a temporary tab in the sidebar.

import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { useDispatch } from '@/context/AppContext.jsx';
import { mergeState } from '@/hooks/useDashboardData.js';

function ArchiveEntry({ archive, onClick, onDelete }) {
  const taskName = archive.task ? archive.task.name : archive.name;
  const dateStr = archive.name.slice(0, 10);

  function handleTrashClick(e) {
    e.stopPropagation();
    if (onDelete) onDelete(archive);
  }

  return (
    <div className="history-entry" onClick={() => onClick && onClick(archive)}>
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

export default function ArchiveModal({ onClose, onDelete }) {
  const api = window.electronAPI || null;
  const dispatch = useDispatch();
  const [archives, setArchives] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) { setLoading(false); return; }
    api.getArchives().then(result => {
      const items = result?.archives || result || [];
      setArchives(Array.isArray(items) ? items : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [api]);

  async function handleClick(archive) {
    if (!api) return;
    const taskName = archive.task ? archive.task.name : archive.name;
    onClose();
    try {
      const data = await api.getArchive(archive.name);
      if (data && !data.error) {
        const status = mergeState(data.initialization, data.progress || {}, data.logs);
        dispatch({
          type: 'SET_ARCHIVED_DASHBOARD',
          data: {
            name: archive.name,
            taskName,
            init: data.initialization,
            progress: data.progress || {},
            logs: data.logs,
            status,
          },
        });
        dispatch({ type: 'SET_VIEW', view: 'dashboard' });
      }
    } catch (err) {
      console.error('Failed to load archive:', err);
    }
  }

  function handleDelete(archive) {
    const taskName = archive.task ? archive.task.name : archive.name;
    if (!confirm('Are you sure you want to permanently delete "' + taskName + '"? This cannot be undone.')) {
      return;
    }

    if (onDelete) {
      onDelete(archive.name, () => {
        setArchives(prev => prev.filter(a => a.name !== archive.name));
      });
    } else if (api) {
      api.deleteArchive(archive.name).then(result => {
        if (result && result.success) {
          setArchives(prev => prev.filter(a => a.name !== archive.name));
        }
      }).catch(() => {});
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
