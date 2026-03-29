// CommandsService — Loads, parses, and manages _commands/ markdown files
// CommonJS module for Electron main process.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SYNAPSE_ROOT = path.resolve(__dirname, '../..');
const COMMANDS_DIR = path.join(SYNAPSE_ROOT, '_commands');
const USER_COMMANDS_DIR = path.join(COMMANDS_DIR, 'user');

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

  // Collect subdirectory groups (skip hidden dirs; skip 'user' dir when listing from default COMMANDS_DIR)
  var isDefaultDir = dir === COMMANDS_DIR;
  var subdirs = entries.filter(function (e) {
    if (!e.isDirectory() || e.name.startsWith('.')) return false;
    if (isDefaultDir && e.name === 'user') return false;
    return true;
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

/**
 * Save a command into a specific subfolder of _commands/.
 *
 * @param {string} name — command name (without .md)
 * @param {string} content — full markdown content
 * @param {string} folderName — subfolder name (e.g., "Synapse", "project")
 * @returns {object} result
 */
function saveCommandInFolder(name, content, folderName) {
  var dir = path.join(COMMANDS_DIR, folderName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  var safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  var filePath = path.join(dir, safeName + '.md');
  fs.writeFileSync(filePath, content, 'utf8');
  return { success: true, name: safeName, filePath: filePath };
}

/**
 * Create a new user command folder under _commands/user/.
 *
 * @param {string} folderName — folder name
 * @returns {object} result
 */
function createCommandFolder(folderName) {
  var safeName = folderName.replace(/[^a-zA-Z0-9_-]/g, '_');
  var dirPath = path.join(USER_COMMANDS_DIR, safeName);
  if (fs.existsSync(dirPath)) {
    return { success: false, error: 'Folder already exists' };
  }
  fs.mkdirSync(dirPath, { recursive: true });
  return { success: true, name: safeName, path: dirPath };
}

/**
 * List user commands from _commands/user/ directory.
 * @returns {object[]} array of { folder, commands[] }
 */
function listUserCommands() {
  return listCommands(USER_COMMANDS_DIR);
}

/**
 * Get full content of a user command from _commands/user/.
 *
 * @param {string} name — command name (without .md)
 * @param {string} [folderName] — optional subfolder within user/
 * @returns {object|null}
 */
function getUserCommand(name, folderName) {
  var dir = folderName ? path.join(USER_COMMANDS_DIR, folderName) : USER_COMMANDS_DIR;
  return getCommand(name, dir);
}

/**
 * Save a user command to _commands/user/ or _commands/user/{folder}/.
 *
 * @param {string} name — command name (without .md)
 * @param {string} content — full markdown content
 * @param {string} [folderName] — optional subfolder name within user/
 * @returns {object} result
 */
function saveUserCommand(name, content, folderName) {
  var dir = folderName ? path.join(USER_COMMANDS_DIR, folderName) : USER_COMMANDS_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  var safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  // Check for existing file first
  var existing = findCommandFile(dir, safeName);
  if (existing) {
    fs.writeFileSync(existing, content, 'utf8');
    return { success: true, name: safeName, filePath: existing };
  }
  var filePath = path.join(dir, safeName + '.md');
  fs.writeFileSync(filePath, content, 'utf8');
  return { success: true, name: safeName, filePath: filePath };
}

/**
 * Delete a user command from _commands/user/.
 *
 * @param {string} name — command name (without .md)
 * @param {string} [folderName] — optional subfolder name within user/
 * @returns {object} result
 */
function deleteUserCommand(name, folderName) {
  var dir = folderName ? path.join(USER_COMMANDS_DIR, folderName) : USER_COMMANDS_DIR;
  return deleteCommand(name, dir);
}

/**
 * Generate a user command file using Claude CLI, saved to _commands/user/{folder}/.
 *
 * @param {string} description — user's description of what the command should do
 * @param {string} folderName — target folder within user/ (or empty for root user/)
 * @param {string} commandName — desired command name
 * @param {object} [opts] — options
 * @returns {Promise<object>}
 */
function generateUserCommand(description, folderName, commandName, opts) {
  opts = opts || {};
  var cliPath = opts.cliPath || 'claude';
  var targetFolder = folderName ? path.join('user', folderName) : 'user';

  return new Promise(function (resolve) {
    var claudeMdPath = path.join(SYNAPSE_ROOT, 'CLAUDE.md');
    var claudeMdContent = '';
    try {
      claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
    } catch (e) {}

    // Read example commands from Synapse commands for style reference
    var exampleDir = path.join(COMMANDS_DIR, 'Synapse');
    var examples = '';
    try {
      if (fs.existsSync(exampleDir)) {
        var files = fs.readdirSync(exampleDir).filter(function (f) {
          return f.endsWith('.md') && !f.startsWith('.');
        }).slice(0, 3);
        files.forEach(function (f) {
          var content = fs.readFileSync(path.join(exampleDir, f), 'utf8');
          examples += '\n--- Example: ' + f + ' ---\n' + content.slice(0, 2000) + '\n';
        });
      }
    } catch (e) {}

    var systemPrompt = [
      'You are a command file generator for Synapse, a distributed agent swarm control system.',
      'Your task is to generate a complete, production-quality command .md file.',
      '',
      'The command file will be saved to: _commands/' + targetFolder + '/' + commandName + '.md',
      '',
      'IMPORTANT RULES:',
      '- Output ONLY the raw markdown content of the command file. No code fences, no explanation, no preamble.',
      '- Follow the exact structure and style of the example commands provided below.',
      '- The command must start with a H1 heading: # `!' + commandName + '`',
      '- Include **Purpose:** and **Syntax:** fields.',
      '- Include detailed step-by-step instructions.',
      '- Use {tracker_root} and {project_root} path placeholders where appropriate.',
      '- Be thorough and specific — the command file should be self-contained.',
      '',
      '--- CLAUDE.md (project context) ---',
      claudeMdContent.slice(0, 8000),
      '',
      '--- Example command files for reference ---',
      examples || '(no examples available)',
    ].join('\n');

    var userPrompt = 'Generate a command file for: ' + description;
    var args = ['--print', '--max-turns', '1'];
    if (opts.model) args.push('--model', opts.model);
    args.push('--append-system-prompt', systemPrompt);
    args.push(userPrompt);

    var output = '';
    var proc = spawn(cliPath, args, {
      cwd: SYNAPSE_ROOT,
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: undefined }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', function (chunk) { output += chunk.toString(); });
    proc.stderr.on('data', function () {});

    proc.on('close', function (code) {
      if (code !== 0 || !output.trim()) {
        resolve({ success: false, error: 'Claude CLI exited with code ' + code });
        return;
      }

      var content = '';
      var lines = output.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          var parsed = JSON.parse(line);
          if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
            parsed.message.content.forEach(function (block) {
              if (block.type === 'text') content += block.text;
            });
          } else if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
            content += parsed.delta.text;
          } else if (parsed.type === 'result' && parsed.result) {
            content = parsed.result;
          }
        } catch (e) {
          content += line + '\n';
        }
      }

      content = content.trim();
      if (!content) {
        resolve({ success: false, error: 'No content generated' });
        return;
      }
      content = content.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '');

      var safeName = commandName.replace(/[^a-zA-Z0-9_-]/g, '_');
      var dir = folderName ? path.join(USER_COMMANDS_DIR, folderName) : USER_COMMANDS_DIR;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      var filePath = path.join(dir, safeName + '.md');
      fs.writeFileSync(filePath, content, 'utf8');

      resolve({ success: true, name: safeName, filePath: filePath, content: content });
    });

    proc.on('error', function (err) {
      resolve({ success: false, error: 'Failed to spawn Claude CLI: ' + err.message });
    });
  });
}

