// SwarmBuilderView — Full swarm builder/editor view
// ES module. Replaces the empty state when creating a new swarm manually.

import { el } from '../utils/dom.js';
import { showTaskEditorModal } from './modals/TaskEditorModal.js';

/**
 * Render the swarm builder into a container.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container — where to render
 * @param {string} opts.dashboardId — target dashboard
 * @param {object} [opts.initData] — existing initialization data to edit
 * @param {function} opts.onLaunch — callback(initData) when user clicks Launch
 * @param {function} opts.onCancel — callback() when user cancels
 */
export function renderSwarmBuilder(opts) {
  var container = opts.container;
  container.textContent = '';
  container.className = 'swarm-builder';

  var api = window.electronAPI;
  var dashboardId = opts.dashboardId;

  // Current state
  var swarmName = (opts.initData && opts.initData.task) ? opts.initData.task.name : '';
  var swarmType = (opts.initData && opts.initData.task) ? (opts.initData.task.type || 'Waves') : 'Waves';
  var agents = (opts.initData && opts.initData.agents) ? opts.initData.agents.slice() : [];
  var waves = (opts.initData && opts.initData.waves) ? opts.initData.waves.slice() : [];

  // --- Header ---
  var header = el('div', { className: 'swarm-builder-header' });
  header.appendChild(el('h2', { text: 'Create Swarm', className: 'swarm-builder-title' }));

  // Name input
  var nameRow = el('div', { className: 'swarm-builder-name-row' });
  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'swarm-builder-name-input';
  nameInput.placeholder = 'Swarm name...';
  nameInput.value = swarmName;
  nameRow.appendChild(nameInput);

  // Type toggle
  var typeBtn = el('button', { className: 'swarm-builder-type-btn', text: swarmType });
  typeBtn.addEventListener('click', function () {
    swarmType = swarmType === 'Waves' ? 'Chains' : 'Waves';
    typeBtn.textContent = swarmType;
  });
  nameRow.appendChild(typeBtn);
  header.appendChild(nameRow);
  container.appendChild(header);

  // --- Task List by Wave ---
  var taskListContainer = el('div', { className: 'swarm-builder-tasks' });
  container.appendChild(taskListContainer);

  function renderTaskList() {
    taskListContainer.textContent = '';

    if (agents.length === 0) {
      var emptyMsg = el('div', { className: 'swarm-builder-empty' });
      emptyMsg.appendChild(el('div', { text: 'No tasks yet', className: 'swarm-builder-empty-title' }));
      emptyMsg.appendChild(el('div', { text: 'Add tasks to build your swarm plan', className: 'swarm-builder-empty-sub' }));
      taskListContainer.appendChild(emptyMsg);
      return;
    }

    // Group by wave
    var waveGroups = {};
    for (var i = 0; i < agents.length; i++) {
      var w = agents[i].wave;
      if (!waveGroups[w]) waveGroups[w] = [];
      waveGroups[w].push(agents[i]);
    }

    var waveIds = Object.keys(waveGroups).map(Number).sort(function (a, b) { return a - b; });

    for (var wi = 0; wi < waveIds.length; wi++) {
      var waveId = waveIds[wi];
      var waveInfo = null;
      for (var wj = 0; wj < waves.length; wj++) {
        if (waves[wj].id === waveId) { waveInfo = waves[wj]; break; }
      }

      var waveSection = el('div', { className: 'swarm-builder-wave' });
      var waveHeader = el('div', { className: 'swarm-builder-wave-header' });
      waveHeader.appendChild(el('span', { text: waveInfo ? waveInfo.name : ('Wave ' + waveId), className: 'swarm-builder-wave-title' }));
      waveHeader.appendChild(el('span', { text: waveGroups[waveId].length + ' tasks', className: 'swarm-builder-wave-count' }));
      waveSection.appendChild(waveHeader);

      for (var ti = 0; ti < waveGroups[waveId].length; ti++) {
        (function (agent) {
          var card = el('div', { className: 'swarm-builder-task-card' });

          var cardLeft = el('div', { className: 'swarm-builder-task-left' });
          cardLeft.appendChild(el('span', { text: agent.id, className: 'swarm-builder-task-id' }));
          cardLeft.appendChild(el('span', { text: agent.title, className: 'swarm-builder-task-title' }));
          if (agent.depends_on && agent.depends_on.length > 0) {
            cardLeft.appendChild(el('span', { text: '→ ' + agent.depends_on.join(', '), className: 'swarm-builder-task-deps' }));
          }
          card.appendChild(cardLeft);

          var cardRight = el('div', { className: 'swarm-builder-task-actions' });

          var editBtn = el('button', { className: 'swarm-builder-task-btn', text: '✎' });
          editBtn.title = 'Edit';
          editBtn.addEventListener('click', function () {
            showTaskEditorModal({
              dashboardId: dashboardId,
              task: agent,
              existingAgents: agents,
              waves: waves,
              onSave: function (taskData) {
                handleTaskUpdate(agent.id, taskData);
              },
            });
          });

          var delBtn = el('button', { className: 'swarm-builder-task-btn swarm-builder-task-btn-del', text: '✕' });
          delBtn.title = 'Remove';
          delBtn.addEventListener('click', function () {
            agents = agents.filter(function (a) { return a.id !== agent.id; });
            // Clean up deps
            for (var di = 0; di < agents.length; di++) {
              if (agents[di].depends_on) {
                agents[di].depends_on = agents[di].depends_on.filter(function (d) { return d !== agent.id; });
              }
            }
            recalcWaves();
            renderTaskList();
          });

          cardRight.appendChild(editBtn);
          cardRight.appendChild(delBtn);
          card.appendChild(cardRight);
          waveSection.appendChild(card);
        })(waveGroups[waveId][ti]);
      }

      taskListContainer.appendChild(waveSection);
    }
  }

  // --- Controls ---
  var controls = el('div', { className: 'swarm-builder-controls' });

  var addTaskBtn = el('button', { className: 'project-pick-btn', text: '+ Add Task' });
  addTaskBtn.addEventListener('click', function () {
    var defaultWave = waves.length > 0 ? waves[waves.length - 1].id : 1;
    showTaskEditorModal({
      dashboardId: dashboardId,
      task: null,
      existingAgents: agents,
      waves: waves.length > 0 ? waves : [{ id: 1, name: 'Wave 1', total: 0 }],
      onSave: function (taskData) {
        handleNewTask(taskData);
      },
    });
  });
  controls.appendChild(addTaskBtn);

  var cancelBtn = el('button', { className: 'settings-custom-reset-btn', text: 'Cancel' });
  cancelBtn.addEventListener('click', function () {
    if (opts.onCancel) opts.onCancel();
  });
  controls.appendChild(cancelBtn);

  var launchBtn = el('button', { className: 'project-pick-btn swarm-builder-launch-btn', text: 'Launch Swarm' });
  launchBtn.addEventListener('click', function () {
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    if (agents.length === 0) return;

    var initData = {
      task: {
        name: name,
        type: swarmType,
        directory: '.',
        prompt: '',
        project: '',
        created: new Date().toISOString(),
        total_tasks: agents.length,
        total_waves: waves.length,
      },
      agents: agents,
      waves: waves,
      chains: [],
      history: [],
    };

    if (opts.onLaunch) opts.onLaunch(initData);
  });
  controls.appendChild(launchBtn);

  container.appendChild(controls);

  // --- Helpers ---
  function handleNewTask(taskData) {
    if (taskData._newWaveName) {
      var maxId = 0;
      for (var i = 0; i < waves.length; i++) {
        if (waves[i].id > maxId) maxId = waves[i].id;
      }
      var newId = maxId + 1;
      waves.push({ id: newId, name: taskData._newWaveName, total: 0 });
      taskData.wave = newId;
    }
    if (!taskData.wave && waves.length > 0) {
      taskData.wave = waves[0].id;
    } else if (!taskData.wave) {
      taskData.wave = 1;
      waves.push({ id: 1, name: 'Wave 1', total: 0 });
    }

    // Generate ID
    var maxSub = 0;
    for (var j = 0; j < agents.length; j++) {
      var parts = agents[j].id.split('.');
      if (parseInt(parts[0], 10) === taskData.wave) {
        var sub = parseInt(parts[1], 10);
        if (sub > maxSub) maxSub = sub;
      }
    }
    taskData.id = taskData.wave + '.' + (maxSub + 1);
    delete taskData._newWaveName;

    agents.push(taskData);
    recalcWaves();
    renderTaskList();
  }

  function handleTaskUpdate(oldId, taskData) {
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].id === oldId) {
        taskData.id = oldId;
        delete taskData._newWaveName;
        agents[i] = taskData;
        break;
      }
    }
    recalcWaves();
    renderTaskList();
  }

  function recalcWaves() {
    var counts = {};
    for (var i = 0; i < agents.length; i++) {
      var w = agents[i].wave;
      counts[w] = (counts[w] || 0) + 1;
    }
    for (var j = 0; j < waves.length; j++) {
      waves[j].total = counts[waves[j].id] || 0;
    }
    waves = waves.filter(function (w) { return w.total > 0; });
  }

  renderTaskList();
}
