// SettingsModal — Settings panel with theme picker + custom color picker
// ES module. Uses createModalPopup factory from ModalFactory.js.

import { el, colorWithAlpha } from '../../utils/dom.js';
import { initStatusColorsFromCSS } from '../../utils/constants.js';
import { createModalPopup } from './ModalFactory.js';

var THEMES = [
  {
    id: 'original',
    name: 'Original',
    dataTheme: '',
    swatch: {
      bg: '#0a0a0c',
      surface: '#1a1a1e',
      accent: '#9b7cf0',
      text: '#F5F5F7',
    },
  },
  {
    id: 'light',
    name: 'Light',
    dataTheme: 'light',
    swatch: {
      bg: '#f5f5f7',
      surface: '#e8e8eb',
      accent: '#9b7cf0',
      text: '#1d1d1f',
    },
  },
  // {
  //   id: 'ocean',
  //   name: 'Ocean',
  //   dataTheme: 'ocean',
  //   swatch: {
  //     bg: '#0b1628',
  //     surface: '#132040',
  //     accent: '#60a5fa',
  //     text: '#e0eaf5',
  //   },
  // },
  // {
  //   id: 'ember',
  //   name: 'Ember',
  //   dataTheme: 'ember',
  //   swatch: {
  //     bg: '#1a100a',
  //     surface: '#2a1a0e',
  //     accent: '#f59e0b',
  //     text: '#f5ede4',
  //   },
  // },
  // {
  //   id: 'forest',
  //   name: 'Forest',
  //   dataTheme: 'forest',
  //   swatch: {
  //     bg: '#0a1a10',
  //     surface: '#0e2a18',
  //     accent: '#34d399',
  //     text: '#d4eee0',
  //   },
  // },
  // {
  //   id: 'midnight',
  //   name: 'Midnight',
  //   dataTheme: 'midnight',
  //   swatch: {
  //     bg: '#14081e',
  //     surface: '#1e1030',
  //     accent: '#a855f7',
  //     text: '#e8dff5',
  //   },
  // },
];

var DEFAULT_CUSTOM_COLORS = {
  bg: '#0a0a0c',
  surface: '#1a1a1e',
  text: '#F5F5F7',
  accent: '#9b7cf0',
  completed: '#34d399',
  error: '#ef4444',
};

var COLOR_FIELDS = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Accent' },
  { key: 'completed', label: 'Completed' },
  { key: 'error', label: 'Error' },
];

/**
 * Apply custom theme colors as inline CSS variables on <html>.
 * @param {object} colors — { bg, surface, text, accent, completed, error }
 */
export function applyCustomTheme(colors) {
  var root = document.documentElement;
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
}

/**
 * Remove all inline custom CSS variables from <html>.
 */
export function clearCustomTheme() {
  var root = document.documentElement;
  var props = [
    '--bg', '--text', '--surface', '--surface-hover', '--border', '--border-hover',
    '--text-secondary', '--text-tertiary', '--color-in-progress', '--color-purple-start',
    '--color-purple-end', '--color-completed', '--color-failed',
  ];
  for (var i = 0; i < props.length; i++) {
    root.style.removeProperty(props[i]);
  }
}

function getSavedCustomColors() {
  try {
    var saved = JSON.parse(localStorage.getItem('synapse-custom-colors'));
    if (saved && saved.bg) return saved;
  } catch (e) { /* ignore */ }
  return null;
}

function saveCustomColors(colors) {
  localStorage.setItem('synapse-custom-colors', JSON.stringify(colors));
}

/**
 * Build the custom swatch preview from colors.
 */
function buildCustomSwatch(colors) {
  var swatch = el('div', { className: 'settings-theme-swatch' });
  var topRow = el('div', { className: 'settings-theme-swatch-row' });
  topRow.appendChild(el('span', { style: { backgroundColor: colors.bg } }));
  topRow.appendChild(el('span', { style: { backgroundColor: colors.surface } }));
  swatch.appendChild(topRow);
  var bottomRow = el('div', { className: 'settings-theme-swatch-row' });
  bottomRow.appendChild(el('span', { style: { backgroundColor: colors.accent } }));
  bottomRow.appendChild(el('span', { style: { backgroundColor: colors.text } }));
  swatch.appendChild(bottomRow);
  return swatch;
}

/**
 * Show the settings popup with theme picker.
 *
 * @param {string} currentTheme — current data-theme value ('' for original, 'light', 'ocean', 'custom')
 * @param {function} onThemeChange — callback(dataThemeValue) when a theme is selected
 */
