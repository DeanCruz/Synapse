// ChatDashboardView — Agents are stacked vertically; each agent renders as
// a horizontal strip of AgentCards. When an agent has internal dependencies
// (multiple waves), tasks are grouped by wave with extra spacing — no border
// or wave label. When an agent is fully parallel (single wave), tasks render
// as a flat horizontal row.
//
// Reads agent folders from Chat/Dashboard/Agent{x}/ via electronAPI and
// live-updates when files change (chat_dashboard_changed push event).
// Falls back to hardcoded demo data when no agent folders exist or in
// non-Electron envs.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AgentCard, { StatusBadge } from '../AgentCard.jsx';
import AgentDetails from '../modals/AgentDetails.jsx';
import { drawDependencyLines, setupCardHoverEffects } from '../../utils/dependencyLines.js';

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
      const lanes = await loadDemoData();
      setAgentLanes(lanes.map((l) => shapeAgent(l.name, l.tasks)));
      setLoading(false);
      return;
    }

    try {
      const result = await api.getChatDashboardData();
      const rawAgents = result?.agents || [];
      if (rawAgents.length === 0) {
        const lanes = await loadDemoData();
        setAgentLanes(lanes.map((l) => shapeAgent(l.name, l.tasks)));
      } else {
        const lanes = rawAgents
          .map((a) => shapeAgent(a.name, a.tasks))
          .sort((a, b) => a.name.localeCompare(b.name));
        setAgentLanes(lanes);
      }
    } catch (err) {
      console.error('Failed to load chat dashboard data:', err);
      const lanes = await loadDemoData();
      setAgentLanes(lanes.map((l) => shapeAgent(l.name, l.tasks)));
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

// ---------------------------------------------------------------------------
// Demo data fallback — matches the files created by T1.3
// ---------------------------------------------------------------------------

async function loadDemoData() {
  const demoAgents = [
    {
      name: 'Agent1',
      tasks: [
        {
          task_id: 'a1-1',
          title: 'Setup data ingestion pipeline',
          status: 'completed',
          agent: 'Agent1',
          depends_on: [],
          started_at: '2026-04-28T10:00:00Z',
          completed_at: '2026-04-28T10:05:30Z',
          summary: 'Created ingestion pipeline with S3 source connector',
          stage: 'complete',
          message: 'Pipeline operational',
          files_changed: ['src/pipeline/ingestion.py', 'config/sources.yaml'],
          milestones: ['Schema defined', 'Connector tested', 'Pipeline deployed'],
          deviations: [],
        },
        {
          task_id: 'a1-2',
          title: 'Implement data transformations',
          status: 'completed',
          agent: 'Agent1',
          depends_on: ['a1-1'],
          started_at: '2026-04-28T10:06:00Z',
          completed_at: '2026-04-28T10:12:45Z',
          summary: 'Added 5 transformation stages including normalization',
          stage: 'complete',
          message: 'All transforms passing validation',
          files_changed: ['src/pipeline/transforms.py', 'src/pipeline/validators.py'],
          milestones: [],
          deviations: [],
        },
        {
          task_id: 'a1-3',
          title: 'Configure output sink',
          status: 'completed',
          agent: 'Agent1',
          depends_on: ['a1-2'],
          started_at: '2026-04-28T10:13:00Z',
          completed_at: '2026-04-28T10:18:20Z',
          summary: 'PostgreSQL sink configured with batch writes',
          stage: 'complete',
          message: 'Sink operational with 1000 batch size',
          files_changed: ['src/pipeline/sinks.py', 'config/output.yaml'],
          milestones: [],
          deviations: [],
        },
      ],
    },
    {
      name: 'Agent2',
      tasks: [
        {
          task_id: 'a2-1',
          title: 'Design API schema',
          status: 'completed',
          agent: 'Agent2',
          depends_on: [],
          started_at: '2026-04-28T10:00:00Z',
          completed_at: '2026-04-28T10:08:00Z',
          summary: 'OpenAPI 3.1 schema with 12 endpoints defined',
          stage: 'complete',
          message: 'Schema validated',
          files_changed: ['api/openapi.yaml'],
          milestones: [],
          deviations: [],
        },
        {
          task_id: 'a2-2',
          title: 'Implement REST endpoints',
          status: 'in_progress',
          agent: 'Agent2',
          depends_on: ['a2-1'],
          started_at: '2026-04-28T10:09:00Z',
          completed_at: null,
          summary: null,
          stage: 'coding',
          message: 'Implementing GET /users and POST /users endpoints',
          files_changed: ['api/routes/users.py'],
          milestones: [],
          deviations: [],
        },
        {
          task_id: 'a2-3',
          title: 'Add authentication middleware',
          status: 'pending',
          agent: 'Agent2',
          depends_on: ['a2-2'],
          started_at: null,
          completed_at: null,
          summary: null,
          stage: null,
          message: 'Waiting for endpoints',
          files_changed: [],
          milestones: [],
          deviations: [],
        },
      ],
    },
    {
      name: 'Agent3',
      tasks: [
        {
          task_id: 'a3-1',
          title: 'Write unit test suite',
          status: 'completed',
          agent: 'Agent3',
          depends_on: [],
          started_at: '2026-04-28T10:02:00Z',
          completed_at: '2026-04-28T10:10:00Z',
          summary: '42 unit tests across 3 modules, all passing',
          stage: 'complete',
          message: 'All tests green',
          files_changed: [
            'tests/test_pipeline.py',
            'tests/test_transforms.py',
            'tests/test_sinks.py',
          ],
          milestones: [],
          deviations: [],
        },
        {
          task_id: 'a3-2',
          title: 'Write integration tests',
          status: 'in_progress',
          agent: 'Agent3',
          depends_on: ['a3-1', 'a1-3'],
          started_at: '2026-04-28T10:15:00Z',
          completed_at: null,
          summary: null,
          stage: 'testing',
          message: 'Running end-to-end pipeline test with mock data',
          files_changed: ['tests/integration/test_e2e.py'],
          milestones: [],
          deviations: [],
        },
        {
          task_id: 'a3-3',
          title: 'Performance benchmarks',
          status: 'pending',
          agent: 'Agent3',
          depends_on: ['a3-2'],
          started_at: null,
          completed_at: null,
          summary: null,
          stage: null,
          message: 'Waiting for integration tests',
          files_changed: [],
          milestones: [],
          deviations: [],
        },
      ],
    },
    {
      name: 'Agent4',
      tasks: [
        {
          task_id: 'a4-1',
          title: 'Lint frontend modules',
          status: 'completed',
          agent: 'Agent4',
          depends_on: [],
          started_at: '2026-04-28T11:00:00Z',
          completed_at: '2026-04-28T11:02:15Z',
          summary: 'ESLint passed on 34 frontend files with 0 errors',
          stage: 'complete',
          message: 'All frontend modules clean',
          files_changed: [],
          milestones: ['Lint pass complete'],
          deviations: [],
        },
        {
          task_id: 'a4-2',
          title: 'Lint backend services',
          status: 'in_progress',
          agent: 'Agent4',
          depends_on: [],
          started_at: '2026-04-28T11:00:00Z',
          completed_at: null,
          summary: null,
          stage: 'linting',
          message: 'Running pylint on services/ directory',
          files_changed: [],
          milestones: ['Core modules scanned'],
          deviations: [],
        },
        {
          task_id: 'a4-3',
          title: 'Lint shared utilities',
          status: 'in_progress',
          agent: 'Agent4',
          depends_on: [],
          started_at: '2026-04-28T11:00:05Z',
          completed_at: null,
          summary: null,
          stage: 'linting',
          message: 'Scanning utils/ and helpers/ packages',
          files_changed: [],
          milestones: [],
          deviations: [],
        },
        {
          task_id: 'a4-4',
          title: 'Validate config schemas',
          status: 'completed',
          agent: 'Agent4',
          depends_on: [],
          started_at: '2026-04-28T11:00:00Z',
          completed_at: '2026-04-28T11:01:30Z',
          summary: 'All 8 config schemas valid',
          stage: 'complete',
          message: 'JSON Schema validation passed',
          files_changed: [],
          milestones: ['Schema validation complete'],
          deviations: [],
        },
      ],
    },
    {
      name: 'Agent5',
      tasks: [
        {
          task_id: 'a5-1',
          title: 'Scaffold database schema',
          status: 'completed',
          agent: 'Agent5',
          depends_on: [],
          started_at: '2026-04-28T11:10:00Z',
          completed_at: '2026-04-28T11:14:00Z',
          summary: 'Created 6 tables with indexes and constraints',
          stage: 'complete',
          message: 'Migration 001 applied',
          files_changed: ['db/migrations/001_initial.sql', 'db/schema.prisma'],
          milestones: ['Schema designed', 'Migration generated', 'Migration applied'],
          deviations: [],
        },
        {
          task_id: 'a5-2',
          title: 'Generate API type definitions',
          status: 'completed',
          agent: 'Agent5',
          depends_on: [],
          started_at: '2026-04-28T11:10:00Z',
          completed_at: '2026-04-28T11:13:30Z',
          summary: 'TypeScript interfaces generated for all 6 models',
          stage: 'complete',
          message: 'Types exported from types/models.ts',
          files_changed: ['src/types/models.ts', 'src/types/index.ts'],
          milestones: ['Interfaces generated', 'Barrel export updated'],
          deviations: [],
        },
        {
          task_id: 'a5-3',
          title: 'Build repository layer',
          status: 'in_progress',
          agent: 'Agent5',
          depends_on: ['a5-1', 'a5-2'],
          started_at: '2026-04-28T11:14:30Z',
          completed_at: null,
          summary: null,
          stage: 'coding',
          message: 'Implementing UserRepository and ProjectRepository',
          files_changed: ['src/repositories/UserRepository.ts'],
          milestones: ['UserRepository done'],
          deviations: [],
        },
        {
          task_id: 'a5-4',
          title: 'Build service layer',
          status: 'in_progress',
          agent: 'Agent5',
          depends_on: ['a5-1', 'a5-2'],
          started_at: '2026-04-28T11:14:30Z',
          completed_at: null,
          summary: null,
          stage: 'coding',
          message: 'Wiring UserService with validation logic',
          files_changed: ['src/services/UserService.ts'],
          milestones: ['Service skeleton created'],
          deviations: [],
        },
        {
          task_id: 'a5-5',
          title: 'Wire HTTP controllers',
          status: 'pending',
          agent: 'Agent5',
          depends_on: ['a5-3', 'a5-4'],
          started_at: null,
          completed_at: null,
          summary: null,
          stage: null,
          message: 'Waiting for repository and service layers',
          files_changed: [],
          milestones: [],
          deviations: [],
        },
      ],
    },
    {
      name: 'Agent6',
      tasks: [
        {
          task_id: 'a6-1',
          title: 'Parallel: Scan dependencies',
          status: 'in_progress',
          agent: 'Agent6',
          depends_on: [],
          started_at: '2026-04-28T12:00:00Z',
          completed_at: null,
          summary: null,
          stage: 'scanning',
          message: 'Scanning npm dependency tree (parallel — no upstream)',
          files_changed: [],
          milestones: ['Lockfile parsed'],
          deviations: [],
        },
        {
          task_id: 'a6-2',
          title: 'Parallel: Scan secrets',
          status: 'in_progress',
          agent: 'Agent6',
          depends_on: [],
          started_at: '2026-04-28T12:00:00Z',
          completed_at: null,
          summary: null,
          stage: 'scanning',
          message: 'Running secret scanner across repo (parallel — no upstream)',
          files_changed: [],
          milestones: ['Patterns loaded'],
          deviations: [],
        },
        {
          task_id: 'a6-3',
          title: 'Build artifact bundle',
          status: 'completed',
          agent: 'Agent6',
          depends_on: [],
          started_at: '2026-04-28T11:55:00Z',
          completed_at: '2026-04-28T11:59:30Z',
          summary: 'Webpack bundle produced (4.2 MB)',
          stage: 'complete',
          message: 'Bundle ready for downstream consumers',
          files_changed: ['dist/bundle.js', 'dist/bundle.js.map'],
          milestones: ['Compile', 'Minify', 'Source maps'],
          deviations: [],
        },
        {
          task_id: 'a6-4',
          title: 'Parallel: Deploy to staging',
          status: 'in_progress',
          agent: 'Agent6',
          depends_on: ['a6-3'],
          started_at: '2026-04-28T12:00:00Z',
          completed_at: null,
          summary: null,
          stage: 'deploying',
          message: 'Pushing bundle to staging (parallel — depends on a6-3)',
          files_changed: [],
          milestones: ['Auth handshake done'],
          deviations: [],
        },
        {
          task_id: 'a6-5',
          title: 'Parallel: Publish to CDN',
          status: 'in_progress',
          agent: 'Agent6',
          depends_on: ['a6-3'],
          started_at: '2026-04-28T12:00:00Z',
          completed_at: null,
          summary: null,
          stage: 'uploading',
          message: 'Uploading bundle to CDN edge (parallel — depends on a6-3)',
          files_changed: [],
          milestones: ['CDN credentials loaded'],
          deviations: [],
        },
      ],
    },
  ];
  return demoAgents;
}
