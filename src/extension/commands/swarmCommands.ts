/**
 * swarmCommands.ts — VSCode command handlers for swarm operations.
 *
 * Registers the following commands declared in package.json contributes.commands:
 *   - synapse.pTrack    — Tracked swarm (!p_track): prompts for task description, starts tracked swarm
 *   - synapse.p         — Lightweight parallel swarm (!p): prompts for task, starts untracked swarm
 *   - synapse.status    — Show current swarm status in a QuickPick summary
 *   - synapse.logs      — Show recent log entries in a QuickPick list
 *   - synapse.inspect   — Inspect a specific task by ID (user picks from active tasks)
 *   - synapse.retry     — Retry a failed task (user picks from failed tasks)
 *
 * All commands delegate to ExtensionSwarmOrchestrator — no orchestration logic lives here.
 * Follows the same registration pattern as registerCommands.ts (returns disposables, pushes to context.subscriptions).
 */

declare const require: {
  (moduleName: string): any;
};

const vscode = require('vscode');

import type { ExtensionSwarmOrchestrator, SwarmStateSummary } from '../services/ExtensionSwarmOrchestrator';
import type { ExtensionWatcherBridge } from '../services/ExtensionWatcherBridge';
import type { WorkspaceStorageService } from '../services/WorkspaceStorageService';
import type { WorkspaceProjectService } from '../services/WorkspaceProjectService';

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DisposableLike {
  dispose(): unknown;
}

export interface SwarmCommandsContext {
  subscriptions: DisposableLike[];
}

