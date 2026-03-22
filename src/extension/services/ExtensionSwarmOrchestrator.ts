/**
 * ExtensionSwarmOrchestrator.ts — Swarm orchestration engine for the VSCode extension host.
 *
 * Full port of electron/services/SwarmOrchestrator.js + electron/services/PromptBuilder.js
 * adapted for the extension environment:
 *   - Uses WorkspaceStorageService for all path resolution (no hardcoded paths)
 *   - Consumes ClaudeCliService / CodexCliService via AgentRunnerService interface
 *   - Uses WorkspaceProjectService for project context (CLAUDE.md discovery)
 *   - Uses EventEmitter for broadcasting state changes to the webview layer
 *   - Typed interfaces for all swarm state, events, and options
 *
 * Preserves all original orchestration semantics:
 *   - startSwarm, pauseSwarm, resumeSwarm, cancelSwarm, retryTask
 *   - dispatchReady — dependency-driven eager dispatch
 *   - handleProgressUpdate — called by ExtensionWatcherBridge on progress file changes
 *   - onTaskComplete / onTaskFailed — completion/failure handling with log appending
 *   - Circuit breaker: 3+ failures in same wave triggers pause
 *   - isSwarmComplete — checks dispatched, completed, failed, and blocked-by-failure states
 *   - getSwarmStates / isActive — state introspection
 *
 * PromptBuilder functionality is integrated inline:
 *   - buildSystemPrompt — loads worker instructions + dispatch context
 *   - buildTaskPrompt — constructs full task prompt with project context and upstream results
 *   - readUpstreamResults — reads completed progress files for dependency data
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import type {
  AgentRunnerService,
  SpawnWorkerOptions,
  AgentProvider,
  ActiveWorkerInfo,
} from './AgentRunnerService';
import type { WorkspaceStorageService } from './WorkspaceStorageService';
import type { WorkspaceProjectService, ProjectContextEntry } from './WorkspaceProjectService';

// ---------------------------------------------------------------------------
// Embedded instructions — no file dependency, works standalone as VSIX
// ---------------------------------------------------------------------------

const WORKER_INSTRUCTIONS = `# Worker Agent — Progress Reporting Instructions

You own exactly one progress file. Write the **full file** on every update.

## Progress File Schema

\`\`\`json
{
  "task_id": "1.1",
  "status": "in_progress",
  "started_at": "ISO8601",
  "completed_at": null,
  "summary": null,
  "assigned_agent": "Agent 1",
  "stage": "implementing",
  "message": "What you are doing right now",
  "milestones": [{ "at": "ISO8601", "msg": "What was accomplished" }],
  "deviations": [{ "at": "ISO8601", "severity": "MODERATE", "description": "What changed and why" }],
  "logs": [{ "at": "ISO8601", "level": "info", "msg": "What happened" }]
}
\`\`\`

## Status Values
- \`"in_progress"\` — On your first write
- \`"completed"\` — Task done successfully
- \`"failed"\` — Task failed and cannot be recovered

## Fixed Stages (in order)
reading_context → planning → implementing → testing → finalizing → completed | failed

## Mandatory Writes
1. **Before starting work** — status: in_progress, stage: reading_context
2. **On every stage transition** — update stage, message, add log entry
3. **On any deviation from the plan** — add to deviations[] immediately
4. **On task completion** — status: completed, completed_at, summary
5. **On task failure** — status: failed, completed_at, summary with error

## Timestamps
Always capture live: \`date -u +"%Y-%m-%dT%H:%M:%SZ"\`

## Deviation Severity
- CRITICAL — Changes API/interface downstream tasks depend on
- MODERATE — Different approach, same outcome
- MINOR — Cosmetic/naming only
`;

const PLANNING_SYSTEM_PROMPT = `You are a task planner for a parallel agent swarm system. Your job is to analyze a project and decompose a task into atomic, parallelizable subtasks.

## Your Output

You MUST write a single JSON file (initialization.json) to the path provided in your dispatch context. This file defines the full execution plan.

## initialization.json Schema

\`\`\`json
{
  "_instructions": "Static plan data only.",
  "task": {
    "name": "kebab-case-name",
    "type": "Waves",
    "directory": "/path/to/project",
    "prompt": "The original user prompt",
    "project": "project-name",
    "project_root": "/path/to/project",
    "created": "ISO8601",
    "total_tasks": 0,
    "total_waves": 0
  },
  "agents": [
    {
      "id": "1.1",
      "title": "Short task title",
      "description": "Detailed description of what this task does",
      "wave": 1,
      "layer": 1,
      "directory": "/path/to/working/dir",
      "depends_on": []
    }
  ],
  "waves": [
    { "id": 1, "name": "Wave Name", "total": 0 }
  ],
  "chains": [],
  "history": []
}
\`\`\`

## Task Design Rules

1. **Task IDs** use format \`{wave}.{index}\` (e.g., 1.1, 1.2, 2.1)
2. **Each task** should be completable by a single agent in 1-5 minutes
3. **No two tasks** should modify the same file simultaneously
4. **Dependencies** (\`depends_on\`) reference task IDs — only completed tasks unblock dependents
5. **Wave 1** tasks have no dependencies. Later waves depend on earlier ones.
6. **Maximize parallelism** — independent tasks go in the same wave
7. **Right-size tasks** — reading 2-3 files and modifying 1-2 files is ideal

## Planning Process

1. Read the project structure (list directories, key files)
2. Read CLAUDE.md if present for conventions
3. Understand the codebase architecture
4. Decompose the user's task into atomic subtasks
5. Map dependencies between subtasks
6. Assign waves based on dependencies
7. Write initialization.json to the provided path

## Important
- Set total_tasks and total_waves to match the actual counts
- Each wave's total must match the number of agents in that wave
- Include clear descriptions so workers can execute independently
- Use the project_root as the directory for tasks unless a subdirectory is more appropriate
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for starting a swarm. */
export interface StartSwarmOptions {
  projectPath: string;
  provider?: AgentProvider;
  model?: string;
  cliPath?: string;
  dangerouslySkipPermissions?: boolean;
}

