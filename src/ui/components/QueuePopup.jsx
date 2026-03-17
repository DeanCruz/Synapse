// QueuePopup — floating FAB with expandable list of queued tasks
// Replaces QueuePopupView.js

import React, { useState, useEffect, useRef } from 'react';

/**
 * @param {Array}    props.queueItems  - array of queue summaries from the API
 * @param {Function} props.onItemClick - callback(queueId) when a queued task row is clicked
 */
export default function QueuePopup({ queueItems, onItemClick }) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef(null);

  const items = queueItems || [];

  // Collapse when clicking outside
  useEffect(() => {
    if (!expanded) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setExpanded(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [expanded]);

  if (items.length === 0) return null;

  const fabTitle = `${items.length} queued task${items.length !== 1 ? 's' : ''}`;

  return (
    <div
      className={`queue-popup-container${expanded ? ' expanded' : ''}`}
      ref={containerRef}
    >
      {/* Floating action button */}
      <button
        className="queue-fab"
        title={fabTitle}
        aria-label={fabTitle}
        onClick={e => {
          e.stopPropagation();
          setExpanded(v => !v);
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2" y="3"   width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="2" y="7.5" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="2" y="12"  width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="queue-popup-badge">{items.length}</span>
      </button>

      {/* Expandable panel */}
      {expanded && (
        <div className="queue-popup">
          <div className="queue-popup-header">Queued Tasks ({items.length})</div>
          <div className="queue-popup-list">
            {items.map(item => {
              const dotClass = item.status === 'in_progress' ? 'in-progress'
                : item.status === 'completed' ? 'completed'
                : item.status === 'error'       ? 'error'
                : 'pending';

              const nameParts = [];
              if (item.task && item.task.total_tasks) nameParts.push(`${item.task.total_tasks} tasks`);
              if (item.task && item.task.directory)   nameParts.push(item.task.directory);

              return (
                <div
                  key={item.id}
                  className="queue-popup-item"
                  data-queue-id={item.id}
                  onClick={() => onItemClick && onItemClick(item.id)}
                >
                  <span className={`queue-popup-dot ${dotClass}`} />
                  <div className="queue-popup-info">
                    <span className="queue-popup-name">
                      {(item.task && item.task.name) ? item.task.name : item.id}
                    </span>
                    <span className="queue-popup-meta">{nameParts.join(' \u00B7 ')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