export interface SwarmCommandsDependencies {
  orchestrator: ExtensionSwarmOrchestrator;
  watcherBridge: ExtensionWatcherBridge;
  storage: WorkspaceStorageService;
  projectService: WorkspaceProjectService;
  log: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Dashboard resolution helpers
// ---------------------------------------------------------------------------

const DASHBOARD_IDS = ['dashboard1', 'dashboard2', 'dashboard3', 'dashboard4', 'dashboard5'];

/**
 * Find the first dashboard with an active swarm, or null if none.
 */
function findActiveDashboard(orchestrator: ExtensionSwarmOrchestrator): string | null {
  const states = orchestrator.getSwarmStates();
  for (const id of DASHBOARD_IDS) {
    if (states[id]) return id;
  }
  return null;
}

/**
 * Find the first available (not active) dashboard slot.
 */
function findAvailableDashboard(orchestrator: ExtensionSwarmOrchestrator): string {
  const states = orchestrator.getSwarmStates();
  for (const id of DASHBOARD_IDS) {
    if (!states[id]) return id;
  }
  // All slots full — default to dashboard1 (user will get an error from orchestrator)
  return 'dashboard1';
}

/**
 * Read initialization.json from a dashboard to get agent/task info.
 */
function readDashboardInit(storage: WorkspaceStorageService, dashboardId: string): any | null {
  const initPath = storage.getDashboardInitializationPath(dashboardId);
  if (!initPath) return null;
  try {
    return JSON.parse(fs.readFileSync(initPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Read all progress files for a dashboard.
 */
function readProgressFiles(storage: WorkspaceStorageService, dashboardId: string): Record<string, any> {
  const progressDir = storage.getDashboardProgressDir(dashboardId);
  if (!progressDir) return {};

  const result: Record<string, any> = {};
  try {
    const files = fs.readdirSync(progressDir).filter((f: string) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(progressDir, file), 'utf-8'));
        const taskId = file.replace(/\.json$/, '');
        result[taskId] = data;
      } catch {
        // skip invalid files
      }
    }
  } catch {
    // directory may not exist
  }
  return result;
}

/**
 * Read logs.json entries from a dashboard.
 */
function readLogsEntries(storage: WorkspaceStorageService, dashboardId: string): any[] {
  const logsPath = storage.getDashboardLogsPath(dashboardId);
  if (!logsPath) return [];
  try {
    const data = JSON.parse(fs.readFileSync(logsPath, 'utf-8'));
    return data.entries || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Prompt the user to grant file-write permissions to swarm agents.
 * Agents run headlessly via --print mode and cannot interactively ask,
 * so the user must approve upfront.
 *
 * Returns true if approved, false if denied.
 */
async function promptForAgentPermissions(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    'Synapse agents need permission to read and write files in your project. ' +
    'This allows planning and worker agents to analyze code and make changes. Allow?',
    { modal: true },
    'Allow',
    'Deny',
  );
  return choice === 'Allow';
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * synapse.pTrack — Start a tracked swarm with full dashboard integration.
 * Prompts the user for a task description, resolves the project root,
 * and delegates to orchestrator.planAndStartSwarm().
 */
async function handlePTrack(deps: SwarmCommandsDependencies): Promise<void> {
  const { orchestrator, watcherBridge, storage, projectService, log } = deps;

  const prompt = await vscode.window.showInputBox({
    prompt: 'Describe the task for the tracked swarm (!p_track)',
    placeHolder: 'e.g., Implement user authentication with JWT tokens',
    ignoreFocusOut: true,
  });

  if (!prompt) {
    log('synapse.pTrack cancelled — no prompt provided');
    return;
  }

  const projectPath = projectService.resolveProjectRoot();
  if (!projectPath) {
    void vscode.window.showErrorMessage('Synapse: No workspace folder open. Open a project first.');
    return;
  }

  // Prompt for permissions — agents run headlessly and need upfront approval
  const allowed = await promptForAgentPermissions();
  if (!allowed) {
    log('synapse.pTrack cancelled — permissions denied');
    void vscode.window.showInformationMessage('Synapse: Swarm cancelled — permissions not granted.');
    return;
  }

  // Ensure workspace layout exists
  storage.ensureWorkspaceLayout();

  const dashboardId = findAvailableDashboard(orchestrator);
  storage.ensureDashboardLayout(dashboardId);
  log('synapse.pTrack — using ' + dashboardId + ' for project: ' + projectPath);

  // Start watching progress for this dashboard
  watcherBridge.startWatching(dashboardId);

  void vscode.window.showInformationMessage(
    'Synapse: Planning swarm on ' + dashboardId + '...',
  );

  // Plan first (creates initialization.json), then start the swarm
  const result = await orchestrator.planAndStartSwarm(dashboardId, prompt, {
    projectPath,
    dangerouslySkipPermissions: true,
  }, log);

  if (result.success) {
    void vscode.window.showInformationMessage(
      'Synapse: Tracked swarm started on ' + dashboardId + '. Prompt: ' + prompt.substring(0, 60) + (prompt.length > 60 ? '...' : ''),
    );
    log('Tracked swarm started on ' + dashboardId);
  } else {
    void vscode.window.showErrorMessage('Synapse: Failed to start swarm — ' + (result.error || 'unknown error'));
    log('Failed to start tracked swarm: ' + (result.error || 'unknown error'));
  }
}

/**
 * synapse.p — Start a lightweight parallel swarm (no full dashboard tracking).
 * Similar to pTrack but intended for quick parallel dispatch.
 */
async function handleP(deps: SwarmCommandsDependencies): Promise<void> {
  const { orchestrator, watcherBridge, storage, projectService, log } = deps;

  const prompt = await vscode.window.showInputBox({
    prompt: 'Describe the task for the parallel swarm (!p)',
    placeHolder: 'e.g., Refactor database models and add validation',
    ignoreFocusOut: true,
  });

  if (!prompt) {
    log('synapse.p cancelled — no prompt provided');
    return;
  }

  const projectPath = projectService.resolveProjectRoot();
  if (!projectPath) {
    void vscode.window.showErrorMessage('Synapse: No workspace folder open. Open a project first.');
    return;
  }

  // Prompt for permissions — agents run headlessly and need upfront approval
  const allowed = await promptForAgentPermissions();
  if (!allowed) {
    log('synapse.p cancelled — permissions denied');
    void vscode.window.showInformationMessage('Synapse: Swarm cancelled — permissions not granted.');
    return;
  }

  // Ensure workspace layout exists
  storage.ensureWorkspaceLayout();

  const dashboardId = findAvailableDashboard(orchestrator);
  storage.ensureDashboardLayout(dashboardId);
  log('synapse.p — using ' + dashboardId + ' for project: ' + projectPath);

  // Start watching progress for this dashboard
  watcherBridge.startWatching(dashboardId);

  void vscode.window.showInformationMessage(
    'Synapse: Planning swarm on ' + dashboardId + '...',
  );

  // Plan first (creates initialization.json), then start the swarm
  const result = await orchestrator.planAndStartSwarm(dashboardId, prompt, {
    projectPath,
    dangerouslySkipPermissions: true,
  }, log);

  if (result.success) {
    void vscode.window.showInformationMessage(
      'Synapse: Parallel swarm started on ' + dashboardId,
    );
    log('Parallel swarm started on ' + dashboardId);
  } else {
    void vscode.window.showErrorMessage('Synapse: Failed to start swarm — ' + (result.error || 'unknown error'));
    log('Failed to start parallel swarm: ' + (result.error || 'unknown error'));
  }
}

/**
 * synapse.status — Show current swarm status in a QuickPick summary.
 * Displays state, dispatched/completed/failed counts for each active dashboard.
 */
async function handleStatus(deps: SwarmCommandsDependencies): Promise<void> {
  const { orchestrator, log } = deps;

  log('Command invoked: synapse.status');

  const states = orchestrator.getSwarmStates();
  const entries = Object.entries(states);

  if (entries.length === 0) {
    void vscode.window.showInformationMessage('Synapse: No active swarms.');
    return;
  }

  const items = entries.map(([dashboardId, summary]: [string, SwarmStateSummary]) => ({
    label: '$(dashboard) ' + dashboardId,
    description: summary.state.toUpperCase(),
    detail: 'Dispatched: ' + summary.dispatched +
      ' | Completed: ' + summary.completed +
      ' | Failed: ' + summary.failed,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Active swarm status — select a dashboard for details',
    canPickMany: false,
  });

  if (selected) {
    const dashboardId = selected.label.replace('$(dashboard) ', '');
    // Open the dashboard for more detail
    void vscode.commands.executeCommand('synapse.openDashboard');
  }
}

/**
 * synapse.logs — Show recent log entries in a QuickPick list.
 * Displays the last 50 log entries from the active dashboard.
 */
async function handleLogs(deps: SwarmCommandsDependencies): Promise<void> {
  const { orchestrator, storage, log } = deps;

  log('Command invoked: synapse.logs');

  const dashboardId = findActiveDashboard(orchestrator);
  if (!dashboardId) {
    void vscode.window.showInformationMessage('Synapse: No active swarm — no logs to show.');
    return;
  }

  const entries = readLogsEntries(storage, dashboardId);
  if (entries.length === 0) {
    void vscode.window.showInformationMessage('Synapse: No log entries found for ' + dashboardId + '.');
    return;
  }

  // Show the last 50 entries, most recent first
  const recentEntries = entries.slice(-50).reverse();

  const items = recentEntries.map((entry: any) => {
    const levelIcon = entry.level === 'error' ? '$(error)'
      : entry.level === 'warn' ? '$(warning)'
      : entry.level === 'deviation' ? '$(git-compare)'
      : '$(info)';

    return {
      label: levelIcon + ' ' + (entry.task_name || entry.task_id || 'system'),
      description: entry.level.toUpperCase(),
      detail: entry.message + (entry.timestamp ? ' — ' + entry.timestamp : ''),
    };
  });

  await vscode.window.showQuickPick(items, {
    placeHolder: 'Recent log entries for ' + dashboardId + ' (newest first)',
    canPickMany: false,
  });
}

/**
 * synapse.inspect — Inspect a specific task.
 * Shows a QuickPick of all tasks in the active swarm, then shows detail for the selected one.
 */
async function handleInspect(deps: SwarmCommandsDependencies): Promise<void> {
  const { orchestrator, storage, log } = deps;

  log('Command invoked: synapse.inspect');

  const dashboardId = findActiveDashboard(orchestrator);
  if (!dashboardId) {
    void vscode.window.showInformationMessage('Synapse: No active swarm to inspect.');
    return;
  }

  const initData = readDashboardInit(storage, dashboardId);
  if (!initData || !initData.agents || initData.agents.length === 0) {
    void vscode.window.showInformationMessage('Synapse: No tasks found on ' + dashboardId + '.');
    return;
  }

  const progressFiles = readProgressFiles(storage, dashboardId);

  const items = initData.agents.map((agent: any) => {
    const progress = progressFiles[agent.id];
    const status = progress ? progress.status : 'pending';
    const stage = progress ? progress.stage : null;

    const statusIcon = status === 'completed' ? '$(check)'
      : status === 'failed' ? '$(error)'
      : status === 'in_progress' ? '$(sync~spin)'
      : '$(circle-outline)';

    return {
      label: statusIcon + ' ' + agent.id + ' — ' + agent.title,
      description: status.toUpperCase() + (stage ? ' (' + stage + ')' : ''),
      detail: progress?.message || agent.description || 'No details available',
      taskId: agent.id,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a task to inspect on ' + dashboardId,
    canPickMany: false,
  });

  if (!selected) return;

  const taskId = (selected as any).taskId;
  const progress = progressFiles[taskId];

  if (!progress) {
    void vscode.window.showInformationMessage('Synapse: No progress data for task ' + taskId + '.');
    return;
  }

  // Build a detail message
  const lines: string[] = [];
  lines.push('Task ' + taskId + ': ' + (progress.assigned_agent || 'unassigned'));
  lines.push('Status: ' + progress.status);
  lines.push('Stage: ' + (progress.stage || 'N/A'));
  lines.push('Message: ' + (progress.message || 'N/A'));

  if (progress.started_at) lines.push('Started: ' + progress.started_at);
  if (progress.completed_at) lines.push('Completed: ' + progress.completed_at);
  if (progress.summary) lines.push('Summary: ' + progress.summary);

  if (progress.milestones && progress.milestones.length > 0) {
    lines.push('');
    lines.push('Milestones:');
    for (const m of progress.milestones) {
      lines.push('  - ' + m.msg + ' (' + m.at + ')');
    }
  }

  if (progress.deviations && progress.deviations.length > 0) {
    lines.push('');
    lines.push('Deviations:');
    for (const d of progress.deviations) {
      lines.push('  - [' + (d.severity || 'UNKNOWN') + '] ' + d.description);
    }
  }

  // Show in output channel for scrollable viewing
  const channel = vscode.window.createOutputChannel('Synapse: Task ' + taskId, { log: false });
  channel.clear();
  channel.appendLine(lines.join('\n'));
  channel.show(true);
}

/**
 * synapse.retry — Retry a failed task.
 * Shows a QuickPick of failed tasks on the active dashboard, then retries the selected one.
 */
async function handleRetry(deps: SwarmCommandsDependencies): Promise<void> {
  const { orchestrator, storage, log } = deps;

  log('Command invoked: synapse.retry');

  const dashboardId = findActiveDashboard(orchestrator);
  if (!dashboardId) {
    void vscode.window.showInformationMessage('Synapse: No active swarm — nothing to retry.');
    return;
  }

  const initData = readDashboardInit(storage, dashboardId);
  if (!initData || !initData.agents) {
    void vscode.window.showInformationMessage('Synapse: No tasks found on ' + dashboardId + '.');
    return;
  }

  const progressFiles = readProgressFiles(storage, dashboardId);

  // Filter for failed tasks only
  const failedItems = initData.agents
    .filter((agent: any) => {
      const progress = progressFiles[agent.id];
      return progress && progress.status === 'failed';
    })
    .map((agent: any) => {
      const progress = progressFiles[agent.id];
      return {
        label: '$(error) ' + agent.id + ' — ' + agent.title,
        description: 'FAILED',
        detail: progress?.summary || progress?.message || 'No failure details',
        taskId: agent.id,
      };
    });

  if (failedItems.length === 0) {
    void vscode.window.showInformationMessage('Synapse: No failed tasks to retry on ' + dashboardId + '.');
    return;
  }

  const selected = await vscode.window.showQuickPick(failedItems, {
    placeHolder: 'Select a failed task to retry on ' + dashboardId,
    canPickMany: false,
  });

  if (!selected) return;

  const taskId = (selected as any).taskId;
  const result = orchestrator.retryTask(dashboardId, taskId);

  if (result.success) {
    void vscode.window.showInformationMessage('Synapse: Retrying task ' + taskId + ' on ' + dashboardId + '.');
    log('Retrying task ' + taskId + ' on ' + dashboardId);
  } else {
    void vscode.window.showErrorMessage('Synapse: Failed to retry task — ' + (result.error || 'unknown error'));
    log('Failed to retry task ' + taskId + ': ' + (result.error || 'unknown error'));
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all swarm commands with the VSCode command registry.
 * Returns an array of disposables for cleanup.
 *
 * Follows the same pattern as registerCommands.ts — accepts a context
 * with subscriptions and pushes disposables into it.
 */
export function registerSwarmCommands(
  context: SwarmCommandsContext,
  deps: SwarmCommandsDependencies,
): DisposableLike[] {
  const disposables: DisposableLike[] = [
    vscode.commands.registerCommand('synapse.pTrack', () => handlePTrack(deps)),
    vscode.commands.registerCommand('synapse.p', () => handleP(deps)),
    vscode.commands.registerCommand('synapse.status', () => handleStatus(deps)),
    vscode.commands.registerCommand('synapse.logs', () => handleLogs(deps)),
    vscode.commands.registerCommand('synapse.inspect', () => handleInspect(deps)),
    vscode.commands.registerCommand('synapse.retry', () => handleRetry(deps)),
  ];

  context.subscriptions.push(...disposables);
  return disposables;
}
