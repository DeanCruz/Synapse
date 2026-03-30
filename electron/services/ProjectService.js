// electron/services/ProjectService.js — Project detection and context loading
// Scans a directory for project metadata, finds CLAUDE.md files, manages recent projects.

const fs = require('fs');
const path = require('path');

const DETECT_FILES = [
  { file: 'package.json', language: 'javascript' },
  { file: 'tsconfig.json', language: 'typescript' },
  { file: 'Cargo.toml', language: 'rust' },
  { file: 'go.mod', language: 'go' },
  { file: 'requirements.txt', language: 'python' },
  { file: 'pyproject.toml', language: 'python' },
  { file: 'Gemfile', language: 'ruby' },
  { file: 'pom.xml', language: 'java' },
  { file: 'build.gradle', language: 'java' },
];

/**
 * Load a project from a directory path.
 * Detects language, finds CLAUDE.md files, extracts name.
 *
 * @param {string} dirPath — absolute path to project directory
 * @returns {{ path, name, language, hasClaudeMd, claudeMdPaths }}
 */
function loadProject(dirPath) {
  var name = path.basename(dirPath);
  var language = null;
  var hasClaudeMd = false;
  var claudeMdPaths = [];

  // Detect language
  for (var i = 0; i < DETECT_FILES.length; i++) {
    if (fs.existsSync(path.join(dirPath, DETECT_FILES[i].file))) {
      language = DETECT_FILES[i].language;
      break;
    }
  }

  // Try to get name from package.json
  try {
    var pkg = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
    if (pkg.name) name = pkg.name;
  } catch (e) { /* ignore */ }

  // Find CLAUDE.md files (top-level and one level deep)
  var rootClaudeMd = path.join(dirPath, 'CLAUDE.md');
  if (fs.existsSync(rootClaudeMd)) {
    hasClaudeMd = true;
    claudeMdPaths.push(rootClaudeMd);
  }

  try {
    var entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (var j = 0; j < entries.length; j++) {
      if (entries[j].isDirectory() && !entries[j].name.startsWith('.') && entries[j].name !== 'node_modules') {
        var childClaudeMd = path.join(dirPath, entries[j].name, 'CLAUDE.md');
        if (fs.existsSync(childClaudeMd)) {
          claudeMdPaths.push(childClaudeMd);
        }
      }
    }
  } catch (e) { /* ignore */ }

  return { path: dirPath, name: name, language: language, hasClaudeMd: hasClaudeMd, claudeMdPaths: claudeMdPaths };
}

/**
 * Get the contents of all CLAUDE.md files for a project.
 *
 * @param {string} dirPath — project directory
 * @returns {{ path: string, content: string }[]}
 */
function getProjectContext(dirPath) {
  var project = loadProject(dirPath);
  var contexts = [];
  for (var i = 0; i < project.claudeMdPaths.length; i++) {
    try {
      var content = fs.readFileSync(project.claudeMdPaths[i], 'utf-8');
      contexts.push({ path: project.claudeMdPaths[i], content: content });
    } catch (e) { /* ignore */ }
  }
  return contexts;
}

/**
 * Scan a directory tree for display (limited depth).
 *
 * @param {string} dirPath — directory to scan
 * @param {number} [maxDepth=2] — how deep to scan
 * @returns {{ name, type, children? }[]}
 */
function scanDirectory(dirPath, maxDepth) {
  if (maxDepth === undefined) maxDepth = 2;

  function scan(dir, depth) {
    if (depth > maxDepth) return [];
    var results = [];
    try {
      var entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.sort(function (a, b) {
        // Directories first, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
        var item = { name: e.name, type: e.isDirectory() ? 'dir' : 'file' };
        if (e.isDirectory()) {
          item.children = scan(path.join(dir, e.name), depth + 1);
        }
        results.push(item);
      }
    } catch (e) { /* ignore permission errors */ }
    return results;
  }

  return scan(dirPath, 0);
}

function detectCliBinary(binaryName, commonPaths) {
  var { execSync } = require('child_process');
  try {
    var result = execSync('which ' + binaryName, { encoding: 'utf-8', timeout: 5000 }).trim();
    if (result && fs.existsSync(result)) return result;
  } catch (e) { /* not found */ }

  for (var i = 0; i < commonPaths.length; i++) {
    if (fs.existsSync(commonPaths[i])) return commonPaths[i];
  }
  return null;
}

/**
 * Detect Claude CLI binary path.
 *
 * @returns {string|null}
 */
function detectClaudeCLI() {
  return detectCliBinary('claude', [
    '/usr/local/bin/claude',
    path.join(process.env.HOME || '', '.claude', 'bin', 'claude'),
    path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
  ]);
}

/**
 * Detect Codex CLI binary path.
 *
 * @returns {string|null}
 */
function detectCodexCLI() {
  return detectCliBinary('codex', [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(process.env.HOME || '', '.local', 'bin', 'codex'),
  ]);
}

function detectAgentCLI(provider) {
  return provider === 'codex' ? detectCodexCLI() : detectClaudeCLI();
}

/**
 * Get project context from the primary directory and all additional directories (additive).
 * Collects CLAUDE.md files from every provided directory and returns them as a combined array.
 * The function name retains "Fallback" for backward compatibility, but behavior is additive —
 * all directories are always checked regardless of whether the primary has context.
 *
 * @param {string} primaryDir — primary project directory
 * @param {string[]} [additionalDirs] — additional context directories to also include
 * @returns {{ path: string, content: string }[]}
 */
function getProjectContextWithFallback(primaryDir, additionalDirs) {
  var contexts = primaryDir ? getProjectContext(primaryDir) : [];

  if (!additionalDirs || additionalDirs.length === 0) return contexts;

  for (var i = 0; i < additionalDirs.length; i++) {
    try {
      var additionalContexts = getProjectContext(additionalDirs[i]);
      for (var j = 0; j < additionalContexts.length; j++) {
        contexts.push(additionalContexts[j]);
      }
    } catch (e) { /* skip dirs that don't exist */ }
  }

  return contexts;
}

module.exports = { loadProject, getProjectContext, getProjectContextWithFallback, scanDirectory, detectClaudeCLI, detectCodexCLI, detectAgentCLI };
