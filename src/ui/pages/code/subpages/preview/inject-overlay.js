/**
 * inject-overlay.js — Webview injection script for inline double-click text editing
 *
 * This script is injected into the Electron webview (via executeJavaScript) to enable
 * inline editing of elements annotated with `data-synapse-label` attributes.
 *
 * Communication: sends edits to the host via window.postMessage with:
 *   { type: "synapse-edit", label, newText, oldText }
 *
 * All CSS classes use the `synapse-` prefix. Styles use CSS custom properties
 * scoped under `--synapse-*` to avoid collisions with the host page.
 */
(function synapseInjectOverlay() {
  'use strict';

  // Guard against double-injection
  if (window.__synapseOverlayInjected) return;
  window.__synapseOverlayInjected = true;

  // =========================================================================
  // Constants
  // =========================================================================

  var LABEL_ATTR = 'data-synapse-label';
  var SCANNED_FLAG = 'data-synapse-scanned';
  var EDITING_CLASS = 'synapse-editing';
  var LABELED_CLASS = 'synapse-labeled';
  var STYLE_ID = 'synapse-overlay-styles';

  // =========================================================================
  // Style injection
  // =========================================================================

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '/* Synapse overlay — injected styles */',
      ':root {',
      '  --synapse-hover-border: rgba(99, 102, 241, 0.45);',
      '  --synapse-hover-bg: rgba(99, 102, 241, 0.04);',
      '  --synapse-edit-border: rgba(59, 130, 246, 0.8);',
      '  --synapse-edit-shadow: rgba(59, 130, 246, 0.25);',
      '  --synapse-edit-bg: rgba(59, 130, 246, 0.03);',
      '  --synapse-label-color: rgba(99, 102, 241, 0.7);',
      '  --synapse-transition: 150ms ease;',
      '}',
      '',
      '/* Labeled element — subtle hover indicator */',
      '.' + LABELED_CLASS + ' {',
      '  outline: 1px dashed transparent;',
      '  outline-offset: 2px;',
      '  transition: outline-color var(--synapse-transition),',
      '              background-color var(--synapse-transition);',
      '  cursor: default;',
      '}',
      '',
      '.' + LABELED_CLASS + ':hover {',
      '  outline-color: var(--synapse-hover-border);',
      '  background-color: var(--synapse-hover-bg);',
      '}',
      '',
      '/* Element in active editing mode */',
      '.' + EDITING_CLASS + ' {',
      '  outline: 2px solid var(--synapse-edit-border) !important;',
      '  outline-offset: 2px !important;',
      '  box-shadow: 0 0 0 4px var(--synapse-edit-shadow) !important;',
      '  background-color: var(--synapse-edit-bg) !important;',
      '  cursor: text !important;',
      '  border-radius: 2px;',
      '}'
    ].join('\n');

    (document.head || document.documentElement).appendChild(style);
  }

  // =========================================================================
  // Editing state
  // =========================================================================

  var activeEdit = null; // { element, originalText, label }

  /**
   * Begin editing an element: make it contentEditable, select all text, show
   * editing styles, and suppress event propagation.
   */
  function startEdit(element) {
    if (activeEdit) {
      // Commit any in-flight edit before starting a new one
      commitEdit();
    }

    var label = element.getAttribute(LABEL_ATTR);
    if (!label) return;

    var originalText = element.textContent;

    activeEdit = {
      element: element,
      originalText: originalText,
      label: label
    };

    element.contentEditable = 'true';
    element.classList.add(EDITING_CLASS);
    element.focus();

    // Select all text inside the element
    selectAllText(element);

    // Attach editing event listeners
    element.addEventListener('keydown', onEditKeydown, true);
    element.addEventListener('blur', onEditBlur, true);
    element.addEventListener('click', stopPropagation, true);
  }

  /**
   * Commit the current edit: send the change via postMessage and clean up.
   */
  function commitEdit() {
    if (!activeEdit) return;

    var element = activeEdit.element;
    var label = activeEdit.label;
    var oldText = activeEdit.originalText;
    var newText = element.textContent;

    cleanupEdit();

    // Only send a message if the text actually changed
    if (newText !== oldText) {
      window.postMessage({
        type: 'synapse-edit',
        label: label,
        newText: newText,
        oldText: oldText,
        routePath: window.location.pathname
      }, '*');
    }
  }

  /**
   * Cancel the current edit: restore original text and clean up.
   */
  function cancelEdit() {
    if (!activeEdit) return;

    var element = activeEdit.element;
    element.textContent = activeEdit.originalText;

    cleanupEdit();
  }

  /**
   * Remove editing state from the active element.
   */
  function cleanupEdit() {
    if (!activeEdit) return;

    var element = activeEdit.element;

    element.contentEditable = 'false';
    element.classList.remove(EDITING_CLASS);

    element.removeEventListener('keydown', onEditKeydown, true);
    element.removeEventListener('blur', onEditBlur, true);
    element.removeEventListener('click', stopPropagation, true);

    activeEdit = null;
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  /**
   * Keydown handler during editing.
   *   - Enter (without Shift) commits the edit.
   *   - Escape cancels and restores original text.
   */
  function onEditKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
  }

  /**
   * Blur handler: commit the edit when the element loses focus.
   */
  function onEditBlur(e) {
    // Use a microtask delay so that if the user clicks another synapse element,
    // startEdit can fire first and commitEdit will be called from there.
    setTimeout(function () {
      if (activeEdit && activeEdit.element === e.target) {
        commitEdit();
      }
    }, 0);
  }

  /**
   * Double-click handler on document: start editing if the target has a label.
   */
  function onDblClick(e) {
    var target = findLabeledAncestor(e.target);
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    startEdit(target);
  }

  /**
   * Stop propagation helper — used to prevent host page click handlers
   * from firing while an element is being edited.
   */
  function stopPropagation(e) {
    e.stopPropagation();
  }

  // =========================================================================
  // DOM scanning
  // =========================================================================

  /**
   * Scan the DOM for elements with data-synapse-label that haven't been
   * processed yet. Add the hover class and mark them as scanned.
   */
  function scanForLabels() {
    var elements = document.querySelectorAll('[' + LABEL_ATTR + ']:not([' + SCANNED_FLAG + '])');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      el.setAttribute(SCANNED_FLAG, 'true');
      el.classList.add(LABELED_CLASS);
    }
  }

  // =========================================================================
  // MutationObserver — watch for SPA navigation / React re-renders
  // =========================================================================

  var observer = null;
  var scanDebounceTimer = null;

  /**
   * Debounced scan: waits for mutations to settle before scanning,
   * so we don't thrash on rapid DOM updates.
   */
  function debouncedScan() {
    if (scanDebounceTimer) {
      clearTimeout(scanDebounceTimer);
    }
    scanDebounceTimer = setTimeout(function () {
      scanDebounceTimer = null;
      scanForLabels();
    }, 100);
  }

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver(function (mutations) {
      var shouldScan = false;
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        // Check added nodes for potential labeled elements
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
        // Check attribute changes on the label attribute itself
        if (mutation.type === 'attributes' && mutation.attributeName === LABEL_ATTR) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        debouncedScan();
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [LABEL_ATTR]
    });
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Walk up the DOM from `el` to find the nearest ancestor (or self) that
   * has the data-synapse-label attribute.
   */
  function findLabeledAncestor(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.hasAttribute && el.hasAttribute(LABEL_ATTR)) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Select all text content within an element using the Selection API.
   */
  function selectAllText(element) {
    var range = document.createRange();
    range.selectNodeContents(element);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  function init() {
    injectStyles();
    scanForLabels();
    startObserver();

    // Double-click listener on the document (capture phase so we can intercept
    // before the host app's own handlers)
    document.addEventListener('dblclick', onDblClick, true);
  }

  // If the DOM is already loaded, initialize immediately; otherwise wait.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
