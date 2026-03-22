declare const require: {
  (moduleName: string): any;
};

const vscode = require('vscode');

import * as fs from 'fs';
import * as path from 'path';

import { WorkspaceStorageService } from './services/WorkspaceStorageService';
import { WorkspaceProjectService } from './services/WorkspaceProjectService';
import { ExtensionSwarmOrchestrator } from './services/ExtensionSwarmOrchestrator';
import { ExtensionWatcherBridge } from './services/ExtensionWatcherBridge';
import { ClaudeCliService } from './services/ClaudeCliService';
import { CodexCliService } from './services/CodexCliService';
import { registerSwarmCommands } from './commands/swarmCommands';
import { SwarmSidebarProvider, SIDEBAR_VIEW_ID } from './views/SwarmSidebarProvider';
import { createWebviewBridge } from './webview/WebviewBridge';
import { getWebviewHtml } from './webview/getWebviewHtml';
import { WebviewDataController } from './webview/WebviewDataController';

type Disposable = { dispose(): unknown };
type ExtensionContext = {
  subscriptions: Disposable[];
  extensionUri?: any;
  extensionPath?: string;
};

const OUTPUT_CHANNEL_NAME = 'Synapse';

let outputChannel: any = null;

// Service instances — kept at module scope for cleanup in deactivate()
let orchestrator: ExtensionSwarmOrchestrator | null = null;
let watcherBridge: ExtensionWatcherBridge | null = null;
let claudeService: ClaudeCliService | null = null;
let codexService: CodexCliService | null = null;
let sidebarProvider: SwarmSidebarProvider | null = null;

function ensureOutputChannel(): any {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }

  return outputChannel;
}

function log(message: string): void {
  ensureOutputChannel().appendLine(`[Synapse] ${message}`);
}

