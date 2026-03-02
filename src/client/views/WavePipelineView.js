// WavePipelineView — Wave column layout rendering
// ES module. Extracted from dashboard.js lines 572-640.

import { el } from '../utils/dom.js';
import { createAgentCard, createStatusBadge } from './AgentCardView.js';
import { drawDependencyLines, setupCardHoverEffects } from './DependencyLinesView.js';

/**
 * Render the wave pipeline layout.
 * Builds wave columns with agent cards, an SVG overlay for dependency lines,
 * and performs an atomic DOM swap via document fragment.
 *
 * @param {HTMLElement} container — the pipeline container element (e.g., .wave-pipeline)
 * @param {Array} waves — wave definitions from initialization.json
 * @param {Array} agents — agent entries (with merged progress data on status/summary/etc.)
 * @param {Object} options
 * @param {string|null} options.activeStatFilter — status filter (e.g., 'completed'), or null for all
 * @param {Object} options.progressData — map of agent ID -> progress object (or {})
 * @param {function} options.onCardClick — callback(agent) when a card is clicked
 * @returns {{ cardElements: Object, cardElementMap: Object, renderedCardCount: number }}
 */
export function renderWavePipeline(container, waves, agents, options) {
  var activeStatFilter = options.activeStatFilter || null;
  var progressData = options.progressData || {};
  var onCardClick = options.onCardClick || null;

  container.className = 'wave-pipeline';
  var frag = document.createDocumentFragment();
  var cardElementMap = {};

  // Build agent map for dependency line drawing
  var agentMap = {};
  for (var a = 0; a < agents.length; a++) {
    agentMap[agents[a].id] = agents[a];
  }

  // Card element map for SVG line drawing
  var cardElements = {};
  var renderedCardCount = 0;

  var visibleAgents = activeStatFilter
    ? agents.filter(function (a) { return a.status === activeStatFilter; })
    : agents;

  for (var i = 0; i < waves.length; i++) {
    var wave = waves[i];

    // When filtering, skip waves that have no matching agents
    var waveAgents = visibleAgents.filter(function (a) {
      return a.wave === wave.id;
    });
    if (activeStatFilter && waveAgents.length === 0) continue;

    var col = el('div', {
      className:
        'wave-column' +
        (wave.status === 'in_progress' ? ' wave-active' : '') +
        (wave.status === 'completed' ? ' wave-done' : ''),
    });

    // Wave header
    var header = el('div', { className: 'wave-header' });
    var headerText = el('span', {
      className: 'wave-title',
      text: 'Wave ' + wave.id + ': ' + wave.name,
    });
    var badge = createStatusBadge(wave.status);
    header.appendChild(headerText);
    header.appendChild(badge);
    col.appendChild(header);

    for (var j = 0; j < waveAgents.length; j++) {
      var agentProgress = progressData[waveAgents[j].id] || null;
      var callbacks = { onCardClick: onCardClick };
      var card = createAgentCard(waveAgents[j], agentProgress, callbacks);
      cardElements[waveAgents[j].id] = card;
      cardElementMap[waveAgents[j].id] = card;
      col.appendChild(card);
      renderedCardCount++;
    }

    frag.appendChild(col);
  }

  // SVG overlay for dependency lines
  var svgNS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'chain-svg');
  frag.appendChild(svg);

  // Atomic DOM swap — no intermediate empty state visible
  container.replaceChildren(frag);

  // Draw lines after layout settles
  requestAnimationFrame(function () {
    drawDependencyLines(svg, agents, agentMap, cardElements, container);
    setupCardHoverEffects(container, svg);
  });

  return { cardElements: cardElements, cardElementMap: cardElementMap, renderedCardCount: renderedCardCount };
}
