// useDashboardData — Connects to IPC/SSE push events and merges init + progress
// Replaces IPCClient.js + SSEClient.js + the mergeState logic from DashboardVM.

import { useEffect, useCallback, useRef } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';

/**
 * Merge static plan data (init) with dynamic progress data into a renderable status.
 */
export function mergeState(init, progress, logs) {
  if (!init || !init.task) {
    return { active_task: null, agents: [], waves: [], chains: [], history: [] };
  }
  const task = { ...init.task };
  const agents = (init.agents || []).map(agentDef => {
    const prog = progress[agentDef.id];
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
      stage: prog ? prog.stage : null,
      message: prog ? prog.message : null,
      milestones: prog ? prog.milestones : [],
      deviations: prog ? prog.deviations : [],
      logs: prog ? prog.logs : [],
      files_changed: prog ? prog.files_changed : [],
    };
  });

  let completed = 0, failed = 0, inProgress = 0;
  agents.forEach(a => {
    if (a.status === 'completed') completed++;
    else if (a.status === 'failed') failed++;
    else if (a.status === 'in_progress') inProgress++;
  });
  task.completed_tasks = completed;
  task.failed_tasks = failed;
  task.total_tasks = task.total_tasks || agents.length;

  const startTimes = agents.filter(a => a.started_at).map(a => new Date(a.started_at).getTime());
  if (startTimes.length > 0) task.started_at = new Date(Math.min(...startTimes)).toISOString();

  const allDone = agents.length > 0 && agents.every(a => a.status === 'completed' || a.status === 'failed');
  if (allDone) {
    const endTimes = agents.filter(a => a.completed_at).map(a => new Date(a.completed_at).getTime());
    if (endTimes.length > 0) task.completed_at = new Date(Math.max(...endTimes)).toISOString();
    task.overall_status = failed > 0 ? 'completed_with_errors' : 'completed';
  } else if (inProgress > 0 || completed > 0) {
    task.overall_status = 'in_progress';
  } else {
    task.overall_status = task.overall_status || 'pending';
  }

  // Check for replanning state from circuit breaker
  if (task.overall_status === 'in_progress' && logs && logs.entries) {
    const hasCircuitBreaker = logs.entries.some(e =>
      e.level === 'warn' && e.message && e.message.includes('Circuit breaker triggered')
    );
    if (hasCircuitBreaker) {
      // Check if replanning has completed (look for "Replanning complete" info entry AFTER the circuit breaker entry)
      const cbIndex = logs.entries.findLastIndex(e =>
        e.level === 'warn' && e.message && e.message.includes('Circuit breaker triggered')
      );
      const resumedAfter = logs.entries.slice(cbIndex + 1).some(e =>
        e.level === 'info' && e.message && e.message.includes('Replanning complete')
      );
      if (!resumedAfter) {
        task.overall_status = 'replanning';
      }
    }
  }

  const waves = (init.waves || []).map(waveDef => {
    const waveAgents = agents.filter(a => a.wave === waveDef.id);
    const waveCompleted = waveAgents.filter(a => a.status === 'completed').length;
    const anyActive = waveAgents.some(a => ['in_progress','completed','failed'].includes(a.status));
    return {
      id: waveDef.id, name: waveDef.name,
      total: waveDef.total || waveAgents.length,
      completed: waveCompleted,
      status: (waveCompleted === waveAgents.length && waveAgents.length > 0)
        ? 'completed' : anyActive ? 'in_progress' : 'pending',
    };
  });

  return { active_task: task, agents, waves, chains: init.chains || [], history: init.history || [] };
}

/**
 * Hook: connect to Electron IPC push events and dispatch state updates.
 * Must be called once at the App level.
 */
