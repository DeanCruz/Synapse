// electron/services/PreviewTextWriter.js — Preview Text Update & Dev Server Detection
// Provides updateText() for writing edited preview text back to source files,
// and detectDevServer() for discovering running development servers.

const fs = require('fs');
const path = require('path');
const net = require('net');

// ---------------------------------------------------------------------------
// Constants (mirrored from InstrumentService for consistency)
// ---------------------------------------------------------------------------

/** Directories to always skip during scanning. */
var SKIP_DIRS = ['node_modules', '.next', 'dist', 'build', '.git'];

/** Default file extensions to scan. */
var DEFAULT_EXTENSIONS = ['.jsx', '.tsx', '.html', '.htm'];

/** Common dev server ports to probe. */
var DEV_SERVER_PORTS = [3000, 3001, 5173, 5174, 8080];

/** Framework detection signatures. */
var FRAMEWORK_SIGNATURES = {
  'vite.config': 'vite',
  'next.config': 'next',
  'nuxt.config': 'nuxt',
  'angular.json': 'angular',
  'svelte.config': 'svelte'
};

var LABEL_ATTRIBUTE_PATTERNS = [
  function (label) { return 'data-synapse-label="' + label + '"'; },
  function (label) { return "data-synapse-label='" + label + "'"; },
  function (label) { return 'data-synapse-label={"' + label + '"}'; },
  function (label) { return "data-synapse-label={'" + label + "'}"; },
  function (label) { return 'data-synapse-label={`' + label + '`}'; }
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walk a directory, collecting file paths that match the given extensions.
 * Mirrors InstrumentService.walkDir for consistent file discovery.
 *
 * @param {string} dir - absolute path to directory
 * @param {string[]} extensions - file extensions to include
 * @param {string[]} results - accumulator array (mutated)
 * @returns {string[]} - array of matching absolute file paths
 */
function walkDir(dir, extensions, results) {
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
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

function normalizeLabel(label) {
  if (typeof label !== 'string') return '';

  var normalized = label.trim();
  if (!normalized) return '';

  if (
    (normalized[0] === '{' && normalized[normalized.length - 1] === '}') ||
    (normalized[0] === '(' && normalized[normalized.length - 1] === ')')
  ) {
    normalized = normalized.substring(1, normalized.length - 1).trim();
  }

  if (
    (normalized[0] === '"' && normalized[normalized.length - 1] === '"') ||
    (normalized[0] === "'" && normalized[normalized.length - 1] === "'") ||
    (normalized[0] === '`' && normalized[normalized.length - 1] === '`')
  ) {
    normalized = normalized.substring(1, normalized.length - 1).trim();
  }

  return normalized;
}

function buildLabelAttributeRegex(label) {
  var escapedLabel = label.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  var attrValuePattern =
    '(?:"' + escapedLabel + '"' +
    '|' + "'" + escapedLabel + "'" +
    '|\\{\\s*"' + escapedLabel + '"\\s*\\}' +
    '|\\{\\s*\'' + escapedLabel + '\'\\s*\\}' +
    '|\\{\\s*`' + escapedLabel + '`\\s*\\})';

  return new RegExp(
    '<([a-zA-Z][a-zA-Z0-9]*)[^>]*data-synapse-label\\s*=\\s*' + attrValuePattern + '[^>]*>',
    'gi'
  );
}

/**
 * Find the source file that contains a specific data-synapse-label UUID.
 * Since UUIDs are globally unique, this is an unambiguous search.
 *
 * @param {string} projectPath - absolute path to the project root
 * @param {string} label - the UUID label to search for
 * @returns {string|null} - absolute path to the file containing the label, or null
 */
function findFileByLabel(projectPath, label) {
  var normalizedLabel = normalizeLabel(label);
  if (!normalizedLabel) {
    return null;
  }

  var files = walkDir(projectPath, DEFAULT_EXTENSIONS, []);
  for (var i = 0; i < files.length; i++) {
    try {
      var content = fs.readFileSync(files[i], 'utf-8');
      for (var j = 0; j < LABEL_ATTRIBUTE_PATTERNS.length; j++) {
        if (content.indexOf(LABEL_ATTRIBUTE_PATTERNS[j](normalizedLabel)) !== -1) {
          return files[i];
        }
      }
    } catch (e) {
      // Permission error or unreadable — skip
      continue;
    }
  }
  return null;
}

/**
 * Find an element with a specific data-synapse-label in the file content.
 * Searches all target element types since UUIDs don't encode the tag name.
 *
 * @param {string} content - full file content
 * @param {string} label - the data-synapse-label UUID value
 * @returns {{ openTagEnd: number, closeTagStart: number, oldText: string, line: number } | null}
 */
function findLabeledElement(content, label) {
  var normalizedLabel = normalizeLabel(label);
  if (!normalizedLabel) {
    return null;
  }

  // Match any opening tag that has this specific data-synapse-label
  var openTagRegex = buildLabelAttributeRegex(normalizedLabel);

  var match = openTagRegex.exec(content);
  if (!match) {
    return null;
  }

  var tagName = match[1];
  var openTagEnd = match.index + match[0].length;

  // Find the closing tag
  var closingTagRegex = new RegExp('</' + tagName + '\\s*>', 'i');
  var remaining = content.substring(openTagEnd);
  var closeMatch = closingTagRegex.exec(remaining);
  if (!closeMatch) {
    return null;
  }

  var closeTagStart = openTagEnd + closeMatch.index;
  var oldText = content.substring(openTagEnd, closeTagStart);

  // Calculate line number (1-based)
  var line = 1;
  for (var i = 0; i < match.index; i++) {
    if (content[i] === '\n') {
      line++;
    }
  }

  return {
    openTagEnd: openTagEnd,
    closeTagStart: closeTagStart,
    oldText: oldText,
    line: line
  };
}

/**
 * Extract the pure text content from inner HTML, stripping JSX expressions
 * and child tags but preserving the structure for replacement.
 *
 * @param {string} innerContent - content between opening and closing tags
 * @returns {string} - the text-only portion
 */
function extractPureText(innerContent) {
  // Strip JSX expressions { ... } (including nested braces)
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

  return stripped.trim();
}

/**
 * Perform a surgical text replacement in the inner content of an element.
 * Replaces only the text portion while preserving JSX expressions,
 * child elements, and whitespace structure.
 *
 * Strategy: If the inner content is purely text (no child tags or JSX expressions),
 * replace it entirely. If it contains mixed content, find and replace the text
 * portions that match the old pure text.
 *
 * @param {string} innerContent - the content between open and close tags
 * @param {string} newText - the new text to insert
 * @returns {string} - the modified inner content
 */
function replaceInnerText(innerContent, newText) {
  // Check if the content is purely text (no child tags, no JSX expressions)
  var hasChildTags = /<[^>]+>/.test(innerContent);
  var hasJsxExpressions = /\{[^}]*\}/.test(innerContent);

  if (!hasChildTags && !hasJsxExpressions) {
    // Pure text content — preserve leading/trailing whitespace pattern
    var leadingWS = innerContent.match(/^(\s*)/)[1];
    var trailingWS = innerContent.match(/(\s*)$/)[1];
    return leadingWS + newText + trailingWS;
  }

  // Mixed content — find text segments and replace them
  // Build a map of non-text regions (tags and JSX expressions)
  var segments = [];
  var pos = 0;

  // Find all tags and JSX expressions
  var nonTextRegex = /(<[^>]*>|\{[^}]*(?:\{[^}]*\}[^}]*)*\})/g;
  var nonTextMatch;

  while ((nonTextMatch = nonTextRegex.exec(innerContent)) !== null) {
    if (nonTextMatch.index > pos) {
      // Text segment before this non-text region
      segments.push({ type: 'text', content: innerContent.substring(pos, nonTextMatch.index) });
    }
    segments.push({ type: 'non-text', content: nonTextMatch[0] });
    pos = nonTextMatch.index + nonTextMatch[0].length;
  }

  // Trailing text segment
  if (pos < innerContent.length) {
    segments.push({ type: 'text', content: innerContent.substring(pos) });
  }

  // Find the first non-whitespace text segment and replace it
  var replaced = false;
  for (var i = 0; i < segments.length; i++) {
    if (segments[i].type === 'text' && segments[i].content.trim().length > 0) {
      var ws = segments[i].content.match(/^(\s*)/)[1];
      var trailingWs = segments[i].content.match(/(\s*)$/)[1];
      segments[i].content = ws + newText + trailingWs;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    // No text segments found — append the new text
    return newText + innerContent;
  }

  // Rebuild the inner content
  var result = '';
  for (var j = 0; j < segments.length; j++) {
    result += segments[j].content;
  }
  return result;
}

