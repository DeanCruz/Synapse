// SettingsModal — Theme picker, custom color picker, app configuration
// Mirrors SettingsModal.js with React hooks and JSX.

import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { colorWithAlpha, initStatusColorsFromCSS } from '../../utils/constants.js';

const THEMES = [
  {
    id: 'original',
    name: 'Original',
    dataTheme: '',
    swatch: { bg: '#0a0a0c', surface: '#1a1a1e', accent: '#9b7cf0', text: '#F5F5F7' },
  },
  {
    id: 'light',
    name: 'Light',
    dataTheme: 'light',
    swatch: { bg: '#f5f5f7', surface: '#e8e8eb', accent: '#9b7cf0', text: '#1d1d1f' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    dataTheme: 'ocean',
    swatch: { bg: '#0b1628', surface: '#142236', accent: '#60a5fa', text: '#e0eaf5' },
  },
  {
    id: 'ember',
    name: 'Ember',
    dataTheme: 'ember',
    swatch: { bg: '#1a100a', surface: '#2a1a0e', accent: '#f59e0b', text: '#f5ede4' },
  },
  {
    id: 'forest',
    name: 'Forest',
    dataTheme: 'forest',
    swatch: { bg: '#0a1a10', surface: '#0e2216', accent: '#34d399', text: '#d4eee0' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dataTheme: 'midnight',
    swatch: { bg: '#14081e', surface: '#1c0e2a', accent: '#a855f7', text: '#e8dff5' },
  },
];

const DEFAULT_CUSTOM_COLORS = {
  bg: '#0a0a0c',
  surface: '#1a1a1e',
  text: '#F5F5F7',
  accent: '#9b7cf0',
  completed: '#34d399',
  error: '#ef4444',
};

const COLOR_FIELDS = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Accent' },
  { key: 'completed', label: 'Completed' },
  { key: 'error', label: 'Error' },
];

const APP_FIELDS = [
  { key: 'dashboardCount', label: 'Dashboard Slots', type: 'number', min: 1, max: 10 },
  { key: 'initPollMs', label: 'Init Poll Interval (ms)', type: 'number', min: 50, max: 2000 },
  { key: 'progressRetryMs', label: 'Progress Retry Delay (ms)', type: 'number', min: 20, max: 500 },
  { key: 'progressReadDelayMs', label: 'Progress Read Delay (ms)', type: 'number', min: 10, max: 200 },
  { key: 'reconcileDebounceMs', label: 'Reconcile Debounce (ms)', type: 'number', min: 100, max: 2000 },
];

function getSavedCustomColors() {
  try {
    const saved = JSON.parse(localStorage.getItem('synapse-custom-colors'));
    if (saved && saved.bg) return saved;
  } catch (e) { /* ignore */ }
  return null;
}

function saveCustomColors(colors) {
  localStorage.setItem('synapse-custom-colors', JSON.stringify(colors));
}

function applyCustomTheme(colors) {
  const root = document.documentElement;
  root.style.setProperty('--bg', colors.bg);
  root.style.setProperty('--text', colors.text);
  root.style.setProperty('--surface', colorWithAlpha(colors.surface, 0.06));
  root.style.setProperty('--surface-hover', colorWithAlpha(colors.surface, 0.1));
  root.style.setProperty('--border', colorWithAlpha(colors.surface, 0.1));
  root.style.setProperty('--border-hover', colorWithAlpha(colors.surface, 0.2));
  root.style.setProperty('--text-secondary', colorWithAlpha(colors.text, 0.6));
  root.style.setProperty('--text-tertiary', colorWithAlpha(colors.text, 0.4));
  root.style.setProperty('--color-in-progress', colors.accent);
  root.style.setProperty('--color-purple-start', colors.accent);
  root.style.setProperty('--color-purple-end', colors.accent);
  root.style.setProperty('--color-completed', colors.completed);
  root.style.setProperty('--color-failed', colors.error);

  // Terminal colors — derived from custom bg/text/accent
  root.style.setProperty('--terminal-bg', colors.bg);
  root.style.setProperty('--terminal-fg', colors.text);
  root.style.setProperty('--terminal-cursor', colors.accent);
  root.style.setProperty('--terminal-selection', colorWithAlpha(colors.accent, 0.3));

  // Editor colors — derived from custom bg/text/accent
  root.style.setProperty('--editor-bg', colors.bg);
  root.style.setProperty('--editor-fg', colors.text);
  root.style.setProperty('--editor-cursor', colors.accent);
  root.style.setProperty('--editor-widget-bg', colors.surface);
  root.style.setProperty('--editor-selection', colorWithAlpha(colors.accent, 0.2));

  // Semantic colors — derived from accent/completed
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-accent-bg', colorWithAlpha(colors.accent, 0.1));
  root.style.setProperty('--color-type-bg', colorWithAlpha(colors.accent, 0.1));
  root.style.setProperty('--color-type', colorWithAlpha(colors.accent, 0.8));
  root.style.setProperty('--color-duration-bg', colorWithAlpha(colors.completed, 0.08));
  root.style.setProperty('--color-duration', colors.completed);
  root.style.setProperty('--color-neutral-bg', colorWithAlpha(colors.surface, 0.06));
  root.style.setProperty('--color-neutral-border', colorWithAlpha(colors.surface, 0.1));
}

function clearCustomTheme() {
  const props = [
    '--bg', '--text', '--surface', '--surface-hover', '--border', '--border-hover',
    '--text-secondary', '--text-tertiary', '--color-in-progress', '--color-purple-start',
    '--color-purple-end', '--color-completed', '--color-failed',
    '--terminal-bg', '--terminal-fg', '--terminal-cursor', '--terminal-selection',
    '--editor-bg', '--editor-fg', '--editor-cursor', '--editor-widget-bg', '--editor-selection',
    '--color-accent', '--color-accent-bg', '--color-type-bg', '--color-type',
    '--color-duration-bg', '--color-duration', '--color-neutral-bg', '--color-neutral-border',
  ];
  props.forEach(p => document.documentElement.style.removeProperty(p));
}

export default function SettingsModal({ onClose, currentTheme, onThemeChange }) {
  const api = window.electronAPI || null;

  const [activeTheme, setActiveTheme] = useState(currentTheme || '');
  const [customColors, setCustomColors] = useState(
    () => getSavedCustomColors() || { ...DEFAULT_CUSTOM_COLORS }
  );
  const [appSettings, setAppSettings] = useState({});

  useEffect(() => {
    if (api) {
      api.getSettings().then(settings => setAppSettings(settings || {}));
    }
  }, [api]);

  function selectTheme(dataTheme) {
    setActiveTheme(dataTheme);
    clearCustomTheme();
    document.documentElement.setAttribute('data-theme', dataTheme);
    // Re-sync JS color constants with new CSS variables
    requestAnimationFrame(() => initStatusColorsFromCSS());
    if (onThemeChange) onThemeChange(dataTheme);
  }

  function selectCustomTheme() {
    setActiveTheme('custom');
    document.documentElement.setAttribute('data-theme', 'custom');
    applyCustomTheme(customColors);
    saveCustomColors(customColors);
    initStatusColorsFromCSS();
    if (onThemeChange) onThemeChange('custom');
  }

  function handleColorChange(key, value) {
    const next = { ...customColors, [key]: value };
    setCustomColors(next);
    applyCustomTheme(next);
    saveCustomColors(next);
    initStatusColorsFromCSS();
  }

  function handleResetColors() {
    const defaults = { ...DEFAULT_CUSTOM_COLORS };
    setCustomColors(defaults);
    applyCustomTheme(defaults);
    saveCustomColors(defaults);
    initStatusColorsFromCSS();
  }

  function handleAppSettingChange(key, value) {
    setAppSettings(prev => ({ ...prev, [key]: value }));
    if (api) api.setSetting(key, value);
  }

  function handleResetAllSettings() {
    if (!api) return;
    api.resetSettings().then(defaults => {
      setAppSettings(defaults || {});
    });
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      {/* Theme Section */}
      <div className="settings-section">
        <div className="settings-section-title">Color Theme</div>
        <div className="settings-theme-grid">
          {THEMES.map(theme => (
            <div
              key={theme.id}
              className={'settings-theme-card' + (activeTheme === theme.dataTheme ? ' active' : '')}
              onClick={() => selectTheme(theme.dataTheme)}
            >
              <div className="settings-theme-swatch">
                <div className="settings-theme-swatch-row">
                  <span style={{ backgroundColor: theme.swatch.bg }} />
                  <span style={{ backgroundColor: theme.swatch.surface }} />
                </div>
                <div className="settings-theme-swatch-row">
                  <span style={{ backgroundColor: theme.swatch.accent }} />
                  <span style={{ backgroundColor: theme.swatch.text }} />
                </div>
              </div>
              <span className="settings-theme-name">{theme.name}</span>
              <span className="settings-theme-check">✓</span>
            </div>
          ))}

          {/* Custom theme card */}
          <div
            className={'settings-theme-card' + (activeTheme === 'custom' ? ' active' : '')}
            onClick={selectCustomTheme}
          >
            <div className="settings-theme-swatch">
              <div className="settings-theme-swatch-row">
                <span style={{ backgroundColor: customColors.bg }} />
                <span style={{ backgroundColor: customColors.surface }} />
              </div>
              <div className="settings-theme-swatch-row">
                <span style={{ backgroundColor: customColors.accent }} />
                <span style={{ backgroundColor: customColors.text }} />
              </div>
            </div>
            <span className="settings-theme-name">Custom</span>
            <span className="settings-theme-check">✓</span>
          </div>
        </div>

        {/* Custom color picker (shown when custom is active) */}
        {activeTheme === 'custom' && (
          <div className="settings-custom-section">
            <div className="settings-custom-section-title">Customize Colors</div>
            <div className="settings-color-grid">
              {COLOR_FIELDS.map(field => (
                <div key={field.key} className="settings-color-row">
                  <span className="settings-color-label">{field.label}</span>
                  <input
                    type="color"
                    className="settings-color-input"
                    value={customColors[field.key] || DEFAULT_CUSTOM_COLORS[field.key]}
                    onChange={e => handleColorChange(field.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <button className="settings-custom-reset-btn" onClick={handleResetColors}>
              Reset to Defaults
            </button>
          </div>
        )}
      </div>

      {/* App Configuration Section (Electron only) */}
      {api && (
        <div className="settings-section">
          <div className="settings-section-title">App Configuration</div>
          <div className="settings-app-grid">
            {APP_FIELDS.map(field => (
              <div key={field.key} className="settings-app-row">
                <label className="settings-app-label">{field.label}</label>
                <input
                  type={field.type}
                  className="settings-app-input"
                  value={appSettings[field.key] !== undefined ? appSettings[field.key] : ''}
                  min={field.min}
                  max={field.max}
                  onChange={e => {
                    const val = field.type === 'number' ? parseInt(e.target.value, 10) : e.target.value;
                    if (field.type === 'number' && isNaN(val)) return;
                    handleAppSettingChange(field.key, val);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="settings-app-note">
            Changes to polling intervals take effect on next app restart.
          </div>
          <button className="settings-custom-reset-btn" onClick={handleResetAllSettings}>
            Reset All to Defaults
          </button>
        </div>
      )}
    </Modal>
  );
}
