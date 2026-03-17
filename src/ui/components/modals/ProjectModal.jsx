// ProjectModal — Project configuration: directory picker, recent projects, CLI detection
// Mirrors ProjectModal.js with React hooks and JSX.

import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';

export default function ProjectModal({ onClose, onProjectSelected }) {
  const api = window.electronAPI || null;

  const [currentProject, setCurrentProject] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [cliPath, setCliPath] = useState('');
  const [cliStatus, setCliStatus] = useState('Detecting...');
  const [cliFound, setCliFound] = useState(null); // null | true | false
  const [defaultModel, setDefaultModel] = useState('sonnet');
  const [skipPermissions, setSkipPermissions] = useState(false);

  useEffect(() => {
    if (!api) return;

    api.getSettings().then(settings => {
      if (settings.activeProjectPath) {
        api.loadProject(settings.activeProjectPath).then(project => {
          setCurrentProject(project);
        }).catch(() => {});
      }
      if (settings.claudeCliPath) setCliPath(settings.claudeCliPath);
      if (settings.defaultModel) setDefaultModel(settings.defaultModel);
      setSkipPermissions(!!settings.dangerouslySkipPermissions);
    });

    api.getRecentProjects().then(recents => {
      setRecentProjects(recents || []);
    });

    api.detectClaudeCli().then(detected => {
      if (detected) {
        setCliStatus('Found: ' + detected);
        setCliFound(true);
        setCliPath(prev => prev || detected);
      } else {
        setCliStatus('Not found — please set path manually');
        setCliFound(false);
      }
    });
  }, [api]);

  function handleSelectDirectory() {
    if (!api) return;
    api.selectProjectDirectory().then(dirPath => {
      if (!dirPath) return;
      api.loadProject(dirPath).then(project => {
        setCurrentProject(project);
        api.addRecentProject({ path: project.path, name: project.name });
        api.setSetting('activeProjectPath', project.path);
        setRecentProjects(prev => {
          const filtered = prev.filter(p => p.path !== project.path);
          return [{ path: project.path, name: project.name }, ...filtered];
        });
        if (onProjectSelected) onProjectSelected(project);
      });
    });
  }

  function handleRecentClick(recent) {
    if (!api) return;
    api.loadProject(recent.path).then(project => {
      setCurrentProject(project);
      api.setSetting('activeProjectPath', project.path);
      if (onProjectSelected) onProjectSelected(project);
    }).catch(() => {});
  }

  function handleCliPathChange(e) {
    setCliPath(e.target.value);
    if (api) api.setSetting('claudeCliPath', e.target.value);
  }

  function handleModelChange(e) {
    setDefaultModel(e.target.value);
    if (api) api.setSetting('defaultModel', e.target.value);
  }

  function handleSkipPermissionsChange(e) {
    setSkipPermissions(e.target.checked);
    if (api) api.setSetting('dangerouslySkipPermissions', e.target.checked);
  }

  if (!api) {
    return (
      <Modal title="Project Configuration" onClose={onClose}>
        <div>Project configuration requires the desktop app.</div>
      </Modal>
    );
  }

  return (
    <Modal title="Project Configuration" onClose={onClose}>
      {/* Active Project */}
      <div className="settings-section">
        <div className="settings-section-title">Active Project</div>
        <div className="project-current-display">
          {currentProject ? (
            <>
              <div className="project-name">{currentProject.name}</div>
              <div className="project-path">{currentProject.path}</div>
              <div className="project-meta">
                {currentProject.language && (
                  <span className="project-badge">{currentProject.language}</span>
                )}
                {currentProject.hasClaudeMd && (
                  <span className="project-badge project-badge-green">CLAUDE.md</span>
                )}
              </div>
            </>
          ) : (
            'No project selected'
          )}
        </div>
        <button className="project-pick-btn" onClick={handleSelectDirectory}>
          Select Project Directory
        </button>
      </div>

      {/* Recent Projects */}
      <div className="settings-section">
        <div className="settings-section-title">Recent Projects</div>
        <div className="project-recent-list">
          {recentProjects.length === 0 ? (
            <div className="project-recent-empty">No recent projects</div>
          ) : (
            recentProjects.map((recent, i) => (
              <div
                key={recent.path + i}
                className="project-recent-row"
                onClick={() => handleRecentClick(recent)}
              >
                <span className="project-recent-name">{recent.name}</span>
                <span className="project-recent-path">{recent.path}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Claude CLI */}
      <div className="settings-section">
        <div className="settings-section-title">Claude CLI</div>
        <div className={'project-cli-status' + (cliFound === true ? ' project-cli-found' : cliFound === false ? ' project-cli-missing' : '')}>
          {cliStatus}
        </div>
        <input
          type="text"
          className="settings-app-input"
          placeholder="Path to claude binary"
          value={cliPath}
          onChange={handleCliPathChange}
          style={{ marginTop: '8px' }}
        />

        <div className="settings-app-row" style={{ marginTop: '12px' }}>
          <label className="settings-app-label">Default Model</label>
          <select
            className="settings-app-input"
            value={defaultModel}
            onChange={handleModelChange}
          >
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
          </select>
        </div>

        <div className="settings-app-row" style={{ marginTop: '8px' }}>
          <label className="settings-app-label">Skip Permissions</label>
          <input
            type="checkbox"
            className="settings-app-input"
            style={{ width: 'auto' }}
            checked={skipPermissions}
            onChange={handleSkipPermissionsChange}
          />
        </div>
      </div>
    </Modal>
  );
}