/** Result from startSwarm, pauseSwarm, resumeSwarm, cancelSwarm, retryTask. */
export interface SwarmResult {
  success: boolean;
  error?: string;
}

/** Internal state for an active swarm on a single dashboard. */
export interface SwarmState {
  state: 'running' | 'paused' | 'completed' | 'cancelled';
  projectPath: string;
  provider: AgentProvider;
  model: string;
  cliPath: string | null;
  dangerouslySkipPermissions: boolean;
  trackerRoot: string;
  dispatchedTasks: Record<string, boolean>;
  completedTasks: Record<string, boolean>;
  failedTasks: Record<string, boolean>;
}

/** Summary returned by getSwarmStates(). */
export interface SwarmStateSummary {
  state: string;
  dispatched: number;
  completed: number;
  failed: number;
}

/** An agent entry from initialization.json. */
export interface InitAgent {
  id: string;
  title: string;
  description?: string;
  directory?: string;
  wave?: number;
  layer?: number;
  depends_on?: string[];
}

/** The initialization.json structure (relevant fields). */
export interface InitializationData {
  task?: {
    name?: string;
    project_root?: string;
    [key: string]: unknown;
  };
  agents?: InitAgent[];
  waves?: Array<{ id: number; name: string; total: number }>;
  [key: string]: unknown;
}

/** A progress file entry. */
export interface ProgressData {
  task_id: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  summary?: string | null;
  assigned_agent?: string | null;
  stage?: string | null;
  message?: string | null;
  milestones?: Array<{ at: string; msg: string }>;
  deviations?: Array<{ at: string; severity?: string; description: string }>;
  logs?: Array<{ at: string; level: string; msg: string }>;
}

/** A log entry written to logs.json. */
export interface LogEntry {
  timestamp: string;
  task_id: string | null;
  agent: string;
  level: string;
  message: string;
  task_name: string | null;
}

/** An upstream task result used in prompt building. */
export interface UpstreamResult {
  taskId: string;
  summary: string;
  deviations: Array<{ severity?: string; description: string }>;
  files?: string[];
}

/** Events emitted by the orchestrator. */
export interface OrchestratorEvents {
  'swarm-started': (dashboardId: string) => void;
  'swarm-completed': (dashboardId: string) => void;
  'swarm-paused': (dashboardId: string) => void;
  'swarm-resumed': (dashboardId: string) => void;
  'swarm-cancelled': (dashboardId: string) => void;
  'task-dispatched': (dashboardId: string, taskId: string) => void;
  'task-completed': (dashboardId: string, taskId: string) => void;
  'task-failed': (dashboardId: string, taskId: string) => void;
  'circuit-breaker': (dashboardId: string, wave: number) => void;
}

// ---------------------------------------------------------------------------
// ExtensionSwarmOrchestrator
// ---------------------------------------------------------------------------

export class ExtensionSwarmOrchestrator extends EventEmitter {
  private activeSwarms: Record<string, SwarmState> = {};

  private readonly storage: WorkspaceStorageService;
  private readonly projectService: WorkspaceProjectService;
  private claudeService: AgentRunnerService | null = null;
  private codexService: AgentRunnerService | null = null;

