import {
  CommandRouter,
  ChatActionDescriptor,
  CommandResolution,
  DEFAULT_CHAT_ACTIONS,
  CommandScope,
} from './commandRouter';

export interface DisposableLike {
  dispose(): unknown;
}

export interface CommandRegistrarLike {
  registerCommand(commandId: string, callback: (...args: any[]) => unknown): DisposableLike;
}

export interface ExtensionContextLike {
  subscriptions: DisposableLike[];
}

export interface RegisterCommandsOptions {
  chatActions?: ChatActionDescriptor[];
  onCommandResolved?: (resolution: CommandResolution) => void | Promise<void>;
  onChatActionResolved?: (resolution: CommandResolution) => void | Promise<void>;
}

function findChatAction(
  chatActions: ChatActionDescriptor[],
  actionOrId: string | ChatActionDescriptor,
): ChatActionDescriptor | null {
  if (typeof actionOrId !== 'string') return actionOrId;
  return chatActions.find((action) => {
    const commandLabel = `!${action.commandName}${action.args ? ` ${action.args}` : ''}`;
    return action.id === actionOrId || action.label === actionOrId || action.commandName === actionOrId || commandLabel === actionOrId;
  }) || null;
}

function resolveScope(scope?: string): CommandScope {
  return scope === 'project' ? 'project' : 'root';
}

export function registerCommands(
  registrar: CommandRegistrarLike,
  context: ExtensionContextLike,
  router: CommandRouter,
  options: RegisterCommandsOptions = {},
): DisposableLike[] {
  const chatActions = options.chatActions || DEFAULT_CHAT_ACTIONS;
  const disposables: DisposableLike[] = [
    registrar.registerCommand('synapse.commandRouter.listCommands', () => router.listCommandCatalog()),

    registrar.registerCommand('synapse.commandRouter.listChatActions', () => chatActions.slice()),

    registrar.registerCommand('synapse.commandRouter.getCommand', (name: string, scope?: string) => {
      return router.getCommand(name, resolveScope(scope));
    }),

    registrar.registerCommand(
      'synapse.commandRouter.resolveCommand',
      async (name: string, payload?: { scope?: string; prompt?: string; source?: string }) => {
        const resolution = router.resolveCommand(name, {
          scope: resolveScope(payload?.scope),
          prompt: payload?.prompt,
          source: payload?.source as CommandResolution['source'] | undefined,
        });
        await options.onCommandResolved?.(resolution);
        return resolution;
      },
    ),

    registrar.registerCommand(
      'synapse.commandRouter.resolveChatAction',
      async (actionOrId: string | ChatActionDescriptor, prompt = '') => {
        const action = findChatAction(chatActions, actionOrId as string | ChatActionDescriptor);
        if (!action) {
          return null;
        }
        const resolution = router.resolveChatAction(action, prompt);
        await options.onChatActionResolved?.(resolution);
        return resolution;
      },
    ),

    registrar.registerCommand('synapse.commandRouter.loadProjectContext', () => {
      return router.listCommandCatalog().projectClaudeMd;
    }),
  ];

  context.subscriptions.push(...disposables);
  return disposables;
}
