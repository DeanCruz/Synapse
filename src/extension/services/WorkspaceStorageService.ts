import * as fs from 'fs';
import * as path from 'path';

export type WorkspaceRootInput =
  | string
  | { fsPath?: string; path?: string; uri?: { fsPath?: string; path?: string } }
  | null
  | undefined;

export type WorkspaceCollectionName =
  | 'dashboards'
  | 'queue'
  | 'archive'
  | 'history'
  | 'tasks'
  | 'conversations';

export interface WorkspaceStoragePaths {
  workspaceRoot: string;
  storageRoot: string;
  dashboardsDir: string;
  queueDir: string;
  archiveDir: string;
  historyDir: string;
  tasksDir: string;
  conversationsDir: string;
}

export interface WorkspaceStorageOptions {
  synapseDirName?: string;
  dashboardsDirName?: string;
  queueDirName?: string;
  archiveDirName?: string;
  historyDirName?: string;
  tasksDirName?: string;
  conversationsDirName?: string;
}

const DEFAULT_STORAGE_NAMES = Object.freeze({
  synapseDirName: '.synapse',
  dashboardsDirName: 'dashboards',
  queueDirName: 'queue',
  archiveDirName: 'Archive',
  historyDirName: 'history',
  tasksDirName: 'tasks',
  conversationsDirName: 'conversations',
});

function resolveWorkspaceRoot(input: WorkspaceRootInput): string | null {
  if (!input) return null;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? path.resolve(trimmed) : null;
  }

  const candidate =
    input.fsPath ||
    input.path ||
    input.uri?.fsPath ||
    input.uri?.path ||
    null;

  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  return path.resolve(candidate);
}

function joinIfRoot(root: string | null, ...segments: string[]): string | null {
  return root ? path.join(root, ...segments) : null;
}