  constructor(
    storage: WorkspaceStorageService,
    projectService: WorkspaceProjectService,
  ) {
    super();
    this.storage = storage;
    this.projectService = projectService;
  }

  // -----------------------------------------------------------------------
  // Initialization — wire up CLI services
  // -----------------------------------------------------------------------

  /**
   * Initialize with CLI runner services.
   * Must be called before startSwarm(). Mirrors SwarmOrchestrator.init().
   */
  init(
    claudeService: AgentRunnerService,
    codexService: AgentRunnerService,
  ): void {
    this.claudeService = claudeService;
    this.codexService = codexService;
  }

  // -----------------------------------------------------------------------
  // Swarm lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start orchestrating a swarm on a dashboard.
   * Reads initialization.json, validates the plan, and dispatches Wave 1.
   *
   * Mirrors: SwarmOrchestrator.startSwarm()
   */
  startSwarm(dashboardId: string, opts: StartSwarmOptions): SwarmResult {
    if (this.activeSwarms[dashboardId]) {
      return { success: false, error: 'Swarm already active on ' + dashboardId };
    }

    const initData = this.readDashboardInit(dashboardId);
    if (!initData || !initData.task || !initData.task.name) {
      return { success: false, error: 'No task plan found on ' + dashboardId };
    }

    if (!initData.agents || initData.agents.length === 0) {
      return { success: false, error: 'No tasks defined in the plan' };
    }

    const trackerRoot = this.storage.getSynapseRoot() || this.storage.getWorkspaceRoot() || '';

    this.activeSwarms[dashboardId] = {
      state: 'running',
      projectPath: opts.projectPath,
      provider: opts.provider || 'claude',
      model: opts.model || '',
      cliPath: opts.cliPath || null,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions || false,
      trackerRoot,
      dispatchedTasks: {},
      completedTasks: {},
      failedTasks: {},
    };

    this.appendLog(dashboardId, {
      level: 'info',
      message: 'Swarm started — dispatching Wave 1 tasks',
    });

    this.emit('swarm-started', dashboardId);

    // Dispatch all initially unblocked tasks
    this.dispatchReady(dashboardId);

    return { success: true };
  }

  /**
   * Plan and start a swarm: spawns a planning agent to create initialization.json,
   * then calls startSwarm() once the plan is written.
   *
   * This is the entry point for standalone VSIX usage where no external master
   * agent has pre-created the plan.
   */
  planAndStartSwarm(
    dashboardId: string,
    userPrompt: string,
    opts: StartSwarmOptions,
    log?: (msg: string) => void,
  ): Promise<SwarmResult> {
    const logFn = log || (() => {});

    return new Promise((resolve) => {
      // Ensure dashboard directory exists
      this.storage.ensureDashboardLayout(dashboardId);

      const initPath = this.storage.getDashboardInitializationPath(dashboardId);
      if (!initPath) {
        resolve({ success: false, error: 'Could not resolve dashboard path' });
        return;
      }

      // Clear any old progress files and reset logs
      this.clearProgressDir(dashboardId);
      this.resetLogs(dashboardId, userPrompt);

      // Build the planning prompt
      const planningUserPrompt = [
        '# Task to Plan',
        '',
        userPrompt,
        '',
        '## Output Location',
        '',
        'Write the initialization.json file to: `' + initPath + '`',
        '',
        '## Project Root',
        '',
        '`' + opts.projectPath + '`',
        '',
        'Analyze the project structure and CLAUDE.md (if present), then create the plan.',
      ].join('\n');

      // Pick the CLI service
      const service = opts.provider === 'codex' ? this.codexService : this.claudeService;

      if (!service) {
        // No CLI available — create a simple single-task plan directly
        logFn('No CLI service available — creating single-task plan');
        this.writeSimplePlan(initPath, userPrompt, opts.projectPath);
        const result = this.startSwarm(dashboardId, opts);
        resolve(result);
        return;
      }

      logFn('Spawning planning agent on ' + dashboardId + '...');

      service.spawnWorker({
        taskId: '_planner',
        dashboardId,
        projectDir: opts.projectPath,
        prompt: planningUserPrompt,
        systemPrompt: PLANNING_SYSTEM_PROMPT,
        model: opts.model || '',
        cliPath: opts.cliPath,
        // Planning agent MUST have permissions — runs headlessly with no terminal
        dangerouslySkipPermissions: true,
      });

      // Listen for the planner to complete
      const onComplete = (data: { taskId: string; dashboardId: string; exitCode: number }) => {
        if (data.taskId !== '_planner' || data.dashboardId !== dashboardId) return;
        service.removeListener('worker-complete', onComplete);
        service.removeListener('worker-error', onError);

        // Check if initialization.json was created by the agent
        let planCreated = false;
        try {
          const raw = fs.readFileSync(initPath, 'utf-8');
          const initData = JSON.parse(raw);
          if (initData && initData.task && initData.task.name) {
            planCreated = true;
          }
        } catch { /* not valid */ }

        if (!planCreated) {
          // Agent failed to create plan — fallback to simple single-task plan
          logFn('Planning agent did not create a valid plan — using single-task fallback');
          this.writeSimplePlan(initPath, userPrompt, opts.projectPath);
        } else {
          logFn('Plan created by planning agent');
        }

        const result = this.startSwarm(dashboardId, opts);
        resolve(result);
      };

      const onError = (data: { taskId: string; dashboardId: string; error: string }) => {
        if (data.taskId !== '_planner' || data.dashboardId !== dashboardId) return;
        service.removeListener('worker-complete', onComplete);
        service.removeListener('worker-error', onError);

        // CLI error — fallback to simple plan
        logFn('Planning agent error: ' + data.error + ' — using single-task fallback');
        this.writeSimplePlan(initPath, userPrompt, opts.projectPath);
        const result = this.startSwarm(dashboardId, opts);
        resolve(result);
      };

      service.on('worker-complete', onComplete);
      service.on('worker-error', onError);
    });
  }

