// TaskEditorModal — Create/edit task form
// ES module. Uses createModalPopup from ModalFactory.js.

import { el } from '../../utils/dom.js';
import { createModalPopup } from './ModalFactory.js';

/**
 * Show the task editor modal for creating or editing a task.
 *
 * @param {object} opts
 * @param {string} opts.dashboardId — current dashboard
 * @param {object} [opts.task] — existing task to edit (null for create)
 * @param {object[]} [opts.existingAgents] — all agents for dependency picker
 * @param {object[]} [opts.waves] — existing waves
 * @param {function} opts.onSave — callback(taskData) when saved
 */
export function showTaskEditorModal(opts) {
  var isEdit = !!opts.task;
  var popup = createModalPopup('task-editor-overlay', isEdit ? 'Edit Task' : 'Add Task');
  var body = popup.body;

  var api = window.electronAPI;

  // --- Form ---
  var form = el('div', { className: 'task-editor-form' });

  // Title
  var titleRow = el('div', { className: 'settings-app-row' });
  titleRow.appendChild(el('label', { className: 'settings-app-label', text: 'Title' }));
  var titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'settings-app-input';
  titleInput.placeholder = 'Task title';
  titleInput.value = isEdit ? opts.task.title : '';
  titleRow.appendChild(titleInput);
  form.appendChild(titleRow);

  // Wave
  var waveRow = el('div', { className: 'settings-app-row' });
  waveRow.appendChild(el('label', { className: 'settings-app-label', text: 'Wave' }));
  var waveSelect = document.createElement('select');
  waveSelect.className = 'settings-app-input';
  var waves = opts.waves || [];
  for (var w = 0; w < waves.length; w++) {
    var wOpt = document.createElement('option');
    wOpt.value = waves[w].id;
    wOpt.textContent = waves[w].name;
    if (isEdit && opts.task.wave === waves[w].id) wOpt.selected = true;
    waveSelect.appendChild(wOpt);
  }
  // "New wave" option
  var newWaveOpt = document.createElement('option');
  newWaveOpt.value = '__new__';
  newWaveOpt.textContent = '+ New Wave';
  waveSelect.appendChild(newWaveOpt);
  waveRow.appendChild(waveSelect);
  form.appendChild(waveRow);

  // New wave name (hidden by default)
  var newWaveRow = el('div', { className: 'settings-app-row', style: { display: 'none' } });
  newWaveRow.appendChild(el('label', { className: 'settings-app-label', text: 'Wave Name' }));
  var newWaveInput = document.createElement('input');
  newWaveInput.type = 'text';
  newWaveInput.className = 'settings-app-input';
  newWaveInput.placeholder = 'e.g. Wave 3 — Integration';
  newWaveRow.appendChild(newWaveInput);
  form.appendChild(newWaveRow);

  waveSelect.addEventListener('change', function () {
    newWaveRow.style.display = waveSelect.value === '__new__' ? '' : 'none';
  });

  // Layer
  var layerRow = el('div', { className: 'settings-app-row' });
  layerRow.appendChild(el('label', { className: 'settings-app-label', text: 'Layer' }));
  var layerInput = document.createElement('input');
  layerInput.type = 'text';
  layerInput.className = 'settings-app-input';
  layerInput.placeholder = 'e.g. service, ui, test';
  layerInput.value = isEdit ? (opts.task.layer || '') : '';
  layerRow.appendChild(layerInput);
  form.appendChild(layerRow);

  // Directory
  var dirRow = el('div', { className: 'settings-app-row' });
  dirRow.appendChild(el('label', { className: 'settings-app-label', text: 'Directory' }));
  var dirInput = document.createElement('input');
  dirInput.type = 'text';
  dirInput.className = 'settings-app-input';
  dirInput.placeholder = 'e.g. src/services';
  dirInput.value = isEdit ? (opts.task.directory || '') : '';
  dirRow.appendChild(dirInput);
  form.appendChild(dirRow);

  // Dependencies
  var depsRow = el('div', { className: 'settings-app-row' });
  depsRow.appendChild(el('label', { className: 'settings-app-label', text: 'Depends On' }));
  var depsContainer = el('div', { className: 'task-editor-deps' });

  var existingAgents = opts.existingAgents || [];
  var currentDeps = isEdit ? (opts.task.depends_on || []) : [];
  var depCheckboxes = [];

  for (var a = 0; a < existingAgents.length; a++) {
    var agent = existingAgents[a];
    if (isEdit && agent.id === opts.task.id) continue; // Can't depend on self
    var depItem = el('label', { className: 'task-editor-dep-item' });
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = agent.id;
    cb.checked = currentDeps.indexOf(agent.id) !== -1;
    depItem.appendChild(cb);
    depItem.appendChild(document.createTextNode(' ' + agent.id + ': ' + agent.title));
    depsContainer.appendChild(depItem);
    depCheckboxes.push(cb);
  }

  depsRow.appendChild(depsContainer);
  form.appendChild(depsRow);

  // Description (task prompt for worker)
  var descRow = el('div', { className: 'settings-app-row' });
  descRow.appendChild(el('label', { className: 'settings-app-label', text: 'Description' }));
  var descArea = document.createElement('textarea');
  descArea.className = 'settings-app-input task-editor-textarea';
  descArea.placeholder = 'Detailed task description for the worker agent...';
  descArea.rows = 6;
  descArea.value = isEdit ? (opts.task.description || '') : '';
  descRow.appendChild(descArea);
  form.appendChild(descRow);

  body.appendChild(form);

  // --- Save / Cancel ---
  var btnRow = el('div', { className: 'task-editor-buttons' });

  var cancelBtn = el('button', { className: 'settings-custom-reset-btn', text: 'Cancel' });
  cancelBtn.addEventListener('click', function () {
    popup.overlay.remove();
  });

  var saveBtn = el('button', { className: 'project-pick-btn', text: isEdit ? 'Save Changes' : 'Add Task' });
  saveBtn.addEventListener('click', function () {
    var title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }

    var selectedDeps = [];
    for (var d = 0; d < depCheckboxes.length; d++) {
      if (depCheckboxes[d].checked) selectedDeps.push(depCheckboxes[d].value);
    }

    var waveVal = waveSelect.value;
    var waveNum;
    var newWaveName = null;
    if (waveVal === '__new__') {
      // Will be resolved after addWave
      newWaveName = newWaveInput.value.trim() || 'New Wave';
      waveNum = null;
    } else {
      waveNum = parseInt(waveVal, 10);
    }

    var taskData = {
      title: title,
      wave: waveNum,
      layer: layerInput.value.trim(),
      directory: dirInput.value.trim() || '.',
      depends_on: selectedDeps,
      description: descArea.value.trim(),
      _newWaveName: newWaveName, // Signal to caller to create wave first
    };

    if (isEdit) {
      taskData.id = opts.task.id;
    }

    popup.overlay.remove();
    if (opts.onSave) opts.onSave(taskData);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  body.appendChild(btnRow);

  document.body.appendChild(popup.overlay);
  titleInput.focus();
}