/**
 * Check if a port is open by attempting a TCP connection.
 *
 * @param {number} port - port number to check
 * @param {string} [host='127.0.0.1'] - host to connect to
 * @param {number} [timeout=500] - connection timeout in ms
 * @returns {Promise<boolean>} - true if the port is accepting connections
 */
function checkPort(port, host, timeout) {
  host = host || '127.0.0.1';
  timeout = timeout || 500;

  return new Promise(function (resolve) {
    var socket = new net.Socket();
    var resolved = false;

    function done(result) {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(result);
      }
    }

    socket.setTimeout(timeout);
    socket.once('connect', function () { done(true); });
    socket.once('timeout', function () { done(false); });
    socket.once('error', function () { done(false); });
    socket.connect(port, host);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Update text content in a source file based on a synapse label UUID.
 * Finds the file containing the labeled element, surgically replaces its
 * text content with newText, and writes the modified file back.
 *
 * @param {string} projectPath - absolute path to the project root
 * @param {string} label - the data-synapse-label UUID value
 * @param {string} newText - the new text to write into the element
 * @param {string} [routePath] - kept for backward API compatibility (unused)
 * @returns {Promise<{ success: boolean, file?: string, line?: number, oldText?: string, newText?: string, error?: string }>}
 */
async function updateText(projectPath, label, newText, routePath) {
  try {
    label = normalizeLabel(label);
    if (!label) {
      return { success: false, error: 'Missing label' };
    }

    // 1. Find the file containing this UUID label
    var filePath = findFileByLabel(projectPath, label);
    if (!filePath) {
      return {
        success: false,
        error: 'No file found containing label "' + label + '"'
      };
    }

    // 2. Read the file and find the labeled element
    var content = await fs.promises.readFile(filePath, 'utf-8');
    var element = findLabeledElement(content, label);
    if (!element) {
      return {
        success: false,
        error: 'Label "' + label + '" not found in ' + path.relative(projectPath, filePath)
      };
    }

    // 3. Replace the text content surgically
    var newInnerContent = replaceInnerText(element.oldText, newText);
    var updatedContent =
      content.substring(0, element.openTagEnd) +
      newInnerContent +
      content.substring(element.closeTagStart);

    // 4. Write the modified file back
    await fs.promises.writeFile(filePath, updatedContent, 'utf-8');

    // 5. Return success with details
    var oldPureText = extractPureText(element.oldText);
    return {
      success: true,
      file: filePath,
      line: element.line,
      oldText: oldPureText,
      newText: newText
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Detect if a development server is likely running for the project.
 * Checks for framework config files and probes common dev server ports.
 *
 * @param {string} projectPath - absolute path to the project root
 * @returns {Promise<{ detected: boolean, url: string|null, framework: string|null }>}
 */
async function detectDevServer(projectPath) {
  try {
    // 1. Detect framework from config files
    var detectedFramework = null;
    var frameworkKeys = Object.keys(FRAMEWORK_SIGNATURES);

    for (var i = 0; i < frameworkKeys.length; i++) {
      var configPrefix = frameworkKeys[i];
      var framework = FRAMEWORK_SIGNATURES[configPrefix];

      // Check for common config file extensions
      var configExts = ['.js', '.ts', '.mjs', '.cjs', '.json'];
      for (var j = 0; j < configExts.length; j++) {
        var configPath = path.join(projectPath, configPrefix + configExts[j]);
        if (fs.existsSync(configPath)) {
          detectedFramework = framework;
          break;
        }
      }
      if (detectedFramework) break;
    }

    // 2. Check package.json for dev/start scripts as fallback framework hint
    if (!detectedFramework) {
      var pkgPath = path.join(projectPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          var pkgContent = await fs.promises.readFile(pkgPath, 'utf-8');
          var pkg = JSON.parse(pkgContent);
          var scripts = pkg.scripts || {};

          if (scripts.dev) {
            if (scripts.dev.indexOf('vite') !== -1) detectedFramework = 'vite';
            else if (scripts.dev.indexOf('next') !== -1) detectedFramework = 'next';
            else if (scripts.dev.indexOf('nuxt') !== -1) detectedFramework = 'nuxt';
            else if (scripts.dev.indexOf('svelte') !== -1) detectedFramework = 'svelte';
            else if (scripts.dev.indexOf('angular') !== -1 || scripts.dev.indexOf('ng ') !== -1) detectedFramework = 'angular';
          }

          if (!detectedFramework && scripts.start) {
            if (scripts.start.indexOf('react-scripts') !== -1) detectedFramework = 'create-react-app';
            else if (scripts.start.indexOf('next') !== -1) detectedFramework = 'next';
          }
        } catch (e) {
          // Malformed package.json — continue without framework hint
        }
      }
    }

    // 3. Determine which ports to probe based on framework
    var portsToCheck = DEV_SERVER_PORTS.slice(); // copy

    // Prioritize framework-specific ports
    if (detectedFramework === 'vite') {
      // Vite defaults to 5173
      portsToCheck = [5173, 5174, 3000, 3001, 8080];
    } else if (detectedFramework === 'next') {
      // Next.js defaults to 3000
      portsToCheck = [3000, 3001, 5173, 8080];
    } else if (detectedFramework === 'create-react-app') {
      // CRA defaults to 3000
      portsToCheck = [3000, 3001, 5173, 8080];
    }

    // 4. Probe ports
    for (var k = 0; k < portsToCheck.length; k++) {
      var port = portsToCheck[k];
      var isOpen = await checkPort(port);
      if (isOpen) {
        return {
          detected: true,
          url: 'http://localhost:' + port,
          framework: detectedFramework
        };
      }
    }

    // 5. No open port found
    return {
      detected: false,
      url: null,
      framework: detectedFramework
    };
  } catch (err) {
    return { detected: false, url: null, framework: null };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  updateText: updateText,
  detectDevServer: detectDevServer,
  // Expose internals for testing
  _findFileByLabel: findFileByLabel,
  _findLabeledElement: findLabeledElement,
  _replaceInnerText: replaceInnerText,
  _checkPort: checkPort,
  _extractPureText: extractPureText
};