  /**
   * Write a simple single-task plan directly. Used as a fallback when the
   * planning agent fails or when no CLI is available.
   */
  private writeSimplePlan(initPath: string, userPrompt: string, projectPath: string): void {
    const name = userPrompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join('-') || 'task';

    const plan = {
      _instructions: 'Static plan data only.',
      task: {
        name,
        type: 'Waves',
        directory: projectPath,
        prompt: userPrompt,
        project: path.basename(projectPath),
        project_root: projectPath,
        created: new Date().toISOString(),
        total_tasks: 1,
        total_waves: 1,
      },
      agents: [
        {
          id: '1.1',
          title: userPrompt.substring(0, 80),
          description: userPrompt,
          wave: 1,
          layer: 1,
          directory: projectPath,
          depends_on: [],
        },
      ],
      waves: [{ id: 1, name: 'Execution', total: 1 }],
      chains: [],
      history: [],
    };

    fs.writeFileSync(initPath, JSON.stringify(plan, null, 2));
  }

  /**
   * Clear old progress files from a dashboard's progress directory.
   */
  private clearProgressDir(dashboardId: string): void {
    const progressDir = this.storage.getDashboardProgressDir(dashboardId);
    if (!progressDir) return;
    try {
      const files = fs.readdirSync(progressDir).filter((f: string) => f.endsWith('.json'));
      for (const file of files) {
        try { fs.unlinkSync(path.join(progressDir, file)); } catch { /* ignore */ }
      }
    } catch { /* dir may not exist yet */ }
  }

  /**
   * Reset logs.json with an initial planning entry.
   */
  private resetLogs(dashboardId: string, userPrompt: string): void {
    const logsPath = this.storage.getDashboardLogsPath(dashboardId);
    if (!logsPath) return;
    fs.writeFileSync(logsPath, JSON.stringify({
      entries: [{
        timestamp: new Date().toISOString(),
        task_id: null,
        agent: 'master',
        level: 'info',
        message: 'Planning swarm for: ' + userPrompt.substring(0, 80),
        task_name: null,
      }],
    }, null, 2));
  }

  /**
   * Pause the swarm — stops dispatching new tasks but lets active workers finish.
   *
   * Mirrors: SwarmOrchestrator.pauseSwarm()
   */
  pauseSwarm(dashboardId: string): SwarmResult {
    const swarm = this.activeSwarms[dashboardId];
    if (!swarm) return { success: false, error: 'No active swarm on ' + dashboardId };

    swarm.state = 'paused';
    this.appendLog(dashboardId, { level: 'info', message: 'Swarm paused' });
    this.emit('swarm-paused', dashboardId);

    return { success: true };
  }

  /**
   * Resume a paused swarm.
   *
   * Mirrors: SwarmOrchestrator.resumeSwarm()
   */
  resumeSwarm(dashboardId: string): SwarmResult {
    const swarm = this.activeSwarms[dashboardId];
    if (!swarm) return { success: false, error: 'No active swarm on ' + dashboardId };

    swarm.state = 'running';
    this.appendLog(dashboardId, { level: 'info', message: 'Swarm resumed — dispatching ready tasks' });
    this.emit('swarm-resumed', dashboardId);
    this.dispatchReady(dashboardId);

    return { success: true };
  }