/**
 * Generate a command file using Claude CLI.
 * Reads CLAUDE.md and existing commands for context, then generates a full command .md file.
 *
 * @param {string} description — user's description of what the command should do
 * @param {string} folderName — target folder (e.g., "Synapse", "project")
 * @param {string} commandName — desired command name
 * @param {object} [opts] — options
 * @param {string} [opts.cliPath] — path to Claude binary
 * @param {string} [opts.model] — model to use
 * @param {Function} [opts.onProgress] — callback for progress updates
 * @returns {Promise<{success: boolean, name?: string, filePath?: string, content?: string, error?: string}>}
 */
function generateCommand(description, folderName, commandName, opts) {
  opts = opts || {};
  var cliPath = opts.cliPath || 'claude';

  return new Promise(function (resolve) {
    // Read CLAUDE.md for context
    var claudeMdPath = path.join(SYNAPSE_ROOT, 'CLAUDE.md');
    var claudeMdContent = '';
    try {
      claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
    } catch (e) {
      // Continue without it
    }

    // Read a few example commands from the target folder for style reference
    var exampleDir = path.join(COMMANDS_DIR, folderName);
    var examples = '';
    try {
      if (fs.existsSync(exampleDir)) {
        var files = fs.readdirSync(exampleDir).filter(function (f) {
          return f.endsWith('.md') && !f.startsWith('.');
        }).slice(0, 3);
        files.forEach(function (f) {
          var content = fs.readFileSync(path.join(exampleDir, f), 'utf8');
          examples += '\n--- Example: ' + f + ' ---\n' + content.slice(0, 2000) + '\n';
        });
      }
    } catch (e) {
      // Continue without examples
    }

    var systemPrompt = [
      'You are a command file generator for Synapse, a distributed agent swarm control system.',
      'Your task is to generate a complete, production-quality command .md file.',
      '',
      'The command file will be saved to: _commands/' + folderName + '/' + commandName + '.md',
      '',
      'IMPORTANT RULES:',
      '- Output ONLY the raw markdown content of the command file. No code fences, no explanation, no preamble.',
      '- Follow the exact structure and style of the example commands provided below.',
      '- The command must start with a H1 heading: # `!' + commandName + '`',
      '- Include **Purpose:** and **Syntax:** fields.',
      '- Include detailed step-by-step instructions.',
      '- Use {tracker_root} and {project_root} path placeholders where appropriate.',
      '- Be thorough and specific — the command file should be self-contained.',
      '',
      '--- CLAUDE.md (project context) ---',
      claudeMdContent.slice(0, 8000),
      '',
      '--- Example command files for reference ---',
      examples || '(no examples available)',
    ].join('\n');

    var userPrompt = 'Generate a command file for: ' + description;

    var args = ['--print', '--max-turns', '1'];
    if (opts.model) {
      args.push('--model', opts.model);
    }
    args.push('--append-system-prompt', systemPrompt);
    args.push(userPrompt);

    var output = '';
    var proc = spawn(cliPath, args, {
      cwd: SYNAPSE_ROOT,
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: undefined }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', function (chunk) {
      output += chunk.toString();
    });

    proc.stderr.on('data', function (chunk) {
      // Ignore stderr but could log for debugging
    });

    proc.on('close', function (code) {
      if (code !== 0 || !output.trim()) {
        resolve({ success: false, error: 'Claude CLI exited with code ' + code });
        return;
      }

      // Parse the streamed JSON output to extract the text content
      var content = '';
      var lines = output.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          var parsed = JSON.parse(line);
          if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
            // Extract text blocks
            parsed.message.content.forEach(function (block) {
              if (block.type === 'text') {
                content += block.text;
              }
            });
          } else if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
            content += parsed.delta.text;
          } else if (parsed.type === 'result' && parsed.result) {
            // Final result format
            content = parsed.result;
          }
        } catch (e) {
          // Not JSON, might be raw text output
          content += line + '\n';
        }
      }

      content = content.trim();
      if (!content) {
        resolve({ success: false, error: 'No content generated' });
        return;
      }

      // Strip code fences if Claude wrapped the output
      content = content.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/, '');

      // Save the generated command
      var safeName = commandName.replace(/[^a-zA-Z0-9_-]/g, '_');
      var dir = path.join(COMMANDS_DIR, folderName);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      var filePath = path.join(dir, safeName + '.md');
      fs.writeFileSync(filePath, content, 'utf8');

      resolve({ success: true, name: safeName, filePath: filePath, content: content });
    });

    proc.on('error', function (err) {
      resolve({ success: false, error: 'Failed to spawn Claude CLI: ' + err.message });
    });
  });
}

module.exports = {
  listCommands,
  getCommand,
  saveCommand,
  saveCommandInFolder,
  deleteCommand,
  createCommandFolder,
  generateCommand,
  loadProjectClaudeMd,
  listProjectCommands,
  parseCommandFile,
  listUserCommands,
  getUserCommand,
  saveUserCommand,
  deleteUserCommand,
  generateUserCommand,
  COMMANDS_DIR,
  USER_COMMANDS_DIR,
};
