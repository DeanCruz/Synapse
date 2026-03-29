// electron/services/InstrumentService.js — JSX/TSX/HTML Instrumentation Service
// Scans project files and adds data-synapse-label attributes to text-bearing elements,
// making them compatible with Synapse's Live Preview inline editing.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directories to always skip during scanning. */
var SKIP_DIRS = ['node_modules', '.next', 'dist', 'build', '.git'];

/** Default file extensions to scan. */
var DEFAULT_EXTENSIONS = ['.jsx', '.tsx', '.html', '.htm'];

/** Text-bearing HTML/JSX elements that should be instrumented. */
var TARGET_ELEMENTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'button', 'a', 'label', 'li',
  'td', 'th', 'caption', 'figcaption',
  'blockquote', 'dt', 'dd', 'TextAnimated', 'TextLoop', 'Marquee', 'StyledText' // common custom text components
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walk a directory, collecting file paths that match the given extensions.
 * Skips directories listed in SKIP_DIRS.
 *
 * @param {string} dir — absolute path to directory
 * @param {string[]} extensions — file extensions to include (e.g., ['.jsx', '.tsx'])
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
 * Build a regex that matches the START of opening tags of target elements.
 * Only matches `<tagName` followed by whitespace or `>` — does NOT try to
 * find the closing `>` (that is handled by findTagClose).
 *
 * @returns {RegExp}
 */
function buildTagStartRegex() {
  var tagGroup = TARGET_ELEMENTS.join('|');
  return new RegExp(
    '<(' + tagGroup + ')(?![a-zA-Z0-9-])',
    'gi'
  );
}

/**
 * Starting from `pos` (the character right after the tag name in `<tagName`),
 * parse forward to find the real closing `>` of the opening tag.
 *
 * Properly handles:
 *   - Quoted attribute values: "...", '...', `...` (with backslash escapes)
 *   - JSX expression braces: { ... } (with arbitrary nesting)
 *   - `>` characters inside quotes or braces are NOT treated as tag-close
 *
 * @param {string} source — full file content
 * @param {number} pos — index right after the tag name
 * @returns {{ closeIndex: number, attrs: string, selfClosing: boolean } | null}
 *   closeIndex — index of the closing `>` character
 *   attrs — the attribute string between tag name and `>`
 *   selfClosing — true if the tag ends with `/>`
 *   Returns null if no closing `>` is found (malformed markup)
 */