  /**
   * Cancel the swarm — kills all workers and marks as cancelled.
   *
   * Mirrors: SwarmOrchestrator.cancelSwarm()
   */
  cancelSwarm(dashboardId: string): SwarmResult {
    const swarm = this.activeSwarms[dashboardId];
    if (!swarm) return { success: false, error: 'No active swarm on ' + dashboardId };

    // Kill all workers for this dashboard across both services
    this.killDashboardWorkers(dashboardId);

    swarm.state = 'cancelled';
    this.appendLog(dashboardId, { level: 'warn', message: 'Swarm cancelled' });
    this.emit('swarm-cancelled', dashboardId);
    delete this.activeSwarms[dashboardId];

    return { success: true };
  }

  /**
   * Retry a failed task — clears failure state, deletes old progress file, re-dispatches.
   *
   * Mirrors: SwarmOrchestrator.retryTask()
   */
  retryTask(dashboardId: string, taskId: string): SwarmResult {
    const swarm = this.activeSwarms[dashboardId];
    if (!swarm) return { success: false, error: 'No active swarm on ' + dashboardId };

    if (!swarm.failedTasks[taskId]) {
      return { success: false, error: 'Task ' + taskId + ' is not in failed state' };
    }

    // Clear failed state
    delete swarm.failedTasks[taskId];

    // Delete old progress file
    const progressPath = this.storage.getDashboardProgressPath(dashboardId, taskId);
    if (progressPath) {
      try {
        fs.unlinkSync(progressPath);
      } catch {
        // ignore — file may not exist
      }
    }

    this.appendLog(dashboardId, {
      task_id: taskId,
      level: 'info',
      message: 'Retrying task: ' + taskId,
      task_name: taskId,
    });

    // Re-dispatch
    if (swarm.state !== 'running') {
      swarm.state = 'running';
    }
    this.dispatchReady(dashboardId);

    return { success: true };
  }

  // -----------------------------------------------------------------------
  // Progress handling (called by ExtensionWatcherBridge)
  // -----------------------------------------------------------------------

  /**
   * Process a progress file change — detects completion/failure and triggers dispatch.
   *
   * Mirrors: SwarmOrchestrator.handleProgressUpdate()
   */
  handleProgressUpdate(dashboardId: string, taskId: string, progressData: ProgressData): void {
    if (!this.activeSwarms[dashboardId]) return;

    if (progressData.status === 'completed') {
      this.onTaskComplete(dashboardId, taskId);
    } else if (progressData.status === 'failed') {
      this.onTaskFailed(dashboardId, taskId);
    }
  }

  // -----------------------------------------------------------------------
  // Task completion / failure
  // -----------------------------------------------------------------------

  /**
   * Called when a worker's progress file indicates completion.
   * Records completion, logs it, checks for swarm completion, dispatches next.
   *
   * Mirrors: SwarmOrchestrator.onTaskComplete()
   */
  private onTaskComplete(dashboardId: string, taskId: string): void {
    const swarm = this.activeSwarms[dashboardId];
    if (!swarm) return;

    swarm.completedTasks[taskId] = true;
    delete swarm.dispatchedTasks[taskId];

    const initData = this.readDashboardInit(dashboardId);
    const agent = this.findAgent(initData, taskId);
    const title = agent ? agent.title : taskId;

    this.appendLog(dashboardId, {
      task_id: taskId,
      level: 'info',
      message: 'Task completed: ' + title,
      task_name: title,
    });

    this.emit('task-completed', dashboardId, taskId);

    // Check if swarm is complete
    if (this.isSwarmComplete(dashboardId)) {
      swarm.state = 'completed';
      this.appendLog(dashboardId, {
        level: 'info',
        message: 'Swarm completed — all tasks finished',
      });
      this.emit('swarm-completed', dashboardId);
      delete this.activeSwarms[dashboardId];
      return;
    }

    // Dispatch newly unblocked tasks
    if (swarm.state === 'running') {
      this.dispatchReady(dashboardId);
    }
  }

