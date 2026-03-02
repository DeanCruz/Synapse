// LogPanelView — log panel rendering with virtual scrolling
// ES module. Accepts DOM element references as parameters.

import { el } from '../utils/dom.js';
import { formatTime } from '../utils/format.js';
import { LEVEL_COLORS, LEVEL_BG_COLORS, LOG_ROW_HEIGHT, LOG_VIRTUAL_THRESHOLD } from '../utils/constants.js';

// Module-scoped virtual scroll state
var _virtualLogState = { filtered: [], active: false };

/**
 * Render log entries from a logs payload.
 * Updates toggle text, renders entries, and checks for permission requests.
 *
 * @param {object} data — logs payload { entries: [...] }
 * @param {object} dom — cached DOM refs (logToggleText, logEntries)
 * @param {string} activeFilter — current filter level ('all' or a level string)
 * @param {number} seenPermissionCount — number of permission entries already seen
 * @returns {number} new seenPermissionCount
 */
export function renderLogs(data, dom, activeFilter, seenPermissionCount) {
  var entries = data.entries || [];

  // Update toggle button text
  if (dom.logToggleText) {
    dom.logToggleText.textContent = 'Logs (' + entries.length + ' entries)';
  }

  renderLogEntries(entries, dom.logEntries, activeFilter);
  return checkPermissionRequests(entries, seenPermissionCount);
}

/**
 * Render filtered log entries into the log panel.
 * Uses virtual scrolling for large entry counts (>LOG_VIRTUAL_THRESHOLD) to avoid DOM bloat.
 *
 * @param {Array} entries — the full list (filtering applied here)
 * @param {HTMLElement} logEntriesEl — the log entries container element
 * @param {string} activeFilter — current filter level ('all' or a level string)
 */
export function renderLogEntries(entries, logEntriesEl, activeFilter) {
  // Update filter button counts on every call
  updateFilterCounts(entries);

  var filtered =
    activeFilter === 'all'
      ? entries
      : entries.filter(function (e) {
          return e.level === activeFilter;
        });

  _virtualLogState.filtered = filtered;

  // Reset scroll position before rendering to avoid stale position from previous filter
  logEntriesEl.scrollTop = 0;

  if (filtered.length > LOG_VIRTUAL_THRESHOLD) {
    renderVirtualLogEntries(filtered, logEntriesEl);
  } else {
    _virtualLogState.active = false;
    logEntriesEl.style.position = '';
    var logFrag = document.createDocumentFragment();

    for (var i = 0; i < filtered.length; i++) {
      logFrag.appendChild(createLogRow(filtered[i]));
    }
    logEntriesEl.replaceChildren(logFrag);
  }

  // Auto-scroll to bottom unless user has scrolled up
  // (caller tracks userScrolledUp state; we always scroll here — the caller
  //  should gate calls or skip auto-scroll based on their own state)
  // Note: we scroll unconditionally here. The setupLogPanel scroll tracker
  // will inform the app whether the user is scrolled up.
}

/**
 * Set up the log panel: toggle expand/collapse, filter buttons, scroll tracking.
 *
 * @param {object} dom — cached DOM refs (logToggle, logPanel, logEntries)
 * @param {object} callbacks
 * @param {Function} callbacks.onFilterChange — callback(level) when a filter button is clicked
 * @param {Function} callbacks.getEntries — returns the current entries array for re-rendering
 */
