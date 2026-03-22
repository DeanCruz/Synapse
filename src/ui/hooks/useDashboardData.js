// useDashboardData — Connects to IPC/webview-bridge push events and merges
// init + progress data into renderable status objects.
//
// Works across three environments:
//   - Electron: window.electronAPI set by preload (IPC push events)
//   - Webview:  window.electronAPI set by webview-main.jsx bridge (postMessage events)
//   - Browser:  no API — hook gracefully no-ops
//
// The webview bridge exposes the same .on()/.off()/.getDashboardInit()/etc.
// surface as the Electron preload, so all listener and fetch logic is shared.

import { useEffect, useCallback, useRef } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';
import { detectEnvironment } from './useElectronAPI.js';

/**
 * Merge static plan data (init) with dynamic progress data into a renderable status.
 */
export function mergeState(init, progress) {
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
 * Resolve the platform API for data transport.
 * Returns window.electronAPI in Electron and webview (bridge-as-electronAPI pattern),
 * or null in plain browser mode.
 */
function getPlatformAPI() {
  const env = detectEnvironment();
  if (env === 'electron' || env === 'webview') {
    return window.electronAPI || null;
  }
  return null;
}

/**
 * Hook: connect to IPC/webview-bridge push events and dispatch state updates.
 * Works in Electron (preload IPC), VSCode webview (bridge events), and
 * gracefully no-ops in plain browser mode.
 * Must be called once at the App level.
 */
export function useDashboardData() {
  const state = useAppState();
  const dispatch = useDispatch();
  const listenersRef = useRef([]);
  const progressRef = useRef({});

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
    let allDone = true, hasFailed = false;
    vals.forEach(p => {
      if (p.status === 'failed') hasFailed = true;
      if (p.status !== 'completed' && p.status !== 'failed') allDone = false;
    });
    const totalTasks = (init.task && init.task.total_tasks) || 0;
    if (totalTasks > 0 && vals.length < totalTasks) allDone = false;
    if (allDone && hasFailed) return 'error';
    if (allDone) return 'completed';
    if (vals.length > 0) return 'in_progress';
    return 'idle';
  }, []);

  // Fetch all data for a dashboard via IPC/bridge pull (used on mount + dashboard switch)
  const fetchDashboardData = useCallback(async (id) => {
    const api = getPlatformAPI();
    if (!api) return;

    try {
      const init = await api.getDashboardInit(id);
      if (init) dispatch({ type: 'SET_INIT', data: init });
    } catch (_) {}

    try {
      const progress = await api.getDashboardProgress(id);
      if (progress) dispatch({ type: 'SET_PROGRESS', data: progress });
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

  // Set up IPC/bridge push listeners once on mount
  useEffect(() => {
    const api = getPlatformAPI();
    if (!api) return;

    const addListener = (channel, handler) => {
      const handle = api.on(channel, handler);
      listenersRef.current.push({ channel, handle });
    };

    addListener('initialization', (data) => {
      if (!data.dashboardId) return;
      const { dashboardId, ...initData } = data;
      // Use ref (not stale state) to compare against current dashboard
      if (dashboardId === currentDashboardIdRef.current) {
        dispatch({ type: 'SET_INIT', data: initData });
      }
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
    });

    addListener('all_progress', (data) => {
      if (!data.dashboardId) return;
      const { dashboardId, ...progressMap } = data;
      progressRef.current[dashboardId] = progressMap;
      dispatch({ type: 'SET_DASHBOARD_PROGRESS', dashboardId, progress: progressMap });
      if (dashboardId === currentDashboardIdRef.current) {
        dispatch({ type: 'SET_PROGRESS', data: progressMap });
      }
    });

    addListener('dashboards_list', (data) => {
      dispatch({ type: 'SET', key: 'dashboardList', value: data.dashboards || [] });
    });

    addListener('dashboards_changed', (data) => {
      dispatch({ type: 'SET', key: 'dashboardList', value: data.dashboards || [] });
    });

    addListener('queue_changed', (data) => {
      dispatch({ type: 'SET', key: 'queueItems', value: data.queue || [] });
    });

    dispatch({ type: 'SET', key: 'connected', value: true });

    return () => {
      listenersRef.current.forEach(({ channel, handle }) => api.off(channel, handle));
      listenersRef.current = [];
    };
  }, []); // Connect once on mount

  // Re-merge when init or progress changes
  useEffect(() => {
    const { currentInit, currentProgress } = state;
    const merged = mergeState(currentInit, currentProgress);
    dispatch({ type: 'SET_STATUS', data: merged });
  }, [state.currentInit, state.currentProgress]);
}