  /**
   * Called when a worker's progress file indicates failure.
   * Records failure, logs it, checks circuit breaker, checks swarm completion, dispatches next.
   *
   * Mirrors: SwarmOrchestrator.onTaskFailed()
   */
  private onTaskFailed(dashboardId: string, taskId: string): void {
    const swarm = this.activeSwarms[dashboardId];
    if (!swarm) return;

    swarm.failedTasks[taskId] = true;
    delete swarm.dispatchedTasks[taskId];

    const initData = this.readDashboardInit(dashboardId);
    const agent = this.findAgent(initData, taskId);
    const title = agent ? agent.title : taskId;

    this.appendLog(dashboardId, {
      task_id: taskId,
      level: 'error',
      message: 'Task failed: ' + title,
      task_name: title,
    });

    this.emit('task-failed', dashboardId, taskId);

    // Circuit breaker: 3+ failures in same wave → pause
    let failedInWave = 0;
    if (agent && agent.wave != null) {
      for (const fid in swarm.failedTasks) {
        const fa = this.findAgent(initData, fid);
        if (fa && fa.wave === agent.wave) failedInWave++;
      }
    }
    if (failedInWave >= 3 && agent && agent.wave != null) {
      swarm.state = 'paused';
      this.appendLog(dashboardId, {
        level: 'warn',
        message: 'Circuit breaker triggered — 3+ failures in Wave ' + agent.wave + '. Swarm paused.',
      });
      this.emit('circuit-breaker', dashboardId, agent.wave);
      return;
    }

    // Check if swarm is complete (all tasks either done, failed, or blocked)
    if (this.isSwarmComplete(dashboardId)) {
      swarm.state = 'completed';
      const failCount = Object.keys(swarm.failedTasks).length;
      this.appendLog(dashboardId, {
        level: failCount > 0 ? 'warn' : 'info',
        message: 'Swarm finished — ' + failCount + ' task(s) failed',
      });
      this.emit('swarm-completed', dashboardId);
      delete this.activeSwarms[dashboardId];
      return;
    }

    // Continue dispatching unblocked tasks
    if (swarm.state === 'running') {
      this.dispatchReady(dashboardId);
    }
  }

  // -----------------------------------------------------------------------
  // Dispatch engine
  // -----------------------------------------------------------------------