export function showSettingsPopup(currentTheme, onThemeChange) {
  var popup = createModalPopup('settings-overlay', 'Settings');
  var body = popup.body;

  // --- Theme Section ---
  var section = el('div', { className: 'settings-section' });
  section.appendChild(el('div', { className: 'settings-section-title', text: 'Color Theme' }));

  var grid = el('div', { className: 'settings-theme-grid' });

  // Custom picker section (created early, shown/hidden based on selection)
  var customSection = el('div', { className: 'settings-custom-section' });
  customSection.hidden = true;

  // --- Preset theme cards ---
  for (var i = 0; i < THEMES.length; i++) {
    (function (theme) {
      var isActive = (currentTheme || '') === theme.dataTheme;
      var card = el('div', { className: 'settings-theme-card' + (isActive ? ' active' : '') });
      card.setAttribute('data-theme-id', theme.dataTheme);

      // Swatch preview
      var swatch = el('div', { className: 'settings-theme-swatch' });

      var topRow = el('div', { className: 'settings-theme-swatch-row' });
      topRow.appendChild(el('span', { style: { backgroundColor: theme.swatch.bg } }));
      topRow.appendChild(el('span', { style: { backgroundColor: theme.swatch.surface } }));
      swatch.appendChild(topRow);

      var bottomRow = el('div', { className: 'settings-theme-swatch-row' });
      bottomRow.appendChild(el('span', { style: { backgroundColor: theme.swatch.accent } }));
      bottomRow.appendChild(el('span', { style: { backgroundColor: theme.swatch.text } }));
      swatch.appendChild(bottomRow);

      card.appendChild(swatch);

      // Name + check
      card.appendChild(el('span', { className: 'settings-theme-name', text: theme.name }));
      card.appendChild(el('span', { className: 'settings-theme-check', text: '\u2713' }));

      card.addEventListener('click', function () {
        // Update active state on all cards (including custom)
        var allCards = grid.querySelectorAll('.settings-theme-card');
        for (var j = 0; j < allCards.length; j++) {
          allCards[j].classList.remove('active');
        }
        card.classList.add('active');

        // Hide custom picker
        customSection.hidden = true;

        // Clear inline custom vars and apply preset
        clearCustomTheme();
        if (onThemeChange) onThemeChange(theme.dataTheme);
      });

      grid.appendChild(card);
    })(THEMES[i]);
  }

  // --- Custom theme card ---
  var customColors = getSavedCustomColors() || DEFAULT_CUSTOM_COLORS;
  var isCustomActive = (currentTheme || '') === 'custom';
  var customCard = el('div', { className: 'settings-theme-card' + (isCustomActive ? ' active' : '') });
  customCard.setAttribute('data-theme-id', 'custom');

  // Swatch preview using saved custom colors
  var customSwatchContainer = el('div', { className: 'settings-theme-swatch' });
  var initialSwatch = buildCustomSwatch(customColors);
  // Copy children into the container
  while (initialSwatch.firstChild) {
    customSwatchContainer.appendChild(initialSwatch.firstChild);
  }
  customCard.appendChild(customSwatchContainer);

  customCard.appendChild(el('span', { className: 'settings-theme-name', text: 'Custom' }));
  customCard.appendChild(el('span', { className: 'settings-theme-check', text: '\u2713' }));

  // Working copy of colors for the picker inputs
  var workingColors = {};
  for (var k in customColors) {
    workingColors[k] = customColors[k];
  }

  function updateCustomSwatchPreview() {
    customSwatchContainer.textContent = '';
    var newSwatch = buildCustomSwatch(workingColors);
    while (newSwatch.firstChild) {
      customSwatchContainer.appendChild(newSwatch.firstChild);
    }
  }

  customCard.addEventListener('click', function () {
    var allCards = grid.querySelectorAll('.settings-theme-card');
    for (var j = 0; j < allCards.length; j++) {
      allCards[j].classList.remove('active');
    }
    customCard.classList.add('active');

    // Show custom picker
    customSection.hidden = false;

    // Apply custom colors
    applyCustomTheme(workingColors);
    if (onThemeChange) onThemeChange('custom');
    saveCustomColors(workingColors);
    initStatusColorsFromCSS();
  });

  grid.appendChild(customCard);

  section.appendChild(grid);

  // --- Build color picker section ---
  customSection.appendChild(el('div', { className: 'settings-custom-section-title', text: 'Customize Colors' }));

  var colorGrid = el('div', { className: 'settings-color-grid' });

  for (var f = 0; f < COLOR_FIELDS.length; f++) {
    (function (field) {
      var row = el('div', { className: 'settings-color-row' });

      row.appendChild(el('span', { className: 'settings-color-label', text: field.label }));

      var input = document.createElement('input');
      input.type = 'color';
      input.className = 'settings-color-input';
      input.value = workingColors[field.key] || DEFAULT_CUSTOM_COLORS[field.key];

      input.addEventListener('input', function () {
        workingColors[field.key] = input.value;
        applyCustomTheme(workingColors);
        saveCustomColors(workingColors);
        initStatusColorsFromCSS();
        updateCustomSwatchPreview();
      });

      row.appendChild(input);
      colorGrid.appendChild(row);
    })(COLOR_FIELDS[f]);
  }

  customSection.appendChild(colorGrid);

  // Reset to defaults button
  var resetBtn = el('button', { className: 'settings-custom-reset-btn', text: 'Reset to Defaults' });
  resetBtn.addEventListener('click', function () {
    for (var rk in DEFAULT_CUSTOM_COLORS) {
      workingColors[rk] = DEFAULT_CUSTOM_COLORS[rk];
    }
    // Update all color inputs
    var inputs = colorGrid.querySelectorAll('.settings-color-input');
    var idx = 0;
    for (var fi = 0; fi < COLOR_FIELDS.length; fi++) {
      if (inputs[idx]) {
        inputs[idx].value = DEFAULT_CUSTOM_COLORS[COLOR_FIELDS[fi].key];
      }
      idx++;
    }
    applyCustomTheme(workingColors);
    saveCustomColors(workingColors);
    initStatusColorsFromCSS();
    updateCustomSwatchPreview();
  });
  customSection.appendChild(resetBtn);

  section.appendChild(customSection);

  // Show custom picker if custom is already active
  if (isCustomActive) {
    customSection.hidden = false;
  }

  body.appendChild(section);

  // --- App Configuration Section (Electron only) ---
  if (window.electronAPI) {
    var appSection = el('div', { className: 'settings-section' });
    appSection.appendChild(el('div', { className: 'settings-section-title', text: 'App Configuration' }));

    var APP_FIELDS = [
      { key: 'dashboardCount', label: 'Dashboard Slots', type: 'number', min: 1, max: 10 },
      { key: 'initPollMs', label: 'Init Poll Interval (ms)', type: 'number', min: 50, max: 2000 },
      { key: 'progressRetryMs', label: 'Progress Retry Delay (ms)', type: 'number', min: 20, max: 500 },
      { key: 'progressReadDelayMs', label: 'Progress Read Delay (ms)', type: 'number', min: 10, max: 200 },
      { key: 'reconcileDebounceMs', label: 'Reconcile Debounce (ms)', type: 'number', min: 100, max: 2000 },
    ];

    // Load current settings
    window.electronAPI.getSettings().then(function (settings) {
      var appGrid = el('div', { className: 'settings-app-grid' });

      for (var ai = 0; ai < APP_FIELDS.length; ai++) {
        (function (field) {
          var row = el('div', { className: 'settings-app-row' });

          var label = el('label', { className: 'settings-app-label', text: field.label });
          row.appendChild(label);

          var input = document.createElement('input');
          input.type = field.type;
          input.className = 'settings-app-input';
          input.value = settings[field.key] !== undefined ? settings[field.key] : '';
          if (field.min !== undefined) input.min = field.min;
          if (field.max !== undefined) input.max = field.max;

          input.addEventListener('change', function () {
            var val = field.type === 'number' ? parseInt(input.value, 10) : input.value;
            if (field.type === 'number' && isNaN(val)) return;
            window.electronAPI.setSetting(field.key, val);
          });

          row.appendChild(input);
          appGrid.appendChild(row);
        })(APP_FIELDS[ai]);
      }

      appSection.appendChild(appGrid);

      // Note about restart
      var note = el('div', { className: 'settings-app-note', text: 'Changes to polling intervals take effect on next app restart.' });
      appSection.appendChild(note);

      // Reset all settings button
      var resetAllBtn = el('button', { className: 'settings-custom-reset-btn', text: 'Reset All to Defaults' });
      resetAllBtn.addEventListener('click', function () {
        window.electronAPI.resetSettings().then(function (defaults) {
          // Update all inputs with default values
          var inputs = appGrid.querySelectorAll('.settings-app-input');
          var idx = 0;
          for (var ri = 0; ri < APP_FIELDS.length; ri++) {
            if (inputs[idx]) {
              inputs[idx].value = defaults[APP_FIELDS[ri].key] !== undefined ? defaults[APP_FIELDS[ri].key] : '';
            }
            idx++;
          }
        });
      });
      appSection.appendChild(resetAllBtn);
    });

    body.appendChild(appSection);
  }

  document.body.appendChild(popup.overlay);
}