export function setupLogPanel(dom, callbacks) {
  // Toggle expand/collapse
  if (dom.logToggle) {
    dom.logToggle.addEventListener('click', function () {
      dom.logPanel.classList.toggle('expanded');
    });
  }

  // Filter buttons
  var filterBtns = document.querySelectorAll('.log-filter-btn');
  for (var i = 0; i < filterBtns.length; i++) {
    filterBtns[i].addEventListener('click', function () {
      // Remove active from all
      for (var j = 0; j < filterBtns.length; j++) {
        filterBtns[j].classList.remove('active');
      }
      this.classList.add('active');
      var level = this.getAttribute('data-level');
      if (callbacks.onFilterChange) callbacks.onFilterChange(level);
    });
  }

  // Track user scroll in log entries — returns whether user has scrolled up
  // The app should use this to gate auto-scroll behavior
  var userScrolledUp = false;
  if (dom.logEntries) {
    dom.logEntries.addEventListener('scroll', function () {
      var logEl = dom.logEntries;
      // Consider "scrolled up" if not within 40px of the bottom
      var atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
      userScrolledUp = !atBottom;
    });
  }

  // Start collapsed (CSS handles visibility via max-height + overflow)
  if (dom.logPanel) {
    dom.logPanel.classList.remove('expanded');
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create a single log row element with tinted level badge.
 * @param {object} entry — { timestamp, task_id, agent, level, message }
 * @returns {HTMLElement}
 */
function createLogRow(entry) {
  var row = el('div', { className: 'log-row' });

  // Timestamp
  var ts = el('span', {
    className: 'log-timestamp',
    text: formatTime(entry.timestamp),
  });
  row.appendChild(ts);

  // Task ID badge
  var taskBadge = el('span', {
    className: 'log-task-id',
    text: entry.task_id,
  });
  row.appendChild(taskBadge);

  // Agent label
  var agentLabel = el('span', {
    className: 'log-agent',
    text: entry.agent,
  });
  row.appendChild(agentLabel);

  // Level badge — tinted background, colored text (glass pattern)
  var levelBadge = el('span', {
    className: 'log-level',
    text: entry.level,
    style: {
      backgroundColor: LEVEL_BG_COLORS[entry.level] || LEVEL_BG_COLORS.debug,
      color: LEVEL_COLORS[entry.level] || LEVEL_COLORS.debug,
    },
  });
  row.appendChild(levelBadge);

  // Message
  var msg = el('span', { className: 'log-message', text: entry.message });
  row.appendChild(msg);

  return row;
}

/**
 * Virtual scrolling renderer — only creates DOM nodes for visible rows.
 * Uses a sentinel div for total height and positions a window of visible rows.
 *
 * @param {Array} filtered — the filtered log entries
 * @param {HTMLElement} container — the log entries container element
 */
function renderVirtualLogEntries(filtered, container) {
  _virtualLogState.active = true;
  var totalHeight = filtered.length * LOG_ROW_HEIGHT;

  container.textContent = '';
  container.style.position = 'relative';

  // Height sentinel — gives the container the right scrollable height
  var sentinel = el('div', {
    style: { height: totalHeight + 'px', width: '1px', position: 'absolute', top: '0', left: '0', pointerEvents: 'none' },
  });
  container.appendChild(sentinel);

  // Visible rows container
  var rowsWrap = el('div', {
    style: { position: 'absolute', left: '0', right: '0', top: '0' },
  });
  rowsWrap.id = 'virtual-log-rows';
  container.appendChild(rowsWrap);

  function renderVisibleRows() {
    var scrollTop = container.scrollTop;
    var viewHeight = container.clientHeight;
    var startIdx = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - 5);
    var endIdx = Math.min(filtered.length, Math.ceil((scrollTop + viewHeight) / LOG_ROW_HEIGHT) + 5);

    rowsWrap.textContent = '';
    rowsWrap.style.top = (startIdx * LOG_ROW_HEIGHT) + 'px';

    for (var i = startIdx; i < endIdx; i++) {
      var row = createLogRow(filtered[i]);
      row.style.height = LOG_ROW_HEIGHT + 'px';
      row.style.overflow = 'hidden';
      rowsWrap.appendChild(row);
    }
  }

  renderVisibleRows();

  // Attach scroll handler (remove prior one to avoid accumulation)
  if (container._virtualScrollHandler) {
    container.removeEventListener('scroll', container._virtualScrollHandler);
  }
  container._virtualScrollHandler = renderVisibleRows;
  container.addEventListener('scroll', renderVisibleRows);
}

/**
 * Update filter button text with per-level entry counts.
 * Computes all counts in a single pass over the entries array.
 *
 * @param {Array} entries — the full (unfiltered) entries list
 */
function updateFilterCounts(entries) {
  // Single-pass count by level
  var counts = {};
  var total = entries.length;
  for (var i = 0; i < total; i++) {
    var lvl = entries[i].level;
    counts[lvl] = (counts[lvl] || 0) + 1;
  }

  var filterBtns = document.querySelectorAll('.log-filter-btn');
  for (var j = 0; j < filterBtns.length; j++) {
    var btn = filterBtns[j];
    var level = btn.getAttribute('data-level');

    // Determine the display label and count
    var label, count;
    if (level === 'all') {
      label = 'All';
      count = total;
    } else {
      label = level.charAt(0).toUpperCase() + level.slice(1);
      count = counts[level] || 0;
    }

    // Update button content: label text + count badge span
    btn.textContent = '';
    btn.appendChild(document.createTextNode(label + ' '));
    var badge = el('span', {
      className: 'log-filter-count',
      text: String(count),
    });
    btn.appendChild(badge);
  }
}

/**
 * Check if any new permission-level entries have arrived.
 * Returns the new seenPermissionCount so the caller can track it.
 *
 * @param {Array} entries — the full entries list
 * @param {number} seenCount — current number of permission entries already seen
 * @returns {number} new seenCount
 */
function checkPermissionRequests(entries, seenCount) {
  var permEntries = entries.filter(function (e) { return e.level === 'permission'; });
  // If logs were cleared (new task), reset the counter
  if (permEntries.length < seenCount) {
    seenCount = 0;
  }
  if (permEntries.length > seenCount) {
    seenCount = permEntries.length;
    // Return the new count — the caller is responsible for showing the popup
    // (the latest permission entry is permEntries[permEntries.length - 1])
  }
  return seenCount;
}
