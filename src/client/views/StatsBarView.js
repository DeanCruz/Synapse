// StatsBarView — stats cards rendering + filtering + progress bar
// ES module. Accepts DOM element references as parameters.

import { STATUS_COLORS } from '../utils/constants.js';
import { formatElapsed, calcDuration } from '../utils/format.js';

/**
 * Update all 6 stat cards with current task/agent data.
 * @param {object} dom — cached DOM refs (statTotal, statCompleted, statInProgress, statFailed, statPending, statElapsed, logCompleteBadge)
 * @param {object} task — active_task from merged state
 * @param {Array} agents — merged agents list
 * @param {boolean} allDone — whether all tasks are complete (completed + failed >= total)
 */
export function updateStats(dom, task, agents, allDone) {
  var inProgressCount = 0;
  for (var i = 0; i < agents.length; i++) {
    if (agents[i].status === 'in_progress') inProgressCount++;
  }

  dom.statTotal.textContent = task.total_tasks;
  dom.statCompleted.textContent = task.completed_tasks;
  dom.statCompleted.style.color = STATUS_COLORS.completed;
  dom.statInProgress.textContent = inProgressCount;
  dom.statInProgress.style.color = STATUS_COLORS.in_progress;
  dom.statFailed.textContent = task.failed_tasks;
  dom.statFailed.style.color = task.failed_tasks > 0 ? STATUS_COLORS.failed : '';

  var pendingCount =
    task.total_tasks - task.completed_tasks - inProgressCount - task.failed_tasks;
  dom.statPending.textContent = Math.max(0, pendingCount);
  dom.statPending.style.color = STATUS_COLORS.pending;

  // Elapsed — use started_at as primary, task.created as fallback.
  // If completed_at is set, the task is done: freeze at final duration.
  // While still running, show a live ticker from started_at (or created).
  var elapsedStart = task.started_at || task.created;
  if (allDone && elapsedStart && task.completed_at) {
    dom.statElapsed.textContent = calcDuration(elapsedStart, task.completed_at);
  } else if (elapsedStart) {
    dom.statElapsed.textContent = formatElapsed(elapsedStart);
  }

  // Complete badge on log panel
  if (dom.logCompleteBadge) {
    dom.logCompleteBadge.hidden = !allDone;
  }
}

/**
 * Update the progress bar width and color.
 * @param {HTMLElement} progressBarEl — the progress bar element
 * @param {number} completedTasks — number of completed tasks
 * @param {number} totalTasks — total number of tasks
 * @param {boolean} allDone — whether all tasks are complete
 */
export function updateProgressBar(progressBarEl, completedTasks, totalTasks, allDone) {
  var pct = Math.min(100, Math.round((completedTasks / (totalTasks || 1)) * 100));
  progressBarEl.style.width = pct + '%';
  progressBarEl.style.background = allDone
    ? '#34d399'
    : 'linear-gradient(135deg, #667eea, #9b7cf0)';
}

/**
 * Set up click handlers for stat card filtering.
 * Clicking a stat card filters the pipeline to show only agents with that status.
 * Clicking the same card again deselects (filterStatus becomes null).
 *
 * @param {object} dom — cached DOM refs (statTotal, statCompleted, statInProgress, statFailed, statPending)
 * @param {Function} onFilterChange — callback receiving filterStatus (null for all, or a status string)
 * @returns {Function} cleanup function to remove event listeners
 */
export function setupStatCards(dom, onFilterChange) {
  var cards = [
    { node: dom.statTotal.parentElement,      filter: null },
    { node: dom.statCompleted.parentElement,  filter: 'completed' },
    { node: dom.statInProgress.parentElement, filter: 'in_progress' },
    { node: dom.statFailed.parentElement,     filter: 'failed' },
    { node: dom.statPending.parentElement,    filter: 'pending' },
  ];

  var activeCardNode = null;
  var handlers = [];

  for (var i = 0; i < cards.length; i++) {
    (function (card) {
      var handler = function () {
        var isSame = activeCardNode === card.node;

        // Toggle off if clicking the same card
        activeCardNode = isSame ? null : card.node;
        var filterStatus = isSame ? null : card.filter;

        // Update active class on all cards
        for (var j = 0; j < cards.length; j++) {
          cards[j].node.classList.toggle('stat-active', cards[j].node === activeCardNode);
        }

        onFilterChange(filterStatus);
      };

      card.node.addEventListener('click', handler);
      handlers.push({ node: card.node, handler: handler });
    })(cards[i]);
  }

  // Return cleanup function
  return function cleanup() {
    for (var k = 0; k < handlers.length; k++) {
      handlers[k].node.removeEventListener('click', handlers[k].handler);
    }
  };
}
