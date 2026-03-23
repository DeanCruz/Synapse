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

/* ── Define custom dark theme to match Synapse ──────────────── */
let themeRegistered = false;
function ensureTheme() {
  if (themeRegistered) return;
  themeRegistered = true;
  monaco.editor.defineTheme('synapse-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0a0a0c',
      'editor.foreground': '#F5F5F7',
      'editorLineNumber.foreground': '#555555',
      'editorLineNumber.activeForeground': '#A1A1A6',
      'editor.selectionBackground': '#9B7CF033',
      'editor.lineHighlightBackground': '#ffffff08',
      'editorCursor.foreground': '#9B7CF0',
      'editorWidget.background': '#121214',
      'editorWidget.border': '#ffffff14',
      'editorSuggestWidget.background': '#121214',
      'editorSuggestWidget.border': '#ffffff14',
      'editorSuggestWidget.selectedBackground': '#9B7CF022',
      'scrollbarSlider.background': '#ffffff12',
      'scrollbarSlider.hoverBackground': '#ffffff20',
      'scrollbarSlider.activeBackground': '#ffffff30',
    },
  });
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

    ensureTheme();

    const editor = monaco.editor.create(containerRef.current, {
      value: '',
      language: 'plaintext',
      theme: 'synapse-dark',
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

    return () => {
      resizeObserver.disconnect();
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
