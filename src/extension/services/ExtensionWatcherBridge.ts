/**
 * ExtensionWatcherBridge.ts — File watcher for progress directory in the VSCode extension host.
 *
 * Watches the progress/ directory for a given dashboard and calls the orchestrator's
 * handleProgressUpdate() when progress files are created or modified.
 *
 * Adapts patterns from src/server/services/WatcherService.js:
 *   - fs.watch on progress/ directory for file change events
 *   - Debounced reads with retry for incomplete JSON writes
 *   - Validation of progress file schema before forwarding
 *   - Start/stop lifecycle with disposable pattern for extension cleanup
 *
 * Also supports vscode.workspace.createFileSystemWatcher as an alternative backend
 * when the workspace is available — falls back to fs.watch otherwise.
 *
 * Key integration:
 *   - On valid progress file change → calls orchestrator.handleProgressUpdate()
 *   - The orchestrator then handles completion/failure dispatch logic
 *   - The watcher does NOT modify any files — it is read-only
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import type { WorkspaceStorageService } from './WorkspaceStorageService';
import type { ExtensionSwarmOrchestrator, ProgressData } from './ExtensionSwarmOrchestrator';

// ---------------------------------------------------------------------------
// Constants (matching WatcherService.js patterns)
// ---------------------------------------------------------------------------

/** Delay before first read attempt after a file change event (ms). */
const PROGRESS_READ_DELAY_MS = 50;

/** Retry delay if JSON parse fails on first attempt (ms). */
const PROGRESS_RETRY_MS = 150;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatcherBridgeEvents {
  'progress-updated': (dashboardId: string, taskId: string, data: ProgressData) => void;
  'watcher-error': (dashboardId: string, error: string) => void;
  'watcher-started': (dashboardId: string) => void;
  'watcher-stopped': (dashboardId: string) => void;
}

/** Internal record for an active watcher. */
interface WatcherRecord {
  dashboardId: string;
  progressDir: string;
  fsWatcher: fs.FSWatcher | null;
  vscodeWatcher: { dispose(): void } | null;
}

// ---------------------------------------------------------------------------
// ExtensionWatcherBridge
// ---------------------------------------------------------------------------

export class ExtensionWatcherBridge extends EventEmitter {
  private readonly storage: WorkspaceStorageService;
  private readonly orchestrator: ExtensionSwarmOrchestrator;
  private readonly activeWatchers: Map<string, WatcherRecord> = new Map();

  constructor(
    storage: WorkspaceStorageService,
    orchestrator: ExtensionSwarmOrchestrator,
  ) {
    super();
    this.storage = storage;
    this.orchestrator = orchestrator;
  }

  // -----------------------------------------------------------------------
  // Start / stop watching a dashboard's progress directory
  // -----------------------------------------------------------------------

  /**
   * Start watching a dashboard's progress directory for file changes.
   * Detects completion/failure from progress files and forwards to orchestrator.
   *
   * Uses fs.watch (Node native) as the primary mechanism.
   * Can optionally use vscode.workspace.createFileSystemWatcher if vscode is available.
   */
  startWatching(dashboardId: string): boolean {
    if (this.activeWatchers.has(dashboardId)) {
      return true; // Already watching
    }

    const progressDir = this.storage.getDashboardProgressDir(dashboardId);
    if (!progressDir) {
      this.emit('watcher-error', dashboardId, 'Could not resolve progress directory');
      return false;
    }

    // Ensure the progress directory exists
    try {
      fs.mkdirSync(progressDir, { recursive: true });
    } catch {
      // May already exist
    }

    const record: WatcherRecord = {
      dashboardId,
      progressDir,
      fsWatcher: null,
      vscodeWatcher: null,
    };

    // Try vscode.workspace.createFileSystemWatcher first
    const vscodeWatcher = this.tryCreateVscodeWatcher(dashboardId, progressDir);
    if (vscodeWatcher) {
      record.vscodeWatcher = vscodeWatcher;
    } else {
      // Fall back to fs.watch
      try {
        record.fsWatcher = this.createFsWatcher(dashboardId, progressDir);
      } catch (err) {
        this.emit(
          'watcher-error',
          dashboardId,
          'Failed to start fs.watch on ' + progressDir + ': ' + String(err),
        );
        return false;
      }
    }

    this.activeWatchers.set(dashboardId, record);
    this.emit('watcher-started', dashboardId);
    return true;
  }

  /**
   * Stop watching a dashboard's progress directory.
   */
  stopWatching(dashboardId: string): void {
    const record = this.activeWatchers.get(dashboardId);
    if (!record) return;

    if (record.fsWatcher) {
      record.fsWatcher.close();
      record.fsWatcher = null;
    }

    if (record.vscodeWatcher) {
      record.vscodeWatcher.dispose();
      record.vscodeWatcher = null;
    }

    this.activeWatchers.delete(dashboardId);
    this.emit('watcher-stopped', dashboardId);
  }