export function useDashboardData() {
  const state = useAppState();
  const dispatch = useDispatch();
  const listenersRef = useRef([]);
  const progressRef = useRef({});
  const initRef = useRef({});

  // Track current dashboard ID via ref to avoid stale closures in IPC push listeners
  const currentDashboardIdRef = useRef(state.currentDashboardId);
  useEffect(() => {
    currentDashboardIdRef.current = state.currentDashboardId;
  }, [state.currentDashboardId]);

  // Derive dashboard status from init + progress for sidebar dots
  const deriveDashboardStatus = useCallback((init, progress) => {
    const hasTask = init && init.task && init.task.name;
    if (!hasTask) return 'idle';
    const vals = Object.values(progress);
    if (vals.length === 0) return 'in_progress';
    let allDone = true, hasFailed = false, hasInProgress = false;
    vals.forEach(p => {
      if (p.status === 'failed') hasFailed = true;
      if (p.status === 'in_progress') hasInProgress = true;
      if (p.status !== 'completed' && p.status !== 'failed') allDone = false;
    });
    const totalTasks = (init.task && init.task.total_tasks) || 0;
    if (totalTasks > 0 && vals.length < totalTasks) allDone = false;
    if (allDone && hasFailed) return 'error';
    if (allDone) return 'completed';
    // Tasks exist but none actively running — show static (non-pulsing) indicator
    if (vals.length > 0 && !hasInProgress) return 'waiting';
    if (vals.length > 0) return 'in_progress';
    return 'idle';
  }, []);

  // Fetch all data for a dashboard via IPC pull (used on mount + dashboard switch)
  const fetchDashboardData = useCallback(async (id) => {
    const api = window.electronAPI;
    if (!api) return;

    try {
      const init = await api.getDashboardInit(id);
      if (init) {
        initRef.current[id] = init;
        dispatch({ type: 'SET_INIT', data: init });
      }
    } catch (_) {}

    try {
      const progress = await api.getDashboardProgress(id);
      if (progress) {
        // Merge with existing cached progress to avoid overwriting more recent
        // push-event updates that arrived while this pull was in flight.
        const existing = progressRef.current[id] || {};
        const merged = { ...progress };
        for (const [taskId, existingEntry] of Object.entries(existing)) {
          const incoming = merged[taskId];
          if (!incoming) {
            merged[taskId] = existingEntry;
          } else if (existingEntry.status === 'in_progress' && incoming.status === 'pending') {
            merged[taskId] = existingEntry;
          } else if (existingEntry.status === 'completed' && incoming.status !== 'completed') {
            merged[taskId] = existingEntry;
          } else if (existingEntry.status === 'failed' && incoming.status === 'pending') {
            merged[taskId] = existingEntry;
          }
        }
        progressRef.current[id] = merged;
        dispatch({ type: 'SET_PROGRESS', data: merged });
      }
    } catch (_) {}

    try {
      const logs = await api.getDashboardLogs(id);
      if (logs) dispatch({ type: 'SET_LOGS', data: logs });
    } catch (_) {}
  }, [dispatch]);

  // Fetch data whenever the active dashboard changes (covers initial mount + all switches)
  useEffect(() => {
    fetchDashboardData(state.currentDashboardId);
  }, [state.currentDashboardId, fetchDashboardData]);

  // Eagerly fetch the dashboard list + statuses on mount (don't rely on push event timing)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.getDashboards().then(result => {
      if (result && result.dashboards) {
        dispatch({ type: 'SET_DASHBOARDS_LIST', value: result.dashboards, names: result.names });
      }
    }).catch(() => {});
    api.getDashboardMeta().then(meta => {
      if (meta && meta.names) {
        dispatch({ type: 'SET_DASHBOARD_NAMES', names: meta.names });
      }
    }).catch(() => {});
    api.getDashboardStatuses().then(result => {
      if (result && result.statuses) {
        Object.entries(result.statuses).forEach(([id, status]) => {
          dispatch({ type: 'SET_DASHBOARD_STATE', id, status });
        });
      }
    }).catch(() => {});
  }, [dispatch]);

  // Set up IPC push listeners once on mount
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const addListener = (channel, handler) => {
      const handle = api.on(channel, handler);
      listenersRef.current.push({ channel, handle });
    };

    addListener('initialization', (data) => {
      if (!data.dashboardId) return;
      const { dashboardId, ...initData } = data;
      initRef.current[dashboardId] = initData;
      // Use ref (not stale state) to compare against current dashboard
      if (dashboardId === currentDashboardIdRef.current) {
        dispatch({ type: 'SET_INIT', data: initData });
      }
      // Recompute sidebar status
      const prog = progressRef.current[dashboardId] || {};
      const newStatus = deriveDashboardStatus(initData, prog);
      dispatch({ type: 'SET_DASHBOARD_STATE', id: dashboardId, status: newStatus });
    });

    addListener('logs', (data) => {
      if (!data.dashboardId) return;
      dispatch({ type: 'SET_DASHBOARD_LOGS', dashboardId: data.dashboardId, logs: data });
      if (data.dashboardId === currentDashboardIdRef.current) {
        dispatch({ type: 'SET_LOGS', data });
      }
    });

    addListener('agent_progress', (data) => {
      if (!data.dashboardId || !data.task_id) return;
      // Update per-dashboard progress cache
      const dbProgress = { ...(progressRef.current[data.dashboardId] || {}), [data.task_id]: data };
      progressRef.current[data.dashboardId] = dbProgress;
      dispatch({ type: 'SET_DASHBOARD_PROGRESS', dashboardId: data.dashboardId, progress: dbProgress });
      if (data.dashboardId === currentDashboardIdRef.current) {
        dispatch({ type: 'SET_PROGRESS', data: dbProgress });
      }
      // Recompute sidebar status from latest progress
      const init = initRef.current[data.dashboardId];
      if (init) {
        const newStatus = deriveDashboardStatus(init, dbProgress);
        dispatch({ type: 'SET_DASHBOARD_STATE', id: data.dashboardId, status: newStatus });
      }
    });

    addListener('all_progress', (data) => {
      if (!data.dashboardId) return;
      const { dashboardId, ...progressMap } = data;
      // Merge with existing progress instead of overwriting — prevents losing
      // recent individual agent_progress updates that may not yet be reflected
      // in the bulk data (race condition between push events and pull data).
      const existing = progressRef.current[dashboardId] || {};
      const merged = { ...progressMap };
      for (const [taskId, existingEntry] of Object.entries(existing)) {
        const incoming = merged[taskId];
        if (!incoming) {
          // Task exists in cache but not in bulk — keep it (may be very recent)
          merged[taskId] = existingEntry;
        } else if (existingEntry.status === 'in_progress' && incoming.status === 'pending') {
          // Existing has more advanced status — keep it
          merged[taskId] = existingEntry;
        } else if (existingEntry.status === 'completed' && incoming.status !== 'completed') {
          merged[taskId] = existingEntry;
        } else if (existingEntry.status === 'failed' && incoming.status === 'pending') {
          merged[taskId] = existingEntry;
        }
      }
      progressRef.current[dashboardId] = merged;
      dispatch({ type: 'SET_DASHBOARD_PROGRESS', dashboardId, progress: merged });
      if (dashboardId === currentDashboardIdRef.current) {
        dispatch({ type: 'SET_PROGRESS', data: merged });
      }
      // Recompute sidebar status
      const init = initRef.current[dashboardId];
      if (init) {
        const newStatus = deriveDashboardStatus(init, merged);
        dispatch({ type: 'SET_DASHBOARD_STATE', id: dashboardId, status: newStatus });
      }
    });

    addListener('dashboards_list', (data) => {
      dispatch({ type: 'SET_DASHBOARDS_LIST', value: data.dashboards || [], names: data.names });
    });

    addListener('dashboards_changed', (data) => {
      dispatch({ type: 'SET_DASHBOARDS_LIST', value: data.dashboards || [], names: data.names });
    });

    addListener('init_state', (data) => {
      if (!data.dashboardId) return;
      const { dashboardId, initialization, progress, logs } = data;

      // Update per-dashboard caches
      if (initialization) {
        initRef.current[dashboardId] = initialization;
        if (dashboardId === currentDashboardIdRef.current) {
          dispatch({ type: 'SET_INIT', data: initialization });
        }
      }
      if (progress) {
        progressRef.current[dashboardId] = progress;
        dispatch({ type: 'SET_DASHBOARD_PROGRESS', dashboardId, progress });
        if (dashboardId === currentDashboardIdRef.current) {
          dispatch({ type: 'SET_PROGRESS', data: progress });
        }
      }
      if (logs) {
        dispatch({ type: 'SET_DASHBOARD_LOGS', dashboardId, logs });
        if (dashboardId === currentDashboardIdRef.current) {
          dispatch({ type: 'SET_LOGS', data: logs });
        }
      }
      // Recompute sidebar status
      const curInit = initialization || initRef.current[dashboardId];
      const curProg = progress || progressRef.current[dashboardId] || {};
      if (curInit) {
        const newStatus = deriveDashboardStatus(curInit, curProg);
        dispatch({ type: 'SET_DASHBOARD_STATE', id: dashboardId, status: newStatus });
      }
    });

    addListener('queue_changed', (data) => {
      dispatch({ type: 'SET', key: 'queueItems', value: data.queue || [] });
    });

    addListener('tasks_unblocked', (data) => {
      if (!data.dashboardId || !data.unblocked) return;
      if (data.dashboardId === currentDashboardIdRef.current) {
        dispatch({ type: 'SET_UNBLOCKED_TASKS', tasks: data.unblocked, completedTaskId: data.completedTaskId });
      }
    });

    addListener('write_rejected', (data) => {
      if (!data.dashboardId) return;
      console.error('[write_rejected]', data.reason, data.details);
    });

    dispatch({ type: 'SET', key: 'connected', value: true });

    return () => {
      listenersRef.current.forEach(({ handle }) => { if (handle) handle(); });
      listenersRef.current = [];
    };
  }, []); // Connect once on mount

  // Connection health monitoring — detect stale connection and re-fetch
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    let lastEventTime = Date.now();
    const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
    const STALE_THRESHOLD = 60000; // 60 seconds without any event

    // Track when any event arrives
    const heartbeatHandler = api.on('heartbeat', () => {
      lastEventTime = Date.now();
    });

    const progressHandler = api.on('agent_progress', () => {
      lastEventTime = Date.now();
    });

    const interval = setInterval(() => {
      if (Date.now() - lastEventTime > STALE_THRESHOLD) {
        console.warn('[useDashboardData] Connection appears stale, re-fetching...');
        fetchDashboardData(currentDashboardIdRef.current);
        lastEventTime = Date.now(); // Reset to avoid rapid re-fetches
      }
    }, HEALTH_CHECK_INTERVAL);

    return () => {
      clearInterval(interval);
      if (heartbeatHandler) heartbeatHandler();
      if (progressHandler) progressHandler();
    };
  }, [fetchDashboardData]);

  // Re-merge when init or progress changes
  useEffect(() => {
    const { currentInit, currentProgress, currentLogs } = state;
    const merged = mergeState(currentInit, currentProgress, currentLogs);
    dispatch({ type: 'SET_STATUS', data: merged });
  }, [state.currentInit, state.currentProgress, state.currentLogs]);
}
