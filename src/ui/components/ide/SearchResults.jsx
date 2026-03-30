// SearchResults — Renders grouped search results with highlighted matches
// Each file group is collapsible; clicking a match navigates to that file:line.

import React, { useState } from 'react';

// ── SVG Icons ──────────────────────────────────────────────────

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// ── Match Highlight ─────────────────────────────────────────────

function MatchHighlight({ lineContent, matchStart, matchLength }) {
  var before = lineContent.slice(0, matchStart);
  var match = lineContent.slice(matchStart, matchStart + matchLength);
  var after = lineContent.slice(matchStart + matchLength);

  // Trim leading whitespace for display but keep enough context
  var trimmed = before.replace(/^\s+/, '');
  var trimCount = before.length - trimmed.length;

  return (
    <span className="ide-search-match-content" title={lineContent}>
      {trimCount > 0 && trimmed.length === 0 ? '' : trimmed}
      <mark className="ide-search-match-highlight">{match}</mark>
      {after}
    </span>
  );
}

// ── File Group ─────────────────────────────────────────────────

function FileGroup({ fileResult, onResultClick, defaultExpanded }) {
  var [expanded, setExpanded] = useState(defaultExpanded);
  var fileName = fileResult.relativePath
    ? fileResult.relativePath.split('/').pop()
    : fileResult.file.split('/').pop();
  var dirPath = fileResult.relativePath
    ? fileResult.relativePath.split('/').slice(0, -1).join('/')
    : '';

  return (
    <div className="ide-search-file-group">
      <div
        className="ide-search-file-header"
        onClick={() => setExpanded(e => !e)}
      >
        <span className={'ide-search-chevron' + (expanded ? ' expanded' : '')}>
          <ChevronIcon />
        </span>
        <span className="ide-search-file-icon">
          <FileIcon />
        </span>
        <span className="ide-search-file-name" title={fileResult.file}>
          {fileName}
        </span>
        {dirPath && (
          <span className="ide-search-file-path" title={fileResult.relativePath}>
            {dirPath}
          </span>
        )}
        <span className="ide-search-file-count">
          {fileResult.matches.length}
        </span>
      </div>

      {expanded && fileResult.matches.map((match, i) => (
        <div
          key={match.line + '-' + match.column + '-' + i}
          className="ide-search-match"
          onClick={() => onResultClick(fileResult.file, match.line, match.column)}
        >
          <span className="ide-search-match-line-num">{match.line}</span>
          <MatchHighlight
            lineContent={match.lineContent}
            matchStart={match.matchStart}
            matchLength={match.matchLength}
          />
        </div>
      ))}
    </div>
  );
}

// ── SearchResults ──────────────────────────────────────────────

export default function SearchResults({ results, loading, totalMatches, truncated, onResultClick, error }) {
  if (loading) {
    return (
      <div className="ide-search-loading">
        <div className="ide-search-loading-spinner" />
        Searching...
      </div>
    );
  }

  if (error) {
    return <div className="ide-search-error">{error}</div>;
  }

  if (!results) {
    return <div className="ide-search-empty">Type to search across files</div>;
  }

  if (results.length === 0) {
    return <div className="ide-search-empty">No results found</div>;
  }

  return (
    <>
      <div className="ide-search-summary">
        {totalMatches} result{totalMatches !== 1 ? 's' : ''} in {results.length} file{results.length !== 1 ? 's' : ''}
        {truncated && <span className="ide-search-summary-truncated"> (truncated)</span>}
      </div>
      <div className="ide-search-results">
        {results.map(fileResult => (
          <FileGroup
            key={fileResult.file}
            fileResult={fileResult}
            onResultClick={onResultClick}
            defaultExpanded={results.length <= 20}
          />
        ))}
      </div>
    </>
  );
}
