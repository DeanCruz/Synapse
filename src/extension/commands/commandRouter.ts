import * as path from 'node:path';

export type CommandScope = 'root' | 'project';
export type CommandSource = 'vscode-command' | 'chat-action' | 'manual';

export interface MarkdownCommandSummary {
  name: string;
  title: string;
  purpose: string;
  syntax: string;
  filePath: string;
  lastModified: string | null;
  error?: string;
}

export interface MarkdownCommandDocument extends MarkdownCommandSummary {
  content: string;
}

export interface MarkdownCommandService {
  listCommands(commandsDir?: string): MarkdownCommandSummary[];
  getCommand(name: string, commandsDir?: string): MarkdownCommandDocument | null;
  loadProjectClaudeMd(projectDir: string): { content: string; filePath: string; lastModified: string | null } | null;
  listProjectCommands(projectDir: string): MarkdownCommandSummary[];
}

export interface CommandRouterOptions {
  trackerRoot: string;
  projectRoot?: string | null;
  commandsDir?: string;
  projectCommandsDir?: string;
}

export interface ChatActionDescriptor {
  id: string;
  label: string;
  commandName: string;
  args?: string;
  autoSend: boolean;
  description?: string;
}

export interface CommandResolution {
  kind: 'markdown-command';
  source: CommandSource;
  scope: CommandScope | null;
  name: string;
  invocation: string;
  prompt: string;
  command: MarkdownCommandDocument | MarkdownCommandSummary | null;
}

export interface CommandCatalog {
  rootCommands: MarkdownCommandSummary[];
  projectCommands: MarkdownCommandSummary[];
  allCommands: Array<MarkdownCommandSummary & { scope: CommandScope }>;
  projectClaudeMd: { content: string; filePath: string; lastModified: string | null } | null;
}

export const DEFAULT_CHAT_ACTIONS: ChatActionDescriptor[] = [
  { id: 'p_track', label: '!p_track', commandName: 'p_track', autoSend: false },
  { id: 'dispatch-ready', label: '!dispatch --ready', commandName: 'dispatch', args: '--ready', autoSend: true },
  { id: 'status', label: '!status', commandName: 'status', autoSend: true },
  { id: 'cancel', label: '!cancel', commandName: 'cancel', autoSend: true },
];

function normalizeCommandName(command: string): string {
  return command.replace(/^\s*!/, '').trim();
}

function appendPrompt(commandText: string, prompt?: string): string {
  const trimmedPrompt = prompt ? prompt.trim() : '';
  if (!trimmedPrompt) return commandText.trim();
  return `${commandText.trim()} ${trimmedPrompt}`;
}

export function buildMarkdownInvocation(commandName: string, prompt?: string): string {
  return appendPrompt(`!${normalizeCommandName(commandName)}`, prompt);
}

export function buildChatActionInvocation(action: ChatActionDescriptor, prompt?: string): string {
  const baseCommand = `!${normalizeCommandName(action.commandName)}${action.args ? ` ${action.args.trim()}` : ''}`;
  return appendPrompt(baseCommand, prompt);
}

export class CommandRouter {
  private readonly commandsService: MarkdownCommandService;
  private readonly options: CommandRouterOptions;

  constructor(commandsService: MarkdownCommandService, options: CommandRouterOptions) {
    this.commandsService = commandsService;
    this.options = options;
  }

  get projectCommandsDir(): string | null {
    if (this.options.projectCommandsDir) return this.options.projectCommandsDir;
    if (!this.options.projectRoot) return null;
    return path.join(this.options.projectRoot, '_commands');
  }

  listCommandCatalog(): CommandCatalog {
    const rootCommands = this.commandsService.listCommands(this.options.commandsDir);
    const projectCommandsDir = this.projectCommandsDir;
    let projectCommands: MarkdownCommandSummary[] = [];

    if (projectCommandsDir) {
      if (this.options.projectCommandsDir) {
        projectCommands = this.commandsService.listCommands(projectCommandsDir);
      } else if (this.options.projectRoot) {
        projectCommands = this.commandsService.listProjectCommands(this.options.projectRoot);
      } else {
        projectCommands = this.commandsService.listCommands(projectCommandsDir);
      }
    }

    const allCommands = [
      ...rootCommands.map((command) => ({ ...command, scope: 'root' as const })),
      ...projectCommands.map((command) => ({ ...command, scope: 'project' as const })),
    ];

    return {
      rootCommands,
      projectCommands,
      allCommands,
      projectClaudeMd: this.options.projectRoot
        ? this.commandsService.loadProjectClaudeMd(this.options.projectRoot)
        : null,
    };
  }

  listChatActions(): ChatActionDescriptor[] {
    return DEFAULT_CHAT_ACTIONS.slice();
  }

  getCommand(name: string, scope: CommandScope = 'root'): MarkdownCommandDocument | null {
    if (scope === 'project') {
      const projectCommandsDir = this.projectCommandsDir;
      if (!projectCommandsDir) return null;
      return this.commandsService.getCommand(name, projectCommandsDir);
    }

    return this.commandsService.getCommand(name, this.options.commandsDir);
  }

  resolveCommand(
    name: string,
    options: { scope?: CommandScope; prompt?: string; source?: CommandSource } = {},
  ): CommandResolution {
    const scope = options.scope || 'root';
    const command = this.getCommand(name, scope);

    return {
      kind: 'markdown-command',
      source: options.source || 'vscode-command',
      scope: command ? scope : null,
      name: normalizeCommandName(name),
      invocation: buildMarkdownInvocation(name, options.prompt),
      prompt: options.prompt || '',
      command,
    };
  }

  resolveChatAction(
    action: ChatActionDescriptor,
    prompt = '',
    source: CommandSource = 'chat-action',
  ): CommandResolution {
    const commandName = normalizeCommandName(action.commandName);
    const rootCommand = this.getCommand(commandName, 'root');
    const projectCommand = rootCommand ? null : this.getCommand(commandName, 'project');
    const command = rootCommand || projectCommand;

    return {
      kind: 'markdown-command',
      source,
      scope: rootCommand ? 'root' : projectCommand ? 'project' : null,
      name: commandName,
      invocation: buildChatActionInvocation(action, prompt),
      prompt,
      command,
    };
  }
}

export function createCommandRouter(commandsService: MarkdownCommandService, options: CommandRouterOptions): CommandRouter {
  return new CommandRouter(commandsService, options);
}
