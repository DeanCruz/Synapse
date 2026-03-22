/**
 * WebviewDataController.ts — Wires the WebviewBridge to dashboard data operations
 * and orchestrator/watcher event broadcasting.
 *
 * This is the extension-host equivalent of the Electron ipc-handlers.js + WatcherService.js
 * broadcast bridge. It:
 *
 *   1. Registers REQUEST handlers on the bridge so the webview can pull data on demand
 *      (getDashboardInit, getDashboardLogs, getDashboardProgress, getDashboards, etc.)
 *
 *   2. Subscribes to ExtensionWatcherBridge and ExtensionSwarmOrchestrator events and
 *      broadcasts them to the webview via bridge.postEvent() — providing live push updates.
 *
 *   3. Hydrates the webview on ready — reads current dashboard state from disk and pushes
 *      initialization + progress + logs as initial events so the UI doesn't start empty.
 *
 * Keeps WebviewBridge.ts as a clean generic transport layer (no data awareness).
 */

import * as fs from 'fs';
import * as path from 'path';

import type { WebviewBridge, WebviewRequestHandler } from './WebviewBridge';
import type { WorkspaceStorageService } from '../services/WorkspaceStorageService';
import type { ExtensionSwarmOrchestrator, ProgressData } from '../services/ExtensionSwarmOrchestrator';
import type { ExtensionWatcherBridge } from '../services/ExtensionWatcherBridge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DisposableLike {
  dispose(): void;
}

/** Default empty shapes matching src/server/utils/constants.js */
const DEFAULT_INITIALIZATION = Object.freeze({
  task: null,
  agents: [],
  waves: [],
  chains: [],
  history: [],
});

const DEFAULT_LOGS = Object.freeze({ entries: [] });

