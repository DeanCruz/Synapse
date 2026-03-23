/**
 * CodeEditor — Monaco Editor wrapper for the Synapse IDE.
 *
 * Displays file contents with syntax highlighting, supports Cmd+S/Ctrl+S
 * to save, auto-detects language from file extension, and tracks dirty state.
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
      }
    } catch (err) {
      console.error('[CodeEditor] Save failed:', err);
    }
  }, [filePath, workspacePath, workspaceId, dispatch]);

  /* ── Create / destroy editor instance ───────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const initialTheme = buildSynapseTheme();

    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'plaintext',
      theme: initialTheme,
      automaticLayout: false,
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
      editor.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []); // Only run once on mount

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
      return;
    }

    // If same file, skip reload
    if (filePath === currentFilePathRef.current) return;
    currentFilePathRef.current = filePath;

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
          setLoading(false);
          return;
        }

        if (result.binary) {
          setError('Binary file — cannot display');
          editor.setValue('');
          setLoading(false);
          return;
        }

        const content = result.content || '';
        originalContentRef.current = content;

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
        setLoading(false);
      }
    }

    loadFile();

    return () => {
      cancelled = true;
    };
  }, [filePath, workspacePath, workspaceId, dispatch]);

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
