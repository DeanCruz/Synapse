// ArchiveModal — Renders list of archived tasks with selection callback + delete
// ES module. Uses createModalPopup factory from ModalFactory.js.
// Does NOT call loadArchivedTask directly — uses onSelect callback.

import { el } from '../../utils/dom.js';
import { createModalPopup } from './ModalFactory.js';
import { showConfirmModal } from './ConfirmModal.js';

/**
 * Show the archive popup modal with a list of archived task snapshots.
 * Each card has a trash icon on the right that triggers a delete confirmation.
 * @param {Array} archives — array of archive objects, each with: name, task (optional { name, type }), agentCount
 * @param {function} onSelect — callback invoked with archive name: onSelect(archiveName)
 */
export function showArchivePopup(archives, onSelect) {
  var popup = createModalPopup('archive-list-overlay', 'Archived Tasks');
  var body = popup.body;

  if (archives.length === 0) {
    body.appendChild(el('div', { className: 'history-empty', text: 'No archived tasks' }));
  } else {
    for (var i = 0; i < archives.length; i++) {
      (function (archive) {
        var entry = el('div', { className: 'history-entry' });
        entry.setAttribute('data-name', archive.name);

        var dotColor = '#34d399';
        var dot = el('span', { className: 'history-entry-dot', style: { backgroundColor: dotColor } });
        entry.appendChild(dot);

        var content = el('div', { className: 'history-entry-content' });
        var taskName = archive.task ? archive.task.name : archive.name;
        content.appendChild(el('div', { className: 'history-entry-name', text: taskName }));

        var meta = el('div', { className: 'history-entry-meta' });
        if (archive.task && archive.task.type) {
          meta.appendChild(el('span', {
            className: 'history-entry-badge',
            text: archive.task.type,
            style: { backgroundColor: 'rgba(102,126,234,0.1)', color: 'rgba(102,126,234,0.8)' },
          }));
        }
        meta.appendChild(el('span', {
          className: 'history-entry-badge',
          text: archive.agentCount + ' agents',
          style: { backgroundColor: 'rgba(155,124,240,0.1)', color: '#9b7cf0' },
        }));
        // Date from folder name (YYYY-MM-DD_name -> YYYY-MM-DD)
        var dateStr = archive.name.slice(0, 10);
        meta.appendChild(el('span', { className: 'history-entry-date', text: dateStr }));
        content.appendChild(meta);

        entry.appendChild(content);

        // Trash icon button
        var trashBtn = el('button', { className: 'archive-trash-btn', text: '\uD83D\uDDD1' });
        trashBtn.setAttribute('title', 'Delete archive');
        trashBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          showConfirmModal(
            'Delete Archive',
            'Are you sure you want to permanently delete "' + taskName + '"? This cannot be undone.',
            function () {
              fetch('/api/archives/' + encodeURIComponent(archive.name), { method: 'DELETE' })
                .then(function (res) { return res.json(); })
                .then(function (data) {
                  if (data.success) {
                    entry.remove();
                    // If no entries remain, show empty state
                    if (body.querySelectorAll('.history-entry').length === 0) {
                      body.innerHTML = '';
                      body.appendChild(el('div', { className: 'history-empty', text: 'No archived tasks' }));
                    }
                  }
                });
            }
          );
        });
        entry.appendChild(trashBtn);

        entry.addEventListener('click', function () {
          popup.overlay.remove();
          if (onSelect) onSelect(archive.name);
        });

        body.appendChild(entry);
      })(archives[i]);
    }
  }

  document.body.appendChild(popup.overlay);
}
