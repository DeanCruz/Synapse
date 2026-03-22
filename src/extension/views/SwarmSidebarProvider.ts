/**
 * SwarmSidebarProvider.ts — Native VSCode sidebar view for Synapse swarm control.
 *
 * Implements WebviewViewProvider to render a sidebar panel in the activity bar.
 * The sidebar displays active swarms with status indicators, quick action buttons
 * (dispatch, cancel, pause/resume, retry), and dashboard switching — all synchronized
 * with the extension host's ExtensionSwarmOrchestrator.
 *
 * The orchestrator is the single source of truth for swarm state. This provider
 * subscribes to orchestrator events and re-renders when state changes.
 *
 * Communication flow:
 *   Orchestrator events → SwarmSidebarProvider.refresh() → webview HTML update
 *   Webview postMessage → SwarmSidebarProvider.onMessage() → orchestrator/command dispatch
 */

declare const require: {
  (moduleName: string): any;
};

const vscode = require('vscode');

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import type { ExtensionSwarmOrchestrator, SwarmStateSummary, InitializationData } from '../services/ExtensionSwarmOrchestrator';
import type { WorkspaceStorageService } from '../services/WorkspaceStorageService';
import { generateSidebarHtml, SidebarDashboardEntry, SidebarRenderData } from './sidebar.html';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The view ID that must match package.json contributes.views entry. */
export const SIDEBAR_VIEW_ID = 'synapse.swarmSidebar';

/** The dashboard IDs scanned for swarm state. */
const DASHBOARD_IDS = ['dashboard1', 'dashboard2', 'dashboard3', 'dashboard4', 'dashboard5'];

/** Default labels when no project/task name is available. */
const DASHBOARD_LABELS: Record<string, string> = {
  dashboard1: 'Dashboard 1',
  dashboard2: 'Dashboard 2',
  dashboard3: 'Dashboard 3',
  dashboard4: 'Dashboard 4',
  dashboard5: 'Dashboard 5',
};

// ---------------------------------------------------------------------------
// SwarmSidebarProvider
// ---------------------------------------------------------------------------

export class SwarmSidebarProvider {
  public static readonly viewType = SIDEBAR_VIEW_ID;

  private view: any = null;
  private activeDashboardId: string | null = null;
  private readonly orchestrator: ExtensionSwarmOrchestrator;
  private readonly storage: WorkspaceStorageService;
  private readonly log: (msg: string) => void;
  private readonly disposables: Array<{ dispose(): unknown }> = [];

  constructor(
    orchestrator: ExtensionSwarmOrchestrator,
    storage: WorkspaceStorageService,
    log: (msg: string) => void,
  ) {
    this.orchestrator = orchestrator;
    this.storage = storage;
    this.log = log;

    // Subscribe to orchestrator events for live updates
    this.bindOrchestratorEvents();
  }

  // -----------------------------------------------------------------------
  // WebviewViewProvider interface
  // -----------------------------------------------------------------------

  /**
   * Called by VSCode when the sidebar view becomes visible.
   * Receives the WebviewView instance to populate with HTML content.
   */
  resolveWebviewView(
    webviewView: any,
    _context: any,
    _token: any,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (message: any) => this.onMessage(message),
      undefined,
      this.disposables,
    );

    // Re-render when the view becomes visible again
    webviewView.onDidChangeVisibility(
      () => {
        if (webviewView.visible) {
          this.refresh();
        }
      },
      undefined,
      this.disposables,
    );

