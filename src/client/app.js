// app.js — Application bootstrap
// ES module entry point. Creates AppState, SSEClient, caches DOM,
// creates ViewModel, sets up all event handlers, and connects.

import { initStatusColorsFromCSS } from './utils/constants.js';
import { createAppState } from './models/AppState.js';
import { createSSEClient } from './models/SSEClient.js';
import { createIPCClient } from './models/IPCClient.js';
import { createDashboardVM } from './viewmodels/DashboardVM.js';
import { createConnectionIndicator } from './views/ConnectionIndicatorView.js';
import { setupLogPanel } from './views/LogPanelView.js';
import { setupSidebarToggle, setupSidebarTitle } from './views/SidebarView.js';
import { setupTaskBadge, setupTitleClick } from './views/HeaderView.js';
import { setupStatCards } from './views/StatsBarView.js';
import { setupTimelineCard } from './views/TimelinePanelView.js';
import { showTaskDetails, applyCustomTheme } from './views/modals/index.js';

// ---------------------------------------------------------------------------
// Electron fetch shim — intercepts /api/* calls and routes through IPC
// This means DashboardVM.js and all other modules need ZERO changes.
// ---------------------------------------------------------------------------
var isElectron = !!(window.electronAPI);

if (isElectron) {
  var originalFetch = window.fetch;
  window.fetch = function (url, options) {
    if (typeof url !== 'string' || !url.startsWith('/api/')) {
      return originalFetch.call(window, url, options);
    }
    var method = (options && options.method) ? options.method.toUpperCase() : 'GET';
    var api = window.electronAPI;
    var promise = routeToIPC(api, url, method);
    if (!promise) {
      // Unknown route — fall through to original fetch (will fail in Electron, but safe)
      return originalFetch.call(window, url, options);
    }
    // Wrap in a fake Response with .json()
    return promise.then(function (data) {
      return {
        ok: true,
        status: 200,
        json: function () { return Promise.resolve(data); },
      };
    });
  };
}

function routeToIPC(api, url, method) {
  // /api/dashboards/statuses
  if (url === '/api/dashboards/statuses' && method === 'GET') return api.getDashboardStatuses();
  // /api/dashboards (must check after /statuses to avoid false match)
  if (url === '/api/dashboards' && method === 'GET') return api.getDashboards();
  // /api/overview
  if (url === '/api/overview' && method === 'GET') return api.getOverview();
  // /api/archives
  if (url === '/api/archives' && method === 'GET') return api.getArchives();
  // /api/history
  if (url === '/api/history' && method === 'GET') return api.getHistory();
  // /api/queue (exact)
  if (url === '/api/queue' && method === 'GET') return api.getQueue();

  // /api/archives/:name
  var archiveMatch = url.match(/^\/api\/archives\/([^/]+)$/);
  if (archiveMatch) {
    var archiveName = decodeURIComponent(archiveMatch[1]);
    if (method === 'GET') return api.getArchive(archiveName);
    if (method === 'DELETE') return api.deleteArchive(archiveName);
  }

  // /api/queue/:id
  var queueMatch = url.match(/^\/api\/queue\/([^/]+)$/);
  if (queueMatch && method === 'GET') return api.getQueueItem(decodeURIComponent(queueMatch[1]));

  // /api/dashboards/:id/:subpath
  var dashMatch = url.match(/^\/api\/dashboards\/([^/]+)\/(.+)$/);
  if (dashMatch) {
    var id = dashMatch[1];
    var sub = dashMatch[2];
    if (sub === 'initialization' && method === 'GET') return api.getDashboardInit(id);
    if (sub === 'logs' && method === 'GET') return api.getDashboardLogs(id);
    if (sub === 'progress' && method === 'GET') return api.getDashboardProgress(id);
    if (sub === 'clear' && method === 'POST') return api.clearDashboard(id);
    if (sub === 'archive' && method === 'POST') return api.archiveDashboard(id);
    if (sub === 'save-history' && method === 'POST') return api.saveDashboardHistory(id);
    if (sub === 'export' && method === 'GET') return api.exportDashboard(id);
  }

  // /api/commands
  if (url === '/api/commands' && method === 'GET') return api.listCommands();
  // /api/commands/:name
  var cmdMatch = url.match(/^\/api\/commands\/([^/]+)$/);
  if (cmdMatch && method === 'GET') return api.getCommand(decodeURIComponent(cmdMatch[1]));

  return null; // unknown route
}

/**
 * Main initialization function.
 * Called when the DOM is ready.
 */
