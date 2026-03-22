export const WEBVIEW_BRIDGE_PROTOCOL = 'synapse-webview-bridge/v1';

interface DisposableLike {
  dispose(): void;
}

interface WebviewUriLike {
  toString(): string;
}

interface WebviewLike {
  cspSource: string;
  asWebviewUri(uri: WebviewUriLike): WebviewUriLike;
  onDidReceiveMessage(listener: (message: unknown) => void): DisposableLike;
  postMessage(message: unknown): Thenable<boolean>;
}

interface WebviewProtocolMessage {
  protocol?: string;
}

export const WEBVIEW_MESSAGE_TYPES = Object.freeze({
  READY: 'synapse:bridge:ready',
  REQUEST: 'synapse:bridge:request',
  RESPONSE: 'synapse:bridge:response',
  EVENT: 'synapse:bridge:event',
  STATE: 'synapse:bridge:state',
} as const);

export const WEBVIEW_EVENT_CHANNELS = Object.freeze([
  'initialization',
  'logs',
  'agent_progress',
  'all_progress',
  'dashboards_list',
  'dashboards_changed',
  'queue_changed',
  'reload',
  'worker-output',
  'worker-complete',
  'worker-error',
] as const);

export const WEBVIEW_LEGACY_METHODS = Object.freeze([
  'getDashboards',
  'getDashboardStatuses',
  'getDashboardInit',
  'getDashboardLogs',
  'getDashboardProgress',
  'clearDashboard',
  'archiveDashboard',
  'saveDashboardHistory',
  'exportDashboard',
  'getOverview',
  'getArchives',
  'getArchive',
  'deleteArchive',
  'getHistory',
  'getQueue',
  'getQueueItem',
  'getSettings',
  'setSetting',
  'resetSettings',
  'selectProjectDirectory',
  'loadProject',
  'getRecentProjects',
  'addRecentProject',
  'getProjectContext',
  'scanProjectDirectory',
  'detectClaudeCli',
  'detectAgentCli',
  'createSwarm',
  'addTask',
  'updateTask',
  'removeTask',
  'addWave',
  'removeWave',
  'nextTaskId',
  'validateDependencies',
  'listCommands',
  'getCommand',
  'saveCommand',
  'deleteCommand',
  'loadProjectClaudeMd',
  'listProjectCommands',
  'getChatSystemPrompt',
  'logChatEvent',
  'saveTempImages',
  'spawnWorker',
  'killWorker',
  'killAllWorkers',
  'getActiveWorkers',
  'startSwarm',
  'pauseSwarm',
  'resumeSwarm',
  'cancelSwarm',
  'retryTask',
  'getSwarmStates',
  'listConversations',
  'loadConversation',
  'saveConversation',
  'createConversation',
  'deleteConversation',
  'renameConversation',
  'saveTempFile',
  'selectImageFile',
  'readFileAsBase64',
] as const);

export interface WebviewRequestMessage {
  protocol?: string;
  type: typeof WEBVIEW_MESSAGE_TYPES.REQUEST;
  requestId: string;
  method: string;
  params?: unknown;
}

export interface WebviewResponseMessage {
  protocol?: string;
  type: typeof WEBVIEW_MESSAGE_TYPES.RESPONSE;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: {
    message: string;
    name?: string;
    stack?: string;
  };
}

export interface WebviewEventMessage {
  protocol?: string;
  type: typeof WEBVIEW_MESSAGE_TYPES.EVENT;
  channel: string;
  payload?: unknown;
}

export interface WebviewStateMessage {
  protocol?: string;
  type: typeof WEBVIEW_MESSAGE_TYPES.STATE;
  state: unknown;
}

export interface WebviewReadyMessage {
  protocol?: string;
  type: typeof WEBVIEW_MESSAGE_TYPES.READY;
}

export type WebviewBridgeInboundMessage =
  | WebviewRequestMessage
  | WebviewReadyMessage
  | WebviewEventMessage
  | WebviewStateMessage
  | { type?: string; [key: string]: unknown };

export type WebviewRequestHandler = (
  params: unknown,
  context: {
    requestId: string;
    webview: WebviewLike;
    message: WebviewRequestMessage;
  }
) => unknown | Promise<unknown>;

export type WebviewReadyHandler = (message: WebviewReadyMessage) => void;

function createErrorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  return { message: 'Unknown webview bridge error' };
}

export class WebviewBridge implements DisposableLike {
  private readonly allowedEventChannels = new Set<string>(
    WEBVIEW_EVENT_CHANNELS as readonly string[]
  );

  private readonly requestHandlers = new Map<string, WebviewRequestHandler>();

  private readonly readyHandlers = new Set<WebviewReadyHandler>();

  private readonly disposables: DisposableLike[] = [];

  private disposed = false;

  constructor(private readonly webview: WebviewLike) {
    this.disposables.push(
      this.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message as WebviewBridgeInboundMessage);
      })
    );
  }

  public onReady(handler: WebviewReadyHandler): DisposableLike {
    this.readyHandlers.add(handler);
    return {
      dispose: () => {
        this.readyHandlers.delete(handler);
      },
    };
  }

  public onRequest(method: string, handler: WebviewRequestHandler): DisposableLike {
    this.requestHandlers.set(method, handler);
    return {
      dispose: () => {
        const current = this.requestHandlers.get(method);
        if (current === handler) {
          this.requestHandlers.delete(method);
        }
      },
    };
  }

  public registerRequestHandlers(
    handlers: Record<string, WebviewRequestHandler>
  ): DisposableLike {
    const disposables = Object.entries(handlers).map(([method, handler]) =>
      this.onRequest(method, handler)
    );

    return {
      dispose: () => {
        disposables.forEach((disposable) => disposable.dispose());
      },
    };
  }

  public postEvent(channel: string, payload?: unknown): Thenable<boolean> {
    if (!this.allowedEventChannels.has(channel)) {
      return Promise.resolve(false);
    }

    return this.webview.postMessage({
      protocol: WEBVIEW_BRIDGE_PROTOCOL,
      type: WEBVIEW_MESSAGE_TYPES.EVENT,
      channel,
      payload,
    } satisfies WebviewEventMessage);
  }

  public syncState(state: unknown): Thenable<boolean> {
    return this.webview.postMessage({
      protocol: WEBVIEW_BRIDGE_PROTOCOL,
      type: WEBVIEW_MESSAGE_TYPES.STATE,
      state,
    } satisfies WebviewStateMessage);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }

    this.requestHandlers.clear();
    this.readyHandlers.clear();
  }

  private async handleMessage(message: WebviewBridgeInboundMessage): Promise<void> {
    if (!message || typeof message !== 'object') return;
    if ('protocol' in message && message.protocol && message.protocol !== WEBVIEW_BRIDGE_PROTOCOL) {
      return;
    }

    switch (message.type) {
      case WEBVIEW_MESSAGE_TYPES.READY:
        this.readyHandlers.forEach((handler) =>
          handler(message as WebviewReadyMessage)
        );
        return;

      case WEBVIEW_MESSAGE_TYPES.REQUEST:
        await this.handleRequest(message as WebviewRequestMessage);
        return;

      default:
        return;
    }
  }

  private async handleRequest(message: WebviewRequestMessage): Promise<void> {
    const handler = this.requestHandlers.get(message.method);
    if (!handler) {
      await this.webview.postMessage({
        type: WEBVIEW_MESSAGE_TYPES.RESPONSE,
        requestId: message.requestId,
        ok: false,
        error: {
          message: `No handler registered for webview request method "${message.method}"`,
        },
      } satisfies WebviewResponseMessage);
      return;
    }

    try {
      const result = await handler(message.params, {
        requestId: message.requestId,
        webview: this.webview,
        message,
      });

      await this.webview.postMessage({
        protocol: WEBVIEW_BRIDGE_PROTOCOL,
        type: WEBVIEW_MESSAGE_TYPES.RESPONSE,
        requestId: message.requestId,
        ok: true,
        result,
      } satisfies WebviewResponseMessage);
    } catch (error) {
      await this.webview.postMessage({
        protocol: WEBVIEW_BRIDGE_PROTOCOL,
        type: WEBVIEW_MESSAGE_TYPES.RESPONSE,
        requestId: message.requestId,
        ok: false,
        error: createErrorPayload(error),
      } satisfies WebviewResponseMessage);
    }
  }
}

export function createWebviewBridge(webview: WebviewLike): WebviewBridge {
  return new WebviewBridge(webview);
}