    // Initial render
    this.refresh();
    this.log('Sidebar view resolved and rendered.');
  }

  // -----------------------------------------------------------------------
  // Refresh / render
  // -----------------------------------------------------------------------

  /**
   * Re-render the sidebar HTML with current swarm state from the orchestrator.
   * Called on orchestrator events and when the view becomes visible.
   */
  refresh(): void {
    if (!this.view) return;

    const data = this.buildRenderData();
    const html = generateSidebarHtml(data);
    this.view.webview.html = html;
  }

  /**
   * Build the render data from orchestrator state and dashboard initialization files.
   * Includes per-task status indicators for enriched sidebar cards.
   */
  private buildRenderData(): SidebarRenderData {
    const nonce = crypto.randomBytes(16).toString('hex');
    const swarmStates = this.orchestrator.getSwarmStates();
    const dashboards: SidebarDashboardEntry[] = [];

    for (const id of DASHBOARD_IDS) {
      const summary: SwarmStateSummary | undefined = swarmStates[id];
      const initData = this.readDashboardInit(id);

      let total = 0;
      let taskName: string | null = null;
      let projectName: string | null = null;
      let inProgress = 0;
      let pending = 0;
      let deviationCount = 0;

      if (initData) {
        total = (initData.agents && initData.agents.length) || 0;
        taskName = (initData.task && initData.task.name) || null;

        // Extract project display name from project_root
        if (initData.task && initData.task.project_root) {
          const projRoot = initData.task.project_root as string;
          const parts = projRoot.replace(/\/+$/, '').split('/');
          projectName = parts[parts.length - 1] || null;
        }
      }

      // Read progress files for per-task status indicators
      const progressData = this.readDashboardProgressSummary(id);
      if (progressData) {
        inProgress = progressData.inProgress;
        pending = progressData.pending;
        deviationCount = progressData.deviationCount;
      }

      if (summary) {
        dashboards.push({
          id,
          label: DASHBOARD_LABELS[id] || id,
          state: summary.state as SidebarDashboardEntry['state'],
          dispatched: summary.dispatched,
          completed: summary.completed,
          failed: summary.failed,
          total,
          taskName,
          projectName,
          inProgress,
          pending,
          deviationCount,
        });
      } else {
        // Include all dashboards (even idle) so the user can switch to them
        dashboards.push({
          id,
          label: DASHBOARD_LABELS[id] || id,
          state: 'idle',
          dispatched: 0,
          completed: 0,
          failed: 0,
          total,
          taskName,
          projectName,
          inProgress: 0,
          pending: total,
          deviationCount: 0,
        });
      }
    }

    // Auto-detect active dashboard if not set
    if (!this.activeDashboardId) {
      const firstActive = dashboards.find(d => d.state !== 'idle');
      this.activeDashboardId = firstActive ? firstActive.id : 'dashboard1';
    }

    return {
      dashboards,
      activeDashboardId: this.activeDashboardId,
      nonce,
    };
  }

  // -----------------------------------------------------------------------
  // Message handling (from webview)
  // -----------------------------------------------------------------------

  /**
   * Process messages from the sidebar webview.
   * Handles quick actions (dispatch, cancel, pause, resume, retry, inspect),
   * dashboard switching, and VSCode command execution.
   */
  private onMessage(message: any): void {
    if (!message || !message.type) return;

    if (message.type === 'command') {
      // Execute a VSCode command (quick action buttons)
      const command = message.command;
      const args = message.args;
      if (typeof command === 'string') {
        this.log('Sidebar: executing command ' + command);
        if (args !== undefined) {
          vscode.commands.executeCommand(command, args);
        } else {
          vscode.commands.executeCommand(command);
        }
      }
      return;
    }

    if (message.type === 'action') {
      const dashboardId = message.dashboardId;
      if (!dashboardId) return;

      switch (message.action) {
        case 'switch':
          this.activeDashboardId = dashboardId;
          this.log('Sidebar: switched to ' + dashboardId);
          this.refresh();
          break;

        case 'pause':
          this.log('Sidebar: pausing swarm on ' + dashboardId);
          this.orchestrator.pauseSwarm(dashboardId);
          break;

        case 'resume':
          this.log('Sidebar: resuming swarm on ' + dashboardId);
          this.orchestrator.resumeSwarm(dashboardId);
          break;

        case 'cancel':
          this.log('Sidebar: cancelling swarm on ' + dashboardId);
          this.orchestrator.cancelSwarm(dashboardId);
          break;

        case 'dispatch':
          this.log('Sidebar: dispatching ready tasks on ' + dashboardId);
          this.orchestrator.dispatchReady(dashboardId);
          break;

        case 'retry':
          // Retry all failed tasks on this dashboard
          this.log('Sidebar: retrying failed tasks on ' + dashboardId);
          this.retryAllFailed(dashboardId);
          break;

        case 'inspect':
          // Open inspect for the active dashboard via VSCode command
          this.log('Sidebar: opening inspect for ' + dashboardId);
          vscode.commands.executeCommand('synapse.inspect');
          break;

        default:
          this.log('Sidebar: unknown action ' + message.action);
      }
    }
  }

  /**
   * Retry all failed tasks on a dashboard by reading progress files
   * and calling orchestrator.retryTask() for each failed one.
   */
  private retryAllFailed(dashboardId: string): void {
    const progressDir = this.storage.getDashboardProgressDir(dashboardId);
    if (!progressDir) return;

    try {
      const files = fs.readdirSync(progressDir).filter((f: string) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(progressDir, file), 'utf-8'));
          if (data.status === 'failed') {
            this.orchestrator.retryTask(dashboardId, data.task_id);
          }
        } catch {
          // skip invalid progress files
        }
      }
    } catch {
      // progress directory may not exist
    }
  }

  // -----------------------------------------------------------------------
  // Orchestrator event bindings
  // -----------------------------------------------------------------------

  /**
   * Subscribe to orchestrator events so the sidebar refreshes
   * whenever swarm state changes.
   */
  private bindOrchestratorEvents(): void {
    const events = [
      'swarm-started',
      'swarm-completed',
      'swarm-paused',
      'swarm-resumed',
      'swarm-cancelled',
      'task-dispatched',
      'task-completed',
      'task-failed',
      'circuit-breaker',
    ];

    for (const event of events) {
      const handler = () => this.refresh();
      this.orchestrator.on(event, handler);

      // Track for cleanup
      this.disposables.push({
        dispose: () => this.orchestrator.removeListener(event, handler),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Dashboard data helpers
  // -----------------------------------------------------------------------

  /**
   * Read progress files and return a summary of task statuses for sidebar indicators.
   */
  private readDashboardProgressSummary(dashboardId: string): { inProgress: number; pending: number; deviationCount: number } | null {
    const progressDir = this.storage.getDashboardProgressDir(dashboardId);
    if (!progressDir) return null;

    let inProgress = 0;
    let pending = 0;
    let deviationCount = 0;

    try {
      const files = fs.readdirSync(progressDir).filter((f: string) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(progressDir, file), 'utf-8'));
          if (data.status === 'in_progress') inProgress++;
          else if (data.status === 'pending' || !data.status) pending++;
          if (data.deviations && Array.isArray(data.deviations)) {
            deviationCount += data.deviations.length;
          }
        } catch {
          // skip invalid files
        }
      }
    } catch {
      return null;
    }

    return { inProgress, pending, deviationCount };
  }

  /**
   * Read and parse a dashboard's initialization.json for plan data.
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

  // -----------------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------------

  /**
   * Clean up event subscriptions and webview references.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.view = null;
  }
}

export default SwarmSidebarProvider;