  /**
   * Scan for tasks whose dependencies are all satisfied and dispatch them.
   * This is the core dispatch loop — dependency-driven, not wave-driven.
   *
   * Mirrors: SwarmOrchestrator.dispatchReady()
   */
  dispatchReady(dashboardId: string): void {
    const swarm = this.activeSwarms[dashboardId];
    if (!swarm || swarm.state !== 'running') return;

    const initData = this.readDashboardInit(dashboardId);
    if (!initData || !initData.agents) return;

    // Gather project context (CLAUDE.md files)
    let projectContexts: ProjectContextEntry[] = [];
    if (swarm.projectPath) {
      projectContexts = this.projectService.getProjectContext(swarm.projectPath);
    }

    for (const agent of initData.agents) {
      const taskId = agent.id;

      // Skip already dispatched, completed, or failed
      if (swarm.dispatchedTasks[taskId] || swarm.completedTasks[taskId] || swarm.failedTasks[taskId]) {
        continue;
      }

      // Check if all dependencies are satisfied
      const deps = agent.depends_on || [];
      let allSatisfied = true;
      for (const dep of deps) {
        if (!swarm.completedTasks[dep]) {
          allSatisfied = false;
          break;
        }
      }

      if (!allSatisfied) continue;

      // Dependencies satisfied — dispatch this task
      swarm.dispatchedTasks[taskId] = true;

      // Build upstream results from completed dependencies
      const upstreamResults = this.readUpstreamResults(dashboardId, deps, swarm.trackerRoot);

      // Build prompts
      const systemPrompt = this.buildSystemPrompt({
        taskId,
        dashboardId,
        trackerRoot: swarm.trackerRoot,
      });

      const taskPrompt = this.buildTaskPrompt({
        task: agent,
        taskDescription: agent.description || '',
        projectContexts,
        upstreamResults,
      });

      this.appendLog(dashboardId, {
        task_id: taskId,
        level: 'info',
        message: 'Dispatching: ' + agent.title,
        task_name: agent.title,
      });

      this.emit('task-dispatched', dashboardId, taskId);

      // Spawn the worker via the appropriate service
      const service = swarm.provider === 'codex' ? this.codexService : this.claudeService;
      if (service) {
        const spawnOpts: SpawnWorkerOptions = {
          taskId,
          dashboardId,
          projectDir: swarm.projectPath,
          prompt: taskPrompt,
          systemPrompt,
          model: swarm.model,
          cliPath: swarm.cliPath || undefined,
          dangerouslySkipPermissions: swarm.dangerouslySkipPermissions,
        };
        service.spawnWorker(spawnOpts);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Swarm state queries
  // -----------------------------------------------------------------------

  /**
   * Check if the swarm is complete.
   * Complete when: no dispatched tasks remain, and all tasks are either
   * completed, failed, or blocked by a failed dependency.
   *
   * Mirrors: SwarmOrchestrator.isSwarmComplete()
   */
  isSwarmComplete(dashboardId: string): boolean {
    const swarm = this.activeSwarms[dashboardId];
    if (!swarm) return true;

    // If any tasks are still dispatched (in flight), not complete
    if (Object.keys(swarm.dispatchedTasks).length > 0) return false;

    const initData = this.readDashboardInit(dashboardId);
    if (!initData || !initData.agents) return true;

    for (const agent of initData.agents) {
      const taskId = agent.id;
      if (!swarm.completedTasks[taskId] && !swarm.failedTasks[taskId]) {
        // Check if it's blocked by a failed dependency
        const deps = agent.depends_on || [];
        let blockedByFailure = false;
        for (const dep of deps) {
          if (swarm.failedTasks[dep]) {
            blockedByFailure = true;
            break;
          }
        }
        if (!blockedByFailure) return false; // Task is ready but not dispatched — not complete
      }
    }

    return true;
  }

  /**
   * Get current swarm state for all dashboards.
   *
   * Mirrors: SwarmOrchestrator.getSwarmStates()
   */
  getSwarmStates(): Record<string, SwarmStateSummary> {
    const result: Record<string, SwarmStateSummary> = {};
    for (const id in this.activeSwarms) {
      const s = this.activeSwarms[id];
      result[id] = {
        state: s.state,
        dispatched: Object.keys(s.dispatchedTasks).length,
        completed: Object.keys(s.completedTasks).length,
        failed: Object.keys(s.failedTasks).length,
      };
    }
    return result;
  }

  /**
   * Check if a dashboard has an active swarm.
   *
   * Mirrors: SwarmOrchestrator.isActive()
   */
  isActive(dashboardId: string): boolean {
    return !!this.activeSwarms[dashboardId];
  }

  /**
   * Get the internal swarm state for a dashboard (for testing/inspection).
   */
  getSwarmState(dashboardId: string): SwarmState | null {
    return this.activeSwarms[dashboardId] || null;
  }

  // -----------------------------------------------------------------------
  // PromptBuilder — inline port of electron/services/PromptBuilder.js
  // -----------------------------------------------------------------------

  /**
   * Build the system prompt for a worker agent.
   * Loads worker instructions file + adds dispatch context (paths, IDs).
   *
   * Mirrors: PromptBuilder.buildSystemPrompt()
   */
  buildSystemPrompt(opts: {
    taskId: string;
    dashboardId: string;
    trackerRoot: string;
  }): string {
    const parts: string[] = [];

    // Use embedded worker instructions — no file dependency
    parts.push(WORKER_INSTRUCTIONS);

    // Add concrete dispatch paths
    parts.push('\n---\n');
    parts.push('## Your Dispatch Context\n');
    parts.push('- **tracker_root:** `' + opts.trackerRoot + '`');
    parts.push('- **dashboardId:** `' + opts.dashboardId + '`');
    parts.push('- **task_id:** `' + opts.taskId + '`');
    parts.push(
      '- **progress_file:** `' + opts.trackerRoot +
      '/dashboards/' + opts.dashboardId +
      '/progress/' + opts.taskId + '.json`',
    );

    return parts.join('\n');
  }

  /**
   * Build the task prompt for a worker agent.
   * Constructs full prompt with task details, project context, and upstream results.
   *
   * Mirrors: PromptBuilder.buildTaskPrompt()
   */
  buildTaskPrompt(opts: {
    task: InitAgent;
    taskDescription: string;
    projectContexts: ProjectContextEntry[];
    upstreamResults: UpstreamResult[];
  }): string {
    const parts: string[] = [];

    parts.push('# Task ' + opts.task.id + ': ' + opts.task.title);
    parts.push('');

    if (opts.task.directory) {
      parts.push('**Working directory:** `' + opts.task.directory + '`');
      parts.push('');
    }

    // Task description
    if (opts.taskDescription) {
      parts.push('## Task Description');
      parts.push(opts.taskDescription);
      parts.push('');
    }

    // Project context (CLAUDE.md files)
    if (opts.projectContexts && opts.projectContexts.length > 0) {
      parts.push('## Project Context');
      for (const ctx of opts.projectContexts) {
        parts.push('### ' + path.basename(path.dirname(ctx.path)) + '/CLAUDE.md');
        parts.push('```');
        // Truncate very long CLAUDE.md to avoid context overflow
        let content = ctx.content;
        if (content.length > 8000) {
          content = content.substring(0, 8000) + '\n\n... (truncated)';
        }
        parts.push(content);
        parts.push('```');
        parts.push('');
      }
    }

    // Upstream results
    if (opts.upstreamResults && opts.upstreamResults.length > 0) {
      parts.push('## Upstream Task Results');
      parts.push('The following tasks have completed before yours. Use their results as context:');
      parts.push('');
      for (const upstream of opts.upstreamResults) {
        parts.push('### Task ' + upstream.taskId);
        parts.push('**Summary:** ' + (upstream.summary || 'No summary available'));
        if (upstream.files && upstream.files.length > 0) {
          parts.push('**Files changed:** ' + upstream.files.join(', '));
        }
        if (upstream.deviations && upstream.deviations.length > 0) {
          parts.push('**Deviations:**');
          for (const d of upstream.deviations) {
            parts.push('- [' + (d.severity || 'UNKNOWN') + '] ' + d.description);
          }
        }
        parts.push('');
      }
    }

    return parts.join('\n');
  }

  /**
   * Read upstream results from completed progress files.
   *
   * Mirrors: PromptBuilder.readUpstreamResults()
   */
  readUpstreamResults(
    dashboardId: string,
    dependsOn: string[],
    trackerRoot: string,
  ): UpstreamResult[] {
    const results: UpstreamResult[] = [];
    for (const depId of dependsOn) {
      const progressPath = this.storage.getDashboardProgressPath(dashboardId, depId);
      if (progressPath) {
        try {
          const data: ProgressData = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
          results.push({
            taskId: data.task_id,
            summary: data.summary || '(no summary)',
            deviations: data.deviations || [],
          });
        } catch {
          results.push({
            taskId: depId,
            summary: '(progress file not found)',
            deviations: [],
          });
        }
      } else {
        // Fallback: construct path manually from trackerRoot
        const fallbackPath = path.join(
          trackerRoot, 'dashboards', dashboardId, 'progress', depId + '.json',
        );
        try {
          const data: ProgressData = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
          results.push({
            taskId: data.task_id,
            summary: data.summary || '(no summary)',
            deviations: data.deviations || [],
          });
        } catch {
          results.push({
            taskId: depId,
            summary: '(progress file not found)',
            deviations: [],
          });
        }
      }
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Dashboard data helpers
  // -----------------------------------------------------------------------

  /**
   * Read and parse a dashboard's initialization.json using WorkspaceStorageService.
   */
  private readDashboardInit(dashboardId: string): InitializationData | null {
    const initPath = this.storage.getDashboardInitializationPath(dashboardId);
    if (!initPath) return null;

    try {
      const raw = fs.readFileSync(initPath, 'utf-8');
      return JSON.parse(raw) as InitializationData;
    } catch {
      return null;
    }
  }

  /**
   * Find an agent entry in initialization data by task ID.
   */
  private findAgent(initData: InitializationData | null, taskId: string): InitAgent | null {
    if (!initData || !initData.agents) return null;
    for (const agent of initData.agents) {
      if (agent.id === taskId) return agent;
    }
    return null;
  }

  /**
   * Append a log entry to the dashboard's logs.json.
   *
   * Mirrors: SwarmOrchestrator appendLog() helper.
   */
  private appendLog(
    dashboardId: string,
    entry: {
      task_id?: string;
      level?: string;
      message: string;
      task_name?: string;
      agent?: string;
    },
  ): void {
    const logsPath = this.storage.getDashboardLogsPath(dashboardId);
    if (!logsPath) return;

    let logs: { entries: LogEntry[] };
    try {
      logs = JSON.parse(fs.readFileSync(logsPath, 'utf-8'));
    } catch {
      logs = { entries: [] };
    }

    logs.entries.push({
      timestamp: new Date().toISOString(),
      task_id: entry.task_id || null,
      agent: entry.agent || 'orchestrator',
      level: entry.level || 'info',
      message: entry.message,
      task_name: entry.task_name || null,
    });

    try {
      fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2));
    } catch {
      // ignore write errors — logs are best-effort
    }
  }

  /**
   * Kill all workers belonging to a specific dashboard across both CLI services.
   */
  private killDashboardWorkers(dashboardId: string): void {
    const services = [this.claudeService, this.codexService].filter(
      (s): s is AgentRunnerService => s != null,
    );

    for (const service of services) {
      const workers: ActiveWorkerInfo[] = service.getActiveWorkers();
      for (const worker of workers) {
        if (worker.dashboardId === dashboardId) {
          service.killWorker(worker.pid);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------------

  /**
   * Dispose — cancel all active swarms and clean up.
   * Should be called when the extension deactivates.
   */
  dispose(): void {
    for (const dashboardId in this.activeSwarms) {
      this.cancelSwarm(dashboardId);
    }
    this.removeAllListeners();
  }
}

export default ExtensionSwarmOrchestrator;
