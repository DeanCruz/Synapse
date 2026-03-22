/**
 * WorkspaceCommandService — Command loading/parsing for the VSCode extension host
 *
 * Implements the MarkdownCommandService interface defined in commandRouter.ts
 * so that CommandRouter can consume it directly. Adapts the patterns from
 * electron/services/CommandsService.js for the extension context:
 *
 *   - parseCommandFile() — Parse a command .md file into structured data
 *   - listCommands(commandsDir?) — List all commands from a _commands/ directory
 *   - getCommand(name, commandsDir?) — Get a single command by name
 *   - loadProjectClaudeMd(projectDir) — Load CLAUDE.md from a project directory
 *   - listProjectCommands(projectDir) — List commands from a project's _commands/
 *
 * Uses Node fs module (available in extension host) for file operations.
 */

import * as fs from 'fs';
import * as path from 'path';

import type {
  MarkdownCommandService,
  MarkdownCommandSummary,
  MarkdownCommandDocument,
} from '../commands/commandRouter';

// ---------------------------------------------------------------------------
// Types (additional to those imported from commandRouter)
// ---------------------------------------------------------------------------

export interface SaveCommandResult {
  success: boolean;
  name: string;
  filePath: string;
}

export interface DeleteCommandResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// WorkspaceCommandService
// ---------------------------------------------------------------------------

export class WorkspaceCommandService implements MarkdownCommandService {
  /**
   * Default commands directory — Synapse's own _commands/ directory.
   * Resolved relative to the extension's tracker root.
   */
  private readonly defaultCommandsDir: string;

  constructor(trackerRoot: string) {
    this.defaultCommandsDir = path.join(trackerRoot, '_commands');
  }

  // -----------------------------------------------------------------------
  // MarkdownCommandService interface implementation
  // -----------------------------------------------------------------------

  /**
   * List all commands from a _commands/ directory.
   * Returns parsed metadata for each (without full content for performance).
   *
   * Mirrors: electron/services/CommandsService.js → listCommands()
   */
  listCommands(commandsDir?: string): MarkdownCommandSummary[] {
    const dir = commandsDir || this.defaultCommandsDir;
    if (!fs.existsSync(dir)) return [];

    let files: string[];
    try {
      files = fs.readdirSync(dir).filter(
        (f) => f.endsWith('.md') && !f.startsWith('.'),
      );
    } catch {
      return [];
    }

    return files.map((f) => {
      const filePath = path.join(dir, f);
      try {
        const parsed = this.parseCommandFile(filePath);
        // Return summary without full content
        return {
          name: parsed.name,
          title: parsed.title,
          purpose: parsed.purpose,
          syntax: parsed.syntax,
          filePath: parsed.filePath,
          lastModified: parsed.lastModified,
        };
      } catch (e: unknown) {
        return {
          name: path.basename(f, '.md'),
          title: path.basename(f, '.md'),
          purpose: '',
          syntax: '',
          filePath,
          lastModified: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });
  }

  /**
   * Get full content of a specific command.
   *
   * Mirrors: electron/services/CommandsService.js → getCommand()
   */
  getCommand(name: string, commandsDir?: string): MarkdownCommandDocument | null {
    const dir = commandsDir || this.defaultCommandsDir;
    const filePath = path.join(dir, name + '.md');
    if (!fs.existsSync(filePath)) return null;

    try {
      return this.parseCommandFile(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Load CLAUDE.md from a project directory if it exists.
   *
   * Mirrors: electron/services/CommandsService.js → loadProjectClaudeMd()
   */
  loadProjectClaudeMd(
    projectDir: string,
  ): { content: string; filePath: string; lastModified: string | null } | null {
    if (!projectDir) return null;

    const filePath = path.join(projectDir, 'CLAUDE.md');
    if (!fs.existsSync(filePath)) return null;

    try {
      return {
        content: fs.readFileSync(filePath, 'utf8'),
        filePath,
        lastModified: fs.statSync(filePath).mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Load commands from a project's _commands/ directory.
   *
   * Mirrors: electron/services/CommandsService.js → listProjectCommands()
   */
  listProjectCommands(projectDir: string): MarkdownCommandSummary[] {
    if (!projectDir) return [];
    const dir = path.join(projectDir, '_commands');
    return this.listCommands(dir);
  }

  // -----------------------------------------------------------------------
  // Additional methods (beyond the MarkdownCommandService interface)
  // -----------------------------------------------------------------------

  /**
   * Parse a command markdown file into structured data.
   * Extracts: name (from filename), title (first H1), purpose, syntax, content.
   *
   * Mirrors: electron/services/CommandsService.js → parseCommandFile()
   */
  parseCommandFile(filePath: string): MarkdownCommandDocument {
    const content = fs.readFileSync(filePath, 'utf8');
    const filename = path.basename(filePath, '.md');

    // Extract title from first H1
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : filename;

    // Extract purpose from **Purpose:** line
    const purposeMatch = content.match(/\*\*Purpose:\*\*\s*(.+?)(?:\n|$)/);
    const purpose = purposeMatch ? purposeMatch[1].trim() : '';

    // Extract syntax from **Syntax:** line
    const syntaxMatch = content.match(/\*\*Syntax:\*\*\s*(.+?)(?:\n|$)/);
    const syntax = syntaxMatch ? syntaxMatch[1].trim() : '';

    let lastModified: string | null = null;
    try {
      lastModified = fs.statSync(filePath).mtime.toISOString();
    } catch {
      // ignore
    }

    return {
      name: filename,
      title,
      purpose,
      syntax,
      content,
      filePath,
      lastModified,
    };
  }

  /**
   * Save a command (create or update).
   *
   * Mirrors: electron/services/CommandsService.js → saveCommand()
   */
  saveCommand(
    name: string,
    content: string,
    commandsDir?: string,
  ): SaveCommandResult {
    const dir = commandsDir || this.defaultCommandsDir;

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(dir, safeName + '.md');
    fs.writeFileSync(filePath, content, 'utf8');

    return { success: true, name: safeName, filePath };
  }

  /**
   * Delete a command.
   *
   * Mirrors: electron/services/CommandsService.js → deleteCommand()
   */
  deleteCommand(name: string, commandsDir?: string): DeleteCommandResult {
    const dir = commandsDir || this.defaultCommandsDir;
    const filePath = path.join(dir, name + '.md');

    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'Command not found' };
    }

    try {
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * List commands from the project/ subdirectory of the commands directory.
   * This loads Synapse's project analysis commands (context, review, health, etc.).
   */
  listProjectAnalysisCommands(): MarkdownCommandSummary[] {
    const projectDir = path.join(this.defaultCommandsDir, 'project');
    return this.listCommands(projectDir);
  }

  /**
   * Get a project analysis command by name.
   */
  getProjectAnalysisCommand(name: string): MarkdownCommandDocument | null {
    const projectDir = path.join(this.defaultCommandsDir, 'project');
    return this.getCommand(name, projectDir);
  }

  /**
   * Get the default commands directory path.
   */
  getDefaultCommandsDir(): string {
    return this.defaultCommandsDir;
  }
}

export default WorkspaceCommandService;
