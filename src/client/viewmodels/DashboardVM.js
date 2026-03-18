// DashboardVM — The ViewModel layer
// ES module. Contains ALL merge logic, dashboard state derivation, action handlers
// (switch dashboard, archive, clear, export, etc.), and orchestrates view updates.
// This is the only place that reads/writes AppState.

import { DEBOUNCE_MS, initStatusColorsFromCSS } from '../utils/constants.js';
import { formatElapsed } from '../utils/format.js';
import { updateHeader } from '../views/HeaderView.js';
import { updateStats, updateProgressBar } from '../views/StatsBarView.js';
import { renderWavePipeline } from '../views/WavePipelineView.js';
import { renderChainPipeline } from '../views/ChainPipelineView.js';
import { renderTimelinePanel } from '../views/TimelinePanelView.js';
import { renderLogs } from '../views/LogPanelView.js';
import { renderSidebar } from '../views/SidebarView.js';
import { renderHomeView } from '../views/HomeView.js';
import { renderQueuePopup, closeQueuePopup } from '../views/QueuePopupView.js';
import {
  showTaskDetails,
  showAgentDetails,
  showPermissionPopup,
  showConfirmModal,
  hideConfirmModal,
  showErrorPopup,
  showHistoryPopup,
  showArchivePopup,
  showSettingsPopup,
  applyCustomTheme,
  clearCustomTheme,
  showProjectModal,
  getAllDashboardProjects,
  getDashboardProject,
  showPlanningModal,
  showWorkerTerminal,
  showCommandsModal,
} from '../views/modals/index.js';
import { renderSwarmBuilder } from '../views/SwarmBuilderView.js';
import { renderClaudeView } from '../views/ClaudeView.js';

/**
 * Create the DashboardVM — the central orchestrator for all dashboard logic.
 *
 * @param {object} appState — AppState instance
 * @param {object} sseClient — SSEClient instance { connect, disconnect }
 * @param {object} dom — cached DOM references
 * @returns {object} — public interface for the VM
 */