/** Polling interval for initialization.json and logs.json (matches INIT_POLL_MS in constants.js). */
const INIT_POLL_MS = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSONSync(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readJSONAsync(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WebviewDataController
// ---------------------------------------------------------------------------

export class WebviewDataController implements DisposableLike {
  private readonly bridge: WebviewBridge;
  private readonly storage: WorkspaceStorageService;
  private readonly orchestrator: ExtensionSwarmOrchestrator;
  private readonly watcher: ExtensionWatcherBridge;
  private readonly disposables: DisposableLike[] = [];
  /** fs.watchFile paths we've started polling — unwatched on dispose. */
  private readonly watchedFilePaths: string[] = [];
  private disposed = false;

  constructor(
    bridge: WebviewBridge,
    storage: WorkspaceStorageService,
    orchestrator: ExtensionSwarmOrchestrator,
    watcher: ExtensionWatcherBridge,
  ) {
    this.bridge = bridge;
    this.storage = storage;
    this.orchestrator = orchestrator;
    this.watcher = watcher;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Wire everything up. Call once after construction.
   * Registers request handlers, subscribes to events, starts file watchers, and sets up hydration.
   */
  activate(): void {
    this.registerRequestHandlers();
    this.subscribeToWatcherEvents();
    this.subscribeToOrchestratorEvents();
    this.startFileWatchers();
    this.setupHydrationOnReady();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Stop polling init/logs files
    for (const filePath of this.watchedFilePaths) {
      try { fs.unwatchFile(filePath); } catch { /* ignore */ }
    }
    this.watchedFilePaths.length = 0;

    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  // -----------------------------------------------------------------------
  // 1. REQUEST HANDLERS — webview pulls data on demand
  // -----------------------------------------------------------------------

  private registerRequestHandlers(): void {
    const handlers: Record<string, WebviewRequestHandler> = {
      getDashboards: () => this.handleGetDashboards(),
      getDashboardStatuses: () => this.handleGetDashboardStatuses(),
      getDashboardInit: (params) => this.handleGetDashboardInit(params as string),
      getDashboardLogs: (params) => this.handleGetDashboardLogs(params as string),
      getDashboardProgress: (params) => this.handleGetDashboardProgress(params as string),
      clearDashboard: (params) => this.handleClearDashboard(params as string),
      getOverview: () => this.handleGetOverview(),
      getSwarmStates: () => this.handleGetSwarmStates(),
      getHistory: () => this.handleGetHistory(),
      getArchives: () => this.handleGetArchives(),
      getArchive: (params) => this.handleGetArchive(params as string),
      getQueue: () => this.handleGetQueue(),
      getQueueItem: (params) => this.handleGetQueueItem(params as string),
      startSwarm: (params) => this.handleStartSwarm(params),
      pauseSwarm: (params) => this.handlePauseSwarm(params as string),
      resumeSwarm: (params) => this.handleResumeSwarm(params as string),
      cancelSwarm: (params) => this.handleCancelSwarm(params as string),
      retryTask: (params) => this.handleRetryTask(params),
      switchDashboard: (params) => this.handleSwitchDashboard(params as string),
    };

    this.disposables.push(this.bridge.registerRequestHandlers(handlers));
  }

  private handleGetDashboards(): { dashboards: string[] } {
    const dashboardsRoot = this.storage.getDashboardsRoot();
    if (!dashboardsRoot) return { dashboards: [] };

    try {
      const entries = fs.readdirSync(dashboardsRoot, { withFileTypes: true });
      const dashboards = entries
        .filter(e =>
          e.isDirectory() &&
          fs.existsSync(path.join(dashboardsRoot, e.name, 'initialization.json')),
        )
        .map(e => e.name)
        .sort();
      return { dashboards };
    } catch {
      return { dashboards: [] };
    }
  }

  private handleGetDashboardStatuses(): Record<string, unknown> {
    const { dashboards } = this.handleGetDashboards();
    const statuses: Record<string, unknown> = {};

    for (const id of dashboards) {
      const init = this.readDashboardInit(id);
      const progress = this.readDashboardProgress(id);
      statuses[id] = { init, progress };
    }

    return statuses;
  }

  private async handleGetDashboardInit(dashboardId: string): Promise<unknown> {
    const initPath = this.storage.getDashboardInitializationPath(dashboardId);
    if (!initPath) return { ...DEFAULT_INITIALIZATION };

    const data = await readJSONAsync(initPath);
    return data || { ...DEFAULT_INITIALIZATION };
  }

  private async handleGetDashboardLogs(dashboardId: string): Promise<unknown> {
    const logsPath = this.storage.getDashboardLogsPath(dashboardId);
    if (!logsPath) return { ...DEFAULT_LOGS };

    const data = await readJSONAsync(logsPath);
    return data || { ...DEFAULT_LOGS };
  }

  private async handleGetDashboardProgress(dashboardId: string): Promise<Record<string, unknown>> {
    const progressDir = this.storage.getDashboardProgressDir(dashboardId);
    if (!progressDir) return {};

    const result: Record<string, unknown> = {};
    try {
      const files = await fs.promises.readdir(progressDir);
      const reads = files
        .filter(f => f.endsWith('.json'))
        .map(async (file) => {
          const data = await readJSONAsync(path.join(progressDir, file)) as { task_id?: string } | null;
          if (data && data.task_id) {
            result[data.task_id] = data;
          }
        });
      await Promise.all(reads);
    } catch {
      // progress dir may not exist
    }
    return result;
  }

  private handleClearDashboard(dashboardId: string): { success: boolean } {
    // Clear progress files
    const progressDir = this.storage.getDashboardProgressDir(dashboardId);
    if (progressDir) {
      try {
        const files = fs.readdirSync(progressDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(progressDir, file));
          }
        }
      } catch { /* ignore */ }
    }

    // Reset initialization.json
    const initPath = this.storage.getDashboardInitializationPath(dashboardId);
    if (initPath) {
      try {
        fs.writeFileSync(initPath, JSON.stringify(DEFAULT_INITIALIZATION, null, 2));
      } catch { /* ignore */ }
    }

    // Reset logs.json
    const logsPath = this.storage.getDashboardLogsPath(dashboardId);
    if (logsPath) {
      try {
        fs.writeFileSync(logsPath, JSON.stringify(DEFAULT_LOGS, null, 2));
      } catch { /* ignore */ }
    }

    // Broadcast cleared state
    this.bridge.postEvent('initialization', { dashboardId, ...DEFAULT_INITIALIZATION });
    this.bridge.postEvent('logs', { dashboardId, ...DEFAULT_LOGS });
    this.bridge.postEvent('all_progress', { dashboardId });

    return { success: true };
  }

  private handleGetOverview(): unknown {
    const { dashboards } = this.handleGetDashboards();
    const dashboardSummaries = dashboards.map(id => {
      const init = this.readDashboardInit(id);
      const progress = this.readDashboardProgress(id);

      const task = init && typeof init === 'object' && 'task' in init
        ? (init as { task: unknown }).task
        : null;
      const agents = init && typeof init === 'object' && 'agents' in init
        ? (init as { agents: unknown[] }).agents || []
        : [];

      const progressValues = Object.values(progress);
      let completed = 0;
      let failed = 0;
      let inProgress = 0;
      progressValues.forEach((p: unknown) => {
        const prog = p as { status?: string };
        if (prog.status === 'completed') completed++;
        else if (prog.status === 'failed') failed++;
        else if (prog.status === 'in_progress') inProgress++;
      });

      return {
        id,
        task,
        totalAgents: Array.isArray(agents) ? agents.length : 0,
        completed,
        failed,
        inProgress,
        pending: (Array.isArray(agents) ? agents.length : 0) - completed - failed - inProgress,
      };
    });

    const archives = this.listArchives().slice(0, 10);
    const history = this.listHistory().slice(0, 10);

    return { dashboards: dashboardSummaries, archives, history, recentLogs: [] };
  }

  private handleGetSwarmStates(): Record<string, unknown> {
    return this.orchestrator.getSwarmStates();
  }

  private handleGetHistory(): unknown[] {
    return this.listHistory();
  }

  private handleGetArchives(): unknown[] {
    return this.listArchives();
  }

  private handleGetArchive(name: string): unknown {
    const archiveRoot = this.storage.resolveCollectionRoot('archive');
    if (!archiveRoot) return null;

    const archiveDir = path.join(archiveRoot, name);
    const initPath = path.join(archiveDir, 'initialization.json');
    const logsPath = path.join(archiveDir, 'logs.json');

    const init = readJSONSync(initPath);
    const logs = readJSONSync(logsPath);
    return { name, init, logs };
  }

  private handleGetQueue(): unknown[] {
    return this.listQueueSummaries();
  }

  private handleGetQueueItem(queueId: string): unknown {
    const queueRoot = this.storage.resolveCollectionRoot('queue');
    if (!queueRoot) return null;

    const queueDir = path.join(queueRoot, queueId);
    const initPath = path.join(queueDir, 'initialization.json');
    return readJSONSync(initPath);
  }

  private handleStartSwarm(params: unknown): unknown {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'Invalid params' };
    }
    const p = params as { dashboardId?: string; projectPath?: string; provider?: string; model?: string };
    if (!p.dashboardId || !p.projectPath) {
      return { success: false, error: 'dashboardId and projectPath are required' };
    }
    return this.orchestrator.startSwarm(p.dashboardId, {
      projectPath: p.projectPath,
      provider: (p.provider as 'claude' | 'codex') || undefined,
      model: p.model || undefined,
    });
  }

  private handlePauseSwarm(dashboardId: string): unknown {
    return this.orchestrator.pauseSwarm(dashboardId);
  }

  private handleResumeSwarm(dashboardId: string): unknown {
    return this.orchestrator.resumeSwarm(dashboardId);
  }

  private handleCancelSwarm(dashboardId: string): unknown {
    return this.orchestrator.cancelSwarm(dashboardId);
  }

  private handleSwitchDashboard(dashboardId: string): { success: boolean } {
    // When the webview switches dashboards, push all data for the new dashboard
    // so the UI has immediate data without waiting for the next file change
    this.broadcastDashboardInit(dashboardId);
    this.broadcastDashboardLogs(dashboardId);
    this.broadcastAllProgress(dashboardId);
    return { success: true };
  }

  private handleRetryTask(params: unknown): unknown {
    if (!params || typeof params !== 'object') {
      return { success: false, error: 'Invalid params' };
    }
    const p = params as { dashboardId?: string; taskId?: string };
    if (!p.dashboardId || !p.taskId) {
      return { success: false, error: 'dashboardId and taskId are required' };
    }
    return this.orchestrator.retryTask(p.dashboardId, p.taskId);
  }

  // -----------------------------------------------------------------------
  // 2. EVENT BROADCASTING — live push updates to webview
  // -----------------------------------------------------------------------

  /**
   * Subscribe to ExtensionWatcherBridge events.
   * When the watcher detects a progress file change, broadcast it to the webview
   * as an 'agent_progress' event (matching WatcherService.js broadcast pattern).
   */
  private subscribeToWatcherEvents(): void {
    const onProgressUpdated = (dashboardId: string, taskId: string, data: ProgressData) => {
      // Broadcast individual agent progress update
      this.bridge.postEvent('agent_progress', { dashboardId, ...data });
    };

    this.watcher.on('progress-updated', onProgressUpdated);
    this.disposables.push({
      dispose: () => this.watcher.removeListener('progress-updated', onProgressUpdated),
    });

    // Also watch for initialization.json and logs.json changes.
    // The watcher primarily watches progress/ files. For init and logs changes,
    // we poll or rely on orchestrator events below.
  }

  /**
   * Subscribe to ExtensionSwarmOrchestrator events.
   * These map to dashboard state changes that the UI needs to see in real-time.
   */
  private subscribeToOrchestratorEvents(): void {
    // On swarm started — re-broadcast initialization data + dashboard list
    const onSwarmStarted = (dashboardId: string) => {
      this.broadcastDashboardInit(dashboardId);
      this.broadcastDashboardLogs(dashboardId);
      this.broadcastDashboardList();
    };

    // On swarm completed/cancelled — broadcast final state
    const onSwarmCompleted = (dashboardId: string) => {
      this.broadcastDashboardLogs(dashboardId);
      this.broadcastAllProgress(dashboardId);
    };

    const onSwarmCancelled = (dashboardId: string) => {
      this.broadcastDashboardLogs(dashboardId);
    };

    // On task dispatched/completed/failed — broadcast updated logs
    const onTaskEvent = (dashboardId: string, _taskId: string) => {
      this.broadcastDashboardLogs(dashboardId);
    };

    this.orchestrator.on('swarm-started', onSwarmStarted);
    this.orchestrator.on('swarm-completed', onSwarmCompleted);
    this.orchestrator.on('swarm-cancelled', onSwarmCancelled);
    this.orchestrator.on('swarm-paused', onSwarmCancelled);
    this.orchestrator.on('swarm-resumed', onSwarmStarted);
    this.orchestrator.on('task-dispatched', onTaskEvent);
    this.orchestrator.on('task-completed', onTaskEvent);
    this.orchestrator.on('task-failed', onTaskEvent);

    this.disposables.push({
      dispose: () => {
        this.orchestrator.removeListener('swarm-started', onSwarmStarted);
        this.orchestrator.removeListener('swarm-completed', onSwarmCompleted);
        this.orchestrator.removeListener('swarm-cancelled', onSwarmCancelled);
        this.orchestrator.removeListener('swarm-paused', onSwarmCancelled);
        this.orchestrator.removeListener('swarm-resumed', onSwarmStarted);
        this.orchestrator.removeListener('task-dispatched', onTaskEvent);
        this.orchestrator.removeListener('task-completed', onTaskEvent);
        this.orchestrator.removeListener('task-failed', onTaskEvent);
      },
    });
  }

  // -----------------------------------------------------------------------
  // 2b. FILE WATCHERS — poll initialization.json and logs.json for changes
  // -----------------------------------------------------------------------

  /**
   * Start fs.watchFile polling on initialization.json and logs.json for each
   * dashboard directory. This mirrors WatcherService.js's polling approach
   * and catches changes made by external processes (master agent writing
   * initialization.json, orchestrator appending to logs.json).
   *
   * The ExtensionWatcherBridge handles progress/ files; this covers the rest.
   */
  private startFileWatchers(): void {
    const { dashboards } = this.handleGetDashboards();

    for (const dashboardId of dashboards) {
      this.watchDashboardFiles(dashboardId);
    }
  }

  /**
   * Set up fs.watchFile polling on a single dashboard's initialization.json and logs.json.
   */
  private watchDashboardFiles(dashboardId: string): void {
    const initPath = this.storage.getDashboardInitializationPath(dashboardId);
    const logsPath = this.storage.getDashboardLogsPath(dashboardId);

    if (initPath && fs.existsSync(initPath)) {
      fs.watchFile(initPath, { persistent: false, interval: INIT_POLL_MS }, (curr, prev) => {
        if (this.disposed || curr.mtimeMs === prev.mtimeMs) return;
        this.broadcastDashboardInit(dashboardId);
      });
      this.watchedFilePaths.push(initPath);
    }

    if (logsPath && fs.existsSync(logsPath)) {
      fs.watchFile(logsPath, { persistent: false, interval: INIT_POLL_MS }, (curr, prev) => {
        if (this.disposed || curr.mtimeMs === prev.mtimeMs) return;
        this.broadcastDashboardLogs(dashboardId);
      });
      this.watchedFilePaths.push(logsPath);
    }
  }

  // -----------------------------------------------------------------------
  // 3. HYDRATION — push current state on webview ready
  // -----------------------------------------------------------------------

  /**
   * When the webview signals ready, hydrate it with the current state
   * for all dashboards. This ensures the UI doesn't start empty and
   * doesn't need to wait for the next file change to show data.
   */
  private setupHydrationOnReady(): void {
    this.disposables.push(
      this.bridge.onReady(() => {
        this.hydrateWebview();
      }),
    );
  }

  /**
   * Read current state from disk and push everything to the webview.
   * Called on initial ready and can be called on reconnect.
   */
  hydrateWebview(): void {
    // Send dashboard list
    this.broadcastDashboardList();

    // For each dashboard, send init + logs + all progress
    const { dashboards } = this.handleGetDashboards();
    for (const dashboardId of dashboards) {
      this.broadcastDashboardInit(dashboardId);
      this.broadcastDashboardLogs(dashboardId);
      this.broadcastAllProgress(dashboardId);
    }
  }

  // -----------------------------------------------------------------------
  // Broadcast helpers
  // -----------------------------------------------------------------------

  /**
   * Broadcast the full initialization.json for a dashboard.
   * Payload: { dashboardId, ...initData }
   * Matches WatcherService.js: broadcastFn('initialization', { dashboardId: id, ...data })
   */
  private broadcastDashboardInit(dashboardId: string): void {
    const init = this.readDashboardInit(dashboardId);
    this.bridge.postEvent('initialization', {
      dashboardId,
      ...(init as object || DEFAULT_INITIALIZATION),
    });
  }

  /**
   * Broadcast the full logs.json for a dashboard.
   * Payload: { dashboardId, ...logsData }
   * Matches WatcherService.js: broadcastFn('logs', { dashboardId: id, ...data })
   */
  private broadcastDashboardLogs(dashboardId: string): void {
    const logs = this.readDashboardLogs(dashboardId);
    this.bridge.postEvent('logs', {
      dashboardId,
      ...(logs as object || DEFAULT_LOGS),
    });
  }

  /**
   * Broadcast all progress files for a dashboard as a single payload.
   * Payload: { dashboardId, [taskId]: progressData, ... }
   * Matches the 'all_progress' event channel.
   */
  private broadcastAllProgress(dashboardId: string): void {
    const progress = this.readDashboardProgress(dashboardId);
    this.bridge.postEvent('all_progress', {
      dashboardId,
      ...progress,
    });
  }

  /**
   * Broadcast the current list of dashboard IDs.
   * Payload: { dashboards: string[] }
   * Matches WatcherService.js: broadcastFn('dashboards_changed', { dashboards: [...] })
   */
  private broadcastDashboardList(): void {
    const { dashboards } = this.handleGetDashboards();
    this.bridge.postEvent('dashboards_list', { dashboards });
    this.bridge.postEvent('dashboards_changed', { dashboards });
  }

  // -----------------------------------------------------------------------
  // Data read helpers (sync — used for broadcast and request handlers)
  // -----------------------------------------------------------------------

  private readDashboardInit(dashboardId: string): unknown | null {
    const initPath = this.storage.getDashboardInitializationPath(dashboardId);
    if (!initPath) return null;
    return readJSONSync(initPath);
  }

  private readDashboardLogs(dashboardId: string): unknown | null {
    const logsPath = this.storage.getDashboardLogsPath(dashboardId);
    if (!logsPath) return null;
    return readJSONSync(logsPath);
  }

  private readDashboardProgress(dashboardId: string): Record<string, unknown> {
    const progressDir = this.storage.getDashboardProgressDir(dashboardId);
    if (!progressDir) return {};

    const result: Record<string, unknown> = {};
    try {
      if (!fs.existsSync(progressDir)) return result;
      const files = fs.readdirSync(progressDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const data = readJSONSync(path.join(progressDir, file)) as { task_id?: string } | null;
        if (data && data.task_id) {
          result[data.task_id] = data;
        }
      }
    } catch { /* ignore */ }
    return result;
  }

  private listHistory(): unknown[] {
    const historyRoot = this.storage.resolveCollectionRoot('history');
    if (!historyRoot) return [];

    try {
      if (!fs.existsSync(historyRoot)) return [];
      const files = fs.readdirSync(historyRoot)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      return files.map(f => {
        const data = readJSONSync(path.join(historyRoot, f));
        return data || { filename: f };
      });
    } catch {
      return [];
    }
  }

  private listArchives(): unknown[] {
    const archiveRoot = this.storage.resolveCollectionRoot('archive');
    if (!archiveRoot) return [];

    try {
      if (!fs.existsSync(archiveRoot)) return [];
      const entries = fs.readdirSync(archiveRoot, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => {
          const initPath = path.join(archiveRoot, e.name, 'initialization.json');
          const init = readJSONSync(initPath);
          return { name: e.name, init };
        })
        .sort((a, b) => b.name.localeCompare(a.name));
    } catch {
      return [];
    }
  }

  private listQueueSummaries(): unknown[] {
    const queueRoot = this.storage.resolveCollectionRoot('queue');
    if (!queueRoot) return [];

    try {
      if (!fs.existsSync(queueRoot)) return [];
      const entries = fs.readdirSync(queueRoot, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => {
          const initPath = path.join(queueRoot, e.name, 'initialization.json');
          const init = readJSONSync(initPath) as { task?: { name?: string } } | null;
          return {
            id: e.name,
            name: init?.task?.name || e.name,
            init,
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }
}

export default WebviewDataController;