function init() {
  // -------------------------------------------------------------------------
  // 1. Restore saved theme, then initialize status colors from CSS
  // -------------------------------------------------------------------------
  var savedTheme = localStorage.getItem('synapse-theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (savedTheme === 'custom') {
      try {
        var customColors = JSON.parse(localStorage.getItem('synapse-custom-colors'));
        if (customColors && customColors.bg) applyCustomTheme(customColors);
      } catch (e) { /* ignore */ }
    }
  }
  initStatusColorsFromCSS();

  // -------------------------------------------------------------------------
  // 2. Cache all DOM references
  // -------------------------------------------------------------------------
  var dom = {};
  dom.emptyState = document.getElementById('empty-state');
  dom.taskBadge = document.getElementById('task-badge');
  dom.activeCount = document.getElementById('active-count');
  dom.progressBar = document.getElementById('progress-bar');
  dom.statsBar = document.getElementById('stats-bar');
  dom.statTotal = document.getElementById('stat-total');
  dom.statCompleted = document.getElementById('stat-completed');
  dom.statInProgress = document.getElementById('stat-in-progress');
  dom.statFailed = document.getElementById('stat-failed');
  dom.statPending = document.getElementById('stat-pending');
  dom.statElapsed = document.getElementById('stat-elapsed');
  dom.wavePipeline = document.getElementById('wave-pipeline');
  dom.timelinePanel = document.getElementById('timeline-panel');
  dom.timelinePanelBody = document.getElementById('timeline-panel-body');
  dom.logPanel = document.getElementById('log-panel');
  dom.logToggle = document.getElementById('log-toggle');
  dom.logToggleText = document.getElementById('log-toggle-text');
  dom.logCompleteBadge = document.getElementById('log-complete-badge');
  dom.logBody = document.getElementById('log-body');
  dom.logEntries = document.getElementById('log-entries');
  dom.taskDirectory = document.getElementById('task-directory');
  dom.progressSection = document.querySelector('.progress-section');
  dom.waveSection = document.querySelector('.wave-section');
  dom.headerCenter = document.querySelector('.header-center');
  dom.clearDashboardSection = document.getElementById('clear-dashboard-section');
  dom.logLastUpdated = document.getElementById('log-last-updated');

  // -------------------------------------------------------------------------
  // 3. Create AppState with initial state
  // -------------------------------------------------------------------------
  var appState = createAppState({
    currentDashboardId: 'dashboard1',
    currentInit: null,
    currentProgress: {},
    currentLogs: null,
    currentStatus: null,
    dashboardList: [],
    dashboardStates: {},
    homeViewActive: false,
    archiveViewActive: false,
    queueViewActive: false,
    queueItems: [],
    priorDashboardId: null,
    activeLogFilter: 'all',
    activeStatFilter: null,
    seenPermissionCount: 0,
    renderedCardCount: 0,
    cardElementMap: {},
    renderGeneration: 0,
    lastSSEEventTime: 0,
  });

  // -------------------------------------------------------------------------
  // 4. Create Connection Indicator
  // -------------------------------------------------------------------------
  var headerCenter = document.querySelector('.header-center');
  var connectionIndicator = createConnectionIndicator(headerCenter);

  // -------------------------------------------------------------------------
  // 5. Create data client — IPCClient in Electron, SSEClient in browser
  // -------------------------------------------------------------------------
  var dataClient; // forward declaration
  var createClient = isElectron ? createIPCClient : createSSEClient;

  // -------------------------------------------------------------------------
  // 6. Create DashboardVM — needs appState, dataClient, and dom
  //    We create a temporary proxy that will be set before connect
  // -------------------------------------------------------------------------
  var clientProxy = {
    connect: function () { if (dataClient) dataClient.connect(); },
    disconnect: function () { if (dataClient) dataClient.disconnect(); },
  };

  var vm = createDashboardVM(appState, clientProxy, dom);

  // Now create the actual client with the VM's handlers
  dataClient = createClient(appState, {
    onInitialization: vm.sseHandlers.onInitialization,
    onLogs: vm.sseHandlers.onLogs,
    onAgentProgress: vm.sseHandlers.onAgentProgress,
    onAllProgress: vm.sseHandlers.onAllProgress,
    onDashboardsList: vm.sseHandlers.onDashboardsList,
    onDashboardsChanged: vm.sseHandlers.onDashboardsChanged,
    onQueueChanged: vm.sseHandlers.onQueueChanged,
    onReload: vm.sseHandlers.onReload,
    onOpen: function () { connectionIndicator.setConnected(); },
    onError: function () { connectionIndicator.setDisconnected(); },
  });

  // -------------------------------------------------------------------------
  // 7. Set up interaction handlers
  // -------------------------------------------------------------------------

  // Header title click -> show home overview
  setupTitleClick(document.querySelector('.header-title'), function () {
    vm.showHome();
  });

  // Task badge click -> show task details modal
  setupTaskBadge(dom.taskBadge, function () {
    var task = dom.taskBadge._task;
    if (task) showTaskDetails(task);
  });

  // Stat card clicks -> filter pipeline
  setupStatCards(dom, function (filterValue) {
    appState.set('activeStatFilter', filterValue);
    var currentStatus = appState.get('currentStatus');
    if (currentStatus) {
      vm.renderStatus(currentStatus);
    }
  });

  // Timeline card click -> toggle timeline panel
  setupTimelineCard(dom.statElapsed.parentElement, dom.timelinePanel, document.getElementById('timeline-close-btn'));

  // Log panel toggle/filter
  setupLogPanel(dom, {
    onFilterChange: function (level) {
      appState.set('activeLogFilter', level);
      var currentLogs = appState.get('currentLogs');
      if (currentLogs) {
        vm.doRenderLogs(currentLogs);
      }
    },
    getEntries: function () {
      var currentLogs = appState.get('currentLogs');
      return currentLogs ? (currentLogs.entries || []) : [];
    },
  });

  // Sidebar toggle
  var sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  var sidebarEl = document.getElementById('dashboard-sidebar');
  setupSidebarToggle(sidebarToggleBtn, sidebarEl);

  // Sidebar title click -> show home overview
  setupSidebarTitle(document.querySelector('.sidebar-title'), function () {
    vm.showHome();
  });

  // Settings button
  var settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function () {
      vm.showSettings();
    });
  }

  // Swarm controls (Electron only)
  if (isElectron) {
    var swarmControls = document.getElementById('swarm-controls');
    if (swarmControls) swarmControls.style.display = '';

    var commandsBtn = document.getElementById('commands-btn');
    if (commandsBtn) {
      commandsBtn.addEventListener('click', function () {
        vm.showCommands();
      });
    }
  }

  // Archive dropdown
  setupArchiveDropdown(vm);

  // History button
  var historyBtn = document.getElementById('history-btn');
  if (historyBtn) {
    historyBtn.addEventListener('click', function () {
      vm.showHistoryList();
    });
  }

  // Clear dashboard button
  var clearBtn = document.getElementById('clear-dashboard-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      vm.showClearConfirm();
    });
  }

  // Request notification permission on first click
  var notifPermRequested = false;
  document.addEventListener('click', function requestNotifPerm() {
    if (notifPermRequested) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
    notifPermRequested = true;
    document.removeEventListener('click', requestNotifPerm);
  }, { once: true });

  // -------------------------------------------------------------------------
  // 8. Render initial sidebar, fetch all dashboard statuses, and show empty state
  // -------------------------------------------------------------------------
  vm.doRenderSidebar();
  vm.renderStatus({ active_task: null, agents: [], waves: [], history: [] });

  // Fetch statuses for ALL dashboards so sidebar dots are correct on load
  fetch('/api/dashboards/statuses')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.statuses) {
        var dashboardStates = appState.get('dashboardStates');
        for (var id in data.statuses) {
          dashboardStates[id] = data.statuses[id];
        }
        appState.set('dashboardStates', dashboardStates);
        vm.doRenderSidebar();
      }
    })
    .catch(function () { /* non-critical — sidebar dots stay idle */ });

  // Fetch initial queue data
  fetch('/api/queue')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.queue) {
        appState.set('queueItems', data.queue);
        vm.doRenderQueuePopup();
        vm.doRenderSidebar();
      }
    })
    .catch(function () { /* non-critical */ });

  // Close queue popup on outside click
  document.addEventListener('click', function (e) {
    var queueContainer = document.getElementById('queue-popup-container');
    if (queueContainer && queueContainer.classList.contains('expanded')) {
      if (!queueContainer.contains(e.target)) {
        queueContainer.classList.remove('expanded');
      }
    }
  });

  // -------------------------------------------------------------------------
  // 9. Start elapsed timer
  // -------------------------------------------------------------------------
  vm.startElapsedTimer();

  // -------------------------------------------------------------------------
  // 10. Set up resize/orientation handlers for pipeline redraw
  // -------------------------------------------------------------------------
  window.addEventListener('resize', vm.debouncedPipelineRedraw);
  window.addEventListener('orientationchange', vm.debouncedPipelineRedraw);

  // Observe wavePipeline parent for layout changes (e.g. sidebar toggle)
  if (dom.wavePipeline && dom.wavePipeline.parentElement && typeof ResizeObserver !== 'undefined') {
    var parentResizeObserver = new ResizeObserver(vm.debouncedPipelineRedraw);
    parentResizeObserver.observe(dom.wavePipeline.parentElement);
  }

  // -------------------------------------------------------------------------
  // 11. Connect data client (IPC in Electron, SSE in browser)
  // -------------------------------------------------------------------------
  dataClient.connect();
}

// ---------------------------------------------------------------------------
// Archive dropdown setup — extracted for clarity
// ---------------------------------------------------------------------------

function setupArchiveDropdown(vm) {
  var archiveBtn = document.getElementById('archive-btn');
  var dropdown = document.getElementById('archive-dropdown');
  var archiveTaskBtn = document.getElementById('archive-task-btn');
  var viewArchiveBtn = document.getElementById('view-archive-btn');

  if (archiveBtn && dropdown) {
    archiveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
    });
  }

  if (archiveTaskBtn) {
    archiveTaskBtn.addEventListener('click', function () {
      dropdown.hidden = true;
      vm.archiveCurrentTask();
    });
  }

  if (viewArchiveBtn) {
    viewArchiveBtn.addEventListener('click', function () {
      dropdown.hidden = true;
      vm.showArchiveList();
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', function () {
    if (dropdown && !dropdown.hidden) {
      dropdown.hidden = true;
    }
  });
}

// ---------------------------------------------------------------------------
// Start when DOM is ready
// ---------------------------------------------------------------------------

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
