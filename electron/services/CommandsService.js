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
 * List all commands from _commands/ directory.
 * Returns parsed metadata for each (without full content for performance).
 *
 * @param {string} [commandsDir] — override directory (for loading from project)
 * @returns {object[]} array of command summaries
 */
function listCommands(commandsDir) {
  var dir = commandsDir || COMMANDS_DIR;
  if (!fs.existsSync(dir)) return [];

  var files = fs.readdirSync(dir).filter(function (f) {
    return f.endsWith('.md') && !f.startsWith('.');
  });

  return files.map(function (f) {
    var filePath = path.join(dir, f);
    try {
      var parsed = parseCommandFile(filePath);
      // Return summary without full content
      return {
        name: parsed.name,
        title: parsed.title,
        purpose: parsed.purpose,
        syntax: parsed.syntax,
        filePath: parsed.filePath,
        lastModified: parsed.lastModified,
      };
    } catch (e) {
      return {
        name: path.basename(f, '.md'),
        title: path.basename(f, '.md'),
        purpose: '',
        syntax: '',
        filePath: filePath,
        lastModified: null,
        error: e.message,
      };
    }
  });
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
  var filePath = path.join(dir, name + '.md');
  if (!fs.existsSync(filePath)) return null;
  return parseCommandFile(filePath);
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
  var filePath = path.join(dir, name + '.md');
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'Command not found' };
  }
  fs.unlinkSync(filePath);
  return { success: true };
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
 * @returns {object[]} array of command summaries from the project
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
