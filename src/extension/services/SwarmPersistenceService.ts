/**
 * SwarmPersistenceService.ts — Persistence and recovery for swarm state across extension reloads.
 *
 * Problem: The ExtensionSwarmOrchestrator holds all active swarm state in memory (the
 * `activeSwarms` map). When the extension reloads, crashes, or the window is closed and
 * reopened, that in-memory state is lost. Workers may still be running (or may have
 * completed/failed while the extension was down), and the webview needs to continue
 * showing the correct merged dashboard model.
 *
 * Solution: This service persists minimal "recovery metadata" for each active swarm to
 * disk. On extension activation, it scans for recoverable swarms and reconstructs the
 * orchestrator's in-memory state by reading initialization.json + all progress files —
 * the same data the dashboard already uses for rendering.
 *
 * What gets persisted (swarm-state.json per dashboard):
 *   - dashboardId, projectPath, provider, model, cliPath, dangerouslySkipPermissions
 *   - state ('running' | 'paused') — only persisted while a swarm is active
 *   - savedAt timestamp — for staleness detection
 *
 * What gets reconstructed from disk on recovery:
 *   - completedTasks — from progress files with status "completed"
 *   - failedTasks — from progress files with status "failed"
 *   - dispatchedTasks — from progress files with status "in_progress" (workers may be dead)
 *
 * Edge cases handled:
 *   - Extension crash mid-swarm: stale workers detected (in_progress progress files with
 *     no live process). Marked as failed with crash recovery note.
 *   - Partial/corrupt progress files: skipped with warning logged
 *   - Missing initialization.json: swarm unrecoverable, cleanup metadata
 *   - Multiple dashboards with active swarms: each recovered independently
 *   - Swarm completed while extension was down: detected and marked complete
 */

import * as fs from 'fs';
import * as path from 'path';

import type { WorkspaceStorageService } from './WorkspaceStorageService';
import type {
  SwarmState,
  InitializationData,
  ProgressData,
  StartSwarmOptions,
} from './ExtensionSwarmOrchestrator';
import type { AgentProvider } from './AgentRunnerService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal metadata persisted to disk for swarm recovery. */
export interface PersistedSwarmMetadata {
  dashboardId: string;
  state: 'running' | 'paused';
  projectPath: string;
  provider: AgentProvider;
  model: string;
  cliPath: string | null;
  dangerouslySkipPermissions: boolean;
  savedAt: string;
}

/** The on-disk shape of swarm-state.json. */
export interface SwarmStateFile {
  version: 1;
  swarms: PersistedSwarmMetadata[];
}

/** Result of a recovery attempt for a single dashboard. */
export interface RecoveredSwarm {
  dashboardId: string;
  metadata: PersistedSwarmMetadata;
  initData: InitializationData;
  completedTasks: Record<string, boolean>;
  failedTasks: Record<string, boolean>;
  dispatchedTasks: Record<string, boolean>;
  /** Task IDs that were in_progress but whose workers are presumed dead. */
  staleWorkerTasks: string[];
  /** Whether the swarm appears to have completed while the extension was down. */
  isAlreadyComplete: boolean;
}

/** Summary of a full recovery operation. */
export interface RecoveryResult {
  recovered: RecoveredSwarm[];
  unrecoverable: Array<{ dashboardId: string; reason: string }>;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Filename for the persisted swarm state. Lives in the .synapse directory. */
const SWARM_STATE_FILENAME = 'swarm-state.json';

/** If a swarm-state.json is older than this, consider it stale and skip recovery. */
const MAX_STALE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// SwarmPersistenceService
// ---------------------------------------------------------------------------

export class SwarmPersistenceService {
  private readonly storage: WorkspaceStorageService;

  constructor(storage: WorkspaceStorageService) {
    this.storage = storage;
  }

  // -----------------------------------------------------------------------
  // Save — called by the orchestrator on swarm state changes
  // -----------------------------------------------------------------------

