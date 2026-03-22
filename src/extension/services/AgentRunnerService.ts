/**
 * AgentRunnerService.ts — Abstract base for CLI agent runners in the VSCode extension host.
 *
 * Provides shared interfaces, types, EventEmitter-based event broadcasting, and worker
 * lifecycle tracking (spawn, kill, list, count). Concrete implementations (ClaudeCliService,
 * CodexCliService) extend this base and implement provider-specific argument building,
 * prompt formatting, and output parsing.
 *
 * Event semantics preserved from Electron services:
 *   - worker-output  — streaming chunk from a running worker
 *   - worker-complete — worker process exited (includes full output)
 *   - worker-error   — worker process failed to spawn or encountered a fatal error
 */

import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Provider identifier — matches Electron service naming. */
export type AgentProvider = 'claude' | 'codex';

/** Options passed to spawnWorker(). Superset used by both providers. */
export interface SpawnWorkerOptions {
  taskId: string;
  dashboardId: string;
  projectDir?: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  cliPath?: string;
  dangerouslySkipPermissions?: boolean;
  resumeSessionId?: string;
}

/** Returned by spawnWorker() on success. */
export interface SpawnResult {
  pid: number;
  taskId: string;
  dashboardId: string;
}

/** Payload emitted on the "worker-output" event. */
export interface WorkerOutputEvent {
  pid: number;
  provider: AgentProvider;
  taskId: string;
  dashboardId: string;
  chunk: string;
  parsed: Record<string, unknown> | null;
}

/** Payload emitted on the "worker-complete" event. */
export interface WorkerCompleteEvent {
  pid: number;
  provider: AgentProvider;
  taskId: string;
  dashboardId: string;
  exitCode: number;
  output: string;
  errorOutput: string;
  /** Codex-specific: contents of the -o temp file, if any. */
  lastMessage?: string | null;
}

/** Payload emitted on the "worker-error" event. */
export interface WorkerErrorEvent {
  pid: number;
  provider: AgentProvider;
  taskId: string;
  dashboardId: string;
  error: string;
}

/** Summary of an active worker (returned by getActiveWorkers). */
export interface ActiveWorkerInfo {
  pid: number;
  provider: AgentProvider;
  taskId: string;
  dashboardId: string;
  startedAt: string;
}

/** Internal worker record stored in the activeWorkers map. */
export interface WorkerRecord {
  provider: AgentProvider;
  taskId: string;
  dashboardId: string;
  process: ChildProcess;
  pid: number;
  startedAt: string;
  output: string;
  errorOutput: string;
  lineBuffer: string;
}

// ---------------------------------------------------------------------------
// Event map (for strongly-typed listeners if desired)
// ---------------------------------------------------------------------------

export interface AgentRunnerEvents {
  'worker-output': (data: WorkerOutputEvent) => void;
  'worker-complete': (data: WorkerCompleteEvent) => void;
  'worker-error': (data: WorkerErrorEvent) => void;
}

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

/**
 * Abstract base for agent CLI runners.
 *
 * Manages the activeWorkers map, provides kill/list/count operations, and
 * exposes a typed EventEmitter for worker-output / worker-complete /
 * worker-error events.  Subclasses implement `spawnWorker()` with
 * provider-specific spawn logic.
 */
export abstract class AgentRunnerService extends EventEmitter {
  protected activeWorkers: Map<number, WorkerRecord> = new Map();
  public abstract readonly provider: AgentProvider;

  constructor() {
    super();
  }

  // -----------------------------------------------------------------------
  // Abstract — each provider implements its own spawn logic
  // -----------------------------------------------------------------------

  abstract spawnWorker(opts: SpawnWorkerOptions): SpawnResult;

  // -----------------------------------------------------------------------
  // Worker lifecycle helpers (shared across providers)
  // -----------------------------------------------------------------------

  /**
   * Emit a typed event.  Thin wrapper around EventEmitter.emit for clarity.
   */
  protected broadcast<K extends keyof AgentRunnerEvents>(
    event: K,
    data: Parameters<AgentRunnerEvents[K]>[0],
  ): void {
    this.emit(event, data);
  }

  /**
   * Register a worker in the active map.
   * Called by subclass spawnWorker() implementations after spawning.
   */
  protected registerWorker(record: WorkerRecord): void {
    this.activeWorkers.set(record.pid, record);
  }

  /**
   * Remove a worker from the active map.
   * Called on process close or error.
   */
  protected unregisterWorker(pid: number): void {
    this.activeWorkers.delete(pid);
  }

  /**
   * Build a clean environment for spawned processes.
   * Removes ELECTRON_RUN_AS_NODE and CLAUDECODE to prevent child processes
   * from inheriting Electron-specific state.
   */
  protected buildCleanEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CLAUDECODE;
    return env;
  }

  /**
   * Parse a buffer of NDJSON text into complete lines, returning any
   * incomplete trailing data.  Shared by providers that stream JSON lines.
   *
   * @param buffer — accumulated text including any partial trailing line
   * @returns [completeLines, remainingBuffer]
   */
  protected splitNdjsonLines(buffer: string): [string[], string] {
    const parts = buffer.split('\n');
    const remaining = parts.pop() || '';
    const lines = parts.filter((l) => l.trim().length > 0);
    return [lines, remaining];
  }

  /**
   * Attempt to parse a string as JSON. Returns null on failure.
   */
  protected tryParseJson(text: string): Record<string, unknown> | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Worker management (direct ports from Electron services)
  // -----------------------------------------------------------------------

  /**
   * Kill a specific worker by PID.
   * Sends SIGTERM immediately, then SIGKILL after 5 seconds if still alive.
   */
  killWorker(pid: number): boolean {
    const worker = this.activeWorkers.get(pid);
    if (!worker) return false;
    try {
      worker.process.kill('SIGTERM');
      setTimeout(() => {
        try {
          worker.process.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, 5000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill all active workers. Returns the count of workers that received
   * a kill signal.
   */
  killAllWorkers(): number {
    let killed = 0;
    for (const pid of this.activeWorkers.keys()) {
      if (this.killWorker(pid)) killed++;
    }
    return killed;
  }

  /**
   * Get a snapshot of all active workers.
   */
  getActiveWorkers(): ActiveWorkerInfo[] {
    const result: ActiveWorkerInfo[] = [];
    for (const [, w] of this.activeWorkers) {
      result.push({
        pid: w.pid,
        provider: w.provider,
        taskId: w.taskId,
        dashboardId: w.dashboardId,
        startedAt: w.startedAt,
      });
    }
    return result;
  }

  /**
   * Get the count of active workers for a specific dashboard.
   */
  getActiveCountForDashboard(dashboardId: string): number {
    let count = 0;
    for (const [, w] of this.activeWorkers) {
      if (w.dashboardId === dashboardId) count++;
    }
    return count;
  }

  /**
   * Dispose — kill all workers and remove all listeners.
   * Should be called when the extension deactivates.
   */
  dispose(): void {
    this.killAllWorkers();
    this.removeAllListeners();
  }
}

export default AgentRunnerService;
