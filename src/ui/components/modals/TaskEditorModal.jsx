// TaskEditorModal — Create or edit a task for the swarm builder
// Form: title, wave, layer, directory, dependencies, description.

import React, { useState } from 'react';
import Modal from './Modal.jsx';

export default function TaskEditorModal({ onClose, onSave, agents, waves, editTask }) {
  const isEdit = !!editTask;

  const [title, setTitle] = useState(isEdit ? (editTask.title || '') : '');
  const [selectedWave, setSelectedWave] = useState(
    isEdit ? String(editTask.wave) : (waves && waves.length > 0 ? String(waves[0].id) : '1')
  );
  const [newWaveName, setNewWaveName] = useState('');
  const [layer, setLayer] = useState(isEdit ? (editTask.layer || '') : '');
  const [directory, setDirectory] = useState(isEdit ? (editTask.directory || '') : '');
  const [selectedDeps, setSelectedDeps] = useState(
    isEdit ? (editTask.depends_on || []) : []
  );
  const [description, setDescription] = useState(isEdit ? (editTask.description || '') : '');

  const isNewWave = selectedWave === '__new__';

  function toggleDep(id) {
    setSelectedDeps(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  }

  function handleSave() {
    if (!title.trim()) return;
    let waveNum = null;
    let resolvedNewWaveName = null;

    if (isNewWave) {
      resolvedNewWaveName = newWaveName.trim() || 'New Wave';
    } else {
      waveNum = parseInt(selectedWave, 10);
    }

    const taskData = {
      title: title.trim(),
      wave: waveNum,
      layer: layer.trim(),
      directory: directory.trim() || '.',
      depends_on: selectedDeps,
      description: description.trim(),
      _newWaveName: resolvedNewWaveName,
    };

    if (isEdit) taskData.id = editTask.id;

    if (onSave) onSave(taskData);
    onClose();
  }

  const availableAgents = (agents || []).filter(a => !isEdit || a.id !== editTask.id);

  return (
    <Modal title={isEdit ? 'Edit Task' : 'Add Task'} onClose={onClose}>
      <div className="task-editor-form">
        {/* Title */}
        <div className="settings-app-row">
          <label className="settings-app-label">Title</label>
          <input
            type="text"
            className="settings-app-input"
            placeholder="Task title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        {/* Wave */}
        <div className="settings-app-row">
          <label className="settings-app-label">Wave</label>
          <select
            className="settings-app-input"
            value={selectedWave}
            onChange={e => setSelectedWave(e.target.value)}
          >
            {(waves || []).map(w => (
              <option key={w.id} value={String(w.id)}>{w.name}</option>
            ))}
            <option value="__new__">+ New Wave</option>
          </select>
        </div>

        {/* New wave name (shown when + New Wave selected) */}
        {isNewWave && (
          <div className="settings-app-row">
            <label className="settings-app-label">Wave Name</label>
            <input
              type="text"
              className="settings-app-input"
              placeholder="e.g. Wave 3 — Integration"
              value={newWaveName}
              onChange={e => setNewWaveName(e.target.value)}
            />
          </div>
        )}

        {/* Layer */}
        <div className="settings-app-row">
          <label className="settings-app-label">Layer</label>
          <input
            type="text"
            className="settings-app-input"
            placeholder="e.g. service, ui, test"
            value={layer}
            onChange={e => setLayer(e.target.value)}
          />
        </div>

        {/* Directory */}
        <div className="settings-app-row">
          <label className="settings-app-label">Directory</label>
          <input
            type="text"
            className="settings-app-input"
            placeholder="e.g. src/services"
            value={directory}
            onChange={e => setDirectory(e.target.value)}
          />
        </div>

        {/* Dependencies */}
        <div className="settings-app-row">
          <label className="settings-app-label">Depends On</label>
          <div className="task-editor-deps">
            {availableAgents.length === 0 ? (
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No other tasks</span>
            ) : (
              availableAgents.map(agent => (
                <label key={agent.id} className="task-editor-dep-item">
                  <input
                    type="checkbox"
                    value={agent.id}
                    checked={selectedDeps.includes(agent.id)}
                    onChange={() => toggleDep(agent.id)}
                  />
                  {' ' + agent.id + ': ' + agent.title}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Description */}
        <div className="settings-app-row">
          <label className="settings-app-label">Description</label>
          <textarea
            className="settings-app-input task-editor-textarea"
            placeholder="Detailed task description for the worker agent..."
            rows={6}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div className="task-editor-buttons">
        <button className="settings-custom-reset-btn" onClick={onClose}>Cancel</button>
        <button
          className="project-pick-btn"
          onClick={handleSave}
          disabled={!title.trim()}
        >
          {isEdit ? 'Save Changes' : 'Add Task'}
        </button>
      </div>
    </Modal>
  );
}
