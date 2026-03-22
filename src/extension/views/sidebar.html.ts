/**
 * sidebar.html.ts — HTML template generator for the Synapse sidebar webview.
 *
 * Produces a self-contained HTML page rendered inside a VSCode WebviewView.
 * The sidebar displays:
 *   - Active swarms per dashboard with status indicators
 *   - Quick action buttons (dispatch, cancel, pause/resume, retry)
 *   - Dashboard switching (click to select active dashboard)
 *
 * Uses postMessage to communicate with the extension host via SwarmSidebarProvider.
 * Styled with VSCode theme CSS variables for seamless integration.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarDashboardEntry {
  id: string;
  label: string;
  state: 'running' | 'paused' | 'completed' | 'cancelled' | 'idle';
  dispatched: number;
  completed: number;
  failed: number;
  total: number;
  taskName: string | null;
  projectName: string | null;
  inProgress: number;
  pending: number;
  deviationCount: number;
}

export interface SidebarRenderData {
  dashboards: SidebarDashboardEntry[];
  activeDashboardId: string | null;
  nonce: string;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusDotColor(state: string): string {
  switch (state) {
    case 'running':
      return 'var(--vscode-charts-green, #89d185)';
    case 'paused':
      return 'var(--vscode-charts-yellow, #cca700)';
    case 'completed':
      return 'var(--vscode-charts-blue, #4fc1ff)';
    case 'cancelled':
    case 'error':
      return 'var(--vscode-charts-red, #f14c4c)';
    default:
      return 'var(--vscode-foreground, #888)';
  }
}

function statusLabel(state: string): string {
  switch (state) {
    case 'running':   return 'Running';
    case 'paused':    return 'Paused';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    default:          return 'Idle';
  }
}

// ---------------------------------------------------------------------------
// Dashboard card renderer
// ---------------------------------------------------------------------------

function renderDashboardCard(entry: SidebarDashboardEntry, isActive: boolean): string {
  const dotColor = statusDotColor(entry.state);
  const activeClass = isActive ? ' active' : '';
  const displayName = entry.projectName || entry.taskName || entry.label;
  const hasSwarm = entry.state !== 'idle';

  let statsHtml = '';
  if (hasSwarm) {
    statsHtml = `
      <div class="card-stats">
        <span class="stat stat-completed" title="Completed">${entry.completed}/${entry.total}</span>
        ${entry.inProgress > 0 ? `<span class="stat stat-active" title="In Progress">${entry.inProgress} active</span>` : ''}
        ${entry.failed > 0 ? `<span class="stat stat-failed" title="Failed">${entry.failed} failed</span>` : ''}
        ${entry.deviationCount > 0 ? `<span class="stat stat-deviation" title="Deviations">${entry.deviationCount} dev</span>` : ''}
      </div>`;
  }

  let actionsHtml = '';
  if (hasSwarm) {
    const isPaused = entry.state === 'paused';
    const isRunning = entry.state === 'running';
    const isFinished = entry.state === 'completed' || entry.state === 'cancelled';

    actionsHtml = '<div class="card-actions">';

    if (isRunning) {
      actionsHtml += `
        <button class="action-btn" data-action="pause" data-dashboard="${entry.id}" title="Pause Swarm">
          <svg width="14" height="14" viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10" fill="currentColor"/><rect x="9" y="3" width="3" height="10" fill="currentColor"/></svg>
        </button>`;
      actionsHtml += `
        <button class="action-btn" data-action="dispatch" data-dashboard="${entry.id}" title="Dispatch Ready Tasks">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 2l9 6-9 6V2z" fill="currentColor"/></svg>
        </button>`;
    }

    if (isPaused) {
      actionsHtml += `
        <button class="action-btn" data-action="resume" data-dashboard="${entry.id}" title="Resume Swarm">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 2l9 6-9 6V2z" fill="currentColor"/></svg>
        </button>`;
    }

    if (isRunning || isPaused) {
      actionsHtml += `
        <button class="action-btn action-danger" data-action="cancel" data-dashboard="${entry.id}" title="Cancel Swarm">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>`;
    }

    if (entry.failed > 0 && !isFinished) {
      actionsHtml += `
        <button class="action-btn action-warn" data-action="retry" data-dashboard="${entry.id}" title="Retry Failed Tasks">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M2 8a6 6 0 0 1 10.2-4.3L14 2v4h-4l1.6-1.6A4.5 4.5 0 1 0 12.5 8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
        </button>`;
    }

    // Inspect button — available for any active swarm
    actionsHtml += `
      <button class="action-btn" data-action="inspect" data-dashboard="${entry.id}" title="Inspect Tasks">
        <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      </button>`;

    actionsHtml += '</div>';
  }

  return `
    <div class="dashboard-card${activeClass}" data-action="switch" data-dashboard="${entry.id}">
      <div class="card-header">
        <span class="status-dot" style="background:${dotColor}"></span>
        <span class="card-name" title="${entry.id}">${displayName}</span>
        <span class="card-state">${statusLabel(entry.state)}</span>
      </div>
      ${statsHtml}
      ${actionsHtml}
    </div>`;
}

// ---------------------------------------------------------------------------
// Main HTML generator
// ---------------------------------------------------------------------------

export function generateSidebarHtml(data: SidebarRenderData): string {
  const cardsHtml = data.dashboards
    .map(d => renderDashboardCard(d, d.id === data.activeDashboardId))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${data.nonce}'; script-src 'nonce-${data.nonce}';" />
  <style nonce="${data.nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, transparent);
      padding: 8px;
    }

    .sidebar-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      padding: 4px 4px 8px;
      display: block;
    }

    .dashboard-card {
      background: var(--vscode-sideBar-background, transparent);
      border: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .dashboard-card:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    }

    .dashboard-card.active {
      background: var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.08));
      border-color: var(--vscode-focusBorder, #007acc);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .card-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
      font-size: 12px;
    }

    .card-state {
      font-size: 10px;
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      flex-shrink: 0;
    }

    .card-stats {
      display: flex;
      gap: 8px;
      padding: 4px 0 0 14px;
      font-size: 11px;
      opacity: 0.8;
    }

    .stat-completed {
      color: var(--vscode-charts-green, #89d185);
    }

    .stat-active {
      color: var(--vscode-charts-blue, #4fc1ff);
    }

    .stat-failed {
      color: var(--vscode-charts-red, #f14c4c);
    }

    .stat-deviation {
      color: var(--vscode-charts-yellow, #cca700);
    }

    .card-actions {
      display: flex;
      gap: 4px;
      padding: 6px 0 0 14px;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      cursor: pointer;
      transition: background 0.15s;
    }

    .action-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.15));
    }

    .action-danger:hover {
      background: var(--vscode-inputValidation-errorBackground, rgba(241,76,76,0.3));
      color: var(--vscode-charts-red, #f14c4c);
    }

    .action-warn:hover {
      background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,0.3));
      color: var(--vscode-charts-yellow, #cca700);
    }

    .quick-actions {
      padding: 8px 0;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,0.1));
      margin-top: 4px;
    }

    .quick-actions-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      padding: 0 4px 6px;
      display: block;
    }

    .quick-action-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 12px;
      font-family: var(--vscode-font-family);
      text-align: left;
      transition: background 0.15s;
    }

    .quick-action-btn:hover {
      background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    }

    .no-swarms {
      padding: 16px 8px;
      text-align: center;
      opacity: 0.6;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <span class="sidebar-title">Swarm Dashboards</span>

  <div id="dashboard-list">
    ${cardsHtml || '<div class="no-swarms">No swarms active</div>'}
  </div>

  <div class="quick-actions">
    <span class="quick-actions-title">Quick Actions</span>
    <button class="quick-action-btn" data-command="synapse.pTrack">
      <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 2l9 6-9 6V2z" fill="currentColor"/></svg>
      Start Tracked Swarm
    </button>
    <button class="quick-action-btn" data-command="synapse.p">
      <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" fill="currentColor"/></svg>
      Start Parallel Swarm
    </button>
    <button class="quick-action-btn" data-command="synapse.status">
      <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8 5v3.5l2.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      Show Status
    </button>
    <button class="quick-action-btn" data-command="synapse.logs">
      <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 4h10M3 7h10M3 10h7M3 13h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      View Logs
    </button>
    <button class="quick-action-btn" data-command="synapse.inspect">
      <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      Inspect Task
    </button>
    <button class="quick-action-btn" data-command="synapse.retry">
      <svg width="14" height="14" viewBox="0 0 16 16"><path d="M2 8a6 6 0 0 1 10.2-4.3L14 2v4h-4l1.6-1.6A4.5 4.5 0 1 0 12.5 8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
      Retry Failed
    </button>
    <button class="quick-action-btn" data-command="synapse.openDashboard">
      <svg width="14" height="14" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M2 6h12" stroke="currentColor" stroke-width="1.3"/><path d="M6 6v8" stroke="currentColor" stroke-width="1.3"/></svg>
      Open Dashboard
    </button>
  </div>

  <script nonce="${data.nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // Dashboard card click — switch dashboard
      document.getElementById('dashboard-list').addEventListener('click', function(e) {
        const card = e.target.closest('.dashboard-card');
        if (!card) return;

        // Check if an action button was clicked
        const actionBtn = e.target.closest('.action-btn');
        if (actionBtn) {
          const action = actionBtn.getAttribute('data-action');
          const dashboard = actionBtn.getAttribute('data-dashboard');
          vscode.postMessage({ type: 'action', action: action, dashboardId: dashboard });
          return;
        }

        // Otherwise it's a switch action
        const dashboardId = card.getAttribute('data-dashboard');
        if (dashboardId) {
          vscode.postMessage({ type: 'action', action: 'switch', dashboardId: dashboardId });
        }
      });

      // Quick action buttons — execute VSCode commands
      document.querySelectorAll('.quick-action-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          const command = btn.getAttribute('data-command');
          if (command) {
            vscode.postMessage({ type: 'command', command: command });
          }
        });
      });
    })();
  </script>
</body>
</html>`;
}
