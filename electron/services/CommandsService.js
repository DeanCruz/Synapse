// CommandsService — Loads, parses, and manages _commands/ markdown files
// CommonJS module for Electron main process.

const fs = require('fs');
const path = require('path');

const SYNAPSE_ROOT = path.resolve(__dirname, '../..');
const COMMANDS_DIR = path.join(SYNAPSE_ROOT, '_commands');

/**
 * Parse a command markdown file into structured data.
 * Extracts: name (from filename), title (first H1), purpose, syntax, content.
 *
 * @param {string} filePath — absolute path to the .md file
 * @returns {object} parsed command
 */
function parseCommandFile(filePath) {
  var content = fs.readFileSync(filePath, 'utf8');
  var filename = path.basename(filePath, '.md');

  // Extract title from first H1
  var titleMatch = content.match(/^#\s+(.+)$/m);
  var title = titleMatch ? titleMatch[1].trim() : filename;

  // Extract purpose from **Purpose:** line
  var purposeMatch = content.match(/\*\*Purpose:\*\*\s*(.+?)(?:\n|$)/);
  var purpose = purposeMatch ? purposeMatch[1].trim() : '';

  // Extract syntax from **Syntax:** line
  var syntaxMatch = content.match(/\*\*Syntax:\*\*\s*(.+?)(?:\n|$)/);
  var syntax = syntaxMatch ? syntaxMatch[1].trim() : '';

  return {
    name: filename,
    title: title,
    purpose: purpose,
    syntax: syntax,
    content: content,
    filePath: filePath,
    lastModified: fs.statSync(filePath).mtime.toISOString(),
  };
}

/**
 * List all commands from _commands/ directory, grouped by subfolder.
 * Returns an array of { folder, commands[] } objects.
 * Each subfolder becomes a group. Files at root level are grouped under "General".
 *
 * @param {string} [commandsDir] — override directory (for loading from project)
 * @returns {object[]} array of { folder, commands[] }
 */
function listCommands(commandsDir) {
  var dir = commandsDir || COMMANDS_DIR;
  if (!fs.existsSync(dir)) return [];

  var groups = [];

  // Read entries in the commands directory
  var entries = fs.readdirSync(dir, { withFileTypes: true });

  // Collect root-level .md files
  var rootFiles = entries.filter(function (e) {
    return e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.');
  });
  if (rootFiles.length > 0) {
    groups.push({
      folder: 'General',
      commands: rootFiles.map(function (f) {
        return parseCommandSummary(path.join(dir, f.name));
      }),
    });
  }

  // Collect subdirectory groups (skip _ prefixed dirs like _profiles)
  var subdirs = entries.filter(function (e) {
    return e.isDirectory() && !e.name.startsWith('.');
  });

  subdirs.forEach(function (sub) {
    var subPath = path.join(dir, sub.name);
    var subCommands = collectCommandsRecursive(subPath);
    if (subCommands.length > 0) {
      groups.push({
        folder: sub.name,
        commands: subCommands,
      });
    }
  });

  return groups;
}

/**
 * Recursively collect .md command files from a directory and its subdirectories.
 * Skips directories starting with _.
 */
function collectCommandsRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  var results = [];
  var entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach(function (e) {
    if (e.name.startsWith('.')) return;
    var fullPath = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith('.md')) {
      results.push(parseCommandSummary(fullPath));
    } else if (e.isDirectory() && !e.name.startsWith('_')) {
      // Recurse into non-hidden, non-underscore subdirectories
      var subResults = collectCommandsRecursive(fullPath);
      subResults.forEach(function (cmd) {
        // Prefix the command name with the subfolder for disambiguation
        cmd.subfolder = e.name;
        results.push(cmd);
      });
    }
  });

  return results;
}

function parseCommandSummary(filePath) {
  try {
    var parsed = parseCommandFile(filePath);
    return {
      name: parsed.name,
      title: parsed.title,
      purpose: parsed.purpose,
      syntax: parsed.syntax,
      filePath: parsed.filePath,
      lastModified: parsed.lastModified,
      subfolder: null,
    };
  } catch (e) {
    return {
      name: path.basename(filePath, '.md'),
      title: path.basename(filePath, '.md'),
      purpose: '',
      syntax: '',
      filePath: filePath,
      lastModified: null,
      subfolder: null,
      error: e.message,
    };
  }
}

/**
 * Get full content of a specific command.
 *
 * @param {string} name — command name (without .md extension)
 * @param {string} [commandsDir] — override directory
 * @returns {object|null} parsed command with full content, or null
 */
function getCommand(name, commandsDir) {
  var dir = commandsDir || COMMANDS_DIR;
  // First try direct path
  var filePath = path.join(dir, name + '.md');
  if (fs.existsSync(filePath)) return parseCommandFile(filePath);
  // Search recursively
  var found = findCommandFile(dir, name);
  if (found) return parseCommandFile(found);
  return null;
}

/**
 * Recursively find a command file by name in a directory tree.
 */
function findCommandFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.name.startsWith('.')) continue;
    var fullPath = path.join(dir, e.name);
    if (e.isFile() && e.name === name + '.md') return fullPath;
    if (e.isDirectory() && !e.name.startsWith('.')) {
      var found = findCommandFile(fullPath, name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Save a command (create or update).
 *
 * @param {string} name — command name (without .md)
 * @param {string} content — full markdown content
 * @param {string} [commandsDir] — override directory
 * @returns {object} result
 */
function saveCommand(name, content, commandsDir) {
  var dir = commandsDir || COMMANDS_DIR;
  // Try to find existing file first
  var existing = findCommandFile(dir, name);
  if (existing) {
    fs.writeFileSync(existing, content, 'utf8');
    return { success: true, name: name, filePath: existing };
  }
  // Create new at root of dir
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  var safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  var filePath = path.join(dir, safeName + '.md');
  fs.writeFileSync(filePath, content, 'utf8');
  return { success: true, name: safeName, filePath: filePath };
}

/**
 * Delete a command.
 *
 * @param {string} name — command name (without .md)
 * @param {string} [commandsDir] — override directory
 * @returns {object} result
 */
function deleteCommand(name, commandsDir) {
  var dir = commandsDir || COMMANDS_DIR;
  // Try direct path first
  var filePath = path.join(dir, name + '.md');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return { success: true };
  }
  // Search recursively
  var found = findCommandFile(dir, name);
  if (found) {
    fs.unlinkSync(found);
    return { success: true };
  }
  return { success: false, error: 'Command not found' };
}

/**
 * Load CLAUDE.md from a project directory if it exists.
 *
 * @param {string} projectDir — project root directory
 * @returns {object|null} { content, filePath } or null
 */
function loadProjectClaudeMd(projectDir) {
  if (!projectDir) return null;
  var filePath = path.join(projectDir, 'CLAUDE.md');
  if (!fs.existsSync(filePath)) return null;
  return {
    content: fs.readFileSync(filePath, 'utf8'),
    filePath: filePath,
    lastModified: fs.statSync(filePath).mtime.toISOString(),
  };
}

/**
 * Load commands from a project's _commands/ directory.
 *
 * @param {string} projectDir — project root directory
 * @returns {object[]} array of { folder, commands[] } from the project
 */
function listProjectCommands(projectDir) {
  if (!projectDir) return [];
  var dir = path.join(projectDir, '_commands');
  return listCommands(dir);
}

module.exports = {
  listCommands,
  getCommand,
  saveCommand,
  deleteCommand,
  loadProjectClaudeMd,
  listProjectCommands,
  parseCommandFile,
  COMMANDS_DIR,
};
