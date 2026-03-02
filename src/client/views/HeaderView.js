// HeaderView — header bar rendering
// ES module. Accepts DOM element references as parameters.

/**
 * Update the header bar with task info and active agent count.
 * @param {object} dom — cached DOM references (taskBadge, taskDirectory, activeCount, headerCenter)
 * @param {object|null} task — active_task from merged state
 * @param {Array} agents — merged agents list
 */
export function updateHeader(dom, task, agents) {
  if (!task) {
    // Empty state
    if (dom.headerCenter) dom.headerCenter.hidden = false;
    if (dom.taskBadge) {
      dom.taskBadge.textContent = 'Waiting for dispatch';
      dom.taskBadge.hidden = false;
    }
    if (dom.taskDirectory) dom.taskDirectory.hidden = true;
    dom.activeCount.textContent = '0 active';
    return;
  }

  if (dom.headerCenter) dom.headerCenter.hidden = false;

  // Task name badge
  dom.taskBadge.textContent = task.name || '\u2014';
  dom.taskBadge.hidden = false;
  dom.taskBadge._task = task; // stash for popup

  // Directory display
  if (dom.taskDirectory) {
    if (task.directory) {
      dom.taskDirectory.textContent = task.directory;
      dom.taskDirectory.hidden = false;
    } else {
      dom.taskDirectory.hidden = true;
    }
  }

  // Active count
  var inProgressCount = 0;
  for (var i = 0; i < agents.length; i++) {
    if (agents[i].status === 'in_progress') inProgressCount++;
  }
  dom.activeCount.textContent = inProgressCount + ' active';
}

/**
 * Set up the task badge click handler for showing task details.
 * @param {HTMLElement} taskBadgeEl — the task badge element
 * @param {Function} onClickFn — callback receiving the stashed task object
 */
export function setupTaskBadge(taskBadgeEl, onClickFn) {
  taskBadgeEl.addEventListener('click', function () {
    var task = taskBadgeEl._task;
    if (task) onClickFn(task);
  });
}

/**
 * Set up the header title as a clickable "home" button.
 * @param {HTMLElement} titleEl — the .header-title element
 * @param {Function} onClickFn — callback when title is clicked
 */
export function setupTitleClick(titleEl, onClickFn) {
  if (!titleEl) return;
  titleEl.addEventListener('click', onClickFn);
}
