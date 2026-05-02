// ChainPipeline — Chain row layout component
// Mirrors the DOM structure produced by ChainPipelineView.js renderChainPipeline().
// Dependency lines (BFS SVG overlay) are omitted in this React version; will be
// added as a follow-up enhancement.

import React from 'react';
import { STATUS_COLORS, STATUS_BG_COLORS } from '@/utils/constants.js';
import AgentCard, { StatusBadge } from './AgentCard.jsx';

// ---------------------------------------------------------------------------
// ChainWaveHeader — wave title cell in the top header row
// ---------------------------------------------------------------------------

function ChainWaveHeader({ wave }) {
  return (
    <div
      className={
        'chain-wave-header' +
        (wave.status === 'in_progress' ? ' chain-wave-active' : '') +
        (wave.status === 'completed' ? ' chain-wave-done' : '')
      }
    >
      <span className="wave-title">
        Wave {wave.id}: {wave.name}
      </span>
      <StatusBadge status={wave.status || 'pending'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChainPipeline
// ---------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {object} props.status — merged status object: { agents[], waves[], chains[] }
 * @param {string|null} props.activeStatFilter — filter agents by status string, or null for all
 * @param {function} props.onAgentClick — called with agent object when a card is clicked
 */
export default function ChainPipeline({ status, activeStatFilter, onAgentClick }) {
  if (!status) return null;

  const agents = status.agents || [];
  const waves = status.waves || [];
  const chains = status.chains || [];

  // Build agent lookup map: id -> agent
  const agentMap = {};
  for (const agent of agents) {
    agentMap[agent.id] = agent;
  }

  // Build visibility set for stat filter
  const visibleIds = new Set();
  const filteredAgents = activeStatFilter
    ? agents.filter((a) => a.status === activeStatFilter)
    : agents;
  for (const a of filteredAgents) {
    visibleIds.add(a.id);
  }

  return (
    <div className="chain-pipeline">
      {/* Wave column header row */}
      <div className="chain-header-row">
        {/* Empty label cell to align with chain label column */}
        <div className="chain-label-cell" />
        {waves.map((wave) => (
          <ChainWaveHeader key={wave.id} wave={wave} />
        ))}
      </div>

      {/* Chain rows */}
      {chains.map((chain) => {
        const chainTasks = chain.tasks || [];

        // When filtering, skip chains with no visible agents
        if (activeStatFilter) {
          const hasVisible = chainTasks.some((tid) => visibleIds.has(tid));
          if (!hasVisible) return null;
        }

        return (
          <div key={chain.id} className="chain-row">
            {/* Chain label */}
            <div className="chain-label">
              {chain.name || `Chain ${chain.id}`}
            </div>

            {/* One cell per wave column */}
            {waves.map((wave) => {
              // Find which task in this chain belongs to this wave
              let taskId = null;
              for (const tid of chainTasks) {
                const ag = agentMap[tid];
                if (ag && ag.wave === wave.id) {
                  taskId = tid;
                  break;
                }
              }

              const agent = taskId ? agentMap[taskId] : null;
              const isVisible = agent && (!activeStatFilter || visibleIds.has(taskId));

              return (
                <div key={wave.id} className="chain-cell">
                  {isVisible && (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onClick={onAgentClick}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
