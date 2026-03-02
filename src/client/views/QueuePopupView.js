// QueuePopupView — Floating expandable queue indicator
// ES module. Shows a small icon at bottom-right when there are queued tasks.
// Clicking expands a popup listing the queued tasks with names and status.

/**
 * Render the queue popup floating UI.
 *
 * @param {HTMLElement} containerEl — the #queue-popup-container element
 * @param {Array} queueItems — array of queue summaries from the API
 * @param {object} options
 * @param {Function} options.onTaskClick — callback(queueId) when a queued task is clicked
 */
export function renderQueuePopup(containerEl, queueItems, options) {
  if (!containerEl) return;

  // Hide entirely if no queue items
  if (!queueItems || queueItems.length === 0) {
    containerEl.hidden = true;
    containerEl.textContent = '';
    return;
  }

  containerEl.hidden = false;

  // Check if popup is already rendered and just update the content
  var existing = containerEl.querySelector('.queue-popup-fab');
  var isExpanded = containerEl.classList.contains('expanded');

  containerEl.textContent = '';

  // FAB (floating action button)
  var fab = document.createElement('button');
  fab.className = 'queue-popup-fab';
  fab.title = queueItems.length + ' queued task' + (queueItems.length !== 1 ? 's' : '');
  fab.setAttribute('aria-label', fab.title);

  // Queue icon SVG
  fab.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 18 18" fill="none">' +
      '<rect x="2" y="3" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect x="2" y="7.5" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect x="2" y="12" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
    '</svg>';

  // Badge count
  var badge = document.createElement('span');
  badge.className = 'queue-popup-badge';
  badge.textContent = String(queueItems.length);
  fab.appendChild(badge);

  fab.addEventListener('click', function (e) {
    e.stopPropagation();
    containerEl.classList.toggle('expanded');
  });

  containerEl.appendChild(fab);

  // Expanded panel
  var panel = document.createElement('div');
  panel.className = 'queue-popup-panel';

  var panelHeader = document.createElement('div');
  panelHeader.className = 'queue-popup-header';
  panelHeader.textContent = 'Queued Tasks (' + queueItems.length + ')';
  panel.appendChild(panelHeader);

  var list = document.createElement('div');
  list.className = 'queue-popup-list';

  for (var i = 0; i < queueItems.length; i++) {
    var item = queueItems[i];
    var row = document.createElement('div');
    row.className = 'queue-popup-item';
    row.setAttribute('data-queue-id', item.id);

    // Status dot
    var dot = document.createElement('span');
    var dotClass = item.status === 'in_progress' ? 'in-progress'
      : item.status === 'completed' ? 'completed'
      : item.status === 'error' ? 'error'
      : 'pending';
    dot.className = 'queue-popup-dot ' + dotClass;
    row.appendChild(dot);

    // Task info
    var info = document.createElement('div');
    info.className = 'queue-popup-info';

    var name = document.createElement('span');
    name.className = 'queue-popup-name';
    name.textContent = (item.task && item.task.name) ? item.task.name : item.id;
    info.appendChild(name);

    var meta = document.createElement('span');
    meta.className = 'queue-popup-meta';
    var parts = [];
    if (item.task && item.task.total_tasks) parts.push(item.task.total_tasks + ' tasks');
    if (item.task && item.task.directory) parts.push(item.task.directory);
    meta.textContent = parts.join(' \u00B7 ');
    info.appendChild(meta);

    row.appendChild(info);

    row.addEventListener('click', (function (queueId) {
      return function () {
        if (options && options.onTaskClick) {
          options.onTaskClick(queueId);
        }
      };
    })(item.id));

    list.appendChild(row);
  }

  panel.appendChild(list);
  containerEl.appendChild(panel);

  // Restore expanded state
  if (isExpanded) {
    containerEl.classList.add('expanded');
  }
}

/**
 * Close the queue popup (collapse it).
 * @param {HTMLElement} containerEl
 */
export function closeQueuePopup(containerEl) {
  if (containerEl) {
    containerEl.classList.remove('expanded');
  }
}