export function activate(context: ExtensionContext): void {
  const channel = ensureOutputChannel();
  context.subscriptions.push(channel);

  log('Extension activated.');
  log('Initializing services and command routing.');

  // -----------------------------------------------------------------------
  // Instantiate core services
  // -----------------------------------------------------------------------

  // Resolve workspace root — first workspace folder, or extension host path
  const workspaceFolders = vscode.workspace?.workspaceFolders;
  const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
    ? workspaceFolders[0].uri.fsPath
    : null;

  const storage = new WorkspaceStorageService(workspaceRoot);
  storage.ensureWorkspaceLayout();
  const projectService = new WorkspaceProjectService();

  // Create the orchestrator (manages swarm lifecycle)
  orchestrator = new ExtensionSwarmOrchestrator(storage, projectService);

  // Create CLI runner services
  claudeService = new ClaudeCliService();
  codexService = new CodexCliService();

  // Initialize orchestrator with CLI services
  orchestrator.init(claudeService, codexService);

  // Create the watcher bridge (monitors progress files and forwards to orchestrator)
  watcherBridge = new ExtensionWatcherBridge(storage, orchestrator);

  log('Core services initialized: orchestrator, watcher bridge, CLI runners.');

  // -----------------------------------------------------------------------
  // Register existing commands (preserved from original scaffold)
  // -----------------------------------------------------------------------

  let dashboardPanel: any = null;
  let dashboardController: WebviewDataController | null = null;

  const openDashboard = vscode.commands.registerCommand('synapse.openDashboard', () => {
    log('Command invoked: synapse.openDashboard');

    // If panel already exists, reveal it
    if (dashboardPanel) {
      dashboardPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Resolve extension root for asset URIs
    const extensionUri = context.extensionUri || (context as any).extensionPath;
    let extensionRoot: any;
    if (typeof extensionUri === 'string') {
      extensionRoot = vscode.Uri.file(extensionUri);
    } else if (extensionUri) {
      extensionRoot = extensionUri;
    } else if (workspaceRoot) {
      // Fallback: assume extension is in the workspace (dev mode)
      extensionRoot = vscode.Uri.file(workspaceRoot);
    } else {
      void vscode.window.showErrorMessage('Synapse: Cannot resolve extension path.');
      return;
    }

    const distWebviewUri = vscode.Uri.joinPath(extensionRoot, 'dist', 'webview');

    dashboardPanel = vscode.window.createWebviewPanel(
      'synapse-dashboard',
      'Synapse Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [distWebviewUri],
      },
    );

    // Discover built assets dynamically (filenames have Vite content hashes)
    const assetsDir = path.join(extensionRoot.fsPath || extensionRoot, 'dist', 'webview', 'assets');
    let jsFile = '';
    let cssFile = '';
    try {
      const files = fs.readdirSync(assetsDir);
      jsFile = files.find((f: string) => f.endsWith('.js')) || '';
      cssFile = files.find((f: string) => f.endsWith('.css')) || '';
    } catch (e) {
      log('Could not read webview assets from: ' + assetsDir);
    }

    const scriptUris = jsFile
      ? [dashboardPanel.webview.asWebviewUri(vscode.Uri.joinPath(distWebviewUri, 'assets', jsFile))]
      : [];
    const styleUris = cssFile
      ? [dashboardPanel.webview.asWebviewUri(vscode.Uri.joinPath(distWebviewUri, 'assets', cssFile))]
      : [];

    // Set webview HTML
    dashboardPanel.webview.html = getWebviewHtml(dashboardPanel.webview, {
      title: 'Synapse Dashboard',
      scriptUris,
      styleUris,
    });

    // Wire up bridge + data controller
    const bridge = createWebviewBridge(dashboardPanel.webview);
    dashboardController = new WebviewDataController(
      bridge, storage, orchestrator!, watcherBridge!,
    );
    dashboardController.activate();

    log('Dashboard webview panel opened.');

    // Clean up on panel close
    dashboardPanel.onDidDispose(() => {
      log('Dashboard webview panel closed.');
      if (dashboardController) {
        dashboardController.dispose();
        dashboardController = null;
      }
      bridge.dispose();
      dashboardPanel = null;
    });
  });

  const showLog = vscode.commands.registerCommand('synapse.showExtensionLog', () => {
    log('Command invoked: synapse.showExtensionLog');
    channel.show(true);
  });

  context.subscriptions.push(openDashboard, showLog);

  // -----------------------------------------------------------------------
  // Register swarm commands (synapse.pTrack, synapse.p, synapse.status,
  // synapse.logs, synapse.inspect, synapse.retry)
  // -----------------------------------------------------------------------

  registerSwarmCommands(context, {
    orchestrator,
    watcherBridge,
    storage,
    projectService,
    log,
  });

  log('Swarm commands registered: pTrack, p, status, logs, inspect, retry.');

  // -----------------------------------------------------------------------
  // Register sidebar view provider (native VSCode sidebar)
  // -----------------------------------------------------------------------

  sidebarProvider = new SwarmSidebarProvider(orchestrator, storage, log);

  const sidebarRegistration = vscode.window.registerWebviewViewProvider(
    SIDEBAR_VIEW_ID,
    sidebarProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  context.subscriptions.push(sidebarRegistration);

  log('Sidebar view provider registered: ' + SIDEBAR_VIEW_ID);

  // -----------------------------------------------------------------------
  // Register disposables for cleanup
  // -----------------------------------------------------------------------

  context.subscriptions.push({
    dispose() {
      if (sidebarProvider) {
        sidebarProvider.dispose();
        sidebarProvider = null;
      }
      if (watcherBridge) {
        watcherBridge.dispose();
        watcherBridge = null;
      }
      if (orchestrator) {
        orchestrator.dispose();
        orchestrator = null;
      }
      if (claudeService) {
        claudeService.dispose();
        claudeService = null;
      }
      if (codexService) {
        codexService.dispose();
        codexService = null;
      }
    },
  });

  log('Extension fully activated with swarm orchestration support.');
}

export function deactivate(): void {
  if (!outputChannel) {
    return;
  }

  log('Extension deactivated.');
  outputChannel.dispose();
  outputChannel = null;
}
