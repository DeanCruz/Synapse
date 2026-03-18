// WavePipeline — Wave column layout component
// Mirrors the DOM structure produced by WavePipelineView.js renderWavePipeline().

import React, { useRef, useEffect } from 'react';
import { STATUS_COLORS, STATUS_BG_COLORS } from '@/utils/constants.js';
import AgentCard, { StatusBadge } from './AgentCard.jsx';
import { drawDependencyLines, setupCardHoverEffects } from '../utils/dependencyLines.js';

// ---------------------------------------------------------------------------
// WaveHeader
// ---------------------------------------------------------------------------

function WaveHeader({ wave }) {
  const completedCount = wave._completedCount ?? 0;
  const totalCount = wave._totalCount ?? wave.total ?? 0;

  return (
    <div
      className={
        'wave-header' +
        (wave.status === 'in_progress' ? ' wave-active' : '') +
        (wave.status === 'completed' ? ' wave-done' : '')
      }
    >
      <span className="wave-title">
        Wave {wave.id}: {wave.name}
      </span>
      {totalCount > 0 && (
        <span className="wave-count">
          {completedCount}/{totalCount}
        </span>
      )}
      <StatusBadge status={wave.status || 'pending'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WavePipeline
// ---------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {object} props.status — merged status object: { agents[], waves[], chains[] }
 * @param {string|null} props.activeStatFilter — filter agents by status string, or null for all
 * @param {function} props.onAgentClick — called with agent object when a card is clicked
 */
export default function WavePipeline({ status, activeStatFilter, onAgentClick }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  const agents = status?.agents || [];
  const waves = status?.waves || [];

  // Build agent map for dependency line drawing
  const agentMap = {};
  for (const agent of agents) {
    agentMap[agent.id] = agent;
  }

  // Apply stat filter
  const visibleAgents = activeStatFilter
    ? agents.filter((a) => a.status === activeStatFilter)
    : agents;

  // Precompute per-wave counts for the header badge
  const completedByWave = {};
  const totalByWave = {};
  for (const agent of agents) {
    const wid = agent.wave;
    if (!totalByWave[wid]) totalByWave[wid] = 0;
    if (!completedByWave[wid]) completedByWave[wid] = 0;
    totalByWave[wid]++;
    if (agent.status === 'completed') completedByWave[wid]++;
  }

  // Draw dependency lines after every render where status changes
  useEffect(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg || !status) return;

    // Build cardElements map for BFS cache key computation
    const cardElements = {};
    container.querySelectorAll('.agent-card[data-agent-id]').forEach(el => {
      cardElements[el.getAttribute('data-agent-id')] = el;
    });

    drawDependencyLines(svg, agents, agentMap, cardElements, container);
    setupCardHoverEffects(container, svg);

    // Redraw when container is resized (layout shift moves cards)
    const ro = new ResizeObserver(() => {
      const cardEls = {};
      container.querySelectorAll('.agent-card[data-agent-id]').forEach(el => {
        cardEls[el.getAttribute('data-agent-id')] = el;
      });
      drawDependencyLines(svg, agents, agentMap, cardEls, container);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [status]);

  if (!status) return null;

  return (
    <div ref={containerRef} className="wave-pipeline">
      {/* Dependency lines SVG overlay — positioned absolute over the pipeline */}
      <svg ref={svgRef} className="chain-svg" />

      {waves.map((wave) => {
        // Agents in this wave that pass the filter
        const waveAgents = visibleAgents.filter((a) => a.wave === wave.id);

        // When filtering, skip waves with no matching agents
        if (activeStatFilter && waveAgents.length === 0) return null;

        const enrichedWave = {
          ...wave,
          _completedCount: completedByWave[wave.id] ?? 0,
          _totalCount: totalByWave[wave.id] ?? 0,
        };

        const colClass =
          'wave-column' +
          (wave.status === 'in_progress' ? ' wave-active' : '') +
          (wave.status === 'completed' ? ' wave-done' : '');

        return (
          <div key={wave.id} className={colClass}>
            <WaveHeader wave={enrichedWave} />
            {waveAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onClick={onAgentClick}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
