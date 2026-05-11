// GuideService - Read-only loader/parser for documentation/guide markdown files.
// CommonJS module for Electron main process.

const fs = require('fs');
const path = require('path');

const SYNAPSE_ROOT = process.env.SYNAPSE_ROOT || path.resolve(__dirname, '../..');
const GUIDE_DIR = path.join(SYNAPSE_ROOT, 'documentation', 'guide');

function normalizeRelativePath(filePath) {
  return path.relative(GUIDE_DIR, filePath).split(path.sep).join('/');
}

function isSafeRelativePath(value) {
  if (!value || typeof value !== 'string') return false;
  var normalized = path.normalize(value);
  return !path.isAbsolute(value) && normalized !== '..' && !normalized.startsWith('..' + path.sep);
}

function extractPurpose(content) {
  var boldPurposeMatch = content.match(/\*\*Purpose:\*\*\s*(.+?)(?:\n|$)/);
  if (boldPurposeMatch) return boldPurposeMatch[1].trim();

  var headingPurposeMatch = content.match(/^##\s+Purpose\s*\n+([\s\S]*?)(?:\n##\s+|$)/m);
  if (!headingPurposeMatch) return '';

  var lines = headingPurposeMatch[1].split('\n').map(function (line) {
    return line.trim();
  }).filter(Boolean);

  return lines.length > 0 ? lines[0].replace(/^[-*]\s+/, '') : '';
}

/**
 * Parse a guide markdown file into structured data.
 *
 * @param {string} filePath - absolute path to the .md file
 * @returns {object} parsed guide
 */
function parseGuideFile(filePath) {
  var content = fs.readFileSync(filePath, 'utf8');
  var filename = path.basename(filePath, '.md');
  var relativePath = normalizeRelativePath(filePath);
  var titleMatch = content.match(/^#\s+(.+)$/m);
  var title = titleMatch ? titleMatch[1].trim() : filename;

  return {
    id: relativePath,
    name: filename,
    path: relativePath,
    title: title,
    purpose: extractPurpose(content),
    content: content,
    filePath: filePath,
    lastModified: fs.statSync(filePath).mtime.toISOString(),
  };
}

function parseGuideSummary(filePath) {
  try {
    var parsed = parseGuideFile(filePath);
    return {
      id: parsed.id,
      name: parsed.name,
      path: parsed.path,
      title: parsed.title,
      purpose: parsed.purpose,
      filePath: parsed.filePath,
      lastModified: parsed.lastModified,
      subfolder: null,
    };
  } catch (e) {
    var relativePath = normalizeRelativePath(filePath);
    return {
      id: relativePath,
      name: path.basename(filePath, '.md'),
      path: relativePath,
      title: path.basename(filePath, '.md'),
      purpose: '',
      filePath: filePath,
      lastModified: null,
      subfolder: null,
      error: e.message,
    };
  }
}

function sortGuideSummaries(a, b) {
  return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Recursively collect .md guide files from a directory and its subdirectories.
 */
function collectGuidesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];

  var results = [];
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort(function (a, b) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  entries.forEach(function (entry) {
    if (entry.name.startsWith('.')) return;

    var fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(parseGuideSummary(fullPath));
    } else if (entry.isDirectory()) {
      collectGuidesRecursive(fullPath).forEach(function (guide) {
        var parentDir = path.dirname(guide.path);
        guide.subfolder = parentDir === '.' ? null : parentDir;
        results.push(guide);
      });
    }
  });

  return results.sort(sortGuideSummaries);
}

/**
 * List guides from documentation/guide, grouped by top-level folder.
 * Return shape: [{ folder: string, guides: [{ id, name, path, title, purpose, filePath, lastModified, subfolder }] }]
 *
 * @returns {object[]} array of guide groups
 */
function listGuide() {
  if (!fs.existsSync(GUIDE_DIR)) return [];

  var groups = [];
  var entries = fs.readdirSync(GUIDE_DIR, { withFileTypes: true });
  entries.sort(function (a, b) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  var rootFiles = entries.filter(function (entry) {
    return entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.');
  });
  if (rootFiles.length > 0) {
    groups.push({
      folder: 'General',
      guides: rootFiles.map(function (file) {
        return parseGuideSummary(path.join(GUIDE_DIR, file.name));
      }).sort(sortGuideSummaries),
    });
  }

  entries.forEach(function (entry) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) return;

    var guides = collectGuidesRecursive(path.join(GUIDE_DIR, entry.name));
    if (guides.length > 0) {
      groups.push({
        folder: entry.name,
        guides: guides,
      });
    }
  });

  return groups;
}

function findGuideFile(dir, nameOrPath) {
  if (!fs.existsSync(dir)) return null;

  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (entry.name.startsWith('.')) continue;

    var fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      var summary = parseGuideSummary(fullPath);
      if (
        summary.id === nameOrPath ||
        summary.path === nameOrPath ||
        summary.name === nameOrPath ||
        entry.name === nameOrPath ||
        entry.name === nameOrPath + '.md'
      ) {
        return fullPath;
      }
    } else if (entry.isDirectory()) {
      var found = findGuideFile(fullPath, nameOrPath);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Get full content of a guide by id/path/name.
 *
 * @param {string} nameOrPath - guide id/path from listGuide(), filename, or name without .md
 * @returns {object|null} parsed guide with full content, or null
 */
function getGuide(nameOrPath) {
  if (!fs.existsSync(GUIDE_DIR) || !nameOrPath) return null;

  if (isSafeRelativePath(nameOrPath)) {
    var relativeName = nameOrPath.endsWith('.md') ? nameOrPath : nameOrPath + '.md';
    var directPath = path.join(GUIDE_DIR, relativeName);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return parseGuideFile(directPath);
    }
  }

  var found = findGuideFile(GUIDE_DIR, nameOrPath);
  if (found) return parseGuideFile(found);
  return null;
}

module.exports = {
  GUIDE_DIR: GUIDE_DIR,
  listGuide: listGuide,
  getGuide: getGuide,
};