function ensureDir(dirPath: string | null): void {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeOptions(options: WorkspaceStorageOptions = {}) {
  return {
    synapseDirName: options.synapseDirName || DEFAULT_STORAGE_NAMES.synapseDirName,
    dashboardsDirName: options.dashboardsDirName || DEFAULT_STORAGE_NAMES.dashboardsDirName,
    queueDirName: options.queueDirName || DEFAULT_STORAGE_NAMES.queueDirName,
    archiveDirName: options.archiveDirName || DEFAULT_STORAGE_NAMES.archiveDirName,
    historyDirName: options.historyDirName || DEFAULT_STORAGE_NAMES.historyDirName,
    tasksDirName: options.tasksDirName || DEFAULT_STORAGE_NAMES.tasksDirName,
    conversationsDirName: options.conversationsDirName || DEFAULT_STORAGE_NAMES.conversationsDirName,
  };
}

/**
 * Workspace-scoped storage layout for the extension host.
 * Resolves all tracker-style artifacts under <workspace>/.synapse/.
 */
export class WorkspaceStorageService {
  private workspaceRoot: string | null;
  private readonly names: ReturnType<typeof normalizeOptions>;

  constructor(workspaceRoot?: WorkspaceRootInput, options?: WorkspaceStorageOptions) {
    this.workspaceRoot = resolveWorkspaceRoot(workspaceRoot);
    this.names = normalizeOptions(options);
  }

  static fromWorkspaceFolder(workspaceFolder: WorkspaceRootInput, options?: WorkspaceStorageOptions) {
    return new WorkspaceStorageService(workspaceFolder, options);
  }

  setWorkspaceRoot(workspaceRoot: WorkspaceRootInput): this {
    this.workspaceRoot = resolveWorkspaceRoot(workspaceRoot);
    return this;
  }

  getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  getSynapseRoot(): string | null {
    return joinIfRoot(this.workspaceRoot, this.names.synapseDirName);
  }

  getStoragePaths(): WorkspaceStoragePaths | null {
    const workspaceRoot = this.getWorkspaceRoot();
    const storageRoot = this.getSynapseRoot();
    if (!workspaceRoot || !storageRoot) return null;

    return {
      workspaceRoot,
      storageRoot,
      dashboardsDir: path.join(storageRoot, this.names.dashboardsDirName),
      queueDir: path.join(storageRoot, this.names.queueDirName),
      archiveDir: path.join(storageRoot, this.names.archiveDirName),
      historyDir: path.join(storageRoot, this.names.historyDirName),
      tasksDir: path.join(storageRoot, this.names.tasksDirName),
      conversationsDir: path.join(storageRoot, this.names.conversationsDirName),
    };
  }

  ensureWorkspaceLayout(): WorkspaceStoragePaths | null {
    const paths = this.getStoragePaths();
    if (!paths) return null;

    ensureDir(paths.storageRoot);
    ensureDir(paths.dashboardsDir);
    ensureDir(paths.queueDir);
    ensureDir(paths.archiveDir);
    ensureDir(paths.historyDir);
    ensureDir(paths.tasksDir);
    ensureDir(paths.conversationsDir);

    return paths;
  }

  ensureDashboardLayout(dashboardId: string): string | null {
    const dashboardDir = this.getDashboardDir(dashboardId);
    if (!dashboardDir) return null;

    ensureDir(dashboardDir);
    ensureDir(path.join(dashboardDir, 'progress'));

    const logsPath = path.join(dashboardDir, 'logs.json');
    if (!fs.existsSync(logsPath)) {
      fs.writeFileSync(logsPath, JSON.stringify({ entries: [] }, null, 2));
    }

    return dashboardDir;
  }

  resolveCollectionRoot(collection: WorkspaceCollectionName): string | null {
    switch (collection) {
      case 'dashboards':
        return this.getDashboardsRoot();
      case 'queue':
        return this.getQueueRoot();
      case 'archive':
        return this.getArchiveRoot();
      case 'history':
        return this.getHistoryRoot();
      case 'tasks':
        return this.getTasksRoot();
      case 'conversations':
        return this.getConversationsRoot();
      default:
        return null;
    }
  }

  getDashboardsRoot(): string | null {
    return joinIfRoot(this.getSynapseRoot(), this.names.dashboardsDirName);
  }

  getDashboardDir(dashboardId: string): string | null {
    return joinIfRoot(this.getDashboardsRoot(), dashboardId);
  }

  getDashboardProgressDir(dashboardId: string): string | null {
    return joinIfRoot(this.getDashboardDir(dashboardId), 'progress');
  }

  getDashboardInitializationPath(dashboardId: string): string | null {
    return joinIfRoot(this.getDashboardDir(dashboardId), 'initialization.json');
  }

  getDashboardLogsPath(dashboardId: string): string | null {
    return joinIfRoot(this.getDashboardDir(dashboardId), 'logs.json');
  }

  getDashboardProgressPath(dashboardId: string, taskId: string): string | null {
    return joinIfRoot(this.getDashboardProgressDir(dashboardId), `${taskId}.json`);
  }

  getQueueRoot(): string | null {
    return joinIfRoot(this.getSynapseRoot(), this.names.queueDirName);
  }

  getQueueDir(queueId: string): string | null {
    return joinIfRoot(this.getQueueRoot(), queueId);
  }

  getQueueInitializationPath(queueId: string): string | null {
    return joinIfRoot(this.getQueueDir(queueId), 'initialization.json');
  }

  getQueueLogsPath(queueId: string): string | null {
    return joinIfRoot(this.getQueueDir(queueId), 'logs.json');
  }

  getQueueProgressDir(queueId: string): string | null {
    return joinIfRoot(this.getQueueDir(queueId), 'progress');
  }

  getQueueProgressPath(queueId: string, taskId: string): string | null {
    return joinIfRoot(this.getQueueProgressDir(queueId), `${taskId}.json`);
  }

  getArchiveRoot(): string | null {
    return joinIfRoot(this.getSynapseRoot(), this.names.archiveDirName);
  }

  getArchiveDir(archiveName: string): string | null {
    return joinIfRoot(this.getArchiveRoot(), archiveName);
  }

  getArchiveInitializationPath(archiveName: string): string | null {
    return joinIfRoot(this.getArchiveDir(archiveName), 'initialization.json');
  }

  getArchiveLogsPath(archiveName: string): string | null {
    return joinIfRoot(this.getArchiveDir(archiveName), 'logs.json');
  }

  getHistoryRoot(): string | null {
    return joinIfRoot(this.getSynapseRoot(), this.names.historyDirName);
  }

  getHistorySummaryPath(fileName: string): string | null {
    return joinIfRoot(this.getHistoryRoot(), fileName);
  }

  getTasksRoot(): string | null {
    return joinIfRoot(this.getSynapseRoot(), this.names.tasksDirName);
  }

  getTaskDateDir(date: string): string | null {
    return joinIfRoot(this.getTasksRoot(), date);
  }

  getTaskXmlPath(date: string, taskName: string): string | null {
    return joinIfRoot(this.getTaskDateDir(date), `parallel_${taskName}.xml`);
  }

  getTaskPlanPath(date: string, taskName: string): string | null {
    return joinIfRoot(this.getTaskDateDir(date), `parallel_plan_${taskName}.md`);
  }

  getConversationsRoot(): string | null {
    return joinIfRoot(this.getSynapseRoot(), this.names.conversationsDirName);
  }
}

export default WorkspaceStorageService;
