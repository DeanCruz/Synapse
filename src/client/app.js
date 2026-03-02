// app.js — Application bootstrap
// ES module entry point. Creates AppState, SSEClient, caches DOM,
// creates ViewModel, sets up all event handlers, and connects.

import { initStatusColorsFromCSS } from './utils/constants.js';
import { createAppState } from './models/AppState.js';
import { createSSEClient } from './models/SSEClient.js';
import { createDashboardVM } from './viewmodels/DashboardVM.js';
import { createConnectionIndicator } from './views/ConnectionIndicatorView.js';
import { setupLogPanel } from './views/LogPanelView.js';
import { setupSidebarToggle, setupSidebarTitle } from './views/SidebarView.js';
import { setupTaskBadge, setupTitleClick } from './views/HeaderView.js';
import { setupStatCards } from './views/StatsBarView.js';
import { setupTimelineCard } from './views/TimelinePanelView.js';
import { showTaskDetails, applyCustomTheme } from './views/modals/index.js';

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
  // 5. Create SSEClient — we'll wire up callbacks via the VM's sseHandlers
  //    after creating the VM (chicken-and-egg solved by deferred connect)
  // -------------------------------------------------------------------------
  var sseClient; // forward declaration

  // -------------------------------------------------------------------------
  // 6. Create DashboardVM — needs appState, sseClient, and dom
  //    We create a temporary sseClient reference that will be set before connect
  // -------------------------------------------------------------------------
  var sseClientProxy = {
    connect: function () { if (sseClient) sseClient.connect(); },
    disconnect: function () { if (sseClient) sseClient.disconnect(); },
  };

  var vm = createDashboardVM(appState, sseClientProxy, dom);

  // Now create the actual SSEClient with the VM's handlers
  sseClient = createSSEClient(appState, {
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
  // 11. Connect SSE
  // -------------------------------------------------------------------------
  sseClient.connect();
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