export function createDashboardVM(appState, sseClient, dom) {

  // -------------------------------------------------------------------------
  // Per-dashboard progress cache — tracks progress for ALL dashboards
  // so the sidebar dots can derive accurate state in real-time.
  // Shape: { dashboardId: { taskId: { status, ... }, ... }, ... }
  // -------------------------------------------------------------------------
  var _allDashboardProgress = {};

  // -------------------------------------------------------------------------
  // Per-dashboard logs cache — tracks logs for ALL dashboards so the
  // home view can show aggregated logs across all dashboards.
  // Shape: { dashboardId: { entries: [...] } }
  // -------------------------------------------------------------------------
  var _allDashboardLogs = {};

  // -------------------------------------------------------------------------
  // Auto-save history tracking — prevents duplicate saves per task
  // Keyed by dashboardId + taskName so a new task on the same dashboard resets.
  // -------------------------------------------------------------------------
  var _historySavedFor = {};

  // -------------------------------------------------------------------------
  // Custom view guard — when true, renderStatus skips pipeline/section changes
  // Set by showSwarmBuilder, showClaudeChat, etc. Cleared on switchDashboard.
  // -------------------------------------------------------------------------
  var _customViewActive = false;

  // -------------------------------------------------------------------------
  // Debounce timers
  // -------------------------------------------------------------------------
  var mergedRenderTimer = null;
  var logsRenderTimer = null;

  // -------------------------------------------------------------------------
  // Elapsed timer cache
  // -------------------------------------------------------------------------
  var elapsedCache = { generation: -1, elements: [] };

  // -------------------------------------------------------------------------
  // mergeState — exact replica of original dashboard.js lines 284-378
  // -------------------------------------------------------------------------

  /**
   * Merge static plan data (initialization.json) with dynamic lifecycle data
   * (progress files) to produce the same shape that renderStatus() consumes.
   *
   * @param {object|null} init — initialization.json payload
   * @param {object} progress — map of task_id -> progress data
   * @returns {object} — { active_task, agents, waves, chains, history }
   */
  function mergeState(init, progress) {
    if (!init || !init.task) {
      return { active_task: null, agents: [], waves: [], chains: [], history: [] };
    }
    var task = {};
    var key;
    for (key in init.task) {
      if (init.task.hasOwnProperty(key)) task[key] = init.task[key];
    }
    var agents = (init.agents || []).map(function (agentDef) {
      var prog = progress[agentDef.id];
      return {
        id: agentDef.id,
        title: agentDef.title,
        wave: agentDef.wave,
        layer: agentDef.layer || null,
        directory: agentDef.directory || null,
        depends_on: agentDef.depends_on || [],
        status: prog ? prog.status : 'pending',
        assigned_agent: prog ? prog.assigned_agent : null,
        started_at: prog ? prog.started_at : null,
        completed_at: prog ? prog.completed_at : null,
        summary: prog ? prog.summary : null,
      };
    });

    // Derive stats from merged agents
    var completed = 0, failed = 0, inProgress = 0;
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].status === 'completed') completed++;
      else if (agents[i].status === 'failed') failed++;
      else if (agents[i].status === 'in_progress') inProgress++;
    }
    task.completed_tasks = completed;
    task.failed_tasks = failed;
    task.total_tasks = task.total_tasks || agents.length;

    // Derive started_at from earliest agent start
    var startTimes = [];
    for (var j = 0; j < agents.length; j++) {
      if (agents[j].started_at) startTimes.push(new Date(agents[j].started_at).getTime());
    }
    if (startTimes.length > 0) {
      task.started_at = new Date(Math.min.apply(null, startTimes)).toISOString();
    }

    // Derive completion
    var allDone = agents.length > 0;
    for (var k = 0; k < agents.length; k++) {
      if (agents[k].status !== 'completed' && agents[k].status !== 'failed') {
        allDone = false;
        break;
      }
    }
    if (allDone) {
      var endTimes = [];
      for (var m = 0; m < agents.length; m++) {
        if (agents[m].completed_at) endTimes.push(new Date(agents[m].completed_at).getTime());
      }
      if (endTimes.length > 0) {
        task.completed_at = new Date(Math.max.apply(null, endTimes)).toISOString();
      }
      task.overall_status = failed > 0 ? 'completed_with_errors' : 'completed';
    } else if (inProgress > 0 || completed > 0) {
      task.overall_status = 'in_progress';
    } else {
      task.overall_status = task.overall_status || 'pending';
    }

    // Derive wave status from agents
    var waves = (init.waves || []).map(function (waveDef) {
      var waveAgents = agents.filter(function (a) { return a.wave === waveDef.id; });
      var waveCompleted = waveAgents.filter(function (a) { return a.status === 'completed'; }).length;
      var anyActive = waveAgents.some(function (a) {
        return a.status === 'in_progress' || a.status === 'completed' || a.status === 'failed';
      });
      return {
        id: waveDef.id,
        name: waveDef.name,
        total: waveDef.total || waveAgents.length,
        completed: waveCompleted,
        status: (waveCompleted === waveAgents.length && waveAgents.length > 0)
          ? 'completed'
          : anyActive ? 'in_progress' : 'pending',
      };
    });

    return {
      active_task: task,
      agents: agents,
      waves: waves,
      chains: init.chains || [],
      history: init.history || [],
    };
  }

  // -------------------------------------------------------------------------
  // renderMerged — convenience: merge + update state + render
  // -------------------------------------------------------------------------

  function renderMerged() {
    var gen = appState.get('renderGeneration') + 1;
    appState.set('renderGeneration', gen);

    var currentInit = appState.get('currentInit');
    var currentProgress = appState.get('currentProgress');
    var merged = mergeState(currentInit, currentProgress);
    appState.set('currentStatus', merged);
    renderStatus(merged);
  }

  function debouncedRenderMerged() {
    if (mergedRenderTimer !== null) {
      clearTimeout(mergedRenderTimer);
    }
    mergedRenderTimer = setTimeout(function () {
      mergedRenderTimer = null;
      renderMerged();
    }, DEBOUNCE_MS);
  }

  function debouncedRenderLogs(data) {
    if (logsRenderTimer !== null) {
      clearTimeout(logsRenderTimer);
    }
    logsRenderTimer = setTimeout(function () {
      logsRenderTimer = null;
      doRenderLogs(data);
    }, DEBOUNCE_MS);
  }

  // -------------------------------------------------------------------------
  // renderStatus — full render orchestrator
  // -------------------------------------------------------------------------

  /**
   * Render the full dashboard from a status payload.
   * @param {object} data — { active_task, agents, waves, chains, history }
   * @param {boolean} [skipPipeline] — if true, only update header/stats
   */
  function renderStatus(data, skipPipeline) {
    appState.set('currentStatus', data);

    // When a custom view (SwarmBuilder, ClaudeChat, etc.) owns the pipeline,
    // skip all DOM manipulation — the custom view manages its own lifecycle.
    if (_customViewActive) return;

    // Empty state
    if (!data.active_task) {
      dom.emptyState.hidden = false;
      if (dom.progressSection) dom.progressSection.hidden = true;
      if (dom.waveSection) dom.waveSection.hidden = true;
      if (dom.headerCenter) dom.headerCenter.hidden = false;
      if (dom.taskBadge) { dom.taskBadge.textContent = 'Waiting for dispatch'; dom.taskBadge.hidden = false; }
      if (dom.taskDirectory) dom.taskDirectory.hidden = true;
      dom.activeCount.textContent = '0 active';
      dom.progressBar.style.width = '0%';
      dom.wavePipeline.className = 'wave-pipeline';
      dom.wavePipeline.textContent = '';
      if (dom.clearDashboardSection) dom.clearDashboardSection.hidden = true;
      return;
    }

    dom.emptyState.hidden = true;
    if (dom.progressSection) dom.progressSection.hidden = false;
    if (dom.waveSection) dom.waveSection.hidden = false;
    if (dom.headerCenter) dom.headerCenter.hidden = false;

    var task = data.active_task;
    var agents = data.agents || [];
    var waves = data.waves || [];

    // --- Header ---
    updateHeader(dom, task, agents);

    // --- Stats ---
    var inProgressCount = 0;
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].status === 'in_progress') inProgressCount++;
    }
    var allDone = task.total_tasks > 0 &&
      (task.completed_tasks || 0) + (task.failed_tasks || 0) >= task.total_tasks &&
      inProgressCount === 0;

    updateStats(dom, task, agents, allDone);
    updateProgressBar(dom.progressBar, task.completed_tasks || 0, task.total_tasks || 1, allDone);

    // --- Auto-save history when all tasks complete ---
    if (allDone && task.name) {
      var dashId = appState.get('currentDashboardId');
      var saveKey = dashId + '::' + task.name;
      if (!_historySavedFor[saveKey]) {
        _historySavedFor[saveKey] = true;
        fetch('/api/dashboards/' + dashId + '/save-history', { method: 'POST' })
          .catch(function () { /* non-critical */ });
      }
    }

    // --- Pipeline (waves or chains) ---
    if (!skipPipeline) {
      var activeStatFilter = appState.get('activeStatFilter');
      var currentProgress = appState.get('currentProgress');

      var pipelineOptions = {
        activeStatFilter: activeStatFilter,
        progressData: currentProgress,
        onCardClick: function (agent) {
          showAgentDetails(agent, currentProgress, function (id) {
            var all = (appState.get('currentStatus') || {}).agents || [];
            for (var j = 0; j < all.length; j++) { if (all[j].id === id) return all[j]; }
            return null;
          });
        },
      };

      var taskType = (task.type || 'waves').toLowerCase();
      var result;
      if (taskType === 'chains' && data.chains && data.chains.length > 0) {
        result = renderChainPipeline(dom.wavePipeline, data.chains, agents, waves, pipelineOptions);
      } else {
        result = renderWavePipeline(dom.wavePipeline, waves, agents, pipelineOptions);
      }

      // Update appState with pipeline render results
      appState.update({
        renderedCardCount: result.renderedCardCount,
        cardElementMap: result.cardElementMap,
      });

      // Only show clear button when task cards are actually rendered on screen
      if (dom.clearDashboardSection) {
        dom.clearDashboardSection.hidden = result.renderedCardCount === 0;
      }

      // --- Timeline panel ---
      var isExpanded = dom.timelinePanel.classList.contains('expanded');
      renderTimelinePanel(data, dom.timelinePanelBody, isExpanded);
    }
  }

  // -------------------------------------------------------------------------
  // handleSingleAgentProgress — in-place card swap optimization
  // -------------------------------------------------------------------------

  function handleSingleAgentProgress(taskId) {
    var currentInit = appState.get('currentInit');
    var currentProgress = appState.get('currentProgress');
    var merged = mergeState(currentInit, currentProgress);
    appState.set('currentStatus', merged);

    var cardElementMap = appState.get('cardElementMap');
    var existingCard = cardElementMap[taskId];
    if (!existingCard || !existingCard.isConnected) {
      renderStatus(merged);
      return;
    }

    // Find the agent in merged data
    var agent = null;
    var agents = merged.agents || [];
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].id === taskId) { agent = agents[i]; break; }
    }
    if (!agent) {
      renderStatus(merged);
      return;
    }

    // Status changed -> full rebuild needed for wave badges, timeline, etc.
    var oldStatus = existingCard.getAttribute('data-status');
    if (oldStatus !== agent.status) {
      renderStatus(merged);
      return;
    }

    // Same status -> just swap the card and update header/stats
    // Import createAgentCard dynamically to avoid circular dependency
    import('../views/AgentCardView.js').then(function (mod) {
      var newCard = mod.createAgentCard(agent, currentProgress[agent.id], {
        onCardClick: function () {
          showAgentDetails(agent, currentProgress, function (id) {
            var all = (appState.get('currentStatus') || {}).agents || [];
            for (var j = 0; j < all.length; j++) { if (all[j].id === id) return all[j]; }
            return null;
          });
        },
      });
      existingCard.replaceWith(newCard);
      cardElementMap[taskId] = newCard;
      appState.set('cardElementMap', cardElementMap);

      // Update header + stats without pipeline rebuild
      renderStatus(merged, true);
    });
  }

  // -------------------------------------------------------------------------
  // Dashboard state derivation
  // -------------------------------------------------------------------------

  function updateDashboardState(dashboardId, data) {
    var dashboardStates = appState.get('dashboardStates');
    // If no task, dashboard is idle
    if (!data.task && (!data.agents || data.agents.length === 0)) {
      dashboardStates[dashboardId] = 'idle';
    } else {
      // Has a task — will be refined by progress data
      var agents = data.agents || [];
      var allDone = agents.length > 0;
      var hasFailed = false;
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].status === 'failed') hasFailed = true;
        if (agents[i].status !== 'completed' && agents[i].status !== 'failed') allDone = false;
      }
      if (allDone && hasFailed) {
        dashboardStates[dashboardId] = 'error';
      } else if (allDone && agents.length > 0) {
        dashboardStates[dashboardId] = 'completed';
      } else if (!dashboardStates[dashboardId] || dashboardStates[dashboardId] === 'idle') {
        dashboardStates[dashboardId] = 'in_progress';
      }
    }
    appState.set('dashboardStates', dashboardStates);
    doRenderSidebar();
  }

  function updateDashboardStateFromProgress(dashboardId, data) {
    var dashboardStates = appState.get('dashboardStates');
    var hasInProgress = false;
    var hasFailed = false;
    var hasAny = false;
    var allDone = true;
    for (var k in data) {
      if (k === 'dashboardId') continue;
      hasAny = true;
      var status = data[k].status;
      if (status === 'in_progress') hasInProgress = true;
      if (status === 'failed') hasFailed = true;
      if (status !== 'completed' && status !== 'failed') allDone = false;
    }
    if (!hasAny) {
      if (!dashboardStates[dashboardId]) dashboardStates[dashboardId] = 'idle';
    } else if (hasInProgress) {
      dashboardStates[dashboardId] = 'in_progress';
    } else if (allDone && hasFailed) {
      dashboardStates[dashboardId] = 'error';
    } else if (allDone) {
      dashboardStates[dashboardId] = 'completed';
    } else {
      dashboardStates[dashboardId] = 'in_progress';
    }
    appState.set('dashboardStates', dashboardStates);
    doRenderSidebar();
  }

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Home view (meta-dashboard)
  // -------------------------------------------------------------------------

  function showHome() {
    if (appState.get('homeViewActive')) return;
    appState.set('homeViewActive', true);

    // Hide normal dashboard UI
    var mainEl = document.querySelector('.dashboard-content > main');
    if (mainEl) mainEl.hidden = true;
    if (dom.timelinePanel) dom.timelinePanel.classList.remove('expanded');
    if (dom.headerCenter) dom.headerCenter.hidden = true;

    // Show home view container
    var homeView = document.getElementById('home-view');
    if (homeView) homeView.hidden = false;

    // Deselect sidebar items
    doRenderSidebar();

    // Seed log panel with aggregated logs from cache (immediate feedback)
    var cachedAggregated = aggregateAllLogs();
    if (cachedAggregated.entries.length > 0) {
      doRenderLogs(cachedAggregated);
    }

    // Fetch overview data
    fetch('/api/overview')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!appState.get('homeViewActive')) return; // user navigated away
        renderHomeView(homeView, data, {
          onDashboardClick: function (dashboardId) {
            exitHome(dashboardId);
          },
          onArchiveClick: function (archiveName) {
            appState.set('homeViewActive', false);
            if (homeView) homeView.hidden = true;
            var mainEl2 = document.querySelector('.dashboard-content > main');
            if (mainEl2) mainEl2.hidden = false;
            if (dom.headerCenter) dom.headerCenter.hidden = false;
            loadArchivedTask(archiveName);
          },
        });

        // If no cached logs yet, seed from overview API recentLogs
        if (cachedAggregated.entries.length === 0 && data.recentLogs && data.recentLogs.length > 0) {
          doRenderLogs({ entries: data.recentLogs });
        }
      })
      .catch(function (err) {
        showErrorPopup('Failed to load overview', err.message || 'Network error');
      });
  }

  function exitHome(dashboardId) {
    appState.set('homeViewActive', false);

    // Hide home view
    var homeView = document.getElementById('home-view');
    if (homeView) homeView.hidden = true;

    // Show normal dashboard UI
    var mainEl = document.querySelector('.dashboard-content > main');
    if (mainEl) mainEl.hidden = false;
    if (dom.headerCenter) dom.headerCenter.hidden = false;

    switchDashboard(dashboardId || appState.get('currentDashboardId'));
  }

  // -------------------------------------------------------------------------
  // Dashboard switching
  // -------------------------------------------------------------------------

  function switchDashboard(id) {
    // If home view is active, exit it first
    if (appState.get('homeViewActive')) {
      exitHome(id);
      return;
    }
    // Clear custom view flag so renderStatus can take over again
    _customViewActive = false;
    if (id === appState.get('currentDashboardId') && !appState.get('archiveViewActive') && !appState.get('queueViewActive')) return;
    appState.update({
      currentDashboardId: id,
      currentInit: null,
      currentProgress: {},
      currentLogs: null,
      currentStatus: null,
      activeLogFilter: 'all',
      seenPermissionCount: 0,
      queueViewActive: false,
    });

    // Reset log filter UI to 'all' on dashboard switch
    var filterBtns = document.querySelectorAll('.log-filter-btn');
    for (var i = 0; i < filterBtns.length; i++) {
      filterBtns[i].classList.remove('active');
      if (filterBtns[i].getAttribute('data-level') === 'all') {
        filterBtns[i].classList.add('active');
      }
    }

    // Show empty state while loading
    renderStatus({ active_task: null, agents: [], waves: [], history: [] });
    doRenderSidebar();

    // SSE is unfiltered — no need to reconnect on dashboard switch.
    // Just fetch the new dashboard data via REST.

    // Fetch the new dashboard data
    fetch('/api/dashboards/' + id + '/initialization')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        appState.set('currentInit', data);
        return fetch('/api/dashboards/' + id + '/progress');
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        appState.set('currentProgress', data || {});
        renderMerged();
      })
      .catch(function (err) {
        showErrorPopup('Failed to load dashboard', err.message || 'Could not fetch initialization or progress data for ' + id);
      });

    fetch('/api/dashboards/' + id + '/logs')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        debouncedRenderLogs(data);
      })
      .catch(function (err) {
        showErrorPopup('Failed to load logs', err.message || 'Could not fetch log data for ' + id);
      });
  }

  function loadArchivedTask(archiveName) {
    // Reset custom view state so renderStatus can run
    _customViewActive = false;
    // Ensure main content area is visible
    var mainEl = document.querySelector('.dashboard-content > main');
    if (mainEl) mainEl.hidden = false;
    if (dom.headerCenter) dom.headerCenter.hidden = false;

    appState.update({
      priorDashboardId: appState.get('currentDashboardId'),
      archiveViewActive: true,
      currentInit: null,
      currentProgress: {},
      currentLogs: null,
      currentStatus: null,
    });

    renderStatus({ active_task: null, agents: [], waves: [], history: [] });
    doRenderSidebar();

    fetch('/api/archives/' + encodeURIComponent(archiveName))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        appState.update({
          currentInit: data.initialization || null,
          currentProgress: data.progress || {},
        });
        renderMerged();
        if (data.logs) debouncedRenderLogs(data.logs);
      })
      .catch(function (err) {
        showErrorPopup('Failed to load archive', err.message || 'Network error');
        exitArchiveView();
      });
  }

  function exitArchiveView() {
    appState.set('archiveViewActive', false);
    var restoreTo = appState.get('priorDashboardId') || 'dashboard1';
    appState.set('priorDashboardId', null);
    switchDashboard(restoreTo);
  }

  // -------------------------------------------------------------------------
  // Queue view — display a queued task on the dashboard
  // -------------------------------------------------------------------------

  function loadQueuedTask(queueId) {
    appState.update({
      priorDashboardId: appState.get('currentDashboardId'),
      queueViewActive: true,
      archiveViewActive: false,
      currentInit: null,
      currentProgress: {},
      currentLogs: null,
      currentStatus: null,
    });

    renderStatus({ active_task: null, agents: [], waves: [], history: [] });
    doRenderSidebar();

    // Collapse the queue popup when viewing a task
    closeQueuePopup(document.getElementById('queue-popup-container'));

    fetch('/api/queue/' + encodeURIComponent(queueId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        appState.update({
          currentInit: data.initialization || null,
          currentProgress: data.progress || {},
        });
        renderMerged();
        if (data.logs) debouncedRenderLogs(data.logs);
      })
      .catch(function (err) {
        showErrorPopup('Failed to load queued task', err.message || 'Network error');
        exitQueueView();
      });
  }

  function exitQueueView() {
    appState.set('queueViewActive', false);
    var restoreTo = appState.get('priorDashboardId') || 'dashboard1';
    appState.set('priorDashboardId', null);
    switchDashboard(restoreTo);
  }

  function doRenderQueuePopup() {
    var containerEl = document.getElementById('queue-popup-container');
    var queueItems = appState.get('queueItems') || [];
    renderQueuePopup(containerEl, queueItems, {
      onTaskClick: function (queueId) {
        loadQueuedTask(queueId);
      },
    });
  }

  function clearCurrentDashboard() {
    if (appState.get('archiveViewActive')) return;
    var dashId = appState.get('currentDashboardId');
    fetch('/api/dashboards/' + dashId + '/clear', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          appState.update({
            currentInit: null,
            currentProgress: {},
            currentLogs: null,
            currentStatus: null,
          });
          var dashboardStates = appState.get('dashboardStates');
          dashboardStates[dashId] = 'idle';
          appState.set('dashboardStates', dashboardStates);
          doRenderSidebar();
          renderStatus({ active_task: null, agents: [], waves: [], history: [] });

          fetch('/api/dashboards/' + dashId + '/initialization')
            .then(function (r) { return r.json(); })
            .then(function (initData) {
              appState.set('currentInit', initData);
              renderMerged();
            })
            .catch(function (err) {
              showErrorPopup('Failed to reload dashboard', err.message || 'Could not fetch initialization data after clearing ' + dashId);
            });
        }
      })
      .catch(function (err) {
        showErrorPopup('Failed to clear dashboard', err.message || 'Could not clear dashboard ' + dashId);
      });
  }

  function archiveCurrentTask() {
    if (appState.get('archiveViewActive')) return;
    var dashId = appState.get('currentDashboardId');
    fetch('/api/dashboards/' + dashId + '/archive', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          switchDashboard(dashId);
        }
      })
      .catch(function (err) {
        showErrorPopup('Failed to archive task', err.message || 'Could not archive the current dashboard');
      });
  }

  function exportSwarmData() {
    var dashId = appState.get('currentDashboardId');
    fetch('/api/dashboards/' + dashId + '/export')
      .then(function (r) {
        if (!r.ok) throw new Error('Server returned ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var taskName = (data.summary && data.summary.task_name) ? data.summary.task_name : 'export';
        var dateStr = new Date().toISOString().slice(0, 10);
        var safeName = taskName.replace(/[^a-zA-Z0-9_-]/g, '_');
        var filename = safeName + '_' + dateStr + '.json';

        var jsonStr = JSON.stringify(data, null, 2);
        var blob = new Blob([jsonStr], { type: 'application/json' });
        var url = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(function (err) {
        showErrorPopup('Failed to export swarm data', err.message || 'Could not export dashboard data');
      });
  }

  function showArchiveList() {
    fetch('/api/archives')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var archives = data.archives || [];
        showArchivePopup(archives, function (archiveName) {
          loadArchivedTask(archiveName);
        });
      })
      .catch(function (err) {
        showErrorPopup('Failed to load archives', err.message || 'Network error');
      });
  }

  function showHistoryList() {
    fetch('/api/history')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var history = data.history || [];
        showHistoryPopup(history);
      })
      .catch(function (err) {
        showErrorPopup('Failed to load history', err.message || 'Network error');
      });
  }

  function showSettings() {
    var currentTheme = localStorage.getItem('synapse-theme') || '';
    showSettingsPopup(currentTheme, function (dataThemeValue) {
      // Clear any inline custom vars first
      clearCustomTheme();

      // Apply custom inline vars if switching to custom theme
      if (dataThemeValue === 'custom') {
        try {
          var customColors = JSON.parse(localStorage.getItem('synapse-custom-colors'));
          if (customColors && customColors.bg) applyCustomTheme(customColors);
        } catch (e) { /* ignore */ }
      }

      // Apply theme to document
      if (dataThemeValue) {
        document.documentElement.setAttribute('data-theme', dataThemeValue);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      localStorage.setItem('synapse-theme', dataThemeValue);

      // Re-read CSS variables into JS status color constants
      initStatusColorsFromCSS();

      // Re-render current view so colors update
      var currentStatus = appState.get('currentStatus');
      if (currentStatus && currentStatus.active_task) {
        renderStatus(currentStatus);
      }
    });
  }

  function showClearConfirm() {
    if (appState.get('archiveViewActive')) return;
    showConfirmModal(
      'Clear Dashboard',
      'This will save a history summary and then clear all task data from this dashboard. This action cannot be undone.',
      function () {
        hideConfirmModal();
        clearCurrentDashboard();
      }
    );
  }

  // -------------------------------------------------------------------------
  // Log rendering helper
  // -------------------------------------------------------------------------

  function doRenderLogs(data) {
    appState.set('currentLogs', data);
    var activeFilter = appState.get('activeLogFilter');
    var seenCount = appState.get('seenPermissionCount');
    var newSeenCount = renderLogs(data, dom, activeFilter, seenCount);

    if (newSeenCount > seenCount) {
      appState.set('seenPermissionCount', newSeenCount);
      // Show permission popup for the latest permission entry
      var entries = (data && data.entries) || [];
      var permEntries = entries.filter(function (e) { return e.level === 'permission'; });
      if (permEntries.length > 0) {
        var latest = permEntries[permEntries.length - 1];
        showPermissionPopup(latest.message, latest.agent);
        playPermissionSound();
        sendBrowserNotification(latest.message, latest.agent);
        if (document.hidden) {
          startTitleFlash();
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Permission alert helpers (audio, browser notification, title flash)
  // -------------------------------------------------------------------------

  var _originalTitle = document.title;
  var _titleFlashInterval = null;

  function playPermissionSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc1 = ctx.createOscillator();
      var gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = 880;
      gain1.gain.setValueAtTime(0.3, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.15);

      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 1320;
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.3);

      var osc3 = ctx.createOscillator();
      var gain3 = ctx.createGain();
      osc3.type = 'sine';
      osc3.frequency.value = 1760;
      gain3.gain.setValueAtTime(0.25, ctx.currentTime + 0.25);
      gain3.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(ctx.currentTime + 0.25);
      osc3.stop(ctx.currentTime + 0.5);

      setTimeout(function () { ctx.close(); }, 600);
    } catch (_) {
      // Web Audio not available — silent fallback
    }
  }

  function sendBrowserNotification(message, agent) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    var title = 'Agent Requesting Permission';
    var body = message || 'An agent needs your input \u2014 check your terminal.';
    if (agent) body = agent + ': ' + body;

    var notif = new Notification(title, {
      body: body,
      icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%23f59e0b"/><text x="50" y="68" text-anchor="middle" font-size="55" fill="%23000">\u26A0</text></svg>'),
      tag: 'agent-permission',
      requireInteraction: true,
    });

    notif.onclick = function () {
      window.focus();
      notif.close();
    };
  }

  function startTitleFlash() {
    stopTitleFlash();
    var showWarning = true;
    _titleFlashInterval = setInterval(function () {
      document.title = showWarning ? '\u26A0 PERMISSION NEEDED' : _originalTitle;
      showWarning = !showWarning;
    }, 800);
    window.addEventListener('focus', stopTitleFlash, { once: true });
  }

  function stopTitleFlash() {
    if (_titleFlashInterval !== null) {
      clearInterval(_titleFlashInterval);
      _titleFlashInterval = null;
    }
    document.title = _originalTitle;
  }

  // -------------------------------------------------------------------------
  // Sidebar rendering
  // -------------------------------------------------------------------------

  function doRenderSidebar() {
    var listEl = document.getElementById('dashboard-list');
    var homeActive = appState.get('homeViewActive');
    var queueItems = appState.get('queueItems') || [];
    renderSidebar(listEl, {
      currentDashboardId: homeActive ? null : appState.get('currentDashboardId'),
      archiveViewActive: appState.get('archiveViewActive'),
      queueViewActive: appState.get('queueViewActive'),
      dashboardStates: appState.get('dashboardStates'),
      dashboardProjects: getAllDashboardProjects(),
      isElectron: !!window.electronAPI,
      queueCount: queueItems.length,
      onSwitch: function (id) {
        if (appState.get('homeViewActive')) {
          exitHome(id);
          return;
        }
        if (appState.get('archiveViewActive')) exitArchiveView();
        if (appState.get('queueViewActive')) exitQueueView();
        switchDashboard(id);
      },
      onExitArchive: function () {
        exitArchiveView();
      },
      onExitQueue: function () {
        exitQueueView();
      },
      onProjectClick: function (dashboardId) {
        showProjectConfigForDashboard(dashboardId);
      },
      onClaudeClick: function (dashboardId) {
        showClaudeChatForDashboard(dashboardId);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Elapsed timer — updates every 1s
  // -------------------------------------------------------------------------

  function startElapsedTimer() {
    setInterval(function () {
      // --- Last-updated staleness indicator ---
      var lastSSEEventTime = appState.get('lastSSEEventTime');
      if (dom.logLastUpdated && lastSSEEventTime > 0) {
        var d = new Date(lastSSEEventTime);
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        var ss = String(d.getSeconds()).padStart(2, '0');
        var secSinceUpdate = (Date.now() - lastSSEEventTime) / 1000;
        var currentStatus = appState.get('currentStatus');
        var hasInProgress = currentStatus && currentStatus.agents &&
          currentStatus.agents.some(function (a) { return a.status === 'in_progress'; });
        var staleLabel = (secSinceUpdate > 30 && hasInProgress) ? ' (stale)' : '';
        dom.logLastUpdated.textContent = 'Last update: ' + hh + ':' + mm + ':' + ss + staleLabel;
        if (staleLabel) {
          dom.logLastUpdated.classList.add('stale');
        } else {
          dom.logLastUpdated.classList.remove('stale');
        }
      }

      var currentStatus = appState.get('currentStatus');
      if (!currentStatus || !currentStatus.active_task) return;

      var task = currentStatus.active_task;
      var agents = currentStatus.agents || [];

      // Determine if the task is fully settled
      var inProgressCount = agents.filter(function (a) {
        return a.status === 'in_progress';
      }).length;
      var allDone = task.total_tasks > 0 &&
        (task.completed_tasks || 0) + (task.failed_tasks || 0) >= task.total_tasks &&
        inProgressCount === 0;

      // Main elapsed stat — only tick while in progress
      var elapsedStart = task.started_at || task.created;
      if (!allDone && elapsedStart) {
        dom.statElapsed.textContent = formatElapsed(elapsedStart);
      }

      if (inProgressCount === 0) return;

      // Re-query elapsed elements only when the DOM has been rebuilt (generation changed)
      var renderGeneration = appState.get('renderGeneration');
      if (elapsedCache.generation !== renderGeneration) {
        elapsedCache.elements = document.querySelectorAll('.agent-elapsed[data-started]');
        elapsedCache.generation = renderGeneration;
      }

      // Update in-progress agent card elapsed times
      var elapsedEls = elapsedCache.elements;
      for (var i = 0; i < elapsedEls.length; i++) {
        var started = elapsedEls[i].getAttribute('data-started');
        if (started) {
          elapsedEls[i].textContent = formatElapsed(started);
        }
      }
    }, 1000);
  }

  // -------------------------------------------------------------------------
  // Pipeline redraw on resize
  // -------------------------------------------------------------------------

  var pipelineResizeTimer = null;

  function debouncedPipelineRedraw() {
    if (pipelineResizeTimer) clearTimeout(pipelineResizeTimer);
    pipelineResizeTimer = setTimeout(function () {
      var currentStatus = appState.get('currentStatus');
      if (currentStatus && currentStatus.active_task) {
        var type = (currentStatus.active_task.type || 'waves').toLowerCase();
        var activeStatFilter = appState.get('activeStatFilter');
        var currentProgress = appState.get('currentProgress');
        var pipelineOptions = {
          activeStatFilter: activeStatFilter,
          progressData: currentProgress,
          onCardClick: function (agent) {
            var cp = appState.get('currentProgress');
            showAgentDetails(agent, cp, function (id) {
              var all = (appState.get('currentStatus') || {}).agents || [];
              for (var j = 0; j < all.length; j++) { if (all[j].id === id) return all[j]; }
              return null;
            });
          },
        };
        if (type === 'chains' && currentStatus.chains && currentStatus.chains.length > 0) {
          renderChainPipeline(dom.wavePipeline, currentStatus.chains, currentStatus.agents || [], currentStatus.waves || [], pipelineOptions);
        } else {
          renderWavePipeline(dom.wavePipeline, currentStatus.waves || [], currentStatus.agents || [], pipelineOptions);
        }
      }
    }, 200);
  }

  // -------------------------------------------------------------------------
  // SSE event handlers — registered with the SSEClient
  // -------------------------------------------------------------------------

  function onInitialization(dashboardId, data) {
    // Track dashboard state for sidebar dots (before filtering)
    updateDashboardState(dashboardId, data);
    if (appState.get('archiveViewActive') || appState.get('queueViewActive')) return;
    // Filter by active dashboard
    if (dashboardId && dashboardId !== appState.get('currentDashboardId')) return;
    appState.set('currentInit', data);
    debouncedRenderMerged();
  }

  function onLogs(dashboardId, data) {
    if (appState.get('archiveViewActive') || appState.get('queueViewActive')) return;

    // Always cache logs per-dashboard for home view aggregation
    if (dashboardId && data) {
      _allDashboardLogs[dashboardId] = data;
    }

    // If home view is active, aggregate all dashboard logs and render
    if (appState.get('homeViewActive')) {
      var aggregated = aggregateAllLogs();
      debouncedRenderLogs(aggregated);
      return;
    }

    if (dashboardId && dashboardId !== appState.get('currentDashboardId')) return;
    // Permission checks bypass debounce — fire immediately
    var entries = (data && data.entries) || [];
    var seenCount = appState.get('seenPermissionCount');
    var permEntries = entries.filter(function (e) { return e.level === 'permission'; });
    if (permEntries.length < seenCount) seenCount = 0;
    if (permEntries.length > seenCount) {
      appState.set('seenPermissionCount', permEntries.length);
      var latest = permEntries[permEntries.length - 1];
      showPermissionPopup(latest.message, latest.agent);
      playPermissionSound();
      sendBrowserNotification(latest.message, latest.agent);
      if (document.hidden) startTitleFlash();
    }
    debouncedRenderLogs(data);
  }

  /**
   * Aggregate logs from all cached dashboards into a single logs payload,
   * sorted newest-first, capped at 100 entries.
   */
  function aggregateAllLogs() {
    var allEntries = [];
    for (var dbId in _allDashboardLogs) {
      var logData = _allDashboardLogs[dbId];
      var entries = (logData && logData.entries) || [];
      for (var i = 0; i < entries.length; i++) {
        allEntries.push(entries[i]);
      }
    }
    allEntries.sort(function (a, b) {
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });
    return { entries: allEntries.slice(0, 100) };
  }

  function onAgentProgress(dashboardId, data) {
    // Track sidebar state for ALL dashboards, not just the active one
    if (dashboardId && data && data.task_id && data.status) {
      // Update the per-dashboard progress cache for sidebar derivation
      if (!_allDashboardProgress[dashboardId]) _allDashboardProgress[dashboardId] = {};
      _allDashboardProgress[dashboardId][data.task_id] = data;

      // Re-derive this dashboard's sidebar state from its full progress cache
      var dbProgress = _allDashboardProgress[dashboardId];
      var hasInProgress = false;
      var hasFailed = false;
      var allDone = true;
      var hasAny = false;
      for (var k in dbProgress) {
        hasAny = true;
        var st = dbProgress[k].status;
        if (st === 'in_progress') hasInProgress = true;
        if (st === 'failed') hasFailed = true;
        if (st !== 'completed' && st !== 'failed') allDone = false;
      }
      var dashboardStates = appState.get('dashboardStates');
      var prevState = dashboardStates[dashboardId];
      if (!hasAny) {
        // keep existing state
      } else if (hasInProgress) {
        dashboardStates[dashboardId] = 'in_progress';
      } else if (allDone && hasFailed) {
        dashboardStates[dashboardId] = 'error';
      } else if (allDone) {
        // Only mark completed if we know total_tasks is met
        // (we may not have full count, but if all progress files are terminal, it's likely done)
        dashboardStates[dashboardId] = 'completed';
      } else {
        dashboardStates[dashboardId] = 'in_progress';
      }
      if (dashboardStates[dashboardId] !== prevState) {
        appState.set('dashboardStates', dashboardStates);
        doRenderSidebar();

        // Auto-save history when a dashboard transitions to a terminal state
        var newState = dashboardStates[dashboardId];
        if ((newState === 'completed' || newState === 'error') &&
            prevState !== 'completed' && prevState !== 'error') {
          var saveKey = dashboardId + '::auto';
          if (!_historySavedFor[saveKey]) {
            _historySavedFor[saveKey] = true;
            fetch('/api/dashboards/' + dashboardId + '/save-history', { method: 'POST' })
              .catch(function () { /* non-critical */ });
          }
        }
      }
    }
    if (appState.get('archiveViewActive') || appState.get('queueViewActive')) return;
    if (dashboardId && dashboardId !== appState.get('currentDashboardId')) return;
    if (data && data.task_id) {
      var currentProgress = appState.get('currentProgress');
      currentProgress[data.task_id] = data;
      appState.set('currentProgress', currentProgress);
      handleSingleAgentProgress(data.task_id);
    }
  }

  function onAllProgress(dashboardId, data) {
    // Seed the per-dashboard progress cache for sidebar dot derivation
    if (dashboardId) {
      if (!_allDashboardProgress[dashboardId]) _allDashboardProgress[dashboardId] = {};
      for (var pk in data) {
        if (pk !== 'dashboardId' && data[pk] && data[pk].task_id) {
          _allDashboardProgress[dashboardId][data[pk].task_id] = data[pk];
        }
      }
      updateDashboardStateFromProgress(dashboardId, data);
    }
    if (appState.get('archiveViewActive') || appState.get('queueViewActive')) return;
    if (dashboardId && dashboardId !== appState.get('currentDashboardId')) return;
    // The payload is { dashboardId, ...progressMap }
    var progressData = {};
    for (var k in data) {
      if (k !== 'dashboardId') progressData[k] = data[k];
    }
    appState.set('currentProgress', progressData);
    debouncedRenderMerged();
  }

  function onDashboardsList(dashboards) {
    appState.set('dashboardList', dashboards);
  }

  function onDashboardsChanged(dashboards) {
    appState.set('dashboardList', dashboards);
  }

  function onQueueChanged(queueItems) {
    appState.set('queueItems', queueItems || []);
    doRenderQueuePopup();
    doRenderSidebar();
  }

  function onReload() {
    location.reload();
  }

  // -------------------------------------------------------------------------
  // Swarm Builder / Orchestration
  // -------------------------------------------------------------------------

  function showSwarmBuilder(initData) {
    var container = dom.wavePipeline;
    if (!container) return;

    _customViewActive = true;

    // Hide other sections, but ensure wave section is visible (it holds the container)
    if (dom.statsBar) dom.statsBar.hidden = true;
    if (dom.logPanel) dom.logPanel.hidden = true;
    if (dom.emptyState) dom.emptyState.hidden = true;
    if (dom.progressSection) dom.progressSection.hidden = true;
    if (dom.clearDashboardSection) dom.clearDashboardSection.hidden = true;
    if (dom.waveSection) dom.waveSection.hidden = false;

    renderSwarmBuilder({
      container: container,
      dashboardId: appState.get('currentDashboardId'),
      initData: initData || null,
      onLaunch: function (plan) {
        var dashboardId = appState.get('currentDashboardId');
        var api = window.electronAPI;
        if (!api) return;

        // Write the plan to the dashboard — sequential chain with error handling
        api.createSwarm(dashboardId, {
          name: plan.task.name,
          type: plan.task.type,
          directory: plan.task.directory,
          project: plan.task.project,
          prompt: plan.task.prompt,
        }).then(function () {
          // Add each task sequentially — must all complete before switching
          var chain = Promise.resolve();
          for (var i = 0; i < plan.agents.length; i++) {
            (function (agent) {
              chain = chain.then(function () {
                return api.addTask(dashboardId, agent);
              });
            })(plan.agents[i]);
          }
          return chain;
        }).then(function () {
          // All tasks written — now safe to reload dashboard
          return new Promise(function (resolve) {
            switchDashboard(dashboardId);
            // Give the dashboard a tick to render the new data
            setTimeout(resolve, 200);
          });
        }).then(function () {
          // Ask to launch
          showConfirmModal(
            'Launch Swarm?',
            'Plan written to dashboard. Start dispatching worker agents now?',
            function () {
              hideConfirmModal();
              launchSwarm();
            }
          );
        }).catch(function (err) {
          console.error('[SwarmBuilder] Launch failed:', err);
          showErrorPopup('Failed to create swarm: ' + (err.message || String(err)));
        });
      },
      onCancel: function () {
        _customViewActive = false;
        // Restore normal view
        if (dom.statsBar) dom.statsBar.hidden = false;
        if (dom.emptyState) dom.emptyState.hidden = false;
        switchDashboard(appState.get('currentDashboardId'));
      },
    });
  }

  function showProjectConfig() {
    showProjectConfigForDashboard(appState.get('currentDashboardId'));
  }

  function showProjectConfigForDashboard(dashboardId) {
    showProjectModal({
      dashboardId: dashboardId,
      onProjectSelected: function (project) {
        // Project selected — re-render sidebar to update project indicator
        doRenderSidebar();
      },
    });
  }

  function showAIPlanner() {
    var api = window.electronAPI;
    if (!api) return;

    var dashboardId = appState.get('currentDashboardId');
    var perDashboardPath = getDashboardProject(dashboardId);

    api.getSettings().then(function (settings) {
      showPlanningModal({
        dashboardId: dashboardId,
        projectPath: perDashboardPath || settings.activeProjectPath || null,
        onPlanReady: function (plan) {
          showSwarmBuilder(plan);
        },
      });
    });
  }

  function launchSwarm() {
    var api = window.electronAPI;
    if (!api) return;

    var dashboardId = appState.get('currentDashboardId');
    var perDashboardPath = getDashboardProject(dashboardId);

    api.getSettings().then(function (settings) {
      return api.startSwarm(dashboardId, {
        projectPath: perDashboardPath || settings.activeProjectPath || '.',
        model: settings.defaultModel || 'sonnet',
        cliPath: settings.claudeCliPath || null,
        dangerouslySkipPermissions: settings.dangerouslySkipPermissions || false,
      });
    }).then(function (result) {
      if (!result.success) {
        showErrorPopup('Failed to launch swarm', result.error);
      }
    });
  }

  function pauseSwarm() {
    var api = window.electronAPI;
    if (!api) return;
    api.pauseSwarm(appState.get('currentDashboardId'));
  }

  function resumeSwarm() {
    var api = window.electronAPI;
    if (!api) return;
    api.resumeSwarm(appState.get('currentDashboardId'));
  }

  function cancelSwarm() {
    var api = window.electronAPI;
    if (!api) return;
    showConfirmModal(
      'Cancel Swarm?',
      'This will kill all running worker agents. Tasks in progress will be marked as failed.',
      function () {
        hideConfirmModal();
        api.cancelSwarm(appState.get('currentDashboardId'));
      }
    );
  }

  function retryFailedTask(taskId) {
    var api = window.electronAPI;
    if (!api) return;
    api.retryTask(appState.get('currentDashboardId'), taskId);
  }

  function showWorkerOutput(taskId, title) {
    showWorkerTerminal({ taskId: taskId, title: title });
  }

  // Track active Claude view controller for cleanup
  var claudeViewController = null;

  function showClaudeChat() {
    showClaudeChatForDashboard(appState.get('currentDashboardId'));
  }

  function showClaudeChatForDashboard(dashboardId) {
    // If there's already a Claude view open, destroy it first
    if (claudeViewController) {
      claudeViewController.destroy();
      claudeViewController = null;
    }

    // Also switch to this dashboard in the sidebar
    var currentId = appState.get('currentDashboardId');
    if (currentId !== dashboardId) {
      if (appState.get('archiveViewActive')) exitArchiveView();
      if (appState.get('queueViewActive')) exitQueueView();
      if (appState.get('homeViewActive')) exitHome(dashboardId);
      switchDashboard(dashboardId);
    }

    // Claude view is now a floating panel — no need to hide dashboard sections
    claudeViewController = renderClaudeView({
      dashboardId: dashboardId,
      onClose: function () {
        if (claudeViewController) {
          claudeViewController.destroy();
          claudeViewController = null;
        }
      },
      onNewSwarm: function () { showSwarmBuilder(); },
      onAIPlan: function () { showAIPlanner(); },
      onLaunch: function () { launchSwarm(); },
      onPause: function () { pauseSwarm(); },
      onCancel: function () { cancelSwarm(); },
    });
  }

  function showCommands() {
    var api = window.electronAPI;
    if (!api) return;

    var dashboardId = appState.get('currentDashboardId');
    var perDashboardPath = getDashboardProject(dashboardId);

    api.getSettings().then(function (settings) {
      showCommandsModal({
        projectDir: perDashboardPath || settings.activeProjectPath || null,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Public interface
  // -------------------------------------------------------------------------

  return {
    // Render methods
    renderMerged: renderMerged,
    debouncedRenderMerged: debouncedRenderMerged,
    renderStatus: renderStatus,
    doRenderSidebar: doRenderSidebar,
    doRenderLogs: doRenderLogs,
    debouncedRenderLogs: debouncedRenderLogs,

    // Action handlers
    showHome: showHome,
    switchDashboard: switchDashboard,
    loadArchivedTask: loadArchivedTask,
    exitArchiveView: exitArchiveView,
    loadQueuedTask: loadQueuedTask,
    exitQueueView: exitQueueView,
    doRenderQueuePopup: doRenderQueuePopup,
    clearCurrentDashboard: clearCurrentDashboard,
    showClearConfirm: showClearConfirm,
    archiveCurrentTask: archiveCurrentTask,
    exportSwarmData: exportSwarmData,
    showArchiveList: showArchiveList,
    showHistoryList: showHistoryList,
    showSettings: showSettings,

    // Swarm orchestration
    showSwarmBuilder: showSwarmBuilder,
    showProjectConfig: showProjectConfig,
    showProjectConfigForDashboard: showProjectConfigForDashboard,
    showAIPlanner: showAIPlanner,
    launchSwarm: launchSwarm,
    pauseSwarm: pauseSwarm,
    resumeSwarm: resumeSwarm,
    cancelSwarm: cancelSwarm,
    retryFailedTask: retryFailedTask,
    showWorkerOutput: showWorkerOutput,
    showClaudeChat: showClaudeChat,
    showClaudeChatForDashboard: showClaudeChatForDashboard,
    showCommands: showCommands,

    // Timer
    startElapsedTimer: startElapsedTimer,

    // Pipeline resize
    debouncedPipelineRedraw: debouncedPipelineRedraw,

    // SSE event handlers (used by app.js to wire up SSEClient callbacks)
    sseHandlers: {
      onInitialization: onInitialization,
      onLogs: onLogs,
      onAgentProgress: onAgentProgress,
      onAllProgress: onAllProgress,
      onDashboardsList: onDashboardsList,
      onDashboardsChanged: onDashboardsChanged,
      onQueueChanged: onQueueChanged,
      onReload: onReload,
    },
  };
}
