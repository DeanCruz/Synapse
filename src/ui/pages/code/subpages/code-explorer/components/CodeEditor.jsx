/**
 * CodeEditor — Monaco Editor wrapper for the Synapse IDE.
 *
 * Displays file contents with syntax highlighting, supports Cmd+S/Ctrl+S
 * to save, auto-detects language from file extension, and tracks dirty state.
 * Supports gutter-click breakpoint toggling with red dot decorations.
 * Integrates syntax diagnostics with squiggly underlines and gutter icons.
 *
 * Props:
 *   filePath      — absolute path to the file being edited
 *   workspaceId   — ID of the workspace this file belongs to
 *   workspacePath — root path of the workspace (for IPC calls)
 */

// Worker setup MUST be imported first, before any monaco-editor imports
import '@/utils/monacoWorkerSetup';
import * as monaco from 'monaco-editor';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import '../../styles/ide-editor.css';

/* ── Language detection map ─────────────────────────────────── */
const EXT_TO_LANGUAGE = {
  '.js':   'javascript',
  '.jsx':  'javascript',
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.py':   'python',
  '.json': 'json',
  '.md':   'markdown',
  '.css':  'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.htm':  'html',
  '.xml':  'xml',
  '.yaml': 'yaml',
  '.yml':  'yaml',
  '.sh':   'shell',
  '.bash': 'shell',
  '.zsh':  'shell',
  '.sql':  'sql',
  '.go':   'go',
  '.rs':   'rust',
  '.java': 'java',
  '.rb':   'ruby',
  '.c':    'c',
  '.h':    'c',
  '.cpp':  'cpp',
  '.cxx':  'cpp',
  '.cc':   'cpp',
  '.hpp':  'cpp',
  '.swift':'swift',
  '.kt':   'kotlin',
  '.php':  'php',
  '.r':    'r',
  '.lua':  'lua',
  '.toml': 'ini',
  '.ini':  'ini',
  '.dockerfile': 'dockerfile',
};

function detectLanguage(filePath) {
  if (!filePath) return 'plaintext';
  const lower = filePath.toLowerCase();
  // Handle special filenames
  const fileName = lower.split('/').pop();
  if (fileName === 'dockerfile') return 'dockerfile';
  if (fileName === 'makefile') return 'makefile';
  // Extension-based detection
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return 'plaintext';
  const ext = fileName.slice(dotIndex);
  return EXT_TO_LANGUAGE[ext] || 'plaintext';
}

/* ── Define theme from CSS variables to match current Synapse theme ── */
let _themeVersion = 0;
function buildSynapseTheme() {
  const s = getComputedStyle(document.documentElement);
  const v = (name) => s.getPropertyValue(name).trim();

  const bg = v('--editor-bg') || '#0a0a0c';
  const fg = v('--editor-fg') || '#F5F5F7';
  const lineNum = v('--editor-line-number') || '#555555';
  const lineNumActive = v('--editor-line-number-active') || '#A1A1A6';
  const selection = v('--editor-selection') || 'rgba(155, 124, 240, 0.2)';
  const lineHighlight = v('--editor-line-highlight') || 'rgba(255, 255, 255, 0.03)';
  const cursor = v('--editor-cursor') || '#9B7CF0';
  const widgetBg = v('--editor-widget-bg') || '#121214';
  const widgetBorder = v('--editor-widget-border') || 'rgba(255, 255, 255, 0.08)';
  const base = v('--editor-base') || 'vs-dark';

  const themeName = 'synapse-dynamic-' + (++_themeVersion);
  monaco.editor.defineTheme(themeName, {
    base: base === 'vs' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': lineNum,
      'editorLineNumber.activeForeground': lineNumActive,
      'editor.selectionBackground': selection,
      'editor.lineHighlightBackground': lineHighlight,
      'editor.lineHighlightBorder': '#00000000',
      'editor.rangeHighlightBackground': base === 'vs' ? '#00000008' : '#ffffff08',
      'editor.rangeHighlightBorder': '#00000000',
      'editorCursor.foreground': cursor,
      'editorWidget.background': widgetBg,
      'editorWidget.border': widgetBorder,
      'editorSuggestWidget.background': widgetBg,
      'editorSuggestWidget.border': widgetBorder,
      'editorSuggestWidget.selectedBackground': selection,
      'scrollbarSlider.background': base === 'vs' ? '#00000012' : '#ffffff12',
      'scrollbarSlider.hoverBackground': base === 'vs' ? '#00000020' : '#ffffff20',
      'scrollbarSlider.activeBackground': base === 'vs' ? '#00000030' : '#ffffff30',
    },
  });
  return themeName;
}

