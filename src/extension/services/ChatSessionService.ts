/**
 * ChatSessionService.ts — Extension-side service that manages chat sessions,
 * connects to CLI runner output (Claude / Codex), and bridges streaming events
 * to the VSCode webview via the WebviewBridge.
 *
 * Event flow:
 *   CLI process (stdout) -> AgentRunnerService (EventEmitter)
 *     -> ChatSessionService (listener + forwarder)
 *       -> WebviewBridge.postEvent() -> webview window.addEventListener('message')
 *         -> useWebviewAPI listeners -> ClaudeView.jsx rendering
 *
 * This service owns:
 *   - Lazily-created singleton instances of ClaudeCliService / CodexCliService
 *   - Active chat session tracking (taskId -> session metadata)
 *   - WebviewBridge request handler registration for chat-related methods
 *   - Forwarding worker-output / worker-complete / worker-error events to webview
 *
 * It does NOT own the WebviewBridge lifecycle — the caller (extension.ts or a
 * webview panel manager) creates the bridge and passes it in via `attachBridge()`.
 */

import { ClaudeCliService } from './ClaudeCliService';
import { CodexCliService } from './CodexCliService';
import {
  AgentRunnerService,
  AgentProvider,
  SpawnWorkerOptions,
  SpawnResult,
  WorkerOutputEvent,
  WorkerCompleteEvent,
  WorkerErrorEvent,
  ActiveWorkerInfo,
} from './AgentRunnerService';

// ---------------------------------------------------------------------------
// Types for bridge integration
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the webview bridge — only the methods ChatSessionService
 * needs. Using an interface instead of importing the class directly keeps this
 * service loosely coupled and testable.
 */
interface ChatBridge {
  postEvent(channel: string, payload?: unknown): Thenable<boolean>;
  onRequest(method: string, handler: (params: unknown, context: unknown) => unknown | Promise<unknown>): DisposableLike;
  registerRequestHandlers(handlers: Record<string, (params: unknown, context: unknown) => unknown | Promise<unknown>>): DisposableLike;
}

interface DisposableLike {
  dispose(): void;
}

/** Tracks an active chat session in the service. */
interface ChatSession {
  taskId: string;
  dashboardId: string;
  provider: AgentProvider;
  pid: number;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

export class ChatSessionService {
  private claudeService: ClaudeCliService | null = null;
  private codexService: CodexCliService | null = null;

  /** Active chat sessions keyed by taskId. */
  private sessions = new Map<string, ChatSession>();

  /** Currently attached webview bridge (null when no webview is open). */
  private bridge: ChatBridge | null = null;

  /** Disposables for bridge request handlers — cleaned up on detach. */
  private bridgeDisposables: DisposableLike[] = [];

  /** Disposables for runner event listeners — cleaned up on dispose. */
  private runnerDisposables: DisposableLike[] = [];

  // -----------------------------------------------------------------------
  // Lazy runner initialisation
  // -----------------------------------------------------------------------

  private getRunner(provider: AgentProvider): AgentRunnerService {
    if (provider === 'codex') {
      if (!this.codexService) {
        this.codexService = new CodexCliService();
        this.attachRunnerListeners(this.codexService);
      }
      return this.codexService;
    }

    if (!this.claudeService) {
      this.claudeService = new ClaudeCliService();
      this.attachRunnerListeners(this.claudeService);
    }
    return this.claudeService;
  }

  /**
   * Wire up event forwarding from an AgentRunnerService to the active webview
   * bridge. Events are forwarded only if a bridge is attached AND the taskId
   * belongs to a tracked chat session.
   */
  private attachRunnerListeners(runner: AgentRunnerService): void {
    const onOutput = (data: WorkerOutputEvent) => {
      if (!this.sessions.has(data.taskId)) return;
      this.bridge?.postEvent('worker-output', data);
    };

    const onComplete = (data: WorkerCompleteEvent) => {
      if (!this.sessions.has(data.taskId)) return;
      this.bridge?.postEvent('worker-complete', data);
      this.sessions.delete(data.taskId);
    };

    const onError = (data: WorkerErrorEvent) => {
      if (!this.sessions.has(data.taskId)) return;
      this.bridge?.postEvent('worker-error', data);
      this.sessions.delete(data.taskId);
    };

    runner.on('worker-output', onOutput);
    runner.on('worker-complete', onComplete);
    runner.on('worker-error', onError);

    this.runnerDisposables.push({
      dispose: () => {
        runner.off('worker-output', onOutput);
        runner.off('worker-complete', onComplete);
        runner.off('worker-error', onError);
      },
    });
  }

  // -----------------------------------------------------------------------
  // Bridge lifecycle
  // -----------------------------------------------------------------------