function findTagClose(source, pos) {
  var len = source.length;
  var braceDepth = 0;
  var inString = false;
  var stringChar = '';

  for (var i = pos; i < len; i++) {
    var ch = source[i];

    // Handle string literals inside attributes / JSX expressions
    if (inString) {
      if (ch === '\\') {
        i++; // skip escaped character
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    // Open a string
    if ((ch === '"' || ch === "'" || ch === '`') && braceDepth >= 0) {
      inString = true;
      stringChar = ch;
      continue;
    }

    // JSX expression braces
    if (ch === '{') {
      braceDepth++;
      continue;
    }
    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    // Only treat `>` as the tag close when outside braces and strings
    if (ch === '>' && braceDepth === 0) {
      var selfClosing = (i > 0 && source[i - 1] === '/');
      return {
        closeIndex: i,
        attrs: source.substring(pos, i),
        selfClosing: selfClosing
      };
    }
  }

  return null; // malformed — no closing > found
}

/**
 * Check if a given position in the source text is inside a comment or string literal.
 * This is a heuristic for JSX/TSX — it checks for:
 *   - HTML comments: <!-- ... -->
 *   - JSX expression comments: {/* ... * /}
 *   - Single-line JS comments: // ...
 *   - Template literals and string literals containing the tag
 *
 * @param {string} source — full file content
 * @param {number} position — character offset to check
 * @returns {boolean} — true if position is inside a comment or string
 */
function isInsideCommentOrString(source, position) {
  // Check HTML comments
  var htmlCommentStart = source.lastIndexOf('<!--', position);
  if (htmlCommentStart !== -1) {
    var htmlCommentEnd = source.indexOf('-->', htmlCommentStart);
    if (htmlCommentEnd === -1 || htmlCommentEnd + 3 > position) {
      return true;
    }
  }

  // Check block comments {/* ... */} and /* ... */
  var blockCommentStart = source.lastIndexOf('/*', position);
  if (blockCommentStart !== -1) {
    var blockCommentEnd = source.indexOf('*/', blockCommentStart);
    if (blockCommentEnd === -1 || blockCommentEnd + 2 > position) {
      return true;
    }
  }

  // Check if inside a single-line comment (// ...) on the same line
  var lineStart = source.lastIndexOf('\n', position - 1) + 1;
  var lineBeforePos = source.substring(lineStart, position);
  if (lineBeforePos.indexOf('//') !== -1) {
    // Rough check — could be inside a string with //, but good enough heuristic
    var slashIdx = lineBeforePos.indexOf('//');
    // Make sure // is not inside a string on that line (simple check)
    var beforeSlash = lineBeforePos.substring(0, slashIdx);
    var singleQuotes = (beforeSlash.match(/'/g) || []).length;
    var doubleQuotes = (beforeSlash.match(/"/g) || []).length;
    var backticks = (beforeSlash.match(/`/g) || []).length;
    if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0 && backticks % 2 === 0) {
      return true;
    }
  }

  // Check if inside a string literal (backtick, single, or double quote)
  // Scan from the beginning of the line to the position for unmatched quotes
  var lineContent = source.substring(lineStart, position);
  var inString = false;
  var stringChar = null;
  for (var i = 0; i < lineContent.length; i++) {
    var ch = lineContent[i];
    if (inString) {
      if (ch === '\\') {
        i++; // skip escaped character
        continue;
      }
      if (ch === stringChar) {
        inString = false;
        stringChar = null;
      }
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
      }
    }
  }

  return inString;
}

/**
 * Check if the content after the opening tag contains direct text (not just child components).
 * For JSX, text content is literal characters between tags, not wrapped in { } expressions
 * that render child components.
 *
 * @param {string} source — full file content
 * @param {number} afterTagPos — position right after the ">" of the opening tag
 * @param {string} tagName — the element tag name
 * @returns {boolean} — true if there is direct text content
 */
function hasDirectTextContent(source, afterTagPos, tagName) {
  // Find the closing tag
  var closingTag = new RegExp('</' + tagName + '\\s*>', 'i');
  var closingMatch = closingTag.exec(source.substring(afterTagPos));
  if (!closingMatch) {
    // No closing tag found — could be self-closing or malformed; skip
    return false;
  }

  var innerContent = source.substring(afterTagPos, afterTagPos + closingMatch.index);

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

  // Check if remaining content has non-whitespace text
  return stripped.trim().length > 0;
}

/**
 * Instrument a single file's content by adding data-synapse-label attributes
 * to text-bearing elements.
 *
 * @param {string} content — file content
 * @param {string} filename — file stem (without extension) for label generation
 * @returns {{ content: string, labelsAdded: number, alreadyLabeled: number }}
 */
function instrumentContent(content, filename) {
  var tagStartRegex = buildTagStartRegex();
  var labelsAdded = 0;
  var alreadyLabeled = 0;

  // Collect all tag-start matches, then use findTagClose to locate the real closing >
  var matches = [];
  var match;
  tagStartRegex.lastIndex = 0;

  while ((match = tagStartRegex.exec(content)) !== null) {
    var tagName = match[1];
    var afterTagName = match.index + match[0].length; // position right after "<tagName"
    var tagClose = findTagClose(content, afterTagName);
    if (!tagClose) continue; // malformed tag — skip

    matches.push({
      index: match.index,
      tagName: tagName,
      attrs: tagClose.attrs,
      closeIndex: tagClose.closeIndex,
      selfClosing: tagClose.selfClosing,
      endIndex: tagClose.closeIndex + 1 // position right after ">"
    });
  }

  // Process forward — rebuild the string with insertions
  var result = '';
  var lastIndex = 0;

  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];

    // Skip self-closing tags — they have no text content
    if (m.selfClosing) continue;

    // Skip if inside a comment or string
    if (isInsideCommentOrString(content, m.index)) continue;

    // Skip if already has data-synapse-label
    if (m.attrs && m.attrs.indexOf('data-synapse-label') !== -1) {
      alreadyLabeled++;
      continue;
    }

    // Check for direct text content (JSX/TSX heuristic)
    if (!hasDirectTextContent(content, m.endIndex, m.tagName)) continue;

    // Build the label
    var label = crypto.randomUUID();
    var insertion = ' data-synapse-label="' + label + '"';

    // Append everything from lastIndex to the closing >
    result += content.substring(lastIndex, m.closeIndex);
    // Insert the attribute right before the >
    result += insertion + '>';
    lastIndex = m.endIndex;
    labelsAdded++;
  }

  // Append remaining content
  result += content.substring(lastIndex);

  return {
    content: result,
    labelsAdded: labelsAdded,
    alreadyLabeled: alreadyLabeled
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Instrument a single file by adding data-synapse-label attributes to text-bearing elements.
 *
 * @param {string} filePath — absolute path to the file
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] — if true, return changes without writing
 * @returns {{ success: boolean, labelsAdded: number, alreadyLabeled: number, error?: string }}
 */
function instrumentFile(filePath, options) {
  options = options || {};
  var dryRun = options.dryRun || false;

  try {
    var content = fs.readFileSync(filePath, 'utf-8');
    var filename = path.basename(filePath, path.extname(filePath));
    var result = instrumentContent(content, filename);

    if (result.labelsAdded > 0 && !dryRun) {
      fs.writeFileSync(filePath, result.content, 'utf-8');
    }

    return {
      success: true,
      labelsAdded: result.labelsAdded,
      alreadyLabeled: result.alreadyLabeled
    };
  } catch (e) {
    return { success: false, labelsAdded: 0, alreadyLabeled: 0, error: e.message };
  }
}

/**
 * Instrument all matching files in a project directory.
 * Scans for JSX/TSX/HTML files and adds data-synapse-label attributes to text-bearing elements.
 *
 * @param {string} projectPath — absolute path to the project root
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] — if true, return changes without writing files
 * @param {string[]} [options.extensions] — file extensions to scan (default: ['.jsx', '.tsx', '.html', '.htm'])
 * @returns {{ filesScanned: number, filesModified: number, labelsAdded: number, skipped: number, errors?: string[] }}
 */
function instrumentProject(projectPath, options) {
  options = options || {};
  var dryRun = options.dryRun || false;
  var extensions = options.extensions || DEFAULT_EXTENSIONS;

  if (!projectPath || !fs.existsSync(projectPath)) {
    return { error: 'Project path does not exist: ' + projectPath };
  }

  var stat = fs.statSync(projectPath);
  if (!stat.isDirectory()) {
    return { error: 'Project path is not a directory: ' + projectPath };
  }

  // Collect all matching files
  var files = walkDir(projectPath, extensions, []);

  var filesScanned = files.length;
  var filesModified = 0;
  var totalLabelsAdded = 0;
  var totalSkipped = 0;
  var errors = [];

  for (var i = 0; i < files.length; i++) {
    var result = instrumentFile(files[i], { dryRun: dryRun });

    if (!result.success) {
      errors.push(files[i] + ': ' + result.error);
      continue;
    }

    totalLabelsAdded += result.labelsAdded;
    totalSkipped += result.alreadyLabeled;

    if (result.labelsAdded > 0) {
      filesModified++;
    }
  }

  var output = {
    filesScanned: filesScanned,
    filesModified: filesModified,
    labelsAdded: totalLabelsAdded,
    skipped: totalSkipped
  };

  if (errors.length > 0) {
    output.errors = errors;
  }

  return output;
}

/**
 * Remove all data-synapse-label attributes from files in a project directory.
 * Restores files to their original state before instrumentation.
 *
 * @param {string} projectPath — absolute path to the project root
 * @param {Object} [options]
 * @param {string[]} [options.extensions] — file extensions to scan (default: ['.jsx', '.tsx', '.html', '.htm'])
 * @returns {{ filesScanned: number, filesModified: number, labelsRemoved: number, errors?: string[] }}
 */
function removeInstrumentation(projectPath, options) {
  options = options || {};
  var extensions = options.extensions || DEFAULT_EXTENSIONS;

  if (!projectPath || !fs.existsSync(projectPath)) {
    return { error: 'Project path does not exist: ' + projectPath };
  }

  var files = walkDir(projectPath, extensions, []);

  var filesScanned = files.length;
  var filesModified = 0;
  var totalLabelsRemoved = 0;
  var errors = [];

  // Regex to match data-synapse-label="..." attribute (with surrounding whitespace)
  var labelAttrRegex = /\s+data-synapse-label="[^"]*"/g;

  for (var i = 0; i < files.length; i++) {
    try {
      var content = fs.readFileSync(files[i], 'utf-8');
      var matches = content.match(labelAttrRegex);

      if (!matches || matches.length === 0) {
        continue;
      }

      var cleaned = content.replace(labelAttrRegex, '');
      fs.writeFileSync(files[i], cleaned, 'utf-8');

      totalLabelsRemoved += matches.length;
      filesModified++;
    } catch (e) {
      errors.push(files[i] + ': ' + e.message);
    }
  }

  var output = {
    filesScanned: filesScanned,
    filesModified: filesModified,
    labelsRemoved: totalLabelsRemoved
  };

  if (errors.length > 0) {
    output.errors = errors;
  }

  return output;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  instrumentProject: instrumentProject,
  instrumentFile: instrumentFile,
  removeInstrumentation: removeInstrumentation
};
