// SearchPanel — IDE search sidebar with text/regex/case/word search, replace, and glob filters
// Replaces the file explorer in the sidebar when ideSidebarView === 'search'.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppState, useDispatch } from '../../context/AppContext.jsx';
import SearchResults from './SearchResults.jsx';
import '../../styles/ide-search.css';

// ── SVG Icons ──────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 3H4v10h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 6l-3 2 3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 8h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReplaceIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 3H5a2 2 0 00-2 2v0a2 2 0 002 2h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9 5l2 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 13h6a2 2 0 002-2v0a2 2 0 00-2-2H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M7 11l-2-2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReplaceAllIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12 6l-2 2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── SearchPanel Component ──────────────────────────────────────

export default function SearchPanel() {
  var state = useAppState();
  var dispatch = useDispatch();
  var inputRef = useRef(null);
  var debounceRef = useRef(null);
  var [showFilters, setShowFilters] = useState(false);
  var [searchError, setSearchError] = useState(null);

  var workspace = state.ideWorkspaces.find(function(w) { return w.id === state.ideActiveWorkspaceId; });
  var query = state.ideSearchQuery;
  var options = state.ideSearchOptions;
  var results = state.ideSearchResults;
  var loading = state.ideSearchLoading;
  var replaceMode = state.ideSearchReplaceMode;
  var replaceText = state.ideSearchReplaceText;

  // Focus input on mount
  useEffect(function() {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Execute search
  var executeSearch = useCallback(function(searchQuery, searchOptions) {
    searchOptions = searchOptions || options;
    if (!searchQuery || !workspace) {
      dispatch({ type: 'IDE_SET_SEARCH_RESULTS', results: null, totalMatches: 0 });
      setSearchError(null);
      return;
    }
    dispatch({ type: 'IDE_SET_SEARCH_LOADING', value: true });
    setSearchError(null);

    var api = window.electronAPI;
    if (!api || !api.ideSearch) {
      dispatch({ type: 'IDE_SET_SEARCH_RESULTS', results: [], totalMatches: 0 });
      return;
    }

    api.ideSearch(workspace.path, searchQuery, searchOptions).then(function(result) {
      if (result.success) {
        dispatch({
          type: 'IDE_SET_SEARCH_RESULTS',
          results: result.results,
          totalMatches: result.totalMatches,
          truncated: result.truncated,
        });
      } else {
        dispatch({ type: 'IDE_SET_SEARCH_RESULTS', results: [], totalMatches: 0 });
        setSearchError(result.error || 'Search failed');
      }
    }).catch(function(err) {
      dispatch({ type: 'IDE_SET_SEARCH_RESULTS', results: [], totalMatches: 0 });
      setSearchError(err.message || 'Search failed');
    });
  }, [workspace, options, dispatch]);

  // Input change with debounce
  var handleInputChange = useCallback(function(e) {
    var value = e.target.value;
    dispatch({ type: 'IDE_SET_SEARCH_QUERY', query: value });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(function() { executeSearch(value); }, 300);
  }, [dispatch, executeSearch]);

  // Keyboard shortcuts within search input
  var handleKeyDown = useCallback(function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      executeSearch(query);
    }
    if (e.key === 'Escape') {
      if (results) {
        dispatch({ type: 'IDE_CLEAR_SEARCH' });
        setSearchError(null);
      } else {
        dispatch({ type: 'SET', key: 'ideSidebarView', value: 'explorer' });
      }
    }
  }, [query, results, executeSearch, dispatch]);

  // Toggle a search option and re-search
  var toggleOption = useCallback(function(key) {
    var newOptions = { [key]: !options[key] };
    dispatch({ type: 'IDE_SET_SEARCH_OPTIONS', options: newOptions });
    // Re-search with updated options after state update
    if (query) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(function() {
        executeSearch(query, { ...options, ...newOptions });
      }, 100);
    }
  }, [options, query, dispatch, executeSearch]);

  // Navigate to a search result
  var handleResultClick = useCallback(function(filePath, line, column) {
    if (!state.ideActiveWorkspaceId) return;
    dispatch({
      type: 'IDE_OPEN_FILE',
      workspaceId: state.ideActiveWorkspaceId,
      file: { path: filePath, name: filePath.split('/').pop() },
    });
    dispatch({
      type: 'SET',
      key: 'ideNavigateToLine',
      value: { filePath: filePath, line: line, column: column || 1, ts: Date.now() },
    });
  }, [state.ideActiveWorkspaceId, dispatch]);

  // Replace all matches across all files
  var handleReplaceAll = useCallback(function() {
    if (!results || !replaceText === undefined || !workspace) return;
    var api = window.electronAPI;
    if (!api || !api.ideSearchReplace) return;

    var replacements = results.map(function(fileResult) {
      return {
        file: fileResult.file,
        matches: fileResult.matches,
        replacement: replaceText,
      };
    });

    api.ideSearchReplace(workspace.path, replacements).then(function(result) {
      if (result.success) {
        // Re-search to update results
        executeSearch(query);
      } else {
        setSearchError(result.error || 'Replace failed');
      }
    }).catch(function(err) {
      setSearchError(err.message || 'Replace failed');
    });
  }, [results, replaceText, workspace, query, executeSearch]);

  // Replace all matches in a single file
  var handleReplaceInFile = useCallback(function(fileResult) {
    if (!workspace) return;
    var api = window.electronAPI;
    if (!api || !api.ideSearchReplace) return;

    api.ideSearchReplace(workspace.path, [{
      file: fileResult.file,
      matches: fileResult.matches,
      replacement: replaceText,
    }]).then(function(result) {
      if (result.success) {
        executeSearch(query);
      }
    });
  }, [workspace, replaceText, query, executeSearch]);

  // Filter change handlers
  var handleIncludeChange = useCallback(function(e) {
    dispatch({ type: 'IDE_SET_SEARCH_OPTIONS', options: { includeGlob: e.target.value } });
  }, [dispatch]);

  var handleExcludeChange = useCallback(function(e) {
    dispatch({ type: 'IDE_SET_SEARCH_OPTIONS', options: { excludeGlob: e.target.value } });
  }, [dispatch]);

  // Apply filters on Enter
  var handleFilterKeyDown = useCallback(function(e) {
    if (e.key === 'Enter' && query) {
      executeSearch(query);
    }
  }, [query, executeSearch]);

  return (
    <div className="ide-search">
      <div className="ide-search-header">
        <span className="ide-search-title">Search</span>
        <div className="ide-search-header-actions">
          {results && (
            <button
              className="ide-explorer-action-btn"
              onClick={function() { dispatch({ type: 'IDE_CLEAR_SEARCH' }); setSearchError(null); }}
              title="Clear search"
            >
              <ClearIcon />
            </button>
          )}
          <button
            className="ide-explorer-action-btn"
            onClick={function() { dispatch({ type: 'SET', key: 'ideSidebarView', value: 'explorer' }); }}
            title="Back to Explorer"
          >
            <BackIcon />
          </button>
        </div>
      </div>

      <div className="ide-search-inputs">
        <div className="ide-search-query-row">
          <button
            className={'ide-search-mode-toggle' + (replaceMode ? ' expanded' : '')}
            onClick={function() { dispatch({ type: 'IDE_SET_SEARCH_REPLACE_MODE', value: !replaceMode }); }}
            title={replaceMode ? 'Hide replace' : 'Show replace'}
          >
            <ChevronIcon />
          </button>
          <input
            ref={inputRef}
            className="ide-search-input"
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search"
            spellCheck={false}
          />
          <button
            className={'ide-search-toggle' + (options.regex ? ' active' : '')}
            title="Use Regular Expression"
            onClick={function() { toggleOption('regex'); }}
          >.*</button>
          <button
            className={'ide-search-toggle' + (options.caseSensitive ? ' active' : '')}
            title="Match Case"
            onClick={function() { toggleOption('caseSensitive'); }}
          >Aa</button>
          <button
            className={'ide-search-toggle' + (options.wholeWord ? ' active' : '')}
            title="Match Whole Word"
            onClick={function() { toggleOption('wholeWord'); }}
          ><span style={{ textDecoration: 'underline' }}>ab</span></button>
        </div>

        {replaceMode && (
          <div className="ide-search-replace-row">
            <div style={{ width: 20, flexShrink: 0 }} />
            <input
              className="ide-search-input"
              type="text"
              value={replaceText}
              onChange={function(e) { dispatch({ type: 'IDE_SET_SEARCH_REPLACE_TEXT', text: e.target.value }); }}
              placeholder="Replace"
              spellCheck={false}
              onKeyDown={function(e) {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleReplaceAll();
                }
              }}
            />
            <div className="ide-search-replace-actions">
              <button
                className="ide-search-replace-btn"
                onClick={handleReplaceAll}
                title="Replace All"
              >
                <ReplaceAllIcon />
              </button>
            </div>
          </div>
        )}

        {/* Toggle filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={function() { setShowFilters(!showFilters); }}>
          <span className={'ide-search-chevron' + (showFilters ? ' expanded' : '')} style={{ width: 12, height: 12 }}>
            <ChevronIcon />
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>files to include/exclude</span>
        </div>

        {showFilters && (
          <div className="ide-search-filters">
            <input
              className="ide-search-filter-input"
              type="text"
              value={options.includeGlob}
              onChange={handleIncludeChange}
              onKeyDown={handleFilterKeyDown}
              placeholder="Include: e.g. *.js, src/**"
              spellCheck={false}
            />
            <input
              className="ide-search-filter-input"
              type="text"
              value={options.excludeGlob}
              onChange={handleExcludeChange}
              onKeyDown={handleFilterKeyDown}
              placeholder="Exclude: e.g. *.min.js, dist/**"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      <SearchResults
        results={results}
        loading={loading}
        totalMatches={state.ideSearchTotalMatches}
        truncated={state.ideSearchTruncated}
        onResultClick={handleResultClick}
        error={searchError}
      />
    </div>
  );
}