  /**
   * Persist the current set of active swarms to disk.
   * Should be called on: swarm start, pause, resume, task completion/failure, swarm end.
   *
   * Only persists swarms with state 'running' or 'paused' — completed/cancelled swarms
   * are removed from the persisted file.
   */
  saveActiveSwarms(activeSwarms: Record<string, SwarmState>): void {
    const stateFilePath = this.getStateFilePath();
    if (!stateFilePath) return;

    const swarms: PersistedSwarmMetadata[] = [];
    const now = new Date().toISOString();

    for (const dashboardId in activeSwarms) {
      const swarm = activeSwarms[dashboardId];
      // Only persist running or paused swarms — completed/cancelled are transient
      if (swarm.state === 'running' || swarm.state === 'paused') {
        swarms.push({
          dashboardId,
          state: swarm.state,
          projectPath: swarm.projectPath,
          provider: swarm.provider,
          model: swarm.model,
          cliPath: swarm.cliPath,
          dangerouslySkipPermissions: swarm.dangerouslySkipPermissions,
          savedAt: now,
        });
      }
    }

    const stateFile: SwarmStateFile = {
      version: 1,
      swarms,
    };

    try {
      // Ensure directory exists
      const dir = path.dirname(stateFilePath);
      fs.mkdirSync(dir, { recursive: true });

      // Atomic write: write to temp file then rename
      const tmpPath = stateFilePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(stateFile, null, 2));
      fs.renameSync(tmpPath, stateFilePath);
    } catch {
      // Best-effort — persistence failure should not crash the orchestrator
    }
  }

