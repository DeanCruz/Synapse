// electron/services/PreviewService.js — Label-to-Source Mapper Service
// Scans JSX/TSX/HTML files in the target project for data-synapse-label attributes
// and builds a reverse map from label value to source file location (path, line, text).
// Used by the Live Preview to locate source code when a user edits text inline.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directories to always skip during scanning. */
var SKIP_DIRS = ['node_modules', '.next', 'dist', 'build', '.git'];

/** File extensions to scan. */
var DEFAULT_EXTENSIONS = ['.jsx', '.tsx', '.html', '.htm'];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

var broadcastFn = null;       // (channel, data) => void — sends to renderer

/** Cached label map: { [label]: { file, line, text } } */
var cachedLabelMap = null;

/** File modification times from the last scan: { [filePath]: mtimeMs } */
var cachedMtimes = {};

/** The project path used for the cached scan. */
var cachedProjectPath = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the PreviewService with a broadcast function for push events.
 * @param {Function} broadcast — (channel, data) => void
 */
function init(broadcast) {
  broadcastFn = broadcast;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walk a directory, collecting file paths that match the given extensions.
 * Skips directories listed in SKIP_DIRS.
 *
 * @param {string} dir — absolute path to directory
 * @param {string[]} extensions — file extensions to include
 * @param {string[]} results — accumulator array (mutated)
 * @returns {string[]} — array of matching absolute file paths
 */
function walkDir(dir, extensions, results) {
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // Permission errors, missing dirs — skip silently
    return results;
  }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.indexOf(entry.name) === -1) {
        walkDir(fullPath, extensions, results);
      }
    } else if (entry.isFile()) {
      var ext = path.extname(entry.name).toLowerCase();
      if (extensions.indexOf(ext) !== -1) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Extract text content between an opening tag (after ">") and its closing tag.
 * Handles both single-line and multi-line content.
 * Strips JSX expressions { ... } and nested HTML tags, returning only literal text.
 *
 * @param {string} source — full file content
 * @param {number} afterTagPos — position right after the ">" of the opening tag
 * @param {string} tagName — the element tag name (case-insensitive)
 * @returns {string|null} — trimmed text content, or null if no closing tag found
 */
function extractTextContent(source, afterTagPos, tagName) {
  // Find the closing tag
  var closingTag = new RegExp('</' + tagName + '\\s*>', 'i');
  var remaining = source.substring(afterTagPos);
  var closingMatch = closingTag.exec(remaining);
  if (!closingMatch) {
    return null;
  }

  var innerContent = remaining.substring(0, closingMatch.index);

  // Strip JSX expressions { ... } (handle nested braces)
  var stripped = '';
  var braceDepth = 0;
  for (var i = 0; i < innerContent.length; i++) {
    var ch = innerContent[i];
    if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (braceDepth === 0) {
      stripped += ch;
    }
  }

  // Strip child HTML/JSX tags
  stripped = stripped.replace(/<[^>]*>/g, '');

  // Collapse whitespace and trim
  stripped = stripped.replace(/\s+/g, ' ').trim();

  return stripped.length > 0 ? stripped : '';
}

/**
 * Count the number of newlines before a given position to determine the 1-based line number.
 *
 * @param {string} source — full file content
 * @param {number} position — character offset
 * @returns {number} — 1-based line number
 */
function getLineNumber(source, position) {
  var line = 1;
  for (var i = 0; i < position && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan all JSX/TSX/HTML files in a project directory for data-synapse-label attributes.
 * Builds a map of label values to their source locations.
 *
 * @param {string} projectPath — absolute path to the project root
 * @returns {{ [label: string]: { file: string, line: number, text: string } } | { error: string }}
 */
function scanLabels(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    return { error: 'Project path does not exist: ' + projectPath };
  }

  var stat = fs.statSync(projectPath);
  if (!stat.isDirectory()) {
    return { error: 'Project path is not a directory: ' + projectPath };
  }

  // Collect all matching files
  var files = walkDir(projectPath, DEFAULT_EXTENSIONS, []);

  var labelMap = {};
  var newMtimes = {};

  // Regex to find elements with data-synapse-label="..."
  // Captures: (1) the label value, and the full opening tag to find the tag name
  // Pattern: <tagName ... data-synapse-label="labelValue" ... >
  var labelAttrRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\bdata-synapse-label="([^"]*)"[^>]*>/g;

  for (var i = 0; i < files.length; i++) {
    var filePath = files[i];
    var content;

    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      // Skip files we cannot read
      continue;
    }

    // Record modification time for cache staleness checks
    try {
      var fileStat = fs.statSync(filePath);
      newMtimes[filePath] = fileStat.mtimeMs;
    } catch (e) {
      // Ignore stat errors
    }

    // Reset regex state
    labelAttrRegex.lastIndex = 0;

    var match;
    while ((match = labelAttrRegex.exec(content)) !== null) {
      var tagName = match[1];
      var label = match[2];
      var fullMatch = match[0];
      var matchEnd = match.index + fullMatch.length;

      // Compute the line number of the element
      var line = getLineNumber(content, match.index);

      // Extract text content between the opening and closing tags
      var text = extractTextContent(content, matchEnd, tagName);

      // Build relative file path from project root
      var relPath = path.relative(projectPath, filePath);

      labelMap[label] = {
        file: relPath,
        line: line,
        text: text !== null ? text : ''
      };
    }
  }

  // Update cache
  cachedLabelMap = labelMap;
  cachedMtimes = newMtimes;
  cachedProjectPath = projectPath;

  return labelMap;
}

/**
 * Return the cached label map if available and not stale.
 * Staleness is determined by checking if any scanned file has been modified
 * since the last scan (comparing file modification times).
 * If the cache is stale or missing, triggers a full scanLabels() rebuild.
 *
 * @param {string} projectPath — absolute path to the project root
 * @returns {{ [label: string]: { file: string, line: number, text: string } } | { error: string }}
 */
function getLabelMap(projectPath) {
  // If no cache or different project, rebuild
  if (!cachedLabelMap || cachedProjectPath !== projectPath) {
    return scanLabels(projectPath);
  }

  // Check if any cached file has been modified
  var filePaths = Object.keys(cachedMtimes);
  for (var i = 0; i < filePaths.length; i++) {
    var filePath = filePaths[i];
    try {
      var stat = fs.statSync(filePath);
      if (stat.mtimeMs !== cachedMtimes[filePath]) {
        // File changed — rebuild
        return scanLabels(projectPath);
      }
    } catch (e) {
      // File deleted or inaccessible — rebuild
      return scanLabels(projectPath);
    }
  }

  // Also check if new files appeared (quick check: re-walk and compare count)
  var currentFiles = walkDir(projectPath, DEFAULT_EXTENSIONS, []);
  if (currentFiles.length !== filePaths.length) {
    return scanLabels(projectPath);
  }

  // Cache is still valid
  return cachedLabelMap;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init: init,
  scanLabels: scanLabels,
  getLabelMap: getLabelMap
};
