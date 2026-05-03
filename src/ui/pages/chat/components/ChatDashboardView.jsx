// ChatDashboardView — Agents are stacked vertically; each agent renders as
// a horizontal strip of AgentCards. When an agent has internal dependencies
// (multiple waves), tasks are grouped by wave with extra spacing — no border
// or wave label. When an agent is fully parallel (single wave), tasks render
// as a flat horizontal row.
//
// Reads chat-agent-* dashboard folders from dashboards/ via electronAPI and
// live-updates when files change (chat_dashboard_changed push event).

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AgentCard, { StatusBadge } from '@/pages/code/subpages/dashboards/components/AgentCard.jsx';
import AgentDetails from '@/shared/modals/AgentDetails.jsx';
import { drawDependencyLines, setupCardHoverEffects } from '@/utils/dependencyLines.js';

function shapeAgent(name, tasks) {
  const safeTasks = (tasks || []).map((t) => ({
    ...t,
    depends_on: t.depends_on || [],
  }));
  const allCompleted =
    safeTasks.length > 0 && safeTasks.every((t) => t.status === 'completed');
  const hasFailed = safeTasks.some((t) => t.status === 'failed');
  const hasInProgress = safeTasks.some((t) => t.status === 'in_progress');

  let status = 'pending';
  if (allCompleted) status = 'completed';
  else if (hasFailed) status = 'failed';
  else if (hasInProgress) status = 'in_progress';

  return { name, tasks: safeTasks, status };
}

function taskToAgent(task) {
  return {
    id: task.task_id,
    title: task.title,
    status: task.status,
    started_at: task.started_at,
    completed_at: task.completed_at,
    summary: task.summary,
    stage: task.stage,
    message: task.message,
    files_changed: task.files_changed,
    deviations: task.deviations,
    depends_on: task.depends_on || [],
    layer: task.layer,
    directory: task.directory,
    assigned_agent: task.assigned_agent,
  };
}

// Group an agent's tasks into waves using longest-path topological levels
// over within-agent dependencies only. Cross-agent depends_on are ignored.
// Returns: array of arrays of tasks, ordered wave 0 -> N.
function computeWavesForAgent(tasks) {
  const idSet = new Set(tasks.map((t) => t.task_id));
  const levels = {};
  const inDegree = {};
  const adj = {};

  for (const t of tasks) {
    levels[t.task_id] = 0;
    inDegree[t.task_id] = 0;
    adj[t.task_id] = [];
  }
  for (const t of tasks) {
    const deps = (t.depends_on || []).filter((d) => idSet.has(d));
    inDegree[t.task_id] = deps.length;
    for (const d of deps) adj[d].push(t.task_id);
  }

  const queue = tasks
    .filter((t) => inDegree[t.task_id] === 0)
    .map((t) => t.task_id);

  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of adj[id]) {
      levels[next] = Math.max(levels[next], levels[id] + 1);
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  const groups = {};
  for (const t of tasks) {
    const lvl = levels[t.task_id];
    if (!groups[lvl]) groups[lvl] = [];
    groups[lvl].push(t);
  }
  return Object.keys(groups)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => groups[k]);
}

