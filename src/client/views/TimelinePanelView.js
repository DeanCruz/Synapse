// TimelinePanelView — timeline panel rendering
// ES module. Accepts DOM element references as parameters.

import { el } from '../utils/dom.js';
import { formatTime, calcDuration } from '../utils/format.js';
import { TIMELINE_COLORS } from '../utils/constants.js';

/**
 * Rebuild the timeline panel body from the latest status data.
 * Called every time renderStatus fires so the panel stays live.
 *
 * @param {object} data — merged state: { active_task, agents, history }
 * @param {HTMLElement} panelBodyEl — the timeline panel body element
 * @param {boolean} isExpanded — whether the timeline panel is currently expanded
 */
export function renderTimelinePanel(data, panelBodyEl, isExpanded) {
  if (!panelBodyEl) return;
  var frag = document.createDocumentFragment();

  var task    = data.active_task;
  var agents  = data.agents  || [];
  var history = data.history || [];

  // Build sorted event list for current task
  var events = [];
  if (task) {
    if (task.started_at) {
      events.push({ time: task.started_at, status: 'task_start', label: 'Task started', title: task.name });
    }
    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (a.started_at) {
        events.push({ time: a.started_at, status: 'in_progress', label: 'Agent started', title: a.title, id: a.id });
      }
      if (a.completed_at) {
        events.push({
          time: a.completed_at,
          status: a.status,
          label: a.status === 'failed' ? 'Agent failed' : 'Agent completed',
          title: a.title,
          id: a.id,
        });
      }
    }
    if (task.completed_at) {
      events.push({ time: task.completed_at, status: 'task_end', label: 'Task completed', title: task.name });
    }
    events.sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
  }

  if (events.length > 0) {
    var lbl = el('div', { className: 'timeline-section-label', text: 'Current Task' });
    frag.appendChild(lbl);
    for (var j = 0; j < events.length; j++) {
      frag.appendChild(createTimelineEntry(events[j]));
    }
  }

  if (history.length > 0) {
    var divider = el('div', { className: 'timeline-divider' });
    frag.appendChild(divider);
    var histLbl = el('div', { className: 'timeline-section-label', text: 'History' });
    frag.appendChild(histLbl);
    for (var k = history.length - 1; k >= 0; k--) {
      frag.appendChild(createHistoryEntry(history[k]));
    }
  }

  if (events.length === 0 && history.length === 0) {
    var empty = el('div', { className: 'timeline-section-label', text: 'No events yet.' });
    empty.style.textAlign = 'center';
    empty.style.marginLeft = '0';
    empty.style.padding = '24px 0';
    frag.appendChild(empty);
  }

  // Atomic DOM swap
  panelBodyEl.replaceChildren(frag);

  // Auto-scroll timeline to bottom to show latest events
  if (isExpanded && events.length > 0) {
    requestAnimationFrame(function () {
      panelBodyEl.scrollTop = panelBodyEl.scrollHeight;
    });
  }
}

/**
 * Set up the timeline card toggle — clicking elapsed card opens/closes the panel.
 *
 * @param {HTMLElement} elapsedParent — the elapsed stat card's parent element
 * @param {HTMLElement} timelinePanel — the timeline panel element
 * @param {HTMLElement} closeBtn — the timeline close button element
 */
export function setupTimelineCard(elapsedParent, timelinePanel, closeBtn) {
  elapsedParent.addEventListener('click', function () {
    timelinePanel.classList.toggle('expanded');
  });
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      timelinePanel.classList.remove('expanded');
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create a single timeline event entry element.
 * @param {object} event — { time, status, label, title, id }
 * @returns {HTMLElement}
 */
function createTimelineEntry(event) {
  var entry = el('div', { className: 'timeline-entry' });

  var dot = el('span', {
    className: 'timeline-dot',
    style: { backgroundColor: TIMELINE_COLORS[event.status] || TIMELINE_COLORS.pending },
  });

  var content = el('div',  { className: 'timeline-content' });
  var timeEl  = el('span', { className: 'timeline-time',  text: formatTime(event.time) });
  var eventEl = el('span', { className: 'timeline-event', text: event.label });
  content.appendChild(timeEl);
  content.appendChild(eventEl);

  if (event.title) {
    var titleEl = el('span', {
      className: 'timeline-agent-title',
      text: (event.id ? '[' + event.id + '] ' : '') + event.title,
    });
    content.appendChild(titleEl);
  }

  entry.appendChild(dot);
  entry.appendChild(content);
  return entry;
}

/**
 * Create a single history entry element.
 * @param {object} histTask — { name, overall_status, started_at, completed_at }
 * @returns {HTMLElement}
 */
function createHistoryEntry(histTask) {
  var entry = el('div', { className: 'timeline-history-entry' });

  var color = histTask.overall_status === 'completed'
    ? '#34d399'
    : histTask.overall_status === 'failed'
      ? '#ef4444'
      : '#6E6E73';

  var dot  = el('span', { className: 'timeline-dot', style: { backgroundColor: color } });
  var name = el('span', { className: 'timeline-history-name', text: histTask.name });
  var meta = el('span', {
    className: 'timeline-history-meta',
    text: histTask.started_at && histTask.completed_at
      ? calcDuration(histTask.started_at, histTask.completed_at)
      : histTask.overall_status,
  });

  entry.appendChild(dot);
  entry.appendChild(name);
  entry.appendChild(meta);
  return entry;
}