  /**
   * Attach a webview bridge. Registers all chat-related request handlers so the
   * webview can invoke spawnWorker, killWorker, etc. through the bridge protocol.
   *
   * Call this whenever a new webview panel is created or revealed.
   * Call `detachBridge()` when the panel is disposed.
   */
  attachBridge(bridge: ChatBridge): void {
    // Detach previous bridge if one is already attached
    this.detachBridge();

    this.bridge = bridge;

    // Register request handlers the ClaudeView UI calls via api.invoke()
    const handlersDisposable = bridge.registerRequestHandlers({
      spawnWorker: (params: unknown) => this.handleSpawnWorker(params),
      killWorker: (params: unknown) => this.handleKillWorker(params),
      killAllWorkers: () => this.handleKillAllWorkers(),
      getActiveWorkers: () => this.handleGetActiveWorkers(),
    });

    this.bridgeDisposables.push(handlersDisposable);
  }

  /**
   * Detach the current webview bridge and clean up request handler registrations.
   * Does NOT kill running workers — they continue and buffer events until a new
   * bridge is attached.
   */
  detachBridge(): void {
    for (const disposable of this.bridgeDisposables) {
      disposable.dispose();
    }
    this.bridgeDisposables = [];
    this.bridge = null;
  }

  // -----------------------------------------------------------------------
  // Request handlers (called via WebviewBridge request protocol)
  // -----------------------------------------------------------------------

  /**
   * Handle a spawnWorker request from the webview.
   *
   * Params object shape matches what ClaudeView.jsx sends via api.spawnWorker():
   * {
   *   provider, taskId, dashboardId, prompt, systemPrompt?,
   *   resumeSessionId?, model?, cliPath?, dangerouslySkipPermissions?,
   *   projectDir?
   * }
   */
  private handleSpawnWorker(params: unknown): SpawnResult {
    const opts = params as Record<string, unknown>;
    const provider = (opts.provider as AgentProvider) || 'claude';

    const spawnOpts: SpawnWorkerOptions = {
      taskId: opts.taskId as string,
      dashboardId: opts.dashboardId as string,
      prompt: opts.prompt as string,
      systemPrompt: opts.systemPrompt as string | undefined,
      model: opts.model as string | undefined,
      cliPath: opts.cliPath as string | undefined,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions as boolean | undefined,
      resumeSessionId: opts.resumeSessionId as string | undefined,
      projectDir: opts.projectDir as string | undefined,
    };

    const runner = this.getRunner(provider);
    const result = runner.spawnWorker(spawnOpts);

    // Track this session so we know to forward its events
    this.sessions.set(spawnOpts.taskId, {
      taskId: spawnOpts.taskId,
      dashboardId: spawnOpts.dashboardId,
      provider,
      pid: result.pid,
      startedAt: new Date().toISOString(),
    });

    return result;
  }

  /**
   * Handle a killWorker request. Params is the PID (number).
   */
  private handleKillWorker(params: unknown): boolean {
    const pid = typeof params === 'number' ? params : Number(params);
    if (isNaN(pid)) return false;

    // Try both runners
    if (this.claudeService?.killWorker(pid)) return true;
    if (this.codexService?.killWorker(pid)) return true;
    return false;
  }

  /**
   * Handle a killAllWorkers request. Returns total killed count.
   */
  private handleKillAllWorkers(): number {
    let killed = 0;
    if (this.claudeService) killed += this.claudeService.killAllWorkers();
    if (this.codexService) killed += this.codexService.killAllWorkers();
    this.sessions.clear();
    return killed;
  }

  /**
   * Handle a getActiveWorkers request. Merges results from both runners.
   */
  private handleGetActiveWorkers(): ActiveWorkerInfo[] {
    const workers: ActiveWorkerInfo[] = [];
    if (this.claudeService) workers.push(...this.claudeService.getActiveWorkers());
    if (this.codexService) workers.push(...this.codexService.getActiveWorkers());
    return workers;
  }

  // -----------------------------------------------------------------------
  // Session queries
  // -----------------------------------------------------------------------

  /** Get all active chat sessions. */
  getActiveSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  /** Get the count of active sessions for a specific dashboard. */
  getSessionCount(dashboardId?: string): number {
    if (!dashboardId) return this.sessions.size;
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.dashboardId === dashboardId) count++;
    }
    return count;
  }

  /** Check whether a bridge is currently attached. */
  hasBridge(): boolean {
    return this.bridge !== null;
  }

  // -----------------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------------

  /**
   * Full teardown — kill all workers, detach bridge, dispose runner instances.
   * Call this on extension deactivation.
   */
  dispose(): void {
    this.detachBridge();

    // Clean up runner event listeners
    for (const disposable of this.runnerDisposables) {
      disposable.dispose();
    }
    this.runnerDisposables = [];

    // Dispose runner instances (kills all workers + removes their listeners)
    if (this.claudeService) {
      this.claudeService.dispose();
      this.claudeService = null;
    }
    if (this.codexService) {
      this.codexService.dispose();
      this.codexService = null;
    }

    this.sessions.clear();
  }
}

export default ChatSessionService;
