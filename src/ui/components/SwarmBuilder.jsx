// SwarmBuilder — Full swarm builder/editor view (embedded in main content area)
// Functional React component. Manages task list grouped by wave with add/edit/delete.

import React, { useState, useCallback } from 'react';
import { useDispatch } from '../context/AppContext.jsx';
import TaskEditorModal from './modals/TaskEditorModal.jsx';

export default function SwarmBuilder({ onLaunch, onCancel, initData, dashboardId }) {
  const dispatch = useDispatch();
  const api = window.electronAPI || null;

  const [swarmName, setSwarmName] = useState(
    (initData && initData.task) ? initData.task.name : ''
  );
  const [swarmType, setSwarmType] = useState(
    (initData && initData.task) ? (initData.task.type || 'Waves') : 'Waves'
  );
  const [agents, setAgents] = useState(
    (initData && initData.agents) ? initData.agents.slice() : []
  );
  const [waves, setWaves] = useState(
    (initData && initData.waves) ? initData.waves.slice() : []
  );
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  function toggleType() {
    setSwarmType(t => t === 'Waves' ? 'Chains' : 'Waves');
  }

  function recalcWaves(agentList, waveList) {
    const counts = {};
    agentList.forEach(a => {
      counts[a.wave] = (counts[a.wave] || 0) + 1;
    });
    return waveList
      .map(w => ({ ...w, total: counts[w.id] || 0 }))
      .filter(w => w.total > 0);
  }

  function handleAddTask() {
    setEditingTask(null);
    setTaskEditorOpen(true);
  }

  function handleEditTask(agent) {
    setEditingTask(agent);
    setTaskEditorOpen(true);
  }

  function handleDeleteTask(agentId) {
    setAgents(prev => {
      const next = prev
        .filter(a => a.id !== agentId)
        .map(a => ({
          ...a,
          depends_on: a.depends_on ? a.depends_on.filter(d => d !== agentId) : [],
        }));
      setWaves(w => recalcWaves(next, w));
      return next;
    });
  }

  function handleNewTask(taskData) {
    let newWaves = waves.slice();
    let resolvedWave = taskData.wave;

    if (taskData._newWaveName) {
      const maxId = newWaves.reduce((m, w) => Math.max(m, w.id), 0);
      const newId = maxId + 1;
      newWaves = [...newWaves, { id: newId, name: taskData._newWaveName, total: 0 }];
      resolvedWave = newId;
    }
    if (!resolvedWave && newWaves.length > 0) {
      resolvedWave = newWaves[0].id;
    } else if (!resolvedWave) {
      resolvedWave = 1;
      newWaves = [{ id: 1, name: 'Wave 1', total: 0 }];
    }

    const maxSub = agents
      .filter(a => parseInt(String(a.id).split('.')[0], 10) === resolvedWave)
      .reduce((m, a) => Math.max(m, parseInt(String(a.id).split('.')[1], 10) || 0), 0);

    const newAgent = {
      ...taskData,
      wave: resolvedWave,
      id: resolvedWave + '.' + (maxSub + 1),
      _newWaveName: undefined,
    };
    delete newAgent._newWaveName;

    const nextAgents = [...agents, newAgent];
    const nextWaves = recalcWaves(nextAgents, newWaves);
    setAgents(nextAgents);
    setWaves(nextWaves);
  }

  function handleTaskUpdate(oldId, taskData) {
    const nextAgents = agents.map(a =>
      a.id === oldId ? { ...taskData, id: oldId, _newWaveName: undefined } : a
    );
    setAgents(nextAgents);
    setWaves(w => recalcWaves(nextAgents, w));
  }

  function handleSaveTask(taskData) {
    setTaskEditorOpen(false);
    if (editingTask) {
      handleTaskUpdate(editingTask.id, taskData);
    } else {
      handleNewTask(taskData);
    }
    setEditingTask(null);
  }

  function handleLaunch() {
    if (!swarmName.trim() || agents.length === 0) return;
    const initDataOut = {
      task: {
        name: swarmName.trim(),
        type: swarmType,
        directory: '.',
        prompt: '',
        project: '',
        created: new Date().toISOString(),
        total_tasks: agents.length,
        total_waves: waves.length,
      },
      agents,
      waves,
      chains: [],
      history: [],
    };
    if (onLaunch) onLaunch(initDataOut);
  }

  function handleCancel() {
    if (onCancel) {
      onCancel();
    } else {
      dispatch({ type: 'SET_VIEW', view: 'dashboard' });
    }
  }

  // Group agents by wave
  const waveGroups = {};
  agents.forEach(a => {
    if (!waveGroups[a.wave]) waveGroups[a.wave] = [];
    waveGroups[a.wave].push(a);
  });
  const sortedWaveIds = Object.keys(waveGroups).map(Number).sort((a, b) => a - b);

  return (
    <div className="swarm-builder">
      <div className="swarm-builder-header">
        <h2 className="swarm-builder-title">Create Swarm</h2>
        <div className="swarm-builder-name-row">
          <input
            type="text"
            className="swarm-builder-name-input"
            placeholder="Swarm name..."
            value={swarmName}
            onChange={e => setSwarmName(e.target.value)}
          />
          <button className="swarm-builder-type-btn" onClick={toggleType}>
            {swarmType}
          </button>
        </div>
      </div>

      <div className="swarm-builder-tasks">
        {agents.length === 0 ? (
          <div className="swarm-builder-empty">
            <div className="swarm-builder-empty-title">No tasks yet</div>
            <div className="swarm-builder-empty-sub">Add tasks to build your swarm plan</div>
          </div>
        ) : (
          sortedWaveIds.map(waveId => {
            const waveInfo = waves.find(w => w.id === waveId);
            return (
              <div key={waveId} className="swarm-builder-wave">
                <div className="swarm-builder-wave-header">
                  <span className="swarm-builder-wave-title">
                    {waveInfo ? waveInfo.name : ('Wave ' + waveId)}
                  </span>
                  <span className="swarm-builder-wave-count">
                    {waveGroups[waveId].length} tasks
                  </span>
                </div>
                {waveGroups[waveId].map(agent => (
                  <div key={agent.id} className="swarm-builder-task-card">
                    <div className="swarm-builder-task-left">
                      <span className="swarm-builder-task-id">{agent.id}</span>
                      <span className="swarm-builder-task-title">{agent.title}</span>
                      {agent.depends_on && agent.depends_on.length > 0 && (
                        <span className="swarm-builder-task-deps">
                          {'→ ' + agent.depends_on.join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="swarm-builder-task-actions">
                      <button
                        className="swarm-builder-task-btn"
                        title="Edit"
                        onClick={() => handleEditTask(agent)}
                      >
                        ✎
                      </button>
                      <button
                        className="swarm-builder-task-btn swarm-builder-task-btn-del"
                        title="Remove"
                        onClick={() => handleDeleteTask(agent.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      <div className="swarm-builder-controls">
        <button className="project-pick-btn" onClick={handleAddTask}>
          + Add Task
        </button>
        <button className="settings-custom-reset-btn" onClick={handleCancel}>
          Cancel
        </button>
        <button
          className="project-pick-btn swarm-builder-launch-btn"
          onClick={handleLaunch}
          disabled={!swarmName.trim() || agents.length === 0}
        >
          Launch Swarm
        </button>
      </div>

      {taskEditorOpen && (
        <TaskEditorModal
          onClose={() => { setTaskEditorOpen(false); setEditingTask(null); }}
          onSave={handleSaveTask}
          agents={agents}
          waves={waves.length > 0 ? waves : [{ id: 1, name: 'Wave 1', total: 0 }]}
          editTask={editingTask}
        />
      )}
    </div>
  );
}