  /**
   * Check if a dashboard is being watched.
   */
  isWatching(dashboardId: string): boolean {
    return this.activeWatchers.has(dashboardId);
  }

  /**
   * Get all actively watched dashboard IDs.
   */
  getWatchedDashboards(): string[] {
    return Array.from(this.activeWatchers.keys());
  }

  // -----------------------------------------------------------------------
  // fs.watch backend
  // -----------------------------------------------------------------------

  /**
   * Create an fs.watch watcher on the progress directory.
   * Fires on .json file changes, debounces reads, retries on parse failure.
   *
   * Mirrors: WatcherService.js progress directory watching pattern.
   */
  private createFsWatcher(dashboardId: string, progressDir: string): fs.FSWatcher {
    return fs.watch(progressDir, (_eventType: string, filename: string | null) => {
      if (!filename || !filename.endsWith('.json')) return;

      const filePath = path.join(progressDir, filename);

      // Debounce: wait a short delay for the file write to complete
      setTimeout(() => {
        this.readAndForwardProgress(dashboardId, filePath, filename);
      }, PROGRESS_READ_DELAY_MS);
    });
  }

  // -----------------------------------------------------------------------
  // vscode watcher backend (optional)
  // -----------------------------------------------------------------------

  /**
   * Try to create a vscode.workspace.createFileSystemWatcher.
   * Returns a disposable if vscode API is available, null otherwise.
   */
  private tryCreateVscodeWatcher(
    dashboardId: string,
    progressDir: string,
  ): { dispose(): void } | null {
    try {
      const vscode = require('vscode');
      if (!vscode.workspace || !vscode.workspace.createFileSystemWatcher) {
        return null;
      }

      // Watch for JSON files in the progress directory
      const pattern = new vscode.RelativePattern(progressDir, '*.json');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      // Handle file creation and changes
      const onChangeDisposable = watcher.onDidChange((uri: { fsPath: string }) => {
        const filename = path.basename(uri.fsPath);
        setTimeout(() => {
          this.readAndForwardProgress(dashboardId, uri.fsPath, filename);
        }, PROGRESS_READ_DELAY_MS);
      });

      const onCreateDisposable = watcher.onDidCreate((uri: { fsPath: string }) => {
        const filename = path.basename(uri.fsPath);
        setTimeout(() => {
          this.readAndForwardProgress(dashboardId, uri.fsPath, filename);
        }, PROGRESS_READ_DELAY_MS);
      });

      // Return a composite disposable
      return {
        dispose(): void {
          onChangeDisposable.dispose();
          onCreateDisposable.dispose();
          watcher.dispose();
        },
      };
    } catch {
      // vscode not available — return null to fall back to fs.watch
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Shared read + forward logic
  // -----------------------------------------------------------------------

  /**
   * Read a progress file and forward it to the orchestrator.
   * Retries once on JSON parse failure (the file may still be mid-write).
   */
  private readAndForwardProgress(
    dashboardId: string,
    filePath: string,
    filename: string,
  ): void {
    // Extract task ID from filename (e.g., "2.1.json" → "2.1")
    const taskId = filename.replace(/\.json$/, '');

    const tryRead = (): ProgressData | null => {
      try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as ProgressData;
        return this.isValidProgress(data) ? data : null;
      } catch {
        return null;
      }
    };

    // First attempt
    const data = tryRead();
    if (data) {
      this.emit('progress-updated', dashboardId, taskId, data);
      this.orchestrator.handleProgressUpdate(dashboardId, taskId, data);
      return;
    }

    // Retry after a delay — file may have been mid-write
    setTimeout(() => {
      const retryData = tryRead();
      if (retryData) {
        this.emit('progress-updated', dashboardId, taskId, retryData);
        this.orchestrator.handleProgressUpdate(dashboardId, taskId, retryData);
      }
      // If retry also fails, silently drop — next file change will try again
    }, PROGRESS_RETRY_MS);
  }

  /**
   * Validate a progress file has the required fields.
   * Mirrors: src/server/utils/json.js → isValidProgress()
   */
  private isValidProgress(data: unknown): data is ProgressData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.task_id === 'string' &&
      typeof obj.status === 'string'
    );
  }

  // -----------------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------------

  /**
   * Stop all active watchers and clean up.
   * Should be called when the extension deactivates.
   */
  dispose(): void {
    for (const dashboardId of this.activeWatchers.keys()) {
      this.stopWatching(dashboardId);
    }
    this.removeAllListeners();
  }
}

export default ExtensionWatcherBridge;