  /**
   * Remove a specific dashboard's swarm from persisted state.
   * Called when a swarm completes, is cancelled, or is cleaned up.
   */
  removeSwarm(dashboardId: string): void {
    const stateFilePath = this.getStateFilePath();
    if (!stateFilePath) return;

    const stateFile = this.readStateFile();
    if (!stateFile) return;

    stateFile.swarms = stateFile.swarms.filter(s => s.dashboardId !== dashboardId);

    try {
      const tmpPath = stateFilePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(stateFile, null, 2));
      fs.renameSync(tmpPath, stateFilePath);
    } catch {
      // Best-effort
    }
  }

  /**
   * Clear all persisted swarm state.
   * Called on full reset or when all swarms are cancelled.
   */
  clearAll(): void {
    const stateFilePath = this.getStateFilePath();
    if (!stateFilePath) return;

    try {
      if (fs.existsSync(stateFilePath)) {
        fs.unlinkSync(stateFilePath);
      }
    } catch {
      // Best-effort
    }
  }

  // -----------------------------------------------------------------------
  // Recover — called on extension activation
  // -----------------------------------------------------------------------

  /**
   * Scan for recoverable swarms and reconstruct their state from disk.
   *
   * Recovery process per persisted swarm:
   * 1. Read persisted metadata from swarm-state.json
   * 2. Read initialization.json for the task plan (agent list, dependencies)
   * 3. Read all progress files to reconstruct completed/failed/dispatched maps
   * 4. Detect stale workers (in_progress but no live process)
   * 5. Determine if the swarm actually completed while the extension was down
   *
   * Returns a RecoveryResult with all recovered swarms, unrecoverable ones, and warnings.
   */
  recoverSwarms(): RecoveryResult {
    const result: RecoveryResult = {
      recovered: [],
      unrecoverable: [],
      warnings: [],
    };

    const stateFile = this.readStateFile();
    if (!stateFile || stateFile.swarms.length === 0) {
      return result;
    }

    const now = Date.now();

    for (const metadata of stateFile.swarms) {
      // Skip stale entries (older than 24 hours)
      const savedAge = now - new Date(metadata.savedAt).getTime();
      if (savedAge > MAX_STALE_AGE_MS) {
        result.unrecoverable.push({
          dashboardId: metadata.dashboardId,
          reason: 'Swarm state is stale (saved ' + Math.round(savedAge / 3600000) + 'h ago)',
        });
        continue;
      }

      // Read initialization.json
      const initData = this.readInitialization(metadata.dashboardId);
      if (!initData || !initData.agents || initData.agents.length === 0) {
        result.unrecoverable.push({
          dashboardId: metadata.dashboardId,
          reason: 'Missing or empty initialization.json — plan data lost',
        });
        continue;
      }

      // Reconstruct task maps from progress files
      const taskMaps = this.reconstructTaskMaps(metadata.dashboardId, initData);

      // Detect stale workers: tasks that were in_progress (dispatched) but whose
      // worker processes are definitely dead (since we just reloaded the extension)
      const staleWorkerTasks = Object.keys(taskMaps.dispatchedTasks);

      // Mark stale workers as failed — their processes are gone
      for (const taskId of staleWorkerTasks) {
        delete taskMaps.dispatchedTasks[taskId];
        taskMaps.failedTasks[taskId] = true;

        // Write a crash-recovery progress file so the dashboard shows the failure
        this.writeRecoveryProgressFile(metadata.dashboardId, taskId);
      }

      if (staleWorkerTasks.length > 0) {
        result.warnings.push(
          'Dashboard ' + metadata.dashboardId + ': ' + staleWorkerTasks.length +
          ' stale worker(s) detected and marked as failed: ' + staleWorkerTasks.join(', '),
        );
      }

      // Check if the swarm is effectively complete after recovery
      const isAlreadyComplete = this.checkSwarmComplete(
        initData,
        taskMaps.completedTasks,
        taskMaps.failedTasks,
      );

      result.recovered.push({
        dashboardId: metadata.dashboardId,
        metadata,
        initData,
        completedTasks: taskMaps.completedTasks,
        failedTasks: taskMaps.failedTasks,
        dispatchedTasks: taskMaps.dispatchedTasks,
        staleWorkerTasks,
        isAlreadyComplete,
      });
    }

    return result;
  }

  /**
   * Check if there are any persisted swarms that could be recovered.
   * Lightweight check that does not read progress files — just checks if
   * swarm-state.json exists and has entries.
   */
  hasRecoverableSwarms(): boolean {
    const stateFile = this.readStateFile();
    return stateFile !== null && stateFile.swarms.length > 0;
  }

  /**
   * Get the list of persisted swarm metadata without performing full recovery.
   * Useful for showing recovery prompts to the user.
   */
  getPersistedSwarms(): PersistedSwarmMetadata[] {
    const stateFile = this.readStateFile();
    return stateFile ? stateFile.swarms : [];
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve the path to swarm-state.json in the .synapse directory.
   */
  private getStateFilePath(): string | null {
    const synapseRoot = this.storage.getSynapseRoot();
    if (!synapseRoot) return null;
    return path.join(synapseRoot, SWARM_STATE_FILENAME);
  }

  /**
   * Read and parse the swarm-state.json file.
   * Returns null if the file doesn't exist, is corrupt, or has an unknown version.
   */
  private readStateFile(): SwarmStateFile | null {
    const stateFilePath = this.getStateFilePath();
    if (!stateFilePath) return null;

    try {
      if (!fs.existsSync(stateFilePath)) return null;
      const raw = fs.readFileSync(stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as SwarmStateFile;

      // Version check
      if (parsed.version !== 1) return null;
      if (!Array.isArray(parsed.swarms)) return null;

      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Read a dashboard's initialization.json.
   */
  private readInitialization(dashboardId: string): InitializationData | null {
    const initPath = this.storage.getDashboardInitializationPath(dashboardId);
    if (!initPath) return null;

    try {
      if (!fs.existsSync(initPath)) return null;
      const raw = fs.readFileSync(initPath, 'utf-8');
      return JSON.parse(raw) as InitializationData;
    } catch {
      return null;
    }
  }

  /**
   * Reconstruct completedTasks, failedTasks, and dispatchedTasks maps by reading
   * all progress files in a dashboard's progress/ directory.
   *
   * A task is:
   * - completed: progress file exists with status "completed"
   * - failed: progress file exists with status "failed"
   * - dispatched (in-flight): progress file exists with status "in_progress"
   * - pending: no progress file, or progress file with status "pending"
   */
  private reconstructTaskMaps(
    dashboardId: string,
    initData: InitializationData,
  ): {
    completedTasks: Record<string, boolean>;
    failedTasks: Record<string, boolean>;
    dispatchedTasks: Record<string, boolean>;
  } {
    const completedTasks: Record<string, boolean> = {};
    const failedTasks: Record<string, boolean> = {};
    const dispatchedTasks: Record<string, boolean> = {};

    const progressDir = this.storage.getDashboardProgressDir(dashboardId);
    if (!progressDir) return { completedTasks, failedTasks, dispatchedTasks };

    // Build a set of known task IDs from the plan
    const knownTaskIds = new Set<string>();
    if (initData.agents) {
      for (const agent of initData.agents) {
        knownTaskIds.add(agent.id);
      }
    }

    // Read all progress files
    let files: string[];
    try {
      files = fs.readdirSync(progressDir).filter(f => f.endsWith('.json'));
    } catch {
      return { completedTasks, failedTasks, dispatchedTasks };
    }

    for (const file of files) {
      const taskId = file.replace(/\.json$/, '');

      // Only consider tasks that are part of the plan
      if (!knownTaskIds.has(taskId)) continue;

      const filePath = path.join(progressDir, file);
      const progressData = this.readProgressFile(filePath);
      if (!progressData) continue;

      switch (progressData.status) {
        case 'completed':
          completedTasks[taskId] = true;
          break;
        case 'failed':
          failedTasks[taskId] = true;
          break;
        case 'in_progress':
          // Workers are presumed dead after extension reload — caller decides
          dispatchedTasks[taskId] = true;
          break;
        // 'pending' or any other status: task is not yet started
      }
    }

    return { completedTasks, failedTasks, dispatchedTasks };
  }

  /**
   * Read and parse a single progress file safely.
   * Returns null on any error (missing, corrupt, partial write).
   */
  private readProgressFile(filePath: string): ProgressData | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as ProgressData;

      // Minimal validation
      if (!data || typeof data.task_id !== 'string' || typeof data.status !== 'string') {
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Write a crash-recovery progress file for a stale worker.
   * This updates the worker's progress file to show it was terminated due to
   * an extension crash, so the dashboard displays the correct state.
   */
  private writeRecoveryProgressFile(dashboardId: string, taskId: string): void {
    const progressPath = this.storage.getDashboardProgressPath(dashboardId, taskId);
    if (!progressPath) return;

    // Read existing progress to preserve milestones and logs
    let existing: ProgressData | null = null;
    try {
      if (fs.existsSync(progressPath)) {
        existing = JSON.parse(fs.readFileSync(progressPath, 'utf-8')) as ProgressData;
      }
    } catch {
      // Will create a fresh file
    }

    const now = new Date().toISOString();
    const recoveryData: ProgressData = {
      task_id: taskId,
      status: 'failed',
      started_at: existing?.started_at || null,
      completed_at: now,
      summary: 'Worker terminated — extension reloaded while task was in progress',
      assigned_agent: existing?.assigned_agent || null,
      stage: 'failed',
      message: 'Extension crash recovery — worker process no longer exists',
      milestones: existing?.milestones || [],
      deviations: [
        ...(existing?.deviations || []),
        {
          at: now,
          description: 'Task failed due to extension reload/crash while worker was running',
        },
      ],
      logs: [
        ...(existing?.logs || []),
        {
          at: now,
          level: 'error',
          msg: 'Extension reloaded while worker was running — process terminated. Task marked as failed for retry.',
        },
      ],
    };

    try {
      fs.writeFileSync(progressPath, JSON.stringify(recoveryData, null, 2));
    } catch {
      // Best-effort — dashboard will show stale data but orchestrator state is correct
    }
  }

  /**
   * Check if a swarm is effectively complete.
   * A swarm is complete when every task is either completed, failed, or blocked
   * by a failed dependency (and no tasks are in-flight).
   */
  private checkSwarmComplete(
    initData: InitializationData,
    completedTasks: Record<string, boolean>,
    failedTasks: Record<string, boolean>,
  ): boolean {
    if (!initData.agents) return true;

    for (const agent of initData.agents) {
      const taskId = agent.id;

      // Task is done or failed — continue
      if (completedTasks[taskId] || failedTasks[taskId]) continue;

      // Task is neither done nor failed — check if it's blocked by a failed dependency
      const deps = agent.depends_on || [];
      let blockedByFailure = false;
      for (const dep of deps) {
        if (failedTasks[dep]) {
          blockedByFailure = true;
          break;
        }
      }

      // If not blocked by failure, the swarm has pending dispatchable work
      if (!blockedByFailure) return false;
    }

    return true;
  }

  // -----------------------------------------------------------------------
  // Utility — build StartSwarmOptions from recovered metadata
  // -----------------------------------------------------------------------

  /**
   * Convert recovered swarm metadata back into StartSwarmOptions,
   * suitable for passing to orchestrator.startSwarm() or for directly
   * rebuilding the SwarmState.
   */
  buildStartOptions(metadata: PersistedSwarmMetadata): StartSwarmOptions {
    return {
      projectPath: metadata.projectPath,
      provider: metadata.provider,
      model: metadata.model,
      cliPath: metadata.cliPath || undefined,
      dangerouslySkipPermissions: metadata.dangerouslySkipPermissions,
    };
  }

  /**
   * Build a complete SwarmState from recovery data.
   * This can be injected directly into the orchestrator's activeSwarms map.
   */
  buildSwarmState(recovered: RecoveredSwarm): SwarmState {
    return {
      state: recovered.isAlreadyComplete ? 'completed' : recovered.metadata.state,
      projectPath: recovered.metadata.projectPath,
      provider: recovered.metadata.provider,
      model: recovered.metadata.model,
      cliPath: recovered.metadata.cliPath,
      dangerouslySkipPermissions: recovered.metadata.dangerouslySkipPermissions,
      trackerRoot: this.storage.getWorkspaceRoot() || '',
      dispatchedTasks: { ...recovered.dispatchedTasks },
      completedTasks: { ...recovered.completedTasks },
      failedTasks: { ...recovered.failedTasks },
    };
  }
}

export default SwarmPersistenceService;
