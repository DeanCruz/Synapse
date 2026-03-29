// ProjectModal — Project configuration: directory picker, recent projects, CLI detection
// Supports per-dashboard project paths and additional context directories.

import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import {
  getDashboardProject,
  saveDashboardProject,
  getDashboardAdditionalContext,
  addDashboardAdditionalContext,
  removeDashboardAdditionalContext,
} from '../../utils/dashboardProjects.js';

const MODEL_OPTIONS = {
  claude: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  codex: [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
    { value: 'gpt-5.2-codex', label: 'GPT-5.2-Codex' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1-Codex-Max' },
    { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1-Codex-Mini' },
  ],
};

function getModelOptions(provider) {
  return MODEL_OPTIONS[provider] || MODEL_OPTIONS.claude;
}

function resolveModel(provider, savedModel) {
  const options = getModelOptions(provider);
  if (savedModel && options.some((option) => option.value === savedModel)) {
    return savedModel;
  }
  return options[0].value;
}

/** Extract the last segment of a path as a short display name */
function dirBasename(dirPath) {
  if (!dirPath) return '';
  const segments = dirPath.replace(/[\\/]+$/, '').split(/[\\/]/);
  return segments[segments.length - 1] || dirPath;
}

export default function ProjectModal({ onClose, onProjectSelected, dashboardId }) {
  const api = window.electronAPI || null;
  const targetDashboard = dashboardId || 'dashboard1';
  const dashboardLabel = targetDashboard.replace('dashboard', 'Dashboard ');

  const [currentProject, setCurrentProject] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [provider, setProvider] = useState('claude');
  const [cliPath, setCliPath] = useState('');
  const [cliStatus, setCliStatus] = useState('Detecting...');
  const [cliFound, setCliFound] = useState(null); // null | true | false
  const [defaultModel, setDefaultModel] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [additionalDirs, setAdditionalDirs] = useState([]);

  useEffect(() => {
    if (!api) return;

    // Load per-dashboard project path first, then fall back to global
    const perDashboardPath = getDashboardProject(targetDashboard);

    api.getSettings().then(settings => {
      const projectPath = perDashboardPath || settings.activeProjectPath;
      if (projectPath) {
        api.loadProject(projectPath).then(project => {
          setCurrentProject(project);
        }).catch(() => {});
      }
      const activeProvider = settings.agentProvider || 'claude';
      const resolvedDefaultModel = resolveModel(activeProvider, settings.defaultModel);
      setProvider(activeProvider);
      setCliPath(activeProvider === 'codex' ? (settings.codexCliPath || '') : (settings.claudeCliPath || ''));
      setDefaultModel(resolvedDefaultModel);
      if (resolvedDefaultModel !== settings.defaultModel) {
        api.setSetting('defaultModel', resolvedDefaultModel).catch(() => {});
      }
      setSkipPermissions(!!settings.dangerouslySkipPermissions);
    });

    api.getRecentProjects().then(recents => {
      setRecentProjects(recents || []);
    });

    api.detectAgentCli(provider).then(detected => {
      if (detected) {
        setCliStatus('Found: ' + detected);
        setCliFound(true);
        setCliPath(prev => prev || detected);
      } else {
        setCliStatus('Not found — please set path manually');
        setCliFound(false);
      }
    });

    // Load additional context directories from localStorage
    setAdditionalDirs(getDashboardAdditionalContext(targetDashboard));
  }, [api, provider, targetDashboard]);

  function handleSelectDirectory() {
    if (!api) return;
    api.selectProjectDirectory().then(dirPath => {
      if (!dirPath) return;
      api.loadProject(dirPath).then(project => {
        setCurrentProject(project);
        api.addRecentProject({ path: project.path, name: project.name });
        saveDashboardProject(targetDashboard, project.path);
        setRecentProjects(prev => {
          const filtered = prev.filter(p => p.path !== project.path);
          return [{ path: project.path, name: project.name }, ...filtered];
        });
        if (onProjectSelected) onProjectSelected({ ...project, dashboardId: targetDashboard });
      });
    });
  }

  function handleAddAdditionalDir() {
    if (!api) return;
    api.selectProjectDirectory().then(dirPath => {
      if (!dirPath) return;
      // Prevent adding the active project directory as additional context
      if (currentProject && currentProject.path === dirPath) return;
      addDashboardAdditionalContext(targetDashboard, dirPath);
      setAdditionalDirs(getDashboardAdditionalContext(targetDashboard));
    });
  }

  function handleRemoveAdditionalDir(dirPath) {
    removeDashboardAdditionalContext(targetDashboard, dirPath);
    setAdditionalDirs(getDashboardAdditionalContext(targetDashboard));
  }

  function handleRecentClick(recent) {
    if (!api) return;
    api.loadProject(recent.path).then(project => {
      setCurrentProject(project);
      saveDashboardProject(targetDashboard, project.path);
      if (onProjectSelected) onProjectSelected({ ...project, dashboardId: targetDashboard });
    }).catch(() => {});
  }

  function handleCliPathChange(e) {
    setCliPath(e.target.value);
    if (api) api.setSetting(provider === 'codex' ? 'codexCliPath' : 'claudeCliPath', e.target.value);
  }

  function handleProviderChange(e) {
    const nextProvider = e.target.value;
    const nextModel = resolveModel(nextProvider, defaultModel);
    setProvider(nextProvider);
    setDefaultModel(nextModel);
    setCliStatus('Detecting...');
    setCliFound(null);
    if (api) {
      api.setSetting('agentProvider', nextProvider);
      api.setSetting('defaultModel', nextModel);
    }
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
      <Modal title={'Project Configuration — ' + dashboardLabel} onClose={onClose}>
        <div>Project configuration requires the desktop app.</div>
      </Modal>
    );
  }

  return (
    <Modal title={'Project Configuration — ' + dashboardLabel} onClose={onClose}>
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

      {/* Additional Context */}
      <div className="settings-section">
        <div className="settings-section-title">Additional Context</div>
        <div className="additional-context-description">
          Add extra directories whose files will be available as context for this dashboard's agents.
        </div>
        {additionalDirs.length > 0 && (
          <div className="additional-context-list">
            {additionalDirs.map((dir) => (
              <div key={dir} className="additional-context-row">
                <div className="additional-context-info">
                  <span className="additional-context-name">{dirBasename(dir)}</span>
                  <span className="additional-context-path">{dir}</span>
                </div>
                <button
                  className="additional-context-remove"
                  onClick={() => handleRemoveAdditionalDir(dir)}
                  title="Remove directory"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="project-pick-btn additional-context-add-btn" onClick={handleAddAdditionalDir}>
          + Add Additional Directory
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

      {/* Agent provider */}
      <div className="settings-section">
        <div className="settings-section-title">Agent Provider</div>
        <div className="settings-app-row project-settings-row">
          <label className="settings-app-label">Provider</label>
          <select
            className="settings-app-input project-settings-input"
            value={provider}
            onChange={handleProviderChange}
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </div>

        <div className="settings-section-title" style={{ marginTop: '12px' }}>
          {provider === 'codex' ? 'Codex CLI' : 'Claude CLI'}
        </div>
        <div className={'project-cli-status' + (cliFound === true ? ' project-cli-found' : cliFound === false ? ' project-cli-missing' : '')}>
          {cliStatus}
        </div>
        <input
          type="text"
          className="settings-app-input project-settings-input project-settings-path-input"
          placeholder={provider === 'codex' ? 'Path to codex binary' : 'Path to claude binary'}
          value={cliPath}
          onChange={handleCliPathChange}
          style={{ marginTop: '8px' }}
        />

        <div className="settings-app-row project-settings-row" style={{ marginTop: '12px' }}>
          <label className="settings-app-label">Default Model</label>
          <select
            className="settings-app-input project-settings-input"
            value={defaultModel}
            onChange={handleModelChange}
          >
            {getModelOptions(provider).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-app-row project-settings-row" style={{ marginTop: '8px' }}>
          <label className="settings-app-label" title={skipPermissions ? 'All tool calls are auto-approved without prompting' : 'Permission requests appear in the UI for manual approval'}>
            {skipPermissions ? 'Bypass All Permissions' : 'Interactive Permissions'}
          </label>
          <input
            type="checkbox"
            className="settings-app-input project-settings-checkbox"
            style={{ width: 'auto' }}
            checked={skipPermissions}
            onChange={handleSkipPermissionsChange}
          />
          <span className="settings-app-hint" style={{ marginLeft: '8px', fontSize: '11px', opacity: 0.6 }}>
            {skipPermissions ? 'All tool calls run without approval' : 'You approve or deny each tool call'}
          </span>
        </div>
      </div>
    </Modal>
  );
}