/* ── Module-level breakpoint storage ────────────────────────── */
// Persists breakpoints across component re-renders and file switches.
// Map<filePath, Set<lineNumber>>
const allBreakpoints = new Map();

/* ── Diagnostics severity mapping ───────────────────────────── */
const SEVERITY_MAP = {
  error:   monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info:    monaco.MarkerSeverity.Info,
  hint:    monaco.MarkerSeverity.Hint,
};

/** Map a severity string from the IPC response to a Monaco MarkerSeverity value. */
function mapSeverity(severity) {
  return SEVERITY_MAP[severity] || monaco.MarkerSeverity.Error;
}

/** Map a severity string to its gutter decoration CSS class. */
function severityToGlyphClass(severity) {
  switch (severity) {
    case 'warning': return 'diagnostic-warning-glyph';
    case 'info':    return 'diagnostic-info-glyph';
    case 'hint':    return 'diagnostic-info-glyph';
    default:        return 'diagnostic-error-glyph';
  }
}

/** Unique owner string for diagnostics markers — avoids conflicts with breakpoints. */
const DIAGNOSTICS_OWNER = 'synapse-diagnostics';

export default function CodeEditor({ filePath, workspaceId, workspacePath }) {
  const dispatch = useDispatch();
  const state = useAppState();
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const modelRef = useRef(null);
  const onChangeDisposableRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSaving, setShowSaving] = useState(false);

  // Track current file path for cleanup/comparison
  const currentFilePathRef = useRef(null);
  // Track the file's ID for dirty/clean dispatch
  const fileIdRef = useRef(null);
  // Track original content for dirty detection
  const originalContentRef = useRef('');

  // Breakpoint decoration IDs for the current file (used by deltaDecorations)
  const breakpointDecorationsRef = useRef([]);
  // Ref to the gutter click disposable so we can clean up
  const gutterClickDisposableRef = useRef(null);

  // Diagnostics decoration IDs for the current file (gutter icons)
  const diagnosticDecorationsRef = useRef([]);
  // Debounce timer ref for diagnostics
  const diagnosticsTimerRef = useRef(null);
  // Track whether current file had a load error or is binary (skip diagnostics)
  const fileLoadFailedRef = useRef(false);

  // Debug current-line decoration IDs
  const debugLineDecorationsRef = useRef([]);

  // Find the file ID from state
  const openFiles = state.ideOpenFiles[workspaceId] || [];
  const activeFileId = state.ideActiveFileId[workspaceId];
  const activeFile = openFiles.find(f => f.id === activeFileId);

  // Update fileIdRef when active file changes
  useEffect(() => {
    if (activeFile) {
      fileIdRef.current = activeFile.id;
    }
  }, [activeFile]);

  /* ── Breakpoint helpers ─────────────────────────────────────── */

  /**
   * Rebuild Monaco glyph-margin decorations from the breakpoint Set
   * for the current file path.
   */
  const updateBreakpointDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const fp = currentFilePathRef.current;
    const bpSet = fp ? (allBreakpoints.get(fp) || new Set()) : new Set();

    const newDecorations = Array.from(bpSet).map((lineNumber) => ({
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'breakpoint-glyph',
        glyphMarginHoverMessage: { value: 'Breakpoint on line ' + lineNumber },
      },
    }));

    breakpointDecorationsRef.current = editor.deltaDecorations(
      breakpointDecorationsRef.current,
      newDecorations
    );
  }, []);

  /**
   * Toggle a breakpoint at the given line for the current file.
   * Updates the module-level Map, refreshes decorations, and dispatches
   * to AppContext.
   */
  const toggleBreakpoint = useCallback((lineNumber) => {
    const fp = currentFilePathRef.current;
    if (!fp) return;

    if (!allBreakpoints.has(fp)) {
      allBreakpoints.set(fp, new Set());
    }
    const bpSet = allBreakpoints.get(fp);

    const isAdding = !bpSet.has(lineNumber);
    if (isAdding) {
      bpSet.add(lineNumber);
    } else {
      bpSet.delete(lineNumber);
    }

    // Clean up empty sets
    if (bpSet.size === 0) {
      allBreakpoints.delete(fp);
    }

    // Refresh decorations
    updateBreakpointDecorations();

    // Dispatch to AppContext — task 1.1 adds DEBUG_TOGGLE_BREAKPOINT.
    // Wrap in try/catch in case the action type doesn't exist yet.
    try {
      dispatch({
        type: 'DEBUG_TOGGLE_BREAKPOINT',
        filePath: fp,
        lineNumber,
        enabled: isAdding,
      });
    } catch (_err) {
      // Action type may not exist yet if task 1.1 hasn't landed.
      // Breakpoints still work locally via module-level Map.
    }
  }, [dispatch, updateBreakpointDecorations]);

  /* ── Diagnostics helpers ────────────────────────────────────── */

  /**
   * Run syntax diagnostics for the given file path. Debounced at 500ms.
   * Calls IPC, converts results to Monaco markers + gutter decorations,
   * and dispatches to AppContext.
   */
  const runDiagnostics = useCallback((targetFilePath, targetWorkspacePath) => {
    // Clear any pending debounce timer
    if (diagnosticsTimerRef.current) {
      clearTimeout(diagnosticsTimerRef.current);
      diagnosticsTimerRef.current = null;
    }

    // Skip if file load failed or file is binary
    if (fileLoadFailedRef.current) return;

    // Skip if no file or no workspace path
    if (!targetFilePath || !targetWorkspacePath) return;

    // Skip if IPC not available
    if (!window.electronAPI?.ideCheckSyntax) return;

    diagnosticsTimerRef.current = setTimeout(async () => {
      try {
        const result = await window.electronAPI.ideCheckSyntax(
          targetFilePath,
          targetWorkspacePath
        );

        // Ensure we're still on the same file (user may have switched)
        if (currentFilePathRef.current !== targetFilePath) return;

        const editor = editorRef.current;
        const model = modelRef.current;
        if (!editor || !model) return;

        if (result && result.success && Array.isArray(result.diagnostics)) {
          const diagnostics = result.diagnostics;

          // Convert to Monaco markers
          const markers = diagnostics.map((d) => ({
            startLineNumber: d.line || 1,
            startColumn: d.column || 1,
            endLineNumber: d.endLine || d.line || 1,
            endColumn: d.endColumn || (d.column ? d.column + 1 : 2),
            message: d.message || 'Unknown error',
            severity: mapSeverity(d.severity),
            source: d.source || DIAGNOSTICS_OWNER,
          }));

          // Apply markers (squiggly underlines)
          monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, markers);

          // Build gutter decorations for diagnostic lines
          // Deduplicate by line — show highest severity per line
          const lineMap = new Map(); // lineNumber -> { severity, message }
          const severityRank = { error: 3, warning: 2, info: 1, hint: 0 };
          for (const d of diagnostics) {
            const line = d.line || 1;
            const rank = severityRank[d.severity] ?? 0;
            const existing = lineMap.get(line);
            if (!existing || rank > (severityRank[existing.severity] ?? 0)) {
              lineMap.set(line, { severity: d.severity, message: d.message });
            }
          }

          const newDecorations = Array.from(lineMap.entries()).map(
            ([lineNumber, { severity, message }]) => ({
              range: new monaco.Range(lineNumber, 1, lineNumber, 1),
              options: {
                isWholeLine: false,
                glyphMarginClassName: severityToGlyphClass(severity),
                glyphMarginHoverMessage: { value: message || 'Diagnostic' },
              },
            })
          );

          diagnosticDecorationsRef.current = editor.deltaDecorations(
            diagnosticDecorationsRef.current,
            newDecorations
          );

          // Dispatch to AppContext
          try {
            dispatch({
              type: 'DIAGNOSTICS_SET',
              filePath: targetFilePath,
              diagnostics,
            });
          } catch (_err) {
            // DIAGNOSTICS_SET may not exist yet
          }
        } else {
          // No diagnostics or error — clear everything
          monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, []);
          diagnosticDecorationsRef.current = editor.deltaDecorations(
            diagnosticDecorationsRef.current,
            []
          );
          try {
            dispatch({
              type: 'DIAGNOSTICS_SET',
              filePath: targetFilePath,
              diagnostics: [],
            });
          } catch (_err) {
            // Ignored
          }
        }
      } catch (err) {
        console.error('[CodeEditor] Diagnostics check failed:', err);
      }
    }, 500);
  }, [dispatch]);

  /**
   * Clear all diagnostics for the current file — markers, gutter decorations,
   * and AppContext state.
   */
  const clearDiagnostics = useCallback((targetFilePath) => {
    // Cancel any pending diagnostics timer
    if (diagnosticsTimerRef.current) {
      clearTimeout(diagnosticsTimerRef.current);
      diagnosticsTimerRef.current = null;
    }

    const editor = editorRef.current;
    const model = modelRef.current;

    // Clear Monaco markers
    if (model) {
      monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, []);
    }

    // Clear gutter decorations
    if (editor) {
      diagnosticDecorationsRef.current = editor.deltaDecorations(
        diagnosticDecorationsRef.current,
        []
      );
    }

    // Clear AppContext state
    if (targetFilePath) {
      try {
        dispatch({ type: 'DIAGNOSTICS_CLEAR_FILE', filePath: targetFilePath });
      } catch (_err) {
        // DIAGNOSTICS_CLEAR_FILE may not exist yet
      }
    }
  }, [dispatch]);

  /* ── Save handler ───────────────────────────────────────────── */
  const handleSave = useCallback(async () => {
    if (!editorRef.current || !filePath || !workspacePath) return;
    const content = editorRef.current.getValue();
    try {
      const result = await window.electronAPI.ideWriteFile(filePath, content, workspacePath);
      if (result && result.success !== false) {
        originalContentRef.current = content;
        if (fileIdRef.current && workspaceId) {
          dispatch({ type: 'IDE_MARK_FILE_CLEAN', workspaceId, fileId: fileIdRef.current });
        }
        setShowSaving(true);
        setTimeout(() => setShowSaving(false), 1500);

        // Re-run diagnostics after save
        runDiagnostics(filePath, workspacePath);
      }
    } catch (err) {
      console.error('[CodeEditor] Save failed:', err);
    }
  }, [filePath, workspacePath, workspaceId, dispatch, runDiagnostics]);

  /* ── Create / destroy editor instance ───────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const initialTheme = buildSynapseTheme();

    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'plaintext',
      theme: initialTheme,
      automaticLayout: false,
      glyphMargin: true,
      minimap: { enabled: true, scale: 1, showSlider: 'mouseover' },
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Menlo, Monaco, monospace",
      fontLigatures: true,
      lineHeight: 20,
      padding: { top: 8, bottom: 8 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      wordWrap: 'off',
      tabSize: 2,
      insertSpaces: true,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        useShadows: false,
      },
      renderLineHighlight: 'none',
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      contextmenu: true,
      fixedOverflowWidgets: true,
    });

    editorRef.current = editor;

    // Cmd+S / Ctrl+S keybinding
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    // ResizeObserver for responsive layout
    const resizeObserver = new ResizeObserver(() => {
      editor.layout();
    });
    resizeObserver.observe(containerRef.current);

    // Watch for theme changes and rebuild Monaco theme
    const themeObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme' || m.attributeName === 'style') {
          const newTheme = buildSynapseTheme();
          monaco.editor.setTheme(newTheme);
          break;
        }
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      if (onChangeDisposableRef.current) {
        onChangeDisposableRef.current.dispose();
        onChangeDisposableRef.current = null;
      }
      if (gutterClickDisposableRef.current) {
        gutterClickDisposableRef.current.dispose();
        gutterClickDisposableRef.current = null;
      }
      // Clear diagnostics timer on unmount
      if (diagnosticsTimerRef.current) {
        clearTimeout(diagnosticsTimerRef.current);
        diagnosticsTimerRef.current = null;
      }
      editor.dispose();
      editorRef.current = null;
      modelRef.current = null;
      breakpointDecorationsRef.current = [];
      diagnosticDecorationsRef.current = [];
      debugLineDecorationsRef.current = [];
    };
  }, []); // Only run once on mount

  /* ── Attach gutter click handler (updates when toggleBreakpoint changes) ── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // Dispose old handler if present
    if (gutterClickDisposableRef.current) {
      gutterClickDisposableRef.current.dispose();
    }

    gutterClickDisposableRef.current = editor.onMouseDown((e) => {
      if (
        e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        const lineNumber = e.target.position?.lineNumber;
        if (lineNumber) {
          toggleBreakpoint(lineNumber);
        }
      }
    });

    return () => {
      if (gutterClickDisposableRef.current) {
        gutterClickDisposableRef.current.dispose();
        gutterClickDisposableRef.current = null;
      }
    };
  }, [toggleBreakpoint]);

  // Update the save command when handleSave changes (filePath/workspacePath change)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Re-register the save command with updated closure
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });
  }, [handleSave]);

  /* ── Load file content when filePath changes ────────────────── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // If no file, show empty
    if (!filePath) {
      editor.setValue('');
      const model = editor.getModel();
      if (model) monaco.editor.setModelLanguage(model, 'plaintext');
      currentFilePathRef.current = null;
      fileLoadFailedRef.current = false;
      // Clear breakpoint decorations when no file
      breakpointDecorationsRef.current = editor.deltaDecorations(
        breakpointDecorationsRef.current, []
      );
      // Clear diagnostic decorations when no file
      diagnosticDecorationsRef.current = editor.deltaDecorations(
        diagnosticDecorationsRef.current, []
      );
      return;
    }

    // If same file, skip reload
    if (filePath === currentFilePathRef.current) return;

    // Clear diagnostics for the previous file before switching
    const prevFilePath = currentFilePathRef.current;
    if (prevFilePath) {
      clearDiagnostics(prevFilePath);
    }

    currentFilePathRef.current = filePath;
    fileLoadFailedRef.current = false;

    let cancelled = false;

    async function loadFile() {
      setLoading(true);
      setError(null);
      try {
        const result = await window.electronAPI.ideReadFile(filePath, workspacePath);
        if (cancelled) return;

        if (!result || result.success === false) {
          setError(result?.error || 'Failed to read file');
          editor.setValue('');
          fileLoadFailedRef.current = true;
          setLoading(false);
          return;
        }

        if (result.binary) {
          setError('Binary file — cannot display');
          editor.setValue('');
          fileLoadFailedRef.current = true;
          setLoading(false);
          return;
        }

        const content = result.content || '';
        originalContentRef.current = content;
        fileLoadFailedRef.current = false;

        // Dispose old change listener before setting value
        if (onChangeDisposableRef.current) {
          onChangeDisposableRef.current.dispose();
          onChangeDisposableRef.current = null;
        }

        // Set content and language
        editor.setValue(content);
        const lang = detectLanguage(filePath);
        const model = editor.getModel();
        if (model) {
          monaco.editor.setModelLanguage(model, lang);
          modelRef.current = model;
        }

        // Scroll to top on new file
        editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
        editor.setPosition({ lineNumber: 1, column: 1 });

        // Restore breakpoint decorations for this file
        updateBreakpointDecorations();

        // Run diagnostics on file load
        runDiagnostics(filePath, workspacePath);

        // Attach content change listener
        onChangeDisposableRef.current = editor.onDidChangeModelContent(() => {
          const currentContent = editor.getValue();
          const isDirty = currentContent !== originalContentRef.current;
          if (isDirty && fileIdRef.current && workspaceId) {
            dispatch({ type: 'IDE_MARK_FILE_DIRTY', workspaceId, fileId: fileIdRef.current });
          }
        });

        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError('Error loading file: ' + err.message);
        fileLoadFailedRef.current = true;
        setLoading(false);
      }
    }

    loadFile();

    return () => {
      cancelled = true;
    };
  }, [filePath, workspacePath, workspaceId, dispatch, updateBreakpointDecorations, runDiagnostics, clearDiagnostics]);

  /* ── Debug current-line highlight ──────────────────────────── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const debugSession = state.debugSession || { status: 'idle' };
    const isPaused = debugSession.status === 'paused';
    const pausedFile = debugSession.pausedFile;
    const pausedLine = debugSession.pausedLine;

    // Only show highlight if this editor's file matches the paused file
    if (isPaused && pausedFile && pausedLine && pausedFile === currentFilePathRef.current) {
      debugLineDecorationsRef.current = editor.deltaDecorations(
        debugLineDecorationsRef.current,
        [{
          range: new monaco.Range(pausedLine, 1, pausedLine, 1),
          options: {
            isWholeLine: true,
            className: 'debug-current-line',
            glyphMarginClassName: 'debug-current-line-glyph',
          },
        }]
      );
      // Scroll to the paused line
      editor.revealLineInCenter(pausedLine);
    } else {
      // Clear the debug line decoration
      if (debugLineDecorationsRef.current.length > 0) {
        debugLineDecorationsRef.current = editor.deltaDecorations(
          debugLineDecorationsRef.current,
          []
        );
      }
    }
  }, [state.debugSession, state.debugSession?.status, state.debugSession?.pausedFile, state.debugSession?.pausedLine, filePath]);

  /* ── Navigate to line (from debug panel / problems panel) ──── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const nav = state.ideNavigateToLine;
    if (!nav || nav.filePath !== filePath) return;

    // Jump to line+column
    editor.revealLineInCenter(nav.line || 1);
    editor.setPosition({ lineNumber: nav.line || 1, column: nav.column || 1 });
    editor.focus();
  }, [state.ideNavigateToLine, filePath]);

  /* ── Render ─────────────────────────────────────────────────── */
  if (!filePath) {
    return (
      <div className="code-editor-container">
        <div className="code-editor-empty">
          No file selected — open a file from the explorer
        </div>
      </div>
    );
  }

  return (
    <div className="code-editor-container">
      {loading && (
        <div className="code-editor-loading">Loading...</div>
      )}
      {error && !loading && (
        <div className="code-editor-error">{error}</div>
      )}
      {showSaving && (
        <div className="code-editor-saving">Saved</div>
      )}
      <div
        ref={containerRef}
        className="code-editor-monaco"
        style={{ display: loading || error ? 'none' : 'block' }}
      />
    </div>
  );
}
