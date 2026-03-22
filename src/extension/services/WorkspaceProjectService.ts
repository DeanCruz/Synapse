/**
 * WorkspaceProjectService — Project detection using vscode.workspace
 *
 * Adapts the Electron ProjectService.js patterns for the VSCode extension host:
 *   - Uses vscode.workspace.workspaceFolders as the primary project_root resolver
 *   - Discovers CLAUDE.md files at top-level and one level deep
 *   - Detects project language from marker files (package.json, tsconfig.json, etc.)
 *   - Scans directory trees for display (limited depth)
 *   - Detects Claude CLI and Codex CLI binaries on the host
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  path: string;
  name: string;
  language: string | null;
  hasClaudeMd: boolean;
  claudeMdPaths: string[];
}

export interface ProjectContextEntry {
  path: string;
  content: string;
}

export interface DirectoryEntry {
  name: string;
  type: 'dir' | 'file';
  children?: DirectoryEntry[];
}

export type AgentProvider = 'claude' | 'codex';

// ---------------------------------------------------------------------------
// Language detection markers (mirrors electron/services/ProjectService.js)
// ---------------------------------------------------------------------------

const DETECT_FILES: ReadonlyArray<{ file: string; language: string }> = [
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

// Directories to skip during scanning
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.tox',
  '.venv',
  'venv',
  'target',
  'build',
]);

// ---------------------------------------------------------------------------
// WorkspaceProjectService
// ---------------------------------------------------------------------------

export class WorkspaceProjectService {
  /**
   * Resolve the primary project root.
   *
   * Priority:
   *   1. Explicit `override` argument
   *   2. First vscode workspace folder (if vscode API available)
   *   3. null
   */
  resolveProjectRoot(override?: string | null): string | null {
    if (override) return path.resolve(override);

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscode = require('vscode');
      const folders = vscode.workspace?.workspaceFolders;
      if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
      }
    } catch {
      // vscode not available (e.g. running in tests) — fall through
    }

    return null;
  }

  /**
   * Return all workspace folder paths (multi-root support).
   */
  listWorkspaceFolders(): string[] {
    try {
      const vscode = require('vscode');
      const folders = vscode.workspace?.workspaceFolders;
      if (!folders) return [];
      return folders.map((f: { uri: { fsPath: string } }) => f.uri.fsPath);
    } catch {
      return [];
    }
  }

  /**
   * Load a project from a directory path.
   * Detects language, finds CLAUDE.md files, extracts name.
   *
   * Mirrors: electron/services/ProjectService.js → loadProject()
   */
  loadProject(dirPath: string): ProjectInfo {
    let name = path.basename(dirPath);
    let language: string | null = null;
    let hasClaudeMd = false;
    const claudeMdPaths: string[] = [];

    // Detect language from marker files
    for (const marker of DETECT_FILES) {
      if (fs.existsSync(path.join(dirPath, marker.file))) {
        language = marker.language;
        break;
      }
    }

    // Try to read project name from package.json
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dirPath, 'package.json'), 'utf-8'),
      );
      if (pkg.name) name = pkg.name;
    } catch {
      // ignore — no package.json or invalid JSON
    }

    // Find CLAUDE.md at root
    const rootClaudeMd = path.join(dirPath, 'CLAUDE.md');
    if (fs.existsSync(rootClaudeMd)) {
      hasClaudeMd = true;
      claudeMdPaths.push(rootClaudeMd);
    }

    // Find CLAUDE.md one level deep (excluding hidden dirs and node_modules)
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !SKIP_DIRS.has(entry.name)
        ) {
          const childClaudeMd = path.join(dirPath, entry.name, 'CLAUDE.md');
          if (fs.existsSync(childClaudeMd)) {
            claudeMdPaths.push(childClaudeMd);
          }
        }
      }
    } catch {
      // ignore — permission errors, etc.
    }

    return { path: dirPath, name, language, hasClaudeMd, claudeMdPaths };
  }

  /**
   * Get the contents of all CLAUDE.md files for a project.
   *
   * Mirrors: electron/services/ProjectService.js → getProjectContext()
   */
  getProjectContext(dirPath: string): ProjectContextEntry[] {
    const project = this.loadProject(dirPath);
    const contexts: ProjectContextEntry[] = [];

    for (const claudePath of project.claudeMdPaths) {
      try {
        const content = fs.readFileSync(claudePath, 'utf-8');
        contexts.push({ path: claudePath, content });
      } catch {
        // ignore — file may have been deleted between scan and read
      }
    }

    return contexts;
  }

  /**
   * Scan a directory tree for display (limited depth).
   * Directories-first, then alphabetical within each group.
   *
   * Mirrors: electron/services/ProjectService.js → scanDirectory()
   */
  scanDirectory(dirPath: string, maxDepth = 2): DirectoryEntry[] {
    const scan = (dir: string, depth: number): DirectoryEntry[] => {
      if (depth > maxDepth) return [];
      const results: DirectoryEntry[] = [];

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        entries.sort((a, b) => {
          // Directories first, then alphabetical
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const entry of entries) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

          const item: DirectoryEntry = {
            name: entry.name,
            type: entry.isDirectory() ? 'dir' : 'file',
          };

          if (entry.isDirectory()) {
            item.children = scan(path.join(dir, entry.name), depth + 1);
          }

          results.push(item);
        }
      } catch {
        // ignore permission errors
      }

      return results;
    };

    return scan(dirPath, 0);
  }

  /**
   * Detect a CLI binary by name, checking PATH first then common locations.
   */
  private detectCliBinary(
    binaryName: string,
    commonPaths: string[],
  ): string | null {
    try {
      const result = execSync(`which ${binaryName}`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (result && fs.existsSync(result)) return result;
    } catch {
      // not found via which
    }

    for (const candidate of commonPaths) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return null;
  }

  /**
   * Detect Claude CLI binary path.
   *
   * Mirrors: electron/services/ProjectService.js → detectClaudeCLI()
   */
  detectClaudeCLI(): string | null {
    const home = process.env.HOME || '';
    return this.detectCliBinary('claude', [
      '/usr/local/bin/claude',
      path.join(home, '.claude', 'bin', 'claude'),
      path.join(home, '.local', 'bin', 'claude'),
    ]);
  }

  /**
   * Detect Codex CLI binary path.
   *
   * Mirrors: electron/services/ProjectService.js → detectCodexCLI()
   */
  detectCodexCLI(): string | null {
    const home = process.env.HOME || '';
    return this.detectCliBinary('codex', [
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      path.join(home, '.local', 'bin', 'codex'),
    ]);
  }

  /**
   * Detect an agent CLI binary by provider name.
   *
   * Mirrors: electron/services/ProjectService.js → detectAgentCLI()
   */
  detectAgentCLI(provider: AgentProvider): string | null {
    return provider === 'codex' ? this.detectCodexCLI() : this.detectClaudeCLI();
  }
}

export default WorkspaceProjectService;