export default function ChatDashboardView() {
  const [agentLanes, setAgentLanes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(null);

  // Flat lookup of every task across every lane, for AgentDetails dep labels.
  const taskById = useMemo(() => {
    const map = {};
    for (const lane of agentLanes) {
      for (const t of lane.tasks) {
        map[t.task_id] = { ...taskToAgent(t), wave: undefined, name: lane.name };
      }
    }
    return map;
  }, [agentLanes]);

  const findAgent = useCallback((id) => taskById[id] || null, [taskById]);

  const loadData = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.getChatDashboardData) {
      setAgentLanes([]);
      setLoading(false);
      return;
    }

    try {
      const result = await api.getChatDashboardData();
      const rawAgents = result?.agents || [];
      const lanes = rawAgents
        .map((a) => shapeAgent(a.name, a.tasks))
        .sort((a, b) => a.name.localeCompare(b.name));
      setAgentLanes(lanes);
    } catch (err) {
      console.error('Failed to load chat dashboard data:', err);
      setAgentLanes([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.on) return;
    const off = api.on('chat_dashboard_changed', () => loadData());
    return () => {
      if (typeof off === 'function') off();
    };
  }, [loadData]);

  if (loading) {
    return (
      <div className="chat-dashboard-loading">
        <span>Loading agent data...</span>
      </div>
    );
  }

  if (agentLanes.length === 0) {
    return (
      <div className="chat-dashboard-empty">
        <svg
          width="48"
          height="48"
          viewBox="0 0 16 16"
          fill="none"
          style={{ opacity: 0.3 }}
        >
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <h3>No Active Agents</h3>
        <p>Agent task folders will appear here as agents create them</p>
      </div>
    );
  }

  return (
    <div className="chat-dashboard-view">
      <div className="chat-dashboard-header">
        <h2>Agent Dashboard</h2>
        <span className="chat-dashboard-count">
          {agentLanes.length} agent{agentLanes.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="chat-agent-pipeline">
        {agentLanes.map((lane) => (
          <AgentRow
            key={lane.name}
            lane={lane}
            onAgentClick={setSelectedAgent}
          />
        ))}
      </div>

      {selectedAgent && (
        <AgentDetails
          agent={selectedAgent}
          progressData={null}
          findAgentFn={findAgent}
          onClose={() => setSelectedAgent(null)}
          projectRoot={null}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentRow — one agent: header + per-agent wave-column pipeline.
// Multi-wave agents render as a horizontal flow of wave-columns (cards
// stacked vertically within each column) and reuse the code dashboard's
// BFS dependency-line engine. Single-wave agents render as a flat
// horizontal strip with no dependency lines.
// ---------------------------------------------------------------------------

function AgentRow({ lane, onAgentClick }) {
  const { name, tasks, status } = lane;
  const waves = computeWavesForAgent(tasks);
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const total = tasks.length;
  const hasMultipleWaves = waves.length > 1;

  const tasksRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!hasMultipleWaves) return;
    const container = tasksRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;

    // Shape tasks into the agent objects expected by drawDependencyLines.
    // Restrict depends_on to within-agent ids so the BFS only links siblings.
    const idSet = new Set(tasks.map((t) => t.task_id));
    const agents = tasks.map((t) => ({
      id: t.task_id,
      status: t.status,
      depends_on: (t.depends_on || []).filter((d) => idSet.has(d)),
    }));
    const agentMap = {};
    for (const a of agents) agentMap[a.id] = a;

    const collectCards = () => {
      const cardEls = {};
      container
        .querySelectorAll('.agent-card[data-agent-id]')
        .forEach((el) => {
          cardEls[el.getAttribute('data-agent-id')] = el;
        });
      return cardEls;
    };

    const redraw = () => {
      const cardEls = collectCards();
      drawDependencyLines(svg, agents, agentMap, cardEls, container);
      setupCardHoverEffects(container, svg);
    };
    redraw();

    const ro = new ResizeObserver(redraw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [tasks, hasMultipleWaves]);

  return (
    <div className={`chat-agent-row chat-agent-status-${status}`}>
      <div className="chat-agent-row-header">
        <span className="chat-agent-row-title">{name}</span>
        {total > 0 && (
          <span className="chat-agent-row-count">
            {completed}/{total}
          </span>
        )}
        <StatusBadge status={status} />
      </div>

      <div
        ref={tasksRef}
        className={
          'chat-agent-row-tasks' + (hasMultipleWaves ? ' chat-agent-row-tasks-waves' : '')
        }
      >
        {hasMultipleWaves && <svg ref={svgRef} className="chain-svg" />}
        {hasMultipleWaves
          ? waves.map((wave, i) => (
              <div key={i} className="wave-column chat-wave-column">
                {wave.map((task) => (
                  <AgentCard
                    key={task.task_id}
                    agent={taskToAgent(task)}
                    onClick={onAgentClick}
                  />
                ))}
              </div>
            ))
          : tasks.map((task) => (
              <AgentCard
                key={task.task_id}
                agent={taskToAgent(task)}
                onClick={onAgentClick}
              />
            ))}
      </div>
    </div>
  );
}

